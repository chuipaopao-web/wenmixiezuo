import {
  hashStableContractContent,
  type BookStorySpineContent,
  type VolumeDirectionContent
} from '@wenmi/contracts';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { LayeredPlanningRepository } from '../../infrastructure/db/repositories/layered-planning-repository.js';
import {
  VolumePlanGenerationRepository,
  type VolumePlanGenerationSeat,
  type VolumePlanGenerationSourceSnapshot
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import { TaskService, type TaskRecord } from '../tasks/task-service.js';
import { LayeredPlanningService } from './layered-planning-service.js';
import { VolumePlanService } from './volume-plan-service.js';

export interface EventChainGenerationBrief {
  schema: 'event-chain-generation-v1';
  volumePlanId: string;
  planNumber: number;
  directionVersionId: string;
  directionContentHash: string;
  direction: VolumeDirectionContent;
  storySpine: BookStorySpineContent | null;
  sourceSnapshot: VolumePlanGenerationSourceSnapshot;
  expectedWorkflowVersion: number;
  designer: VolumePlanGenerationSeat;
  editor: VolumePlanGenerationSeat;
  requestHash: string;
}

export interface EventChainGenerationView {
  taskId: string;
  status: string;
  currentPhase: string;
  errorCode: string | null;
  checkpoint: Record<string, unknown>;
  members: Array<{ roleKey: string; displayName: string }>;
  candidateEventChainId: string | null;
}

export class EventChainGenerationService {
  public constructor(
    private readonly repository: LayeredPlanningRepository,
    private readonly teamRepository: VolumePlanGenerationRepository,
    private readonly layered: LayeredPlanningService,
    private readonly volumePlans: VolumePlanService,
    private readonly tasks: TaskService,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public start(scope: BookScope, volumePlanId: string, input: {
    expectedWorkflowVersion: number;
    idempotencyKey: string;
  }): EventChainGenerationView {
    const expectedWorkflowVersion = positive(input.expectedWorkflowVersion, '工作流版本');
    const idempotencyKey = required(input.idempotencyKey, '幂等键');
    const plan = this.volumePlans.get(scope, volumePlanId);
    if (plan.activeVersionId === null || !['active', 'planning'].includes(plan.status)) {
      throw conflict('请先确认当前卷方向，再设计事件链。');
    }
    const workflow = this.volumePlans.workflow(scope);
    if (workflow.planningVersion !== expectedWorkflowVersion
      || workflow.activeVolumePlanRef?.id !== volumePlanId) {
      throw conflict('当前卷或创作流程已经变化，请刷新后重试。');
    }
    if (!['volume_plan_confirmed', 'event_sequence_in_progress'].includes(workflow.stage)) {
      throw conflict('当前阶段不能设计事件链。');
    }
    const direction = this.layered.activeDirection(scope, volumePlanId);
    if (direction === null || direction.legacyVolumePlanVersionId !== plan.activeVersionId) {
      throw conflict('当前确认卷稿没有对应的活动卷方向。');
    }
    const sourceSnapshot = this.teamRepository.sourceSnapshot(scope, volumePlanId);
    if (sourceSnapshot === undefined || sourceSnapshot.activeVersionId !== plan.activeVersionId) {
      throw new DomainError(errorCodes.operationIncomplete, '开书、设定、上一卷结算或当前卷资料不完整。', {}, false, 409);
    }
    const team = this.teamRepository.generationSeats(scope);
    const designer = team.seats.find((seat) => seat.roleKey === 'lead_screenwriter');
    const editor = team.seats.find((seat) => seat.editor);
    if (designer === undefined || editor === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '事件链设计需要编剧和主编席可用。', {}, false, 409);
    }
    const budgetId = this.teamRepository.activeBudgetId(scope);
    if (budgetId === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '当前书籍没有可用预算。', {}, false, 409);
    }
    const brief: EventChainGenerationBrief = {
      schema: 'event-chain-generation-v1',
      volumePlanId,
      planNumber: plan.planNumber,
      directionVersionId: direction.volumeDirectionVersionId,
      directionContentHash: direction.contentHash,
      direction: direction.content,
      storySpine: this.layered.activeStorySpine(scope),
      sourceSnapshot,
      expectedWorkflowVersion,
      designer,
      editor,
      requestHash: ''
    };
    brief.requestHash = digest({ ...brief, requestHash: undefined });
    const taskId = this.ids.next();
    const task = this.unitOfWork.run(() => {
      const created = this.tasks.create(scope, {
        taskId,
        taskType: 'event_chain_generation',
        assignedAgentId: designer.agentId,
        idempotencyKey: `event-chain-generation:${volumePlanId}:${idempotencyKey}`,
        budgetId,
        requiredEditorEpoch: team.editorEpoch,
        initialPhase: 'preparing_context',
        brief: brief as unknown as Record<string, unknown>
      });
      if (created.brief.requestHash !== brief.requestHash) {
        throw conflict('同一个幂等键不能用于不同的事件链设计请求。');
      }
      if (!this.repository.attachEventChainWaitingTask(scope, {
        volumePlanId,
        taskId: created.taskId,
        expectedWorkflowVersion,
        now: this.clock.now().toISOString()
      })) {
        throw conflict('创作流程已变化，事件链任务没有启动。');
      }
      if (created.status === 'pending') return this.tasks.queue(scope, created.taskId);
      return created;
    });
    return this.view(scope, task);
  }

  public latest(scope: BookScope, volumePlanId: string): EventChainGenerationView | null {
    const row = this.repository.latestEventChainGenerationTask(scope, volumePlanId);
    return row === undefined ? null : this.view(scope, this.tasks.require(scope, row.task_id));
  }

  public reconcileTerminal(scope: BookScope, task: TaskRecord): void {
    if (task.taskType === 'event_chain_generation' && ['cancelled', 'succeeded'].includes(task.status)) {
      this.teamRepository.clearWaitingTask(scope, task.taskId, this.clock.now().toISOString());
    }
  }

  public view(scope: BookScope, task: TaskRecord): EventChainGenerationView {
    const brief = parseBrief(task.brief);
    const chain = this.layered.eventChainForTask(scope, brief.volumePlanId, task.taskId);
    return {
      taskId: task.taskId,
      status: task.status,
      currentPhase: task.currentPhase,
      errorCode: task.errorCode,
      checkpoint: task.checkpoint,
      members: [
        { roleKey: brief.designer.roleKey, displayName: brief.designer.displayName },
        { roleKey: brief.editor.roleKey, displayName: brief.editor.displayName }
      ],
      candidateEventChainId: chain?.id ?? null
    };
  }
}

export function parseEventChainGenerationBrief(value: Record<string, unknown>): EventChainGenerationBrief {
  return parseBrief(value);
}

function parseBrief(value: Record<string, unknown>): EventChainGenerationBrief {
  const brief = value as unknown as EventChainGenerationBrief;
  if (brief.schema !== 'event-chain-generation-v1'
    || typeof brief.volumePlanId !== 'string'
    || typeof brief.directionVersionId !== 'string'
    || typeof brief.directionContentHash !== 'string'
    || typeof brief.planNumber !== 'number'
    || typeof brief.requestHash !== 'string'
    || brief.sourceSnapshot === undefined
    || brief.designer === undefined
    || brief.editor === undefined) {
    throw new Error('事件链任务资料包格式无效。');
  }
  return brief;
}
function digest(value: unknown): string {
  return hashStableContractContent(value).slice('sha256:'.length);
}
function positive(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw validation(label + '必须是大于0的整数。');
  return Number(value);
}
function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw validation(label + '不能为空。');
  return value.trim();
}
function validation(message: string): DomainError {
  return new DomainError(errorCodes.validation, message);
}
function conflict(message: string): DomainError {
  return new DomainError(errorCodes.bookVersionConflict, message, {}, false, 409);
}
