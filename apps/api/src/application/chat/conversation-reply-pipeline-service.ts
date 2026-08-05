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
import {
  SettingGuidanceService,
  type SettingGuidanceSnapshot
} from '../knowledge/setting-guidance-service.js';

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
        settingGuidance?: SettingGuidanceSnapshot;
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
      const continuationBaseline = this.database.prepare(`
        SELECT baseline_id, continuation_import_id, summary_text, structured_json,
          analyzed_chapter_count, total_chapter_count, canon_revision
        FROM continuation_baselines
        WHERE owner_id = ? AND book_id = ? AND status = 'ready'
        ORDER BY completed_at DESC, updated_at DESC LIMIT 1
      `).get(scope.ownerId, scope.bookId) as {
        baseline_id: string;
        continuation_import_id: string;
        summary_text: string | null;
        structured_json: string;
        analyzed_chapter_count: number;
        total_chapter_count: number;
        canon_revision: number;
      } | undefined;
      const hardSources: ContextSource[] = [{
        sourceType: brief.proactiveOnboarding === true ? 'onboarding_trigger' : 'boss_message',
        sourceId: brief.messageId,
        content: brief.settingGuidance === undefined ? brief.content : clipContextSource(brief.content, 1_200),
        reason: brief.proactiveOnboarding === true ? '建书后主动引导合同' : '当前需要回复的老板消息', priority: 100
      }];
      const settingProposalCollection = brief.settingGuidance !== undefined
        && (brief.settingGuidance.proposalOptions?.length ?? 0) > 0;
      if (continuationBaseline !== undefined && !settingProposalCollection) {
        hardSources.push({
          sourceType: 'continuation_baseline',
          sourceId: continuationBaseline.baseline_id,
          content: brief.settingGuidance === undefined
            ? clipContextSource(JSON.stringify({
              authority: 'derived_from_confirmed_manuscript',
              originalManuscriptRemainsAuthoritative: true,
              analyzedChapters: continuationBaseline.analyzed_chapter_count,
              totalChapters: continuationBaseline.total_chapter_count,
              canonRevision: continuationBaseline.canon_revision,
              summary: continuationBaseline.summary_text,
              data: JSON.parse(continuationBaseline.structured_json) as unknown
            }), 4_800)
            : compactContinuationSettingSource(continuationBaseline),
          reason: brief.settingGuidance === undefined
            ? '已有正文逐章提炼的续写基线；用于理解当前人物、事件、规则和未结事项，冲突时以正文原文为准'
            : '已有正文反向章纲的最小摘录；只用于整理当前设定项，冲突时以正文原文为准',
          priority: 100,
          version: continuationBaseline.canon_revision
        });
      }
      if (brief.settingGuidance !== undefined) {
        const compactSettingGuidance = compactSettingGuidanceSource(brief.settingGuidance);
        hardSources.push({
          sourceType: 'setting_guidance',
          sourceId: `setting:${brief.settingGuidance.itemKey}`,
          content: JSON.stringify(compactSettingGuidance),
          reason: '本轮唯一允许处理的设定项、最小开书定位和最多三项已确认依赖',
          priority: 100
        });
      }
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
      if (brief.proactiveOnboarding === true && brief.settingGuidance === undefined) {
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
      const retrieved = brief.proactiveOnboarding === true || brief.settingGuidance !== undefined
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
        ...(storyBible === undefined || brief.proactiveOnboarding === true || brief.settingGuidance !== undefined ? [] : [{
          sourceType: 'story_bible', sourceId: storyBible.artifact_version_id,
          content: renderSettingOutlineContext(storyBible.content_json, 1_500),
          reason: '当前设定大纲；它是可修订的规划参考，不是正史', priority: 90
        }]),
        ...(history.length === 0 || brief.settingGuidance !== undefined ? [] : [{
          sourceType: 'recent_conversation',
          sourceId: `history:${brief.messageId}`,
          content: renderModelContextContent('recent_conversation', JSON.stringify(history), 1_800),
          reason: '仅限本次回复的最近6条对话窗口；完整原文仍归档但默认不注入',
          priority: 70
        }]),
        ...(decisions.length === 0 || brief.settingGuidance !== undefined ? [] : [{
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
        tokenBudget: brief.settingGuidance !== undefined ? 4_500 : brief.proactiveOnboarding === true ? 12_000 : 7_000,
        characterBudget: brief.settingGuidance !== undefined ? 4_500 : brief.proactiveOnboarding === true ? 12_000 : 7_000,
        policyVersion: brief.settingGuidance !== undefined
          ? 'setting-guidance-v2-4500chars'
          : brief.proactiveOnboarding === true
            ? 'onboarding-editor-context-v2-12000chars'
            : 'creative-editor-context-v2-7000chars',
        hardSources,
        optionalSources
      });
      const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
        .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
      if (budget === undefined) throw new Error('当前书籍没有活动预算');
      const prompt = JSON.stringify({
        operation: brief.settingGuidance === undefined ? '主创对话回复' : '设定大纲逐项引导',
        identity: `${replyAgent.display_name}（${publicRoleTitle(replyAgent.role_key)}）`,
        rules: [
          '直接回应老板，不要声称其他成员已经回复或已完成未执行的工作',
          brief.directNamedMember === true ? '老板明确点名了你；只以自己的岗位身份回答，不转交给主编代答' : '你是当前活动主编，负责回应并判断下一步',
          brief.settingGuidance !== undefined
            ? '是否提问、提几个问题严格服从当前设定项的专用规则'
            : '如果创作资料不足，指出缺口并提出一至三个具体问题',
          '不要在没有确认方案和章纲时直接创作正文',
          ...(brief.settingGuidance === undefined ? [] : settingGuidanceRules(brief.settingGuidance)),
          ...(brief.proactiveOnboarding === true && brief.settingGuidance === undefined ? [
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
        ...(brief.settingGuidance === undefined
          ? {}
          : { settingGuidance: compactSettingGuidanceSource(brief.settingGuidance) }),
        currentMessage: brief.settingGuidance !== undefined
          ? brief.settingGuidance.phase === 'ask'
            ? `请开始询问当前设定项“${brief.settingGuidance.label}”。`
            : brief.content
          : brief.proactiveOnboarding === true ? '建书完成，请主动引导下一步创作讨论。' : brief.content,
        // Keep setting_guidance in the persisted source manifest for traceability,
        // but render it only once through the typed settingGuidance field above.
        contextSources: toAuthorModelContextSources(
          pack.sources.filter((source) => source.sourceType !== 'setting_guidance')
        )
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
      if (brief.settingGuidance !== undefined) {
        new SettingGuidanceService(this.database, this.ids, this.clock)
          .recordCandidate(scope, brief.settingGuidance.itemKey, result.output);
      }
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

function settingGuidanceRules(guidance: SettingGuidanceSnapshot): string[] {
  const artifactRule = `必须在JSON根对象增加workflowArtifact字段：{"type":"setting_outline","payload":{"items":[{"itemKey":"${guidance.itemKey}","content":"一个可直接确认的本项设定候选"}]}}`;
  const common = [
    `本轮唯一允许处理的设定项是“${guidance.label}”（${guidance.requiredIndex}/${guidance.requiredCount}）；不得跳到其他设定项`,
    '开书剧情简介只是软参考，不得把它当成已经确定的剧情，不得围绕它追问具体剧情走向',
    '不得启动编剧、剧情总纲、章纲或正文；不得一次列出后续全部问题',
    '只使用当前设定项、最多三项已确认依赖和最小作品定位；没有注入的资料不要自行补全',
    '回答要像真人主编，简短、清楚、只保留对作者有用的信息',
    '若上文已有主编和两名编剧的三份独立提案，只能按老板明确选中、组合或补充的内容整理候选；不得自动投票、擅自折中，也不得合并老板没有选择的内容',
    '主编的职责是分析老板已经给出的想法并尽快形成方向，不得把编辑判断连续退回给老板',
    '次要未知项使用明确、可逆的合理假设补齐并标注为可修改，不得因为资料不完美阻止形成候选',
    '每轮只给一个主推荐；只有确有重大取舍时才允许附带一个结构真正不同的备选，不得堆叠同义方向',
    '每轮最多一个问题，而且只能询问会改变重大方向或导致候选无法成立的阻塞信息；否则只问是否确认或直接修改'
  ];
  const feedbackRules = settingFeedbackRules(guidance);
  const revisionRule = settingRevisionRule(guidance);
  if (guidance.itemKey === 'creative-concept') {
    if (guidance.phase === 'ask') {
      return [
        ...common,
        ...feedbackRules,
        '不要先向老板抛抽象问题。直接根据开书定位和故事方向给出一个最合理、可修改的策划理念推荐',
        '策划理念只回答三件事：为什么这本书值得写、主要探讨什么、准备给读者什么独特体验；不要复述剧情梗概或细化人物事件',
        '只给一个推荐，禁止方案A/B/C、方向一/二/三、多个同义候选和选择题；alternatives、risks和details必须为空',
        'answer不超过120个中文字符，keyPoints最多1条，questions最多1条且只能问“是否按这个确定”；nextStep只说明确认或直接修改',
        artifactRule,
        'workflowArtifact.content使用一段通俗完整的话，不超过180个中文字符，不写流程话术、备选项或待确认问题'
      ];
    }
    return [
      ...common,
      ...feedbackRules,
      revisionRule,
      '只返回一个策划理念候选，不扩写剧情或再次分析标签',
      '禁止方案A/B/C、方向一/二/三和选择题；alternatives、risks和details必须为空',
      'answer不超过120个中文字符，keyPoints最多1条，questions只能是“是否按这个确定”；nextStep只说明确认或继续直接修改',
      artifactRule,
      'workflowArtifact.content使用一段通俗完整的话，不超过180个中文字符，不写流程话术、备选项或待确认问题'
    ];
  }
  if (guidance.phase === 'ask') {
    return [
      ...common,
      ...feedbackRules,
      `直接依据当前作品定位分析这一项：${guidance.prompt}`,
      '先用一句话说明你对老板意图的理解，再给出一个具体、通俗、可修改的主推荐；不要先问问题，不要列问卷',
      'alternatives默认必须为空；只有主推荐与另一条路径存在真实且重大的创作代价差异时，才可保留一个备选',
      'questions默认只写“是否按这个确定？如需调整，直接告诉我修改哪一点”；仅存在重大阻塞时可替换成一个必要问题，但仍须同时提交当前最佳候选',
      artifactRule,
      'workflowArtifact中的content必须是当前最佳判断，不写讨论过程、选项清单、流程话术或待补作业'
    ];
  }
  return [
    ...common,
    ...feedbackRules,
    revisionRule,
    '只返回一个修订候选，不扩写成剧情',
    '明确请老板回复“确认”或直接提出修改；确认前候选不进入正式设定',
    artifactRule,
    'workflowArtifact中的content必须至少8个中文字符，不得出现“待老板”“需确认”“主编”“编剧”“方案A/B/C”等流程话术'
  ];
}

function settingRevisionRule(guidance: SettingGuidanceSnapshot): string {
  if (guidance.feedbackMode === 'numeric_selection') {
    const selected = guidance.selectionNumbers?.join('、') ?? '';
    return `老板明确选择了方案${selected}。只能融合这些已选方案中互不冲突、适用于本书的内容；未选方案不得带入。输出一份已经消除重复和矛盾的完整候选，不要再列方案清单，也不要要求老板重新选择`;
  }
  if (guidance.feedbackMode === 'replace_direction'
    || (guidance.feedbackMode === 'vague_dissatisfaction' && guidance.dissatisfactionRound >= 2)) {
    return '旧候选只用于识别已被否定的方向；必须返回一个核心机制或表达重心明显不同的新候选，不得把旧候选强行合并回来';
  }
  if (guidance.feedbackMode === 'vague_dissatisfaction') {
    return '诊断旧候选最可能的空泛或错位之处并直接改好；保留仍有价值的部分，但不得只做同义改写';
  }
  return '把老板明确指出的修改直接合并进原候选；保留未被否定的内容，不重新打开已经排除的方向';
}

function settingFeedbackRules(guidance: SettingGuidanceSnapshot): string[] {
  if (guidance.phase !== 'revise') return [];
  const previous = guidance.previousCandidate === null
    ? '当前没有可复用的旧候选。'
    : `上一版候选如下，只作为修订对象，不得原样复述：${guidance.previousCandidate}`;
  if (guidance.feedbackMode === 'numeric_selection') {
    const selected = new Set(guidance.selectionNumbers ?? []);
    const options = (guidance.proposalOptions ?? [])
      .filter((option) => selected.has(option.number))
      .map((option) => `方案${option.number}（${option.memberName}）：${option.content}`);
    return [
      `老板本轮选择：${[...selected].sort((left, right) => left - right).join('、')}`,
      `只允许使用以下入选内容：\n${options.join('\n')}`,
      '先消除重复，再解决冲突；若两项存在不可同时成立的矛盾，优先保留更符合开书资料和已确认设定的一项，并用一句话说明取舍',
      '本轮直接形成一份可确认的融合候选；questions只能询问“是否确认”，不得重新列出选项'
    ];
  }
  if (guidance.feedbackMode === 'replace_direction') {
    return [
      previous,
      '老板明确否定了原方向。本轮必须给出一个核心机制、价值冲突或读者体验明显不同的新候选，不得只换措辞',
      '不得追问老板想换成什么；先给专业主推荐。只有新候选仍被否定且缺少决定性信息时，下一轮才可问一个关键问题'
    ];
  }
  if (guidance.feedbackMode === 'vague_dissatisfaction') {
    if (guidance.dissatisfactionRound <= 1) {
      return [
        previous,
        '老板表示不满意但未说明原因。不要反问原因；先判断旧候选最可能的问题，并直接给出一个更具体、更贴合本书定位的修订候选',
        '本轮questions必须为空；面向老板只说明新推荐和它比上一版改进的一点'
      ];
    }
    if (guidance.dissatisfactionRound === 2) {
      return [
        previous,
        '这是同一设定项第二次泛化不满意。本轮不要继续微调旧说法，必须换成一条结构明显不同的新方向',
        '本轮questions必须为空，不列多个方向，不让老板做选择题'
      ];
    }
    return [
      previous,
      '同一设定项已经连续两次以上未获认可。本轮仍须先给一个当前最佳新候选，然后只允许问一个能区分方向的通俗关键问题',
      '问题不得使用专业术语，不得让老板填写问卷或一次回答多个子问题'
    ];
  }
  return [
    previous,
    '老板已经给出具体修改意见。只修改她指出的部分，保留未被否定且不冲突的内容；不要借机重开整个方向',
    '本轮不得追加新的选择题；直接提交合并后的完整候选'
  ];
}

function compactContinuationSettingSource(baseline: {
  summary_text: string | null;
  structured_json: string;
  analyzed_chapter_count: number;
  total_chapter_count: number;
  canon_revision: number;
}): string {
  let structured: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(baseline.structured_json) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      structured = parsed as Record<string, unknown>;
    }
  } catch {
    structured = {};
  }
  const rawOutlines = Array.isArray(structured.chapterOutlines)
    ? structured.chapterOutlines.filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item))
    : [];
  const sampled = rawOutlines.length <= 8
    ? rawOutlines
    : [...rawOutlines.slice(0, 3), ...rawOutlines.slice(-5)];
  const outlines = sampled.map((outline) => ({
    chapterNumber: outline.chapterNumber,
    title: outline.title,
    chapterGoal: outline.chapterGoal,
    cast: outline.cast,
    centralConflict: outline.centralConflict,
    ending: outline.ending
  }));
  return clipContextSource(JSON.stringify({
    authority: 'derived_from_confirmed_manuscript',
    originalManuscriptRemainsAuthoritative: true,
    analyzedChapters: baseline.analyzed_chapter_count,
    totalChapters: baseline.total_chapter_count,
    canonRevision: baseline.canon_revision,
    summary: baseline.summary_text,
    reverseOutlines: outlines
  }), 1_400);
}

/**
 * 设定逐项讨论只携带作出当前判断所需的最小资料。三份独立方案已经吸收了
 * 续写基线，主编汇总时不得再把整份逐章基线和三案重复装入硬上下文。
 */
function compactSettingGuidanceSource(guidance: SettingGuidanceSnapshot): SettingGuidanceSnapshot {
  const selected = guidance.feedbackMode === 'numeric_selection'
    ? new Set(guidance.selectionNumbers ?? [])
    : null;
  const proposals = guidance.proposalOptions
    ?.filter((option) => selected === null || selected.has(option.number))
    .slice(0, 3)
    .map((option) => ({
      number: option.number,
      memberName: option.memberName,
      content: clipContextSource(option.content, 420)
    }));
  return {
    ...guidance,
    positioningSummary: clipContextSource(guidance.positioningSummary, 300),
    storyDirectionReference: clipContextSource(guidance.storyDirectionReference, 180),
    confirmedContext: guidance.confirmedContext.slice(0, 3).map((item) => ({
      ...item,
      content: clipContextSource(item.content, 120)
    })),
    previousCandidate: guidance.previousCandidate === null
      ? null
      : clipContextSource(guidance.previousCandidate, 240),
    ...(proposals === undefined ? {} : { proposalOptions: proposals })
  };
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
