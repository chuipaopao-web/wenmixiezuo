import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { success } from '../contracts/api.js';
import { DomainError, errorCodes } from '../domain/errors.js';
import { requireAdministrator, requireAuthenticatedAccount } from '../infrastructure/security/auth-context.js';
import {
  buildFeatureCapabilityView, isFeatureBaselineKey, isFeatureCapabilityStatus
} from '../application/admin/v7-feature-capability-registry.js';
import { accountUsageRelation } from '../infrastructure/security/account-usage-service.js';
import { V7TaskAuditRepository, type V7TaskAuditRow } from '../infrastructure/db/repositories/v7-task-audit-repository.js';

const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'ignored'] as const;
const ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export async function registerV7AdminConsoleRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const taskAudit = new V7TaskAuditRepository(database);
  app.get<{
    Params: { runKind: string; runId: string };
    Querystring: { ownerId?: string; bookId?: string };
  }>('/api/v1/admin/v7/planning-runtime/:runKind/:runId', async (request) => {
    requireAdministrator(request);
    const ownerId = requiredAuditValue(request.query.ownerId, '作者范围');
    const bookId = requiredAuditValue(request.query.bookId, '书籍范围');
    const runKind = request.params.runKind;
    const runId = requiredAuditValue(request.params.runId, '任务编号');
    if (runKind === 'recipe') {
      const run = auditRow(database, 'v7_planning_recipe_runs', 'run_id', ownerId, bookId, runId);
      const methodSearches = auditRows(database, `SELECT * FROM v7_planning_method_searches
        WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at,search_id`, ownerId, bookId, runId)
        .map((row) => {
          const expanded = expandJsonColumns(row, ['member_snapshot_json', 'search_request_json', 'candidate_methods_json']);
          return { ...expanded, request: expanded.search_request_json, candidates: expanded.candidate_methods_json };
        });
      const methodProposals = auditRows(database, `SELECT * FROM v7_planning_recipe_proposals
        WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at,proposal_id`, ownerId, bookId, runId)
        .map((row) => {
          const expanded = expandJsonColumns(row, ['member_snapshot_json', 'proposal_json', 'source_proposal_ids_json']);
          return { ...expanded, proposal: expanded.proposal_json };
        });
      const storyRoutes = auditRows(database, `SELECT * FROM v7_planning_route_candidates
        WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at,route_id`, ownerId, bookId, runId)
        .map((row) => {
          const expanded = expandJsonColumns(row, ['member_snapshot_json', 'route_json']);
          return { ...expanded, route: expanded.route_json };
        });
      const routeReviews = auditRows(database, `SELECT * FROM v7_planning_route_reviews
        WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at`, ownerId, bookId, runId)
        .map((row) => {
          const expanded = expandJsonColumns(row, ['member_snapshot_json', 'route_ids_json', 'review_json']);
          return { ...expanded, review: expanded.review_json };
        });
      return success({
        run: expandJsonColumns(run, ['roster_json', 'checkpoint_json']),
        snapshot: planningSnapshotAudit(database, ownerId, bookId, String(run.snapshot_id)),
        proposals: methodProposals,
        methodProposals,
        methodSearches,
        contextPlan: methodSearches[0] === undefined ? null : {
          request: methodSearches[0].request,
          candidates: methodSearches[0].candidates
        },
        storyRoutes,
        routeReviews,
        routeReview: routeReviews[0] ?? null,
        recipes: auditRows(database, `SELECT * FROM v7_planning_recipe_versions
          WHERE owner_id=? AND book_id=? AND source_snapshot_id=? ORDER BY revision`, ownerId, bookId, String(run.snapshot_id))
          .map((row) => expandJsonColumns(row, ['recipe_json', 'source_proposal_ids_json'])),
        decisions: auditRows(database, `SELECT * FROM v7_planning_recipe_decisions
          WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at`, ownerId, bookId, runId),
        confirmedRoutes: auditRows(database, `SELECT * FROM v7_planning_route_versions
          WHERE owner_id=? AND book_id=? AND source_snapshot_id=? ORDER BY revision`, ownerId, bookId, String(run.snapshot_id))
          .map((row) => expandJsonColumns(row, ['route_json', 'source_route_ids_json'])),
        routeDecisions: auditRows(database, `SELECT * FROM v7_planning_route_decisions
          WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at`, ownerId, bookId, runId)
          .map((row) => expandJsonColumns(row, ['source_route_ids_json'])),
        calls: planningCallsAudit(database, ownerId, bookId, runId),
        modelCalls: planningCallsAudit(database, ownerId, bookId, runId)
      }, request.id);
    }
    if (runKind === 'tree') {
      const run = auditRow(database, 'v7_planning_generation_runs', 'generation_run_id', ownerId, bookId, runId);
      const expandedRun = expandJsonColumns(run, ['member_snapshot_json']);
      const frozenRoster = expandedRun.member_snapshot_json as { contextPlan?: unknown } | undefined;
      const candidate = run.candidate_tree_version_id === null ? null
        : database.prepare(`SELECT * FROM v7_planning_tree_versions
            WHERE owner_id=? AND book_id=? AND tree_version_id=?`)
          .get(ownerId, bookId, String(run.candidate_tree_version_id)) as Record<string, unknown> | undefined;
      return success({
        run: expandedRun,
        contextPlan: frozenRoster?.contextPlan ?? null,
        snapshot: planningSnapshotAudit(database, ownerId, bookId, String(run.source_snapshot_id)),
        candidate: candidate === null || candidate === undefined ? null
          : expandJsonColumns(candidate, ['content_json', 'source_refs_json']),
        calls: planningCallsAudit(database, ownerId, bookId, runId)
      }, request.id);
    }
    if (runKind === 'maintenance') {
      const run = auditRow(database, 'v7_planning_maintenance_runs', 'maintenance_run_id', ownerId, bookId, runId);
      return success({
        run: expandJsonColumns(run, [
          'source_snapshot_json', 'confirmed_tree_refs_json', 'member_snapshot_json', 'result_json'
        ]),
        actuals: auditRows(database, `SELECT * FROM v7_planning_node_actuals
          WHERE owner_id=? AND book_id=? AND source_kind=? AND source_version_id=? ORDER BY tree_kind,scope_id,node_key`,
          ownerId, bookId, String(run.source_kind), String(run.source_version_id))
          .map((row) => expandJsonColumns(row, ['evidence_refs_json'])),
        suggestions: auditRows(database, `SELECT * FROM v7_planning_adjustment_suggestions
          WHERE owner_id=? AND book_id=? AND source_kind=? AND source_version_id=? ORDER BY created_at`,
          ownerId, bookId, String(run.source_kind), String(run.source_version_id))
          .map((row) => expandJsonColumns(row, ['suggestion_json'])),
        calls: planningCallsAudit(database, ownerId, bookId, runId)
      }, request.id);
    }
    throw validation('请选择有效的V7规划任务类型');
  });

  app.get<{ Querystring: { baseline?: string; status?: string; moduleId?: string; query?: string } }>(
    '/api/v1/admin/feature-capabilities', async (request) => {
      requireAdministrator(request);
      const baselineValue = request.query.baseline ?? 'stable-baseline';
      if (!isFeatureBaselineKey(baselineValue)) throw validation('请选择有效的功能对照版本');
      const statusValue = request.query.status;
      if (statusValue !== undefined && !isFeatureCapabilityStatus(statusValue)) throw validation('请选择有效的功能状态');
      const moduleId = request.query.moduleId?.trim().slice(0, 100);
      const query = request.query.query?.trim().slice(0, 160);
      return success(buildFeatureCapabilityView({
        baseline: baselineValue,
        ...(statusValue === undefined ? {} : { status: statusValue }),
        ...(moduleId === undefined ? {} : { moduleId }),
        ...(query === undefined ? {} : { query })
      }), request.id);
    }
  );

  app.get('/api/v1/admin/dashboard', async (request) => {
    requireAdministrator(request);
    const now = new Date();
    const todayRange = shanghaiDayRange(now);
    const today = todayRange.day;
    const weekStart = shanghaiDayRange(new Date(now.getTime() - 6 * 86_400_000)).start;
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00+08:00`).toISOString();
    const window30Start = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const usageRelation = accountUsageRelation(database);
    const activeMembers = numberCell(database, `SELECT COUNT(*) AS value FROM user_memberships
      WHERE status='active' AND period_end > ?`, now.toISOString());
    const overview = {
      failedTasksToday: taskAudit.count({ start: todayRange.start, end: todayRange.end, failuresOnly: true }),
      apiCashMicrosToday: numberCell(database, `SELECT COALESCE(SUM(cash_micros),0) AS value FROM ${usageRelation}
        WHERE usage_state='consumed' AND recorded_at>=? AND recorded_at<?`, todayRange.start, todayRange.end),
      activeMembers,
      computeToday: numberCell(database, `SELECT COALESCE(SUM(consumed_tokens),0)*2 AS value FROM ${usageRelation}
        WHERE usage_state='consumed' AND recorded_at>=? AND recorded_at<?`, todayRange.start, todayRange.end),
      imageUnitsToday: numberCell(database, `SELECT COALESCE(SUM(consumed_units),0) AS value FROM ${usageRelation}
        WHERE usage_state='consumed' AND recorded_at>=? AND recorded_at<?`, todayRange.start, todayRange.end),
      reservedImageUnits: numberCell(database, `SELECT COALESCE(SUM(reserved_units),0) AS value FROM ${usageRelation}
        WHERE usage_state='reserved'`),
      openIssues: numberCell(database, `SELECT
        (SELECT COUNT(*) FROM tasks t LEFT JOIN admin_issue_records i ON i.source_type='failed_task' AND i.source_id=t.task_id
          WHERE (t.status='failed' OR EXISTS (SELECT 1 FROM discussion_participants p
            WHERE p.owner_id=t.owner_id AND p.book_id=t.book_id AND p.discussion_id=json_extract(t.task_brief_json,'$.discussionId') AND p.run_status IN ('failed','unavailable')))
            AND COALESCE(i.status,'open') IN ('open','in_progress')) +
        (SELECT COUNT(*) FROM user_feedback f LEFT JOIN admin_issue_records i ON i.source_type='feedback' AND i.source_id=f.feedback_id
          WHERE COALESCE(i.status,'open') IN ('open','in_progress')) AS value`),
      revenueCashMicros: numberCell(database, `SELECT COALESCE(SUM(amount_cash_micros),0) AS value FROM membership_transactions WHERE event_type IN ('grant','renew')`),
      monthRevenueCashMicros: numberCell(database, `SELECT COALESCE(SUM(amount_cash_micros),0) AS value FROM membership_transactions
        WHERE event_type IN ('grant','renew') AND created_at>=?`, monthStart)
    };
    const registeredUsers = numberCell(database, "SELECT COUNT(*) AS value FROM user_accounts WHERE role='user'");
    const cumulativePaidUsers = numberCell(database, `SELECT COUNT(DISTINCT t.user_id) AS value
      FROM membership_transactions t JOIN user_accounts a ON a.user_id=t.user_id
      WHERE a.role='user' AND t.event_type IN ('grant','renew') AND t.amount_cash_micros>0`);
    const newUsers30d = numberCell(database, "SELECT COUNT(*) AS value FROM user_accounts WHERE role='user' AND created_at>=?", window30Start);
    const firstPaidUsers30d = numberCell(database, `SELECT COUNT(*) AS value FROM user_accounts a WHERE a.role='user'
      AND a.created_at>=? AND EXISTS (SELECT 1 FROM membership_transactions t WHERE t.user_id=a.user_id
        AND t.event_type IN ('grant','renew') AND t.amount_cash_micros>0 AND t.created_at>=?)
      AND NOT EXISTS (SELECT 1 FROM membership_transactions earlier WHERE earlier.user_id=a.user_id
        AND earlier.event_type IN ('grant','renew') AND earlier.amount_cash_micros>0 AND earlier.created_at<?)`,
      window30Start, window30Start, window30Start);
    const business = {
      registeredUsers, cumulativePaidUsers, cumulativePaidRate: ratio(cumulativePaidUsers, registeredUsers),
      newUsers30d, firstPaidUsers30d, firstPaidRate30d: ratio(firstPaidUsers30d, newUsers30d),
      activePaidUsers: numberCell(database, `SELECT COUNT(DISTINCT m.user_id) AS value FROM user_memberships m
        JOIN user_accounts a ON a.user_id=m.user_id WHERE a.role='user'
        AND m.plan IN ('silver','gold','diamond') AND m.status='active' AND m.period_end>?
        AND EXISTS (SELECT 1 FROM membership_transactions t WHERE t.user_id=m.user_id
          AND t.event_type IN ('grant','renew') AND t.amount_cash_micros>0)`, now.toISOString()),
      recordedMembershipRevenueCashMicros: overview.revenueCashMicros,
      definitions: {
        cumulativePaidRate: '累计产生过有效付费会员交易的去重普通用户 ÷ 累计注册非管理员用户',
        firstPaidRate30d: '近30天新注册且在窗口内首次产生有效付费会员交易的普通用户 ÷ 近30天新注册普通用户',
        revenue: '会员交易账本中 grant/renew 的已记录金额；当前未接支付平台回调，不代表渠道实收、退款或对账结果。'
      }
    };
    const usageRows = database.prepare(`SELECT date(recorded_at,'+8 hours') AS day,
      COALESCE(SUM(cash_micros),0) AS cashMicros,
      COALESCE(SUM(consumed_tokens),0)*2 AS compute,
      COALESCE(SUM(consumed_units),0) AS imageUnits,
      COUNT(*) AS calls FROM ${usageRelation} WHERE usage_state='consumed' AND recorded_at>=? GROUP BY day`).all(weekStart) as Array<Record<string, unknown>>;
    const revenueRows = database.prepare(`SELECT date(created_at,'+8 hours') AS day,
      COALESCE(SUM(amount_cash_micros),0) AS revenueCashMicros FROM membership_transactions
      WHERE event_type IN ('grant','renew') AND created_at>=? GROUP BY day`).all(weekStart) as Array<Record<string, unknown>>;
    const usageByDay = new Map(usageRows.map((row) => [String(row.day), row]));
    const revenueByDay = new Map(revenueRows.map((row) => [String(row.day), row]));
    const trend = Array.from({ length: 7 }, (_, index) => {
      const day = shanghaiDayRange(new Date(now.getTime() - (6 - index) * 86_400_000)).day;
      const usage = usageByDay.get(day);
      const revenue = revenueByDay.get(day);
      return {
        day,
        cashMicros: Number(usage?.cashMicros ?? 0),
        compute: Number(usage?.compute ?? 0),
        imageUnits: Number(usage?.imageUnits ?? 0),
        calls: Number(usage?.calls ?? 0),
        revenueCashMicros: Number(revenue?.revenueCashMicros ?? 0)
      };
    });
    const topUsers = database.prepare(`SELECT a.user_id AS userId,a.display_name AS displayName,a.email_normalized AS email,
      COALESCE(SUM(l.consumed_tokens),0)*2 AS compute,
      COALESCE(SUM(l.cash_micros),0) AS cashMicros,
      COALESCE(SUM(l.consumed_units),0) AS imageUnits,COUNT(*) AS calls
      FROM user_accounts a JOIN ${usageRelation} l ON l.owner_id=a.owner_id
      WHERE l.usage_state='consumed' AND l.recorded_at>=? GROUP BY a.user_id ORDER BY compute DESC LIMIT 8`).all(weekStart);
    const expiring = database.prepare(`SELECT a.user_id AS userId,a.display_name AS displayName,a.email_normalized AS email,
      m.plan,m.period_end AS periodEnd,CAST(julianday(m.period_end)-julianday(?) AS INTEGER) AS daysRemaining
      FROM user_memberships m JOIN user_accounts a ON a.user_id=m.user_id
      WHERE m.status='active' AND m.period_end>? AND m.period_end<=? ORDER BY m.period_end LIMIT 8`)
      .all(now.toISOString(), now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString());
    return success({ overview, business, trend, topUsers, expiring }, request.id);
  });

  app.get<{ Querystring: { day?: string } }>('/api/v1/admin/user-operations', async (request) => {
    requireAdministrator(request);
    const { start, end, day } = request.query.day === undefined
      ? shanghaiDayRange(new Date()) : shanghaiDayRangeForDay(request.query.day);
    const users = database.prepare(`SELECT user_id AS userId,owner_id AS ownerId,email_normalized AS email,
      display_name AS displayName,status,created_at AS createdAt,last_login_at AS lastLoginAt
      FROM user_accounts WHERE role='user' ORDER BY created_at DESC LIMIT 200`).all() as Array<Record<string, unknown>>;
    const items = users.map((user) => {
      const ownerId = String(user.ownerId);
      const membership = database.prepare(`SELECT plan,status,period_end AS periodEnd FROM user_memberships
        WHERE user_id=? ORDER BY updated_at DESC LIMIT 1`).get(String(user.userId)) as Record<string, unknown> | undefined;
      const books = (database.prepare(`SELECT b.book_id AS bookId,b.title,b.status,b.created_at AS createdAt,b.updated_at AS updatedAt,
        COALESCE((SELECT stage FROM v7_creation_workflows w WHERE w.owner_id=b.owner_id AND w.book_id=b.book_id
          ORDER BY w.updated_at DESC LIMIT 1),
          CASE WHEN EXISTS(SELECT 1 FROM v7_planning_tree_heads p WHERE p.owner_id=b.owner_id AND p.book_id=b.book_id)
            THEN 'planning' WHEN EXISTS(SELECT 1 FROM v7_setting_batches s WHERE s.owner_id=b.owner_id AND s.book_id=b.book_id)
            THEN 'setting' ELSE 'opening' END) AS workflowStage,
        NULL AS currentVolume,NULL AS currentEvent,
        (SELECT MAX(chapter_number) FROM v7_manuscript_versions m WHERE m.owner_id=b.owner_id AND m.book_id=b.book_id) AS currentChapter,
        (SELECT MAX(created_at) FROM v7_manuscript_versions m WHERE m.owner_id=b.owner_id AND m.book_id=b.book_id) AS latestManuscriptAt,
        (SELECT MAX(created_at) FROM v7_chapter_settlements x WHERE x.owner_id=b.owner_id AND x.book_id=b.book_id) AS latestSettlementAt
        FROM books b
        WHERE b.owner_id=? AND b.status<>'purged' ORDER BY b.updated_at DESC`).all(ownerId) as Array<Record<string, unknown>>)
        .map((book): Record<string, unknown> => {
          const latestTask = taskAudit.latestForBook(ownerId, String(book.bookId));
          return { ...book, latestTaskId: latestTask?.taskId ?? null,
            latestTaskStatus: latestTask?.status ?? null, latestTaskAt: latestTask?.occurredAt ?? null };
        });
      const tasksToday = taskAudit.count({ ownerId, start, end });
      const failures = taskAudit.list({ ownerId, start, end, failuresOnly: true, limit: 1_000 })
        .map((failure) => taskFailureView(database, failure));
      const activityCandidates = [user.lastLoginAt, user.createdAt, ...books.flatMap((book) => [
        book.updatedAt, book.latestTaskAt, book.latestManuscriptAt, book.latestSettlementAt
      ])].filter((value): value is string => typeof value === 'string' && value.length > 0);
      const lastActivityAt = activityCandidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
      return { userId: user.userId, email: user.email, displayName: user.displayName, status: user.status,
        createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, lastActivityAt, membership: membership ?? null,
        bookCount: books.length, activeBookCount: books.filter((book) => book.status !== 'archived').length,
        archivedBookCount: books.filter((book) => book.status === 'archived').length,
        today: { day, taskCount: tasksToday, failed: failures.length > 0, failureCount: failures.length }, books, failures };
    });
    return success({ timezone: 'Asia/Shanghai', day, items }, request.id);
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
      monthRevenueCashMicros: numberCell(database, "SELECT COALESCE(SUM(amount_cash_micros),0) AS value FROM membership_transactions WHERE event_type IN ('grant','renew') AND created_at>=?", monthStart),
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

}

function requiredAuditValue(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length < 1 || normalized.length > 160) throw validation(`${label}无效`);
  return normalized;
}

function auditRow(
  database: DatabaseSync,
  table: string,
  idColumn: string,
  ownerId: string,
  bookId: string,
  runId: string
): Record<string, unknown> {
  const allowed = new Set([
    'v7_planning_recipe_runs:run_id',
    'v7_planning_generation_runs:generation_run_id',
    'v7_planning_maintenance_runs:maintenance_run_id'
  ]);
  if (!allowed.has(`${table}:${idColumn}`)) throw validation('审计对象无效');
  const row = database.prepare(`SELECT * FROM ${table} WHERE owner_id=? AND book_id=? AND ${idColumn}=?`)
    .get(ownerId, bookId, runId) as Record<string, unknown> | undefined;
  if (row === undefined) throw new DomainError(errorCodes.validation, 'V7规划任务不存在或范围不匹配', {}, false, 404);
  return row;
}

function auditRows(database: DatabaseSync, sql: string, ...bindings: string[]): Array<Record<string, unknown>> {
  return database.prepare(sql).all(...bindings) as Array<Record<string, unknown>>;
}

function expandJsonColumns(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const result = { ...row };
  for (const column of columns) {
    const value = result[column];
    if (typeof value === 'string') result[column] = JSON.parse(value) as unknown;
  }
  return result;
}

function planningSnapshotAudit(database: DatabaseSync, ownerId: string, bookId: string, snapshotId: string): unknown {
  const snapshot = database.prepare(`SELECT * FROM v7_planning_source_snapshots
    WHERE owner_id=? AND book_id=? AND snapshot_id=?`).get(ownerId, bookId, snapshotId) as Record<string, unknown> | undefined;
  if (snapshot === undefined) return null;
  return {
    ...expandJsonColumns(snapshot, ['compiled_content_json', 'excluded_sources_json']),
    items: auditRows(database, `SELECT * FROM v7_planning_source_items
      WHERE owner_id=? AND book_id=? AND snapshot_id=? ORDER BY sequence`, ownerId, bookId, snapshotId)
      .map((row) => expandJsonColumns(row, ['content_json']))
  };
}

function planningCallsAudit(database: DatabaseSync, ownerId: string, bookId: string, runId: string): unknown[] {
  return auditRows(database, `SELECT * FROM v7_planning_model_calls
    WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY started_at,request_id`, ownerId, bookId, runId);
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function shanghaiDayRange(moment: Date): { day: string; start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? '';
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  const startDate = new Date(`${day}T00:00:00+08:00`);
  return { day, start: startDate.toISOString(), end: new Date(startDate.getTime() + 86_400_000).toISOString() };
}

function shanghaiDayRangeForDay(value: string): { day: string; start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw validation('请选择正确的审计日期');
  const startDate = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(startDate.getTime()) || shanghaiDayRange(startDate).day !== value) throw validation('请选择正确的审计日期');
  return { day: value, start: startDate.toISOString(), end: new Date(startDate.getTime() + 86_400_000).toISOString() };
}

function taskPage(taskType: string): string {
  const normalized = taskType.toLowerCase();
  if (normalized.includes('setting')) return '设定';
  if (normalized.includes('storyline')) return '故事线';
  if (normalized.includes('volume')) return '分卷';
  if (normalized.includes('event')) return '事件';
  if (normalized.includes('chapter') || normalized.includes('outline')) return '章纲';
  if (normalized.includes('manuscript') || normalized.includes('write')) return '正文';
  if (normalized.includes('review')) return '审查';
  if (normalized.includes('settlement')) return '结算';
  return '任务中心';
}

function taskFailureView(database: DatabaseSync, task: V7TaskAuditRow): Record<string, unknown> {
  const bookTitle = task.bookId === null ? '' : String((database.prepare(`SELECT title FROM books
    WHERE owner_id=? AND book_id=?`).get(task.ownerId, task.bookId) as { title: string } | undefined)?.title ?? '');
  return {
    taskId: task.taskId,
    bookId: task.bookId ?? '',
    bookTitle,
    taskType: task.taskType,
    workflowNode: task.workflowNode,
    status: task.status,
    errorCode: task.errorCode,
    occurredAt: task.occurredAt,
    frontEndPage: taskPage(task.taskType),
    errorSummary: redactSensitive(task.errorSummary ?? '任务失败'),
    recoveryKey: task.sourceId
  };
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

function redactSensitive(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [已隐藏]')
    .replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{8,}\b/giu, '[密钥已隐藏]')
    .slice(0, 4000);
}

function validation(message: string): DomainError {
  return new DomainError(errorCodes.validation, message, {}, false, 400);
}
