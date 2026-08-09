import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface VolumePlanRow {
  volume_plan_id: string;
  plan_number: number;
  physical_volume_id: string | null;
  previous_volume_plan_id: string | null;
  previous_settlement_id: string | null;
  status: 'planning' | 'active' | 'completed' | 'archived';
  revision: number;
  active_version_id: string | null;
  create_idempotency_key: string;
  request_hash: string;
  created_at: string;
  updated_at: string;
}

export interface VolumePlanVersionRow {
  volume_plan_version_id: string;
  volume_plan_id: string;
  version: number;
  parent_version_id: string | null;
  status: 'candidate' | 'active' | 'superseded' | 'archived';
  candidate_kind: 'candidate_a' | 'candidate_b' | 'author_edit' | 'fusion' | 'legacy';
  dependencies_json: string;
  template_json: string;
  author_input_refs_json: string;
  content_json: string;
  content_hash: string;
  source_task_id: string | null;
  idempotency_key: string;
  request_hash: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface CreationWorkflowStateRow {
  planning_version: number;
  stage: string;
  active_volume_plan_id: string | null;
  active_volume_plan_version_id: string | null;
  active_event_id: string | null;
  active_event_version_id: string | null;
  frozen_chapter_outline_refs_json: string;
  waiting_task_id: string | null;
  blocking_reason: string | null;
  updated_at: string;
}

export interface DependencySnapshotRow {
  upstream_kind: string;
  upstream_id: string;
  upstream_version: number;
  upstream_hash: string;
  required: number;
  status: 'active' | 'stale' | 'invalidated';
}

export class VolumePlanRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public listPlans(scope: BookScope): VolumePlanRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_id, plan_number, physical_volume_id, previous_volume_plan_id,
        previous_settlement_id, status, revision, active_version_id,
        create_idempotency_key, request_hash, created_at, updated_at
      FROM volume_plans
      WHERE owner_id = ? AND book_id = ?
      ORDER BY plan_number
    `).all(scope.ownerId, scope.bookId) as unknown as VolumePlanRow[];
  }

  public plan(scope: BookScope, volumePlanId: string): VolumePlanRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_id, plan_number, physical_volume_id, previous_volume_plan_id,
        previous_settlement_id, status, revision, active_version_id,
        create_idempotency_key, request_hash, created_at, updated_at
      FROM volume_plans
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
    `).get(scope.ownerId, scope.bookId, volumePlanId) as VolumePlanRow | undefined;
  }

  public planByNumber(scope: BookScope, planNumber: number): VolumePlanRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_id, plan_number, physical_volume_id, previous_volume_plan_id,
        previous_settlement_id, status, revision, active_version_id,
        create_idempotency_key, request_hash, created_at, updated_at
      FROM volume_plans
      WHERE owner_id = ? AND book_id = ? AND plan_number = ?
    `).get(scope.ownerId, scope.bookId, planNumber) as VolumePlanRow | undefined;
  }

  public planByIdempotency(scope: BookScope, idempotencyKey: string): VolumePlanRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_id, plan_number, physical_volume_id, previous_volume_plan_id,
        previous_settlement_id, status, revision, active_version_id,
        create_idempotency_key, request_hash, created_at, updated_at
      FROM volume_plans
      WHERE owner_id = ? AND book_id = ? AND create_idempotency_key = ?
    `).get(scope.ownerId, scope.bookId, idempotencyKey) as VolumePlanRow | undefined;
  }

  public insertPlan(scope: BookScope, input: {
    volumePlanId: string;
    planNumber: number;
    physicalVolumeId: string | null;
    previousVolumePlanId: string | null;
    previousSettlementId: string | null;
    idempotencyKey: string;
    requestHash: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO volume_plans (
        volume_plan_id, owner_id, book_id, plan_number, physical_volume_id,
        previous_volume_plan_id, previous_settlement_id, status, revision,
        active_version_id, create_idempotency_key, request_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'planning', 1, NULL, ?, ?, ?, ?)
    `).run(
      input.volumePlanId, scope.ownerId, scope.bookId, input.planNumber, input.physicalVolumeId,
      input.previousVolumePlanId, input.previousSettlementId, input.idempotencyKey,
      input.requestHash, input.now, input.now
    );
  }

  public physicalVolume(scope: BookScope, physicalVolumeId: string): { volume_number: number } | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_number FROM volumes
      WHERE owner_id = ? AND book_id = ? AND volume_id = ?
    `).get(scope.ownerId, scope.bookId, physicalVolumeId) as { volume_number: number } | undefined;
  }

  public activeOpening(scope: BookScope): { id: string; version: number; hash: string } | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT opening_blueprint_id AS id, version, content_hash AS hash
      FROM book_opening_blueprints
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
      ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { id: string; version: number; hash: string } | undefined;
    return row;
  }

  public settingBaseline(scope: BookScope): { id: string; version: number; hash: string } | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT v.artifact_version_id AS id, v.version, v.content_hash AS hash
      FROM book_planning_states s
      JOIN artifact_versions v
        ON v.owner_id = s.owner_id AND v.book_id = s.book_id
       AND v.artifact_version_id = s.setting_baseline_version_id
      JOIN artifacts a
        ON a.owner_id = v.owner_id AND a.book_id = v.book_id AND a.artifact_id = v.artifact_id
      WHERE s.owner_id = ? AND s.book_id = ? AND a.artifact_type = 'story_bible'
        AND v.status = 'selected'
      LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { id: string; version: number; hash: string } | undefined;
  }

  public activeVolumeSettlement(scope: BookScope, volumePlanId: string): { id: string; version: number; hashSource: string } | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT s.stage_settlement_id AS id, s.version,
        s.irreversible_results_json || s.entity_states_json || s.closed_threads_json ||
        s.open_threads_json || s.relationship_changes_json || s.knowledge_changes_json ||
        s.resource_changes_json || s.rule_changes_json || s.exclusions_json AS hashSource
      FROM stage_settlements s
      WHERE s.owner_id = ? AND s.book_id = ? AND s.stage_type = 'volume'
        AND s.stage_key = ? AND s.status = 'active'
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, volumePlanId) as { id: string; version: number; hashSource: string } | undefined;
  }

  public workflow(scope: BookScope): CreationWorkflowStateRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT planning_version, stage, active_volume_plan_id, active_volume_plan_version_id,
        active_event_id, active_event_version_id, frozen_chapter_outline_refs_json,
        waiting_task_id, blocking_reason, updated_at
      FROM creation_workflow_states WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as CreationWorkflowStateRow | undefined;
  }

  public insertWorkflow(scope: BookScope, stage: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO creation_workflow_states (
        owner_id, book_id, planning_version, stage, frozen_chapter_outline_refs_json, updated_at
      ) VALUES (?, ?, 1, ?, '[]', ?)
    `).run(scope.ownerId, scope.bookId, stage, now);
  }

  public reconcileSettingConfirmed(scope: BookScope, expectedPlanningVersion: number, now: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE creation_workflow_states
      SET planning_version = planning_version + 1, stage = 'setting_confirmed',
        blocking_reason = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND planning_version = ?
        AND stage IN ('book_profile_draft', 'book_profile_confirmed', 'setting_in_progress')
    `).run(now, scope.ownerId, scope.bookId, expectedPlanningVersion).changes === 1;
  }
  public markVolumePlanning(scope: BookScope, expectedPlanningVersion: number, now: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE creation_workflow_states
      SET planning_version = planning_version + 1, stage = 'volume_plan_in_progress',
        blocking_reason = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND planning_version = ?
        AND stage IN ('setting_confirmed', 'volume_plan_in_progress', 'ready_for_next_volume')
    `).run(now, scope.ownerId, scope.bookId, expectedPlanningVersion).changes === 1;
  }

  public nextVersion(scope: BookScope, volumePlanId: string): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM volume_plan_versions
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
    `).get(scope.ownerId, scope.bookId, volumePlanId) as { version: number };
    return row.version;
  }

  public version(scope: BookScope, volumePlanId: string, volumePlanVersionId: string): VolumePlanVersionRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_version_id, volume_plan_id, version, parent_version_id, status,
        candidate_kind, dependencies_json, template_json, author_input_refs_json,
        content_json, content_hash, source_task_id, idempotency_key, request_hash,
        created_at, confirmed_at
      FROM volume_plan_versions
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ? AND volume_plan_version_id = ?
    `).get(scope.ownerId, scope.bookId, volumePlanId, volumePlanVersionId) as VolumePlanVersionRow | undefined;
  }

  public versionByIdempotency(scope: BookScope, idempotencyKey: string): VolumePlanVersionRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_version_id, volume_plan_id, version, parent_version_id, status,
        candidate_kind, dependencies_json, template_json, author_input_refs_json,
        content_json, content_hash, source_task_id, idempotency_key, request_hash,
        created_at, confirmed_at
      FROM volume_plan_versions
      WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?
    `).get(scope.ownerId, scope.bookId, idempotencyKey) as VolumePlanVersionRow | undefined;
  }

  public listVersions(scope: BookScope, volumePlanId: string): VolumePlanVersionRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_version_id, volume_plan_id, version, parent_version_id, status,
        candidate_kind, dependencies_json, template_json, author_input_refs_json,
        content_json, content_hash, source_task_id, idempotency_key, request_hash,
        created_at, confirmed_at
      FROM volume_plan_versions
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
      ORDER BY version DESC
    `).all(scope.ownerId, scope.bookId, volumePlanId) as unknown as VolumePlanVersionRow[];
  }

  public activeEventVersion(scope: BookScope, eventId: string, eventVersionId: string): {
    event_id: string;
    version: number;
    content_hash: string;
  } | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT event_id, version, content_hash
      FROM story_event_versions
      WHERE owner_id = ? AND book_id = ? AND event_id = ?
        AND story_event_version_id = ? AND status = 'active'
    `).get(scope.ownerId, scope.bookId, eventId, eventVersionId) as {
      event_id: string;
      version: number;
      content_hash: string;
    } | undefined;
  }

  public insertVersion(scope: BookScope, input: {
    volumePlanVersionId: string;
    volumePlanId: string;
    version: number;
    parentVersionId: string | null;
    candidateKind: VolumePlanVersionRow['candidate_kind'];
    dependenciesJson: string;
    templateJson: string;
    authorInputRefsJson: string;
    contentJson: string;
    contentHash: string;
    sourceTaskId: string | null;
    idempotencyKey: string;
    requestHash: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO volume_plan_versions (
        volume_plan_version_id, owner_id, book_id, volume_plan_id, version,
        parent_version_id, status, candidate_kind, dependencies_json, template_json,
        author_input_refs_json, content_json, content_hash, source_task_id,
        idempotency_key, request_hash, created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.volumePlanVersionId, scope.ownerId, scope.bookId, input.volumePlanId, input.version,
      input.parentVersionId, input.candidateKind, input.dependenciesJson, input.templateJson,
      input.authorInputRefsJson, input.contentJson, input.contentHash, input.sourceTaskId,
      input.idempotencyKey, input.requestHash, input.now
    );
  }

  public insertDependencies(scope: BookScope, input: {
    dependencyIds: string[];
    downstreamId: string;
    downstreamVersion: number;
    dependencies: Array<{ kind: string; id: string; version: number; contentHash: string; required: boolean }>;
    now: string;
  }): void {
    assertBookScope(scope);
    const statement = this.database.prepare(`
      INSERT INTO planning_dependencies (
        planning_dependency_id, owner_id, book_id, upstream_kind, upstream_id,
        upstream_version, upstream_hash, downstream_kind, downstream_id,
        downstream_version, required, status, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'volume_plan_version', ?, ?, ?, 'active', NULL, ?, ?)
    `);
    input.dependencies.forEach((dependency, index) => statement.run(
      input.dependencyIds[index]!, scope.ownerId, scope.bookId, dependency.kind, dependency.id,
      dependency.version, dependency.contentHash, input.downstreamId, input.downstreamVersion,
      dependency.required ? 1 : 0, input.now, input.now
    ));
  }

  public dependencySnapshots(scope: BookScope, downstreamId: string, downstreamVersion: number): DependencySnapshotRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT upstream_kind, upstream_id, upstream_version, upstream_hash, required, status
      FROM planning_dependencies
      WHERE owner_id = ? AND book_id = ? AND downstream_kind = 'volume_plan_version'
        AND downstream_id = ? AND downstream_version = ?
      ORDER BY planning_dependency_id
    `).all(scope.ownerId, scope.bookId, downstreamId, downstreamVersion) as unknown as DependencySnapshotRow[];
  }

  public activateVersion(scope: BookScope, input: {
    volumePlanId: string;
    volumePlanVersionId: string;
    expectedRevision: number;
    expectedActiveVersionId: string | null;
    now: string;
  }): boolean {
    assertBookScope(scope);
    const plan = this.plan(scope, input.volumePlanId);
    if (plan === undefined || plan.revision !== input.expectedRevision || plan.active_version_id !== input.expectedActiveVersionId) return false;
    if (input.expectedActiveVersionId !== null) {
      const superseded = this.database.prepare(`
        UPDATE volume_plan_versions SET status = 'superseded'
        WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
          AND volume_plan_version_id = ? AND status = 'active'
      `).run(scope.ownerId, scope.bookId, input.volumePlanId, input.expectedActiveVersionId);
      if (superseded.changes !== 1) return false;
    }
    const activated = this.database.prepare(`
      UPDATE volume_plan_versions SET status = 'active', confirmed_at = COALESCE(confirmed_at, ?)
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
        AND volume_plan_version_id = ? AND status IN ('candidate', 'superseded')
    `).run(input.now, scope.ownerId, scope.bookId, input.volumePlanId, input.volumePlanVersionId);
    if (activated.changes !== 1) return false;
    const updated = this.database.prepare(`
      UPDATE volume_plans
      SET status = 'active', revision = revision + 1, active_version_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ? AND revision = ?
        AND ((active_version_id IS NULL AND ? IS NULL) OR active_version_id = ?)
    `).run(
      input.volumePlanVersionId, input.now, scope.ownerId, scope.bookId, input.volumePlanId,
      input.expectedRevision, input.expectedActiveVersionId, input.expectedActiveVersionId
    );
    return updated.changes === 1;
  }

  public confirmWorkflow(scope: BookScope, input: {
    volumePlanId: string;
    volumePlanVersionId: string;
    expectedPlanningVersion: number;
    now: string;
  }): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE creation_workflow_states
      SET planning_version = planning_version + 1, stage = 'volume_plan_confirmed',
        active_volume_plan_id = ?, active_volume_plan_version_id = ?,
        waiting_task_id = NULL, blocking_reason = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND planning_version = ?
        AND stage IN ('volume_plan_in_progress', 'volume_plan_confirmed')
    `).run(
      input.volumePlanId, input.volumePlanVersionId, input.now,
      scope.ownerId, scope.bookId, input.expectedPlanningVersion
    ).changes === 1;
  }

  public authorInputCount(scope: BookScope, ids: string[]): number {
    assertBookScope(scope);
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM author_planning_inputs
      WHERE owner_id = ? AND book_id = ? AND surface = 'volume_plan'
        AND author_input_id IN (${placeholders}) AND status NOT IN ('withdrawn', 'superseded')
    `).get(scope.ownerId, scope.bookId, ...ids) as { count: number };
    return row.count;
  }

  public taskExists(scope: BookScope, taskId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT 1 FROM tasks WHERE owner_id = ? AND book_id = ? AND task_id = ?
    `).get(scope.ownerId, scope.bookId, taskId) !== undefined;
  }

  public dependentCount(scope: BookScope, upstreamId: string, upstreamVersion: number): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM planning_dependencies
      WHERE owner_id = ? AND book_id = ? AND upstream_kind = 'volume_plan'
        AND upstream_id = ? AND upstream_version = ? AND status = 'active'
    `).get(scope.ownerId, scope.bookId, upstreamId, upstreamVersion) as { count: number };
    return row.count;
  }
}
