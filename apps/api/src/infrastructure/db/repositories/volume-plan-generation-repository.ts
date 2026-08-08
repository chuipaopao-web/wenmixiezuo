import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface VolumePlanGenerationSeat {
  roleKey: string;
  agentId: string;
  displayName: string;
  modelSnapshotId: string;
  provider: string;
  modelId: string;
  editor: boolean;
}

export interface VolumePlanGenerationSourceSnapshot {
  volumePlanId: string;
  planNumber: number;
  planRevision: number;
  planStatus: string;
  activeVersionId: string | null;
  bookTitle: string;
  canonRevision: number;
  positioningVersion: number;
  opening: { id: string; version: number; hash: string; content: string };
  setting: { id: string; version: number; hash: string; content: string };
  previousVolume: null | { id: string; version: number; hash: string; content: string };
  previousSettlement: null | { id: string; version: number; content: string };
}

export interface VolumePlanGenerationTaskRow {
  task_id: string;
  status: string;
  current_phase: string;
  error_code: string | null;
  idempotency_key: string;
  task_brief_json: string;
  checkpoint_json: string;
  created_at: string;
  updated_at: string;
}

export interface StoredVolumePlanCandidate {
  volume_plan_version_id: string;
  content_json: string;
}

export interface StoredModelResult {
  output_text: string;
  input_tokens: number;
  output_tokens: number;
  cash_micros: number;
}

export class VolumePlanGenerationRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public sourceSnapshot(scope: BookScope, volumePlanId: string): VolumePlanGenerationSourceSnapshot | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT p.volume_plan_id, p.plan_number, p.revision AS plan_revision, p.status AS plan_status,
        p.active_version_id, p.previous_volume_plan_id, p.previous_settlement_id,
        b.title AS book_title, b.canon_revision, b.positioning_version,
        o.opening_blueprint_id, o.version AS opening_version, o.content_hash AS opening_hash,
        o.blueprint_json AS opening_content,
        sv.artifact_version_id AS setting_version_id, sv.version AS setting_version,
        sv.content_hash AS setting_hash, sv.content_json AS setting_content
      FROM volume_plans p
      JOIN books b ON b.owner_id = p.owner_id AND b.book_id = p.book_id
      JOIN book_opening_blueprints o
        ON o.owner_id = p.owner_id AND o.book_id = p.book_id AND o.status = 'active'
      JOIN book_planning_states ps
        ON ps.owner_id = p.owner_id AND ps.book_id = p.book_id
      JOIN artifact_versions sv
        ON sv.owner_id = ps.owner_id AND sv.book_id = ps.book_id
       AND sv.artifact_version_id = ps.setting_baseline_version_id
       AND sv.status = 'selected'
      WHERE p.owner_id = ? AND p.book_id = ? AND p.volume_plan_id = ?
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, volumePlanId) as {
      volume_plan_id: string; plan_number: number; plan_revision: number; plan_status: string;
      active_version_id: string | null; previous_volume_plan_id: string | null;
      previous_settlement_id: string | null; book_title: string; canon_revision: number;
      positioning_version: number; opening_blueprint_id: string; opening_version: number;
      opening_hash: string; opening_content: string; setting_version_id: string;
      setting_version: number; setting_hash: string; setting_content: string;
    } | undefined;
    if (row === undefined) return undefined;
    const previousVolume = row.previous_volume_plan_id === null
      ? undefined
      : this.database.prepare(`
          SELECT p.volume_plan_id AS id, v.version, v.content_hash AS hash, v.content_json AS content
          FROM volume_plans p
          JOIN volume_plan_versions v
            ON v.owner_id = p.owner_id AND v.book_id = p.book_id
           AND v.volume_plan_id = p.volume_plan_id AND v.volume_plan_version_id = p.active_version_id
          WHERE p.owner_id = ? AND p.book_id = ? AND p.volume_plan_id = ?
        `).get(scope.ownerId, scope.bookId, row.previous_volume_plan_id) as {
          id: string; version: number; hash: string; content: string;
        } | undefined;
    const previousSettlement = row.previous_settlement_id === null
      ? undefined
      : this.database.prepare(`
          SELECT stage_settlement_id AS id, version,
            json_object(
              'irreversibleResults', json(irreversible_results_json),
              'entityStates', json(entity_states_json),
              'closedThreads', json(closed_threads_json),
              'openThreads', json(open_threads_json),
              'relationshipChanges', json(relationship_changes_json),
              'knowledgeChanges', json(knowledge_changes_json),
              'resourceChanges', json(resource_changes_json),
              'ruleChanges', json(rule_changes_json),
              'exclusions', json(exclusions_json)
            ) AS content
          FROM stage_settlements
          WHERE owner_id = ? AND book_id = ? AND stage_settlement_id = ? AND status = 'active'
        `).get(scope.ownerId, scope.bookId, row.previous_settlement_id) as {
          id: string; version: number; content: string;
        } | undefined;
    if (
      (row.previous_volume_plan_id !== null && previousVolume === undefined)
      || (row.previous_settlement_id !== null && previousSettlement === undefined)
    ) return undefined;
    return {
      volumePlanId: row.volume_plan_id,
      planNumber: row.plan_number,
      planRevision: row.plan_revision,
      planStatus: row.plan_status,
      activeVersionId: row.active_version_id,
      bookTitle: row.book_title,
      canonRevision: row.canon_revision,
      positioningVersion: row.positioning_version,
      opening: {
        id: row.opening_blueprint_id,
        version: row.opening_version,
        hash: row.opening_hash,
        content: row.opening_content
      },
      setting: {
        id: row.setting_version_id,
        version: row.setting_version,
        hash: row.setting_hash,
        content: row.setting_content
      },
      previousVolume: previousVolume ?? null,
      previousSettlement: previousSettlement ?? null
    };
  }

  public generationSeats(scope: BookScope): { editorEpoch: number; seats: VolumePlanGenerationSeat[] } {
    assertBookScope(scope);
    const book = this.database.prepare(`
      SELECT active_editor_agent_id, editor_epoch
      FROM books WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as {
      active_editor_agent_id: string | null; editor_epoch: number;
    } | undefined;
    if (book === undefined || book.active_editor_agent_id === null) return { editorEpoch: 0, seats: [] };
    const rows = this.database.prepare(`
      SELECT r.role_key, a.agent_id, a.display_name, a.model_snapshot_id,
        m.provider, m.model_id,
        CASE WHEN a.agent_id = ? THEN 1 ELSE 0 END AS is_editor
      FROM agent_instances a
      JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m
        ON m.model_snapshot_id = a.model_snapshot_id
       AND m.owner_id = a.owner_id AND m.book_id = a.book_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
        AND (a.agent_id = ? OR r.role_key IN ('lead_screenwriter', 'second_screenwriter'))
      ORDER BY CASE
        WHEN r.role_key = 'lead_screenwriter' THEN 1
        WHEN r.role_key = 'second_screenwriter' THEN 2
        ELSE 3 END
    `).all(
      book.active_editor_agent_id,
      scope.ownerId,
      scope.bookId,
      book.active_editor_agent_id
    ) as unknown as Array<{
      role_key: string; agent_id: string; display_name: string; model_snapshot_id: string;
      provider: string; model_id: string; is_editor: number;
    }>;
    return {
      editorEpoch: book.editor_epoch,
      seats: rows.map((row) => ({
        roleKey: row.role_key,
        agentId: row.agent_id,
        displayName: row.display_name,
        modelSnapshotId: row.model_snapshot_id,
        provider: row.provider,
        modelId: row.model_id,
        editor: row.is_editor === 1
      }))
    };
  }

  public activeBudgetId(scope: BookScope): string | undefined {
    assertBookScope(scope);
    return (this.database.prepare(`
      SELECT budget_id FROM budgets
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
      ORDER BY created_at LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined)?.budget_id;
  }

  public authorInputs(scope: BookScope, volumePlanId: string, ids: string[]): Array<{
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
  }> {
    assertBookScope(scope);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.database.prepare(`
      SELECT author_input_id, intent_strength, original_text, scope_notes
      FROM author_planning_inputs
      WHERE owner_id = ? AND book_id = ? AND surface = 'volume_plan'
        AND subject_type = 'volume_plan' AND subject_id = ?
        AND status NOT IN ('withdrawn', 'superseded')
        AND author_input_id IN (${placeholders})
    `).all(scope.ownerId, scope.bookId, volumePlanId, ...ids) as unknown as Array<{
      author_input_id: string;
      intent_strength: string;
      original_text: string;
      scope_notes: string | null;
    }>;
    const attachmentQuery = this.database.prepare(`
      SELECT a.attachment_id, a.original_name, a.parse_status, a.context_excerpt
      FROM author_planning_input_links l
      JOIN chat_attachments a
        ON a.owner_id = l.owner_id AND a.book_id = l.book_id
       AND a.attachment_id = l.target_id
      WHERE l.owner_id = ? AND l.book_id = ? AND l.author_input_id = ?
        AND l.link_type = 'attachment' AND l.target_type = 'chat_attachment'
        AND a.parse_status <> 'discarded'
      ORDER BY l.sort_order, l.link_id
    `);
    return rows.map((row) => ({
      id: row.author_input_id,
      intentStrength: row.intent_strength,
      originalText: row.original_text,
      scopeNotes: row.scope_notes,
      attachmentExcerpts: (attachmentQuery.all(
        scope.ownerId, scope.bookId, row.author_input_id
      ) as unknown as Array<{
        attachment_id: string;
        original_name: string;
        parse_status: string;
        context_excerpt: string;
      }>).map((attachment) => ({
        attachmentId: attachment.attachment_id,
        originalName: attachment.original_name,
        parseStatus: attachment.parse_status,
        excerpt: attachment.context_excerpt
      }))
    }));
  }

  public latestTask(scope: BookScope, volumePlanId: string): VolumePlanGenerationTaskRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT task_id, status, current_phase, error_code, idempotency_key,
        task_brief_json, checkpoint_json, created_at, updated_at
      FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'volume_plan_generation'
        AND json_extract(task_brief_json, '$.volumePlanId') = ?
      ORDER BY created_at DESC, task_id DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, volumePlanId) as VolumePlanGenerationTaskRow | undefined;
  }

  public attachWaitingTask(scope: BookScope, input: {
    volumePlanId: string;
    taskId: string;
    expectedWorkflowVersion: number;
    expectedPlanRevision: number;
    expectedActiveVersionId: string | null;
    now: string;
  }): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE creation_workflow_states
      SET stage = 'volume_plan_in_progress', waiting_task_id = ?, blocking_reason = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND planning_version = ?
        AND stage IN ('setting_confirmed', 'volume_plan_in_progress', 'volume_plan_confirmed')
        AND (
          waiting_task_id IS NULL OR waiting_task_id = ? OR EXISTS (
            SELECT 1 FROM tasks previous
            WHERE previous.owner_id = creation_workflow_states.owner_id
              AND previous.book_id = creation_workflow_states.book_id
              AND previous.task_id = creation_workflow_states.waiting_task_id
              AND previous.status IN ('failed', 'cancelled', 'succeeded', 'interrupted', 'blocked')
          )
        )
        AND EXISTS (
          SELECT 1 FROM volume_plans p
          WHERE p.owner_id = creation_workflow_states.owner_id
            AND p.book_id = creation_workflow_states.book_id
            AND p.volume_plan_id = ?
            AND p.revision = ?
            AND p.active_version_id IS ?
        )
    `).run(
      input.taskId,
      input.now,
      scope.ownerId,
      scope.bookId,
      input.expectedWorkflowVersion,
      input.taskId,
      input.volumePlanId,
      input.expectedPlanRevision,
      input.expectedActiveVersionId
    ).changes === 1;
  }

  public markFailed(scope: BookScope, taskId: string, reason: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE creation_workflow_states
      SET blocking_reason = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND waiting_task_id = ?
    `).run(reason, now, scope.ownerId, scope.bookId, taskId);
  }

  public clearWaitingTask(scope: BookScope, taskId: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE creation_workflow_states
      SET waiting_task_id = NULL, blocking_reason = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND waiting_task_id = ?
    `).run(now, scope.ownerId, scope.bookId, taskId);
  }

  public candidateByTask(
    scope: BookScope,
    volumePlanId: string,
    taskId: string,
    candidateKind: 'candidate_a' | 'candidate_b' | 'fusion'
  ): StoredVolumePlanCandidate | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT volume_plan_version_id, content_json
      FROM volume_plan_versions
      WHERE owner_id = ? AND book_id = ? AND volume_plan_id = ?
        AND source_task_id = ? AND candidate_kind = ?
      ORDER BY version DESC LIMIT 1
    `).get(
      scope.ownerId,
      scope.bookId,
      volumePlanId,
      taskId,
      candidateKind
    ) as StoredVolumePlanCandidate | undefined;
  }

  public succeededModelResult(scope: BookScope, input: {
    taskId: string;
    agentId: string;
    modelSnapshotId: string;
    inputHash: string;
  }): StoredModelResult | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT r.output_text, r.input_tokens, r.output_tokens, r.cash_micros
      FROM model_calls m
      JOIN model_call_results r ON r.request_id = m.request_id
      WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ?
        AND m.agent_id = ? AND m.model_snapshot_id = ?
        AND m.input_hash = ? AND m.state = 'succeeded'
      ORDER BY m.completed_at DESC LIMIT 1
    `).get(
      scope.ownerId,
      scope.bookId,
      input.taskId,
      input.agentId,
      input.modelSnapshotId,
      input.inputHash
    ) as StoredModelResult | undefined;
  }

  public hasUnresolvedModelCall(scope: BookScope, taskId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT 1
      FROM model_calls m
      JOIN model_call_reconciliations r ON r.request_id = m.request_id
      WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ?
        AND r.state = 'awaiting_provider'
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, taskId) !== undefined;
  }
}