import type { DatabaseSync } from 'node:sqlite';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ContextPackService, estimateTokens } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { RoleKey } from '../../domain/roles.js';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { DomainError } from '../../domain/errors.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../infrastructure/models/model-runtime-config.js';
import { DiscussionService } from './discussion-service.js';
import { PlotSpanEstimateService } from '../continuity/plot-span-estimate-service.js';
import { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import {
  AUTHOR_PLAIN_LANGUAGE_RULES,
  EFFECTIVE_OUTPUT_CONTRACT,
  prepareEffectiveOutput,
  type EffectiveOutputResult
} from '../presentation/author-output-service.js';
import { HybridRetrievalService } from '../memory/hybrid-retrieval-service.js';
import { RetrievalContextSourceService } from '../memory/retrieval-context-source-service.js';
import { RetrievalOrchestrationRepository } from '../../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';
import { ChunkSnapshotRepository } from '../../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { EditorLeaseService } from '../editors/editor-lease-service.js';
import { createHash } from 'node:crypto';
import {
  parseSettingOutlineDeposit,
  SettingOutlineWorkspaceService
} from '../knowledge/setting-outline-workspace-service.js';
import { SettingCollaborationRepository } from '../../infrastructure/db/repositories/setting-collaboration-repository.js';
import { parseFusionSegments, parseSettingProposalStructure } from '@wenmi/contracts';
import {
  nextChapterPlanningNumber,
  parseMasterOutlineDepositOutput,
  parsePlanningDepositOutput
} from '../artifacts/planning-artifact-service.js';
import { compactLockedPlanningScope } from './locked-planning-context.js';
import { chapterOutlineHardBoundaryFailure } from '../../domain/chapter-outline-boundaries.js';
import type { ChapterOutlineV2 } from '../../domain/artifact-schemas.js';
import {
  chapterOutlineStageBoundaryFailure,
  stageBoundaryContractLine
} from '../../domain/chapter-outline-stage-boundary.js';
const groupedSettingMarkers = ['【设定成组讨论资料包】', '【设定' + '大纲成组讨论资料包】'] as const;

function isGroupedSettingScope(value: string): boolean {
  return groupedSettingMarkers.some((marker) => value.includes(marker));
}

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

type DiscussionPurpose = 'open_discussion' | 'creative_exploration' | 'locked_planning' | 'creative_concept_panel' | 'setting_proposal_panel' | 'setting_synthesis' | 'stage_outline_panel' | 'stage_outline_synthesis';
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
      purpose?: DiscussionPurpose;
      settingItemKey?: string;
      selectedFragmentIds?: string[];
      requestedChapterCount?: 1 | 3 | 4 | 5 | null;
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
        AND (a.agent_id = ? OR ? = 1 OR r.role_key NOT IN ('chief_editor', 'deputy_editor'))
      ORDER BY CASE WHEN a.agent_id = ? THEN 1 ELSE 0 END, p.agent_id
    `).all(
      brief.discussionId,
      scope.ownerId,
      scope.bookId,
      task.assigned_agent_id,
      brief.purpose === 'stage_outline_panel' ? 1 : 0,
      task.assigned_agent_id
    ) as unknown as ParticipantRow[];
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
          tokenBudget: discussionContextTokenBudget(isEditor, brief.scopeText),
          policyVersion: 'object-collaboration-context-v2',
          hardSources,
          optionalSources: retrieved.optionalSources
        });
        const evidenceContext = pack.sources
          .filter((source) => source.sourceType.startsWith('retrieval:') || source.sourceType.startsWith('planning:'))
          .map((source) => ({ sourceType: source.sourceType, sourceId: source.sourceId, reason: source.reason, content: source.content }));
        const firstChapterNumber = brief.purpose === 'locked_planning'
          ? nextChapterPlanningNumber(this.database, scope)
          : null;
        const prompt = buildDiscussionPrompt({
          participant,
          purpose: brief.purpose ?? 'open_discussion',
          phase,
          scopeText: promptScopeText,
          requestedChapterCount: brief.requestedChapterCount ?? null,
          firstChapterNumber,
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
        const displayablePanelPayloadRequired = brief.purpose === 'creative_concept_panel'
          || brief.purpose === 'setting_proposal_panel'
          || brief.purpose === 'stage_outline_panel';
        let reusableIsValid = reusable !== undefined
          && (!isEditor || hasRequiredWorkflowArtifact(
            prompt,
            brief.purpose ?? 'open_discussion',
            reusable.output_text,
            firstChapterNumber,
            brief.requestedChapterCount ?? null
          ))
          && (!specialistMasterOutlineRequired || isValidMasterOutlineOutput(reusable.output_text))
          && (!displayablePanelPayloadRequired || !prepareEffectiveOutput(reusable.output_text).rejectedMachinePayload);
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
        let invalidStructuredOutput: string | null = null;
        let structuredValidationFailure: string | null = null;
        const maxOutputTokens = discussionOutputTokenLimit(
          participant.role_key,
          isEditor,
          phase,
          brief.scopeText,
          brief.purpose ?? 'open_discussion'
        );
        for (let technicalTry = 1; result === undefined && technicalTry <= 2; technicalTry += 1) {
          const needsStructuredRecovery = invalidStructuredOutput !== null
            || structuredValidationFailure !== null;
          const attemptPrompt = technicalTry === 1 || !needsStructuredRecovery
            ? prompt
            : buildStructuredArtifactRecoveryPrompt(
                prompt,
                brief.purpose ?? 'open_discussion',
                firstChapterNumber,
                brief.requestedChapterCount ?? null,
                invalidStructuredOutput,
                structuredValidationFailure
              );
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
              input: attemptPrompt,
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
              agentId: participant.agent_id, prompt: attemptPrompt, maxOutputTokens
            });
            const artifactFailure = isEditor
              ? workflowArtifactValidationFailure(
                  prompt,
                  brief.purpose ?? 'open_discussion',
                  result.output,
                  firstChapterNumber,
                  brief.requestedChapterCount ?? null
                )
              : null;
            const displayPayloadFailure = displayablePanelPayloadRequired
              && prepareEffectiveOutput(result.output).rejectedMachinePayload
              ? '返回的方案不完整或结构被截断'
              : null;
            const outputValidationFailure = artifactFailure ?? displayPayloadFailure;
            if (outputValidationFailure !== null) {
              invalidStructuredOutput = result.output;
              structuredValidationFailure = outputValidationFailure;
              lastError = new Error(`活动主编回复缺少当前规划阶段要求的完整落库结构：${artifactFailure}`);
              lastError = new Error(`模型方案没有完整返回：${outputValidationFailure}`);
              result = undefined;
              if (technicalTry === 2) throw lastError;
            }
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
        const groupedSettingDiscussion = isGroupedSettingScope(brief.scopeText);
        const output = isEditor && (
          brief.purpose === 'locked_planning'
          || brief.scopeText.includes('【剧情总纲专项讨论资料包】')
          || groupedSettingDiscussion
        )
          ? result.output
          : effective?.fullContent ?? result.output;
        if (isEditor && !hasRequiredWorkflowArtifact(
          prompt,
          brief.purpose ?? 'open_discussion',
          output,
          firstChapterNumber,
          brief.requestedChapterCount ?? null
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
      if (editor === undefined && brief.purpose !== 'setting_proposal_panel') throw new Error('讨论缺少当前活动主编');
      const specialists = participants.filter((participant) => participant.agent_id !== task.assigned_agent_id);
      const independent: CollectedOpinion[] = [];
      for (const specialist of specialists) {
        independent.push(await collectOpinion(specialist, 'independent'));
      }

      if (brief.purpose === 'stage_outline_synthesis') {
        if (specialists.length !== 0) throw new Error('阶段剧情整理只能由活动主编执行');
        const editorOpinion = await collectOpinion(editor!, 'independent', []);
        if (!isValidMasterOutlineOutput(editorOpinion.output)) {
          throw new Error('活动主编没有提交有效的当前阶段剧情总纲，不能把普通回复伪装成可保存规划');
        }
        const stage = discussions.require(scope, brief.discussionId).status;
        if (stage === 'collecting') discussions.setStage(scope, brief.discussionId, 'collecting', 'synthesizing');
        const decisionId = discussions.synthesize(scope, brief.discussionId, {
          recommendation: { summary: editorOpinion.output, evidence: [{ opinionId: editorOpinion.opinionId, role: editorOpinion.role }] },
          alternatives: [],
          disagreements: [],
          impacts: [{ scope: 'current_stage_master_outline_candidate', cashCostCny: 0, requiresBossConfirmation: true }]
        });
        new TaskService(this.database, this.releaseId, this.clock).complete(scope, taskId, workerId, leaseFence);
        return { discussionId: brief.discussionId, decisionId, opinionCount: 1 };
      }

      if (brief.purpose === 'creative_concept_panel' || brief.purpose === 'setting_proposal_panel' || brief.purpose === 'stage_outline_panel') {
        // 设定提案三席是编剧A、编剧B与设定成员；活动主编不提交提案，只在作者勾选后融合。
        const editorOpinion = brief.purpose === 'setting_proposal_panel'
          ? null
          : await collectOpinion(editor!, 'independent', []);
        const proposals = editorOpinion === null ? [...independent] : [editorOpinion, ...independent];
        if (brief.purpose === 'setting_proposal_panel' && proposals.length !== 3) {
          throw new Error('设定提案必须由编剧A、编剧B与设定三席各提交一份独立方案，不能伪装成已完成');
        }
        const preparedProposals = proposals.map((opinion) => ({
          opinion,
          output: prepareEffectiveOutput(opinion.output)
        }));
        const unusable = preparedProposals.find((proposal) => proposal.output.rejectedMachinePayload);
        if (unusable !== undefined) {
          throw new Error(`${unusable.opinion.role}的独立方案无法安全展示，三席讨论不能伪装成已完成`);
        }
        const stage = discussions.require(scope, brief.discussionId).status;
        if (stage === 'collecting') discussions.setStage(scope, brief.discussionId, 'collecting', 'synthesizing');
        const stageCandidates = brief.purpose === 'stage_outline_panel'
          ? preparedProposals.map(({ opinion, output }) => ({ opinion, candidate: output.visibleContent }))
          : [];
        if (brief.purpose === 'stage_outline_panel' && stageCandidates.length !== 3) {
          throw new Error('阶段剧情抽卡必须由主编、副编和一名编剧各提交一份独立候选，不能伪装成已完成');
        }
        const decisionId = discussions.synthesize(scope, brief.discussionId, {
          recommendation: {
            summary: '三席设定方案均为独立候选，等待老板选择、组合或改写；未自动形成共识。',
            evidence: proposals.map((opinion) => ({ opinionId: opinion.opinionId, role: opinion.role }))
          },
          alternatives: brief.purpose === 'stage_outline_panel'
            ? stageCandidates.map(({ opinion, candidate }, index) => ({ number: index + 1, role: opinion.role, proposal: candidate }))
            : proposals.map((opinion) => ({ role: opinion.role, proposal: opinion.output })),
          disagreements: [{ status: '保留三个独立判断，不交叉讨论，不投票，不自动合并', roles: proposals.map((opinion) => opinion.role) }],
          impacts: [{ scope: brief.purpose === 'stage_outline_panel' ? 'stage_outline_candidate_only' : 'setting_candidate_only', cashCostCny: 0, requiresBossConfirmation: true }]
        });
        if (brief.purpose === 'setting_proposal_panel') {
          this.persistSettingProposalFragments(scope, brief, preparedProposals);
        }
        new TaskService(this.database, this.releaseId, this.clock).complete(scope, taskId, workerId, leaseFence);
        return { discussionId: brief.discussionId, decisionId, opinionCount: proposals.length };
      }

      const settingSpecialistDiscussion = brief.scopeText.includes('【设定专项讨论资料包】')
        || isGroupedSettingScope(brief.scopeText);
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
      }

      const specialistEvidence = opinions.filter((opinion) => opinion.agentId !== editor!.agent_id);
      const editorOpinion = await collectOpinion(editor!, 'independent', specialistEvidence);
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
        content: isGroupedSettingScope(brief.scopeText)
          ? editorOpinion.output
          : effectiveEditorOutput.fullContent
      });
      if (isGroupedSettingScope(brief.scopeText) && settingCandidates.length === 0) {
        throw new Error('活动主编回复缺少有效的“设定落库”结构，不能把整段讨论摘要伪装成多项设定');
      }
      if (brief.purpose === 'setting_synthesis'
        && Array.isArray(brief.selectedFragmentIds) && brief.selectedFragmentIds.length > 0
        && typeof brief.settingItemKey === 'string' && settingCandidates.length > 0) {
        const fusionFields = parseModelJsonFields(editorOpinion.output);
        const segments = fusionFields === null ? null : parseFusionSegments(fusionFields.fusionSegments);
        if (segments === null) {
          throw new Error('活动主编回复缺少有效的fusionSegments段级来源标记，不能把未标注的文本伪装成碎片融合稿');
        }
        new SettingCollaborationRepository(this.database).saveFusionDraft(scope, {
          itemKey: brief.settingItemKey,
          taskId,
          selectedFragmentIds: brief.selectedFragmentIds,
          segmentsJson: JSON.stringify(segments),
          contentText: settingCandidates[0]!.content!,
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
      const failureCode = cancelled
        ? 'TASK_CANCELLED'
        : error instanceof DomainError
          ? error.code
          : 'DISCUSSION_FAILED';
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
      `).run(cancelled ? 'cancelled' : 'failed', failureCode, now,
        taskId, scope.ownerId, scope.bookId, workerId, now, leaseFence?.leaseToken ?? null,
        leaseFence?.leaseToken ?? null, leaseFence?.attemptNo ?? 0, scope.ownerId, scope.bookId);
      if (failure.changes !== 1) throw error;
      this.database.prepare(`
        UPDATE task_attempts SET status = ?, error_code = ?, completed_at = ?
        WHERE owner_id = ? AND book_id = ? AND task_id = ? AND attempt_no = ? AND status = 'working'
      `).run(cancelled ? 'cancelled' : 'failed', failureCode, now,
        scope.ownerId, scope.bookId, taskId, leaseFence?.attemptNo ?? claimedTask.currentAttemptNo);
      this.database.prepare(`
        UPDATE task_phases
        SET status = ?, heartbeat_at = ?, completed_at = ?
        WHERE owner_id = ? AND book_id = ? AND task_id = ? AND status = 'working'
      `).run(cancelled ? 'cancelled' : 'failed', now, now, scope.ownerId, scope.bookId, taskId);
      throw error;
    }
  }

  /**
   * 把三席提案的结构化碎片入库；解析失败的提案以整份方案作为单条兜底碎片
   * 并标记 implicit，绝不把解析失败伪装成结构化成功。
   */
  private persistSettingProposalFragments(
    scope: BookScope,
    brief: { discussionId: string; settingItemKey?: string },
    preparedProposals: Array<{ opinion: CollectedOpinion; output: { visibleContent: string } }>
  ): void {
    if (typeof brief.settingItemKey !== 'string' || brief.settingItemKey.length === 0) return;
    const repository = new SettingCollaborationRepository(this.database);
    const now = this.clock.now().toISOString();
    const rows: Array<{
      fragmentId: string; itemKey: string; discussionId: string; proposalId: string;
      memberName: string; roleKey: string | null; fragmentNo: number; text: string;
      implicit: boolean; now: string;
    }> = [];
    for (const { opinion, output } of preparedProposals) {
      const fields = parseModelJsonFields(opinion.output);
      const structure = fields === null ? null : parseSettingProposalStructure(fields);
      if (structure !== null) {
        for (const fragment of structure.fragments) {
          rows.push({
            fragmentId: this.ids.next(),
            itemKey: brief.settingItemKey,
            discussionId: brief.discussionId,
            proposalId: opinion.opinionId,
            memberName: opinion.role,
            roleKey: opinion.roleKey,
            fragmentNo: fragment.fragmentNo,
            text: fragment.text,
            implicit: false,
            now
          });
        }
        continue;
      }
      const fallback = output.visibleContent.trim().slice(0, 500);
      if (fallback.length === 0) continue;
      rows.push({
        fragmentId: this.ids.next(),
        itemKey: brief.settingItemKey,
        discussionId: brief.discussionId,
        proposalId: opinion.opinionId,
        memberName: opinion.role,
        roleKey: opinion.roleKey,
        fragmentNo: 1,
        text: fallback,
        implicit: true,
        now
      });
    }
    if (rows.length > 0) repository.saveProposalFragments(scope, rows);
  }

}

/** 从模型JSON输出中取出fields对象；解析失败返回null，不做任何猜测。 */
function parseModelJsonFields(raw: string): Record<string, unknown> | null {
  try {
    const root = JSON.parse(raw) as unknown;
    if (typeof root !== 'object' || root === null || Array.isArray(root)) return null;
    const fields = (root as Record<string, unknown>).fields;
    return typeof fields === 'object' && fields !== null && !Array.isArray(fields)
      ? fields as Record<string, unknown>
      : null;
  } catch {
    return null;
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
  const creativeExploration = purpose === 'creative_exploration';
  if (!masterWorkshop && !rollingPlan && !creativeExploration) return [];
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
    { id: state.setting_baseline_version_id, type: 'setting', reason: '已确认设定，是剧情推演不可违背的上游边界' },
    ...(rollingPlan || creativeExploration
      ? [{ id: state.master_outline_version_id, type: 'master_outline', reason: '已确认剧情总纲；只提取与当前故事弧和近期章纲相关的阶段边界' }]
      : [])
  ].filter((item): item is { id: string; type: string; reason: string } => item.id !== null);
  const sources = requested.flatMap((item) => {
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
  if (rollingPlan || creativeExploration) {
    const previous = previousChapterOutlineSource(database, scope, nextChapterPlanningNumber(database, scope));
    if (previous !== null) sources.push(previous);
  }
  return sources;
}

function previousChapterOutlineSource(
  database: DatabaseSync,
  scope: BookScope,
  nextChapterNumber: number
): { sourceType: string; sourceId: string; content: string; reason: string; priority: number } | null {
  if (nextChapterNumber <= 1) return null;
  const row = database.prepare(`
    SELECT v.artifact_version_id, v.content_json
    FROM artifacts a
    JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
    WHERE a.owner_id = ? AND a.book_id = ?
      AND a.artifact_type = 'chapter_outline'
      AND a.status = 'active' AND v.status = 'selected'
      AND CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER) < ?
    ORDER BY CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER) DESC
    LIMIT 1
  `).get(scope.ownerId, scope.bookId, nextChapterNumber) as {
    artifact_version_id: string;
    content_json: string;
  } | undefined;
  if (row === undefined) return null;
  return {
    sourceType: 'planning:previous_chapter_outline',
    sourceId: row.artifact_version_id,
    content: compactPreviousChapterOutlineForDiscussion(row.content_json),
    reason: '上一章已确认章纲的结束状态与下一章承接点；用于保持逐章连续，不注入全部历史章纲',
    priority: 100
  };
}

export function compactPreviousChapterOutlineForDiscussion(contentJson: string): string {
  try {
    const value = JSON.parse(contentJson) as Record<string, unknown>;
    const ending = value.ending !== null && typeof value.ending === 'object'
      ? value.ending as Record<string, unknown>
      : {};
    const cast = Array.isArray(value.cast)
      ? value.cast.slice(0, 5).map((entry) => {
          const character = entry !== null && typeof entry === 'object'
            ? entry as Record<string, unknown>
            : {};
          return {
            name: character.name,
            objective: character.objective,
            knowledgeBoundary: character.knowledgeBoundary,
            stateChange: character.stateChange
          };
        })
      : [];
    return JSON.stringify({
      outlineSchema: value.outlineSchema,
      chapterNumber: value.chapterNumber,
      title: value.title,
      requiredEndingState: value.requiredEndingState,
      cast,
      informationControl: value.informationControl,
      threadActions: value.threadActions,
      mustNotViolate: value.mustNotViolate,
      ending: {
        result: ending.result,
        stateChanges: ending.stateChanges,
        hook: ending.hook,
        nextChapterInterface: ending.nextChapterInterface
      }
    });
  } catch {
    return boundedHeadAndTail(contentJson, 1_000);
  }
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
    const openingReference = parsed.openingReference as {
      storyDirection?: unknown;
      fullBookOutline?: unknown;
      mustFollow?: unknown;
    } | undefined;
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
      storyDirection: typeof openingReference?.storyDirection === 'string' && openingReference.storyDirection.trim().length > 0
        ? openingReference.storyDirection.trim()
        : typeof openingReference?.fullBookOutline === 'string'
          ? openingReference.fullBookOutline.trim()
          : undefined,
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
  output: string,
  firstChapterNumber: number | null = null,
  requestedChapterCount: number | null = null
): boolean {
  return workflowArtifactValidationFailure(
    scopeText,
    purpose,
    output,
    firstChapterNumber,
    requestedChapterCount
  ) === null;
}

function workflowArtifactValidationFailure(
  scopeText: string,
  purpose: DiscussionPurpose,
  output: string,
  firstChapterNumber: number | null = null,
  requestedChapterCount: number | null = null
): string | null {
  if (scopeText.includes('【剧情总纲专项讨论资料包】')) {
    return isValidMasterOutlineOutput(output) ? null : '剧情总纲缺少完整的stage_master_v2结构';
  }
  if (isGroupedSettingScope(scopeText)) {
    const requiredKeys = new Set(settingBatchKeys(scopeText));
    const deposits = parseSettingOutlineDeposit(output);
    return requiredKeys.size > 0
      && requiredKeys.size === deposits.length
      && deposits.every((deposit) => requiredKeys.has(deposit.itemKey))
      ? null
      : '设定没有逐项覆盖本批全部设定编号';
  }
  if (purpose === 'locked_planning') {
    try {
      const planning = parsePlanningDepositOutput(output);
      if (planning === null || planning.outlineSchema !== 'chapter_outline_v2') return '缺少chapter_outline_v2结构';
      if (requestedChapterCount !== null && planning.chapters.length !== requestedChapterCount) {
        return `必须且只能包含${requestedChapterCount}章`;
      }
      if (firstChapterNumber !== null && planning.chapters.some((chapter, index) => (
        chapter.chapterNumber !== firstChapterNumber + index
      ))) return `章号必须从第${firstChapterNumber}章连续递增`;
      for (const chapter of planning.chapters) {
        const boundaryFailure = chapterOutlineHardBoundaryFailure(scopeText, chapter);
        if (boundaryFailure !== null) return boundaryFailure;
        const stageFailure = chapterOutlineStageBoundaryFailure(scopeText, chapter as ChapterOutlineV2);
        if (stageFailure !== null) return stageFailure;
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '章纲结构无法解析';
    }
  }
  return null;
}

function buildStructuredArtifactRecoveryPrompt(
  prompt: string,
  purpose: DiscussionPurpose,
  firstChapterNumber: number | null,
  requestedChapterCount: number | null,
  invalidOutput: string | null,
  validationFailure: string | null
): string {
  if (purpose !== 'locked_planning') {
    return [
      prompt,
      `上一次回复的落库结构残缺或无法解析${validationFailure === null ? '' : `：${validationFailure}`}。`,
      invalidOutput === null ? '' : `【上一版无效输出，仅供结构纠错】\n${boundedHeadAndTail(invalidOutput, 3_500)}`,
      '请重新输出，先给完整闭合的workflowArtifact，再给不超过160字的作者说明；不要复述讨论过程。'
    ].filter(Boolean).join('\n');
  }
  const first = firstChapterNumber ?? 1;
  const count = requestedChapterCount ?? 3;
  const semanticBoundaryFailure = validationFailure?.startsWith('硬边界冲突') === true
    || validationFailure?.startsWith('阶段边界冲突') === true;
  return [
    semanticBoundaryFailure
      ? '上一版章纲违反了作者已经明确确认的硬边界。必须放弃冲突的机制，回到开书资料、已确认设定和剧情总纲，用现实可追溯的人物行动、制度流程与因果证据重做本章；不得只改字段名或在mustNotViolate里口头否认。'
      : '你正在修复上一版章纲的机器结构，不是在重新讨论或另写方案。保留上一版已经形成的剧情判断，只修正JSON、缺失字段、字段类型和节点编号。',
    `校验失败原因：${validationFailure ?? '章纲结构无法解析'}`,
    invalidOutput === null ? '上一版输出不可用，请按下列合同重建同一结论。' : `【上一版无效输出】\n${boundedHeadAndTail(invalidOutput, 3_500)}`,
    '【章纲V2落库结构修复合同】workflowArtifact.type必须为chapter_outline；payload.outlineSchema必须为chapter_outline_v2。每章必须含chapterNumber、title、chapterFunction、openingState、requiredEndingState、cast、conflict、plotBeats、ending、mustImplement、mustNotViolate、creativeFreedom。',
    'cast是1至4名必要人物的数组；conflict至少含surface和failureCost；plotBeats必须是恰好3个对象，每个对象都同时包含连续的order、trigger、action、result，可选resistance和turn；不得把result拆成单独对象。',
    'experience、descriptionFocus、informationControl中的子列表以及allowedCandidates只能是字符串数组；无内容时使用[]，不得使用null。threadActions必须是对象数组，每项包含action（plant、advance或payoff）和summary，最多2项。mustImplement、mustNotViolate、creativeFreedom各至少一项。ending必须含result、hook、nextChapterInterface，stateChanges使用字符串数组。',
    `必须先输出一个完整闭合的workflowArtifact，且只包含第${first}章至第${first + count - 1}章共${count}章；JSON闭合后再写不超过120字的作者说明。`,
    `本次只能规划第${first}章至第${first + count - 1}章，共${count}章。chapters必须按绝对章号连续给出。`,
    '为保证完整：每章只保留1至4名必要人物、恰好3个推进节点、最多2项伏笔动作；每个文本字段只写一句具体结论，单项不超过80个汉字；可选数组没有必要时使用空数组。',
    '不得输出Markdown代码围栏、前置分析、候选方案、重复字段或workflowArtifact之外的第二份JSON。',
    `外层输出合同：${JSON.stringify(EFFECTIVE_OUTPUT_CONTRACT)}`
  ].join('\n');
}

export function discussionOutputTokenLimit(
  roleKey: RoleKey | CreativeRoleKey,
  isEditor: boolean,
  phase: DiscussionPhase,
  scopeText: string,
  purpose: DiscussionPurpose = 'open_discussion'
): number {
  if (purpose === 'stage_outline_panel') return 2_400;
  // Subscription providers may count internal reasoning against the output budget. A 1.2k cap
  // truncated the author-visible JSON in real calls, so panel outputs receive guarded headroom.
  if (purpose === 'creative_concept_panel' || purpose === 'setting_proposal_panel') return 3_000;
  // 主编只需要输出面向作者的结论和一个结构化规划产物。完整编剧意见已经
  // 单独保存在 discussion_opinions；继续申请 4k 输出会让真实方舟 Plan
  // 在 7k 级输入下更容易被上游网关中断。
  if (isEditor && isGroupedSettingScope(scopeText)) {
    // 设定融合不仅要闭合落库合同，部分套餐模型还会把内部思考计入同一输出额度。
    // 真实单项融合已经证明3.6k可被思考完全耗尽而没有任何可见文字；8k时同一
    // 资料包可稳定形成约2k的作者候选。这里仍是有界上限，不要求模型写满，
    // 也不改变提案席的3k预算或正文预算。
    return 8_000;
  }
  // 阶段式剧情总纲包含每阶段主线、起承转合、阶段总结、伏笔和后续方向。真实
  // 四阶段结果已证明 4.5k 会恰好在最后一个阶段中间截断。此前 6k 超时的根因
  // 是主编输入曾膨胀到 7k 左右；现在完整意见改为结构化骨架摘要，输入已被控制，
  // 因此为总纲恢复 6k，靠结构校验保证不会把截断结果误当成功。
  if (isEditor && scopeText.includes('【剧情总纲专项讨论资料包】')) {
    return 6_000;
  }
  // 三章V2章纲包含人物边界、冲突、节点、信息控制和章末接口。4.5k在真实
  // 方舟调用中会截断第三章，故给出6.5k上限并配合逐字段精简和结构重试。
  if (isEditor && purpose === 'locked_planning') {
    return 6_500;
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

export function discussionContextTokenBudget(isEditor: boolean, scopeText = ''): number {
  // 主编资料包保留老板原话、规划正史和四份意见的首尾摘要；完整意见通过
  // opinionId 可追溯，不在同一调用里重复注入。编剧仍保留原有 8k 上限。
  // 设定阶段保留完整开书活动版本、当前项、作者原话和直接依赖设定；融合还
  // 需要三份作者选中方案的主张骨架。16k是专项有界上限，不允许借此恢复
  // 全量无关设定或全文堆叠。
  if (isEditor && isGroupedSettingScope(scopeText)) return 16_000;
  return isEditor ? 7_200 : 8_000;
}

export function discussionRetrievalQuery(scopeText: string): string {
  if (!isGroupedSettingScope(scopeText)) {
    return estimateTokens(scopeText) <= 1_200 ? scopeText : boundedHeadAndTail(scopeText, 1_200);
  }
  const bookTitle = /(?:^|\n)书籍：([^\n]+)/u.exec(scopeText)?.[1]?.trim() ?? '';
  const targetJson = /(?:^|\n)本批设定项JSON：(\[[^\n]*\])/u.exec(scopeText)?.[1];
  if (targetJson === undefined) return `设定 ${bookTitle}`.trim();
  try {
    const targets = JSON.parse(targetJson) as Array<{ groupTitle?: unknown; label?: unknown; prompt?: unknown }>;
    const terms = targets.flatMap((target) => [
      typeof target.groupTitle === 'string' ? target.groupTitle : '',
      typeof target.label === 'string' ? target.label : '',
      typeof target.prompt === 'string' ? target.prompt : ''
    ]).filter((value) => value.length > 0);
    return [`设定`, bookTitle, ...terms].filter((value) => value.length > 0).join(' ');
  } catch {
    return `设定 ${bookTitle}`.trim();
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
  const isGroupedSettingWorkshop = isGroupedSettingScope(scopeText);
  const groupedSettingKeys = isGroupedSettingWorkshop ? settingBatchKeys(scopeText) : [];
  const isEditor = participant.role_key === 'chief_editor' || participant.role_key === 'deputy_editor';
  const stageContract = purpose === 'locked_planning'
    ? stageBoundaryContractLine(evidenceContext)
    : null;
  if (purpose === 'stage_outline_panel') {
    const emphasis = participant.role_key === 'lead_screenwriter'
      ? '优先从人物欲望、关系变化和持续戏剧张力出发。'
      : participant.role_key === 'second_screenwriter'
        ? '优先避开同类作品最直觉的套路，寻找合理但有惊喜的变化。'
        : '优先判断作品定位、读者体验、阶段闭环和后续创作空间。';
    return [
      `你是${participant.display_name}，正在为本书当前剧情阶段独立设计候选方案。`,
      `统一命题与开书资料：${scopeText}`,
      `与你的判断直接相关的检索依据：${JSON.stringify(evidenceContext)}`,
      '你看不到另外两名成员的答案，也不得猜测、评价、汇总或迎合她们。',
      emphasis,
      '只提交1个你真正推荐的独立候选，不要列第二、第三方案，不要编号，不要询问作者。候选必须明确：剧情类型或组合、代入本书人物后的具体故事过程、起承转合与阶段结果、建议章节范围（单阶段最多50章）、主要爽点或满足点、压力或虐点、情绪变化、关键转折、需要埋设或推进的伏笔，以及推荐理由。',
      '剧情模式只作为创意启发，不能照抄公式。不得生成正式剧情总纲JSON、章纲或正文，不得要求作者先回答问题。方案控制在180至350个中文字符，面向作者自然表达，不显示内部字段、模型信息、检索过程或JSON。',
      AUTHOR_PLAIN_LANGUAGE_RULES,
      `输出合同：${JSON.stringify(EFFECTIVE_OUTPUT_CONTRACT)}`
    ].join('\n');
  }
  if (purpose === 'stage_outline_synthesis') {
    return [
      `你是${participant.display_name}，是本书当前活动主编。`,
      `老板已经选择或补充的阶段剧情方向：${scopeText}`,
      `与你的整理直接相关的检索依据：${JSON.stringify(evidenceContext)}`,
      '只整理老板明确选中的候选和补充，不得把未选方案混入，不得另起炉灶。若多项组合存在冲突，要做最小必要取舍并在作者可见摘要中说清。',
      '形成且只形成当前阶段的一份可确认剧情总纲：阶段不超过50章；写清阶段名称、连续章节范围、剧情类型或组合、出场人物、核心事件、起承转合、阶段结果、章节内容安排、字数预估、爽点、虐点或压力、情绪曲线、关键转折、后续伏笔、伏笔预计释放范围和进入下一阶段的接口。',
      '不得生成章纲或正文，不得改写既有已确认阶段；旧阶段只作为边界和因果来源。',
      '必须同时给出自然中文作者摘要与 workflowArtifact。workflowArtifact 使用 schema=stage_master_v2，majorStages 只包含本次当前阶段，且字段满足后端剧情总纲解析合同。确认前只是候选。',
      AUTHOR_PLAIN_LANGUAGE_RULES,
      `输出合同：${JSON.stringify(EFFECTIVE_OUTPUT_CONTRACT)}`
    ].join('\n');
  }
  if (purpose === 'creative_concept_panel' || purpose === 'setting_proposal_panel') {
    const itemLabel = scopeText.match(/当前设定项：([^\n]+)/u)?.[1]?.trim() || '当前设定项';
    const itemPrompt = scopeText.match(/当前问题：([^\n]+)/u)?.[1]?.trim() || '请给出最适合本书的明确设定方案';
    const creativeConcept = scopeText.includes('当前设定项编号：creative-concept') || purpose === 'creative_concept_panel';
    return [
      `你是${participant.display_name}，正在参加本书“${itemLabel}”独立提案。`,
      `统一命题与开书资料：${scopeText}`,
      `与你的判断直接相关的检索依据：${JSON.stringify(evidenceContext)}`,
      '你看不到另外两名成员的答案，也不得猜测、评价、汇总或迎合她们。只提交一个你自己真正推荐、可供作者选择的方案。',
      creativeConcept
        ? '策划理念必须用小白作者也能读懂的自然中文，明确回答：一、这本书为什么值得写；二、主要想探讨什么；三、准备给读者什么独特体验。三者要形成同一个创作机制，不能只是标签、广告语或剧情梗概。'
        : `本项要解决的问题是：${itemPrompt}。给出清楚、具体且可修改的设定，不提前规定具体剧情结果，也不扩写剧情总纲、章纲或正文。`,
      participant.role_key === 'lead_screenwriter'
        ? '侧重爽点、强冲突和持续追读张力：这项设定怎么让读者看得爽、冲突更硬、更想追下去。'
        : participant.role_key === 'second_screenwriter'
          ? '侧重因果链与逻辑闭环：这项设定的前因后果、代价和边界是否前后一致、能不能被剧情稳定执行。'
          : participant.role_key === 'setting'
            ? '侧重规则严谨与可核验：定义是否清楚、能不能被后文稳定执行、和已确认设定是否冲突。'
            : '侧重作品定位、读者承诺和后续创作空间，给出编辑判断而不是问卷。',
      '只写一个候选，正文建议80至220字；不列A/B/C，不提问题，不要求作者立即确认，不写内部资料、JSON键名、模型信息或工作过程。',
      '在输出JSON的fields中额外给出：benefits（这条方案给本书带来的好处，1至3条）、costs（要付出的代价或限制，1至3条）、fragments（把方案拆成3至6条可以独立勾选的具体设定主张，每条是一句能独立成立的话，作者会逐条勾选后交给主编融合）。',
      AUTHOR_PLAIN_LANGUAGE_RULES,
      `输出合同：${JSON.stringify(EFFECTIVE_OUTPUT_CONTRACT)}`
    ].join('\n');
  }
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
            ? scopeText.includes('"fragmentId"')
              ? '这是设定碎片融合。作者已经逐条勾选碎片；每条勾选碎片的原意必须保留，只能做最小必要衔接，不得混入未勾选内容。'
              : '这是设定成组讨论。只讨论资料包列出的非剧情设定项；先解决项目间依赖和冲突，再给每一项形成可直接保存、互不重复的明确结论。不得生成剧情总纲、章纲或正文。'
            : purpose === 'creative_exploration'
              ? '现在只做方向推演：综合编剧意见后先给一个明确主推荐，写清收益、代价、因果风险和人物影响；只有确有重大取舍时保留一个结构不同的备选。最多提出1个会改变重大方向的必要问题；其余未知项用可逆假设推进。不得估算章节数，不得生成章纲，不得安排主笔开写。'
              : purpose === 'locked_planning'
                ? '方向已经由老板锁定。请综合两位编剧的独立跨度估算，形成故事弧目标、起止状态、关键转折，并只细化未来1至3章；远期不得展开成整批僵硬章纲。'
                : '请明确回应老板，先分析老板的真实意图，再给出一个主推荐、简短理由、必要风险和可执行下一步。不得把判断责任变成连续问题；资料足够时直接形成可确认方案。',
      isGroupedSettingWorkshop
        ? (scopeText.includes('"fragmentId"')
          ? '在同一个JSON对象的fields中输出fusionSegments数组：[{"text":"融合稿的一段原文","source":"fragment或stitch","fragmentId":"来源碎片ID，衔接段留空","memberName":"来源成员名，衔接段留空"}]。fusionSegments按顺序拼接必须等于落库content全文；作者勾选碎片对应的段source=fragment并带fragmentId；你补写的衔接段source=stitch。'
          : '')
          + `在同一个JSON对象的workflowArtifact字段输出设定落库结构：{"type":"setting_outline","payload":{"items":[{"itemKey":"资料包中的原始编号","content":"该项可直接保存的明确设定，不写讨论过程、备选方案或待确认问题"}]}}。items必须且只能覆盖这些编号，每个编号恰好一次：${groupedSettingKeys.join('、')}。content中禁止出现成员姓名、主编、编剧、方案A/B/C、共识、分歧、待老板或需老板确认；存在分歧时由你作出当前最合理且可逆的编辑判断，未知项另留在面向老板的正文说明中，不得塞进落库内容。`
        : '',
      isMasterOutlineWorkshop
        ? '在同一个JSON对象的workflowArtifact字段输出剧情总纲落库结构：{"type":"master_outline","payload":{"outlineSchema":"stage_master_v2","premise":"全书核心前提","coreConflict":"贯穿全书的核心冲突","protagonistArc":"主角从起点到终局的变化","majorStages":[{"stageNumber":1,"title":"第一阶段名称","chapterRange":{"start":1,"end":10},"plotPatterns":{"primary":{"id":"模式ID可省略","name":"主剧情模式","reason":"为什么适合本阶段"},"supporting":[{"name":"辅助模式","reason":"承担什么作用"}]},"dramaticQuestion":"这段剧情最终必须回答的核心问题","stageGoal":"本阶段必须完成的可验证目标","startState":"阶段开始时人物、关系和局势状态","conflictDesign":{"surface":"表层冲突","underlying":"深层冲突","stakes":"成功与失败牵动什么","failureCost":"失败的具体代价"},"mainline":{"encounter":"主角遇到什么事情","resolution":"最终怎么解决","result":"得到什么结果"},"structure":{"setup":"起：阶段开局与触发","development":"承：矛盾如何发展","turn":"转：方向发生什么变化","conclusion":"合：阶段如何收束"},"completionCriteria":["满足什么才算本段写完"],"hardConstraints":["不得偏移的事实、人物和因果边界"],"creativeFreedom":["允许主笔自由发挥的空间"],"stageSummary":"阶段结束时人物、局势与成果的简明总结","pendingThreads":["待回收信息或伏笔"],"followUpDirection":"下一阶段从哪里继续"}],"endingDirection":"结局方向与需要兑现的因果","storyPromises":["读者承诺"],"openQuestions":["仍需老板确认的问题"]}}。首次只规划一个完整剧情阶段；单阶段最多50章。剧情模式只是软参考，不得照搬公式；反向拆解也必须用同一结构总结真实正文，而不是事后硬套模式。后续阶段必须等当前阶段正文完成并结算后再追加；已有阶段必须原样保留。主线、起承转合、结束验收条件和防偏移边界必须具体。'
        : '',
      isMasterOutlineWorkshop
        ? 'majorStages中的每个阶段还必须写detailSchema="stage_detail_v1"，并补齐：cast（name、stageRole、objective、可选stateChange）；chapterBlocks（连续覆盖阶段全部章号的start、end、summary、estimatedWords，按剧情单元分段而非逐章）；estimatedWords；experience（emotionalArc、payoffPoints、pressurePoints）；turningPoints；foreshadowing（summary、action=plant/advance/payoff、releaseWindow）。这些字段用于作者查看和主笔后续细化，必须具体、简洁，不得用空数组逃避已经可判断的内容。'
        : '',
      purpose === 'locked_planning'
        ? [
            '在同一个JSON对象的workflowArtifact字段输出章纲V2落库结构：{"type":"chapter_outline","payload":{"outlineSchema":"chapter_outline_v2","arcTitle":"故事弧标题","arcGoal":"本弧目标","endingState":"本弧结束状态","estimatedChapterRange":{"minimum":最少章数,"recommended":建议章数,"maximum":最多章数},"chapters":[{"chapterNumber":绝对章号,"title":"不含第N章前缀的章名","chapterFunction":"本章在当前剧情阶段中的唯一作用","openingState":"开章时已经成立的局面","requiredEndingState":"本章结束时必须形成的局面","sourceStage":{"stageNumber":阶段编号,"title":"阶段名","chapterRange":{"start":起始章,"end":结束章}},"stageBoundary":{"mustCloseStage":true,"resolution":"仅阶段终章填写总纲解决方式","result":"仅阶段终章填写总纲结果","pendingThreads":["仅保留总纲允许后续回收的线索"]},"cast":[{"name":"姓名","objective":"本章当下目标","knowledgeBoundary":"此人此刻知道与不知道什么","chapterRole":"本章作用","stateChange":"可选，本章后变化"}],"conflict":{"surface":"表层冲突","underlying":"可选，深层冲突","oppositionGoal":"可选，对手目标","failureCost":"失败代价","successCost":"可选，成功代价"},"plotBeats":[{"order":1,"trigger":"触发","action":"人物行动","resistance":"可选，阻力","turn":"可选，转折","result":"该节点结果"}],"experience":{"primaryTone":"可选，本章主情绪","emotionalCurve":["3至5个情绪变化"],"payoffPoints":["0至2个爽点"],"pressurePoints":["0至2个压力或虐点"],"readerEffect":"可选，预期读者感受"},"descriptionFocus":{"primary":["主要描写"],"secondary":["次要描写"],"compress":["压缩处理"]},"informationControl":{"reveals":["本章揭示"],"concealed":["本章保留"],"gaps":["信息差"]},"threadActions":[{"action":"plant或advance或payoff","summary":"伏笔动作，最多2项"}],"ending":{"result":"章末结果","stateChanges":["状态变化"],"hook":"章末钩子","nextChapterInterface":"下一章承接点"},"mustImplement":["必须实现"],"mustNotViolate":["不得违反"],"allowedCandidates":["允许主笔选择的候选"],"creativeFreedom":["对白、动作、意象、局部调度等自由区"]}]}}。非阶段终章省略stageBoundary；阶段终章必须填写并原样承接阶段边界合同。',
            stageContract ?? '',
            stageContract === null ? '' : '阶段边界合同是已确认剧情总纲的机器门禁：sourceStage必须与所属阶段完全一致；若本批包含阶段结束章，该章必须解决阶段主事件、形成总纲确认的结果，只能把pendingThreads列出的信息留待后续。不得在章节功能、结束状态、节点、章末或不得违反项中写“尚未完成、未闭合、不恢复、不解决”等反闭环要求。',
            `本次只能规划第${firstChapterNumber ?? 1}章至第${(firstChapterNumber ?? 1) + (requestedChapterCount ?? 3) - 1}章，共${requestedChapterCount ?? 3}章。chapters必须按绝对章号连续给出且chapterNumber逐项严格等于该范围；不得从第5章等其他章位开始，不得跳章、错位或只写后续章节。已有候选正文也必须在相应章位生成修正版章纲。`,
            '每章必须有3至5个连续编号的剧情推进节点、1至12名出场人物、明确失败代价和章末承接；章节功能不得重复。体验、描写和信息控制是软提示，可按本章需要留空，不能为了填表硬造爽点或虐点。不要复述人物完整传记、世界观全文或前章全文。',
            '开书资料、已确认设定和剧情总纲中的作者硬边界必须落实到每一个事件本身，不能只抄进mustNotViolate后继续写冲突机制。现实题材不得让无来源的界面、倒计时、惩罚规则或“交出物品换延期”自行裁决人物；若需要限期、交换或追责，必须落到可追溯的现实人物、机构、书面规则与因果证据。',
            '为避免结构被截断，每章只写当前创作必需信息：优先1至4名必要人物和3个推进节点；每个文本字段只写一句具体结论，单项不超过80个汉字；可选列表无必要时使用空数组。'
          ].join('')
        : '',
      (isMasterOutlineWorkshop || isGroupedSettingWorkshop || purpose === 'locked_planning')
        ? '这是必须落库的规划任务：先确保workflowArtifact完整、字段齐全且JSON闭合，再写面向老板的说明。answer不超过300字；keyPoints、risks、questions各最多3项；alternatives最多1项；details设为null。不要复述两位编剧的长篇论证，完整意见已经单独保存。'
        : '',
      '不得声称未参与的成员已经发言，不得在资料不足时直接安排主笔写正文。',
      '讨论必须有界收敛：每轮最多一个真正阻塞的问题；老板表示“不知道、你推荐、你决定”时必须给出当前最佳推荐；已经明确或排除的方向不得无新证据反复重开。',
      '保留结构不同的高潜少数方案和有证据的分歧，不用多数票，不把意见压成没有代价的安全折中。',
      AUTHOR_PLAIN_LANGUAGE_RULES,
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
      '不得重新估算章节跨度，不得生成章纲，不得复述老板原话。',
      AUTHOR_PLAIN_LANGUAGE_RULES
    ].join('\n');
  }
  return [
    `你是${participant.display_name}。请在看不到另一位编剧答案的前提下，独立分析这个小说创作问题：${scopeText}。`,
    `按当前问题检索到的正史与规划证据：${JSON.stringify(evidenceContext)}`,
    '先从人物此刻想要什么、知道什么、害怕失去什么开始推演，再形成行动—阻力—选择—代价—后果的事件链。分类、题材和标签只说明作品承诺与可用方向，不得把标签名称机械拼成剧情，也不得为了填模板让人物做不合动机的事。',
    participant.role_key === 'lead_screenwriter'
      ? '你的侧重点是找出最自然、因果最稳而仍有惊喜的主路径，明确它为什么能持续推进，以及成功必须付出的代价。'
      : participant.role_key === 'second_screenwriter'
        ? '你的侧重点是提出因果成立但结构确实不同的路径，并压力测试最容易被默认接受的前提；不要为了显得不同而追求无根据的反转。'
        : '',
    isMasterOutlineWorkshop
      ? '独立提出当前唯一剧情阶段的完整方案：围绕一个主事件形成起承转合和明确结算，预计不超过50章；只保留全书核心前提、冲突、成长与结局方向作为远期锚点，不提前规划后续阶段或逐章事件。'
      : isGroupedSettingWorkshop
          ? '独立为资料包中的全部非剧情设定项提出一套相互兼容的设定方案。逐项给出明确规则、边界和代价，优先服从书名、开书资料、主角身份和必须遵守项；不得把标签当成主角性别或虚构已确认资料。'
        : '给出结构清楚但保留创造性的方案，至少说明因果链、人物动机与代价、合理惊喜、失败风险、未知项和一项可执行建议；不要客套、自我介绍或重复结论。',
    isMasterOutlineWorkshop
      ? '这是剧情总纲落库任务。你必须提交一个完整、可执行、可验收的当前阶段剧情约束契约，不是全书流水账，也不是逐章章纲。workflowArtifact.payload必须使用stage_master_v2，并在阶段内写明：剧情主模式和最多两个辅助模式及采用理由；戏剧问题；阶段目标；开场状态；表层冲突、深层冲突、利害关系和失败代价；章节范围（最多50章）；主线遭遇、解决和结果；阶段级起承转合；结束验收条件；防偏移硬约束；创作自由区；阶段总结、待回收线索和后续方向。剧情模式是软参考，可以组合或弃用，不得公式化照搬。反向拆解时只总结正文中真实存在的结构，不得倒推不存在的模式。当前阶段完成并结算前不得设计下一阶段。'
      : '',
    isMasterOutlineWorkshop
      ? '每个阶段同时必须提供detailSchema="stage_detail_v1"、出场人物cast、连续覆盖章段的chapterBlocks及每段estimatedWords、阶段estimatedWords、情绪/爽点/压力experience、turningPoints，以及带释放周期releaseWindow的foreshadowing。反向拆解已有正文时必须优先依据已确认正文与反向章纲，不得用开书简介覆盖正文事实。'
      : '',
    purpose === 'creative_exploration'
      ? '当前仍是开放推演阶段：不得估算章节数，不得生成章纲，不得假定老板已经锁定方向。'
      : '',
    purpose === 'locked_planning' && ['lead_screenwriter', 'second_screenwriter'].includes(participant.role_key)
      ? '方向已经锁定。回复的第一行必须先输出且完整闭合：章节跨度估算 {"minimum":最少章数,"recommended":建议章数,"maximum":最多章数,"units":[{"unit":"推进单元","suggestedChapters":章数}],"assumptions":["假设"],"uncertainty":["不确定项"]}。必须先写这行，再写其他分析；章数必须为1至30的整数，且最少≤建议≤最多。'
      : '',
    AUTHOR_PLAIN_LANGUAGE_RULES
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
