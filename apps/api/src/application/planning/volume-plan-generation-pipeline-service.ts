import { createHash } from 'node:crypto';
import {
  parseBookStorySpineContent,
  parseVolumeDirectionContent,
  parseVolumePlanContent,
  type BookStorySpineContent,
  type LegacyFirstVolumeLaunchPlan,
  type StorySpine,
  type VolumeDirectionContent,
  type VolumePlanContent
} from '@wenmi/contracts';
import { STYLE_TONES, validateVolumeStyleTones } from '../../contracts/opening-blueprint.js';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { buildGenreBrief } from '../../domain/genre-brief.js';
import { AUTHOR_IDEA_POLICY_PLANNING } from '../../domain/author-idea-policy.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { ModelAdapterError } from '../../infrastructure/models/model-adapter.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import {
  VolumePlanGenerationRepository,
  type VolumePlanGenerationSeat,
  type VolumePlanGenerationSourceSnapshot
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import type { SettingGapService } from '../knowledge/setting-gap-service.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens, type ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import type { RetrievalContextSourceService } from '../memory/retrieval-context-source-service.js';
import { TaskService, type TaskLeaseFence, type TaskRecord } from '../tasks/task-service.js';
import { authorIdeaContextSources } from './author-idea-context-sources.js';
import {
  type VolumePlanGenerationBrief,
  volumePlanSourceFingerprint
} from './volume-plan-generation-service.js';
import { SETTING_GAP_OUTPUT_INSTRUCTION,stopForDetectedSettingGaps } from './setting-gap-detection.js';
import { VolumePlanService } from './volume-plan-service.js';
import {
  selectHiddenVolumeRouteRecipes,
  type HiddenVolumeRouteRecipe
} from './hidden-narrative-methods.js';

type CandidateKind = 'candidate_a' | 'candidate_b' | 'fusion';

export interface VolumePlanGenerationResult {
  taskId: string;
  status: 'succeeded' | 'cancelled';
  candidateAId: string | null;
  candidateBId: string | null;
  fusionId: string | null;
}

interface GeneratedCandidate {
  versionId: string;
  content: VolumePlanContent;
}

export class VolumePlanGenerationPipelineService {
  public constructor(
    private readonly repository: VolumePlanGenerationRepository,
    private readonly volumePlans: VolumePlanService,
    private readonly tasks: TaskService,
    private readonly budgets: BudgetService,
    private readonly calls: ModelCallService,
    private readonly contextPacks: ContextPackService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory,
    private readonly retrieval?: RetrievalContextSourceService,
    private readonly settingGaps?: SettingGapService
  ) {}

  public async executeClaimed(
    scope: BookScope,
    taskId: string,
    workerId: string,
    leaseFence?: TaskLeaseFence
  ): Promise<VolumePlanGenerationResult> {
    const claimed = this.tasks.require(scope, taskId);
    this.assertClaim(claimed, workerId, leaseFence);
    const brief = parseBrief(claimed.brief);
    const snapshot = this.requireCurrentSnapshot(scope, brief);
    const requestedEditor = brief.seats.find((seat) => seat.editor);
    if (requestedEditor === undefined) throw new Error('卷规划任务缺少冻结的主编席快照。');
    const editor = this.repository.hasUnresolvedModelBinding(
      scope, requestedEditor.provider, requestedEditor.modelId
    )
      ? selectEditorTechnicalSubstitute(brief.seats, [requestedEditor]) ?? requestedEditor
      : requestedEditor;
    try {
      this.throwIfCancelled(scope, taskId);
      if ((brief.mode ?? 'routes') === 'fusion') {
        if (brief.fusionSource === undefined || brief.fusionSource.selectedDirections.length === 0) {
          throw new Error('主编融合任务缺少作者实际选择的路线内容。');
        }
        const fusion = await this.generateAndStore(
          scope,
          claimed,
          brief,
          snapshot,
          editor,
          'fusion',
          brief.fusionSource.selectedDirections.map((item) => item.selectedContent)
        );
        this.tasks.checkpoint(scope, taskId, workerId, 'fusion_complete', {
          fusionId: fusion.versionId,
          sourceCandidateTaskId: brief.fusionSource.sourceTaskId,
          selectedVersionIds: brief.fusionSource.selectedDirections.map((item) => item.versionId),
          selectedFragmentsOnly: true,
          awaitingAuthorConfirmation: true,
          fusionProducedBy: seatAttribution(editor, editor.agentId !== requestedEditor.agentId)
        }, leaseFence);
        this.tasks.complete(scope, taskId, workerId, leaseFence);
        this.repository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
        return { taskId, status: 'succeeded', candidateAId: null, candidateBId: null, fusionId: fusion.versionId };
      }
      const lead = requiredSeat(brief.seats, 'lead_screenwriter');
      const second = requiredSeat(brief.seats, 'second_screenwriter');
      const initialA = this.repository.hasUnresolvedModelBinding(scope, lead.provider, lead.modelId)
        ? selectTechnicalSubstitute(brief.seats, [lead, second, editor]) ?? lead
        : lead;
      const initialB = this.repository.hasUnresolvedModelBinding(scope, second.provider, second.modelId)
        ? selectTechnicalSubstitute(brief.seats, [lead, second, editor, initialA]) ?? second
        : second;
      const candidateResults = await Promise.allSettled([
        this.generateAndStore(scope, claimed, brief, snapshot, initialA, 'candidate_a', []),
        this.generateAndStore(scope, claimed, brief, snapshot, initialB, 'candidate_b', [])
      ]);
      let candidateA = candidateResults[0].status === 'fulfilled' ? candidateResults[0].value : null;
      let candidateB = candidateResults[1].status === 'fulfilled' ? candidateResults[1].value : null;
      let candidateASeat = candidateA === null ? initialA : this.storedCandidateSeat(
        scope, taskId, 'candidate_a', brief.seats, initialA
      );
      let candidateBSeat = candidateB === null ? initialB : this.storedCandidateSeat(
        scope, taskId, 'candidate_b', brief.seats, initialB
      );
      const attemptedCandidateAgentIds = new Set(
        this.repository.attemptedCandidateAgentIds(scope, taskId)
      );
      const attemptedCandidateSeats = brief.seats.filter((seat) =>
        attemptedCandidateAgentIds.has(seat.agentId)
      );
      if (candidateA === null && isKnownRetryableTechnicalFailure(candidateResults[0])) {
        const substitute = selectTechnicalSubstitute(
          brief.seats,
          [lead, second, editor, initialA, initialB, candidateBSeat, ...attemptedCandidateSeats]
        );
        if (substitute !== null) {
          candidateASeat = substitute;
          candidateA = await this.generateAndStore(
            scope, claimed, brief, snapshot, substitute, 'candidate_a', []
          );
        }
      }
      if (candidateB === null && isKnownRetryableTechnicalFailure(candidateResults[1])) {
        const substitute = selectTechnicalSubstitute(
          brief.seats,
          [lead, second, editor, initialA, initialB, candidateASeat, ...attemptedCandidateSeats]
        );
        if (substitute !== null) {
          candidateBSeat = substitute;
          candidateB = await this.generateAndStore(
            scope, claimed, brief, snapshot, substitute, 'candidate_b', []
          );
        }
      }
      this.tasks.checkpoint(scope, taskId, workerId, 'screenwriter_candidates', {
        candidateAId: candidateA?.versionId ?? null,
        candidateBId: candidateB?.versionId ?? null,
        independent: true,
        crossReviewUsed: false,
        candidateAProducedBy: seatAttribution(candidateASeat, candidateASeat.agentId !== lead.agentId),
        candidateBProducedBy: seatAttribution(candidateBSeat, candidateBSeat.agentId !== second.agentId)
      }, leaseFence);
      if (candidateA === null) throw rejectedReason(candidateResults[0]);
      if (candidateB === null) throw rejectedReason(candidateResults[1]);
      try {
        assertMateriallyDifferentRoutes(candidateA.content, candidateB.content);
      } catch (error) {
        this.repository.supersedeCandidate(scope, candidateB.versionId, this.clock.now().toISOString());
        candidateB = await this.generateAndStore(
          scope, claimed, brief, snapshot, candidateBSeat, 'candidate_b', [], {
            retryKey: 'diversity-1',
            instruction: '上一条B路线与另一名编剧的路线过于相似。保留当前书的事实和本卷责任，但请重新选择明显不同的进入方式、主要对立力量、因果解决路径、人物关系变化、代价、高潮触发和卷末状态。不要解释原因，只输出完整JSON。'
          }
        );
        assertMateriallyDifferentRoutes(candidateA.content, candidateB.content);
        this.tasks.checkpoint(scope, taskId, workerId, 'screenwriter_candidates', {
          candidateAId: candidateA.versionId, candidateBId: candidateB.versionId,
          independent: true, crossReviewUsed: false, diversityRetry: 'candidate_b_only',
          candidateAProducedBy: seatAttribution(candidateASeat, candidateASeat.agentId !== lead.agentId),
          candidateBProducedBy: seatAttribution(candidateBSeat, candidateBSeat.agentId !== second.agentId)
        }, leaseFence);
      }
      this.tasks.checkpoint(scope, taskId, workerId, 'routes_ready', {
        candidateAId: candidateA.versionId,
        candidateBId: candidateB.versionId,
        fusionId: null,
        awaitingAuthorSelection: true,
        automaticFusionUsed: false,
        candidateAProducedBy: seatAttribution(candidateASeat, candidateASeat.agentId !== lead.agentId),
        candidateBProducedBy: seatAttribution(candidateBSeat, candidateBSeat.agentId !== second.agentId)
      }, leaseFence);
      this.tasks.complete(scope, taskId, workerId, leaseFence);
      this.repository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
      return { taskId, status: 'succeeded', candidateAId: candidateA.versionId,
        candidateBId: candidateB.versionId, fusionId: null };
    } catch (error) {
      const current = this.tasks.require(scope, taskId);
      if (current.cancelRequested) {
        this.tasks.complete(scope, taskId, workerId, leaseFence);
        this.repository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
        return {
          taskId,
          status: 'cancelled',
          ...this.storedIds(scope, brief.volumePlanId, taskId)
        };
      }
      const resultUnknown = this.repository.hasUnresolvedModelCallForAttempt(
        scope, taskId, claimed.currentAttemptNo
      );
      const failureCode = resultUnknown
        ? errorCodes.modelCallInterrupted
        : error instanceof DomainError ? error.code : 'VOLUME_PLAN_GENERATION_FAILED';
      this.tasks.fail(scope, taskId, workerId, failureCode, leaseFence);
      this.repository.markFailed(
        scope,
        taskId,
        resultUnknown ? '模型调用结果暂时无法确认，已停止自动重试。' : '卷规划团队设计未完成，可从已保存的候选检查点重试。',
        this.clock.now().toISOString()
      );
      throw error;
    }
  }

  private async generateAndStore(
    scope: BookScope,
    task: TaskRecord,
    brief: VolumePlanGenerationBrief,
    snapshot: VolumePlanGenerationSourceSnapshot,
    seat: VolumePlanGenerationSeat,
    candidateKind: CandidateKind,
    peerCandidates: unknown[],
    retry?: { retryKey: string; instruction: string }
  ): Promise<GeneratedCandidate> {
    const stored = retry === undefined
      ? this.repository.candidateByTask(scope, brief.volumePlanId, task.taskId, candidateKind)
      : undefined;
    if (stored !== undefined) {
      return {
        versionId: stored.volume_plan_version_id,
        content: parseVolumePlanContent(JSON.parse(stored.content_json) as unknown)
      };
    }
    const retrieved = this.retrieval === undefined ? { hardSources: [], optionalSources: [] }
      : await this.retrieval.collect(scope, {
          query: retrievalQuery(snapshot, brief, candidateKind),
          roleKey: seat.roleKey as CreativeRoleKey,
          mode: 'creative_exploration',
          canonRevision: snapshot.canonRevision,
          taskId: task.taskId,
          sourceTypes: ['fact', 'manuscript', 'outline', 'setting', 'wiki', 'voice'],
          limit: candidateKind === 'fusion' ? 12 : 9
        });
    const hardSources = buildHardSources(snapshot, brief, peerCandidates);
    const optionalSources = buildOptionalSources(snapshot, brief);
    const authorSources = authorIdeaContextSources(brief.authorIdeas, {
      sourceTypePrefix: 'owner:volume_ideas', sourceId: 'author-ideas:'+brief.volumePlanId, layer: 'planning'
    });
    const pack = this.contextPacks.build(scope, {
      taskId: task.taskId,
      agentId: seat.agentId,
      canonRevision: snapshot.canonRevision,
      positioningVersion: snapshot.positioningVersion,
      tokenBudget: candidateKind === 'fusion' ? 32_000 : 24_000,
      characterBudget: candidateKind === 'fusion' ? 76_000 : 58_000,
      policyVersion: 'volume-plan-context-v2-layered-no-raw-truncation',
      hardSources: [...hardSources, ...authorSources.hardSources, ...retrieved.hardSources],
      optionalSources: [...optionalSources, ...authorSources.optionalSources, ...retrieved.optionalSources]
    });
    const basePrompt = buildPrompt({
      seat,
      candidateKind,
      snapshot,
      brief,
      sources: pack.sources.map((source) => ({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        reason: source.reason,
        content: source.content
      })),
      peerCandidates
    }) + (retry === undefined ? '' : `\n\n【只重做当前B路线】${retry.instruction}`);
    const content = await this.callForValidContent(scope, task, seat, candidateKind, snapshot.planNumber, brief.volumePlanId, basePrompt, pack.contextPackId);
    const version = this.volumePlans.addVersion(scope, brief.volumePlanId, {
      expectedPlanRevision: brief.expectedPlanRevision,
      candidateKind,
      parentVersionId: brief.expectedActiveVersionId,
      sourceTaskId: task.taskId,
      authorInputRefs: brief.authorInputRefs,
      template: brief.template,
      content,
      idempotencyKey: `${task.taskId}:${candidateKind}${retry === undefined ? '' : `:${retry.retryKey}`}`
    });
    if (candidateKind === 'candidate_a' || candidateKind === 'candidate_b') {
      const recipes = brief.routeRecipes ?? selectHiddenVolumeRouteRecipes(
        `${snapshot.bookTitle} ${snapshot.opening.content}`,
        snapshot.planNumber === 1
      );
      const routeRecipe = candidateKind === 'candidate_a' ? recipes[0] : recipes[1];
      this.repository.recordRouteMethodAudit(scope, {
        auditId: this.ids.next(),
        volumePlanId: brief.volumePlanId,
        taskId: task.taskId,
        volumePlanVersionId: version.volumePlanVersionId,
        candidateKind,
        methodVersionIds: routeRecipe.methodVersionIds,
        selectionReason: routeRecipe.selectionReason,
        now: this.clock.now().toISOString()
      });
    }    return { versionId: version.volumePlanVersionId, content: version.content };
  }

  private async callForValidContent(
    scope: BookScope,
    task: TaskRecord,
    seat: VolumePlanGenerationSeat,
    candidateKind: CandidateKind,
    planNumber: number,
    volumePlanId: string,
    basePrompt: string,
    contextPackId: string
  ): Promise<VolumePlanContent> {
    if (task.budgetId === null) throw new Error('卷规划任务缺少冻结预算。');
    const adapter = this.modelAdapters.resolve(
      seat.provider,
      seat.modelId,
      'discussion',
      seat.roleKey as CreativeRoleKey
    );
    let validationFailure: string | null = null;
    let lastError: unknown;
    for (let technicalTry = 1; technicalTry <= 2; technicalTry += 1) {
      if (technicalTry > 1 && validationFailure !== null && seat.provider.startsWith('local-deterministic')) break;
      const prompt = validationFailure === null
        ? basePrompt
        : `${basePrompt}\n\n上一份输出未通过结构校验：${validationFailure}\n请重新输出完整JSON，不要解释。`;
      const inputHash = createHash('sha256').update(prompt).digest('hex');
      const reusable = this.repository.succeededModelResult(scope, {
        taskId: task.taskId,
        agentId: seat.agentId,
        modelSnapshotId: seat.modelSnapshotId,
        inputHash
      });
      if (reusable !== undefined) {
        stopForDetectedSettingGaps({output:reusable.output_text,service:this.settingGaps,scope,
          scopeType:'volume',scopeId:volumePlanId});
        try {
          return parseGeneratedCandidate(reusable.output_text, candidateKind, planNumber, seat.provider);
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '卷规划JSON无效';
          lastError = error;
          continue;
        }
      }
      const maxOutputTokens = volumePlanOutputTokenLimit(candidateKind);
      const protocolOverhead = adapter.provider === 'openai-codex-subscription' ? 24_000 : 0;
      const estimatedInputCeiling = Math.max(
        Math.ceil(prompt.length / 2),
        Math.ceil(estimateTokens(prompt) * 1.35)
      );
      const requestId = this.ids.next();
      const reservationId = this.budgets.reserve(
        scope,
        task.budgetId,
        requestId,
        Math.max(12_000, estimatedInputCeiling + maxOutputTokens + protocolOverhead + thinkingTokenAllowance(seat.modelId)),
        0
      );
      try {
        const result = await this.calls.execute(scope, {
          requestId,
          taskId: task.taskId,
          phaseKey: `${candidateKind}:${seat.roleKey}:attempt-${task.currentAttemptNo}:try-${technicalTry}`,
          agentId: seat.agentId,
          modelSnapshotId: seat.modelSnapshotId,
          provider: seat.provider,
          modelId: seat.modelId,
          input: prompt,
          parameters: JSON.stringify({
            maxOutputTokens,
            planOnly: !seat.provider.startsWith('local-deterministic'),
            cashFallbackAllowed: false
          }),
          reservationId,
          contextPackId,
          leaseToken: task.leaseToken,
          attemptNo: task.currentAttemptNo
        }, adapter, {
          requestId,
          taskId: task.taskId,
          ownerId: scope.ownerId,
          bookId: scope.bookId,
          agentId: seat.agentId,
          prompt,
          maxOutputTokens
        });
        stopForDetectedSettingGaps({output:result.output,service:this.settingGaps,scope,
          scopeType:'volume',scopeId:volumePlanId});
        try {
          return parseGeneratedCandidate(result.output, candidateKind, planNumber, seat.provider);
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '卷规划JSON无效';
          if (isVolumePlanOutputCapped(result.outputTokens, maxOutputTokens)) {
            lastError = new ModelAdapterError(
              '卷规划输出已写满当前有界额度但JSON仍未闭合，需要由另一可用模型补位。',
              'technical_failure',
              true,
              200,
              false
            );
            break;
          }
          lastError = error;
        }
      } catch (error) {
        lastError = error;
        if (this.repository.isUnresolvedModelCall(scope, requestId)) throw error;
      }
    }
    if (validationFailure !== null) throw invalidVolumePlanOutputFailure(validationFailure);
    throw lastError instanceof Error ? lastError : new Error('模型没有返回有效的卷规划。');
  }

  private requireCurrentSnapshot(
    scope: BookScope,
    brief: VolumePlanGenerationBrief
  ): VolumePlanGenerationSourceSnapshot {
    const snapshot = this.repository.sourceSnapshot(scope, brief.volumePlanId);
    if (snapshot === undefined) throw new Error('卷规划资料包依赖已经失效。');
    if (
      snapshot.planRevision !== brief.expectedPlanRevision
      || snapshot.activeVersionId !== brief.expectedActiveVersionId
      || volumePlanSourceFingerprint(snapshot) !== brief.sourceFingerprint
    ) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '开书资料、设定、上一卷结算或当前卷版本已经变化，请重新生成候选。',
        {},
        false,
        409
      );
    }
    const workflow = this.volumePlans.workflow(scope);
    if (workflow.planningVersion !== brief.expectedWorkflowVersion) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '创作流程已经变化，请重新生成候选。',
        {},
        false,
        409
      );
    }
    return snapshot;
  }

  private storedCandidateSeat(
    scope: BookScope,
    taskId: string,
    candidateKind: 'candidate_a' | 'candidate_b',
    seats: VolumePlanGenerationSeat[],
    fallback: VolumePlanGenerationSeat
  ): VolumePlanGenerationSeat {
    const producer = this.repository.latestSucceededCandidateProducer(scope, taskId, candidateKind);
    return producer === undefined ? fallback : seats.find((seat) =>
      seat.agentId === producer.agentId
      && seat.provider === producer.provider
      && seat.modelId === producer.modelId
    ) ?? fallback;
  }

  private assertClaim(task: TaskRecord, workerId: string, leaseFence?: TaskLeaseFence): void {
    if (
      task.taskType !== 'volume_plan_generation'
      || task.status !== 'working'
      || task.leaseOwner !== workerId
      || (leaseFence !== undefined
        && (task.leaseToken !== leaseFence.leaseToken || task.currentAttemptNo !== leaseFence.attemptNo))
    ) throw new Error('卷规划任务未由指定Worker持有。');
  }

  private throwIfCancelled(scope: BookScope, taskId: string): void {
    if (this.tasks.require(scope, taskId).cancelRequested) {
      throw new DOMException('卷规划任务已取消。', 'AbortError');
    }
  }

  private storedIds(scope: BookScope, volumePlanId: string, taskId: string): {
    candidateAId: string | null;
    candidateBId: string | null;
    fusionId: string | null;
  } {
    return {
      candidateAId: this.repository.candidateByTask(scope, volumePlanId, taskId, 'candidate_a')?.volume_plan_version_id ?? null,
      candidateBId: this.repository.candidateByTask(scope, volumePlanId, taskId, 'candidate_b')?.volume_plan_version_id ?? null,
      fusionId: this.repository.candidateByTask(scope, volumePlanId, taskId, 'fusion')?.volume_plan_version_id ?? null
    };
  }
}

export function parseVolumePlanModelOutput(output: string): VolumePlanContent {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* inspect embedded objects below */ }
  for (const value of extractCompleteJsonObjects(output)) {
    try { candidates.push(JSON.parse(value) as unknown); } catch { /* continue */ }
  }
  for (const candidate of candidates) {
    for (const value of unwrapCandidates(candidate)) {
      try {
        const content = parseVolumePlanContent(value);
        validateVolumeStyleTones(content.stylePrimary, content.styleSecondary);
        return content;
      } catch { /* try the next shape */ }
    }
  }
  throw new Error('输出缺少完整、合法的卷规划JSON。');
}

/** 融合稿除结构合法外，还必须带齐爽点、逻辑链、新鲜感三块说明。 */
function parseForCandidateKind(output: string, candidateKind: CandidateKind): VolumePlanContent {
  const content = parseVolumePlanModelOutput(output);
  if (candidateKind === 'fusion' && (content.fusionNotes === null || content.fusionNotes === undefined)) {
    throw new Error('融合候选缺少 fusionNotes：必须说明爽点怎么兑现、逻辑链怎么闭环、新鲜感来自哪里。');
  }
  return content;
}

function parseGeneratedCandidate(
  output: string,
  candidateKind: CandidateKind,
  planNumber: number,
  provider: string
): VolumePlanContent {
  try {
    const route = parseVolumeDirectionModelOutput(output, planNumber);
    return canonicalRouteToLegacy(route.direction, route.storySpine, candidateKind);
  } catch (error) {
    if (provider.startsWith('local-deterministic')) {
      try { return parseForCandidateKind(output, candidateKind); }
      catch (legacyError) {
        const formalMessage = error instanceof Error ? error.message : '正式卷方向无效';
        const legacyMessage = legacyError instanceof Error ? legacyError.message : '旧卷规划无效';
        throw new Error(`本地卷方向输出无效：${formalMessage}；兼容解析：${legacyMessage}`);
      }
    }
    throw error;
  }
}

export function parseVolumeDirectionModelOutput(output: string, planNumber: number): {
  direction: VolumeDirectionContent;
  storySpine: BookStorySpineContent | null;
} {
  const candidates: unknown[] = [];
  let lastError: unknown;
  try { candidates.push(JSON.parse(output) as unknown); } catch (error) { lastError = error; }
  for (const value of extractCompleteJsonObjects(output)) {
    try { candidates.push(JSON.parse(value) as unknown); } catch (error) { lastError = error; }
  }
  for (const candidate of candidates) {
    for (const value of unwrapCandidates(candidate)) {
      if (!isRecord(value)) continue;
      try {
        const direction = parseVolumeDirectionContent(
          value.direction ?? value.volumeDirection ?? value,
          planNumber === 1
        );
        const storySpine = planNumber === 1 && value.storySpine !== undefined && value.storySpine !== null
          ? parseBookStorySpineContent(value.storySpine)
          : null;
        return { direction, storySpine };
      } catch (error) { lastError = error; }
    }
  }
  const detail = lastError instanceof Error ? `：${lastError.message}` : '';
  throw new Error((planNumber === 1
    ? '输出缺少完整卷方向或首卷强启动'
    : '输出缺少完整、合法的卷方向JSON') + detail + '。');
}

function canonicalRouteToLegacy(
  direction: VolumeDirectionContent,
  storySpine: BookStorySpineContent | null,
  candidateKind: CandidateKind
): VolumePlanContent {
  const content: VolumePlanContent = {
    title: direction.title,
    openingState: direction.openingSituation,
    coreGoal: direction.volumeGoal,
    coreConflict: direction.centralOpposition,
    failureCost: direction.costAndConsequence,
    characterChanges: direction.relationshipMovement,
    eventSequence: [],
    informationPlan: [],
    escalationAndRecovery: direction.escalationPath,
    endingState: direction.closingState,
    openThreads: [],
    nextVolumeTrigger: direction.closingState,
    boundaries: {
      mustAchieve: [direction.volumeGoal, direction.climaxResponsibility],
      mustNotViolate: [],
      creativeFreedom: direction.openSpaces,
      openQuestions: []
    },
    stylePrimary: null,
    styleSecondary: null,
    focusExpression: direction.expressionFocus.join('＋'),
    routeCard: {
      protagonistStart: direction.openingSituation,
      drivingMotivation: direction.protagonistDrive,
      escalationPath: direction.escalationPath,
      keyChoiceAndCost: [...direction.majorChoices, direction.costAndConsequence].join('；'),
      climaxResolution: direction.climaxResponsibility,
      endingChange: direction.closingState,
      benefits: direction.benefits,
      risks: direction.risks
    }
  };
  if (direction.firstVolumeLaunch !== undefined) {
    content.firstVolumeLaunch = canonicalLaunchToLegacy(direction.firstVolumeLaunch);
  }
  if (storySpine !== null) content.storySpine = canonicalSpineToLegacy(storySpine);
  if (candidateKind === 'fusion') {
    content.fusionNotes = {
      payoffDesign: direction.expressionFocus.join('；'),
      logicChain: direction.escalationPath.join(' → '),
      freshness: direction.benefits.join('；')
    };
  }
  return parseVolumePlanContent(content);
}

function canonicalLaunchToLegacy(
  value: NonNullable<VolumeDirectionContent['firstVolumeLaunch']>
): LegacyFirstVolumeLaunchPlan {
  return {
    first500: {
      readerQuestion: value.first500Interest.readerQuestion,
      immediateSituation: value.first500Interest.immediateSituation,
      emotionalGrip: value.first500Interest.emotionalGrip,
      changePromise: value.first500Interest.promisedMovement
    },
    goldenThree: value.goldenThree.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      responsibility: chapter.responsibility,
      action: chapter.protagonistAction,
      pressure: chapter.pressureOrPull,
      payoff: chapter.deliveredPayoff,
      nextExpectation: chapter.nextExpectation
    })),
    majorClimax: {
      latestEffectiveCharacters: value.majorClimax.noLaterThanEffectiveChars,
      setup: value.majorClimax.promiseToFulfill,
      choice: value.majorClimax.centralChoice,
      cost: value.majorClimax.cost,
      irreversibleChange: value.majorClimax.irreversibleChange,
      nextStage: value.majorClimax.nextStageTrigger
    },
    immersionPriorities: [...new Set([value.immersionAnchor, ...value.primaryDrivers])]
  };
}

function canonicalSpineToLegacy(value: BookStorySpineContent): StorySpine {
  return {
    longTermPromise: value.longTermReaderPromises.join('；'),
    protagonistLongArc: value.protagonistLongArc,
    centralQuestion: value.centralQuestion,
    escalationLadder: value.escalationLadder,
    endingDirection: value.optionalEndingDirections[0] ?? null,
    protectedOpenSpace: value.protectedOpenSpaces
  };
}

export function assertMateriallyDifferentRoutes(first: VolumePlanContent, second: VolumePlanContent): void {
  const left = first.routeCard;
  const right = second.routeCard;
  if (left === null || left === undefined || right === null || right === undefined) {
    throw new Error('两份独立卷方案都必须带具体路线卡。');
  }
  const comparisons = [
    { group: 'entry', left: left.protagonistStart, right: right.protagonistStart },
    { group: 'causal', left: left.drivingMotivation, right: right.drivingMotivation },
    { group: 'causal', left: first.coreConflict, right: second.coreConflict },
    { group: 'causal', left: left.escalationPath.join('｜'), right: right.escalationPath.join('｜') },
    { group: 'causal', left: left.keyChoiceAndCost, right: right.keyChoiceAndCost },
    { group: 'consequence', left: first.characterChanges.join('｜'), right: second.characterChanges.join('｜') },
    { group: 'experience', left: first.focusExpression ?? first.stylePrimary ?? '', right: second.focusExpression ?? second.stylePrimary ?? '' },
    { group: 'consequence', left: left.climaxResolution, right: right.climaxResolution },
    { group: 'consequence', left: left.endingChange, right: right.endingChange }
  ];
  const different = comparisons.filter((item) => routeTextSimilarity(item.left, item.right) < 0.72);
  const groups = new Set(different.map((item) => item.group));
  if (different.length < 4 || !groups.has('causal') || !groups.has('consequence')) {
    throw new Error('两位编剧的路线过于相似；必须在进入方式、推动动机、对立力量、解决路径、关键选择、关系变化、读者体验、高潮或卷末状态中至少四项真正不同，并同时改变因果路径与结果后果。');
  }
}

function routeTextSimilarity(first: string, second: string): number {
  const normalize = (value: string) => value.toLocaleLowerCase('zh-CN').replace(/[\s，。！？、；：,.!?;:—\-]/gu, '');
  const left = normalize(first);
  const right = normalize(second);
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const grams = (value: string) => new Set(Array.from({ length: Math.max(1, value.length - 1) }, (_, index) => value.slice(index, index + 2)));
  const a = grams(left);
  const b = grams(right);
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

export function volumePlanOutputTokenLimit(candidateKind: CandidateKind): number {
  // 卷方向不再携带事件链；8k有界额度覆盖首卷强启动与独立故事总线，
  // 同时避免模型把多余额度消耗在重复设定和提前展开事件细节上。
  return candidateKind === 'fusion' ? 8_000 : 8_000;
}

export function isVolumePlanOutputCapped(outputTokens: number, maximumTokens: number): boolean {
  return Number.isFinite(outputTokens)
    && Number.isFinite(maximumTokens)
    && outputTokens >= maximumTokens;
}

function unwrapCandidates(value: unknown): unknown[] {
  if (!isRecord(value)) return [value];
  const nested = [
    value,
    value.content,
    value.volumePlan,
    value.payload,
    isRecord(value.workflowArtifact) ? value.workflowArtifact.payload : undefined,
    isRecord(value.fields) ? value.fields.content : undefined,
    isRecord(value.fields) && isRecord(value.fields.workflowArtifact)
      ? value.fields.workflowArtifact.payload
      : undefined
  ];
  return nested.filter((candidate) => candidate !== undefined);
}

function buildHardSources(
  snapshot: VolumePlanGenerationSourceSnapshot,
  brief: VolumePlanGenerationBrief,
  peerCandidates: unknown[]
): ContextSource[] {
  const sources: ContextSource[] = [
    {
      sourceType: 'planning:opening_blueprint',
      sourceId: snapshot.opening.id,
      version: snapshot.opening.version,
      content: snapshot.opening.content,
      reason: '作者确认的开书信息；未确认的故事方向只作为软参考',
      priority: 100
    },
    {
      sourceType: 'planning:setting_baseline',
      sourceId: snapshot.setting.id,
      version: snapshot.setting.version,
      content: snapshot.setting.content,
      reason: '已确认设定基线；事实与能力边界必须遵守',
      priority: 100
    }];
  if (snapshot.previousVolume !== null) {
    sources.push({
      sourceType: 'planning:previous_volume',
      sourceId: snapshot.previousVolume.id,
      version: snapshot.previousVolume.version,
      content: snapshot.previousVolume.content,
      reason: '上一卷确认规划，仅用于理解承接责任',
      priority: 100
    });
  }
  if (snapshot.previousSettlement !== null) {
    sources.push({
      sourceType: 'planning:previous_volume_settlement',
      sourceId: snapshot.previousSettlement.id,
      version: snapshot.previousSettlement.version,
      content: snapshot.previousSettlement.content,
      reason: '上一卷实际结算；下一卷必须从真实结束状态出发',
      priority: 100
    });
  }
  if (peerCandidates.length > 0) {
    sources.push({
      sourceType: 'planning:independent_volume_candidates',
      sourceId: `candidates:${brief.volumePlanId}`,
      content: JSON.stringify(peerCandidates),
      reason: '两位编剧独立完成的候选；模型来源以任务快照为准，主编可取舍但不得抹平真实差异',
      priority: 100
    });
  }
  return sources;
}

function buildOptionalSources(
  snapshot: VolumePlanGenerationSourceSnapshot,
  brief: VolumePlanGenerationBrief
): ContextSource[] {
  const genreBrief = buildGenreBrief(snapshot.opening.content);
  return [
    ...(genreBrief === null ? [] : [{
      sourceType: 'planning:genre_brief',
      sourceId: `genre:${snapshot.opening.id}`,
      version: snapshot.opening.version,
      content: genreBrief,
      reason: '从开书信息派生的题材与基调导航，不是硬公式',
      priority: 70
    }]),
    ...(brief.template.selectionMode === 'none' ? [] : [{
      sourceType: 'planning:legacy_template_preference',
      sourceId: `template:${brief.volumePlanId}`,
      content: JSON.stringify(brief.template),
      reason: '旧前端保存的作者推进偏好，只作兼容软参考，不进入硬约束',
      priority: 35
    }])
  ];
}

function buildPrompt(input: {
  seat: VolumePlanGenerationSeat;
  candidateKind: CandidateKind;
  snapshot: VolumePlanGenerationSourceSnapshot;
  brief: VolumePlanGenerationBrief;
  sources: Array<{ sourceType: string; sourceId: string; reason: string; content: string }>;
  peerCandidates: unknown[];
}): string {
  const fusion = input.candidateKind === 'fusion';
  const fallbackRecipes = selectHiddenVolumeRouteRecipes(
    `${input.snapshot.bookTitle} ${input.snapshot.opening.content}`,
    input.snapshot.planNumber === 1
  );
  const recipes = input.brief.routeRecipes ?? fallbackRecipes;
  const routeRecipe: HiddenVolumeRouteRecipe | null = input.candidateKind === 'candidate_a' ? recipes[0] : input.candidateKind === 'candidate_b' ? recipes[1] : null;
  return JSON.stringify({
    operation: 'volume_direction_generation_v2',
    language: 'zh-CN',
    seat: {
      roleKey: input.seat.roleKey,
      displayName: input.seat.displayName,
      mode: fusion ? 'chief_editor_fusion' : 'independent_screenwriter'
    },
    book: {
      title: input.snapshot.bookTitle,
      volumeNumber: input.snapshot.planNumber
    },
    narrativeScaffold: routeRecipe?.scaffold ?? [],
    instructions: fusion ? [
      '只基于作者明确选中的候选部分、作者原话和冻结资料包，形成一条完整可执行的卷方向；不得补回未选候选内容。',
      AUTHOR_IDEA_POLICY_PLANNING,
      SETTING_GAP_OUTPUT_INSTRUCTION,
      '不要平均拼接。明确选择更有因果力量的路径，保留真正有价值的分歧和不确定项。',
      '卷方向只约束目标、冲突、人物变化、高潮责任与卷末状态；不要在这一阶段设计事件列表、章节、场景或对白。',
      '方向中的升级阶段必须由人物选择、阻力和后果自然相接，不用巧合强行转向。',
      '融合候选保留你选定路线的本卷基调与本卷重点表达，不要平均拼接两种味道。',
      '融合方向必须用benefits和risks向作者说清阅读收益与写作风险，不输出额外理论说明。',
      '只输出一个JSON对象，不要Markdown、解释、评分或内部思考。'
    ] : [
      '你与另一位编剧互相看不到答案。独立提出一条真正值得写、因果成立且结构有辨识度的卷路线。',
      AUTHOR_IDEA_POLICY_PLANNING,
      SETTING_GAP_OUTPUT_INSTRUCTION,
      input.seat.roleKey === 'lead_screenwriter'
        ? '优先从人物欲望、阻力、选择、代价和后果推演，不套固定爽点清单。'
        : '主动挑战最直觉的前提，寻找被忽略的关系、代价或结构路径，但反转必须能由前文因果支持。',
      '按本轮收到的白话节点职责自然设计；可以移动、合并或舍弃软节点，不得在输出中提及任何专业结构名称。',
      '卷方向只约束目标、冲突、人物变化、高潮责任与卷末状态；事件链将在确认后单独设计。',
      '本卷基调默认延续上一卷（若资料中提供），除非本卷剧情走向明显变化；基调是写作倾向声明，不是内容清单。',
      '本卷重点表达（expressionFocus）：从全书标签、开书信息、已确认设定和上一卷走向提炼一至三项具体阅读感受，只写当卷重点，不推翻全书基调。',
      '只输出一个JSON对象，不要Markdown、解释、评分或内部思考。'
    ],
    sourcePolicy: {
      confirmedSettingIsFact: true,
      authorMustIsHard: true,
      authorPreferenceAndInspirationAreSoft: true,
      authorQuestionNeverBecomesContent: true,
      unsupportedCoreSettingAction: 'keep the unknown in direction.openSpaces instead of inventing a hard fact'
    },
    expressionBudget: volumePlanExpressionBudget(input.candidateKind),
    firstVolumeRules: input.snapshot.planNumber === 1 ? [
      '前500有效中文字内必须建立读者问题、即时处境、情绪抓力和变化承诺；效果必须具体，手段不限定为打斗或打脸。',
      '前三章作为一组设计：第一章出场与困境，第二章行动与压力并给首次回报，第三章完成阶段结果并打开更大目标。',
      '第一卷维持有效冲突、情绪拉扯和代入，但不按固定间隔机械安排爽点或反转。',
      '累计10万有效字以内或本卷结束前（取更早）安排重大高潮，必须包含选择、代价、不可逆变化和下一阶段。',
      'storySpine是可选的当前长期方向；作者没有想到时允许完全不输出。若输出，只整理当前能看见的跨卷承诺与阶段，不得强补全书路线或结局；protectedOpenSpaces必须保留未来创造空间。'
    ] : [],
    sources: input.sources,
    outputContract: {
      settingGaps: [{ question: '当前任务缺少什么必要设定', whyNeeded: '为什么此刻不决定就无法继续', affectedObjects: ['当前卷或下游对象'] }],
      direction: {
        title: '卷标题',
        openingSituation: '开卷时人物与局面',
        protagonistDrive: '什么需要、选择或压力真正推动主角行动',
        volumeGoal: '本卷必须解决或推进什么',
        centralOpposition: '主要对立力量，以及它为什么能持续施压',
        escalationPath: ['三至五段因果相接的升级过程，不出现专业方法名'],
        majorChoices: ['会真正改变局面的关键选择'],
        relationshipMovement: ['本卷重要人物关系怎样变化'],
        expressionFocus: ['本卷想重点带给读者的感受或看点'],
        climaxResponsibility: '高潮必须兑现什么前期承诺、解决什么核心矛盾',
        costAndConsequence: '主角付出的代价及高潮后的真实后果',
        closingState: '卷末人物、关系和局面进入什么新状态',
        benefits: ['这条路线具体好看在哪里'],
        risks: ['最容易套路化、失真或疲劳的地方'],
        openSpaces: ['明确留给事件、章纲和正文继续创造的空间'],
        ...(input.snapshot.planNumber === 1 ? {
          firstVolumeLaunch: {
            primaryDrivers: ['这一卷主要靠什么形成持续追读动力'],
            immersionAnchor: '读者主要代入谁的什么欲望、困境或关系',
            first500Interest: {
              readerQuestion: '前500有效正文字符让读者想继续确认什么',
              immediateSituation: '开篇正在发生、不能忽略的具体处境',
              emotionalGrip: '通过人物感受和行动形成什么情绪抓力',
              promisedMovement: '前500字让读者看见故事即将发生什么变化'
            },
            goldenThree: [{
              chapterNumber: '必须依次为1、2、3',
              responsibility: '这一章在前三章整体中的唯一职责',
              protagonistAction: '主角采取的具体行动',
              pressureOrPull: '行动面对的阻力或关系拉力',
              deliveredPayoff: '当章必须兑现的有效回报',
              nextExpectation: '自然打开下一章的具体期待'
            }],
            earlyMomentum: ['首卷前期怎样持续产生有效变化和阶段回报'],
            majorClimax: {
              promiseToFulfill: '兑现前面哪个重要承诺',
              centralChoice: '主角必须作出的重大主动选择',
              cost: '选择真正付出的代价',
              centralConflictChange: '哪条主要冲突发生决定性变化',
              irreversibleChange: '人物、关系或局面怎样不可逆改变',
              nextStageTrigger: '怎样打开下一阶段',
              noLaterThanEffectiveChars: 100000
            },
            variationAndRecovery: ['怎样更换冲突与情绪类型，并安排必要蓄力和喘息'],
            forbiddenShortcuts: ['本书应避免重复使用的套路化捷径']
          }
        } : {})
      },
      ...(input.snapshot.planNumber === 1 ? {
        storySpine: {
          optional: true,
          longTermReaderPromises: ['当前可见阶段持续兑现给读者的核心满足；不知道更远处可以不写'],
          protagonistLongArc: '目前已经想到的主角跨卷变化方向',
          centralQuestion: '目前可见阶段持续推进的问题；全书中心问题未知时可不输出storySpine',
          escalationLadder: ['只写作者当前能看见的跨卷阶段，不推断更远剧情'],
          optionalEndingDirections: ['可选结局方向；尚未决定可留空数组'],
          protectedOpenSpaces: ['哪些未来内容必须保持开放，不能提前解释']
        }
      } : {})
    }
  });
}

export function volumePlanExpressionBudget(candidateKind: CandidateKind): string[] {
  const common = [
    'Length limits control transport size only; they must not flatten causality, character choice or route differences.',
    'Keep every prose field concrete and concise; do not repeat setting summaries across fields.',
    'Keep escalationPath at 3-5 items and other arrays at no more than 5 items unless the first-volume contract explicitly requires 3 chapters.',
    'Do not design event lists, chapter lists, scene beats or dialogue in the volume direction.',
    'Finish the complete JSON object before adding detail. Never spend the output limit on explanation, Markdown or professional structure terms.'
  ];
  return candidateKind === 'fusion'
    ? ['The complete fusion direction JSON must stay within 5,500 Chinese characters.', ...common]
    : ['The complete route direction JSON must stay within 6,500 Chinese characters.', ...common];
}

function retrievalQuery(
  snapshot: VolumePlanGenerationSourceSnapshot,
  brief: VolumePlanGenerationBrief,
  candidateKind: CandidateKind
): string {
  const authorText = brief.authorIdeas.flatMap((idea) => [
    idea.originalText,
    idea.scopeNotes ?? '',
    ...idea.attachmentExcerpts.map((attachment) => attachment.excerpt)
  ]).join(' ');
  return [
    snapshot.bookTitle,
    `第${snapshot.planNumber}卷规划`,
    candidateKind === 'fusion' ? '只整理作者选中的卷路线部分' : '人物目标 冲突 代价 关系 高潮责任',
    authorText
  ].filter(Boolean).join(' ');
}


function parseBrief(value: Record<string, unknown>): VolumePlanGenerationBrief {
  const brief = value as unknown as VolumePlanGenerationBrief;
  if (
    brief.schema !== 'volume-plan-generation-v1'
    || typeof brief.volumePlanId !== 'string'
    || !Array.isArray(brief.seats)
    || !Array.isArray(brief.authorIdeas)
  ) throw new Error('卷规划任务资料包格式无效。');
  return brief;
}

function requiredSeat(seats: VolumePlanGenerationSeat[], roleKey: string): VolumePlanGenerationSeat {
  const seat = seats.find((candidate) => candidate.roleKey === roleKey);
  if (seat === undefined) throw new Error(`卷规划任务缺少冻结岗位：${roleKey}`);
  return seat;
}

export function invalidVolumePlanOutputFailure(validationFailure: string): ModelAdapterError {
  return new ModelAdapterError(
    `卷规划输出在有界重试后仍未通过结构校验，需要由另一可用模型补位：${validationFailure}`,
    'technical_failure',
    true,
    200,
    false
  );
}

function isKnownRetryableTechnicalFailure(result: PromiseSettledResult<unknown>): boolean {
  return result.status === 'rejected'
    && result.reason instanceof ModelAdapterError
    && result.reason.failureClass === 'technical_failure'
    && result.reason.retryable
    && !result.reason.outcomeUnknown;
}

export function selectTechnicalSubstitute(
  seats: VolumePlanGenerationSeat[],
  unavailable: VolumePlanGenerationSeat[]
): VolumePlanGenerationSeat | null {
  const unavailableAgents = new Set(unavailable.map((seat) => seat.agentId));
  const unavailableBindings = new Set(unavailable.map((seat) =>
    JSON.stringify([seat.provider, seat.modelId])
  ));
  const preference = ['backup_writer', 'researcher', 'literary_reviewer', 'deputy_editor', 'setting'];
  return [...seats]
    .filter((seat) => !seat.editor && !unavailableAgents.has(seat.agentId)
      && !unavailableBindings.has(JSON.stringify([seat.provider, seat.modelId])))
    .sort((left, right) => {
      const leftRank = preference.indexOf(left.roleKey);
      const rightRank = preference.indexOf(right.roleKey);
      return (leftRank === -1 ? preference.length : leftRank)
        - (rightRank === -1 ? preference.length : rightRank);
    })[0] ?? null;
}

export function selectEditorTechnicalSubstitute(
  seats: VolumePlanGenerationSeat[],
  unavailable: VolumePlanGenerationSeat[]
): VolumePlanGenerationSeat | null {
  const unavailableAgents = new Set(unavailable.map((seat) => seat.agentId));
  const preference = ['researcher', 'setting', 'deputy_editor', 'literary_reviewer', 'backup_writer'];
  return [...seats]
    .filter((seat) => !seat.editor && !unavailableAgents.has(seat.agentId))
    .sort((left, right) => {
      const leftRank = preference.indexOf(left.roleKey);
      const rightRank = preference.indexOf(right.roleKey);
      return (leftRank === -1 ? preference.length : leftRank)
        - (rightRank === -1 ? preference.length : rightRank);
    })[0] ?? null;
}

function seatAttribution(seat: VolumePlanGenerationSeat, technicalSubstitute: boolean) {
  return {
    roleKey: seat.roleKey,
    agentId: seat.agentId,
    displayName: seat.displayName,
    provider: seat.provider,
    modelId: seat.modelId,
    technicalSubstitute
  };
}

function rejectedReason(result: PromiseSettledResult<unknown>): unknown {
  return result.status === 'rejected' ? result.reason : new Error('卷规划候选没有形成可用结果。');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
