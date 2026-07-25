import type { DatabaseSync } from 'node:sqlite';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ContextPackService } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { RoleKey } from '../../domain/roles.js';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../infrastructure/models/model-runtime-config.js';
import { DiscussionService } from './discussion-service.js';
import { PlotSpanEstimateService } from '../continuity/plot-span-estimate-service.js';
import { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import {
  createEffectiveOutputReference,
  EFFECTIVE_OUTPUT_CONTRACT,
  prepareEffectiveOutput,
  type EffectiveOutputResult
} from '../chat/effective-output-service.js';
import { HybridRetrievalService } from '../memory/hybrid-retrieval-service.js';
import { RetrievalContextSourceService } from '../memory/retrieval-context-source-service.js';
import { RetrievalOrchestrationRepository } from '../../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';
import { ChunkSnapshotRepository } from '../../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { EditorLeaseService } from '../editors/editor-lease-service.js';
import { createHash } from 'node:crypto';
import { CreativeSessionRepository } from '../../infrastructure/db/repositories/creative-session-repository.js';
import { CreativeSessionService } from './creative-session-service.js';

interface DiscussionTaskRow {
  status: string;
  lease_owner: string | null;
  task_brief_json: string;
  cancel_requested: number;
  assigned_agent_id: string | null;
}

interface ParticipantRow {
  agent_id: string;
  display_name: string;
  role_key: RoleKey | CreativeRoleKey;
  category: 'core' | 'specialist';
  model_snapshot_id: string;
  provider: string;
  model_id: string;
}

type DiscussionPurpose = 'open_discussion' | 'creative_exploration' | 'locked_planning';
type DiscussionPhase = 'independent' | 'cross_review';

interface CollectedOpinion {
  opinionId: string;
  agentId: string;
  role: string;
  roleKey: RoleKey | CreativeRoleKey;
  phase: DiscussionPhase;
  output: string;
  effective?: EffectiveOutputResult;
}

export class DiscussionPipelineService {
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

  public async executeClaimed(scope: BookScope, taskId: string, workerId: string, leaseFence?: TaskLeaseFence): Promise<{ discussionId: string; decisionId: string; opinionCount: number }> {
    assertBookScope(scope);
    const task = this.database.prepare(`
      SELECT status, lease_owner, task_brief_json, cancel_requested, assigned_agent_id FROM tasks
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND task_type = 'discussion'
    `).get(taskId, scope.ownerId, scope.bookId) as DiscussionTaskRow | undefined;
    const claimedTask = new TaskService(this.database, this.releaseId, this.clock).require(scope, taskId);
    if (task === undefined || task.status !== 'working' || task.lease_owner !== workerId
      || (leaseFence !== undefined && (claimedTask.leaseToken !== leaseFence.leaseToken || claimedTask.currentAttemptNo !== leaseFence.attemptNo))) {
      throw new Error('讨论任务未由指定Worker持有');
    }
    const brief = JSON.parse(task.task_brief_json) as {
      discussionId: string;
      scopeText: string;
      conversationId: string;
      purpose?: DiscussionPurpose;
      requestedChapterCount?: 1 | 3 | 4 | 5 | null;
      creativeSessionId?: string;
      creativeBlackboardRevision?: number;
      creativeSourceFingerprint?: string;
      roundKind?: 'initial_exploration' | 'major_redirect' | 'locked_planning';
    };
    const discussions = new DiscussionService(this.database, this.ids, this.clock);
    const discussion = discussions.require(scope, brief.discussionId);
    if (!['collecting', 'cross_review', 'synthesizing'].includes(discussion.status)) throw new Error('讨论任务状态与讨论阶段不一致');
    const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
    const participants = this.database.prepare(`
      SELECT a.agent_id, a.display_name, r.role_key, r.category,
        COALESCE(p.model_snapshot_id, a.model_snapshot_id) AS model_snapshot_id, m.provider, m.model_id
      FROM discussion_participants p
      JOIN agent_instances a ON a.agent_id = p.agent_id AND a.owner_id = p.owner_id AND a.book_id = p.book_id
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = COALESCE(p.model_snapshot_id, a.model_snapshot_id)
      WHERE p.discussion_id = ? AND p.owner_id = ? AND p.book_id = ?
        AND (a.agent_id = ? OR r.role_key NOT IN ('chief_editor', 'deputy_editor'))
      ORDER BY CASE WHEN a.agent_id = ? THEN 1 ELSE 0 END, p.agent_id
    `).all(brief.discussionId, scope.ownerId, scope.bookId, task.assigned_agent_id, task.assigned_agent_id) as unknown as ParticipantRow[];
    const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
    if (budget === undefined) throw new Error('讨论书籍没有活动预算');
    const budgets = new BudgetService(this.database, this.ids, this.clock);
    const calls = new ModelCallService(this.database, this.clock, budgets);
    const contextPacks = new ContextPackService(this.database, this.ids, this.clock);
    const opinions: CollectedOpinion[] = (this.database.prepare(`
      SELECT o.opinion_id, o.agent_id, a.display_name, r.role_key, o.phase, o.content_json
      FROM discussion_opinions o JOIN agent_instances a
        ON a.agent_id = o.agent_id AND a.owner_id = o.owner_id AND a.book_id = o.book_id
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE o.discussion_id = ? AND o.owner_id = ? AND o.book_id = ?
        AND o.phase IN ('independent', 'cross_review')
      ORDER BY o.created_at, o.opinion_id
    `).all(brief.discussionId, scope.ownerId, scope.bookId) as unknown as Array<{
      opinion_id: string;
      agent_id: string;
      display_name: string;
      role_key: RoleKey | CreativeRoleKey;
      phase: DiscussionPhase;
      content_json: string;
    }>).map((row) => {
      const content = JSON.parse(row.content_json) as { recommendation?: unknown };
      const output = typeof content.recommendation === 'string' ? content.recommendation : JSON.stringify(content.recommendation ?? content);
      return {
        opinionId: row.opinion_id,
        agentId: row.agent_id,
        role: row.display_name,
        roleKey: row.role_key,
        phase: row.phase,
        output,
        ...(['chief_editor', 'deputy_editor'].includes(row.role_key) && row.phase === 'independent'
          ? { effective: prepareEffectiveOutput(output) }
          : {})
      };
    });
    const spanEstimates = new PlotSpanEstimateService(new LongformContinuityRepository(this.database), this.ids, this.clock);
    try {
      const collectOpinion = async (
        participant: ParticipantRow,
        phase: DiscussionPhase,
        peerOpinions: CollectedOpinion[] = []
      ): Promise<CollectedOpinion> => {
        const existing = opinions.find((opinion) => opinion.agentId === participant.agent_id && opinion.phase === phase);
        if (existing !== undefined) return existing;
        const cancellation = this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ?`).get(taskId) as { cancel_requested: number };
        if (cancellation.cancel_requested === 1) throw new DOMException('讨论任务已取消', 'AbortError');
        const isEditor = participant.agent_id === task.assigned_agent_id;
        const hardSources = [{ sourceType: 'boss_discussion_scope', sourceId: brief.discussionId, content: brief.scopeText, reason: '老板明确讨论范围，不可截断', priority: 100 }];
        if (peerOpinions.length > 0) {
          hardSources.push({
            sourceType: phase === 'cross_review' ? 'peer_independent_opinion' : 'specialist_opinions',
            sourceId: `${phase}:opinions:${brief.discussionId}:${participant.agent_id}`,
            content: JSON.stringify(peerOpinions.map((opinion) => ({
              opinionId: opinion.opinionId,
              role: opinion.role,
              phase: opinion.phase,
              opinion: opinion.output
            }))),
            reason: phase === 'cross_review'
              ? '交叉质疑只读取另一编剧已经提交的独立方案'
              : '主编必须基于已经真实返回的独立方案和交叉质疑汇总',
            priority: 100
          });
        }
        const retrieved = await new RetrievalContextSourceService(this.retrieval).collect(scope, {
          query: brief.scopeText,
          roleKey: participant.role_key,
          mode: brief.purpose === 'open_discussion' || brief.purpose === undefined ? 'open_discussion' : 'creative_exploration',
          canonRevision: book.canon_revision,
          taskId,
          sourceTypes: ['fact', 'manuscript', 'outline', 'setting', 'wiki', 'voice'],
          limit: isEditor ? 12 : 9
        });
        hardSources.push(...retrieved.hardSources);
        const pack = contextPacks.build(scope, {
          taskId, agentId: participant.agent_id, canonRevision: book.canon_revision,
          positioningVersion: book.positioning_version, tokenBudget: 8_000,
          hardSources,
          optionalSources: retrieved.optionalSources
        });
        const evidenceContext = pack.sources
          .filter((source) => source.sourceType.startsWith('retrieval:'))
          .map((source) => ({ sourceType: source.sourceType, sourceId: source.sourceId, reason: source.reason, content: source.content }));
        const prompt = buildDiscussionPrompt({
          participant,
          purpose: brief.purpose ?? 'open_discussion',
          phase,
          scopeText: brief.scopeText,
          evidenceContext,
          peerOpinions
        });
        const adapter = this.modelAdapters.resolve(participant.provider, participant.model_id, 'discussion', participant.role_key);
        const inputHash = createHash('sha256').update(prompt).digest('hex');
        const reusable = this.database.prepare(`SELECT r.output_text, r.input_tokens, r.output_tokens, r.cash_micros
          FROM model_calls m JOIN model_call_results r ON r.request_id = m.request_id
          WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ? AND m.agent_id = ?
            AND m.model_snapshot_id = ? AND m.input_hash = ? AND m.phase_key LIKE ? AND m.state = 'succeeded'
          ORDER BY m.completed_at DESC LIMIT 1`)
          .get(scope.ownerId, scope.bookId, taskId, participant.agent_id, participant.model_snapshot_id,
            inputHash, `${phase}:${participant.role_key}:attempt-%`) as {
              output_text: string; input_tokens: number; output_tokens: number; cash_micros: number;
            } | undefined;
        let result = reusable === undefined ? undefined : {
          provider: participant.provider,
          modelId: participant.model_id,
          output: reusable.output_text,
          inputTokens: reusable.input_tokens,
          outputTokens: reusable.output_tokens,
          cashCostCny: reusable.cash_micros / 1_000_000,
          state: 'succeeded' as const
        };
        let lastError: unknown;
        const maxOutputTokens = discussionOutputTokenLimit(participant.role_key, isEditor, phase);
        for (let technicalTry = 1; result === undefined && technicalTry <= 2; technicalTry += 1) {
          const requestId = this.ids.next();
          const reservationId = budgets.reserve(
            scope, budget.budget_id, requestId,
            adapter.provider === 'openai-codex-subscription' ? 30_000 : 8_000, 0
          );
          try {
            result = await calls.execute(scope, {
              requestId, taskId,
              phaseKey: `${phase}:${participant.role_key}:attempt-${claimedTask.currentAttemptNo}:try-${technicalTry}`,
              agentId: participant.agent_id,
              modelSnapshotId: participant.model_snapshot_id, provider: participant.provider, modelId: participant.model_id,
              input: prompt,
              parameters: JSON.stringify({
                maxOutputTokens,
                planOnly: !participant.provider.startsWith('local-deterministic'),
                cashFallbackAllowed: false
              }),
              reservationId, contextPackId: pack.contextPackId,
              leaseToken: leaseFence?.leaseToken ?? claimedTask.leaseToken,
              attemptNo: leaseFence?.attemptNo ?? claimedTask.currentAttemptNo
            }, adapter, {
              requestId, taskId, ownerId: scope.ownerId, bookId: scope.bookId,
              agentId: participant.agent_id, prompt, maxOutputTokens
            });
          } catch (error) {
            lastError = error;
            const call = this.database.prepare(`SELECT state, error_class FROM model_calls
              WHERE request_id = ? AND owner_id = ? AND book_id = ?`)
              .get(requestId, scope.ownerId, scope.bookId) as { state: string; error_class: string | null } | undefined;
            const retryable = call?.state === 'failed' && call.error_class === 'technical_failure';
            if (!retryable) throw error;
            if (technicalTry === 2) {
              if (isEditor) {
                const takeover = new EditorLeaseService(this.database, this.ids, this.clock)
                  .tryAutomaticTakeover(scope, participant.agent_id);
                throw new Error(takeover.takenOver
                  ? `活动主编连续技术失败，已由${takeover.activeEditorAgentId}接管并从讨论检查点恢复`
                  : `活动主编连续技术失败且未能安全接管：${takeover.reason}`);
              }
              throw error;
            }
          }
        }
        if (result === undefined) throw lastError instanceof Error ? lastError : new Error('讨论模型调用失败');
        const effective = isEditor ? prepareEffectiveOutput(result.output) : undefined;
        const output = effective?.fullContent ?? result.output;
        const opinionId = discussions.addOpinion(scope, brief.discussionId, {
          agentId: participant.agent_id, modelSnapshotId: participant.model_snapshot_id, phase,
          content: {
            role: participant.role_key,
            recommendation: output,
            basis: `来自${participant.display_name}（${result.provider}/${result.modelId}）的可追溯模型调用`
          },
          tokens: result.inputTokens + result.outputTokens
        });
        if (brief.purpose === 'locked_planning' && phase === 'independent'
          && ['lead_screenwriter', 'second_screenwriter'].includes(participant.role_key)) {
          const estimate = parseSpanEstimate(result.output, result.provider.startsWith('local-deterministic'));
          spanEstimates.submit(scope, {
            discussionId: brief.discussionId, round: 1, agentId: participant.agent_id, modelSnapshotId: participant.model_snapshot_id,
            minimum: estimate.minimum, recommended: estimate.recommended, maximum: estimate.maximum,
            units: estimate.units, assumptions: estimate.assumptions,
            uncertainty: estimate.uncertainty, sharedBrief: { scopeText: brief.scopeText, requestedChapterCount: null }
          });
        }
        const collected: CollectedOpinion = {
          opinionId,
          agentId: participant.agent_id,
          role: participant.display_name,
          roleKey: participant.role_key,
          phase,
          output,
          ...(effective === undefined ? {} : { effective })
        };
        opinions.push(collected);
        return collected;
      };

      const editor = participants.find((participant) => participant.agent_id === task.assigned_agent_id);
      if (editor === undefined) throw new Error('讨论缺少当前活动主编');
      const specialists = participants.filter((participant) => participant.agent_id !== task.assigned_agent_id);
      const independent: CollectedOpinion[] = [];
      for (const specialist of specialists) {
        independent.push(await collectOpinion(specialist, 'independent'));
      }

      const creativePurpose = brief.purpose === 'creative_exploration' || brief.purpose === 'locked_planning';
      if (creativePurpose) {
        const current = discussions.require(scope, brief.discussionId);
        if (current.status === 'collecting') discussions.setStage(scope, brief.discussionId, 'collecting', 'cross_review');
        for (const specialist of specialists) {
          const peers = independent.filter((opinion) => opinion.agentId !== specialist.agent_id);
          if (peers.length === 0) throw new Error('双编剧交叉质疑缺少另一份独立方案');
          await collectOpinion(specialist, 'cross_review', peers);
        }
        if (brief.purpose === 'creative_exploration' && brief.creativeSessionId !== undefined) {
          this.persistForecast(scope, brief, book.canon_revision, independent, opinions);
        }
      }

      const specialistEvidence = opinions.filter((opinion) => opinion.agentId !== editor.agent_id);
      const editorOpinion = await collectOpinion(editor, 'independent', specialistEvidence);
      const stage = discussions.require(scope, brief.discussionId).status;
      if (stage === 'collecting') discussions.setStage(scope, brief.discussionId, 'collecting', 'synthesizing');
      if (stage === 'cross_review') discussions.setStage(scope, brief.discussionId, 'cross_review', 'synthesizing');
      const decisionId = discussions.synthesize(scope, brief.discussionId, {
        recommendation: { summary: editorOpinion.output, evidence: opinions },
        alternatives: independent.map((opinion) => ({ role: opinion.role, proposal: opinion.output })),
        disagreements: specialistEvidence.length > 1
          ? [{ status: '保留独立方案与交叉质疑，不以多数票消除分歧', roles: independent.map((opinion) => opinion.role) }]
          : [],
        impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
      });
      const summaryMessageId = this.addEditorMessage(
        scope,
        brief.conversationId,
        editor,
        brief.discussionId,
        brief.scopeText,
        decisionId,
        opinions,
        editorOpinion.effective ?? prepareEffectiveOutput(editorOpinion.output),
        brief.purpose ?? 'open_discussion'
      );
      if (brief.creativeSessionId !== undefined) {
        const sessions = new CreativeSessionRepository(this.database);
        new CreativeSessionService(this.database, this.ids, this.clock).appendEditorReply(scope, {
          sessionId: brief.creativeSessionId,
          messageId: summaryMessageId,
          content: editorOpinion.output
        });
        const session = sessions.require(scope, brief.creativeSessionId);
        sessions.updateStatus(scope, {
          sessionId: session.sessionId,
          expectedStatus: session.status,
          status: brief.purpose === 'locked_planning' ? 'awaiting_plan' : 'awaiting_direction',
          now: this.clock.now().toISOString()
        });
        sessions.completeRound(scope, {
          sessionId: session.sessionId,
          discussionId: brief.discussionId,
          decisionId,
          now: this.clock.now().toISOString()
        });
      }
      for (const participant of participants.filter((item) => item.category === 'specialist')) {
        this.database.prepare(`UPDATE agent_instances SET activation_state = 'standby', updated_at = ? WHERE owner_id = ? AND book_id = ? AND agent_id = ?`)
          .run(this.clock.now().toISOString(), scope.ownerId, scope.bookId, participant.agent_id);
      }
      new TaskService(this.database, this.releaseId, this.clock).complete(scope, taskId, workerId, leaseFence);
      return { discussionId: brief.discussionId, decisionId, opinionCount: opinions.length };
    } catch (error) {
      const now = this.clock.now().toISOString();
      const cancelled = (this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ?`).get(taskId) as { cancel_requested: number }).cancel_requested === 1;
      for (const participant of participants.filter((item) => item.category === 'specialist')) {
        this.database.prepare(`UPDATE agent_instances SET activation_state = 'standby', updated_at = ? WHERE owner_id = ? AND book_id = ? AND agent_id = ?`)
          .run(now, scope.ownerId, scope.bookId, participant.agent_id);
      }
      const failure = this.database.prepare(`
        UPDATE tasks SET status = ?, error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
          lease_token = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ? AND status = 'working'
          AND lease_expires_at > ? AND (? IS NULL OR (lease_token = ? AND current_attempt_no = ?))
          AND (required_editor_epoch = 0 OR required_editor_epoch = (
            SELECT editor_epoch FROM books WHERE owner_id = ? AND book_id = ?
          ))
      `).run(cancelled ? 'cancelled' : 'failed', cancelled ? 'TASK_CANCELLED' : 'DISCUSSION_FAILED', now,
        taskId, scope.ownerId, scope.bookId, workerId, now, leaseFence?.leaseToken ?? null,
        leaseFence?.leaseToken ?? null, leaseFence?.attemptNo ?? 0, scope.ownerId, scope.bookId);
      if (failure.changes !== 1) throw error;
      this.database.prepare(`
        UPDATE task_attempts SET status = ?, error_code = ?, completed_at = ?
        WHERE owner_id = ? AND book_id = ? AND task_id = ? AND attempt_no = ? AND status = 'working'
      `).run(cancelled ? 'cancelled' : 'failed', cancelled ? 'TASK_CANCELLED' : 'DISCUSSION_FAILED', now,
        scope.ownerId, scope.bookId, taskId, leaseFence?.attemptNo ?? claimedTask.currentAttemptNo);
      throw error;
    }
  }

  private persistForecast(
    scope: BookScope,
    brief: {
      discussionId: string;
      creativeSessionId?: string;
      creativeBlackboardRevision?: number;
      creativeSourceFingerprint?: string;
    },
    canonRevision: number,
    independent: CollectedOpinion[],
    opinions: CollectedOpinion[]
  ): void {
    if (
      brief.creativeSessionId === undefined
      || brief.creativeBlackboardRevision === undefined
      || brief.creativeSourceFingerprint === undefined
    ) {
      throw new Error('创意预演缺少创作会话来源信息');
    }
    const repository = new CreativeSessionRepository(this.database);
    const reusable = repository.listForecasts(scope, brief.creativeSessionId).find((forecast) =>
      forecast.status === 'active'
      && forecast.canonRevision === canonRevision
      && forecast.blackboardRevision === brief.creativeBlackboardRevision
      && forecast.sourceFingerprint === brief.creativeSourceFingerprint
    );
    if (reusable !== undefined) return;
    repository.createForecast(scope, {
      forecastId: this.ids.next(),
      sessionId: brief.creativeSessionId,
      discussionId: brief.discussionId,
      canonRevision,
      blackboardRevision: brief.creativeBlackboardRevision,
      sourceFingerprint: brief.creativeSourceFingerprint,
      branches: independent.map((opinion, index) => ({
        branchId: this.ids.next(),
        ordinal: index + 1,
        title: `${opinion.role}方案`,
        proposal: {
          independentProposal: opinion.output,
          crossReview: opinions.find((candidate) =>
            candidate.agentId === opinion.agentId && candidate.phase === 'cross_review'
          )?.output ?? null
        },
        sourceAgentId: opinion.agentId,
        sourceOpinionId: opinion.opinionId
      })),
      now: this.clock.now().toISOString()
    });
  }

  private addEditorMessage(
    scope: BookScope,
    conversationId: string,
    editor: ParticipantRow,
    discussionId: string,
    scopeText: string,
    decisionId: string,
    opinions: Array<{ agentId: string; role: string; roleKey: RoleKey | CreativeRoleKey; output: string }>,
    editorSummary: EffectiveOutputResult,
    purpose: DiscussionPurpose
  ): string {
    const specialistSections = opinions
      .filter((opinion) => opinion.agentId !== editor.agent_id)
      .map((opinion) => `【${opinion.role}】\n${opinion.output}`);
    const confirmation = purpose === 'creative_exploration'
      ? `您可以继续讨论、要求重大改向或试写；方向明确后可直接说“锁定当前方向”，也可输入：确认方案 ${decisionId}`
      : purpose === 'locked_planning'
        ? `如认可故事弧跨度和未来1至3章的滚动规划，请输入：确认方案 ${decisionId}`
        : `如接受，请输入：确认方案 ${decisionId}`;
    // P0-3 / R01: 合同型 discussion_summary 解析失败时不把围栏/原文 JSON 直接塞进聊天，
    // 显示自然中文提示并保留原始结果审计入口（fullSummary 仍含原文，供 effective_output 引用追溯）。
    const editorVisible = editorSummary.format === 'fallback'
      ? '主编汇总未能解析为结构化结论，请查看原始结果。'
      : editorSummary.visibleContent;
    const summary = [
      `讨论“${shortDiscussionTitle(scopeText)}”已完成。`,
      editorVisible,
      specialistSections.length > 0 ? `已保留 ${specialistSections.length} 份独立方案与交叉质疑，可展开查看。` : '',
      confirmation
    ].filter(Boolean).join('\n\n');
    const fullSummary = [
      `讨论“${shortDiscussionTitle(scopeText)}”已完成。`,
      ...specialistSections,
      `【${editor.display_name}汇总】\n${editorSummary.fullContent}`,
      confirmation
    ].join('\n');
    const references: unknown[] = [{ discussionId, decisionId }];
    const effectiveReference = createEffectiveOutputReference(editorSummary, fullSummary);
    if (effectiveReference !== null) references.push(effectiveReference);
    const messageId = this.ids.next();
    this.database.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type, sender_agent_id,
        role_key, model_provider, model_id, message_type, content, references_json, created_at
      ) VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?, 'discussion_summary', ?, ?, ?)
    `).run(
      messageId, conversationId, scope.ownerId, scope.bookId, editor.agent_id,
      editor.role_key, editor.provider, editor.model_id, summary,
      JSON.stringify(references), this.clock.now().toISOString()
    );
    return messageId;
  }
}

function shortDiscussionTitle(scopeText: string): string {
  // P0-3 / R01: 汇总标题只用短讨论题，不复述老板整段原话；原话通过 discussionId 引用完整追溯。
  const firstLine = scopeText.split(/\n/u)[0]?.trim() ?? scopeText.trim();
  const limit = 40;
  return firstLine.length > limit ? `${firstLine.slice(0, limit)}…` : firstLine;
}

function discussionOutputTokenLimit(roleKey: RoleKey | CreativeRoleKey, isEditor: boolean, phase: DiscussionPhase): number {
  if (isEditor) return 6_000;
  if (phase === 'cross_review') return 2_500;
  if (roleKey === 'lead_screenwriter' || roleKey === 'second_screenwriter') return 4_000;
  return 2_000;
}

function buildDiscussionPrompt(input: {
  participant: ParticipantRow;
  purpose: DiscussionPurpose;
  phase: DiscussionPhase;
  scopeText: string;
  evidenceContext: Array<Record<string, unknown>>;
  peerOpinions: CollectedOpinion[];
}): string {
  const { participant, purpose, phase, scopeText, evidenceContext, peerOpinions } = input;
  const isEditor = participant.role_key === 'chief_editor' || participant.role_key === 'deputy_editor';
  if (isEditor) {
    return [
      `你是${participant.display_name}，是当前书籍的活动主编。`,
      `老板的问题：${scopeText}`,
      `按当前问题检索到的正史与规划证据：${JSON.stringify(evidenceContext)}`,
      `已收到的真实独立方案和交叉质疑：${JSON.stringify(peerOpinions.map((opinion) => ({
        role: opinion.role,
        phase: opinion.phase,
        opinion: opinion.output
      })))}`,
      purpose === 'creative_exploration'
        ? '现在只做方向比较：整理2至5个候选方向，逐项写清收益、代价、因果风险、人物影响、关键分歧和未知项；提出最多3个高价值追问。不得估算章节数，不得生成章纲，不得安排主笔开写。'
        : purpose === 'locked_planning'
          ? '方向已经由老板锁定。请综合两位编剧的独立跨度估算，形成故事弧目标、起止状态、关键转折，并只细化未来1至3章；远期不得展开成整批僵硬章纲。'
          : '请明确回应老板，综合岗位意见给出推荐、理由、风险和可执行下一步。',
      purpose === 'locked_planning'
        ? '最后必须另起一行输出且整行不得换行：规划落库 {"arcTitle":"故事弧标题","arcGoal":"本弧目标","endingState":"本弧结束状态","estimatedChapterRange":{"minimum":最少章数,"recommended":建议章数,"maximum":最多章数},"chapters":[{"title":"章名","goal":"本章唯一叙事目标","beats":["推进节点1","推进节点2"],"hook":"本章唯一章末钩子"}]}。chapters只能包含未来1至3章；每章目标和钩子必须具体且互不重复。'
        : '',
      '不得声称未参与的成员已经发言，不得在资料不足时直接安排主笔写正文。',
      '保留结构不同的高潜少数方案和有证据的分歧，不用多数票，不把意见压成没有代价的安全折中。',
      `输出合同：${JSON.stringify(EFFECTIVE_OUTPUT_CONTRACT)}`
    ].filter(Boolean).join('\n');
  }
  if (phase === 'cross_review') {
    return [
      `你是${participant.display_name}。你已经独立提交自己的方案，现在进行且仅进行一次交叉质疑。`,
      `老板的问题：${scopeText}`,
      `另一位编剧已经提交的独立方案：${JSON.stringify(peerOpinions.map((opinion) => ({
        opinionId: opinion.opinionId,
        role: opinion.role,
        opinion: opinion.output
      })))}`,
      '指出对方方案最强之处、一个关键盲点、一个会使方案失败的条件，并给出一项改进；保留你与对方真正不同的判断，不得为形成共识而趋同。',
      '不得重新估算章节跨度，不得生成章纲，不得复述老板原话。'
    ].join('\n');
  }
  return [
    `你是${participant.display_name}。请在看不到另一位编剧答案的前提下，独立分析这个小说创作问题：${scopeText}。`,
    `按当前问题检索到的正史与规划证据：${JSON.stringify(evidenceContext)}`,
    '给出结构清楚但保留创造性的方案，至少说明因果链、人物动机与代价、合理惊喜、失败风险、未知项和一项可执行建议；不要客套、自我介绍或重复结论。',
    purpose === 'creative_exploration'
      ? '当前仍是开放推演阶段：不得估算章节数，不得生成章纲，不得假定老板已经锁定方向。'
      : '',
    purpose === 'locked_planning' && ['lead_screenwriter', 'second_screenwriter'].includes(participant.role_key)
      ? '方向已经锁定。最后必须另起一行输出：章节跨度估算 {"minimum":最少章数,"recommended":建议章数,"maximum":最多章数,"units":[{"unit":"推进单元","suggestedChapters":章数}],"assumptions":["假设"],"uncertainty":["不确定项"]}。章数必须为1至30的整数，且最少≤建议≤最多。'
      : ''
  ].filter(Boolean).join('\n');
}

interface SpanEstimate {
  minimum: number;
  recommended: number;
  maximum: number;
  units: unknown[];
  assumptions: unknown[];
  uncertainty: unknown[];
}

function parseSpanEstimate(output: string, deterministicFallback: boolean): SpanEstimate {
  const match = /章节跨度估算\s*(\{[^\r\n]+\})/u.exec(output);
  if (match !== null) {
    try {
      const value = JSON.parse(match[1]!) as Partial<SpanEstimate>;
      if (
        Number.isInteger(value.minimum) && Number.isInteger(value.recommended) && Number.isInteger(value.maximum)
        && value.minimum! >= 1 && value.minimum! <= value.recommended! && value.recommended! <= value.maximum! && value.maximum! <= 30
      ) {
        return {
          minimum: value.minimum!, recommended: value.recommended!, maximum: value.maximum!,
          units: Array.isArray(value.units) ? value.units : [],
          assumptions: Array.isArray(value.assumptions) ? value.assumptions : [],
          uncertainty: Array.isArray(value.uncertainty) ? value.uncertainty : []
        };
      }
    } catch {
      // The explicit validation error below is more useful than leaking a JSON parser message.
    }
  }
  if (deterministicFallback) {
    return {
      minimum: 2, recommended: 3, maximum: 5,
      units: [{ unit: '确定性测试推进单元', suggestedChapters: 3 }],
      assumptions: ['仅用于无真实凭证时的确定性自动测试'],
      uncertainty: ['真实模型接入后必须独立重新估算']
    };
  }
  throw new Error('编剧回复缺少有效的结构化章节跨度估算，不能伪造或代填估算');
}
