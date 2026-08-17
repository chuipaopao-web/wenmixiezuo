import { hashStableContractContent } from '@wenmi/contracts';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { buildGenreBrief } from '../../domain/genre-brief.js';
import type { BookScope } from '../../domain/scope.js';
import type { CreationSettlementRepository } from '../../infrastructure/db/repositories/creation-settlement-repository.js';
import type { OpeningBlueprintRepository } from '../../infrastructure/db/repositories/opening-blueprint-repository.js';
import {
  SettlementFollowUpRepository,
  type SettlementFollowUpRow,
  type SettlementFollowUpStageKind
} from '../../infrastructure/db/repositories/settlement-follow-up-repository.js';
import {
  VolumePlanGenerationRepository,
  type VolumePlanGenerationSeat
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { TaskService, type TaskRecord } from '../tasks/task-service.js';

export interface SettlementFollowUpBrief {
  schema: 'settlement-follow-up-v1';
  stageKind: SettlementFollowUpStageKind;
  stageObjectId: string;
  settlementId: string;
  title: string;
  chapterStart: number;
  chapterEnd: number;
  planned: unknown;
  actual: unknown;
  deviation: unknown;
  genreBrief: string | null;
  seats: VolumePlanGenerationSeat[];
  requestHash: string;
}

export interface SettlementFollowUpView {
  taskId: string;
  status: string;
  currentPhase: string;
  errorCode: string | null;
  stageKind: SettlementFollowUpStageKind;
  stageObjectId: string;
  settlementId: string;
  pacingReport: unknown | null;
  summary: string | null;
  pacingBy: { agentId: string; displayName: string } | null;
  summaryBy: { agentId: string; displayName: string } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 结算后续：事件或卷结算完成后，主编出节奏体检、副编写大白话摘要。
 * 结算本身保持确定性聚合不变；本服务只负责发起后续团队任务。
 */
export class SettlementFollowUpService {
  public constructor(
    private readonly repository: SettlementFollowUpRepository,
    private readonly settlements: CreationSettlementRepository,
    private readonly openings: OpeningBlueprintRepository,
    private readonly teamRepository: VolumePlanGenerationRepository,
    private readonly tasks: TaskService,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public start(
    scope: BookScope,
    stageKind: SettlementFollowUpStageKind,
    stageObjectId: string
  ): SettlementFollowUpView {
    const assessment = this.settlements.assessment(scope, stageKind, stageObjectId);
    if (assessment === null) {
      throw new DomainError(errorCodes.operationIncomplete, '结算尚未完成，结算后续还排不上。', {}, false, 409);
    }
    const existing = this.repository.byStage(scope, stageKind, stageObjectId);
    if (existing !== undefined) {
      const existingTask = this.tasks.require(scope, existing.task_id);
      if (!['failed', 'cancelled', 'interrupted', 'blocked'].includes(existingTask.status)) {
        return this.toView(existingTask, existing);
      }
    }
    const team = this.teamRepository.generationSeats(scope);
    const pacingSeat = team.seats.find((seat) => seat.editor);
    const summarySeat = team.seats.find((seat) => seat.roleKey === 'deputy_editor');
    if (pacingSeat === undefined || summarySeat === undefined) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '结算后续需要当前主编和副编都可用。',
        { availableRoles: team.seats.map((seat) => seat.roleKey) },
        false,
        409
      );
    }
    const budgetId = this.teamRepository.activeBudgetId(scope);
    if (budgetId === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '当前书籍没有可用预算。', {}, false, 409);
    }
    const opening = this.openings.active(scope);
    const title = this.stageTitle(scope, stageKind, stageObjectId);
    const brief: SettlementFollowUpBrief = {
      schema: 'settlement-follow-up-v1',
      stageKind,
      stageObjectId,
      settlementId: assessment.settlementId,
      title,
      chapterStart: assessment.chapterStart,
      chapterEnd: assessment.chapterEnd,
      planned: bounded(assessment.planned),
      actual: bounded(assessment.actual),
      deviation: bounded(assessment.deviation),
      genreBrief: buildGenreBrief(opening?.blueprint_json ?? null),
      seats: [pacingSeat, summarySeat],
      requestHash: hashStableContractContent({
        stageKind,
        stageObjectId,
        settlementId: assessment.settlementId,
        seats: [pacingSeat.agentId, summarySeat.agentId]
      }).slice('sha256:'.length)
    };
    const taskId = this.ids.next();
    const retrySuffix = existing === undefined ? '' : `:retry:${existing.task_id}`;
    const task = this.unitOfWork.run(() => {
      const created = this.tasks.create(scope, {
        taskId,
        taskType: 'settlement_follow_up',
        assignedAgentId: pacingSeat.agentId,
        idempotencyKey: `settlement-follow-up:${stageKind}:${stageObjectId}${retrySuffix}`,
        budgetId,
        requiredEditorEpoch: team.editorEpoch,
        initialPhase: 'preparing_context',
        brief: brief as unknown as Record<string, unknown>
      });
      this.repository.createOrResetPending(scope, {
        followUpId: existing?.follow_up_id ?? this.ids.next(),
        stageKind,
        stageObjectId,
        settlementId: assessment.settlementId,
        taskId: created.taskId,
        now: this.clock.now().toISOString()
      });
      return created.status === 'pending' ? this.tasks.queue(scope, created.taskId) : created;
    });
    return this.toView(task, this.repository.byTask(scope, task.taskId)!);
  }

  public view(
    scope: BookScope,
    stageKind: SettlementFollowUpStageKind,
    stageObjectId: string
  ): SettlementFollowUpView | null {
    const row = this.repository.byStage(scope, stageKind, stageObjectId);
    if (row === undefined) return null;
    return this.toView(this.tasks.require(scope, row.task_id), row);
  }

  private stageTitle(scope: BookScope, stageKind: SettlementFollowUpStageKind, stageObjectId: string): string {
    const contentJson = stageKind === 'event'
      ? this.settlements.eventPlan(scope, stageObjectId)?.eventContentJson
      : this.settlements.volumePlan(scope, stageObjectId)?.volumeContentJson;
    if (contentJson === undefined) return stageKind === 'event' ? '当前事件' : '当前卷';
    try {
      const content = JSON.parse(contentJson) as Record<string, unknown>;
      return typeof content.title === 'string' && content.title.trim().length > 0
        ? content.title.trim()
        : stageKind === 'event' ? '当前事件' : '当前卷';
    } catch {
      return stageKind === 'event' ? '当前事件' : '当前卷';
    }
  }

  private toView(task: TaskRecord, row: SettlementFollowUpRow): SettlementFollowUpView {
    const brief = task.brief as unknown as SettlementFollowUpBrief;
    const seatName = (agentId: string | null): { agentId: string; displayName: string } | null => {
      if (agentId === null) return null;
      const seat = brief.seats.find((item) => item.agentId === agentId);
      return { agentId, displayName: seat?.displayName ?? '创作成员' };
    };
    return {
      taskId: task.taskId,
      status: task.status,
      currentPhase: task.currentPhase,
      errorCode: task.errorCode,
      stageKind: row.stage_kind,
      stageObjectId: row.stage_object_id,
      settlementId: row.settlement_id,
      pacingReport: row.pacing_report_json === null ? null : JSON.parse(row.pacing_report_json) as unknown,
      summary: row.summary_text,
      pacingBy: seatName(row.pacing_agent_id),
      summaryBy: seatName(row.summary_agent_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function bounded(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text.length <= 12_000) return value;
  return `${text.slice(0, 6_000)}\n【中间内容按需回查】\n${text.slice(-6_000)}`;
}
