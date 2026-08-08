import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export type StoryEventStatus = 'planning' | 'active' | 'settled' | 'archived';
export type StoryEventCandidateKind = 'candidate_a' | 'candidate_b' | 'author_edit' | 'fusion' | 'volume_seed';

export interface EventSequenceRow {
  volume_plan_id: string;
  volume_plan_version_id: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface StoryEventRow {
  event_id: string;
  volume_plan_id: string;
  sequence_order: number;
  status: StoryEventStatus;
  revision: number;
  active_version_id: string | null;
  previous_event_id: string | null;
  previous_settlement_id: string | null;
  create_idempotency_key: string;
  request_hash: string;
  created_at: string;
  updated_at: string;
}

export interface StoryEventVersionRow {
  story_event_version_id: string;
  event_id: string;
  version: number;
  parent_version_id: string | null;
  status: 'candidate' | 'active' | 'superseded' | 'archived';
  candidate_kind: StoryEventCandidateKind;
  volume_plan_version_id: string;
  previous_settlement_id: string | null;
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

export interface ActiveVolumePlanRow {
  volume_plan_id: string;
  revision: number;
  active_version_id: string;
  version: number;
  content_hash: string;
  content_json: string;
}

export interface EventSequenceOperationRow {
  event_sequence_operation_id: string;
  operation_kind: 'insert' | 'reorder' | 'split' | 'merge';
  expected_sequence_revision: number;
  result_sequence_revision: number | null;
  proposal_json: string;
  impact_json: string;
  status: 'previewed' | 'applied' | 'cancelled';
  idempotency_key: string;
  request_hash: string;
  created_at: string;
  applied_at: string | null;
}

export class StoryEventRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public activeVolumePlan(scope: BookScope, volumePlanId: string): ActiveVolumePlanRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT p.volume_plan_id, p.revision, p.active_version_id,
        v.version, v.content_hash, v.content_json
      FROM volume_plans p
      JOIN volume_plan_versions v
        ON v.owner_id = p.owner_id AND v.book_id = p.book_id
       AND v.volume_plan_id = p.volume_plan_id
       AND v.volume_plan_version_id = p.active_version_id
       AND v.status = 'active'
      WHERE p.owner_id = ? AND p.book_id = ? AND p.volume_plan_id = ?
        AND p.status = 'active'
    `).get(scope.ownerId, scope.bookId, volumePlanId) as ActiveVolumePlanRow | undefined;
  }

  public sequence(scope: BookScope, volumePlanId: string): EventSequenceRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_id, volume_plan_version_id, revision, created_at, updated_at
      FROM event_sequences
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
    `).get(scope.ownerId, scope.bookId, volumePlanId) as EventSequenceRow | undefined;
  }

  public insertSequence(scope: BookScope, input: {
    volumePlanId: string;
    volumePlanVersionId: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO event_sequences (
        owner_id, book_id, volume_plan_id, volume_plan_version_id, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(scope.ownerId, scope.bookId, input.volumePlanId, input.volumePlanVersionId, input.now, input.now);
  }

  public listEvents(scope: BookScope, volumePlanId: string, includeArchived = false): StoryEventRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT event_id, volume_plan_id, sequence_order, status, revision, active_version_id,
        previous_event_id, previous_settlement_id, create_idempotency_key, request_hash,
        created_at, updated_at
      FROM story_events
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
        AND (? = 1 OR status <> 'archived')
      ORDER BY sequence_order, event_id
    `).all(scope.ownerId, scope.bookId, volumePlanId, includeArchived ? 1 : 0) as unknown as StoryEventRow[];
  }

  public event(scope: BookScope, eventId: string): StoryEventRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT event_id, volume_plan_id, sequence_order, status, revision, active_version_id,
        previous_event_id, previous_settlement_id, create_idempotency_key, request_hash,
        created_at, updated_at
      FROM story_events
      WHERE owner_id = ? AND book_id = ? AND event_id = ?
    `).get(scope.ownerId, scope.bookId, eventId) as StoryEventRow | undefined;
  }

  public eventByIdempotency(
    scope: BookScope,
    volumePlanId: string,
    idempotencyKey: string
  ): StoryEventRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT event_id, volume_plan_id, sequence_order, status, revision, active_version_id,
        previous_event_id, previous_settlement_id, create_idempotency_key, request_hash,
        created_at, updated_at
      FROM story_events
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ? AND create_idempotency_key = ?
    `).get(scope.ownerId, scope.bookId, volumePlanId, idempotencyKey) as StoryEventRow | undefined;
  }

  public insertEvent(scope: BookScope, input: {
    eventId: string;
    volumePlanId: string;
    sequenceOrder: number;
    previousEventId: string | null;
    previousSettlementId: string | null;
    idempotencyKey: string;
    requestHash: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO story_events (
        event_id, owner_id, book_id, volume_plan_id, sequence_order, status, revision,
        active_version_id, previous_event_id, previous_settlement_id,
        create_idempotency_key, request_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'planning', 1, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      input.eventId, scope.ownerId, scope.bookId, input.volumePlanId, input.sequenceOrder,
      input.previousEventId, input.previousSettlementId, input.idempotencyKey,
      input.requestHash, input.now, input.now
    );
  }

  public nextVersion(scope: BookScope, eventId: string): number {
    assertBookScope(scope);
    return (this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM story_event_versions
      WHERE owner_id = ? AND book_id = ? AND event_id = ?
    `).get(scope.ownerId, scope.bookId, eventId) as { version: number }).version;
  }

  public version(scope: BookScope, eventId: string, versionId: string): StoryEventVersionRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT story_event_version_id, event_id, version, parent_version_id, status,
        candidate_kind, volume_plan_version_id, previous_settlement_id, dependencies_json,
        template_json, author_input_refs_json, content_json, content_hash, source_task_id,
        idempotency_key, request_hash, created_at, confirmed_at
      FROM story_event_versions
      WHERE owner_id = ? AND book_id = ? AND event_id = ? AND story_event_version_id = ?
    `).get(scope.ownerId, scope.bookId, eventId, versionId) as StoryEventVersionRow | undefined;
  }

  public versionByIdempotency(scope: BookScope, idempotencyKey: string): StoryEventVersionRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT story_event_version_id, event_id, version, parent_version_id, status,
        candidate_kind, volume_plan_version_id, previous_settlement_id, dependencies_json,
        template_json, author_input_refs_json, content_json, content_hash, source_task_id,
        idempotency_key, request_hash, created_at, confirmed_at
      FROM story_event_versions
      WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?
    `).get(scope.ownerId, scope.bookId, idempotencyKey) as StoryEventVersionRow | undefined;
  }

  public listVersions(scope: BookScope, eventId: string): StoryEventVersionRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT story_event_version_id, event_id, version, parent_version_id, status,
        candidate_kind, volume_plan_version_id, previous_settlement_id, dependencies_json,
        template_json, author_input_refs_json, content_json, content_hash, source_task_id,
        idempotency_key, request_hash, created_at, confirmed_at
      FROM story_event_versions
      WHERE owner_id = ? AND book_id = ? AND event_id = ?
      ORDER BY version DESC
    `).all(scope.ownerId, scope.bookId, eventId) as unknown as StoryEventVersionRow[];
  }

  public insertVersion(scope: BookScope, input: {
    versionId: string;
    eventId: string;
    version: number;
    parentVersionId: string | null;
    candidateKind: StoryEventCandidateKind;
    volumePlanVersionId: string;
    previousSettlementId: string | null;
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
      INSERT INTO story_event_versions (
        story_event_version_id, owner_id, book_id, event_id, version, parent_version_id,
        status, candidate_kind, volume_plan_version_id, previous_settlement_id,
        dependencies_json, template_json, author_input_refs_json, content_json,
        content_hash, source_task_id, idempotency_key, request_hash, created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.versionId, scope.ownerId, scope.bookId, input.eventId, input.version,
      input.parentVersionId, input.candidateKind, input.volumePlanVersionId,
      input.previousSettlementId, input.dependenciesJson, input.templateJson,
      input.authorInputRefsJson, input.contentJson, input.contentHash, input.sourceTaskId,
      input.idempotencyKey, input.requestHash, input.now
    );
  }

  public activateVersion(scope: BookScope, input: {
    eventId: string;
    versionId: string;
    expectedEventRevision: number;
    now: string;
  }): boolean {
    assertBookScope(scope);
    const event = this.event(scope, input.eventId);
    if (event === undefined || event.revision !== input.expectedEventRevision || event.status === 'settled') return false;
    if (event.active_version_id !== null && event.active_version_id !== input.versionId) {
      this.database.prepare(`
        UPDATE story_event_versions SET status = 'superseded'
        WHERE owner_id = ? AND book_id = ? AND event_id = ?
          AND story_event_version_id = ? AND status = 'active'
      `).run(scope.ownerId, scope.bookId, input.eventId, event.active_version_id);
    }
    const changed = this.database.prepare(`
      UPDATE story_event_versions
      SET status = 'active', confirmed_at = COALESCE(confirmed_at, ?)
      WHERE owner_id = ? AND book_id = ? AND event_id = ?
        AND story_event_version_id = ? AND status IN ('candidate', 'superseded', 'active')
    `).run(input.now, scope.ownerId, scope.bookId, input.eventId, input.versionId).changes;
    if (changed !== 1) return false;
    return this.database.prepare(`
      UPDATE story_events
      SET active_version_id = ?, status = 'active', revision = revision + 1, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND event_id = ? AND revision = ?
        AND status IN ('planning', 'active')
    `).run(
      input.versionId, input.now, scope.ownerId, scope.bookId,
      input.eventId, input.expectedEventRevision
    ).changes === 1;
  }

  public updateSequenceCas(scope: BookScope, input: {
    volumePlanId: string;
    expectedRevision: number;
    volumePlanVersionId: string;
    now: string;
  }): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE event_sequences
      SET revision = revision + 1, volume_plan_version_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ? AND revision = ?
    `).run(
      input.volumePlanVersionId, input.now, scope.ownerId, scope.bookId,
      input.volumePlanId, input.expectedRevision
    ).changes === 1;
  }

  public setEventPosition(scope: BookScope, input: {
    eventId: string;
    sequenceOrder: number;
    previousEventId: string | null;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE story_events
      SET sequence_order = ?, previous_event_id = ?, revision = revision + 1, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND event_id = ? AND status <> 'archived'
    `).run(
      input.sequenceOrder, input.previousEventId, input.now,
      scope.ownerId, scope.bookId, input.eventId
    );
  }

  public archiveEvent(scope: BookScope, eventId: string, now: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE story_events
      SET status = 'archived', revision = revision + 1, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND event_id = ? AND status IN ('planning', 'active')
    `).run(now, scope.ownerId, scope.bookId, eventId).changes === 1;
  }

  public operationByIdempotency(scope: BookScope, idempotencyKey: string): EventSequenceOperationRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT event_sequence_operation_id, operation_kind, expected_sequence_revision,
        result_sequence_revision, proposal_json, impact_json, status, idempotency_key,
        request_hash, created_at, applied_at
      FROM event_sequence_operations
      WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?
    `).get(scope.ownerId, scope.bookId, idempotencyKey) as EventSequenceOperationRow | undefined;
  }

  public insertOperation(scope: BookScope, input: {
    operationId: string;
    volumePlanId: string;
    operationKind: EventSequenceOperationRow['operation_kind'];
    expectedRevision: number;
    proposalJson: string;
    impactJson: string;
    idempotencyKey: string;
    requestHash: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO event_sequence_operations (
        event_sequence_operation_id, owner_id, book_id, volume_plan_id, operation_kind,
        expected_sequence_revision, result_sequence_revision, proposal_json, impact_json,
        status, idempotency_key, request_hash, created_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'previewed', ?, ?, ?, NULL)
    `).run(
      input.operationId, scope.ownerId, scope.bookId, input.volumePlanId, input.operationKind,
      input.expectedRevision, input.proposalJson, input.impactJson,
      input.idempotencyKey, input.requestHash, input.now
    );
  }

  public markOperationApplied(scope: BookScope, operationId: string, resultRevision: number, now: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE event_sequence_operations
      SET status = 'applied', result_sequence_revision = ?, applied_at = ?
      WHERE owner_id = ? AND book_id = ? AND event_sequence_operation_id = ? AND status = 'previewed'
    `).run(resultRevision, now, scope.ownerId, scope.bookId, operationId).changes === 1;
  }

  public listOperations(scope: BookScope, volumePlanId: string): EventSequenceOperationRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT event_sequence_operation_id, operation_kind, expected_sequence_revision,
        result_sequence_revision, proposal_json, impact_json, status, idempotency_key,
        request_hash, created_at, applied_at
      FROM event_sequence_operations
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
      ORDER BY created_at DESC, event_sequence_operation_id DESC
    `).all(scope.ownerId, scope.bookId, volumePlanId) as unknown as EventSequenceOperationRow[];
  }

  public downstreamCount(scope: BookScope, eventId: string): number {
    assertBookScope(scope);
    return (this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM planning_dependencies
      WHERE owner_id = ? AND book_id = ?
        AND upstream_kind = 'story_event' AND upstream_id = ?
        AND status IN ('active', 'stale')
    `).get(scope.ownerId, scope.bookId, eventId) as { count: number }).count;
  }

  public updateWorkflowForSequence(scope: BookScope, input: {
    volumePlanId: string;
    volumePlanVersionId: string;
    expectedPlanningVersion: number;
    now: string;
  }): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE creation_workflow_states
      SET planning_version = planning_version + 1,
        stage = 'event_sequence_in_progress',
        active_volume_plan_id = ?, active_volume_plan_version_id = ?,
        blocking_reason = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND planning_version = ?
        AND active_volume_plan_id = ? AND active_volume_plan_version_id = ?
        AND stage IN ('volume_plan_confirmed', 'event_sequence_in_progress', 'event_in_progress', 'event_confirmed')
    `).run(
      input.volumePlanId, input.volumePlanVersionId, input.now,
      scope.ownerId, scope.bookId, input.expectedPlanningVersion,
      input.volumePlanId, input.volumePlanVersionId
    ).changes === 1;
  }

  public operation(scope: BookScope, operationId: string): EventSequenceOperationRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT event_sequence_operation_id, operation_kind, expected_sequence_revision,
        result_sequence_revision, proposal_json, impact_json, status, idempotency_key,
        request_hash, created_at, applied_at
      FROM event_sequence_operations
      WHERE owner_id = ? AND book_id = ? AND event_sequence_operation_id = ?
    `).get(scope.ownerId, scope.bookId, operationId) as EventSequenceOperationRow | undefined;
  }

  public taskExists(scope: BookScope, taskId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT 1 FROM tasks WHERE owner_id = ? AND book_id = ? AND task_id = ?
    `).get(scope.ownerId, scope.bookId, taskId) !== undefined;
  }

  public authorInputCount(scope: BookScope, eventId: string, ids: string[]): number {
    assertBookScope(scope);
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    return (this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM author_planning_inputs
      WHERE owner_id = ? AND book_id = ? AND surface = 'event'
        AND subject_type = 'story_event' AND subject_id = ?
        AND author_input_id IN (${placeholders})
        AND status NOT IN ('withdrawn', 'superseded')
    `).get(scope.ownerId, scope.bookId, eventId, ...ids) as { count: number }).count;
  }

  public insertDependencies(scope: BookScope, input: {
    dependencyIds: string[];
    downstreamId: string;
    downstreamVersion: number;
    dependencies: Array<{
      kind: string;
      id: string;
      version: number;
      contentHash: string;
      required: boolean;
    }>;
    now: string;
  }): void {
    assertBookScope(scope);
    const statement = this.database.prepare(`
      INSERT INTO planning_dependencies (
        planning_dependency_id, owner_id, book_id, upstream_kind, upstream_id,
        upstream_version, upstream_hash, downstream_kind, downstream_id,
        downstream_version, required, status, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'story_event_version', ?, ?, ?, 'active', NULL, ?, ?)
    `);
    input.dependencies.forEach((dependency, index) => {
      statement.run(
        input.dependencyIds[index]!, scope.ownerId, scope.bookId, dependency.kind,
        dependency.id, dependency.version, dependency.contentHash, input.downstreamId,
        input.downstreamVersion, dependency.required ? 1 : 0, input.now, input.now
      );
    });
  }

  public dependencySnapshots(scope: BookScope, versionId: string, version: number): Array<{
    upstream_kind: string;
    upstream_id: string;
    upstream_version: number;
    upstream_hash: string;
    status: string;
  }> {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT upstream_kind, upstream_id, upstream_version, upstream_hash, status
      FROM planning_dependencies
      WHERE owner_id = ? AND book_id = ? AND downstream_kind = 'story_event_version'
        AND downstream_id = ? AND downstream_version = ?
      ORDER BY upstream_kind, upstream_id
    `).all(scope.ownerId, scope.bookId, versionId, version) as unknown as Array<{
      upstream_kind: string;
      upstream_id: string;
      upstream_version: number;
      upstream_hash: string;
      status: string;
    }>;
  }

  public activeEventSettlement(scope: BookScope, eventId: string): {
    id: string;
    version: number;
    hash_source: string;
  } | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT stage_settlement_id AS id, version,
        irreversible_results_json || entity_states_json || closed_threads_json ||
        open_threads_json || relationship_changes_json || knowledge_changes_json ||
        resource_changes_json || rule_changes_json || exclusions_json AS hash_source
      FROM stage_settlements
      WHERE owner_id = ? AND book_id = ? AND stage_type = 'story_arc'
        AND stage_key = ? AND status = 'active'
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, eventId) as {
      id: string;
      version: number;
      hash_source: string;
    } | undefined;
  }
  public workflow(scope: BookScope): {
    planning_version: number;
    stage: string;
    active_volume_plan_id: string | null;
    active_volume_plan_version_id: string | null;
    active_event_id: string | null;
    active_event_version_id: string | null;
  } | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT planning_version, stage, active_volume_plan_id, active_volume_plan_version_id,
        active_event_id, active_event_version_id
      FROM creation_workflow_states
      WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as {
      planning_version: number;
      stage: string;
      active_volume_plan_id: string | null;
      active_volume_plan_version_id: string | null;
      active_event_id: string | null;
      active_event_version_id: string | null;
    } | undefined;
  }

  public activateWorkflowEvent(scope: BookScope, input: {
    eventId: string;
    eventVersionId: string;
    expectedPlanningVersion: number;
    now: string;
  }): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE creation_workflow_states
      SET planning_version = planning_version + 1, stage = 'event_confirmed',
        active_event_id = ?, active_event_version_id = ?,
        waiting_task_id = NULL, blocking_reason = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND planning_version = ?
        AND stage IN ('event_sequence_in_progress', 'event_in_progress', 'event_confirmed')
    `).run(
      input.eventId, input.eventVersionId, input.now,
      scope.ownerId, scope.bookId, input.expectedPlanningVersion
    ).changes === 1;
  }
}