import { createHash } from 'node:crypto';
import {
  firstVolumeCoverageResponsibilityValues,
  hashStableContractContent,
  parseEventChainContent,
  type EventChainContent,
  type VolumeDirectionContent
} from '@wenmi/contracts';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { AUTHOR_IDEA_POLICY_PLANNING } from '../../domain/author-idea-policy.js';
import type { BookScope } from '../../domain/scope.js';
import { ModelAdapterError } from '../../infrastructure/models/model-adapter.js';
import type { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import {
  VolumePlanGenerationRepository,
  type VolumePlanGenerationSeat
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens, type ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence } from '../tasks/task-service.js';
import { authorIdeaContextSources } from './author-idea-context-sources.js';
import {
  parseEventChainGenerationBrief,
  type EventChainGenerationBrief
} from './event-chain-generation-service.js';
import { LayeredPlanningService } from './layered-planning-service.js';

export class EventChainGenerationPipelineService {
  public constructor(
    private readonly teamRepository: VolumePlanGenerationRepository,
    private readonly layered: LayeredPlanningService,
    private readonly tasks: TaskService,
    private readonly budgets: BudgetService,
    private readonly calls: ModelCallService,
    private readonly contextPacks: ContextPackService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory
  ) {}

  public async executeClaimed(
    scope: BookScope,
    taskId: string,
    workerId: string,
    fence?: TaskLeaseFence
  ): Promise<{ taskId: string; eventChainVersionId: string; status: 'succeeded' | 'cancelled' }> {
    const task = this.tasks.require(scope, taskId);
    if (task.taskType !== 'event_chain_generation' || task.status !== 'working'
      || task.leaseOwner !== workerId
      || (fence !== undefined && (task.leaseToken !== fence.leaseToken || task.currentAttemptNo !== fence.attemptNo))) {
      throw new Error('事件链任务未由指定Worker持有。');
    }
    const brief = parseEventChainGenerationBrief(task.brief);
    const stored = this.layered.eventChainForTask(scope, brief.volumePlanId, taskId);
    if (stored !== null) {
      this.tasks.complete(scope, taskId, workerId, fence);
      this.teamRepository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
      return { taskId, eventChainVersionId: stored.id, status: 'succeeded' };
    }
    try {
      this.assertSourcesCurrent(scope, brief);
      if (this.tasks.require(scope, taskId).cancelRequested) {
        this.tasks.complete(scope, taskId, workerId, fence);
        this.teamRepository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
        return { taskId, eventChainVersionId: '', status: 'cancelled' };
      }
      const sources = eventChainSources(brief);
      const generate = async (
        seat: VolumePlanGenerationSeat,
        phase: 'candidate_a' | 'candidate_b' | 'fusion',
        phaseSources: ContextSource[]
      ): Promise<EventChainContent> => {
        const pack = this.contextPacks.build(scope, {
          taskId,
          agentId: seat.agentId,
          canonRevision: brief.sourceSnapshot.canonRevision,
          positioningVersion: brief.sourceSnapshot.positioningVersion,
          tokenBudget: phase === 'fusion' ? 24_000 : 18_000,
          characterBudget: phase === 'fusion' ? 58_000 : 42_000,
          policyVersion: 'event-chain-context-v2-author-input-three-seat-fusion',
          hardSources: phaseSources.filter((source) => source.priority >= 90),
          optionalSources: phaseSources.filter((source) => source.priority < 90)
        });
        const prompt = buildEventChainPrompt(brief, pack.sources.map((source) => ({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          reason: source.reason,
          content: source.content
        })), phase);
        return this.callModel(scope, taskId, brief, seat, phase, prompt, pack.contextPackId);
      };
      let content: EventChainContent;
      if (brief.secondDesigner === undefined) {
        content = await generate(brief.designer, 'fusion', sources);
      } else {
        const [candidateA, candidateB] = await settleEventChainCandidates(
          generate(brief.designer, 'candidate_a', sources),
          generate(brief.secondDesigner, 'candidate_b', sources)
        );
        this.tasks.checkpoint(scope, taskId, workerId, 'event_chain_candidates', {
          candidateAHash: digest(candidateA),
          candidateBHash: digest(candidateB),
          independent: true,
          crossReviewUsed: false
        }, fence);
        const fusionSources: ContextSource[] = [...sources,
          { sourceType: 'planning:event_chain_candidate_a', sourceId: taskId + ':candidate-a',
            content: JSON.stringify(candidateA), reason: '第一位编剧独立设计的完整事件链候选',
            priority: 100, constraintStrength: 'current_task', truthStatus: 'planned',
            scopeType: 'task', scopeId: taskId },
          { sourceType: 'planning:event_chain_candidate_b', sourceId: taskId + ':candidate-b',
            content: JSON.stringify(candidateB), reason: '第二位编剧独立设计的完整事件链候选',
            priority: 100, constraintStrength: 'current_task', truthStatus: 'planned',
            scopeType: 'task', scopeId: taskId }
        ];
        content = await generate(brief.editor, 'fusion', fusionSources);
      }
      const created = this.layered.addEventChain(scope, brief.volumePlanId, {
        planNumber: brief.planNumber,
        content,
        sourceTaskId: taskId,
        sourceVersionIds: [brief.directionVersionId],
        idempotencyKey: taskId + ':event-chain'
      });
      this.tasks.checkpoint(scope, taskId, workerId, 'event_chain_ready', {
        eventChainVersionId: created.id,
        directionVersionId: brief.directionVersionId,
        awaitingAuthorConfirmation: true,
        eventCount: created.content.events.length
      }, fence);
      this.tasks.complete(scope, taskId, workerId, fence);
      this.teamRepository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
      return { taskId, eventChainVersionId: created.id, status: 'succeeded' };
    } catch (error) {
      const current = this.tasks.require(scope, taskId);
      if (current.cancelRequested) {
        this.tasks.complete(scope, taskId, workerId, fence);
        this.teamRepository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
        return { taskId, eventChainVersionId: '', status: 'cancelled' };
      }
      const unknown = this.teamRepository.hasUnresolvedModelCallForAttempt(
        scope, taskId, task.currentAttemptNo
      );
      this.tasks.fail(scope, taskId, workerId, unknown ? 'MODEL_CALL_INTERRUPTED' : 'EVENT_CHAIN_GENERATION_FAILED', fence);
      this.teamRepository.markFailed(
        scope,
        taskId,
        unknown ? '模型调用结果暂时无法确认，事件链没有自动重试。' : '事件链设计未完成，可以从当前任务重试。',
        this.clock.now().toISOString()
      );
      throw error;
    }
  }

  private assertSourcesCurrent(scope: BookScope, brief: EventChainGenerationBrief): void {
    const direction = this.layered.activeDirection(scope, brief.volumePlanId);
    const currentSnapshot = this.teamRepository.sourceSnapshot(scope, brief.volumePlanId);
    if (direction === null
      || direction.volumeDirectionVersionId !== brief.directionVersionId
      || direction.contentHash !== brief.directionContentHash
      || currentSnapshot === undefined
      || digest(currentSnapshot) !== digest(brief.sourceSnapshot)) {
      throw new Error('卷方向、开书、设定或上一卷结算已经变化，请重新设计事件链。');
    }
  }

  private async callModel(
    scope: BookScope,
    taskId: string,
    brief: EventChainGenerationBrief,
    seat: VolumePlanGenerationSeat,
    phase: 'candidate_a' | 'candidate_b' | 'fusion',
    prompt: string,
    contextPackId: string
  ): Promise<EventChainContent> {
    const task = this.tasks.require(scope, taskId);
    if (task.budgetId === null) throw new Error('事件链任务缺少冻结预算。');

    const adapter = this.modelAdapters.resolve(seat.provider, seat.modelId, 'discussion', seat.roleKey as never);
    let retryKnownEmptyOutput = false;
    let validationFailure: string | null = null;
    let lastError: unknown;
    for (let technicalTry = 1; technicalTry <= 2; technicalTry += 1) {
      const maxOutputTokens = eventChainOutputTokenLimit(seat.modelId, retryKnownEmptyOutput);
      const currentPrompt = validationFailure === null
        ? prompt
        : `${prompt}\n\n${eventChainValidationRetryInstruction(
            validationFailure, brief.planNumber === 1)}`;
      const inputHash = createHash('sha256').update(currentPrompt).digest('hex');
      const reusable = this.teamRepository.succeededModelResult(scope, {
        taskId,
        agentId: seat.agentId,
        modelSnapshotId: seat.modelSnapshotId,
        inputHash
      });
      if (reusable !== undefined) {
        try {
          return parseEventChainPhaseOutput(
            reusable.output_text, brief.planNumber, brief.direction, phase, technicalTry
          );
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '事件链JSON无效';
          lastError = error;
          continue;
        }
      }
      const estimatedInput = Math.max(
        Math.ceil(currentPrompt.length / 2),
        Math.ceil(estimateTokens(currentPrompt) * 1.35)
      );
      const requestId = this.ids.next();
      const reservationId = this.budgets.reserve(
        scope,
        task.budgetId,
        requestId,
        Math.max(12_000, estimatedInput + maxOutputTokens + thinkingTokenAllowance(seat.modelId)),
        0
      );
      try {
        const result = await this.calls.execute(scope, {
          requestId,
          taskId,
          phaseKey: `event_chain:${phase}:${seat.roleKey}:attempt-${task.currentAttemptNo}:try-${technicalTry}`,
          agentId: seat.agentId,
          modelSnapshotId: seat.modelSnapshotId,
          provider: seat.provider,
          modelId: seat.modelId,
          input: currentPrompt,
          parameters: JSON.stringify({ maxOutputTokens, planOnly: !seat.provider.startsWith('local-deterministic'), cashFallbackAllowed: false }),
          reservationId,
          contextPackId,
          leaseToken: task.leaseToken,
          attemptNo: task.currentAttemptNo
        }, adapter, {
          requestId,
          taskId,
          ownerId: scope.ownerId,
          bookId: scope.bookId,
          agentId: seat.agentId,
          prompt: currentPrompt,
          maxOutputTokens
        });
        try {
          return parseEventChainPhaseOutput(
            result.output, brief.planNumber, brief.direction, phase, technicalTry
          );
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '事件链JSON无效';
          lastError = error;
        }
      } catch (error) {
        if (this.teamRepository.isUnresolvedModelCall(scope, requestId)) throw error;
        if (shouldRetryKnownEmptyEventChainOutput(error, technicalTry)) {
          retryKnownEmptyOutput = true;
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('模型没有返回完整、合法的事件链。');
  }
}

export async function settleEventChainCandidates<T>(
  first: Promise<T>,
  second: Promise<T>
): Promise<[T, T]> {
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);
  if (firstResult.status === 'rejected') throw firstResult.reason;
  if (secondResult.status === 'rejected') throw secondResult.reason;
  return [firstResult.value, secondResult.value];
}

export function shouldAcceptEventChainCandidateCoverageGap(
  error: unknown,
  phase: 'candidate_a' | 'candidate_b' | 'fusion',
  technicalTry: number
): boolean {
  return phase !== 'fusion'
    && technicalTry === 2
    && error instanceof Error
    && error.message.startsWith('事件链没有覆盖卷方向责任：');
}

export function eventChainOutputTokenLimit(modelId: string, expandedAfterKnownEmpty = false): number {
  if (modelId.toLowerCase().startsWith('glm-5.3')) return expandedAfterKnownEmpty ? 32_000 : 24_000;
  return expandedAfterKnownEmpty ? 18_000 : 9_000;
}

export function shouldRetryKnownEmptyEventChainOutput(error: unknown, technicalTry: number): boolean {
  return technicalTry < 2
    && error instanceof ModelAdapterError
    && error.retryable
    && !error.outcomeUnknown
    && error.statusCode === 200
    && error.message.includes('没有形成可提交文字');
}

export function eventChainValidationRetryInstruction(
  validationFailure: string,
  firstVolume = true
): string {
  const lines = [
    `上一份事件链未通过结构校验：${validationFailure}`,
    '请定点纠正并重新输出完整JSON，不要解释。'
  ];
  lines.push(firstVolume
    ? `firstVolumeResponsibilities只允许逐字使用这些稳定键：${firstVolumeCoverageResponsibilityValues.join('、')}。不得改写成中文标签、同义词、序号或自定义键，也不得删除任何首卷责任。`
    : '本卷不是第一卷，所有firstVolumeResponsibilities都必须是空数组。');
  return lines.join('\n');
}

function parseEventChainPhaseOutput(
  output: string,
  planNumber: number,
  direction: VolumeDirectionContent,
  phase: 'candidate_a' | 'candidate_b' | 'fusion',
  technicalTry: number
): EventChainContent {
  try {
    return parseEventChainModelOutput(output, planNumber, direction);
  } catch (error) {
    if (!shouldAcceptEventChainCandidateCoverageGap(error, phase, technicalTry)) throw error;
    return parseEventChainModelOutput(output, planNumber, direction, {
      allowIncompleteDirectionCoverage: true
    });
  }
}

export function parseEventChainModelOutput(
  output: string,
  planNumber: number,
  direction: VolumeDirectionContent,
  options: { allowIncompleteDirectionCoverage?: boolean } = {}
): EventChainContent {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* scan complete objects */ }
  for (const objectText of extractCompleteJsonObjects(output)) {
    try { candidates.push(JSON.parse(objectText) as unknown); } catch { /* continue */ }
  }
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const value = record(candidate);
      const content = parseEventChainContent(value.eventChain ?? value, planNumber === 1);
      assertDirectionCoverage(content, direction, options.allowIncompleteDirectionCoverage === true);
      return content;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('模型没有返回完整、合法的事件链。');
}

function assertDirectionCoverage(
  content: EventChainContent,
  direction: VolumeDirectionContent,
  allowIncompleteDirectionCoverage: boolean
): void {
  const required = directionCoverageKeys(direction);
  const actual = new Set(content.coverage.filter((item) => item.status === 'covered').map((item) => item.responsibility));
  const missing = required.filter((item) => !actual.has(item));
  if (!allowIncompleteDirectionCoverage && missing.length > 0) {
    throw new Error('事件链没有覆盖卷方向责任：' + missing.join('、'));
  }
  for (const [index, event] of content.events.entries()) {
    const last = index === content.events.length - 1;
    if (!last && (event.leadsToNext === null || event.leadsToNext.trim().length === 0)) {
      throw new Error('除最后一个事件外，每个事件都必须写清怎样自然触发下一事件。');
    }
    if (last && event.leadsToNext !== null) throw new Error('最后一个事件的下一事件接口必须为null。');
  }
}

export function directionCoverageKeys(direction: VolumeDirectionContent): string[] {
  return [
    'opening_situation',
    'volume_goal',
    ...direction.escalationPath.map((_, index) => `escalation_${index + 1}`),
    'major_choice',
    'climax_responsibility',
    'cost_and_consequence',
    'closing_state'
  ];
}

function eventChainSources(brief: EventChainGenerationBrief): ContextSource[] {
  const authorSources = authorIdeaContextSources(brief.authorIdeas, {
    sourceTypePrefix: 'owner:event_chain_ideas',
    sourceId: 'author-event-chain-ideas:' + brief.volumePlanId,
    layer: 'planning'
  });
  const result: ContextSource[] = [
    { sourceType: 'planning:opening_blueprint', sourceId: brief.sourceSnapshot.opening.id,
      version: brief.sourceSnapshot.opening.version, content: brief.sourceSnapshot.opening.content,
      reason: '已确认开书信息，只提供题材和基本方向', priority: 100 },
    { sourceType: 'planning:setting_baseline', sourceId: brief.sourceSnapshot.setting.id,
      version: brief.sourceSnapshot.setting.version, content: brief.sourceSnapshot.setting.content,
      reason: '已确认设定事实和规则边界', priority: 100 },
    { sourceType: 'planning:active_volume_direction', sourceId: brief.directionVersionId,
      content: JSON.stringify(brief.direction),
      reason: '当前任务：把已确认卷方向完整覆盖为有因果交接的事件链', priority: 100 }
  ];
  if (brief.sourceSnapshot.previousSettlement !== null) {
    result.push({ sourceType: 'planning:previous_volume_settlement',
      sourceId: brief.sourceSnapshot.previousSettlement.id,
      version: brief.sourceSnapshot.previousSettlement.version,
      content: brief.sourceSnapshot.previousSettlement.content,
      reason: '上一卷正文实际结算，当前事件链必须从真实状态出发', priority: 100 });
  }
  if (brief.storySpine !== null) {
    result.push({ sourceType: 'planning:book_story_spine', sourceId: 'active-story-spine',
      content: JSON.stringify(brief.storySpine),
      reason: '全书软方向，只用于避免当前卷偏离长期承诺，不得提前展开未来卷', priority: 55 });
  }
  result.push(...authorSources.hardSources, ...authorSources.optionalSources);
  return result;
}

function buildEventChainPrompt(
  brief: EventChainGenerationBrief,
  sources: Array<{ sourceType: string; sourceId: string; reason: string; content: string }>,
  phase: 'candidate_a' | 'candidate_b' | 'fusion'
): string {
  const coverage = directionCoverageKeys(brief.direction);
  return JSON.stringify({
    operation: 'event_chain_generation_v1',
    language: 'zh-CN',
    book: { title: brief.sourceSnapshot.bookTitle, volumeNumber: brief.planNumber },
    instructions: [
      AUTHOR_IDEA_POLICY_PLANNING,
      phase === 'candidate_a'
        ? '你是第一位独立编剧。独立完成整条事件链，优先检查人物主动行动、冲突因果和阶段兑现，不猜测另一位编剧会怎样写。'
        : phase === 'candidate_b'
          ? '你是第二位独立编剧。独立完成整条事件链，优先检查人物关系变化、铺垫兑现和节奏换型，不读取或迎合另一位编剧。'
          : '你是主编。只融合资料包中的两份独立候选，逐项核对卷责任、作者必须要求、因果交接和首卷责任；不得为了缩短而合并作者明确要求分开的事件。',
      '把已确认卷方向拆成一条有明确因果交接的事件链。事件是能独立形成进入状态、人物行动、阻力升级、阶段回报或代价、退出状态的小故事，不是章节列表。',
      '每个事件必须由上一事件结果和人物新状态触发；除最后一项外leadsToNext不能为空，最后一项必须为null。',
      'coverage必须逐项覆盖requiredCoverage中的稳定责任键；不能用同一个空泛事件假装覆盖全部责任。',
      'event节点只写事件级责任，不设计章节、场景、对白、具体意象或固定章数。',
      '线索使用plantThreadIds、payoffThreadIds、consequenceThreadIds做跨事件串联；标识要稳定且语义清楚。',
      brief.planNumber === 1
        ? '第一卷必须把开篇启动、黄金三章、早期回报、冲突与情绪升级、10万字前大高潮、高潮铺垫和高潮后果七项责任分配给具体事件。'
        : '后续卷根据上一卷实际结算重新组织事件，不复制第一卷开局骨架。',
      '不要输出三幕式、五幕式、猫咪、英雄之旅、节拍等专业结构名称。',
      '只输出一个JSON对象，不要Markdown、解释或内部思考。'
    ],
    requiredCoverage: coverage,
    firstVolumeResponsibilities: brief.planNumber === 1 ? firstVolumeCoverageResponsibilityValues : [],
    collaborationPhase: phase,
    sources,
    outputContract: {
      eventChain: {
        volumeDirectionVersionId: brief.directionVersionId,
        events: [{
          nodeId: '当前链内稳定唯一标识',
          order: '从1连续排列',
          title: '事件名称',
          volumeResponsibility: '为卷方向承担的具体责任',
          entryState: '人物、关系和局面从什么状态进入',
          protagonistAction: '主角采取什么主动行动或作出什么选择',
          oppositionEscalation: '对立力量怎样具体升级',
          stagePayoffOrCost: '这个事件兑现什么或付出什么代价',
          exitState: '事件结束后人物、关系和局面的新状态',
          leadsToNext: '新状态怎样自然触发下一事件；最后一个为null',
          plantThreadIds: ['本事件新种下的线程标识'],
          payoffThreadIds: ['本事件兑现的既有线程标识'],
          consequenceThreadIds: ['本事件产生并移交后续的后果线程'],
          firstVolumeResponsibilities: ['只使用给定首卷责任键；非首卷为空数组']
        }],
        coverage: [{ responsibility: 'requiredCoverage中的稳定责任键', eventNodeIds: ['承载节点标识'], status: 'covered' }]
      }
    }
  });
}

function extractCompleteJsonObjects(value: string): string[] {
  const found: string[] = [];
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          found.push(value.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return found;
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('事件链输出必须是JSON对象。');
  }
  return value as Record<string, unknown>;
}
function digest(value: unknown): string {
  return hashStableContractContent(value).slice('sha256:'.length);
}
