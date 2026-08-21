import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { success } from '../contracts/api.js';
import { DomainError, errorCodes } from '../domain/errors.js';
import { requireAdministrator, requireAuthenticatedAccount } from '../infrastructure/security/auth-context.js';
import { buildRuntimeRoleSystemPrompt } from '../infrastructure/models/model-adapter-factory.js';
import type { ModelPurpose } from '../infrastructure/models/model-runtime-config.js';
import { adminAiMembers, adminAiTriggerCatalog } from '../application/agents/admin-ai-trigger-catalog.js';
import { hiddenNarrativeMethodVersions } from '../application/planning/hidden-narrative-methods.js';

const PROMPT_PURPOSES: readonly ModelPurpose[] = [
  'discussion', 'structured_planning', 'novel_writer', 'novel_reviewer', 'review_synthesis'
];
const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'ignored'] as const;
const ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export async function registerAdminConsoleRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  app.get('/api/v1/admin/dashboard', async (request) => {
    requireAdministrator(request);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekStart = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const activeMembers = numberCell(database, `SELECT COUNT(*) AS value FROM user_memberships
      WHERE status='active' AND period_end > ?`, now.toISOString());
    const overview = {
      failedTasksToday: numberCell(database, `SELECT COUNT(*) AS value FROM tasks t WHERE substr(t.updated_at,1,10)=?
        AND (t.status='failed' OR EXISTS (SELECT 1 FROM discussion_participants p
          WHERE p.owner_id=t.owner_id AND p.book_id=t.book_id AND p.discussion_id=json_extract(t.task_brief_json,'$.discussionId') AND p.run_status IN ('failed','unavailable')))`, today),
      apiCashMicrosToday: numberCell(database, `SELECT COALESCE(SUM(cash_micros),0) AS value FROM usage_ledger WHERE substr(recorded_at,1,10)=?`, today),
      activeMembers,
      computeToday: numberCell(database, `SELECT COALESCE(SUM(input_tokens+output_tokens),0)*2 AS value FROM usage_ledger WHERE substr(recorded_at,1,10)=?`, today),
      openIssues: numberCell(database, `SELECT
        (SELECT COUNT(*) FROM tasks t LEFT JOIN admin_issue_records i ON i.source_type='failed_task' AND i.source_id=t.task_id
          WHERE (t.status='failed' OR EXISTS (SELECT 1 FROM discussion_participants p
            WHERE p.owner_id=t.owner_id AND p.book_id=t.book_id AND p.discussion_id=json_extract(t.task_brief_json,'$.discussionId') AND p.run_status IN ('failed','unavailable')))
            AND COALESCE(i.status,'open') IN ('open','in_progress')) +
        (SELECT COUNT(*) FROM user_feedback f LEFT JOIN admin_issue_records i ON i.source_type='feedback' AND i.source_id=f.feedback_id
          WHERE COALESCE(i.status,'open') IN ('open','in_progress')) AS value`),
      revenueCashMicros: numberCell(database, `SELECT COALESCE(SUM(amount_cash_micros),0) AS value FROM membership_transactions WHERE event_type IN ('grant','renew')`),
      monthRevenueCashMicros: numberCell(database, `SELECT COALESCE(SUM(amount_cash_micros),0) AS value FROM membership_transactions
        WHERE event_type IN ('grant','renew') AND substr(created_at,1,10)>=?`, monthStart)
    };
    const usageRows = database.prepare(`SELECT substr(recorded_at,1,10) AS day,
      COALESCE(SUM(cash_micros),0) AS cashMicros,
      COALESCE(SUM(input_tokens+output_tokens),0)*2 AS compute,
      COUNT(*) AS calls FROM usage_ledger WHERE substr(recorded_at,1,10)>=? GROUP BY day`).all(weekStart) as Array<Record<string, unknown>>;
    const revenueRows = database.prepare(`SELECT substr(created_at,1,10) AS day,
      COALESCE(SUM(amount_cash_micros),0) AS revenueCashMicros FROM membership_transactions
      WHERE event_type IN ('grant','renew') AND substr(created_at,1,10)>=? GROUP BY day`).all(weekStart) as Array<Record<string, unknown>>;
    const usageByDay = new Map(usageRows.map((row) => [String(row.day), row]));
    const revenueByDay = new Map(revenueRows.map((row) => [String(row.day), row]));
    const trend = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now.getTime() - (6 - index) * 86_400_000).toISOString().slice(0, 10);
      const usage = usageByDay.get(day);
      const revenue = revenueByDay.get(day);
      return {
        day,
        cashMicros: Number(usage?.cashMicros ?? 0),
        compute: Number(usage?.compute ?? 0),
        calls: Number(usage?.calls ?? 0),
        revenueCashMicros: Number(revenue?.revenueCashMicros ?? 0)
      };
    });
    const topUsers = database.prepare(`SELECT a.user_id AS userId,a.display_name AS displayName,a.email_normalized AS email,
      COALESCE(SUM(l.input_tokens+l.output_tokens),0)*2 AS compute,
      COALESCE(SUM(l.cash_micros),0) AS cashMicros,COUNT(l.usage_id) AS calls
      FROM user_accounts a JOIN usage_ledger l ON l.owner_id=a.owner_id
      WHERE substr(l.recorded_at,1,10)>=? GROUP BY a.user_id ORDER BY compute DESC LIMIT 8`).all(weekStart);
    const expiring = database.prepare(`SELECT a.user_id AS userId,a.display_name AS displayName,a.email_normalized AS email,
      m.plan,m.period_end AS periodEnd,CAST(julianday(m.period_end)-julianday(?) AS INTEGER) AS daysRemaining
      FROM user_memberships m JOIN user_accounts a ON a.user_id=m.user_id
      WHERE m.status='active' AND m.period_end>? AND m.period_end<=? ORDER BY m.period_end LIMIT 8`)
      .all(now.toISOString(), now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString());
    return success({ overview, trend, topUsers, expiring }, request.id);
  });

  app.get<{ Querystring: { query?: string; status?: string; source?: string; offset?: string; limit?: string } }>(
    '/api/v1/admin/issues', async (request) => {
      requireAdministrator(request);
      const records = database.prepare(`SELECT source_type,source_id,status,severity,admin_note,updated_at
        FROM admin_issue_records`).all() as Array<Record<string, unknown>>;
      const recordMap = new Map(records.map((row) => [`${row.source_type}:${row.source_id}`, row]));
      const failed = database.prepare(`SELECT t.task_id AS sourceId,
        CASE WHEN EXISTS (SELECT 1 FROM discussion_participants p WHERE p.owner_id=t.owner_id AND p.book_id=t.book_id AND p.discussion_id=json_extract(t.task_brief_json,'$.discussionId') AND p.run_status IN ('failed','unavailable')) THEN 'setting_member_failure' ELSE t.task_type END AS category,t.error_code AS errorCode,
        t.updated_at AS occurredAt,t.book_id AS bookId,b.title AS bookTitle,a.user_id AS userId,
        a.display_name AS displayName,a.email_normalized AS email,
        COALESCE((SELECT group_concat(ai.display_name || '：' || COALESCE(p.error_summary,'成员不可用'),'；')
          FROM discussion_participants p JOIN agent_instances ai ON ai.owner_id=p.owner_id AND ai.book_id=p.book_id AND ai.agent_id=p.agent_id
          WHERE p.owner_id=t.owner_id AND p.book_id=t.book_id AND p.discussion_id=json_extract(t.task_brief_json,'$.discussionId')
            AND p.run_status IN ('failed','unavailable')),
          (SELECT error_detail FROM model_calls m WHERE m.task_id=t.task_id AND m.error_detail IS NOT NULL
          ORDER BY m.completed_at DESC LIMIT 1),t.error_code,'任务失败') AS detail
        FROM tasks t JOIN books b ON b.owner_id=t.owner_id AND b.book_id=t.book_id
        LEFT JOIN user_accounts a ON a.owner_id=t.owner_id WHERE t.status='failed' OR EXISTS (SELECT 1 FROM discussion_participants p WHERE p.owner_id=t.owner_id AND p.book_id=t.book_id AND p.discussion_id=json_extract(t.task_brief_json,'$.discussionId') AND p.run_status IN ('failed','unavailable'))
        ORDER BY t.updated_at DESC LIMIT 500`).all() as Array<Record<string, unknown>>;
      const feedback = database.prepare(`SELECT f.feedback_id AS sourceId,f.category,f.message AS detail,
        f.created_at AS occurredAt,f.book_id AS bookId,b.title AS bookTitle,f.task_id AS taskId,
        f.page_path AS pagePath,a.user_id AS userId,a.display_name AS displayName,a.email_normalized AS email
        FROM user_feedback f JOIN user_accounts a ON a.user_id=f.user_id
        LEFT JOIN books b ON b.owner_id=f.owner_id AND b.book_id=f.book_id
        ORDER BY f.created_at DESC LIMIT 500`).all() as Array<Record<string, unknown>>;
      const issues = [
        ...failed.map((row) => issueView('failed_task', row, recordMap)),
        ...feedback.map((row) => issueView('feedback', row, recordMap))
      ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
      const query = request.query.query?.trim().toLocaleLowerCase('zh-CN') ?? '';
      const status = ISSUE_STATUSES.includes(request.query.status as typeof ISSUE_STATUSES[number]) ? request.query.status : '';
      const source = request.query.source === 'failed_task' || request.query.source === 'feedback' ? request.query.source : '';
      const filtered = issues.filter((issue) => (!status || issue.status === status) && (!source || issue.sourceType === source)
        && (!query || `${issue.displayName} ${issue.email} ${issue.bookTitle} ${issue.category} ${issue.detail}`.toLocaleLowerCase('zh-CN').includes(query)));
      const offset = boundedInteger(request.query.offset, 0, 10_000, 0);
      const limit = boundedInteger(request.query.limit, 1, 100, 50);
      return success({ items: filtered.slice(offset, offset + limit), total: filtered.length }, request.id);
    }
  );

  app.patch<{ Params: { sourceType: string; sourceId: string }; Body: { status?: string; severity?: string; note?: string } }>(
    '/api/v1/admin/issues/:sourceType/:sourceId', async (request) => {
      const administrator = requireAdministrator(request);
      const sourceType = request.params.sourceType;
      if (sourceType !== 'failed_task' && sourceType !== 'feedback') throw validation('问题来源不正确');
      const sourceId = request.params.sourceId.trim();
      const exists = sourceType === 'failed_task'
        ? database.prepare("SELECT 1 FROM tasks t WHERE task_id=? AND (status='failed' OR EXISTS (SELECT 1 FROM discussion_participants p WHERE p.owner_id=t.owner_id AND p.book_id=t.book_id AND p.discussion_id=json_extract(t.task_brief_json,'$.discussionId') AND p.run_status IN ('failed','unavailable')))").get(sourceId)
        : database.prepare('SELECT 1 FROM user_feedback WHERE feedback_id=?').get(sourceId);
      if (exists === undefined) throw new DomainError(errorCodes.validation, '问题记录不存在', {}, false, 404);
      const status = request.body?.status;
      const severity = request.body?.severity;
      if (!ISSUE_STATUSES.includes(status as typeof ISSUE_STATUSES[number])) throw validation('请选择正确的问题状态');
      if (!ISSUE_SEVERITIES.includes(severity as typeof ISSUE_SEVERITIES[number])) throw validation('请选择正确的严重程度');
      const note = typeof request.body?.note === 'string' ? request.body.note.trim().slice(0, 2000) : '';
      const now = new Date().toISOString();
      database.prepare(`INSERT INTO admin_issue_records (
        issue_record_id,source_type,source_id,status,severity,admin_note,updated_by_user_id,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source_type,source_id) DO UPDATE SET
        status=excluded.status,severity=excluded.severity,admin_note=excluded.admin_note,
        updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`)
        .run(randomUUID(), sourceType, sourceId, String(status), String(severity), note, administrator.userId, now, now);
      return success({ sourceType, sourceId, status, severity, note, updatedAt: now }, request.id);
    }
  );

  app.post<{ Body: { bookId?: string; taskId?: string; category?: string; message?: string; pagePath?: string; recoveryKey?: string } }>(
    '/api/v1/feedback', async (request) => {
      const account = requireAuthenticatedAccount(request);
      const category = ['bug', 'experience', 'suggestion', 'other'].includes(request.body?.category ?? '')
        ? String(request.body.category) : 'other';
      const message = request.body?.message?.trim() ?? '';
      if (message.length < 2 || message.length > 2000) throw validation('反馈内容请填写2至2000个字');
      const bookId = optionalText(request.body?.bookId, 100);
      const taskId = optionalText(request.body?.taskId, 100);
      if (bookId !== null && database.prepare('SELECT 1 FROM books WHERE owner_id=? AND book_id=?').get(account.ownerId, bookId) === undefined) {
        throw new DomainError(errorCodes.validation, '反馈关联的书籍不存在', {}, false, 404);
      }
      if (taskId !== null && database.prepare('SELECT 1 FROM tasks WHERE owner_id=? AND task_id=?').get(account.ownerId, taskId) === undefined) {
        throw new DomainError(errorCodes.validation, '反馈关联的任务不存在', {}, false, 404);
      }
      const feedbackId = randomUUID();
      const now = new Date().toISOString();
      database.prepare(`INSERT INTO user_feedback (
        feedback_id,user_id,owner_id,book_id,task_id,category,message,page_path,recovery_key,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(feedbackId, account.userId, account.ownerId, bookId, taskId, category, message,
        optionalText(request.body?.pagePath, 300) ?? '', optionalText(request.body?.recoveryKey, 200) ?? '', now, now);
      return success({ feedbackId, received: true }, request.id);
    }
  );

  app.get('/api/v1/admin/membership-stats', async (request) => {
    requireAdministrator(request);
    const now = new Date();
    const monthStart = `${now.toISOString().slice(0, 7)}-01`;
    const summary = {
      activeMembers: numberCell(database, "SELECT COUNT(*) AS value FROM user_memberships WHERE status='active' AND period_end>?", now.toISOString()),
      totalRevenueCashMicros: numberCell(database, "SELECT COALESCE(SUM(amount_cash_micros),0) AS value FROM membership_transactions WHERE event_type IN ('grant','renew')"),
      monthRevenueCashMicros: numberCell(database, "SELECT COALESCE(SUM(amount_cash_micros),0) AS value FROM membership_transactions WHERE event_type IN ('grant','renew') AND substr(created_at,1,10)>=?", monthStart),
      renewals: numberCell(database, "SELECT COUNT(*) AS value FROM membership_transactions WHERE event_type='renew'"),
      expiringIn30Days: numberCell(database, "SELECT COUNT(*) AS value FROM user_memberships WHERE status='active' AND period_end>? AND period_end<=?",
        now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString())
    };
    const byPlan = database.prepare(`SELECT plan,COUNT(*) AS members FROM user_memberships
      WHERE status='active' AND period_end>? GROUP BY plan ORDER BY members DESC`).all(now.toISOString());
    const transactions = database.prepare(`SELECT x.transaction_id AS transactionId,x.event_type AS eventType,x.plan,
      x.amount_cash_micros AS amountCashMicros,x.period_start AS periodStart,x.period_end AS periodEnd,
      x.note,x.created_at AS createdAt,a.user_id AS userId,a.display_name AS displayName,a.email_normalized AS email
      FROM membership_transactions x JOIN user_accounts a ON a.user_id=x.user_id ORDER BY x.created_at DESC LIMIT 100`).all();
    return success({ summary, byPlan, transactions }, request.id);
  });

  app.get('/api/v1/admin/narrative-methods', async (request) => {
    requireAdministrator(request);
    const overrides = activeNarrativeOverrides(database);
    const overrideMap = new Map(overrides.map((item) => [item.methodKey, item]));
    const items = hiddenNarrativeMethodVersions().map((base) => {
      const override = overrideMap.get(base.methodKey);
      return {
        methodKey: base.methodKey,
        category: base.category,
        builtInVersion: base.version,
        content: override?.content ?? base.content,
        enabled: override?.enabled ?? true,
        activeOverrideVersion: override?.version ?? null,
        updatedAt: override?.createdAt ?? null
      };
    });
    return success({ items }, request.id);
  });

  app.put<{ Params: { methodKey: string }; Body: { content?: unknown; enabled?: boolean } }>(
    '/api/v1/admin/narrative-methods/:methodKey', async (request) => {
      const administrator = requireAdministrator(request);
      const methodKey = request.params.methodKey;
      const base = hiddenNarrativeMethodVersions().find((item) => item.methodKey === methodKey);
      if (base === undefined) throw new DomainError(errorCodes.validation, '叙事方法不存在', {}, false, 404);
      const content = normalizeMethodContent(request.body?.content, base.content);
      const enabled = request.body?.enabled !== false;
      const current = database.prepare(`SELECT COALESCE(MAX(version),0) AS version FROM narrative_method_overrides WHERE method_key=?`)
        .get(methodKey) as { version: number };
      const version = Number(current.version) + 1;
      const now = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare("UPDATE narrative_method_overrides SET status='superseded' WHERE method_key=? AND status='active'").run(methodKey);
        database.prepare(`INSERT INTO narrative_method_overrides (
          narrative_method_override_id,method_key,version,content_json,enabled,status,updated_by_user_id,created_at
        ) VALUES (?,?,?,?,?,'active',?,?)`).run(randomUUID(), methodKey, version, JSON.stringify(content), enabled ? 1 : 0,
          administrator.userId, now);
        database.exec('COMMIT');
      } catch (error) {
        if (database.isTransaction) database.exec('ROLLBACK');
        throw error;
      }
      return success({ methodKey, version, content, enabled, updatedAt: now }, request.id);
    }
  );

  app.get('/api/v1/admin/prompt-catalog', async (request) => {
    requireAdministrator(request);
    const overrides = database.prepare(`SELECT prompt_override_id AS promptOverrideId,trigger_key AS triggerKey,
      role_key AS roleKey,phase_key AS phaseKey,version,content,created_at AS createdAt
      FROM platform_prompt_overrides WHERE status='active' ORDER BY trigger_key,role_key,phase_key`).all();
    return success({ triggers: adminAiTriggerCatalog, members: adminAiMembers, purposes: PROMPT_PURPOSES, overrides }, request.id);
  });

  app.get<{ Querystring: { roleKey?: string; purpose?: string } }>('/api/v1/admin/runtime-system-prompt', async (request) => {
    requireAdministrator(request);
    const roleKey = request.query.roleKey ?? '';
    const purpose = request.query.purpose ?? '';
    if (!adminAiMembers.some((member) => member.roleKey === roleKey)) throw validation('请选择AI成员');
    if (!PROMPT_PURPOSES.includes(purpose as ModelPurpose)) throw validation('请选择任务类型');
    return success({ roleKey, purpose, systemPrompt: buildRuntimeRoleSystemPrompt(roleKey as never, purpose as ModelPurpose) }, request.id);
  });

  app.post<{ Body: { triggerKey?: string; roleKey?: string; phaseKey?: string; content?: string } }>(
    '/api/v1/admin/prompt-overrides', async (request) => {
      const administrator = requireAdministrator(request);
      const triggerKey = request.body?.triggerKey?.trim() ?? '';
      const roleKey = request.body?.roleKey?.trim() ?? '';
      const phaseKey = request.body?.phaseKey?.trim() || '*';
      const content = request.body?.content?.trim() ?? '';
      if (!adminAiTriggerCatalog.some((item) => item.triggerKey === triggerKey)) throw validation('请选择真实AI触发点');
      if (roleKey !== '*' && !adminAiMembers.some((member) => member.roleKey === roleKey)) throw validation('请选择AI成员');
      if (phaseKey.length > 160) throw validation('阶段标识过长');
      if (content.length < 1 || content.length > 8000) throw validation('附加提示词请填写1至8000个字');
      const current = database.prepare(`SELECT COALESCE(MAX(version),0) AS version FROM platform_prompt_overrides
        WHERE trigger_key=? AND role_key=? AND phase_key=?`).get(triggerKey, roleKey, phaseKey) as { version: number };
      const version = Number(current.version) + 1;
      const promptOverrideId = randomUUID();
      const now = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare(`UPDATE platform_prompt_overrides SET status='superseded'
          WHERE trigger_key=? AND role_key=? AND phase_key=? AND status='active'`).run(triggerKey, roleKey, phaseKey);
        database.prepare(`INSERT INTO platform_prompt_overrides (
          prompt_override_id,trigger_key,role_key,phase_key,version,content,status,updated_by_user_id,created_at
        ) VALUES (?,?,?,?,?,?,'active',?,?)`).run(promptOverrideId, triggerKey, roleKey, phaseKey, version, content,
          administrator.userId, now);
        database.exec('COMMIT');
      } catch (error) {
        if (database.isTransaction) database.exec('ROLLBACK');
        throw error;
      }
      return success({ promptOverrideId, triggerKey, roleKey, phaseKey, version, content, createdAt: now }, request.id);
    }
  );

  app.post<{ Params: { promptOverrideId: string } }>('/api/v1/admin/prompt-overrides/:promptOverrideId/archive', async (request) => {
    requireAdministrator(request);
    const result = database.prepare("UPDATE platform_prompt_overrides SET status='archived' WHERE prompt_override_id=? AND status='active'")
      .run(request.params.promptOverrideId);
    if (result.changes !== 1) throw new DomainError(errorCodes.validation, '提示词版本不存在或已经停用', {}, false, 404);
    return success({ archived: true }, request.id);
  });

  app.get<{ Querystring: { limit?: string } }>('/api/v1/admin/prompt-calls', async (request) => {
    requireAdministrator(request);
    const limit = boundedInteger(request.query.limit, 1, 100, 50);
    const items = database.prepare(`SELECT p.request_id AS requestId,p.task_type AS taskType,p.role_key AS roleKey,
      p.phase_key AS phaseKey,p.prompt_override_id AS promptOverrideId,p.created_at AS createdAt,
      c.state,c.provider,c.model_id AS modelId,c.input_tokens AS inputTokens,c.output_tokens AS outputTokens,
      c.cash_micros AS cashMicros,a.display_name AS displayName,b.title AS bookTitle
      FROM model_call_prompt_snapshots p JOIN model_calls c ON c.request_id=p.request_id
      JOIN books b ON b.owner_id=c.owner_id AND b.book_id=c.book_id
      LEFT JOIN user_accounts a ON a.owner_id=c.owner_id ORDER BY p.created_at DESC LIMIT ?`).all(limit);
    return success({ items }, request.id);
  });

  app.get<{ Params: { requestId: string } }>('/api/v1/admin/prompt-calls/:requestId', async (request) => {
    requireAdministrator(request);
    const row = database.prepare(`SELECT p.*,c.state,c.provider,c.model_id,c.context_pack_id,c.error_class,c.error_detail,
      t.task_brief_json,b.title AS book_title,a.display_name,a.email_normalized
      FROM model_call_prompt_snapshots p JOIN model_calls c ON c.request_id=p.request_id
      JOIN tasks t ON t.task_id=c.task_id JOIN books b ON b.owner_id=c.owner_id AND b.book_id=c.book_id
      LEFT JOIN user_accounts a ON a.owner_id=c.owner_id WHERE p.request_id=?`).get(request.params.requestId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new DomainError(errorCodes.validation, '这次调用没有可查看的提示词快照', {}, false, 404);
    const contextPackId = typeof row.context_pack_id === 'string' ? row.context_pack_id : null;
    const contextPack = contextPackId === null ? null : database.prepare(`SELECT context_pack_id,token_budget,total_tokens,
      source_manifest_json,excluded_sources_json,content_hash,status,created_at FROM context_packs WHERE context_pack_id=?`).get(contextPackId);
    return success({
      requestId: row.request_id,
      taskType: row.task_type,
      roleKey: row.role_key,
      phaseKey: row.phase_key,
      taskPrompt: row.task_prompt,
      supplementalInstructions: row.supplemental_instructions,
      promptOverrideId: row.prompt_override_id,
      state: row.state,
      provider: row.provider,
      modelId: row.model_id,
      errorClass: row.error_class,
      errorDetail: redactSensitive(String(row.error_detail ?? '')),
      taskBrief: parseJson(String(row.task_brief_json ?? '{}')),
      user: { displayName: row.display_name, email: row.email_normalized },
      bookTitle: row.book_title,
      contextPack: contextPack === null ? null : normalizeContextPack(contextPack as Record<string, unknown>)
    }, request.id);
  });
}

function numberCell(database: DatabaseSync, sql: string, ...values: Array<string | number>): number {
  return Number((database.prepare(sql).get(...values) as { value: number }).value);
}

function issueView(sourceType: 'failed_task' | 'feedback', row: Record<string, unknown>, records: Map<string, Record<string, unknown>>) {
  const sourceId = String(row.sourceId);
  const record = records.get(`${sourceType}:${sourceId}`);
  return {
    sourceType,
    sourceId,
    taskId: sourceType === 'failed_task' ? sourceId : nullableString(row.taskId),
    bookId: nullableString(row.bookId),
    bookTitle: String(row.bookTitle ?? ''),
    userId: nullableString(row.userId),
    displayName: String(row.displayName ?? '未关联账号'),
    email: String(row.email ?? ''),
    category: String(row.category ?? 'unknown'),
    detail: redactSensitive(String(row.detail ?? '')),
    errorCode: nullableString(row.errorCode),
    pagePath: String(row.pagePath ?? ''),
    occurredAt: String(row.occurredAt),
    status: String(record?.status ?? 'open'),
    severity: String(record?.severity ?? (sourceType === 'failed_task' ? 'high' : 'medium')),
    note: String(record?.admin_note ?? '')
  };
}

function activeNarrativeOverrides(database: DatabaseSync): Array<{
  methodKey: string; version: number; enabled: boolean; content: Record<string, unknown>; createdAt: string;
}> {
  const rows = database.prepare(`SELECT method_key,version,content_json,enabled,created_at
    FROM narrative_method_overrides WHERE status='active'`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    methodKey: String(row.method_key),
    version: Number(row.version),
    enabled: Number(row.enabled) === 1,
    content: parseJson(String(row.content_json)) as Record<string, unknown>,
    createdAt: String(row.created_at)
  }));
}

function normalizeMethodContent(input: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw validation('叙事方法内容格式不正确');
  const body = input as Record<string, unknown>;
  const stringArray = (key: string, maxItems: number): string[] => {
    const value = body[key];
    if (!Array.isArray(value)) return Array.isArray(fallback[key]) ? fallback[key] as string[] : [];
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, maxItems);
  };
  const adaptabilityInput = body.adaptability;
  const adaptability = adaptabilityInput !== null && typeof adaptabilityInput === 'object' && !Array.isArray(adaptabilityInput)
    ? adaptabilityInput as Record<string, unknown> : fallback.adaptability as Record<string, unknown>;
  return {
    internalLabel: String(body.internalLabel ?? fallback.internalLabel ?? '').trim().slice(0, 100),
    suitableProblems: stringArray('suitableProblems', 20),
    organization: stringArray('organization', 30),
    fitLengths: stringArray('fitLengths', 12),
    fitGenres: stringArray('fitGenres', 30),
    routineRisks: stringArray('routineRisks', 20),
    adaptability: {
      movable: adaptability.movable !== false,
      mergeable: adaptability.mergeable !== false,
      deletable: adaptability.deletable !== false,
      note: String(adaptability.note ?? '').trim().slice(0, 500)
    }
  };
}

function normalizeContextPack(row: Record<string, unknown>): Record<string, unknown> {
  return {
    contextPackId: row.context_pack_id,
    tokenBudget: row.token_budget,
    totalTokens: row.total_tokens,
    sources: parseJson(String(row.source_manifest_json ?? '[]')),
    excludedSources: parseJson(String(row.excluded_sources_json ?? '[]')),
    contentHash: row.content_hash,
    status: row.status,
    createdAt: row.created_at
  };
}

function boundedInteger(value: string | undefined, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.trim().slice(0, max);
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function redactSensitive(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [已隐藏]')
    .replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{8,}\b/giu, '[密钥已隐藏]')
    .slice(0, 4000);
}

function validation(message: string): DomainError {
  return new DomainError(errorCodes.validation, message, {}, false, 400);
}
