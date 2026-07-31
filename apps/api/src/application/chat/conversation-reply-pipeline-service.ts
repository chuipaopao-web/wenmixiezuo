import type { DatabaseSync } from 'node:sqlite';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { RoleKey } from '../../domain/roles.js';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../infrastructure/models/model-runtime-config.js';
import {
  createEffectiveOutputReference,
  EFFECTIVE_OUTPUT_CONTRACT,
  prepareEffectiveOutput
} from './effective-output-service.js';
import { HybridRetrievalService } from '../memory/hybrid-retrieval-service.js';
import { RetrievalContextSourceService } from '../memory/retrieval-context-source-service.js';
import { RetrievalOrchestrationRepository } from '../../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';
import { ChunkSnapshotRepository } from '../../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { createHash } from 'node:crypto';
import { EditorLeaseService } from '../editors/editor-lease-service.js';
import { CreativeSessionService } from '../discussions/creative-session-service.js';
import { CreativeSessionRepository } from '../../infrastructure/db/repositories/creative-session-repository.js';
import { ArtifactService } from '../artifacts/artifact-service.js';
import {
  publicRoleTitle,
  renderModelContextContent,
  renderSettingOutlineContext,
  toAuthorModelContextSources
} from './author-conversation-presentation.js';

interface ReplyTaskRow {
  status: string;
  lease_owner: string | null;
  task_brief_json: string;
  cancel_requested: number;
  assigned_agent_id: string | null;
}

function clipContextSource(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 24)}……（完整内容保留在来源记录中）`;
}

interface ReplyAgentRow {
  agent_id: string;
  display_name: string;
  role_key: RoleKey | CreativeRoleKey;
  model_snapshot_id: string;
  provider: string;
  model_id: string;
}

export class ConversationReplyPipelineService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory = new ModelAdapterFactory(loadModelRuntimeConfig({})),
    private readonly retrieval: HybridRetrievalService = new HybridRetrievalService(
      new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
      new ChunkSnapshotRepository(database), ids, clock
    )
  ) {}

  public async executeClaimed(scope: BookScope, taskId: string, workerId: string, leaseFence?: TaskLeaseFence): Promise<{ messageId: string }> {
    assertBookScope(scope);
    const task = this.database.prepare(`
      SELECT status, lease_owner, task_brief_json, cancel_requested, assigned_agent_id FROM tasks
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND task_type = 'conversation_reply'
    `).get(taskId, scope.ownerId, scope.bookId) as ReplyTaskRow | undefined;
    const currentTask = new TaskService(this.database, this.releaseId, this.clock).require(scope, taskId);
    if (task === undefined || task.status !== 'working' || task.lease_owner !== workerId || task.assigned_agent_id === null
      || (leaseFence !== undefined && (currentTask.leaseToken !== leaseFence.leaseToken || currentTask.currentAttemptNo !== leaseFence.attemptNo))) {
      throw new Error('对话回复任务未由指定Worker持有');
    }
    try {
      const brief = JSON.parse(task.task_brief_json) as {
        conversationId: string;
        messageId: string;
        content: string;
        modelSnapshotId?: string;
        directNamedMember?: boolean;
        requestedMemberName?: string;
        proactiveOnboarding?: boolean;
        openingBlueprintId?: string | null;
        creativeSessionId?: string;
        creativeBlackboardRevision?: number;
        creativeSessionAction?: 'continue_discussion';
      };
      const replyAgent = this.database.prepare(`
        SELECT a.agent_id, a.display_name, r.role_key, m.model_snapshot_id, m.provider, m.model_id
        FROM agent_instances a
        JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
        JOIN model_config_snapshots m ON m.model_snapshot_id = COALESCE(?, a.model_snapshot_id)
        WHERE a.agent_id = ? AND a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
      `).get(brief.modelSnapshotId ?? null, task.assigned_agent_id, scope.ownerId, scope.bookId) as ReplyAgentRow | undefined;
      if (replyAgent === undefined) throw new Error('回复成员或其模型快照不存在');
      if (brief.directNamedMember === true && brief.requestedMemberName !== replyAgent.display_name) {
        throw new Error('点名成员与任务实际分配成员不一致');
      }
      const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
        .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
      const targetMessage = this.database.prepare(`
        SELECT rowid AS row_id, created_at FROM messages
        WHERE message_id = ? AND conversation_id = ? AND owner_id = ? AND book_id = ?
      `).get(brief.messageId, brief.conversationId, scope.ownerId, scope.bookId) as { row_id: number; created_at: string } | undefined;
      if (targetMessage === undefined) throw new Error('待回复的老板消息不存在或越权');
      const history = this.database.prepare(`
        SELECT sender_type, role_key, content, created_at FROM messages
        WHERE conversation_id = ? AND owner_id = ? AND book_id = ? AND rowid < ?
          AND message_type <> 'onboarding_trigger'
        ORDER BY rowid DESC LIMIT 6
      `).all(brief.conversationId, scope.ownerId, scope.bookId, targetMessage.row_id) as unknown as Array<Record<string, unknown>>;
      history.reverse();
      const storyBible = this.database.prepare(`
        SELECT v.artifact_version_id, v.content_json FROM artifacts a
        JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
        WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'story_bible'
        ORDER BY a.created_at LIMIT 1
      `).get(scope.ownerId, scope.bookId) as { artifact_version_id: string; content_json: string } | undefined;
      const decisions = this.database.prepare(`
        SELECT d.decision_id, x.scope_text, d.recommendation_json FROM discussion_decisions d
        JOIN discussions x ON x.discussion_id = d.discussion_id
        WHERE d.owner_id = ? AND d.book_id = ? AND d.boss_confirmed = 1
        ORDER BY d.confirmed_at DESC LIMIT 3
      `).all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, unknown>>;
      const hardSources: ContextSource[] = [{
        sourceType: brief.proactiveOnboarding === true ? 'onboarding_trigger' : 'boss_message',
        sourceId: brief.messageId, content: brief.content,
        reason: brief.proactiveOnboarding === true ? '建书后主动引导合同' : '当前需要回复的老板消息', priority: 100
      }];
      if (brief.creativeSessionId !== undefined) {
        const sessionRepository = new CreativeSessionRepository(this.database);
        const blackboard = sessionRepository.blackboard(
          scope,
          brief.creativeSessionId,
          brief.creativeBlackboardRevision
        );
        if (blackboard === null) throw new Error('持续创作会话缺少可追溯共享黑板');
        hardSources.push({
          sourceType: 'creative_blackboard',
          sourceId: `${brief.creativeSessionId}:${blackboard.revision}`,
          content: clipContextSource(JSON.stringify(blackboard.payload), 2_400),
          reason: '当前持续创作会话的议题、候选方向、分歧、未知项和下一步；不是正史',
          priority: 100,
          version: blackboard.revision
        });
      }
      if (brief.proactiveOnboarding === true) {
        if (brief.openingBlueprintId === undefined) throw new Error('主动开场任务缺少开书资料引用字段');
        if (typeof brief.openingBlueprintId === 'string') {
          const openingBlueprint = this.database.prepare(`
            SELECT blueprint_json FROM book_opening_blueprints
            WHERE opening_blueprint_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
          `).get(brief.openingBlueprintId, scope.ownerId, scope.bookId) as { blueprint_json: string } | undefined;
          if (openingBlueprint === undefined) throw new Error('主动开场引用的完整开书资料不存在或越权');
          hardSources.push({
            sourceType: 'opening_blueprint', sourceId: brief.openingBlueprintId,
            content: openingBlueprint.blueprint_json,
            reason: '老板确认提交的完整开书规划参考；必须用于本次主编主动开场', priority: 100
          });
        }
      }
      const retrieved = brief.proactiveOnboarding === true
        ? { hardSources: [], optionalSources: [] }
        : await new RetrievalContextSourceService(this.retrieval).collect(scope, {
          query: brief.content,
          roleKey: replyAgent.role_key,
          mode: 'open_discussion',
          canonRevision: book.canon_revision,
          taskId,
          sourceTypes: ['fact', 'manuscript', 'outline', 'setting', 'wiki', 'voice'],
          limit: 6
        });
      hardSources.push(...retrieved.hardSources);
      const optionalSources: ContextSource[] = [
        ...retrieved.optionalSources,
        ...(storyBible === undefined || brief.proactiveOnboarding === true ? [] : [{
          sourceType: 'story_bible', sourceId: storyBible.artifact_version_id,
          content: renderSettingOutlineContext(storyBible.content_json, 1_500),
          reason: '当前设定大纲；它是可修订的规划参考，不是正史', priority: 90
        }]),
        ...(history.length === 0 ? [] : [{
          sourceType: 'recent_conversation',
          sourceId: `history:${brief.messageId}`,
          content: renderModelContextContent('recent_conversation', JSON.stringify(history), 1_800),
          reason: '仅限本次回复的最近6条对话窗口；完整原文仍归档但默认不注入',
          priority: 70
        }]),
        ...(decisions.length === 0 ? [] : [{
          sourceType: 'confirmed_decisions',
          sourceId: `decisions:${scope.bookId}`,
          content: renderModelContextContent('confirmed_decisions', JSON.stringify(decisions), 1_200),
          reason: '老板已经确认的最近创作决定',
          priority: 80
        }])
      ];
      const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
        taskId,
        agentId: replyAgent.agent_id,
        canonRevision: book.canon_revision,
        positioningVersion: book.positioning_version,
        tokenBudget: brief.proactiveOnboarding === true ? 12_000 : 7_000,
        characterBudget: brief.proactiveOnboarding === true ? 12_000 : 7_000,
        policyVersion: brief.proactiveOnboarding === true
          ? 'onboarding-editor-context-v2-12000chars'
          : 'creative-editor-context-v2-7000chars',
        hardSources,
        optionalSources
      });
      const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
        .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
      if (budget === undefined) throw new Error('当前书籍没有活动预算');
      const prompt = JSON.stringify({
        operation: '主创对话回复',
        identity: `${replyAgent.display_name}（${publicRoleTitle(replyAgent.role_key)}）`,
        rules: [
          '直接回应老板，不要声称其他成员已经回复或已完成未执行的工作',
          brief.directNamedMember === true ? '老板明确点名了你；只以自己的岗位身份回答，不转交给主编代答' : '你是当前活动主编，负责回应并判断下一步',
          '如果创作资料不足，指出缺口并提出一至三个具体问题',
          '不要在没有确认方案和章纲时直接创作正文',
          ...(brief.proactiveOnboarding === true ? [
            '这是建书后的主动开场，不要声称老板刚刚发送了这条内部触发指令',
            '先简短区分已知、待讨论和可能冲突，再只问一至三个最高价值问题',
            '不得复述完整开书表单，不得启动主笔或生成小说正文',
            '这是第一次接待，不做竞品举例、长篇标签分析或完整方案推演；alternatives必须为空数组，risks最多两条，keyPoints最多三条，questions一至三条',
            'answer、keyPoints、risks、questions和nextStep合计不超过600个中文字符；details只写一句补充或留空，必须在输出上限内闭合JSON'
          ] : [
            'answer、keyPoints、alternatives、risks、questions和nextStep合计不超过1200个中文字符；details最多300个中文字符',
            '优先保证JSON完整闭合；临近输出上限时省略次要细节，不得截断在字符串、数组或对象中'
          ]),
          '回答使用自然中文，可讨论但不得把闲聊写入正史',
          '作者界面只使用“本书资料、设定大纲、剧情总纲、章纲”等当前产品名称；后台字段名、资料编号和校验值只用于内部追溯，不得写进回复',
          '开书资料和未定稿设定属于可修订的规划参考；与老板新说明不同时称为“规划差异”，没有正式正史证据时不得声称发生“正史冲突”',
          '删除开场客套、自我介绍、过程说明和重复结论；只保留直接回答、关键依据、风险或未知、必要问题与下一步'
        ],
        outputContract: EFFECTIVE_OUTPUT_CONTRACT,
        currentMessage: brief.proactiveOnboarding === true ? '建书完成，请主动引导下一步创作讨论。' : brief.content,
        contextSources: toAuthorModelContextSources(pack.sources)
      });
      const budgets = new BudgetService(this.database, this.ids, this.clock);
      const adapter = this.modelAdapters.resolve(replyAgent.provider, replyAgent.model_id, 'discussion', replyAgent.role_key);
      const inputHash = createHash('sha256').update(prompt).digest('hex');
      const reusable = this.database.prepare(`SELECT r.output_text, r.input_tokens, r.output_tokens, r.cash_micros
        FROM model_calls m JOIN model_call_results r ON r.request_id = m.request_id
        WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ? AND m.agent_id = ?
          AND m.model_snapshot_id = ? AND m.input_hash = ? AND m.phase_key LIKE ? AND m.state = 'succeeded'
        ORDER BY m.completed_at DESC LIMIT 1`)
        .get(scope.ownerId, scope.bookId, taskId, replyAgent.agent_id, replyAgent.model_snapshot_id,
          inputHash, `reply:${replyAgent.role_key}:attempt-%`) as {
            output_text: string; input_tokens: number; output_tokens: number; cash_micros: number;
          } | undefined;
      let result = reusable === undefined ? undefined : {
        provider: replyAgent.provider,
        modelId: replyAgent.model_id,
        output: reusable.output_text,
        inputTokens: reusable.input_tokens,
        outputTokens: reusable.output_tokens,
        cashCostCny: reusable.cash_micros / 1_000_000,
        state: 'succeeded' as const
      };
      let lastError: unknown;
      const calls = new ModelCallService(this.database, this.clock, budgets);
      for (let technicalTry = 1; result === undefined && technicalTry <= 2; technicalTry += 1) {
        const requestId = this.ids.next();
        const reservationId = budgets.reserve(scope, budget.budget_id, requestId,
          adapter.provider === 'openai-codex-subscription' ? 30_000 : 8_000, 0);
        try {
          result = await calls.execute(scope, {
            requestId,
            taskId,
            phaseKey: `reply:${replyAgent.role_key}:attempt-${currentTask.currentAttemptNo}:try-${technicalTry}`,
            agentId: replyAgent.agent_id,
            modelSnapshotId: replyAgent.model_snapshot_id,
            provider: replyAgent.provider,
            modelId: replyAgent.model_id,
            input: prompt,
            parameters: JSON.stringify({ maxOutputTokens: 2_000, planOnly: !replyAgent.provider.startsWith('local-deterministic'), cashFallbackAllowed: false }),
            reservationId,
            contextPackId: pack.contextPackId,
            leaseToken: leaseFence?.leaseToken ?? currentTask.leaseToken,
            attemptNo: leaseFence?.attemptNo ?? currentTask.currentAttemptNo
          }, adapter, {
            requestId,
            taskId,
            ownerId: scope.ownerId,
            bookId: scope.bookId,
            agentId: replyAgent.agent_id,
            prompt,
            maxOutputTokens: 2_000
          });
        } catch (error) {
          lastError = error;
          const call = this.database.prepare(`SELECT state, error_class FROM model_calls
            WHERE request_id = ? AND owner_id = ? AND book_id = ?`)
            .get(requestId, scope.ownerId, scope.bookId) as { state: string; error_class: string | null } | undefined;
          const providerResultUnknown = call?.state === 'interrupted' && call.error_class === 'provider_result_unknown';
          if (providerResultUnknown) {
            const canTakeOverEditor = brief.directNamedMember !== true
              && ['chief_editor', 'deputy_editor'].includes(replyAgent.role_key);
            if (canTakeOverEditor) {
              const takeover = new EditorLeaseService(this.database, this.ids, this.clock)
                .tryAutomaticTakeover(scope, replyAgent.agent_id);
              throw new Error(takeover.takenOver
                ? `活动主编调用结果未知，已由${takeover.activeEditorAgentId}接管并从原对话任务恢复`
                : `活动主编调用结果未知且未能安全接管：${takeover.reason}`);
            }
            throw error;
          }
          const retryable = call?.state === 'failed' && call.error_class === 'technical_failure';
          if (!retryable) throw error;
          if (technicalTry === 2) {
            const canTakeOverEditor = brief.directNamedMember !== true
              && ['chief_editor', 'deputy_editor'].includes(replyAgent.role_key);
            if (canTakeOverEditor) {
              const takeover = new EditorLeaseService(this.database, this.ids, this.clock)
                .tryAutomaticTakeover(scope, replyAgent.agent_id);
              throw new Error(takeover.takenOver
                ? `活动主编连续技术失败，已由${takeover.activeEditorAgentId}接管并从对话检查点恢复`
                : `活动主编连续技术失败且未能安全接管：${takeover.reason}`);
            }
            throw error;
          }
        }
      }
      if (result === undefined) throw lastError instanceof Error ? lastError : new Error('对话模型调用失败');
      const effective = prepareEffectiveOutput(result.output);
      const references: unknown[] = [{ replyToMessageId: brief.messageId, contextPackId: pack.contextPackId }];
      const effectiveReference = createEffectiveOutputReference(effective);
      if (effectiveReference !== null) references.push(effectiveReference);
      const messageId = this.ids.next();
      this.database.prepare(`
        INSERT INTO messages (
          message_id, conversation_id, owner_id, book_id, sender_type, sender_agent_id,
          role_key, model_provider, model_id, message_type, content, references_json, created_at
        ) VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?, 'conversation_reply', ?, ?, ?)
      `).run(
        messageId, brief.conversationId, scope.ownerId, scope.bookId, replyAgent.agent_id,
        replyAgent.role_key, result.provider, result.modelId, effective.visibleContent,
        JSON.stringify(references), this.clock.now().toISOString()
      );
      if (brief.creativeSessionId !== undefined) {
        new CreativeSessionService(this.database, this.ids, this.clock).appendEditorReply(scope, {
          sessionId: brief.creativeSessionId,
          messageId,
          content: effective.visibleContent
        });
      }
      if (isSettingIntake(brief.content, replyAgent.role_key)) {
        saveSettingCandidate(this.database, this.ids, this.clock, scope, brief.messageId, effective.visibleContent);
      }
      new TaskService(this.database, this.releaseId, this.clock).complete(scope, taskId, workerId, leaseFence);
      return { messageId };
    } catch (error) {
      const now = this.clock.now().toISOString();
      const cancelled = (this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ?`).get(taskId) as { cancel_requested: number }).cancel_requested === 1;
      const failure = this.database.prepare(`
        UPDATE tasks SET status = ?, error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
          lease_token = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ? AND status = 'working'
          AND lease_expires_at > ? AND (? IS NULL OR (lease_token = ? AND current_attempt_no = ?))
          AND (required_editor_epoch = 0 OR required_editor_epoch = (
            SELECT editor_epoch FROM books WHERE owner_id = ? AND book_id = ?
          ))
      `).run(cancelled ? 'cancelled' : 'failed', cancelled ? 'TASK_CANCELLED' : 'CONVERSATION_REPLY_FAILED', now,
        taskId, scope.ownerId, scope.bookId, workerId, now, leaseFence?.leaseToken ?? null,
        leaseFence?.leaseToken ?? null, leaseFence?.attemptNo ?? 0, scope.ownerId, scope.bookId);
      if (failure.changes !== 1) throw error;
      this.database.prepare(`
        UPDATE task_attempts SET status = ?, error_code = ?, completed_at = ?
        WHERE owner_id = ? AND book_id = ? AND task_id = ? AND attempt_no = ? AND status = 'working'
      `).run(cancelled ? 'cancelled' : 'failed', cancelled ? 'TASK_CANCELLED' : 'CONVERSATION_REPLY_FAILED', now,
        scope.ownerId, scope.bookId, taskId, leaseFence?.attemptNo ?? currentTask.currentAttemptNo);
      throw error;
    }
  }
}

function isSettingIntake(content: string, roleKey: RoleKey | CreativeRoleKey): boolean {
  if (!['setting', 'continuity'].includes(roleKey)) return false;
  const normalized = content.replace(/\s+/gu, ' ').trim();
  const explicitRequest = /(?:拆解|整理|归类|录入|填写|更新|同步).{0,18}(?:大纲|设定|资料|方案|规则|人物|世界观)|(?:大纲|设定|资料|方案).{0,18}(?:拆解|整理|归类|录入|填写|更新|同步)/u.test(normalized);
  const planningSubmission = /请把下面资料拆解为本书的通用设定候选|请拆解下面这份设定资料/u.test(normalized);
  const structuredSource = normalized.length >= 500
    && /(?:^|[。；;])(?:世界观|人物设定|角色设定|力量体系|剧情大纲|故事大纲|基本设定|规则设定)[:：]/u.test(normalized);
  return explicitRequest || planningSubmission || structuredSource;
}

function saveSettingCandidate(
  database: DatabaseSync,
  ids: IdGenerator,
  clock: Clock,
  scope: BookScope,
  sourceMessageId: string,
  analysis: string
): void {
  const duplicate = database.prepare(`
    SELECT 1 FROM artifact_versions
    WHERE owner_id = ? AND book_id = ? AND content_json LIKE ? LIMIT 1
  `).get(scope.ownerId, scope.bookId, `%"sourceMessageId":"${sourceMessageId}"%`);
  if (duplicate !== undefined) return;
  const artifact = database.prepare(`
    SELECT a.artifact_id, a.active_version_id, v.content_json
    FROM artifacts a
    JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
    WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'story_bible'
    LIMIT 1
  `).get(scope.ownerId, scope.bookId) as { artifact_id: string; active_version_id: string; content_json: string } | undefined;
  if (artifact === undefined) throw new Error('设定拆解无法找到设定大纲');
  const content = JSON.parse(artifact.content_json) as Record<string, unknown>;
  const current = Array.isArray(content.settingCandidates) ? content.settingCandidates : [];
  new ArtifactService(database, ids, clock).addVersion(scope, artifact.artifact_id, {
    ...content,
    settingCandidates: [...current, {
      sourceMessageId,
      sourceKind: 'owner_material',
      status: 'candidate',
      analysis,
      notice: '由文姬根据老板原文拆解；普通讨论不会自动写入，确认前不覆盖正式设定'
    }]
  }, artifact.active_version_id);
}
