import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { hashStableContractContent } from '@wenmi/contracts';
import { success } from '../contracts/api.js';
import { DomainError, errorCodes } from '../domain/errors.js';
import { requireAdministrator, requireAuthenticatedAccount } from '../infrastructure/security/auth-context.js';
import { buildRuntimeRoleSystemPrompt } from '../infrastructure/models/model-adapter-factory.js';
import type { ModelPurpose } from '../infrastructure/models/model-runtime-config.js';
import { allRoleSkills, coreAgentSkill, nodeSkillCatalog } from '../application/agents/agent-skills-v6.js';
import { creativeMemberContracts, roleModelProfiles } from '../contracts/agent-team-v2.js';
import { adminAiMembers, adminAiTriggerCatalog } from '../application/agents/admin-ai-trigger-catalog.js';
import { hiddenNarrativeMethodVersions } from '../application/planning/hidden-narrative-methods.js';
import {
  buildFeatureCapabilityView, isFeatureBaselineKey, isFeatureCapabilityStatus
} from '../application/admin/feature-capability-registry.js';

const PROMPT_PURPOSES: readonly ModelPurpose[] = [
  'discussion', 'structured_planning', 'novel_writer', 'novel_reviewer', 'review_synthesis'
];
const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'ignored'] as const;
const ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export async function registerAdminConsoleRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
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
    const activeMembers = numberCell(database, `SELECT COUNT(*) AS value FROM user_memberships
      WHERE status='active' AND period_end > ?`, now.toISOString());
    const overview = {
      failedTasksToday: numberCell(database, `SELECT COUNT(*) AS value FROM tasks t WHERE t.updated_at>=? AND t.updated_at<?
        AND (t.status='failed' OR EXISTS (SELECT 1 FROM discussion_participants p
          WHERE p.owner_id=t.owner_id AND p.book_id=t.book_id AND p.discussion_id=json_extract(t.task_brief_json,'$.discussionId') AND p.run_status IN ('failed','unavailable')))`, todayRange.start, todayRange.end),
      apiCashMicrosToday: numberCell(database, `SELECT COALESCE(SUM(cash_micros),0) AS value FROM usage_ledger WHERE recorded_at>=? AND recorded_at<?`, todayRange.start, todayRange.end),
      activeMembers,
      computeToday: numberCell(database, `SELECT COALESCE(SUM(input_tokens+output_tokens),0)*2 AS value FROM usage_ledger WHERE recorded_at>=? AND recorded_at<?`, todayRange.start, todayRange.end),
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
        JOIN user_accounts a ON a.user_id=m.user_id WHERE a.role='user' AND m.status='active' AND m.period_end>?
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
      COALESCE(SUM(input_tokens+output_tokens),0)*2 AS compute,
      COUNT(*) AS calls FROM usage_ledger WHERE recorded_at>=? GROUP BY day`).all(weekStart) as Array<Record<string, unknown>>;
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
        calls: Number(usage?.calls ?? 0),
        revenueCashMicros: Number(revenue?.revenueCashMicros ?? 0)
      };
    });
    const topUsers = database.prepare(`SELECT a.user_id AS userId,a.display_name AS displayName,a.email_normalized AS email,
      COALESCE(SUM(l.input_tokens+l.output_tokens),0)*2 AS compute,
      COALESCE(SUM(l.cash_micros),0) AS cashMicros,COUNT(l.usage_id) AS calls
      FROM user_accounts a JOIN usage_ledger l ON l.owner_id=a.owner_id
      WHERE l.recorded_at>=? GROUP BY a.user_id ORDER BY compute DESC LIMIT 8`).all(weekStart);
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
        COALESCE(s.active_stage,'setting') AS workflowStage,
        (SELECT plan_number FROM volume_plans v WHERE v.owner_id=b.owner_id AND v.book_id=b.book_id AND v.status<>'archived' ORDER BY plan_number DESC LIMIT 1) AS currentVolume,
        (SELECT sequence_order FROM story_events e WHERE e.owner_id=b.owner_id AND e.book_id=b.book_id AND e.status<>'archived' ORDER BY e.updated_at DESC LIMIT 1) AS currentEvent,
        (SELECT chapter_number FROM chapters c WHERE c.owner_id=b.owner_id AND c.book_id=b.book_id ORDER BY c.chapter_number DESC LIMIT 1) AS currentChapter,
        (SELECT MAX(created_at) FROM manuscript_versions m WHERE m.owner_id=b.owner_id AND m.book_id=b.book_id) AS latestManuscriptAt,
        (SELECT MAX(created_at) FROM stage_settlements x WHERE x.owner_id=b.owner_id AND x.book_id=b.book_id AND x.status='active') AS latestSettlementAt,
        (SELECT task_id FROM tasks t WHERE t.owner_id=b.owner_id AND t.book_id=b.book_id ORDER BY t.updated_at DESC LIMIT 1) AS latestTaskId,
        (SELECT status FROM tasks t WHERE t.owner_id=b.owner_id AND t.book_id=b.book_id ORDER BY t.updated_at DESC LIMIT 1) AS latestTaskStatus,
        (SELECT updated_at FROM tasks t WHERE t.owner_id=b.owner_id AND t.book_id=b.book_id ORDER BY t.updated_at DESC LIMIT 1) AS latestTaskAt
        FROM books b LEFT JOIN core_workflow_states_v6 s ON s.owner_id=b.owner_id AND s.book_id=b.book_id
        WHERE b.owner_id=? AND b.status<>'purged' ORDER BY b.updated_at DESC`).all(ownerId) as Array<Record<string, unknown>>)
        .map((book) => ({ ...book }));
      const tasksToday = numberCell(database, `SELECT COUNT(*) AS value FROM tasks WHERE owner_id=? AND updated_at>=? AND updated_at<?`, ownerId, start, end);
      const failures = (database.prepare(`SELECT t.task_id AS taskId,t.book_id AS bookId,b.title AS bookTitle,t.task_type AS taskType,
        t.current_phase AS workflowNode,t.status,t.error_code AS errorCode,t.updated_at AS occurredAt,
        a.display_name AS memberName,r.display_name AS memberRole,
        COALESCE((SELECT error_class FROM model_calls m WHERE m.task_id=t.task_id AND m.state='failed' ORDER BY m.completed_at DESC LIMIT 1),t.error_code,'任务失败') AS errorSummary,
        COALESCE(json_extract(t.checkpoint_json,'$.recoveryKey'),t.task_id) AS recoveryKey
        FROM tasks t JOIN books b ON b.owner_id=t.owner_id AND b.book_id=t.book_id
        LEFT JOIN agent_instances a ON a.agent_id=t.assigned_agent_id
        LEFT JOIN role_templates r ON r.role_template_id=a.role_template_id AND r.version=a.role_template_version
        WHERE t.owner_id=? AND t.updated_at>=? AND t.updated_at<? AND t.status='failed'
        ORDER BY t.updated_at DESC`).all(ownerId, start, end) as Array<Record<string, unknown>>).map((failure) => ({
          ...failure, frontEndPage: taskPage(String(failure.taskType)), errorSummary: redactSensitive(String(failure.errorSummary ?? '任务失败')),
          retainedResults: numberCell(database, `SELECT COUNT(*) AS value FROM ai_node_batch_members_v6 bm JOIN ai_node_batches_v6 b
            ON b.batch_id=bm.batch_id WHERE b.task_id=? AND bm.status='completed'`, String(failure.taskId)),
          failedSeats: (database.prepare(`SELECT a.display_name AS memberName,s.role_key AS roleKey,bm.failure_message AS error
            FROM ai_node_batch_members_v6 bm JOIN ai_node_batches_v6 b ON b.batch_id=bm.batch_id
            JOIN agent_instances a ON a.agent_id=bm.agent_id JOIN agent_member_settings_v6 s ON s.owner_id=bm.owner_id
              AND s.book_id=bm.book_id AND s.agent_id=bm.agent_id WHERE b.task_id=? AND bm.status IN ('failed','unavailable')`)
            .all(String(failure.taskId)) as Array<Record<string, unknown>>).map((seat) => ({ ...seat, error: redactSensitive(String(seat.error ?? '成员失败')) }))
        }));
      const partialSeatTasks = database.prepare(`SELECT DISTINCT t.task_id AS taskId,t.book_id AS bookId,b.title AS bookTitle,
        t.task_type AS taskType,t.current_phase AS workflowNode,t.status,t.error_code AS errorCode,
        MAX(bm.updated_at) AS occurredAt,COALESCE(json_extract(t.checkpoint_json,'$.recoveryKey'),t.task_id) AS recoveryKey
        FROM ai_node_batch_members_v6 bm JOIN ai_node_batches_v6 batch ON batch.batch_id=bm.batch_id
        JOIN tasks t ON t.task_id=batch.task_id JOIN books b ON b.owner_id=t.owner_id AND b.book_id=t.book_id
        WHERE t.owner_id=? AND bm.updated_at>=? AND bm.updated_at<? AND bm.status IN ('failed','unavailable')
        GROUP BY t.task_id ORDER BY occurredAt DESC`).all(ownerId, start, end) as Array<Record<string, unknown>>;
      for (const partial of partialSeatTasks) {
        if (failures.some((failure) => String((failure as Record<string, unknown>).taskId) === String(partial.taskId))) continue;
        const failedSeats = (database.prepare(`SELECT a.display_name AS memberName,s.role_key AS roleKey,bm.failure_message AS error
          FROM ai_node_batch_members_v6 bm JOIN ai_node_batches_v6 b ON b.batch_id=bm.batch_id
          JOIN agent_instances a ON a.agent_id=bm.agent_id JOIN agent_member_settings_v6 s ON s.owner_id=bm.owner_id
            AND s.book_id=bm.book_id AND s.agent_id=bm.agent_id WHERE b.task_id=? AND bm.status IN ('failed','unavailable')`)
          .all(String(partial.taskId)) as Array<Record<string, unknown>>).map((seat) => ({
            ...seat, error: redactSensitive(String(seat.error ?? '成员失败'))
          }));
        failures.push({ ...partial, frontEndPage: taskPage(String(partial.taskType)),
          errorSummary: '多成员任务有成员失败，其他成功结果已保留', failedSeats,
          retainedResults: numberCell(database, `SELECT COUNT(*) AS value FROM ai_node_batch_members_v6 bm
            JOIN ai_node_batches_v6 b ON b.batch_id=bm.batch_id WHERE b.task_id=? AND bm.status='completed'`, String(partial.taskId)) });
      }
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

  app.get('/api/v1/admin/ai-governance', async (request) => {
    requireAdministrator(request);
    const codeSkills = [coreAgentSkill(), ...allRoleSkills(), ...nodeSkillCatalog()];
    const storedSkills = database.prepare(`SELECT skill_version_id AS skillVersionId,layer,role_key AS roleKey,node_kind AS nodeKind,
      version,content_json AS contentJson,content_hash AS contentHash,status,created_at AS createdAt
      FROM agent_skill_versions_v6 ORDER BY created_at DESC LIMIT 300`).all();
    const templates = database.prepare(`SELECT template_version_id AS templateVersionId,template_key AS templateKey,target_object AS targetObject,
      version,schema_json AS schemaJson,prompt_contract_json AS promptContractJson,content_hash AS contentHash,status,
      rollout_percent AS rolloutPercent,created_at AS createdAt FROM creative_template_versions_v6 ORDER BY created_at DESC LIMIT 200`).all();
    const batches = database.prepare(`SELECT b.batch_id AS batchId,b.book_id AS bookId,k.title AS bookTitle,b.node_kind AS nodeKind,
      b.role_key AS roleKey,b.status,b.context_pack_id AS contextPackId,b.context_pack_hash AS contextPackHash,
      b.core_skill_version_id AS coreSkillVersionId,b.role_skill_version_id AS roleSkillVersionId,
      b.node_protocol_version_id AS nodeSkillVersionId,b.template_version AS templateVersion,
      b.template_version_id AS templateVersionId,b.template_hash AS templateHash,b.created_at AS createdAt,
      COUNT(m.batch_member_id) AS members,COUNT(DISTINCT m.context_pack_hash) AS distinctContextHashes,
      COUNT(DISTINCT m.model_signature_hash) AS distinctModelSignatures
      FROM ai_node_batches_v6 b JOIN books k ON k.owner_id=b.owner_id AND k.book_id=b.book_id
      LEFT JOIN ai_node_batch_members_v6 m ON m.batch_id=b.batch_id GROUP BY b.batch_id ORDER BY b.created_at DESC LIMIT 100`).all();
    const calls = database.prepare(`SELECT c.request_id AS requestId,c.task_id AS taskId,c.book_id AS bookId,b.title AS bookTitle,
      c.agent_id AS agentId,a.display_name AS memberName,c.provider,c.model_id AS modelId,c.context_pack_id AS contextPackId,
      c.state,c.input_tokens AS inputTokens,c.output_tokens AS outputTokens,c.cash_micros AS cashMicros,
      c.duration_ms AS durationMs,c.error_class AS errorClass,c.created_at AS createdAt
      FROM model_calls c JOIN books b ON b.owner_id=c.owner_id AND b.book_id=c.book_id
      JOIN agent_instances a ON a.agent_id=c.agent_id ORDER BY c.created_at DESC LIMIT 100`).all();
    const qualityCounts = database.prepare(`SELECT COUNT(*) AS candidateCount,
      SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS acceptedCount,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejectedCount,
      SUM(CASE WHEN status='observing' THEN 1 ELSE 0 END) AS observingCount,
      SUM(CASE WHEN json_array_length(evidence_refs_json)=0 THEN 1 ELSE 0 END) AS noEvidenceCount
      FROM storyline_growth_candidates_v6`).get() as Record<string, unknown>;
    const duplicateCount = numberCell(database, `SELECT COALESCE(SUM(total-1),0) AS value FROM (
      SELECT COUNT(*) AS total FROM storyline_growth_candidates_v6 GROUP BY book_id,candidate_kind,evidence_hash,title HAVING total>1
    )`);
    const candidateCount = Number(qualityCounts.candidateCount ?? 0);
    const decidedCount = Number(qualityCounts.acceptedCount ?? 0) + Number(qualityCounts.rejectedCount ?? 0)
      + Number(qualityCounts.observingCount ?? 0);
    const storylineQuality = {
      candidateCount, acceptedCount: Number(qualityCounts.acceptedCount ?? 0),
      rejectedCount: Number(qualityCounts.rejectedCount ?? 0), observingCount: Number(qualityCounts.observingCount ?? 0),
      duplicateCount, noEvidenceCount: Number(qualityCounts.noEvidenceCount ?? 0), incorrectFactMixCount: 0,
      adoptionRate: ratio(Number(qualityCounts.acceptedCount ?? 0), decidedCount),
      continueObservingRate: ratio(Number(qualityCounts.observingCount ?? 0), decidedCount),
      duplicateRate: ratio(duplicateCount, candidateCount),
      noEvidenceRate: ratio(Number(qualityCounts.noEvidenceCount ?? 0), candidateCount),
      definitions: {
        adoption: '已采用候选 ÷ 已作决定候选',
        duplicate: '同书、同类型、同证据哈希和同标题的重复候选 ÷ 全部候选',
        noEvidence: '证据引用为空的候选 ÷ 全部候选',
        incorrectFactMix: '候选进入硬事实区的数量；数据库与 ContextCompiler 双门禁下必须为 0'
      }
    };
    const books = database.prepare(`SELECT book_id AS bookId,title FROM books WHERE status<>'purged' ORDER BY updated_at DESC LIMIT 500`).all();
    const actualMembers = database.prepare(`SELECT s.book_id AS bookId,b.title AS bookTitle,s.agent_id AS agentId,
      a.display_name AS displayName,s.role_key AS roleKey,s.enabled,a.activation_state AS activationState,
      s.supplier_company AS supplierCompany,s.base_cost_tier AS costTier,m.provider,m.model_id AS modelId,
      (SELECT bm.status FROM ai_node_batch_members_v6 bm WHERE bm.owner_id=s.owner_id AND bm.book_id=s.book_id
        AND bm.agent_id=s.agent_id ORDER BY bm.updated_at DESC LIMIT 1) AS latestTaskStatus,
      s.updated_at AS updatedAt FROM agent_member_settings_v6 s
      JOIN books b ON b.owner_id=s.owner_id AND b.book_id=s.book_id
      JOIN agent_instances a ON a.agent_id=s.agent_id
      JOIN model_config_snapshots m ON m.model_snapshot_id=a.model_snapshot_id
      WHERE b.status<>'purged' ORDER BY b.updated_at DESC,s.display_order,a.display_name LIMIT 1000`).all();
    return success({
      roster: creativeMemberContracts.map((member) => ({ roleKey: member.roleKey, displayName: member.memberName,
        roleLabel: member.shortTitle, provider: roleModelProfiles[member.roleKey].provider,
        modelId: roleModelProfiles[member.roleKey].modelId, status: 'initial_config' })),
      initialMemberCount: creativeMemberContracts.length, roleCategoryCount: 7, storylineQuality, books, actualMembers, codeSkills, storedSkills, templates, batches, calls
    }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { roleKey?: string; displayName?: string; provider?: string; modelId?: string;
    supplierCompany?: string; costTier?: string } }>('/api/v1/admin/books/:bookId/ai-members', async (request) => {
    requireAdministrator(request);
    const roleKey = String(request.body?.roleKey ?? '');
    if (!['chief_editor','deputy_editor','screenwriter','writer','fact_reviewer','literary_reviewer','experience_reviewer'].includes(roleKey)) throw validation('请选择 7 类岗位之一');
    const displayName = optionalText(request.body?.displayName, 40); const provider = optionalText(request.body?.provider, 100);
    const modelId = optionalText(request.body?.modelId, 160); const supplierCompany = optionalText(request.body?.supplierCompany, 80);
    const costTier = String(request.body?.costTier ?? 'medium');
    if (displayName === null || provider === null || modelId === null || supplierCompany === null) throw validation('成员姓名、供应商、模型和供应公司不能为空');
    if (!['low','medium','high'].includes(costTier)) throw validation('消耗等级不正确');
    const book = database.prepare(`SELECT owner_id FROM books WHERE book_id=? AND status<>'purged'`).get(request.params.bookId) as { owner_id: string } | undefined;
    if (book === undefined) throw new DomainError(errorCodes.validation, '书籍不存在', {}, false, 404);
    const now = new Date().toISOString(); const suffix = randomUUID().replaceAll('-','');
    const roleAlias = `custom_${roleKey}_${suffix.slice(0,12)}`; const templateId = `role-v2-${roleAlias}`;
    const snapshotId = randomUUID(); const agentId = randomUUID();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`INSERT INTO role_templates (role_template_id,version,role_key,display_name,category,responsibilities_json,
        required_capabilities_json,default_activation,created_at) VALUES (?,2,?,?, 'core','[]','["text"]','standby',?)`)
        .run(templateId, roleAlias, roleLabel(roleKey), now);
      database.prepare(`INSERT INTO model_config_snapshots (model_snapshot_id,owner_id,book_id,provider,model_id,parameters_json,
        capabilities_json,validated_at,created_at) VALUES (?,?,?,?,?,'{"plan":"custom","cashFallbackAllowed":false}','["text"]',?,?)`)
        .run(snapshotId, book.owner_id, request.params.bookId, provider, modelId, now, now);
      database.prepare(`INSERT INTO agent_instances (agent_id,owner_id,book_id,role_template_id,role_template_version,display_name,
        model_snapshot_id,permissions_json,enabled,activation_state,created_at,updated_at)
        VALUES (?,?,?,?,2,?,?,'{"bookScoped":true,"tools":[],"network":false}',1,'standby',?,?)`)
        .run(agentId, book.owner_id, request.params.bookId, templateId, displayName, snapshotId, now, now);
      const order = numberCell(database, `SELECT COALESCE(MAX(display_order),0)+1 AS value FROM agent_member_settings_v6 WHERE owner_id=? AND book_id=?`, book.owner_id, request.params.bookId);
      database.prepare(`INSERT INTO agent_member_settings_v6 (owner_id,book_id,agent_id,role_key,enabled,supplier_company,
        base_cost_tier,avatar_key,display_order,revision,updated_at) VALUES (?,?,?,?,1,?,?,?,?,1,?)`)
        .run(book.owner_id, request.params.bookId, agentId, roleKey, supplierCompany, costTier, roleKey, order, now);
      database.exec('COMMIT');
    } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
    return success({ agentId, roleKey, displayName, supplierCompany, costTier, added: true }, request.id);
  });
  app.patch<{ Params: { bookId: string; agentId: string }; Body: { enabled?: boolean; provider?: string; modelId?: string;
    supplierCompany?: string; costTier?: string } }>('/api/v1/admin/books/:bookId/ai-members/:agentId', async (request) => {
    requireAdministrator(request);
    const member = database.prepare(`SELECT s.owner_id AS ownerId,s.enabled,s.supplier_company AS supplierCompany,
      s.base_cost_tier AS costTier,a.display_name AS displayName,a.model_snapshot_id AS modelSnapshotId,
      m.provider,m.model_id AS modelId,m.parameters_json AS parametersJson,m.capabilities_json AS capabilitiesJson
      FROM agent_member_settings_v6 s JOIN agent_instances a ON a.owner_id=s.owner_id AND a.book_id=s.book_id AND a.agent_id=s.agent_id
      JOIN model_config_snapshots m ON m.model_snapshot_id=a.model_snapshot_id
      WHERE s.book_id=? AND s.agent_id=?`).get(request.params.bookId, request.params.agentId) as Record<string, unknown> | undefined;
    if (member === undefined) throw new DomainError(errorCodes.validation, 'AI成员不存在', {}, false, 404);
    if (request.body?.enabled !== undefined && typeof request.body.enabled !== 'boolean') throw validation('成员启停状态不正确');
    const hasProvider = request.body?.provider !== undefined; const hasModel = request.body?.modelId !== undefined;
    if (hasProvider !== hasModel) throw validation('改绑时必须同时填写供应商和模型');
    const provider = hasProvider ? optionalText(request.body.provider, 100) : String(member.provider);
    const modelId = hasModel ? optionalText(request.body.modelId, 160) : String(member.modelId);
    const supplierCompany = request.body?.supplierCompany === undefined ? String(member.supplierCompany)
      : optionalText(request.body.supplierCompany, 80);
    const costTier = request.body?.costTier === undefined ? String(member.costTier) : String(request.body.costTier);
    if (provider === null || modelId === null || supplierCompany === null) throw validation('供应商、模型和供应公司不能为空');
    if (!['low','medium','high'].includes(costTier)) throw validation('消耗等级不正确');
    const enabled = request.body?.enabled === undefined ? Number(member.enabled) === 1 : request.body.enabled;
    const bindingChanged = provider !== String(member.provider) || modelId !== String(member.modelId);
    const now = new Date().toISOString(); const nextSnapshotId = bindingChanged ? randomUUID() : String(member.modelSnapshotId);
    database.exec('BEGIN IMMEDIATE');
    try {
      if (bindingChanged) database.prepare(`INSERT INTO model_config_snapshots (model_snapshot_id,owner_id,book_id,provider,model_id,
        parameters_json,capabilities_json,validated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(nextSnapshotId,
          String(member.ownerId), request.params.bookId, provider, modelId, String(member.parametersJson),
          String(member.capabilitiesJson), now, now);
      database.prepare(`UPDATE agent_instances SET model_snapshot_id=?,enabled=?,activation_state=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND agent_id=?`).run(nextSnapshotId, enabled ? 1 : 0, enabled ? 'standby' : 'disabled',
          now, String(member.ownerId), request.params.bookId, request.params.agentId);
      database.prepare(`UPDATE agent_member_settings_v6 SET enabled=?,supplier_company=?,base_cost_tier=?,revision=revision+1,updated_at=?
        WHERE owner_id=? AND book_id=? AND agent_id=?`).run(enabled ? 1 : 0, supplierCompany, costTier, now,
          String(member.ownerId), request.params.bookId, request.params.agentId);
      database.exec('COMMIT');
    } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
    return success({ agentId: request.params.agentId, displayName: member.displayName, enabled, supplierCompany, costTier,
      provider, modelId, bindingChanged, appliesTo: 'future_tasks_only' }, request.id);
  });

  app.post<{ Params: { templateKey: string }; Body: { targetObject?: string; schema?: Record<string, unknown>;
    promptContract?: Record<string, unknown>; rolloutPercent?: number } }>('/api/v1/admin/creative-templates/:templateKey/versions', async (request) => {
    requireAdministrator(request);
    const templateKey = normalizeTemplateKey(request.params.templateKey);
    const targetObject = optionalText(request.body?.targetObject, 120);
    if (targetObject === null || !objectRecord(request.body?.schema) || !objectRecord(request.body?.promptContract)) {
      throw validation('模板目标、schema 和提示合同不能为空');
    }
    const rolloutPercent = normalizeRollout(request.body?.rolloutPercent);
    const schemaJson = JSON.stringify(request.body.schema); const promptContractJson = JSON.stringify(request.body.promptContract);
    const contentHash = hashStableContractContent({ schema: request.body.schema, promptContract: request.body.promptContract })
      .slice('sha256:'.length);
    const version = numberCell(database, 'SELECT COALESCE(MAX(version),0)+1 AS value FROM creative_template_versions_v6 WHERE template_key=?', templateKey);
    const templateVersionId = `template-admin:${templateKey}:v${version}:${randomUUID().replaceAll('-','').slice(0,8)}`;
    const now = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare("UPDATE creative_template_versions_v6 SET status='superseded' WHERE template_key=? AND status='active'").run(templateKey);
      database.prepare(`INSERT INTO creative_template_versions_v6 (template_version_id,template_key,target_object,version,
        schema_json,prompt_contract_json,content_hash,status,rollout_percent,created_at) VALUES (?,?,?,?,?,?,?,'active',?,?)`)
        .run(templateVersionId, templateKey, targetObject, version, schemaJson, promptContractJson, contentHash, rolloutPercent, now);
      database.exec('COMMIT');
    } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
    return success({ templateVersionId, templateKey, targetObject, version, contentHash, status: 'active', rolloutPercent,
      appliesTo: 'future_tasks_by_stable_cohort' }, request.id);
  });

  app.post<{ Params: { templateVersionId: string }; Body: { rolloutPercent?: number } }>(
    '/api/v1/admin/creative-templates/:templateVersionId/activate', async (request) => {
      requireAdministrator(request);
      const target = database.prepare(`SELECT template_key AS templateKey FROM creative_template_versions_v6 WHERE template_version_id=?`)
        .get(request.params.templateVersionId) as { templateKey: string } | undefined;
      if (target === undefined) throw new DomainError(errorCodes.validation, '创作模板版本不存在', {}, false, 404);
      const rolloutPercent = normalizeRollout(request.body?.rolloutPercent);
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare("UPDATE creative_template_versions_v6 SET status='superseded' WHERE template_key=? AND status='active'").run(target.templateKey);
        database.prepare("UPDATE creative_template_versions_v6 SET status='active',rollout_percent=? WHERE template_version_id=?")
          .run(rolloutPercent, request.params.templateVersionId);
        database.exec('COMMIT');
      } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
      return success({ templateVersionId: request.params.templateVersionId, templateKey: target.templateKey,
        status: 'active', rolloutPercent, appliesTo: 'future_tasks_by_stable_cohort' }, request.id);
    }
  );

  app.patch<{ Params: { templateVersionId: string }; Body: { rolloutPercent?: number } }>(
    '/api/v1/admin/creative-templates/:templateVersionId/rollout', async (request) => {
      requireAdministrator(request);
      const rolloutPercent = normalizeRollout(request.body?.rolloutPercent);
      const result = database.prepare(`UPDATE creative_template_versions_v6 SET rollout_percent=?
        WHERE template_version_id=? AND status='active'`).run(rolloutPercent, request.params.templateVersionId);
      if (result.changes !== 1) throw new DomainError(errorCodes.validation, '只有当前启用模板可以调整灰度', {}, false, 409);
      return success({ templateVersionId: request.params.templateVersionId, rolloutPercent,
        appliesTo: 'future_tasks_by_stable_cohort' }, request.id);
    }
  );
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

function roleLabel(roleKey: string): string {
  return ({
    chief_editor: '主编', deputy_editor: '副编', screenwriter: '编剧', writer: '主笔',
    fact_reviewer: '事实审查席', literary_reviewer: '文学审查席', experience_reviewer: '体验审查席'
  } as Record<string, string>)[roleKey] ?? roleKey;
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

function normalizeTemplateKey(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/u.test(normalized)) throw validation('模板标识只允许小写字母、数字、连字符和下划线');
  return normalized;
}
function normalizeRollout(value: unknown): number {
  const rollout = value === undefined ? 100 : Number(value);
  if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) throw validation('灰度比例必须是0到100的整数');
  return rollout;
}
function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validation(message: string): DomainError {
  return new DomainError(errorCodes.validation, message, {}, false, 400);
}
