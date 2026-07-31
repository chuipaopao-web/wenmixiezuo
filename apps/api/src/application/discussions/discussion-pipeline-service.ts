import type { DatabaseSync } from 'node:sqlite';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ContextPackService, estimateTokens } from '../memory/context-pack-service.js';
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
import {
  parseSettingOutlineDeposit,
  SettingOutlineWorkspaceService
} from '../knowledge/setting-outline-workspace-service.js';
import {
  nextChapterPlanningNumber,
  parseMasterOutlineDepositOutput
} from '../artifacts/planning-artifact-service.js';
import { compactLockedPlanningScope } from './locked-planning-context.js';

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
    const savedOpinions = (this.database.prepare(`
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
    // 失败重试可能留下同一成员、同一阶段的无效结构化回复。它们属于可追溯
    // 审计证据，但不能再次进入主编资料包；否则既污染判断，也会把硬来源预算
    // 撑爆。运行检查点只保留每席每阶段最后一份有效结果。
    const opinions: CollectedOpinion[] = normalizeDiscussionCheckpoints(
      savedOpinions,
      brief.scopeText.includes('【剧情总纲专项讨论资料包】')
    );
    const spanEstimates = new PlotSpanEstimateService(new LongformContinuityRepository(this.database), this.ids, this.clock);
    try {
      const collectOpinion = async (
        participant: ParticipantRow,
        phase: DiscussionPhase,
        peerOpinions: CollectedOpinion[] = []
      ): Promise<CollectedOpinion> => {
        const isEditor = participant.agent_id === task.assigned_agent_id;
        const matchingOpinions = opinions.filter(
          (opinion) => opinion.agentId === participant.agent_id && opinion.phase === phase
        );
        const specialistMasterOutlineRequired = !isEditor
          && phase === 'independent'
          && brief.scopeText.includes('【剧情总纲专项讨论资料包】')
          && ['lead_screenwriter', 'second_screenwriter'].includes(participant.role_key);
        let existing = isEditor
          ? matchingOpinions.findLast((opinion) => hasRequiredWorkflowArtifact(
              brief.scopeText,
              brief.purpose ?? 'open_discussion',
              opinion.output
            ))
          : specialistMasterOutlineRequired
            ? matchingOpinions.findLast((opinion) => isValidMasterOutlineOutput(opinion.output))
            : matchingOpinions.findLast(() => true);
        if (existing !== undefined) {
          // An opinion is checkpointed before its span estimate. If parsing or persistence
          // fails after the opinion insert, a task retry must rebuild that missing derived
          // estimate from the preserved real model output instead of silently skipping it.
          if (
            brief.purpose === 'locked_planning'
            && phase === 'independent'
            && ['lead_screenwriter', 'second_screenwriter'].includes(participant.role_key)
          ) {
            const savedEstimate = this.database.prepare(`
              SELECT 1
              FROM plot_span_estimates
              WHERE owner_id = ? AND book_id = ? AND discussion_id = ? AND round = 1
                AND screenwriter_agent_id = ? AND status = 'submitted'
              LIMIT 1
            `).get(scope.ownerId, scope.bookId, brief.discussionId, participant.agent_id);
            if (savedEstimate === undefined) {
              try {
                const estimate = parseSpanEstimateOutput(
                  existing.output,
                  participant.provider.startsWith('local-deterministic')
                );
                spanEstimates.submit(scope, {
                  discussionId: brief.discussionId,
                  round: 1,
                  agentId: participant.agent_id,
                  modelSnapshotId: participant.model_snapshot_id,
                  minimum: estimate.minimum,
                  recommended: estimate.recommended,
                  maximum: estimate.maximum,
                  units: estimate.units,
                  assumptions: estimate.assumptions,
                  uncertainty: estimate.uncertainty,
                  sharedBrief: { scopeText: brief.scopeText, requestedChapterCount: null }
                });
              } catch {
                // 旧版本曾先保存意见、再解析跨度。若供应商输出在末尾被截断，
                // 这条意见只能保留为审计证据，不能继续作为可恢复检查点。
                const invalidIndex = opinions.indexOf(existing);
                if (invalidIndex >= 0) opinions.splice(invalidIndex, 1);
                existing = undefined;
              }
            }
          }
          if (existing !== undefined) return existing;
        }
        const cancellation = this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ?`).get(taskId) as { cancel_requested: number };
        if (cancellation.cancel_requested === 1) throw new DOMException('讨论任务已取消', 'AbortError');
        const promptPeerOpinions = isEditor
          ? compactOpinionsForEditor(peerOpinions)
          : phase === 'cross_review'
            ? compactOpinionsForCrossReview(peerOpinions)
            : peerOpinions;
        const promptScopeText = brief.purpose === 'locked_planning'
          ? compactLockedPlanningScope(brief.scopeText)
          : brief.scopeText;
        const hardSources = [{ sourceType: 'boss_discussion_scope', sourceId: brief.discussionId, content: promptScopeText, reason: '老板明确讨论范围，不可截断', priority: 100 }];
        hardSources.push(...planningHierarchySources(
          this.database, scope, brief.scopeText, brief.purpose ?? 'open_discussion'
        ));
        if (promptPeerOpinions.length > 0) {
          hardSources.push({
            sourceType: phase === 'cross_review' ? 'peer_independent_opinion' : 'specialist_opinions',
            sourceId: `${phase}:opinions:${brief.discussionId}:${participant.agent_id}`,
            content: JSON.stringify(promptPeerOpinions.map((opinion) => ({
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
          query: discussionRetrievalQuery(promptScopeText),
          roleKey: participant.role_key,
          mode: brief.purpose === 'open_discussion' || brief.purpose === undefined ? 'open_discussion' : 'creative_exploration',
          canonRevision: book.canon_revision,
          taskId,
          sourceTypes: ['fact', 'manuscript', 'outline', 'setting', 'wiki', 'voice'],
          limit: isEditor ? 12 : 9
        });
        hardSources.push(...(isEditor
          ? compactRetrievalHardSourcesForEditor(retrieved.hardSources)
          : retrieved.hardSources));
        const pack = contextPacks.build(scope, {
          taskId, agentId: participant.agent_id, canonRevision: book.canon_revision,
          positioningVersion: book.positioning_version,
          // 主编汇总必须同时保留老板原话、两份独立方案和两份交叉质疑。
          // 这些均是不可截断的审计硬来源，真实长方案会稳定超过编剧单席的 8k 上限。
          // 这里只提高讨论汇总包上限；正文主笔的精简资料包预算不受影响。
          tokenBudget: discussionContextTokenBudget(isEditor),
          hardSources,
          optionalSources: retrieved.optionalSources
        });
        const evidenceContext = pack.sources
          .filter((source) => source.sourceType.startsWith('retrieval:') || source.sourceType.startsWith('planning:'))
          .map((source) => ({ sourceType: source.sourceType, sourceId: source.sourceId, reason: source.reason, content: source.content }));
        const prompt = buildDiscussionPrompt({
          participant,
          purpose: brief.purpose ?? 'open_discussion',
          phase,
          scopeText: promptScopeText,
          requestedChapterCount: brief.requestedChapterCount ?? null,
          firstChapterNumber: brief.purpose === 'locked_planning'
            ? nextChapterPlanningNumber(this.database, scope)
            : null,
          evidenceContext,
          peerOpinions: promptPeerOpinions
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
        const spanEstimateRequired = brief.purpose === 'locked_planning'
          && phase === 'independent'
          && ['lead_screenwriter', 'second_screenwriter'].includes(participant.role_key);
        let reusableIsValid = reusable !== undefined
          && (!isEditor || hasRequiredWorkflowArtifact(brief.scopeText, brief.purpose ?? 'open_discussion', reusable.output_text))
          && (!specialistMasterOutlineRequired || isValidMasterOutlineOutput(reusable.output_text));
        if (reusableIsValid && spanEstimateRequired) {
          try {
            parseSpanEstimateOutput(
              reusable!.output_text,
              participant.provider.startsWith('local-deterministic')
            );
          } catch {
            reusableIsValid = false;
          }
        }
        let result = !reusableIsValid ? undefined : {
          provider: participant.provider,
          modelId: participant.model_id,
          output: reusable!.output_text,
          inputTokens: reusable!.input_tokens,
          outputTokens: reusable!.output_tokens,
          cashCostCny: reusable!.cash_micros / 1_000_000,
          state: 'succeeded' as const
        };
        let lastError: unknown;
        const maxOutputTokens = discussionOutputTokenLimit(
          participant.role_key,
          isEditor,
          phase,
          brief.scopeText,
          brief.purpose ?? 'open_discussion'
        );
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
            const providerResultUnknown = call?.state === 'interrupted'
              && call.error_class === 'provider_result_unknown';
            if (providerResultUnknown) {
              if (isEditor) {
                const takeover = new EditorLeaseService(this.database, this.ids, this.clock)
                  .tryAutomaticTakeover(scope, participant.agent_id);
                throw new Error(takeover.takenOver
                  ? `活动主编调用结果未知，已由${takeover.activeEditorAgentId}接管并从讨论检查点恢复`
                  : `活动主编调用结果未知且未能安全接管：${takeover.reason}`);
              }
              throw error;
            }
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
        // 各级规划的原始回复还携带机器可解析的落库契约。
        // 面向老板的消息仍使用 effective 字段，但落库证据必须保留原始结构化段。
        const groupedSettingDiscussion = brief.scopeText.includes('【设定大纲成组讨论资料包】');
        const output = isEditor && (
          brief.purpose === 'locked_planning'
          || brief.scopeText.includes('【剧情总纲专项讨论资料包】')
          || groupedSettingDiscussion
        )
          ? result.output
          : effective?.fullContent ?? result.output;
        if (isEditor && !hasRequiredWorkflowArtifact(
          brief.scopeText,
          brief.purpose ?? 'open_discussion',
          output
        )) {
          throw new Error('活动主编回复缺少当前规划阶段要求的完整落库结构，残缺输出不会保存或在重试时复用');
        }
        const parsedSpanEstimate = spanEstimateRequired
          ? parseSpanEstimateOutput(result.output, result.provider.startsWith('local-deterministic'))
          : null;
        const opinionId = discussions.addOpinion(scope, brief.discussionId, {
          agentId: participant.agent_id, modelSnapshotId: participant.model_snapshot_id, phase,
          content: {
            role: participant.role_key,
            recommendation: output,
            basis: `来自${participant.display_name}（${result.provider}/${result.modelId}）的可追溯模型调用`
          },
          tokens: result.inputTokens + result.outputTokens
        });
        if (parsedSpanEstimate !== null) {
          spanEstimates.submit(scope, {
            discussionId: brief.discussionId, round: 1, agentId: participant.agent_id, modelSnapshotId: participant.model_snapshot_id,
            minimum: parsedSpanEstimate.minimum,
            recommended: parsedSpanEstimate.recommended,
            maximum: parsedSpanEstimate.maximum,
            units: parsedSpanEstimate.units,
            assumptions: parsedSpanEstimate.assumptions,
            uncertainty: parsedSpanEstimate.uncertainty,
            sharedBrief: { scopeText: brief.scopeText, requestedChapterCount: null }
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
        for (let index = opinions.length - 1; index >= 0; index -= 1) {
          const checkpoint = opinions[index];
          if (checkpoint?.agentId === participant.agent_id && checkpoint.phase === phase) {
            opinions.splice(index, 1);
          }
        }
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

      const settingSpecialistDiscussion = brief.scopeText.includes('【设定专项讨论资料包】')
        || brief.scopeText.includes('【设定大纲成组讨论资料包】');
      const masterOutlineDiscussion = brief.scopeText.includes('【剧情总纲专项讨论资料包】');
      if (masterOutlineDiscussion) {
        for (const opinion of independent) {
          if (!isValidMasterOutlineOutput(opinion.output)) {
            throw new Error(`${opinion.role}没有提交有效的阶段式剧情总纲，不能进入交叉质疑`);
          }
        }
      }
      const creativePurpose = brief.purpose === 'creative_exploration'
        || brief.purpose === 'locked_planning'
        || settingSpecialistDiscussion
        || masterOutlineDiscussion;
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
      if (masterOutlineDiscussion
        && !isValidMasterOutlineOutput(editorOpinion.output)) {
        throw new Error('活动主编回复缺少有效的剧情总纲落库结构，不能把普通讨论总结伪装成剧情总纲');
      }
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
      const effectiveEditorOutput = editorOpinion.effective ?? prepareEffectiveOutput(editorOpinion.output);
      const settingCandidates = new SettingOutlineWorkspaceService(this.database, this.clock).recordDiscussionCandidates(scope, {
        discussionId: brief.discussionId,
        decisionId,
        scopeText: brief.scopeText,
        content: brief.scopeText.includes('【设定大纲成组讨论资料包】')
          ? editorOpinion.output
          : effectiveEditorOutput.fullContent
      });
      if (brief.scopeText.includes('【设定大纲成组讨论资料包】') && settingCandidates.length === 0) {
        throw new Error('活动主编回复缺少有效的“设定大纲落库”结构，不能把整段讨论摘要伪装成多项设定');
      }
      const summaryMessageId = this.addEditorMessage(
        scope,
        brief.conversationId,
        editor,
        brief.discussionId,
        decisionId,
        effectiveEditorOutput,
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
      this.database.prepare(`
        UPDATE task_phases
        SET status = ?, heartbeat_at = ?, completed_at = ?
        WHERE owner_id = ? AND book_id = ? AND task_id = ? AND status = 'working'
      `).run(cancelled ? 'cancelled' : 'failed', now, now, scope.ownerId, scope.bookId, taskId);
      if (!cancelled) {
        this.addTaskFailureMessage(scope, brief.conversationId, taskId);
      }
      throw error;
    }
  }

  private addTaskFailureMessage(scope: BookScope, conversationId: string, taskId: string): void {
    const existing = this.database.prepare(`
      SELECT 1 FROM messages
      WHERE conversation_id = ? AND owner_id = ? AND book_id = ?
        AND message_type = 'task_failure'
        AND json_extract(references_json, '$[0].taskId') = ?
      LIMIT 1
    `).get(conversationId, scope.ownerId, scope.bookId, taskId);
    if (existing !== undefined) return;
    const completedOpinions = (this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM discussion_opinions o
      JOIN tasks t
        ON json_extract(t.task_brief_json, '$.discussionId') = o.discussion_id
        AND t.owner_id = o.owner_id AND t.book_id = o.book_id
      WHERE t.task_id = ? AND t.owner_id = ? AND t.book_id = ?
    `).get(taskId, scope.ownerId, scope.bookId) as { count: number }).count;
    const progress = completedOpinions > 0
      ? `已经完成的 ${completedOpinions} 份成员意见和讨论进度都已保存，重试时会从检查点继续，不会重复调用已经成功的成员。`
      : '讨论资料和任务记录都已保存，恢复模型服务后可以从当前任务继续。';
    const content = `这轮讨论在主编整理时没有顺利完成。${progress}请在左侧“任务”中打开这项失败任务，点击“继续重试”。`;
    this.database.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type,
        message_type, content, references_json, created_at
      ) VALUES (?, ?, ?, ?, 'system', 'task_failure', ?, ?, ?)
    `).run(
      this.ids.next(),
      conversationId,
      scope.ownerId,
      scope.bookId,
      content,
      JSON.stringify([{ taskId, completedOpinions }]),
      this.clock.now().toISOString()
    );
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
    decisionId: string,
    editorSummary: EffectiveOutputResult,
    purpose: DiscussionPurpose
  ): string {
    const confirmation = purpose === 'creative_exploration'
      ? '您可以继续讨论、要求重大改向或试写；方向明确后直接说“锁定当前方向”。'
      : purpose === 'locked_planning'
        ? '如果认可故事弧跨度和未来1至3章的滚动规划，直接说“确认当前规划”。'
        : '如果接受这份方案，直接说“确认当前方案”。';
    // 原始岗位意见仍保存在 discussion_opinions 与模型调用审计中；作者聊天只显示主编整理后的结论。
    const editorVisible = editorSummary.format === 'fallback'
      ? '这轮意见已经收齐了，但整理时出了点问题。为了不把内部杂乱内容发给您，我先把它拦下；您可以继续追问，我会沿着当前讨论接着处理。'
      : editorSummary.visibleContent;
    const summary = [
      editorVisible,
      confirmation
    ].filter(Boolean).join('\n\n');
    const references: unknown[] = [{ discussionId, decisionId }];
    const effectiveReference = createEffectiveOutputReference(editorSummary);
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

function planningHierarchySources(
  database: DatabaseSync,
  scope: BookScope,
  scopeText: string,
  purpose: DiscussionPurpose
): Array<{ sourceType: string; sourceId: string; content: string; reason: string; priority: number }> {
  const masterWorkshop = scopeText.includes('【剧情总纲专项讨论资料包】');
  const rollingPlan = purpose === 'locked_planning';
  if (!masterWorkshop && !rollingPlan) return [];
  const state = database.prepare(`
    SELECT active_style_version_id, setting_baseline_version_id,
      master_outline_version_id
    FROM book_planning_states WHERE owner_id = ? AND book_id = ?
  `).get(scope.ownerId, scope.bookId) as {
    active_style_version_id: string | null;
    setting_baseline_version_id: string | null;
    master_outline_version_id: string | null;
  } | undefined;
  if (state === undefined) return [];
  const requested = [
    { id: state.active_style_version_id, type: 'style', reason: '可追溯表达策略；规划按当前场景选择必要表达，不固定全书情绪' },
    { id: state.setting_baseline_version_id, type: 'setting', reason: '已确认设定大纲，是剧情推演不可违背的上游边界' },
    ...(rollingPlan
      ? [{ id: state.master_outline_version_id, type: 'master_outline', reason: '已确认剧情总纲；只提取与当前故事弧和近期章纲相关的阶段边界' }]
      : [])
  ].filter((item): item is { id: string; type: string; reason: string } => item.id !== null);
  return requested.flatMap((item) => {
    const row = database.prepare(`
      SELECT artifact_version_id, content_json FROM artifact_versions
      WHERE artifact_version_id = ? AND owner_id = ? AND book_id = ? AND status = 'selected'
    `).get(item.id, scope.ownerId, scope.bookId) as { artifact_version_id: string; content_json: string } | undefined;
    return row === undefined ? [] : [{
      sourceType: `planning:${item.type}`,
      sourceId: row.artifact_version_id,
      content: compactPlanningArtifactForDiscussion(
        item.type,
        row.content_json,
        rollingPlan && item.type === 'setting' ? 12 : 30,
        !((masterWorkshop || rollingPlan) && item.type === 'setting')
      ),
      reason: item.reason,
      priority: 99
    }];
  });
}

export function compactPlanningArtifactForDiscussion(
  type: string,
  contentJson: string,
  settingItemTokenLimit = 30,
  includeSettingOutline = true
): string {
  if (type !== 'setting') return contentJson;
  try {
    const parsed = stripPlanningAuditMetadata(JSON.parse(contentJson)) as Record<string, unknown>;
    const positioning = parsed.positioning as Record<string, { value?: unknown }> | undefined;
    const openingReference = parsed.openingReference as { mustFollow?: unknown } | undefined;
    const outline = parsed.settingOutline as { items?: unknown } | undefined;
    const items = Array.isArray(outline?.items) ? outline.items : [];
    return JSON.stringify({
      title: parsed.title,
      positioning: positioning === undefined
        ? undefined
        : Object.fromEntries(Object.entries(positioning).map(([key, entry]) => [key, entry?.value])),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map((tag) => typeof tag === 'object' && tag !== null
          ? (tag as { name?: unknown }).name
          : tag)
        : [],
      characters: parsed.characters,
      mustFollow: openingReference?.mustFollow,
      // 总纲整理与滚动章纲都不应把六十余项全书设定全部塞给每个岗位。开书定位、
      // 角色和必须遵守项仍作为硬边界；与本轮剧情相关的详细设定由混合检索按需召回。
      settingOutline: includeSettingOutline
        ? items.map((item) => {
            const record = item as Record<string, unknown>;
            const content = typeof record.content === 'string'
              ? boundedHeadAndTail(record.content, settingItemTokenLimit)
              : record.content;
            return {
              itemKey: record.itemKey,
              label: record.label,
              content
            };
          })
        : undefined
    });
  } catch {
    return contentJson;
  }
}

function stripPlanningAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPlanningAuditMetadata);
  if (value === null || typeof value !== 'object') return value;
  const auditOnlyKeys = new Set([
    'sourceDiscussionId',
    'sourceDecisionId',
    'sourceStatus',
    'confirmedAt'
  ]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !auditOnlyKeys.has(key))
      .map(([key, child]) => [key, stripPlanningAuditMetadata(child)])
  );
}

function hasRequiredWorkflowArtifact(
  scopeText: string,
  purpose: DiscussionPurpose,
  output: string
): boolean {
  if (scopeText.includes('【剧情总纲专项讨论资料包】')) {
    return isValidMasterOutlineOutput(output);
  }
  if (scopeText.includes('【设定大纲成组讨论资料包】')) {
    const requiredKeys = new Set(settingBatchKeys(scopeText));
    const deposits = parseSettingOutlineDeposit(output);
    return requiredKeys.size > 0
      && requiredKeys.size === deposits.length
      && deposits.every((deposit) => requiredKeys.has(deposit.itemKey));
  }
  // 滚动章纲仍兼容历史确定性适配器的“规划落库”双段输出；其结构在老板
  // 确认时由 PlanningArtifactService 统一校验。这里仅拦截已统一为
  // workflowArtifact 合同的设定和剧情总纲。
  void purpose;
  return true;
}

export function discussionOutputTokenLimit(
  roleKey: RoleKey | CreativeRoleKey,
  isEditor: boolean,
  phase: DiscussionPhase,
  scopeText: string,
  purpose: DiscussionPurpose = 'open_discussion'
): number {
  // 主编只需要输出面向作者的结论和一个结构化规划产物。完整编剧意见已经
  // 单独保存在 discussion_opinions；继续申请 4k 输出会让真实方舟 Plan
  // 在 7k 级输入下更容易被上游网关中断。
  if (isEditor && scopeText.includes('【设定大纲成组讨论资料包】')) {
    // 成组设定必须逐项返回可解析的落库合同。固定 3.6k 会在 8—12 项批次中
    // 截断 JSON，造成“模型已成功、任务仍失败”的假性恢复循环。
    // 预算随本批条目数有界增长，不影响普通聊天或总纲的精简输出。
    return Math.min(8_000, Math.max(3_600, settingBatchKeys(scopeText).length * 700));
  }
  // 阶段式剧情总纲包含每阶段主线、起承转合、阶段总结、伏笔和后续方向。真实
  // 四阶段结果已证明 4.5k 会恰好在最后一个阶段中间截断。此前 6k 超时的根因
  // 是主编输入曾膨胀到 7k 左右；现在完整意见改为结构化骨架摘要，输入已被控制，
  // 因此为总纲恢复 6k，靠结构校验保证不会把截断结果误当成功。
  if (isEditor && scopeText.includes('【剧情总纲专项讨论资料包】')) {
    return 6_000;
  }
  // 滚动章纲的结构明显短于全书阶段总纲，4.5k 足以容纳面向作者的结论
  // 与完整 workflowArtifact；普通开放讨论仍保持较小上限。
  if (isEditor && purpose === 'locked_planning') {
    return 4_500;
  }
  // 剧情总纲要求两名编剧各自提交完整的阶段式落库结构。4k 在四阶段及以上
  // 方案中会把末尾 JSON 截断；这里与主编保持同一有界上限，重试时再依据结构
  // 校验只重做被截断的一席，不重复调用已经成功的编剧。
  if (!isEditor
    && phase === 'independent'
    && scopeText.includes('【剧情总纲专项讨论资料包】')
    && (roleKey === 'lead_screenwriter' || roleKey === 'second_screenwriter')) {
    return 6_000;
  }
  if (isEditor) return 3_600;
  if (phase === 'cross_review') return 2_500;
  if (roleKey === 'lead_screenwriter' || roleKey === 'second_screenwriter') return 4_000;
  return 2_000;
}

export function discussionContextTokenBudget(isEditor: boolean): number {
  // 主编资料包保留老板原话、规划正史和四份意见的首尾摘要；完整意见通过
  // opinionId 可追溯，不在同一调用里重复注入。编剧仍保留原有 8k 上限。
  return isEditor ? 7_200 : 8_000;
}

export function discussionRetrievalQuery(scopeText: string): string {
  if (!scopeText.includes('【设定大纲成组讨论资料包】')) {
    return estimateTokens(scopeText) <= 1_200 ? scopeText : boundedHeadAndTail(scopeText, 1_200);
  }
  const bookTitle = /(?:^|\n)书籍：([^\n]+)/u.exec(scopeText)?.[1]?.trim() ?? '';
  const targetJson = /(?:^|\n)本批设定项JSON：(\[[^\n]*\])/u.exec(scopeText)?.[1];
  if (targetJson === undefined) return `设定大纲 ${bookTitle}`.trim();
  try {
    const targets = JSON.parse(targetJson) as Array<{ groupTitle?: unknown; label?: unknown; prompt?: unknown }>;
    const terms = targets.flatMap((target) => [
      typeof target.groupTitle === 'string' ? target.groupTitle : '',
      typeof target.label === 'string' ? target.label : '',
      typeof target.prompt === 'string' ? target.prompt : ''
    ]).filter((value) => value.length > 0);
    return [`设定大纲`, bookTitle, ...terms].filter((value) => value.length > 0).join(' ');
  } catch {
    return `设定大纲 ${bookTitle}`.trim();
  }
}

export function compactOpinionsForEditor(opinions: CollectedOpinion[]): CollectedOpinion[] {
  return opinions.map((opinion) => ({
    ...opinion,
    // 阶段式总纲不能使用普通“首尾各截一段”压缩，否则主编看不到中间阶段，
    // 容易把两套真实方案误合成为第三套臆造方案。对可校验的编剧总纲保留完整
    // 阶段骨架，只压缩每个字段的措辞；交叉质疑和普通意见继续使用短摘要。
    // 完整意见仍单独持久化，可从 opinionId 追溯。
    output: opinion.phase === 'independent'
      ? compactMasterOutlineForEditor(opinion.output) ?? boundedHeadAndTail(opinion.output, 140)
      : boundedHeadAndTail(opinion.output, 180)
  }));
}

function compactMasterOutlineForEditor(output: string): string | null {
  let outline: ReturnType<typeof parseMasterOutlineDepositOutput>;
  try {
    outline = parseMasterOutlineDepositOutput(output);
  } catch {
    return null;
  }
  if (outline === null) return null;
  const shorten = (value: string, tokens: number): string => boundedHeadAndTail(value, tokens);
  // 这里故意不用 JSON：两份总纲重复的英文键名与转义符会额外占用约两千
  // Token，却不增加任何创作信息。中文骨架保留同样的阶段字段和先后关系，
  // 完整机器结构仍由 opinionId 指向原始意见，可随时追溯。
  return [
    `总纲前提：${shorten(outline.premise, 20)}`,
    `核心冲突：${shorten(outline.coreConflict, 20)}`,
    `主角成长：${shorten(outline.protagonistArc, 20)}`,
    ...outline.majorStages.map((stage) => [
      `阶段${stage.stageNumber}｜${stage.chapterRange.start}-${stage.chapterRange.end}章｜${stage.title}`,
      `主线：遭遇=${shorten(stage.mainline.encounter, 18)}；解决=${shorten(stage.mainline.resolution, 18)}；结果=${shorten(stage.mainline.result, 18)}`,
      `起承转合：起=${shorten(stage.structure.setup, 10)}；承=${shorten(stage.structure.development, 10)}；转=${shorten(stage.structure.turn, 10)}；合=${shorten(stage.structure.conclusion, 10)}`,
      `阶段总结：${shorten(stage.stageSummary, 14)}`,
      `待回收：${stage.pendingThreads.slice(0, 2).map((item) => shorten(item, 8)).join('｜') || '无'}`,
      `后续方向：${shorten(stage.followUpDirection, 14)}`
    ].join('\n')),
    `结局方向：${shorten(outline.endingDirection, 20)}`,
    `故事承诺：${outline.storyPromises.slice(0, 3).map((item) => shorten(item, 8)).join('｜')}`,
    `开放问题：${outline.openQuestions.slice(0, 3).map((item) => shorten(item, 8)).join('｜')}`
  ].join('\n');
}

export function normalizeDiscussionCheckpoints(
  opinions: CollectedOpinion[],
  masterOutlineDiscussion: boolean
): CollectedOpinion[] {
  const latest = new Map<string, CollectedOpinion>();
  for (const opinion of opinions) {
    if (
      masterOutlineDiscussion
      && opinion.phase === 'independent'
      && ['lead_screenwriter', 'second_screenwriter'].includes(opinion.roleKey)
      && !isValidMasterOutlineOutput(opinion.output)
    ) {
      continue;
    }
    latest.set(`${opinion.agentId}:${opinion.phase}`, opinion);
  }
  return [...latest.values()];
}

function isValidMasterOutlineOutput(output: string): boolean {
  try {
    return parseMasterOutlineDepositOutput(output) !== null;
  } catch {
    return false;
  }
}

export function compactRetrievalHardSourcesForEditor<T extends { content: string }>(sources: T[]): T[] {
  // The editor already receives the selected setting/master/volume artifacts as first-class hard
  // sources. Retrieval hits are supporting evidence, so inject only a bounded, traceable excerpt
  // instead of duplicating entire canon chunks and overflowing the non-truncatable context budget.
  return sources.slice(0, 4).map((source) => ({
    ...source,
    content: boundedHeadAndTail(source.content, 250)
  }));
}

export function compactOpinionsForCrossReview(opinions: CollectedOpinion[]): CollectedOpinion[] {
  return opinions.map((opinion) => ({
    ...opinion,
    // 交叉质疑需要看见另一方案的核心主张、风险和结尾跨度估算，但不需要把整份长文
    // 作为不可截断硬来源再次注入。完整原文已持久化并可按 opinionId 追溯。
    output: boundedHeadAndTail(opinion.output, 600)
  }));
}

function boundedHeadAndTail(content: string, tokenLimit: number): string {
  if (estimateTokens(content) <= tokenLimit) return content;
  const headLimit = Math.floor(tokenLimit * 0.75);
  const tailLimit = tokenLimit - headLimit;
  let head = '';
  let headTokens = 0;
  for (const character of content) {
    const cost = estimateTokens(character);
    if (headTokens + cost > headLimit) break;
    head += character;
    headTokens += cost;
  }
  let tail = '';
  let tailTokens = 0;
  for (let index = content.length - 1; index >= head.length; index -= 1) {
    const character = content[index] ?? '';
    const cost = estimateTokens(character);
    if (tailTokens + cost > tailLimit) break;
    tail = `${character}${tail}`;
    tailTokens += cost;
  }
  return `${head}\n\n[中间展开内容已省略；完整原文保存在讨论证据中]\n\n${tail}`;
}

function buildDiscussionPrompt(input: {
  participant: ParticipantRow;
  purpose: DiscussionPurpose;
  phase: DiscussionPhase;
  scopeText: string;
  requestedChapterCount: number | null;
  firstChapterNumber: number | null;
  evidenceContext: Array<Record<string, unknown>>;
  peerOpinions: CollectedOpinion[];
}): string {
  const {
    participant, purpose, phase, scopeText, requestedChapterCount, firstChapterNumber, evidenceContext, peerOpinions
  } = input;
  const isMasterOutlineWorkshop = scopeText.includes('【剧情总纲专项讨论资料包】');
  const isGroupedSettingWorkshop = scopeText.includes('【设定大纲成组讨论资料包】');
  const groupedSettingKeys = isGroupedSettingWorkshop ? settingBatchKeys(scopeText) : [];
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
      isMasterOutlineWorkshop
        ? '这是剧情总纲专项讨论。只能综合两位编剧已经提交并通过结构校验的完整阶段方案；按连续章节范围规划全书阶段，写清每阶段的主线遭遇、解决方式、结果、起承转合、阶段总结、待回收信息与伏笔、后续方向。不得凭空补造第三套通用总纲，不得写逐章事件。'
        : isGroupedSettingWorkshop
            ? '这是设定大纲成组讨论。只讨论资料包列出的非剧情设定项；先解决项目间依赖和冲突，再给每一项形成可直接保存、互不重复的明确结论。不得生成剧情总纲、章纲或正文。'
            : purpose === 'creative_exploration'
              ? '现在只做方向比较：整理2至5个候选方向，逐项写清收益、代价、因果风险、人物影响、关键分歧和未知项；提出最多3个高价值追问。不得估算章节数，不得生成章纲，不得安排主笔开写。'
              : purpose === 'locked_planning'
                ? '方向已经由老板锁定。请综合两位编剧的独立跨度估算，形成故事弧目标、起止状态、关键转折，并只细化未来1至3章；远期不得展开成整批僵硬章纲。'
                : '请明确回应老板，综合岗位意见给出推荐、理由、风险和可执行下一步。',
      isGroupedSettingWorkshop
        ? `在同一个JSON对象的workflowArtifact字段输出设定大纲落库结构：{"type":"setting_outline","payload":{"items":[{"itemKey":"资料包中的原始编号","content":"该项可直接保存的明确设定，不写讨论过程、备选方案或待确认问题"}]}}。items必须且只能覆盖这些编号，每个编号恰好一次：${groupedSettingKeys.join('、')}。content中禁止出现成员姓名、主编、编剧、方案A/B/C、共识、分歧、待老板或需老板确认；存在分歧时由你作出当前最合理且可逆的编辑判断，未知项另留在面向老板的正文说明中，不得塞进落库内容。`
        : '',
      isMasterOutlineWorkshop
        ? '在同一个JSON对象的workflowArtifact字段输出剧情总纲落库结构：{"type":"master_outline","payload":{"outlineSchema":"stage_master_v2","premise":"全书核心前提","coreConflict":"贯穿全书的核心冲突","protagonistArc":"主角从起点到终局的变化","majorStages":[{"stageNumber":1,"title":"第一阶段名称","chapterRange":{"start":1,"end":50},"mainline":{"encounter":"主角遇到什么事情","resolution":"最终怎么解决","result":"得到什么结果"},"structure":{"setup":"起：阶段开局与触发","development":"承：矛盾如何发展","turn":"转：方向发生什么变化","conclusion":"合：阶段如何收束"},"stageSummary":"阶段结束时人物、局势与成果的简明总结","pendingThreads":["待回收信息或伏笔"],"followUpDirection":"下一阶段从哪里继续"}],"endingDirection":"结局方向与需要兑现的因果","storyPromises":["读者承诺"],"openQuestions":["仍需老板确认的问题"]}}。majorStages至少2项；stageNumber从1连续递增；章节范围从第1章开始且相邻阶段必须首尾相接、不得重叠或留空；主线三项、起承转合、阶段总结和后续方向不得为空。起承转合是阶段总结视角，不是每章机械公式。'
        : '',
      purpose === 'locked_planning'
        ? [
            '在同一个JSON对象的workflowArtifact字段输出章纲V2落库结构：{"type":"chapter_outline","payload":{"outlineSchema":"chapter_outline_v2","arcTitle":"故事弧标题","arcGoal":"本弧目标","endingState":"本弧结束状态","estimatedChapterRange":{"minimum":最少章数,"recommended":建议章数,"maximum":最多章数},"chapters":[{"chapterNumber":绝对章号,"title":"不含第N章前缀的章名","chapterFunction":"本章在当前剧情阶段中的唯一作用","openingState":"开章时已经成立的局面","requiredEndingState":"本章结束时必须形成的局面","cast":[{"name":"姓名","objective":"本章当下目标","knowledgeBoundary":"此人此刻知道与不知道什么","chapterRole":"本章作用","stateChange":"可选，本章后变化"}],"conflict":{"surface":"表层冲突","underlying":"可选，深层冲突","oppositionGoal":"可选，对手目标","failureCost":"失败代价","successCost":"可选，成功代价"},"plotBeats":[{"order":1,"trigger":"触发","action":"人物行动","resistance":"可选，阻力","turn":"可选，转折","result":"该节点结果"}],"experience":{"primaryTone":"可选，本章主情绪","emotionalCurve":["3至5个情绪变化"],"payoffPoints":["0至2个爽点"],"pressurePoints":["0至2个压力或虐点"],"readerEffect":"可选，预期读者感受"},"descriptionFocus":{"primary":["主要描写"],"secondary":["次要描写"],"compress":["压缩处理"]},"informationControl":{"reveals":["本章揭示"],"concealed":["本章保留"],"gaps":["信息差"]},"threadActions":[{"action":"plant或advance或payoff","summary":"伏笔动作，最多2项"}],"ending":{"result":"章末结果","stateChanges":["状态变化"],"hook":"章末钩子","nextChapterInterface":"下一章承接点"},"mustImplement":["必须实现"],"mustNotViolate":["不得违反"],"allowedCandidates":["允许主笔选择的候选"],"creativeFreedom":["对白、动作、意象、局部调度等自由区"]}]}}。',
            `本次只能规划第${firstChapterNumber ?? 1}章至第${(firstChapterNumber ?? 1) + (requestedChapterCount ?? 3) - 1}章，共${requestedChapterCount ?? 3}章。chapters必须按绝对章号连续给出且chapterNumber逐项严格等于该范围；不得从第5章等其他章位开始，不得跳章、错位或只写后续章节。已有候选正文也必须在相应章位生成修正版章纲。`,
            '每章必须有3至5个连续编号的剧情推进节点、1至12名出场人物、明确失败代价和章末承接；章节功能不得重复。体验、描写和信息控制是软提示，可按本章需要留空，不能为了填表硬造爽点或虐点。不要复述人物完整传记、世界观全文或前章全文。'
          ].join('')
        : '',
      (isMasterOutlineWorkshop || isGroupedSettingWorkshop || purpose === 'locked_planning')
        ? '这是必须落库的规划任务：先确保workflowArtifact完整、字段齐全且JSON闭合，再写面向老板的说明。answer不超过300字；keyPoints、risks、questions各最多3项；alternatives最多1项；details设为null。不要复述两位编剧的长篇论证，完整意见已经单独保存。'
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
      isMasterOutlineWorkshop
        ? '只质疑对方阶段总纲：检查章节范围是否连续、阶段结果能否成为下一阶段起点、主角动机与代价是否成立、起承转合是否真正总结了阶段变化、待回收伏笔是否能被后续方向承接。指出最强之处、一个关键盲点、一个失败条件和一项改进；不得重新生成完整总纲。'
        : '指出对方方案最强之处、一个关键盲点、一个会使方案失败的条件，并给出一项改进；保留你与对方真正不同的判断，不得为形成共识而趋同。',
      '不得重新估算章节跨度，不得生成章纲，不得复述老板原话。'
    ].join('\n');
  }
  return [
    `你是${participant.display_name}。请在看不到另一位编剧答案的前提下，独立分析这个小说创作问题：${scopeText}。`,
    `按当前问题检索到的正史与规划证据：${JSON.stringify(evidenceContext)}`,
    isMasterOutlineWorkshop
      ? '独立提出全书级方案：核心冲突如何持续升级、主角成长如何改变选择、各大阶段如何因果相接、结局如何兑现前文承诺。不要写逐章事件。'
      : isGroupedSettingWorkshop
          ? '独立为资料包中的全部非剧情设定项提出一套相互兼容的设定方案。逐项给出明确规则、边界和代价，优先服从书名、开书资料、主角身份和必须遵守项；不得把标签当成主角性别或虚构已确认资料。'
        : '给出结构清楚但保留创造性的方案，至少说明因果链、人物动机与代价、合理惊喜、失败风险、未知项和一项可执行建议；不要客套、自我介绍或重复结论。',
    isMasterOutlineWorkshop
      ? '这是剧情总纲落库任务。你必须直接提交一份完整可校验的阶段总纲，不是只提建议。在同一个JSON对象的workflowArtifact字段输出：{"type":"master_outline","payload":{"outlineSchema":"stage_master_v2","premise":"全书核心前提","coreConflict":"贯穿全书的核心冲突","protagonistArc":"主角从起点到终局的变化","majorStages":[{"stageNumber":1,"title":"阶段名","chapterRange":{"start":1,"end":50},"mainline":{"encounter":"主角遇到什么","resolution":"怎么解决","result":"什么结果"},"structure":{"setup":"起","development":"承","turn":"转","conclusion":"合"},"stageSummary":"阶段总结","pendingThreads":["待回收信息与伏笔"],"followUpDirection":"后续方向"}],"endingDirection":"结局方向","storyPromises":["作品承诺"],"openQuestions":["仍需老板确认的问题"]}}。至少2阶段；编号和章节连续；每个必填文本都要具体。起承转合只总结阶段变化，不得压成逐章公式。'
      : '',
    purpose === 'creative_exploration'
      ? '当前仍是开放推演阶段：不得估算章节数，不得生成章纲，不得假定老板已经锁定方向。'
      : '',
    purpose === 'locked_planning' && ['lead_screenwriter', 'second_screenwriter'].includes(participant.role_key)
      ? '方向已经锁定。回复的第一行必须先输出且完整闭合：章节跨度估算 {"minimum":最少章数,"recommended":建议章数,"maximum":最多章数,"units":[{"unit":"推进单元","suggestedChapters":章数}],"assumptions":["假设"],"uncertainty":["不确定项"]}。必须先写这行，再写其他分析；章数必须为1至30的整数，且最少≤建议≤最多。'
      : ''
  ].filter(Boolean).join('\n');
}

function settingBatchKeys(scopeText: string): string[] {
  const match = scopeText.match(/^本批设定项JSON：(.+)$/mu);
  if (match?.[1] === undefined) return [];
  try {
    const value = JSON.parse(match[1]) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const key = (item as Record<string, unknown>).itemKey;
      return typeof key === 'string' && key.trim().length > 0 ? [key.trim()] : [];
    });
  } catch {
    return [];
  }
}

interface SpanEstimate {
  minimum: number;
  recommended: number;
  maximum: number;
  units: unknown[];
  assumptions: unknown[];
  uncertainty: unknown[];
}

export function parseSpanEstimateOutput(output: string, deterministicFallback: boolean): SpanEstimate {
  const marker = /章节跨度估算(?:\*\*)?/u.exec(output);
  // 真实供应商偶尔会完整返回最后的 JSON 契约，却漏掉供人阅读的“章节跨度估算”标题。
  // 机器边界是结构化契约，不应因为展示标题缺失而丢弃一份已经可验证的真实结果。
  // 无标题时从末尾反向检查，优先取模型按要求放在结尾的跨度对象。
  const candidates = marker === null
    ? extractCompleteJsonObjects(output).reverse()
    : extractCompleteJsonObjects(output.slice(marker.index + marker[0].length));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as Partial<SpanEstimate>;
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

function extractCompleteJsonObjects(value: string): string[] {
  const objects: string[] = [];
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          objects.push(value.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return objects;
}
