import {
  hashStableContractContent,
  parsePlanningTemplateInstance,
  parseVolumePlanContent,
  type CreationWorkflowStateView,
  type PlanningTemplateInstance,
  type VersionReference,
  type VolumePlanContent
} from '@wenmi/contracts';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import {
  VolumePlanRepository,
  type VolumePlanRow,
  type VolumePlanVersionRow
} from '../../infrastructure/db/repositories/volume-plan-repository.js';

export const volumePlanCandidateKinds = [
  'candidate_a', 'candidate_b', 'author_edit', 'fusion', 'legacy'
] as const;
export type VolumePlanCandidateKind = typeof volumePlanCandidateKinds[number];

export interface VolumePlanVersionView {
  volumePlanVersionId: string;
  volumePlanId: string;
  version: number;
  parentVersionId: string | null;
  status: VolumePlanVersionRow['status'];
  candidateKind: VolumePlanCandidateKind;
  dependencies: VersionReference[];
  template: PlanningTemplateInstance;
  authorInputRefs: string[];
  content: VolumePlanContent;
  contentHash: string;
  sourceTaskId: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface VolumePlanView {
  volumePlanId: string;
  planNumber: number;
  physicalVolumeId: string | null;
  previousVolumePlanId: string | null;
  previousSettlementId: string | null;
  status: VolumePlanRow['status'];
  revision: number;
  activeVersionId: string | null;
  activeVersion: VolumePlanVersionView | null;
  createdAt: string;
  updatedAt: string;
}

export interface VolumePlanImpactPreview {
  volumePlanId: string;
  candidateVersionId: string;
  activeVersionId: string | null;
  changedFields: string[];
  downstreamDependencyCount: number;
  requiresDownstreamReview: boolean;
  note: string;
}

export class VolumePlanService {
  public constructor(
    private readonly repository: VolumePlanRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public list(scope: BookScope): VolumePlanView[] {
    return this.repository.listPlans(scope).map((row) => this.toPlanView(scope, row));
  }

  public get(scope: BookScope, volumePlanId: string): VolumePlanView {
    return this.toPlanView(scope, this.requirePlan(scope, volumePlanId));
  }

  public workflow(scope: BookScope): CreationWorkflowStateView {
    const now = this.clock.now().toISOString();
    const row = this.unitOfWork.run(() => this.ensureWorkflow(scope, now));
    const activeVersion = row.active_volume_plan_id === null || row.active_volume_plan_version_id === null
      ? undefined
      : this.repository.version(scope, row.active_volume_plan_id, row.active_volume_plan_version_id);
    return {
      ownerId: scope.ownerId,
      bookId: scope.bookId,
      stage: row.stage as CreationWorkflowStateView['stage'],
      planningVersion: row.planning_version,
      activeVolumePlanRef: activeVersion === undefined ? null : {
        kind: 'volume_plan',
        id: activeVersion.volume_plan_id,
        version: activeVersion.version,
        contentHash: activeVersion.content_hash,
        required: true
      },
      activeEventRef: null,
      frozenChapterOutlineRefs: JSON.parse(row.frozen_chapter_outline_refs_json) as VersionReference[],
      waitingTaskId: row.waiting_task_id,
      blockingReason: row.blocking_reason,
      updatedAt: row.updated_at
    };
  }

  public create(scope: BookScope, input: {
    expectedWorkflowVersion: number;
    planNumber: number;
    physicalVolumeId?: string | null;
    idempotencyKey: string;
  }): VolumePlanView {
    const normalized = {
      expectedWorkflowVersion: positiveInteger(input.expectedWorkflowVersion, '工作流版本'),
      planNumber: positiveInteger(input.planNumber, '卷序号'),
      physicalVolumeId: optionalId(input.physicalVolumeId, '正文卷标识'),
      idempotencyKey: requiredId(input.idempotencyKey, '幂等键')
    };
    const requestHash = digest(normalized);
    const now = this.clock.now().toISOString();
    const row = this.unitOfWork.run(() => {
      const replay = this.repository.planByIdempotency(scope, normalized.idempotencyKey);
      if (replay !== undefined) {
        assertReplay(replay.request_hash, requestHash);
        return replay;
      }
      const workflow = this.ensureWorkflow(scope, now);
      if (workflow.planning_version !== normalized.expectedWorkflowVersion) {
        throw conflict('创作流程已经变化，请刷新后再创建卷规划。', {
          expectedVersion: normalized.expectedWorkflowVersion,
          actualVersion: workflow.planning_version
        });
      }
      if (!['setting_confirmed', 'volume_plan_in_progress', 'ready_for_next_volume'].includes(workflow.stage)) {
        throw conflict('请先确认开书资料和设定，再开始规划当前卷。', { stage: workflow.stage });
      }
      if (this.repository.planByNumber(scope, normalized.planNumber) !== undefined) {
        throw conflict(`第${normalized.planNumber}卷已经有规划，请直接打开原规划。`);
      }
      this.requireBaseDependencies(scope);
      let previousVolumePlanId: string | null = null;
      let previousSettlementId: string | null = null;
      if (normalized.planNumber > 1) {
        const previous = this.repository.planByNumber(scope, normalized.planNumber - 1);
        if (previous === undefined || previous.active_version_id === null) {
          throw conflict('上一卷尚未形成确认版，不能开始下一卷规划。');
        }
        const settlement = this.repository.activeVolumeSettlement(scope, previous.volume_plan_id);
        if (settlement === undefined) throw conflict('请先完成上一卷结算，再规划下一卷。');
        previousVolumePlanId = previous.volume_plan_id;
        previousSettlementId = settlement.id;
      }
      if (normalized.physicalVolumeId !== null) {
        const physical = this.repository.physicalVolume(scope, normalized.physicalVolumeId);
        if (physical === undefined) throw validation('选择的正文卷不属于当前书籍。');
        if (physical.volume_number !== normalized.planNumber) {
          throw validation('正文卷序号与当前规划卷序号不一致。');
        }
      }
      const volumePlanId = this.ids.next();
      this.repository.insertPlan(scope, {
        volumePlanId,
        planNumber: normalized.planNumber,
        physicalVolumeId: normalized.physicalVolumeId,
        previousVolumePlanId,
        previousSettlementId,
        idempotencyKey: normalized.idempotencyKey,
        requestHash,
        now
      });
      if (!this.repository.markVolumePlanning(scope, workflow.planning_version, now)) {
        throw conflict('创作流程已经变化，请刷新后再试。');
      }
      return this.requirePlan(scope, volumePlanId);
    });
    return this.toPlanView(scope, row);
  }

  public listVersions(scope: BookScope, volumePlanId: string): VolumePlanVersionView[] {
    this.requirePlan(scope, volumePlanId);
    return this.repository.listVersions(scope, volumePlanId).map(toVersionView);
  }

  public addVersion(scope: BookScope, volumePlanId: string, input: {
    expectedPlanRevision: number;
    candidateKind: VolumePlanCandidateKind;
    parentVersionId?: string | null;
    sourceTaskId?: string | null;
    authorInputRefs?: string[];
    template: unknown;
    content: unknown;
    idempotencyKey: string;
  }): VolumePlanVersionView {
    const candidateKind = requireCandidateKind(input.candidateKind);
    const expectedPlanRevision = positiveInteger(input.expectedPlanRevision, '卷规划版本');
    const parentVersionId = optionalId(input.parentVersionId, '父版本标识');
    const sourceTaskId = optionalId(input.sourceTaskId, '来源任务标识');
    const authorInputRefs = uniqueIds(input.authorInputRefs ?? [], '作者想法引用');
    const idempotencyKey = requiredId(input.idempotencyKey, '幂等键');
    let template: PlanningTemplateInstance;
    let content: VolumePlanContent;
    try {
      template = parsePlanningTemplateInstance(input.template, 'volume');
      content = parseVolumePlanContent(input.content);
    } catch (error) {
      throw validation(error instanceof Error ? error.message : '卷规划格式无效。');
    }
    const normalized = {
      volumePlanId, expectedPlanRevision, candidateKind, parentVersionId,
      sourceTaskId, authorInputRefs, template, content, idempotencyKey
    };
    const requestHash = digest(normalized);
    const now = this.clock.now().toISOString();
    return this.unitOfWork.run(() => {
      const replay = this.repository.versionByIdempotency(scope, idempotencyKey);
      if (replay !== undefined) {
        assertReplay(replay.request_hash, requestHash);
        if (replay.volume_plan_id !== volumePlanId) throw conflict('幂等键已经用于其他卷规划。');
        return toVersionView(replay);
      }
      const plan = this.requirePlan(scope, volumePlanId);
      if (plan.revision !== expectedPlanRevision) {
        throw conflict('卷规划确认版已经变化，请刷新后再保存候选稿。', {
          expectedRevision: expectedPlanRevision,
          actualRevision: plan.revision
        });
      }
      if (plan.status === 'completed' || plan.status === 'archived') {
        throw conflict('已完成或已归档的卷规划不能继续追加候选稿。', { status: plan.status });
      }
      if (parentVersionId !== null && this.repository.version(scope, volumePlanId, parentVersionId) === undefined) {
        throw validation('父版本不属于当前卷规划。');
      }
      if (sourceTaskId !== null && !this.repository.taskExists(scope, sourceTaskId)) {
        throw validation('来源任务不属于当前书籍。');
      }
      if (authorInputRefs.length !== this.repository.authorInputCount(scope, authorInputRefs)) {
        throw validation('作者想法引用必须来自当前书籍的卷规划意见。');
      }
      const dependencies = this.currentDependencies(scope, plan);
      const version = this.repository.nextVersion(scope, volumePlanId);
      const volumePlanVersionId = this.ids.next();
      this.repository.insertVersion(scope, {
        volumePlanVersionId,
        volumePlanId,
        version,
        parentVersionId,
        candidateKind,
        dependenciesJson: JSON.stringify(dependencies),
        templateJson: JSON.stringify(template),
        authorInputRefsJson: JSON.stringify(authorInputRefs),
        contentJson: JSON.stringify(content),
        contentHash: digest(content),
        sourceTaskId,
        idempotencyKey,
        requestHash,
        now
      });
      this.repository.insertDependencies(scope, {
        dependencyIds: dependencies.map(() => this.ids.next()),
        downstreamId: volumePlanVersionId,
        downstreamVersion: version,
        dependencies,
        now
      });
      return toVersionView(this.requireVersion(scope, volumePlanId, volumePlanVersionId));
    });
  }

  public impactPreview(scope: BookScope, volumePlanId: string, volumePlanVersionId: string): VolumePlanImpactPreview {
    const plan = this.requirePlan(scope, volumePlanId);
    const candidate = this.requireVersion(scope, volumePlanId, volumePlanVersionId);
    const active = plan.active_version_id === null
      ? undefined
      : this.repository.version(scope, volumePlanId, plan.active_version_id);
    const candidateContent = JSON.parse(candidate.content_json) as Record<string, unknown>;
    const activeContent = active === undefined ? undefined : JSON.parse(active.content_json) as Record<string, unknown>;
    const fields = Object.keys(candidateContent);
    const changedFields = activeContent === undefined
      ? fields
      : fields.filter((field) => digest(candidateContent[field]) !== digest(activeContent[field]));
    const downstreamDependencyCount = active === undefined
      ? 0
      : this.repository.dependentCount(scope, volumePlanId, active.version);
    return {
      volumePlanId,
      candidateVersionId: volumePlanVersionId,
      activeVersionId: plan.active_version_id,
      changedFields,
      downstreamDependencyCount,
      requiresDownstreamReview: downstreamDependencyCount > 0,
      note: downstreamDependencyCount > 0
        ? '确认后不会静默覆盖后续内容；受影响的事件与章纲需要作者逐项复核。'
        : '当前没有已确认的下游内容，切换后可继续设计事件。'
    };
  }

  public confirm(scope: BookScope, volumePlanId: string, input: {
    volumePlanVersionId: string;
    expectedPlanRevision: number;
    expectedActiveVersionId?: string | null;
    expectedWorkflowVersion: number;
  }): VolumePlanView {
    const volumePlanVersionId = requiredId(input.volumePlanVersionId, '候选版本标识');
    const expectedPlanRevision = positiveInteger(input.expectedPlanRevision, '卷规划版本');
    const expectedActiveVersionId = optionalId(input.expectedActiveVersionId, '当前确认版标识');
    const expectedWorkflowVersion = positiveInteger(input.expectedWorkflowVersion, '工作流版本');
    const now = this.clock.now().toISOString();
    return this.unitOfWork.run(() => {
      const plan = this.requirePlan(scope, volumePlanId);
      if (plan.revision !== expectedPlanRevision || plan.active_version_id !== expectedActiveVersionId) {
        throw conflict('卷规划确认版已经变化，请刷新后重新确认。', {
          expectedPlanRevision,
          actualPlanRevision: plan.revision,
          expectedActiveVersionId,
          actualActiveVersionId: plan.active_version_id
        });
      }
      const workflow = this.ensureWorkflow(scope, now);
      if (workflow.planning_version !== expectedWorkflowVersion) {
        throw conflict('创作流程已经变化，请刷新后重新确认。', {
          expectedWorkflowVersion,
          actualWorkflowVersion: workflow.planning_version
        });
      }
      const target = this.requireVersion(scope, volumePlanId, volumePlanVersionId);
      if (target.status === 'active' && plan.active_version_id === target.volume_plan_version_id) {
        return this.toPlanView(scope, plan);
      }
      if (target.status !== 'candidate' && target.status !== 'superseded') {
        throw conflict('只有候选稿或历史确认稿可以切换为当前确认版。', { status: target.status });
      }
      this.assertDependenciesCurrent(scope, plan, target);
      if (!this.repository.activateVersion(scope, {
        volumePlanId,
        volumePlanVersionId,
        expectedRevision: expectedPlanRevision,
        expectedActiveVersionId,
        now
      })) throw conflict('卷规划确认版已经变化，请刷新后重新确认。');
      if (!this.repository.confirmWorkflow(scope, {
        volumePlanId,
        volumePlanVersionId,
        expectedPlanningVersion: expectedWorkflowVersion,
        now
      })) throw conflict('创作流程已经变化，请刷新后重新确认。');
      return this.toPlanView(scope, this.requirePlan(scope, volumePlanId));
    });
  }

  private ensureWorkflow(scope: BookScope, now: string) {
    const existing = this.repository.workflow(scope);
    if (existing !== undefined) {
      if (
        this.repository.settingBaseline(scope) !== undefined
        && ['book_profile_draft', 'book_profile_confirmed', 'setting_in_progress'].includes(existing.stage)
      ) {
        this.repository.reconcileSettingConfirmed(scope, existing.planning_version, now);
        return this.repository.workflow(scope)!;
      }
      return existing;
    }
    const stage = this.repository.settingBaseline(scope) !== undefined
      ? 'setting_confirmed'
      : this.repository.activeOpening(scope) !== undefined ? 'setting_in_progress' : 'book_profile_draft';
    this.repository.insertWorkflow(scope, stage, now);
    return this.repository.workflow(scope)!;
  }

  private requireBaseDependencies(scope: BookScope): void {
    if (this.repository.activeOpening(scope) === undefined) throw conflict('请先完成并保存开书资料。');
    if (this.repository.settingBaseline(scope) === undefined) throw conflict('请先确认设定大纲。');
  }

  private currentDependencies(scope: BookScope, plan: VolumePlanRow): VersionReference[] {
    const opening = this.repository.activeOpening(scope);
    const setting = this.repository.settingBaseline(scope);
    if (opening === undefined || setting === undefined) throw conflict('开书资料或设定基线已经失效，请先修复上游资料。');
    const dependencies: VersionReference[] = [
      { kind: 'book_profile', id: opening.id, version: opening.version, contentHash: opening.hash, required: true },
      { kind: 'setting', id: setting.id, version: setting.version, contentHash: setting.hash, required: true }
    ];
    if (plan.previous_volume_plan_id !== null) {
      const previous = this.requirePlan(scope, plan.previous_volume_plan_id);
      if (previous.active_version_id === null) throw conflict('上一卷确认版已经失效。');
      const previousVersion = this.requireVersion(scope, previous.volume_plan_id, previous.active_version_id);
      const settlement = this.repository.activeVolumeSettlement(scope, previous.volume_plan_id);
      if (settlement === undefined || settlement.id !== plan.previous_settlement_id) {
        throw conflict('上一卷结算已经变化，请重新建立本卷规划。');
      }
      dependencies.push(
        {
          kind: 'volume_plan', id: previous.volume_plan_id, version: previousVersion.version,
          contentHash: previousVersion.content_hash, required: true
        },
        {
          kind: 'settlement', id: settlement.id, version: settlement.version,
          contentHash: digest(settlement.hashSource), required: true
        }
      );
    }
    return dependencies;
  }

  private assertDependenciesCurrent(scope: BookScope, plan: VolumePlanRow, version: VolumePlanVersionRow): void {
    const expected = JSON.parse(version.dependencies_json) as VersionReference[];
    const current = this.currentDependencies(scope, plan);
    if (digest(expected) !== digest(current)) {
      throw conflict('开书资料、设定或上一卷结算已经变化，请基于最新资料重新生成候选稿。', {
        expectedDependencies: expected,
        currentDependencies: current
      });
    }
    const stored = this.repository.dependencySnapshots(scope, version.volume_plan_version_id, version.version);
    if (stored.length !== expected.length || stored.some((item) => item.status !== 'active')) {
      throw conflict('卷规划依赖已经被标记为过期，请重新生成候选稿。');
    }
  }

  private requirePlan(scope: BookScope, volumePlanId: string): VolumePlanRow {
    const row = this.repository.plan(scope, requiredId(volumePlanId, '卷规划标识'));
    if (row === undefined) throw new DomainError(errorCodes.bookNotFound, '当前书籍中没有这个卷规划。', {}, false, 404);
    return row;
  }

  private requireVersion(scope: BookScope, volumePlanId: string, versionId: string): VolumePlanVersionRow {
    const row = this.repository.version(scope, volumePlanId, versionId);
    if (row === undefined) throw new DomainError(errorCodes.bookNotFound, '当前卷规划中没有这个版本。', {}, false, 404);
    return row;
  }

  private toPlanView(scope: BookScope, row: VolumePlanRow): VolumePlanView {
    const active = row.active_version_id === null
      ? undefined
      : this.repository.version(scope, row.volume_plan_id, row.active_version_id);
    return {
      volumePlanId: row.volume_plan_id,
      planNumber: row.plan_number,
      physicalVolumeId: row.physical_volume_id,
      previousVolumePlanId: row.previous_volume_plan_id,
      previousSettlementId: row.previous_settlement_id,
      status: row.status,
      revision: row.revision,
      activeVersionId: row.active_version_id,
      activeVersion: active === undefined ? null : toVersionView(active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function toVersionView(row: VolumePlanVersionRow): VolumePlanVersionView {
  return {
    volumePlanVersionId: row.volume_plan_version_id,
    volumePlanId: row.volume_plan_id,
    version: row.version,
    parentVersionId: row.parent_version_id,
    status: row.status,
    candidateKind: row.candidate_kind,
    dependencies: JSON.parse(row.dependencies_json) as VersionReference[],
    template: JSON.parse(row.template_json) as PlanningTemplateInstance,
    authorInputRefs: JSON.parse(row.author_input_refs_json) as string[],
    content: JSON.parse(row.content_json) as VolumePlanContent,
    contentHash: row.content_hash,
    sourceTaskId: row.source_task_id,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at
  };
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
  if (value.trim().length > 200) throw validation(`${field}过长。`);
  return value.trim();
}

function optionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requiredId(value, field);
}

function uniqueIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw validation(`${field}必须是列表。`);
  const items = value.map((item) => requiredId(item, field));
  return [...new Set(items)];
}

function requireCandidateKind(value: unknown): VolumePlanCandidateKind {
  if (typeof value !== 'string' || !(volumePlanCandidateKinds as readonly string[]).includes(value)) {
    throw validation('候选稿来源类型无效。');
  }
  return value as VolumePlanCandidateKind;
}

function assertReplay(actualHash: string, expectedHash: string): void {
  if (actualHash !== expectedHash) throw conflict('同一个幂等键不能用于不同请求。');
}

function validation(message: string): DomainError {
  return new DomainError(errorCodes.validation, message);
}

function conflict(message: string, details: Record<string, unknown> = {}): DomainError {
  return new DomainError(errorCodes.bookVersionConflict, message, details, false, 409);
}
