import { createHash } from 'node:crypto';
import {
  firstVolumeCoverageResponsibilityValues,
  hashStableContractContent,
  parseEventChainContent,
  type EventChainContent,
  type VolumeDirectionContent
} from '@wenmi/contracts';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import {
  VolumePlanGenerationRepository
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens, type ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence } from '../tasks/task-service.js';
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
      const pack = this.contextPacks.build(scope, {
        taskId,
        agentId: brief.designer.agentId,
        canonRevision: brief.sourceSnapshot.canonRevision,
        positioningVersion: brief.sourceSnapshot.positioningVersion,
        tokenBudget: 18_000,
        characterBudget: 42_000,
        policyVersion: 'event-chain-context-v1-layered-responsibility-coverage',
        hardSources: sources.filter((source) => source.priority >= 90),
        optionalSources: sources.filter((source) => source.priority < 90)
      });
      const prompt = buildEventChainPrompt(brief, pack.sources.map((source) => ({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        reason: source.reason,
        content: source.content
      })));
      const content = await this.callModel(scope, taskId, brief, prompt, pack.contextPackId);
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
    prompt: string,
    contextPackId: string
  ): Promise<EventChainContent> {
    const task = this.tasks.require(scope, taskId);
    if (task.budgetId === null) throw new Error('事件链任务缺少冻结预算。');
    const seat = brief.designer;
    const adapter = this.modelAdapters.resolve(seat.provider, seat.modelId, 'discussion', seat.roleKey as never);
    const maxOutputTokens = 9_000;
    let validationFailure: string | null = null;
    let lastError: unknown;
    for (let technicalTry = 1; technicalTry <= 2; technicalTry += 1) {
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
          return parseEventChainModelOutput(reusable.output_text, brief.planNumber, brief.direction);
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
          phaseKey: `event_chain:${seat.roleKey}:attempt-${task.currentAttemptNo}:try-${technicalTry}`,
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
          return parseEventChainModelOutput(result.output, brief.planNumber, brief.direction);
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '事件链JSON无效';
          lastError = error;
        }
      } catch (error) {
        if (this.teamRepository.isUnresolvedModelCall(scope, requestId)) throw error;
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('模型没有返回完整、合法的事件链。');
  }
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

export function parseEventChainModelOutput(
  output: string,
  planNumber: number,
  direction: VolumeDirectionContent
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
      assertDirectionCoverage(content, direction);
      return content;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('模型没有返回完整、合法的事件链。');
}

function assertDirectionCoverage(content: EventChainContent, direction: VolumeDirectionContent): void {
  const required = directionCoverageKeys(direction);
  const actual = new Set(content.coverage.filter((item) => item.status === 'covered').map((item) => item.responsibility));
  const missing = required.filter((item) => !actual.has(item));
  if (missing.length > 0) throw new Error('事件链没有覆盖卷方向责任：' + missing.join('、'));
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
  return result;
}

function buildEventChainPrompt(
  brief: EventChainGenerationBrief,
  sources: Array<{ sourceType: string; sourceId: string; reason: string; content: string }>
): string {
  const coverage = directionCoverageKeys(brief.direction);
  return JSON.stringify({
    operation: 'event_chain_generation_v1',
    language: 'zh-CN',
    book: { title: brief.sourceSnapshot.bookTitle, volumeNumber: brief.planNumber },
    instructions: [
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
