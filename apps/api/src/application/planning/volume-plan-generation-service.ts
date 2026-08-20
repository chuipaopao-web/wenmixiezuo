import {
  hashStableContractContent,
  parsePlanningTemplateInstance,
  type PlanningTemplateInstance
} from '@wenmi/contracts';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import {
  VolumePlanGenerationRepository,
  type VolumePlanGenerationSeat,
  type VolumePlanGenerationSourceSnapshot
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import type { TaskRecord } from '../tasks/task-service.js';
import { TaskService } from '../tasks/task-service.js';
import type { LayeredPlanningService, VolumeFusionSource } from './layered-planning-service.js';
import { VolumePlanService } from './volume-plan-service.js';
import {
  hiddenNarrativeMethodVersions,
  selectHiddenVolumeRouteRecipes,
  type HiddenVolumeRouteRecipe
} from './hidden-narrative-methods.js';

export interface VolumePlanGenerationBrief {
  schema: 'volume-plan-generation-v1';
  mode?: 'routes' | 'fusion';
  volumePlanId: string;
  fusionSource?: VolumeFusionSource;
  expectedPlanRevision: number;
  expectedActiveVersionId: string | null;
  expectedWorkflowVersion: number;
  sourceFingerprint: string;
  routeRecipes?: [HiddenVolumeRouteRecipe, HiddenVolumeRouteRecipe];
  template: PlanningTemplateInstance;
  authorInputRefs: string[];
  authorIdeas: Array<{
    id: string;
    intentStrength: string;
    originalText: string;
    scopeNotes: string | null;
    attachmentExcerpts: Array<{
      attachmentId: string;
      originalName: string;
      parseStatus: string;
      excerpt: string;
    }>;
  }>;
  seats: VolumePlanGenerationSeat[];
  modelDiversityVerified: boolean;
  requestHash: string;
}

export interface VolumePlanGenerationView {
  taskId: string;
  status: string;
  currentPhase: string;
  errorCode: string | null;
  checkpoint: Record<string, unknown>;
  modelDiversityVerified: boolean;
  members: Array<{
    roleKey: string;
    agentId: string;
    displayName: string;
    provider: string;
    modelId: string;
  }>;
  candidateVersionIds: {
    candidateA: string | null;
    candidateB: string | null;
    fusion: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export class VolumePlanGenerationService {
  public constructor(
    private readonly repository: VolumePlanGenerationRepository,
    private readonly volumePlans: VolumePlanService,
    private readonly tasks: TaskService,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly layeredPlanning?: LayeredPlanningService
  ) {}

  public start(scope: BookScope, volumePlanId: string, input: {
    expectedPlanRevision: number;
    expectedActiveVersionId?: string | null;
    expectedWorkflowVersion: number;
    template: unknown;
    authorInputRefs?: string[];
    selection?: unknown;
    idempotencyKey: string;
  }): VolumePlanGenerationView {
    const expectedPlanRevision = positiveInteger(input.expectedPlanRevision, '卷规划版本');
    const expectedWorkflowVersion = positiveInteger(input.expectedWorkflowVersion, '工作流版本');
    const expectedActiveVersionId = optionalId(input.expectedActiveVersionId, '当前确认版标识');
    const idempotencyKey = requiredId(input.idempotencyKey, '幂等键');
    const authorInputRefs = uniqueIds(input.authorInputRefs ?? [], '作者想法引用');
    let template: PlanningTemplateInstance;
    try {
      template = parsePlanningTemplateInstance(input.template, 'volume');
    } catch (error) {
      throw validation(error instanceof Error ? error.message : '推进参考格式无效。');
    }
    const plan = this.volumePlans.get(scope, volumePlanId);
    if (plan.revision !== expectedPlanRevision || plan.activeVersionId !== expectedActiveVersionId) {
      throw conflict('卷规划已经变化，请刷新后再让团队设计。', {
        expectedPlanRevision,
        actualPlanRevision: plan.revision,
        expectedActiveVersionId,
        actualActiveVersionId: plan.activeVersionId
      });
    }
    if (['completed', 'archived'].includes(plan.status)) {
      throw conflict('已完成或已归档的卷不能重新启动方案生成。', { status: plan.status });
    }
    const workflow = this.volumePlans.workflow(scope);
    if (workflow.planningVersion !== expectedWorkflowVersion) {
      throw conflict('创作流程已经变化，请刷新后再让团队设计。', {
        expectedWorkflowVersion,
        actualWorkflowVersion: workflow.planningVersion
      });
    }
    const mode: 'routes' | 'fusion' = input.selection === undefined ? 'routes' : 'fusion';
    let fusionSource: VolumeFusionSource | undefined;
    if (mode === 'fusion') {
      if (this.layeredPlanning === undefined) {
        throw new DomainError(errorCodes.operationIncomplete, '分层卷方向服务未就绪。', {}, false, 409);
      }
      const selection = this.layeredPlanning.recordRouteSelection(scope, volumePlanId, {
        selection: input.selection,
        idempotencyKey: 'fusion-selection:' + idempotencyKey
      });
      fusionSource = this.layeredPlanning.buildFusionSource(scope, volumePlanId, selection);
    }
    const snapshot = this.repository.sourceSnapshot(scope, volumePlanId);
    if (snapshot === undefined) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '开书信息、设定基线或上一卷结算不完整，无法准备当前卷资料包。',
        {},
        false,
        409
      );
    }
    const authorIdeas = this.repository.authorInputs(scope, volumePlanId, authorInputRefs);
    if (authorIdeas.length !== authorInputRefs.length) {
      throw validation('作者想法引用必须来自当前书籍仍然有效的卷规划意见。');
    }
    const orderedIdeas = authorInputRefs.map((id) => authorIdeas.find((idea) => idea.id === id)!);
    const team = this.repository.generationSeats(scope);
    const editor = team.seats.find((seat) => seat.editor);
    const lead = team.seats.find((seat) => seat.roleKey === 'lead_screenwriter');
    const second = team.seats.find((seat) => seat.roleKey === 'second_screenwriter');
    if (editor === undefined || (mode === 'routes' && (lead === undefined || second === undefined))) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        mode === 'routes' ? '当前卷设计需要当前主编和两位编剧都可用。' : '当前卷融合需要主编可用。',
        { availableRoles: team.seats.map((seat) => seat.roleKey) },
        false,
        409
      );
    }
    let modelDiversityVerified = false;
    if (mode === 'routes') {
      const routeLead = lead!;
      const routeSecond = second!;
      const deterministicFixture = [routeLead, routeSecond]
        .every((seat) => seat.provider.startsWith('local-deterministic'));
      const distinctBindings = routeLead.provider !== routeSecond.provider || routeLead.modelId !== routeSecond.modelId;
      modelDiversityVerified = !deterministicFixture && distinctBindings;
      if (!distinctBindings && !deterministicFixture) {
        throw new DomainError(
          errorCodes.operationIncomplete,
          '两位编剧当前绑定了同一个模型，不能冒充异模型独立方案。请先调整模型绑定。',
          { leadModel: routeLead.provider + '/' + routeLead.modelId, secondModel: routeSecond.provider + '/' + routeSecond.modelId },
          false, 409
        );
      }
    }
    const budgetId = this.repository.activeBudgetId(scope);
    if (budgetId === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '当前书籍没有可用预算。', {}, false, 409);
    }
    const sourceFingerprint = volumePlanSourceFingerprint(snapshot);
    const routeRecipes = mode === 'routes' ? selectHiddenVolumeRouteRecipes(
      `${snapshot.bookTitle} ${snapshot.opening.content}`,
      snapshot.planNumber === 1
    ) : undefined;
    if (routeRecipes !== undefined) {
      this.repository.syncInternalStructureMethods(hiddenNarrativeMethodVersions(), this.clock.now().toISOString());
    }
    const requestHash = digest({
      mode,
      volumePlanId,
      expectedPlanRevision,
      expectedActiveVersionId,
      expectedWorkflowVersion,
      sourceFingerprint,
      routeRecipes,
      fusionSource,
      template,
      authorInputRefs,
      orderedIdeas,
      seats: team.seats
    });
    const taskId = this.ids.next();
    const requestedTaskKey = `volume-plan-generation:${volumePlanId}:${idempotencyKey}`;
    const latest = this.repository.latestTask(scope, volumePlanId);
    if (latest?.idempotency_key === requestedTaskKey) {
      const existing = this.tasks.require(scope, latest.task_id);
      if (existing.brief.requestHash !== requestHash) {
        throw conflict('同一个幂等键不能用于不同的卷规划生成请求。');
      }
      if (!['failed', 'cancelled', 'interrupted', 'blocked'].includes(existing.status)) {
        return this.view(scope, existing);
      }
    }
    const taskKey = latest !== undefined
      && ['failed', 'cancelled', 'interrupted', 'blocked'].includes(latest.status)
      ? `${requestedTaskKey}:retry:${latest.task_id}`
      : requestedTaskKey;
    if (
      latest !== undefined
      && !['failed', 'cancelled', 'succeeded', 'interrupted', 'blocked'].includes(latest.status)
      && latest.idempotency_key !== taskKey
    ) {
      throw conflict('当前卷已经有一轮团队设计正在进行。', { taskId: latest.task_id, status: latest.status });
    }
    const brief: VolumePlanGenerationBrief = {
      schema: 'volume-plan-generation-v1',
      mode,
      volumePlanId,
      ...(fusionSource === undefined ? {} : { fusionSource }),
      expectedPlanRevision,
      expectedActiveVersionId,
      expectedWorkflowVersion,
      sourceFingerprint,
      ...(routeRecipes === undefined ? {} : { routeRecipes }),
      template,
      authorInputRefs,
      authorIdeas: orderedIdeas,
      seats: team.seats,
      modelDiversityVerified,
      requestHash
    };
    const task = this.unitOfWork.run(() => {
      let created = this.tasks.create(scope, {
        taskId,
        taskType: 'volume_plan_generation',
        assignedAgentId: editor.agentId,
        idempotencyKey: taskKey,
        budgetId,
        requiredEditorEpoch: team.editorEpoch,
        initialPhase: 'preparing_context',
        brief: brief as unknown as Record<string, unknown>
      });
      if (created.brief.requestHash !== requestHash) {
        throw conflict('同一个幂等键不能用于不同的卷规划生成请求。');
      }
      if (created.taskId !== taskId) return created;
      if (!this.repository.attachWaitingTask(scope, {
        volumePlanId,
        taskId: created.taskId,
        expectedWorkflowVersion,
        expectedPlanRevision,
        expectedActiveVersionId,
        now: this.clock.now().toISOString()
      })) {
        throw conflict('卷规划或创作流程已经变化，请刷新后重新开始。');
      }
      if (created.status === 'pending') created = this.tasks.queue(scope, created.taskId);
      return created;
    });
    return this.view(scope, task);
  }

  public latest(scope: BookScope, volumePlanId: string): VolumePlanGenerationView | null {
    const row = this.repository.latestTask(scope, volumePlanId);
    if (row === undefined) return null;
    return this.view(scope, this.tasks.require(scope, row.task_id));
  }

  public reconcileTerminal(scope: BookScope, task: TaskRecord): void {
    if (
      task.taskType === 'volume_plan_generation'
      && ['cancelled', 'succeeded'].includes(task.status)
    ) {
      this.repository.clearWaitingTask(scope, task.taskId, this.clock.now().toISOString());
    }
  }

  private view(scope: BookScope, task: TaskRecord): VolumePlanGenerationView {
    const brief = task.brief as unknown as VolumePlanGenerationBrief;
    const row = this.repository.latestTask(scope, brief.volumePlanId);
    const candidateA = this.repository.candidateByTask(scope, brief.volumePlanId, task.taskId, 'candidate_a');
    const candidateB = this.repository.candidateByTask(scope, brief.volumePlanId, task.taskId, 'candidate_b');
    const fusion = this.repository.candidateByTask(scope, brief.volumePlanId, task.taskId, 'fusion');
    return {
      taskId: task.taskId,
      status: task.status,
      currentPhase: task.currentPhase,
      errorCode: task.errorCode,
      checkpoint: task.checkpoint,
      modelDiversityVerified: brief.modelDiversityVerified,
      members: brief.seats.map((seat) => ({
        roleKey: seat.roleKey,
        agentId: seat.agentId,
        displayName: seat.displayName,
        provider: seat.provider,
        modelId: seat.modelId
      })),
      candidateVersionIds: {
        candidateA: candidateA?.volume_plan_version_id ?? null,
        candidateB: candidateB?.volume_plan_version_id ?? null,
        fusion: fusion?.volume_plan_version_id ?? null
      },
      createdAt: row?.created_at ?? '',
      updatedAt: row?.updated_at ?? ''
    };
  }
}

export function volumePlanSourceFingerprint(snapshot: VolumePlanGenerationSourceSnapshot): string {
  return digest({
    volumePlanId: snapshot.volumePlanId,
    planNumber: snapshot.planNumber,
    planRevision: snapshot.planRevision,
    activeVersionId: snapshot.activeVersionId,
    opening: { id: snapshot.opening.id, version: snapshot.opening.version, hash: snapshot.opening.hash },
    setting: { id: snapshot.setting.id, version: snapshot.setting.version, hash: snapshot.setting.hash },
    previousVolume: snapshot.previousVolume === null ? null : {
      id: snapshot.previousVolume.id,
      version: snapshot.previousVolume.version,
      hash: snapshot.previousVolume.hash
    },
    previousSettlement: snapshot.previousSettlement === null ? null : {
      id: snapshot.previousSettlement.id,
      version: snapshot.previousSettlement.version,
      contentHash: digest(snapshot.previousSettlement.content)
    }
  });
}

function digest(value: unknown): string {
  return hashStableContractContent(value).slice('sha256:'.length);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw validation(`${field}必须是大于0的整数。`);
  return Number(value);
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw validation(`${field}不能为空。`);
  if (value.trim().length > 240) throw validation(`${field}过长。`);
  return value.trim();
}

function optionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requiredId(value, field);
}

function uniqueIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw validation(`${field}必须是列表。`);
  return [...new Set(value.map((item) => requiredId(item, field)))];
}

function validation(message: string): DomainError {
  return new DomainError(errorCodes.validation, message);
}

function conflict(message: string, details: Record<string, unknown> = {}): DomainError {
  return new DomainError(errorCodes.bookVersionConflict, message, details, false, 409);
}
