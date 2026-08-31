import type { DatabaseSync } from 'node:sqlite';
import type {
  V7ChapterReview,
  V7ChapterSequence,
  V7ChapterSettlement,
  V7CreationContextPack,
  V7CreationContextSelection,
  V7CreationRunStatus,
  V7CreationStage,
  V7PlanningOptionReview,
  V7VolumeOption,
  V7ChainOption,
  V7StageSettlement
} from '@wenmi/v7-backend';

export interface V7CreationWorkflowRow {
  workflow_id: string; owner_id: string; book_id: string; volume_scope_id: string; chain_scope_id: string | null;
  stage: V7CreationStage; status: V7CreationRunStatus; first_volume: number; author_goal: string | null;
  idempotency_key: string; request_hash: string; checkpoint_json: string; error_message: string | null;
  created_at: string; updated_at: string;
}

export interface V7CreationContextPackRow {
  context_pack_id: string; owner_id: string; book_id: string; workflow_id: string;
  task_kind: V7CreationContextPack['taskKind']; task_id: string; task_brief: string;
  candidate_sources_json: string; selection_json: string | null; content_json: string | null;
  content_hash: string | null; source_fingerprint: string;
  status: 'queued' | 'working' | 'active' | 'failed' | 'unknown' | 'invalidated';
  assigned_member_key: string; request_id: string | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export interface V7CreationOptionRow {
  option_id: string; owner_id: string; book_id: string; workflow_id: string;
  option_kind: 'volume' | 'chain'; scope_id: string; seat_key: 'structure' | 'commercial' | 'character';
  member_key: string; member_snapshot_json: string; context_pack_id: string;
  option_json: string; option_hash: string; request_id: string; created_at: string;
}

export interface V7CreationOptionMemberPreferenceRow {
  owner_id: string; book_id: string; workflow_id: string;
  option_seat_key: 'option_1' | 'option_2' | 'option_3'; member_key: string;
  created_at: string; updated_at: string;
}

export interface V7CreationReviewRow {
  review_id: string; owner_id: string; book_id: string; workflow_id: string;
  option_kind: 'volume' | 'chain'; scope_id: string; option_ids_json: string;
  member_key: string; member_snapshot_json: string; review_json: string; review_hash: string;
  request_id: string; created_at: string;
}

export interface V7CreationDecisionRow {
  decision_id: string; owner_id: string; book_id: string; workflow_id: string;
  decision_kind: 'volume_option' | 'chain_option' | 'outline' | 'manuscript';
  target_id: string; author_note: string | null; decision_json: string;
  idempotency_key: string; request_hash: string; created_at: string;
}

export interface V7ChapterOutlineSequenceRow {
  sequence_id: string; owner_id: string; book_id: string; workflow_id: string;
  chain_scope_id: string; revision: number; lifecycle: 'candidate' | 'confirmed' | 'superseded';
  context_pack_id: string; content_json: string; content_hash: string; member_key: string;
  request_id: string; created_at: string; confirmed_at: string | null;
  review_json: string | null; review_member_key: string | null;
  review_member_snapshot_json: string | null; review_request_id: string | null; reviewed_at: string | null;
}

export interface V7ChapterOutlineDraftCandidateRow {
  candidate_id: string; owner_id: string; book_id: string; workflow_id: string;
  chain_scope_id: string; seat_key: 'option_1' | 'option_2' | 'option_3';
  lifecycle: 'candidate' | 'selected' | 'superseded'; context_pack_id: string;
  content_json: string; content_hash: string; member_key: string; member_snapshot_json: string;
  request_id: string; review_json: string | null; review_member_key: string | null;
  review_member_snapshot_json: string | null; review_request_id: string | null;
  created_at: string; reviewed_at: string | null; selected_at: string | null;
}

export interface V7ManuscriptVersionRow {
  manuscript_version_id: string; owner_id: string; book_id: string; workflow_id: string;
  sequence_id: string; chapter_number: number; outline_revision: number; revision: number;
  lifecycle: 'draft' | 'reviewed' | 'final'; content_text: string; content_hash: string;
  context_pack_id: string; member_key: string; based_on_version_id: string | null;
  request_id: string; created_at: string; finalized_at: string | null;
}

export interface V7ManuscriptReviewRow {
  review_id: string; owner_id: string; book_id: string; workflow_id: string;
  manuscript_version_id: string; member_key: string; member_snapshot_json: string;
  review_json: string; review_hash: string; request_id: string; created_at: string;
}

export interface V7ChapterSettlementRow {
  settlement_id: string; owner_id: string; book_id: string; workflow_id: string;
  manuscript_version_id: string; manuscript_hash: string; settlement_json: string;
  settlement_hash: string; evidence_refs_json: string; member_key: string; request_id: string; created_at: string;
}

export interface V7CreationStageSettlementRow {
  stage_settlement_id: string; owner_id: string; book_id: string; workflow_id: string;
  settlement_kind: 'chain' | 'volume'; scope_id: string; content_json: string;
  evidence_refs_json: string; member_key: string; request_id: string; created_at: string;
}

export interface V7CreationStageJobRow {
  job_id: string; owner_id: string; book_id: string; workflow_id: string;
  settlement_kind: 'chain' | 'volume'; scope_id: string; source_fingerprint: string;
  status: 'pending' | 'working' | 'completed' | 'failed' | 'unknown'; attempt_count: number;
  lease_token: string | null; lease_expires_at: string | null; error_message: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

export interface V7ChapterSettlementWithChapterRow extends V7ChapterSettlementRow {
  chapter_number: number;
}

export interface V7CreationModelCallRow {
  request_id: string; owner_id: string; book_id: string; workflow_id: string;
  run_kind: 'context' | 'option' | 'option_review' | 'outline' | 'manuscript' | 'review' | 'settlement';
  node_key: string; member_key: string; provider: string; model_id: string; plan: 'coding' | 'agent';
  purpose: 'structured_planning' | 'novel_writer' | 'novel_reviewer';
  state: 'working' | 'succeeded' | 'failed' | 'unknown'; prompt_hash: string;
  reserved_tokens: number; temperature: number; input_tokens: number | null; output_tokens: number | null;
  cash_micros: number | null; output_text: string | null; failure_message: string | null;
  started_at: string; completed_at: string | null; updated_at: string;
}

export interface V7CreationActorCallRow {
  member_key: string;
  state: string;
  node_key: string;
  started_at: string;
  run_kind: V7CreationModelCallRow['run_kind'];
}

export interface V7CreationMemberPreferenceRow {
  owner_id: string; book_id: string; workflow_id: string; role_key: string; member_key: string;
  created_at: string; updated_at: string;
}

export interface V7ManuscriptFinalizeReceiptRow {
  receipt_id: string; owner_id: string; book_id: string; workflow_id: string;
  manuscript_version_id: string; idempotency_key: string; request_hash: string; created_at: string;
}

export interface V7FormalizationEventRow {
  event_id: string; owner_id: string; book_id: string; workflow_id: string;
  source_kind: 'final_manuscript' | 'chapter_settlement'; source_id: string;
  event_kind: 'settle_chapter' | 'maintain_characters' | 'maintain_planning' | 'maintain_story_state';
  payload_json: string; status: 'pending' | 'working' | 'completed' | 'failed' | 'unknown';
  attempt_count: number; lease_token: string | null; lease_expires_at: string | null;
  error_message: string | null; created_at: string; updated_at: string; completed_at: string | null;
}

export interface V7CreationAdminSummaryRow {
  workflow_id: string; owner_id: string; book_id: string; book_title: string;
  volume_scope_id: string; chain_scope_id: string | null; stage: V7CreationStage; status: V7CreationRunStatus;
  model_calls: number; failed_calls: number; input_tokens: number; output_tokens: number; cash_micros: number;
  pending_updates: number; failed_updates: number; member_keys: string | null; created_at: string; updated_at: string;
}

export interface V7ManagedCreationRunRow {
  workflow_id: string; owner_id: string; book_id: string; mode: 'manual' | 'managed';
  status: 'active' | 'paused' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  writer_member_key: string | null; reviewer_member_key: string | null; attempt_count: number;
  lease_token: string | null; lease_expires_at: string | null; error_message: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

export class V7CreationRuntimeRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public workflow(ownerId: string, bookId: string, workflowId: string): V7CreationWorkflowRow | undefined {
    return this.database.prepare('SELECT * FROM v7_creation_workflows WHERE owner_id=? AND book_id=? AND workflow_id=?')
      .get(ownerId, bookId, workflowId) as V7CreationWorkflowRow | undefined;
  }

  public workflowByIdempotency(ownerId: string, bookId: string, idempotencyKey: string): V7CreationWorkflowRow | undefined {
    return this.database.prepare('SELECT * FROM v7_creation_workflows WHERE owner_id=? AND book_id=? AND idempotency_key=?')
      .get(ownerId, bookId, idempotencyKey) as V7CreationWorkflowRow | undefined;
  }

  public latestWorkflow(ownerId: string, bookId: string): V7CreationWorkflowRow | undefined {
    return this.database.prepare('SELECT * FROM v7_creation_workflows WHERE owner_id=? AND book_id=? ORDER BY updated_at DESC LIMIT 1')
      .get(ownerId, bookId) as V7CreationWorkflowRow | undefined;
  }

  public workflowsByOwner(ownerId: string, limit: number): V7CreationWorkflowRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_workflows WHERE owner_id=?
      ORDER BY updated_at DESC LIMIT ?`).all(ownerId, limit) as unknown as V7CreationWorkflowRow[];
  }

  public workflowsForBook(ownerId: string, bookId: string): V7CreationWorkflowRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_workflows
      WHERE owner_id=? AND book_id=? ORDER BY created_at,workflow_id`)
      .all(ownerId, bookId) as unknown as V7CreationWorkflowRow[];
  }

  public workflowsForVolume(ownerId: string, bookId: string, volumeScopeId: string): V7CreationWorkflowRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_workflows
      WHERE owner_id=? AND book_id=? AND volume_scope_id=? ORDER BY created_at`)
      .all(ownerId, bookId, volumeScopeId) as unknown as V7CreationWorkflowRow[];
  }

  public managedRun(ownerId: string, bookId: string, workflowId: string): V7ManagedCreationRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_managed_creation_runs
      WHERE owner_id=? AND book_id=? AND workflow_id=?`).get(ownerId, bookId, workflowId) as V7ManagedCreationRunRow | undefined;
  }

  public saveManagedRun(input: {
    ownerId: string; bookId: string; workflowId: string; mode: 'manual' | 'managed';
    writerMemberKey: string | null; reviewerMemberKey: string | null; now: string;
  }): V7ManagedCreationRunRow {
    const status = input.mode === 'managed' ? 'active' : 'paused';
    this.database.prepare(`INSERT INTO v7_managed_creation_runs(
      workflow_id,owner_id,book_id,mode,status,writer_member_key,reviewer_member_key,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(workflow_id) DO UPDATE SET mode=excluded.mode,status=excluded.status,
      writer_member_key=excluded.writer_member_key,reviewer_member_key=excluded.reviewer_member_key,
      lease_token=NULL,lease_expires_at=NULL,error_message=NULL,updated_at=excluded.updated_at,completed_at=NULL`)
      .run(input.workflowId, input.ownerId, input.bookId, input.mode, status,
        input.writerMemberKey, input.reviewerMemberKey, input.now, input.now);
    return this.managedRun(input.ownerId, input.bookId, input.workflowId)!;
  }

  public pendingManagedRuns(limit: number, now: string): V7ManagedCreationRunRow[] {
    return this.database.prepare(`SELECT * FROM v7_managed_creation_runs
      WHERE mode='managed' AND status='active' AND (lease_expires_at IS NULL OR lease_expires_at<=?)
      ORDER BY updated_at,workflow_id LIMIT ?`).all(now, limit) as unknown as V7ManagedCreationRunRow[];
  }

  public claimManagedRun(workflowId: string, leaseToken: string, expiresAt: string, now: string): boolean {
    const result = this.database.prepare(`UPDATE v7_managed_creation_runs
      SET lease_token=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=?
      WHERE workflow_id=? AND mode='managed' AND status='active'
        AND (lease_expires_at IS NULL OR lease_expires_at<=?)`)
      .run(leaseToken, expiresAt, now, workflowId, now);
    return result.changes === 1;
  }

  public releaseManagedRun(input: {
    workflowId: string; leaseToken: string;
    status: V7ManagedCreationRunRow['status']; message: string | null; now: string;
  }): boolean {
    const result = this.database.prepare(`UPDATE v7_managed_creation_runs SET status=?,error_message=?,
      lease_token=NULL,lease_expires_at=NULL,updated_at=?,completed_at=?
      WHERE workflow_id=? AND lease_token=?`).run(
      input.status, input.message, input.now, input.status === 'completed' ? input.now : null,
      input.workflowId, input.leaseToken
    );
    return result.changes === 1;
  }

  public cancelManagedRun(ownerId: string, bookId: string, workflowId: string, now: string): void {
    this.database.prepare(`UPDATE v7_managed_creation_runs SET status='cancelled',error_message=?,
      lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE owner_id=? AND book_id=? AND workflow_id=?
      AND status NOT IN ('completed','cancelled')`).run(
      '任务已停止，已经完成的正文和结算仍然保留。', now, ownerId, bookId, workflowId
    );
  }

  public adminWorkflowSummaries(limit: number): V7CreationAdminSummaryRow[] {
    return this.database.prepare(`SELECT w.workflow_id,w.owner_id,w.book_id,b.title AS book_title,
      w.volume_scope_id,w.chain_scope_id,w.stage,w.status,w.created_at,w.updated_at,
      (SELECT COUNT(*) FROM v7_creation_model_calls c WHERE c.workflow_id=w.workflow_id) AS model_calls,
      (SELECT COUNT(*) FROM v7_creation_model_calls c WHERE c.workflow_id=w.workflow_id AND c.state='failed') AS failed_calls,
      COALESCE((SELECT SUM(c.input_tokens) FROM v7_creation_model_calls c WHERE c.workflow_id=w.workflow_id),0) AS input_tokens,
      COALESCE((SELECT SUM(c.output_tokens) FROM v7_creation_model_calls c WHERE c.workflow_id=w.workflow_id),0) AS output_tokens,
      COALESCE((SELECT SUM(c.cash_micros) FROM v7_creation_model_calls c WHERE c.workflow_id=w.workflow_id),0) AS cash_micros,
      (SELECT COUNT(*) FROM v7_formalization_outbox e WHERE e.workflow_id=w.workflow_id AND e.status IN ('pending','working')) AS pending_updates,
      (SELECT COUNT(*) FROM v7_formalization_outbox e WHERE e.workflow_id=w.workflow_id AND e.status IN ('failed','unknown')) AS failed_updates,
      (SELECT GROUP_CONCAT(DISTINCT c.member_key) FROM v7_creation_model_calls c WHERE c.workflow_id=w.workflow_id) AS member_keys
      FROM v7_creation_workflows w JOIN books b ON b.owner_id=w.owner_id AND b.book_id=w.book_id
      ORDER BY w.updated_at DESC LIMIT ?`).all(limit) as unknown as V7CreationAdminSummaryRow[];
  }

  public createWorkflow(input: {
    workflowId: string; ownerId: string; bookId: string; volumeScopeId: string; firstVolume: boolean;
    authorGoal: string | null; requestedCandidateCount?: number;
    idempotencyKey: string; requestHash: string; now: string;
  }): V7CreationWorkflowRow {
    this.database.prepare(`INSERT INTO v7_creation_workflows(
      workflow_id,owner_id,book_id,volume_scope_id,chain_scope_id,stage,status,first_volume,author_goal,
      idempotency_key,request_hash,checkpoint_json,error_message,created_at,updated_at
    ) VALUES(?,?,?,?,NULL,'context_selection','queued',?,?,?,?,?,NULL,?,?)`).run(
      input.workflowId, input.ownerId, input.bookId, input.volumeScopeId, input.firstVolume ? 1 : 0,
      input.authorGoal, input.idempotencyKey, input.requestHash,
      JSON.stringify({ requestedCandidateCount: input.requestedCandidateCount ?? 1 }), input.now, input.now
    );
    return this.workflow(input.ownerId, input.bookId, input.workflowId)!;
  }

  public createChainWorkflow(input: {
    workflowId: string; ownerId: string; bookId: string; volumeScopeId: string; chainScopeId: string;
    firstVolume: boolean; authorGoal: string | null; parentWorkflowId: string;
    requestedCandidateCount?: number;
    idempotencyKey: string; requestHash: string; now: string;
  }): V7CreationWorkflowRow {
    this.database.prepare(`INSERT INTO v7_creation_workflows(
      workflow_id,owner_id,book_id,volume_scope_id,chain_scope_id,stage,status,first_volume,author_goal,
      idempotency_key,request_hash,checkpoint_json,error_message,created_at,updated_at
    ) VALUES(?,?,?,?,?,'chain_options','queued',?,?,?,?,?,NULL,?,?)`).run(
      input.workflowId, input.ownerId, input.bookId, input.volumeScopeId, input.chainScopeId,
      input.firstVolume ? 1 : 0, input.authorGoal, input.idempotencyKey, input.requestHash,
      JSON.stringify({
        parentWorkflowId: input.parentWorkflowId,
        requestedCandidateCount: input.requestedCandidateCount ?? 1
      }), input.now, input.now
    );
    return this.workflow(input.ownerId, input.bookId, input.workflowId)!;
  }

  public nextBookChapterNumber(ownerId: string, bookId: string): number {
    const row = this.database.prepare(`SELECT COALESCE(MAX(chapter_number),0)+1 AS next_chapter
      FROM v7_manuscript_versions WHERE owner_id=? AND book_id=? AND lifecycle='final'`)
      .get(ownerId, bookId) as { next_chapter: number };
    return row.next_chapter;
  }

  public updateWorkflow(input: {
    ownerId: string; bookId: string; workflowId: string; stage: V7CreationStage; status: V7CreationRunStatus;
    checkpoint?: unknown; chainScopeId?: string | null; errorMessage?: string | null; now: string;
  }): void {
    this.database.prepare(`UPDATE v7_creation_workflows SET stage=?,status=?,checkpoint_json=?,
      chain_scope_id=COALESCE(?,chain_scope_id),error_message=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND workflow_id=?`).run(
      input.stage, input.status, JSON.stringify(input.checkpoint ?? {}), input.chainScopeId ?? null,
      input.errorMessage ?? null, input.now, input.ownerId, input.bookId, input.workflowId
    );
  }

  public cancelWorkflow(input: {
    controlId: string; ownerId: string; bookId: string; workflowId: string;
    publicReason: string; idempotencyKey: string; requestHash: string; now: string;
  }): V7CreationWorkflowRow | undefined {
    const replay = this.database.prepare(`SELECT request_hash FROM v7_creation_task_controls
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`).get(
      input.ownerId, input.bookId, input.idempotencyKey
    ) as { request_hash: string } | undefined;
    if (replay !== undefined) {
      if (replay.request_hash !== input.requestHash) throw new Error('操作编号已用于其他任务控制');
      return this.workflow(input.ownerId, input.bookId, input.workflowId);
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.workflow(input.ownerId, input.bookId, input.workflowId);
      if (current === undefined) { this.database.exec('ROLLBACK'); return undefined; }
      if (!['completed', 'cancelled'].includes(current.status)) {
        this.database.prepare(`UPDATE v7_creation_workflows SET status='cancelled',error_message=?,updated_at=?
          WHERE owner_id=? AND book_id=? AND workflow_id=?`).run(
          input.publicReason, input.now, input.ownerId, input.bookId, input.workflowId
        );
      }
      this.database.prepare(`INSERT INTO v7_creation_task_controls(
        control_id,owner_id,book_id,workflow_id,action,role_key,from_member_key,to_member_key,
        public_reason,idempotency_key,request_hash,created_at
      ) VALUES(?,?,?,?, 'cancel',NULL,NULL,NULL,?,?,?,?)`).run(
        input.controlId, input.ownerId, input.bookId, input.workflowId, input.publicReason,
        input.idempotencyKey, input.requestHash, input.now
      );
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return this.workflow(input.ownerId, input.bookId, input.workflowId);
  }

  public saveMemberPreference(input: {
    ownerId: string; bookId: string; workflowId: string; roleKey: string; memberKey: string; now: string;
  }): void {
    const table = isFixedCreationRole(input.roleKey)
      ? 'v7_creation_fixed_member_preferences'
      : 'v7_creation_member_preferences';
    this.database.prepare(`INSERT INTO ${table}(
      owner_id,book_id,workflow_id,role_key,member_key,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,book_id,workflow_id,role_key) DO UPDATE SET
      member_key=excluded.member_key,updated_at=excluded.updated_at`).run(
      input.ownerId, input.bookId, input.workflowId, input.roleKey, input.memberKey, input.now, input.now
    );
  }

  public memberPreference(ownerId: string, bookId: string, workflowId: string, roleKey: string): V7CreationMemberPreferenceRow | undefined {
    if (!isFixedCreationRole(roleKey)) {
      return this.database.prepare(`SELECT * FROM v7_creation_member_preferences
        WHERE owner_id=? AND book_id=? AND workflow_id=? AND role_key=?`).get(
        ownerId, bookId, workflowId, roleKey
      ) as unknown as V7CreationMemberPreferenceRow | undefined;
    }
    const fixed = this.database.prepare(`SELECT * FROM v7_creation_fixed_member_preferences
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND role_key=?`).get(
      ownerId, bookId, workflowId, roleKey
    ) as unknown as V7CreationMemberPreferenceRow | undefined;
    if (fixed !== undefined) return fixed;
    const legacyRoleKey = roleKey === 'planning_writer' ? 'outline_writer' : roleKey;
    const legacy = this.database.prepare(`SELECT * FROM v7_creation_member_preferences
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND role_key=?`).get(
      ownerId, bookId, workflowId, legacyRoleKey
    ) as unknown as V7CreationMemberPreferenceRow | undefined;
    return legacy === undefined ? undefined : { ...legacy, role_key: roleKey };
  }

  public memberPreferences(ownerId: string, bookId: string, workflowId: string): V7CreationMemberPreferenceRow[] {
    const fixed = this.database.prepare(`SELECT * FROM v7_creation_fixed_member_preferences
      WHERE owner_id=? AND book_id=? AND workflow_id=?`).all(
      ownerId, bookId, workflowId
    ) as unknown as V7CreationMemberPreferenceRow[];
    const legacy = this.database.prepare(`SELECT * FROM v7_creation_member_preferences
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND role_key IN (
        'context_editor','chief_editor','outline_writer','lead_writer','independent_reviewer','settlement_editor'
      )`).all(ownerId, bookId, workflowId) as unknown as V7CreationMemberPreferenceRow[];
    const merged = new Map<string, V7CreationMemberPreferenceRow>();
    for (const row of legacy) {
      const roleKey = row.role_key === 'outline_writer' ? 'planning_writer' : row.role_key;
      merged.set(roleKey, { ...row, role_key: roleKey });
    }
    for (const row of fixed) merged.set(row.role_key, row);
    return [...merged.values()].toSorted((left, right) => left.role_key.localeCompare(right.role_key));
  }

  public saveOptionMemberPreference(input: {
    ownerId: string; bookId: string; workflowId: string;
    optionSeatKey: V7CreationOptionMemberPreferenceRow['option_seat_key']; memberKey: string; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_creation_option_member_preferences(
      owner_id,book_id,workflow_id,option_seat_key,member_key,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,book_id,workflow_id,option_seat_key) DO UPDATE SET
      member_key=excluded.member_key,updated_at=excluded.updated_at`).run(
      input.ownerId, input.bookId, input.workflowId, input.optionSeatKey, input.memberKey, input.now, input.now
    );
  }

  public optionMemberPreference(
    ownerId: string,
    bookId: string,
    workflowId: string,
    optionSeatKey: V7CreationOptionMemberPreferenceRow['option_seat_key']
  ): V7CreationOptionMemberPreferenceRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_creation_option_member_preferences
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND option_seat_key=?`).get(
      ownerId, bookId, workflowId, optionSeatKey
    ) as unknown as V7CreationOptionMemberPreferenceRow | undefined;
  }

  public optionMemberPreferences(ownerId: string, bookId: string, workflowId: string): V7CreationOptionMemberPreferenceRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_option_member_preferences
      WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY option_seat_key`).all(
      ownerId, bookId, workflowId
    ) as unknown as V7CreationOptionMemberPreferenceRow[];
  }

  public contextPackByFingerprint(input: {
    ownerId: string; bookId: string; workflowId: string; taskKind: V7CreationContextPack['taskKind'];
    taskId: string; sourceFingerprint: string;
  }): V7CreationContextPackRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_creation_context_packs
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND task_kind=? AND task_id=? AND source_fingerprint=?`)
      .get(input.ownerId, input.bookId, input.workflowId, input.taskKind, input.taskId, input.sourceFingerprint) as unknown as V7CreationContextPackRow | undefined;
  }

  public contextPack(ownerId: string, bookId: string, contextPackId: string): V7CreationContextPackRow | undefined {
    return this.database.prepare('SELECT * FROM v7_creation_context_packs WHERE owner_id=? AND book_id=? AND context_pack_id=?')
      .get(ownerId, bookId, contextPackId) as V7CreationContextPackRow | undefined;
  }

  public createContextPack(input: {
    contextPackId: string; ownerId: string; bookId: string; workflowId: string;
    taskKind: V7CreationContextPack['taskKind']; taskId: string; taskBrief: string;
    candidates: unknown; sourceFingerprint: string; assignedMemberKey: string; now: string;
  }): V7CreationContextPackRow {
    this.database.prepare(`INSERT INTO v7_creation_context_packs(
      context_pack_id,owner_id,book_id,workflow_id,task_kind,task_id,task_brief,candidate_sources_json,
      selection_json,content_json,content_hash,source_fingerprint,status,assigned_member_key,request_id,error_message,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,'queued',?,NULL,NULL,?,?)`).run(
      input.contextPackId, input.ownerId, input.bookId, input.workflowId, input.taskKind, input.taskId,
      input.taskBrief, JSON.stringify(input.candidates), input.sourceFingerprint, input.assignedMemberKey, input.now, input.now
    );
    return this.contextPack(input.ownerId, input.bookId, input.contextPackId)!;
  }

  public markContextWorking(input: { ownerId: string; bookId: string; contextPackId: string; memberKey: string; requestId: string; now: string }): void {
    this.database.prepare(`UPDATE v7_creation_context_packs SET status='working',assigned_member_key=?,request_id=?,error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND context_pack_id=?`).run(
      input.memberKey, input.requestId, input.now, input.ownerId, input.bookId, input.contextPackId
    );
  }

  public activateContext(input: {
    ownerId: string; bookId: string; contextPackId: string; selection: V7CreationContextSelection;
    content: V7CreationContextPack; contentHash: string; now: string;
  }): void {
    this.database.prepare(`UPDATE v7_creation_context_packs SET status='active',selection_json=?,content_json=?,content_hash=?,error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND context_pack_id=?`).run(
      JSON.stringify(input.selection), JSON.stringify(input.content), input.contentHash, input.now,
      input.ownerId, input.bookId, input.contextPackId
    );
  }

  public failContext(input: { ownerId: string; bookId: string; contextPackId: string; status: 'failed' | 'unknown'; message: string; now: string }): void {
    this.database.prepare('UPDATE v7_creation_context_packs SET status=?,error_message=?,updated_at=? WHERE owner_id=? AND book_id=? AND context_pack_id=?')
      .run(input.status, input.message, input.now, input.ownerId, input.bookId, input.contextPackId);
  }

  public option(ownerId: string, bookId: string, optionId: string): V7CreationOptionRow | undefined {
    return this.database.prepare('SELECT * FROM v7_creation_options WHERE owner_id=? AND book_id=? AND option_id=?')
      .get(ownerId, bookId, optionId) as V7CreationOptionRow | undefined;
  }

  public options(ownerId: string, bookId: string, workflowId: string, kind: 'volume' | 'chain'): V7CreationOptionRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_options WHERE owner_id=? AND book_id=? AND workflow_id=? AND option_kind=?
      ORDER BY CASE seat_key WHEN 'structure' THEN 1 WHEN 'commercial' THEN 2 WHEN 'character' THEN 3 ELSE 4 END,created_at`)
      .all(ownerId, bookId, workflowId, kind) as unknown as V7CreationOptionRow[];
  }

  public saveOption(input: {
    optionId: string; ownerId: string; bookId: string; workflowId: string; kind: 'volume' | 'chain'; scopeId: string;
    seatKey: 'structure' | 'commercial' | 'character'; memberKey: string; memberSnapshot: unknown;
    contextPackId: string; option: V7VolumeOption | V7ChainOption; optionHash: string; requestId: string; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_creation_options(
      option_id,owner_id,book_id,workflow_id,option_kind,scope_id,seat_key,member_key,member_snapshot_json,
      context_pack_id,option_json,option_hash,request_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.optionId, input.ownerId, input.bookId, input.workflowId, input.kind, input.scopeId, input.seatKey,
      input.memberKey, JSON.stringify(input.memberSnapshot), input.contextPackId, JSON.stringify(input.option),
      input.optionHash, input.requestId, input.now
    );
  }

  public optionReview(ownerId: string, bookId: string, workflowId: string, kind: 'volume' | 'chain'): V7CreationReviewRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_creation_option_reviews WHERE owner_id=? AND book_id=? AND workflow_id=? AND option_kind=?`)
      .get(ownerId, bookId, workflowId, kind) as V7CreationReviewRow | undefined;
  }

  public saveOptionReview(input: {
    reviewId: string; ownerId: string; bookId: string; workflowId: string; kind: 'volume' | 'chain'; scopeId: string;
    optionIds: string[]; memberKey: string; memberSnapshot: unknown; review: V7PlanningOptionReview;
    reviewHash: string; requestId: string; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_creation_option_reviews(
      review_id,owner_id,book_id,workflow_id,option_kind,scope_id,option_ids_json,member_key,
      member_snapshot_json,review_json,review_hash,request_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner_id,book_id,workflow_id,option_kind,scope_id) DO UPDATE SET
      option_ids_json=excluded.option_ids_json,
      member_key=excluded.member_key,
      member_snapshot_json=excluded.member_snapshot_json,
      review_json=excluded.review_json,
      review_hash=excluded.review_hash,
      request_id=excluded.request_id,
      created_at=excluded.created_at`).run(
      input.reviewId, input.ownerId, input.bookId, input.workflowId, input.kind, input.scopeId,
      JSON.stringify(input.optionIds), input.memberKey, JSON.stringify(input.memberSnapshot), JSON.stringify(input.review),
      input.reviewHash, input.requestId, input.now
    );
  }

  public decision(ownerId: string, bookId: string, workflowId: string, kind: V7CreationDecisionRow['decision_kind']): V7CreationDecisionRow | undefined {
    return this.database.prepare('SELECT * FROM v7_creation_decisions WHERE owner_id=? AND book_id=? AND workflow_id=? AND decision_kind=?')
      .get(ownerId, bookId, workflowId, kind) as V7CreationDecisionRow | undefined;
  }

  public decisionByIdempotency(ownerId: string, bookId: string, idempotencyKey: string): V7CreationDecisionRow | undefined {
    return this.database.prepare('SELECT * FROM v7_creation_decisions WHERE owner_id=? AND book_id=? AND idempotency_key=?')
      .get(ownerId, bookId, idempotencyKey) as V7CreationDecisionRow | undefined;
  }

  public saveDecision(input: {
    decisionId: string; ownerId: string; bookId: string; workflowId: string; kind: V7CreationDecisionRow['decision_kind'];
    targetId: string; authorNote: string | null; decision: unknown; idempotencyKey: string; requestHash: string; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_creation_decisions(
      decision_id,owner_id,book_id,workflow_id,decision_kind,target_id,author_note,decision_json,idempotency_key,request_hash,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.decisionId, input.ownerId, input.bookId, input.workflowId, input.kind, input.targetId,
      input.authorNote, JSON.stringify(input.decision), input.idempotencyKey, input.requestHash, input.now
    );
  }

  public latestOutline(ownerId: string, bookId: string, chainScopeId: string): V7ChapterOutlineSequenceRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_chapter_outline_sequences WHERE owner_id=? AND book_id=? AND chain_scope_id=?
      ORDER BY revision DESC LIMIT 1`).get(ownerId, bookId, chainScopeId) as V7ChapterOutlineSequenceRow | undefined;
  }

  public confirmedOutline(ownerId: string, bookId: string, chainScopeId: string): V7ChapterOutlineSequenceRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_chapter_outline_sequences
      WHERE owner_id=? AND book_id=? AND chain_scope_id=? AND lifecycle='confirmed'
      ORDER BY revision DESC LIMIT 1`).get(ownerId, bookId, chainScopeId) as V7ChapterOutlineSequenceRow | undefined;
  }

  public outline(ownerId: string, bookId: string, sequenceId: string): V7ChapterOutlineSequenceRow | undefined {
    return this.database.prepare('SELECT * FROM v7_chapter_outline_sequences WHERE owner_id=? AND book_id=? AND sequence_id=?')
      .get(ownerId, bookId, sequenceId) as V7ChapterOutlineSequenceRow | undefined;
  }

  public outlineDraftCandidates(ownerId: string, bookId: string, workflowId: string, chainScopeId: string): V7ChapterOutlineDraftCandidateRow[] {
    return this.database.prepare(`SELECT * FROM v7_chapter_outline_draft_candidates
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND chain_scope_id=? AND lifecycle='candidate'
      ORDER BY CASE seat_key WHEN 'option_1' THEN 1 WHEN 'option_2' THEN 2 ELSE 3 END`)
      .all(ownerId, bookId, workflowId, chainScopeId) as unknown as V7ChapterOutlineDraftCandidateRow[];
  }

  public outlineDraftCandidate(ownerId: string, bookId: string, candidateId: string): V7ChapterOutlineDraftCandidateRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_chapter_outline_draft_candidates
      WHERE owner_id=? AND book_id=? AND candidate_id=?`).get(ownerId, bookId, candidateId) as V7ChapterOutlineDraftCandidateRow | undefined;
  }

  public saveOutlineDraftCandidate(input: {
    candidateId: string; ownerId: string; bookId: string; workflowId: string; chainScopeId: string;
    seatKey: V7ChapterOutlineDraftCandidateRow['seat_key']; contextPackId: string; content: V7ChapterSequence;
    contentHash: string; memberKey: string; memberSnapshot: unknown; requestId: string; now: string;
    replacesCandidateId?: string;
  }): V7ChapterOutlineDraftCandidateRow {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (input.replacesCandidateId !== undefined) {
        const replaced = this.database.prepare(`UPDATE v7_chapter_outline_draft_candidates SET lifecycle='superseded'
          WHERE owner_id=? AND book_id=? AND workflow_id=? AND chain_scope_id=? AND candidate_id=? AND lifecycle='candidate'`)
          .run(input.ownerId, input.bookId, input.workflowId, input.chainScopeId, input.replacesCandidateId);
        if (replaced.changes !== 1) throw new Error('待替换的章纲方案已经变化');
      }
      this.database.prepare(`INSERT INTO v7_chapter_outline_draft_candidates(
        candidate_id,owner_id,book_id,workflow_id,chain_scope_id,seat_key,lifecycle,context_pack_id,
        content_json,content_hash,member_key,member_snapshot_json,request_id,created_at
      ) VALUES(?,?,?,?,?,?,'candidate',?,?,?,?,?,?,?)`).run(
        input.candidateId, input.ownerId, input.bookId, input.workflowId, input.chainScopeId, input.seatKey,
        input.contextPackId, JSON.stringify(input.content), input.contentHash, input.memberKey,
        JSON.stringify(input.memberSnapshot), input.requestId, input.now
      );
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return this.outlineDraftCandidate(input.ownerId, input.bookId, input.candidateId)!;
  }

  public saveOutlineDraftReview(input: {
    ownerId: string; bookId: string; candidateId: string; memberKey: string; memberSnapshot: unknown;
    review: V7ChapterReview; requestId: string; now: string;
  }): V7ChapterOutlineDraftCandidateRow {
    this.database.prepare(`UPDATE v7_chapter_outline_draft_candidates SET
      review_json=?,review_member_key=?,review_member_snapshot_json=?,review_request_id=?,reviewed_at=?
      WHERE owner_id=? AND book_id=? AND candidate_id=? AND lifecycle='candidate'`).run(
      JSON.stringify(input.review), input.memberKey, JSON.stringify(input.memberSnapshot), input.requestId, input.now,
      input.ownerId, input.bookId, input.candidateId
    );
    return this.outlineDraftCandidate(input.ownerId, input.bookId, input.candidateId)!;
  }

  public supersedeOutlineDraft(input: { ownerId: string; bookId: string; workflowId: string; chainScopeId: string; candidateId: string; now: string }): boolean {
    void input.now;
    return this.database.prepare(`UPDATE v7_chapter_outline_draft_candidates SET lifecycle='superseded'
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND chain_scope_id=? AND candidate_id=? AND lifecycle='candidate'`)
      .run(input.ownerId, input.bookId, input.workflowId, input.chainScopeId, input.candidateId).changes === 1;
  }

  public selectOutlineDraft(input: { ownerId: string; bookId: string; workflowId: string; chainScopeId: string; candidateId: string; now: string }): boolean {
    const updated = this.database.prepare(`UPDATE v7_chapter_outline_draft_candidates SET lifecycle='selected',selected_at=?
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND chain_scope_id=? AND candidate_id=? AND lifecycle='candidate'`)
      .run(input.now, input.ownerId, input.bookId, input.workflowId, input.chainScopeId, input.candidateId);
    if (updated.changes !== 1) return false;
    this.database.prepare(`UPDATE v7_chapter_outline_draft_candidates SET lifecycle='superseded'
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND chain_scope_id=? AND candidate_id<>? AND lifecycle='candidate'`)
      .run(input.ownerId, input.bookId, input.workflowId, input.chainScopeId, input.candidateId);
    return true;
  }

  public saveOutline(input: {
    sequenceId: string; ownerId: string; bookId: string; workflowId: string; chainScopeId: string;
    contextPackId: string; content: V7ChapterSequence; contentHash: string; memberKey: string; requestId: string; now: string;
  }): V7ChapterOutlineSequenceRow {
    const latest = this.latestOutline(input.ownerId, input.bookId, input.chainScopeId);
    if (latest?.lifecycle === 'candidate') {
      this.database.prepare(`UPDATE v7_chapter_outline_sequences SET lifecycle='superseded'
        WHERE owner_id=? AND book_id=? AND sequence_id=?`).run(input.ownerId, input.bookId, latest.sequence_id);
    }
    const revision = (latest?.revision ?? 0) + 1;
    this.database.prepare(`INSERT INTO v7_chapter_outline_sequences(
      sequence_id,owner_id,book_id,workflow_id,chain_scope_id,revision,lifecycle,context_pack_id,content_json,
      content_hash,member_key,request_id,created_at,confirmed_at
    ) VALUES(?,?,?,?,?,?,'candidate',?,?,?,?,?,?,NULL)`).run(
      input.sequenceId, input.ownerId, input.bookId, input.workflowId, input.chainScopeId, revision,
      input.contextPackId, JSON.stringify(input.content), input.contentHash, input.memberKey, input.requestId, input.now
    );
    return this.outline(input.ownerId, input.bookId, input.sequenceId)!;
  }

  public saveOutlineReview(input: {
    ownerId: string; bookId: string; sequenceId: string; memberKey: string;
    memberSnapshot: unknown; review: V7ChapterReview; requestId: string; now: string;
  }): V7ChapterOutlineSequenceRow {
    const updated = this.database.prepare(`UPDATE v7_chapter_outline_sequences SET
      review_json=?,review_member_key=?,review_member_snapshot_json=?,review_request_id=?,reviewed_at=?
      WHERE owner_id=? AND book_id=? AND sequence_id=? AND lifecycle='candidate' AND review_json IS NULL`).run(
      JSON.stringify(input.review), input.memberKey, JSON.stringify(input.memberSnapshot), input.requestId, input.now,
      input.ownerId, input.bookId, input.sequenceId
    );
    if (updated.changes !== 1) {
      const existing = this.outline(input.ownerId, input.bookId, input.sequenceId);
      if (existing?.review_request_id !== input.requestId) throw new Error('章纲审查状态已经变化');
    }
    return this.outline(input.ownerId, input.bookId, input.sequenceId)!;
  }

  public confirmOutline(input: { ownerId: string; bookId: string; sequenceId: string; now: string }): V7ChapterOutlineSequenceRow | undefined {
    const row = this.outline(input.ownerId, input.bookId, input.sequenceId);
    if (row === undefined) return undefined;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`UPDATE v7_chapter_outline_sequences SET lifecycle='superseded'
        WHERE owner_id=? AND book_id=? AND chain_scope_id=? AND lifecycle='confirmed'`)
        .run(input.ownerId, input.bookId, row.chain_scope_id);
      this.database.prepare(`UPDATE v7_chapter_outline_sequences SET lifecycle='confirmed',confirmed_at=?
        WHERE owner_id=? AND book_id=? AND sequence_id=? AND lifecycle='candidate'`)
        .run(input.now, input.ownerId, input.bookId, input.sequenceId);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return this.outline(input.ownerId, input.bookId, input.sequenceId);
  }

  /** 章纲正式化和作者决定同进同退，避免已确认章纲缺失审计记录。 */
  public confirmOutlineWithDecision(input: {
    ownerId: string; bookId: string; workflowId: string; sequenceId: string;
    decisionId: string; idempotencyKey: string; requestHash: string; now: string;
  }): V7ChapterOutlineSequenceRow | undefined {
    const replay = this.decisionByIdempotency(input.ownerId, input.bookId, input.idempotencyKey);
    if (replay !== undefined) return this.outline(input.ownerId, input.bookId, input.sequenceId);
    const existingDecision = this.decision(input.ownerId, input.bookId, input.workflowId, 'outline');
    if (existingDecision !== undefined) return this.outline(input.ownerId, input.bookId, existingDecision.target_id);
    const row = this.outline(input.ownerId, input.bookId, input.sequenceId);
    if (row === undefined || row.workflow_id !== input.workflowId || row.lifecycle !== 'candidate') return undefined;
    const review = row.review_json === null ? null : JSON.parse(row.review_json) as V7ChapterReview;
    if (review?.passed !== true) return undefined;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`UPDATE v7_chapter_outline_sequences SET lifecycle='superseded'
        WHERE owner_id=? AND book_id=? AND chain_scope_id=? AND lifecycle='confirmed'`)
        .run(input.ownerId, input.bookId, row.chain_scope_id);
      const activated = this.database.prepare(`UPDATE v7_chapter_outline_sequences SET lifecycle='confirmed',confirmed_at=?
        WHERE owner_id=? AND book_id=? AND sequence_id=? AND lifecycle='candidate'`)
        .run(input.now, input.ownerId, input.bookId, input.sequenceId);
      if (activated.changes !== 1) throw new Error('章纲状态已经变化');
      this.database.prepare(`INSERT INTO v7_creation_decisions(
        decision_id,owner_id,book_id,workflow_id,decision_kind,target_id,author_note,decision_json,idempotency_key,request_hash,created_at
      ) VALUES(?,?,?,?, 'outline',?,NULL,?,?,?,?)`).run(
        input.decisionId, input.ownerId, input.bookId, input.workflowId, input.sequenceId,
        JSON.stringify({ action: 'confirm', revision: row.revision }), input.idempotencyKey, input.requestHash, input.now
      );
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return this.outline(input.ownerId, input.bookId, input.sequenceId);
  }

  public manuscript(ownerId: string, bookId: string, manuscriptVersionId: string): V7ManuscriptVersionRow | undefined {
    return this.database.prepare('SELECT * FROM v7_manuscript_versions WHERE owner_id=? AND book_id=? AND manuscript_version_id=?')
      .get(ownerId, bookId, manuscriptVersionId) as V7ManuscriptVersionRow | undefined;
  }

  public manuscriptByRequest(ownerId: string, bookId: string, requestId: string): V7ManuscriptVersionRow | undefined {
    return this.database.prepare('SELECT * FROM v7_manuscript_versions WHERE owner_id=? AND book_id=? AND request_id=?')
      .get(ownerId, bookId, requestId) as V7ManuscriptVersionRow | undefined;
  }

  public manuscriptsForSequence(ownerId: string, bookId: string, sequenceId: string): V7ManuscriptVersionRow[] {
    return this.database.prepare(`SELECT * FROM v7_manuscript_versions
      WHERE owner_id=? AND book_id=? AND sequence_id=?
      ORDER BY chapter_number,revision`).all(ownerId, bookId, sequenceId) as unknown as V7ManuscriptVersionRow[];
  }

  public manuscriptsForBook(ownerId: string, bookId: string): V7ManuscriptVersionRow[] {
    return this.database.prepare(`SELECT * FROM v7_manuscript_versions
      WHERE owner_id=? AND book_id=? ORDER BY chapter_number,revision`)
      .all(ownerId, bookId) as unknown as V7ManuscriptVersionRow[];
  }

  public finalManuscriptsForSequence(ownerId: string, bookId: string, sequenceId: string): V7ManuscriptVersionRow[] {
    return this.database.prepare(`SELECT * FROM v7_manuscript_versions
      WHERE owner_id=? AND book_id=? AND sequence_id=? AND lifecycle='final'
      ORDER BY chapter_number`).all(ownerId, bookId, sequenceId) as unknown as V7ManuscriptVersionRow[];
  }

  public saveManuscript(input: {
    manuscriptVersionId: string; ownerId: string; bookId: string; workflowId: string; sequenceId: string;
    chapterNumber: number; outlineRevision: number; contentText: string; contentHash: string; contextPackId: string;
    memberKey: string; basedOnVersionId: string | null; requestId: string; now: string;
  }): V7ManuscriptVersionRow {
    const revisionRow = this.database.prepare(`SELECT COALESCE(MAX(revision),0)+1 AS revision FROM v7_manuscript_versions
      WHERE owner_id=? AND book_id=? AND chapter_number=?`).get(input.ownerId, input.bookId, input.chapterNumber) as { revision: number };
    this.database.prepare(`INSERT INTO v7_manuscript_versions(
      manuscript_version_id,owner_id,book_id,workflow_id,sequence_id,chapter_number,outline_revision,revision,lifecycle,
      content_text,content_hash,context_pack_id,member_key,based_on_version_id,request_id,created_at,finalized_at
    ) VALUES(?,?,?,?,?,?,?,?, 'draft',?,?,?,?,?,?,?,NULL)`).run(
      input.manuscriptVersionId, input.ownerId, input.bookId, input.workflowId, input.sequenceId,
      input.chapterNumber, input.outlineRevision, revisionRow.revision, input.contentText, input.contentHash,
      input.contextPackId, input.memberKey, input.basedOnVersionId, input.requestId, input.now
    );
    return this.manuscript(input.ownerId, input.bookId, input.manuscriptVersionId)!;
  }

  public manuscriptReview(ownerId: string, bookId: string, manuscriptVersionId: string): V7ManuscriptReviewRow | undefined {
    return this.database.prepare('SELECT * FROM v7_manuscript_reviews WHERE owner_id=? AND book_id=? AND manuscript_version_id=?')
      .get(ownerId, bookId, manuscriptVersionId) as V7ManuscriptReviewRow | undefined;
  }

  public saveManuscriptReview(input: {
    reviewId: string; ownerId: string; bookId: string; workflowId: string; manuscriptVersionId: string;
    memberKey: string; memberSnapshot: unknown; review: V7ChapterReview; reviewHash: string; requestId: string; now: string;
  }): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`INSERT INTO v7_manuscript_reviews(
        review_id,owner_id,book_id,workflow_id,manuscript_version_id,member_key,member_snapshot_json,
        review_json,review_hash,request_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.reviewId, input.ownerId, input.bookId, input.workflowId, input.manuscriptVersionId,
        input.memberKey, JSON.stringify(input.memberSnapshot), JSON.stringify(input.review), input.reviewHash,
        input.requestId, input.now
      );
      if (input.review.passed) {
        this.database.prepare(`UPDATE v7_manuscript_versions SET lifecycle='reviewed'
          WHERE owner_id=? AND book_id=? AND manuscript_version_id=? AND lifecycle='draft'`)
          .run(input.ownerId, input.bookId, input.manuscriptVersionId);
      }
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  public finalizeManuscript(input: {
    ownerId: string; bookId: string; workflowId: string; manuscriptVersionId: string;
    decisionId: string; idempotencyKey: string; requestHash: string; eventId: string; now: string;
  }): V7ManuscriptVersionRow | undefined {
    const existing = this.finalizeReceiptByIdempotency(input.ownerId, input.bookId, input.idempotencyKey);
    if (existing !== undefined) return this.manuscript(input.ownerId, input.bookId, existing.manuscript_version_id);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const manuscript = this.manuscript(input.ownerId, input.bookId, input.manuscriptVersionId);
      if (manuscript === undefined || manuscript.lifecycle !== 'reviewed') { this.database.exec('ROLLBACK'); return undefined; }
      this.database.prepare(`UPDATE v7_manuscript_versions SET lifecycle='final',finalized_at=?
        WHERE owner_id=? AND book_id=? AND manuscript_version_id=? AND lifecycle='reviewed'`)
        .run(input.now, input.ownerId, input.bookId, input.manuscriptVersionId);
      this.database.prepare(`INSERT INTO v7_manuscript_finalize_receipts(
        receipt_id,owner_id,book_id,workflow_id,manuscript_version_id,idempotency_key,request_hash,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        input.decisionId, input.ownerId, input.bookId, input.workflowId, input.manuscriptVersionId,
        input.idempotencyKey, input.requestHash, input.now
      );
      this.database.prepare(`INSERT INTO v7_formalization_outbox(
        event_id,owner_id,book_id,workflow_id,source_kind,source_id,event_kind,payload_json,status,attempt_count,
        lease_token,lease_expires_at,error_message,created_at,updated_at,completed_at
      ) VALUES(?,?,?,?, 'final_manuscript',?,'settle_chapter',?,'pending',0,NULL,NULL,NULL,?,?,NULL)`).run(
        input.eventId, input.ownerId, input.bookId, input.workflowId, input.manuscriptVersionId,
        JSON.stringify({ manuscriptVersionId: input.manuscriptVersionId }), input.now, input.now
      );
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return this.manuscript(input.ownerId, input.bookId, input.manuscriptVersionId);
  }

  public finalizeReceiptByIdempotency(ownerId: string, bookId: string, idempotencyKey: string): V7ManuscriptFinalizeReceiptRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_manuscript_finalize_receipts
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`).get(
      ownerId, bookId, idempotencyKey
    ) as unknown as V7ManuscriptFinalizeReceiptRow | undefined;
  }

  public finalizeReceipts(ownerId: string, bookId: string, workflowId: string): V7ManuscriptFinalizeReceiptRow[] {
    return this.database.prepare(`SELECT * FROM v7_manuscript_finalize_receipts
      WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY created_at`).all(
      ownerId, bookId, workflowId
    ) as unknown as V7ManuscriptFinalizeReceiptRow[];
  }

  public settlement(ownerId: string, bookId: string, manuscriptVersionId: string): V7ChapterSettlementRow | undefined {
    return this.database.prepare('SELECT * FROM v7_chapter_settlements WHERE owner_id=? AND book_id=? AND manuscript_version_id=?')
      .get(ownerId, bookId, manuscriptVersionId) as V7ChapterSettlementRow | undefined;
  }

  public settlementById(ownerId: string, bookId: string, settlementId: string): V7ChapterSettlementRow | undefined {
    return this.database.prepare('SELECT * FROM v7_chapter_settlements WHERE owner_id=? AND book_id=? AND settlement_id=?')
      .get(ownerId, bookId, settlementId) as V7ChapterSettlementRow | undefined;
  }

  public chapterSettlementsForWorkflow(ownerId: string, bookId: string, workflowId: string): V7ChapterSettlementWithChapterRow[] {
    return this.database.prepare(`SELECT s.*,m.chapter_number FROM v7_chapter_settlements s
      JOIN v7_manuscript_versions m ON m.owner_id=s.owner_id AND m.book_id=s.book_id
        AND m.manuscript_version_id=s.manuscript_version_id
      WHERE s.owner_id=? AND s.book_id=? AND s.workflow_id=?
      ORDER BY m.chapter_number`).all(ownerId, bookId, workflowId) as unknown as V7ChapterSettlementWithChapterRow[];
  }

  public recentChapterSettlements(ownerId: string, bookId: string, limit = 12): V7ChapterSettlementWithChapterRow[] {
    return this.database.prepare(`SELECT s.*,m.chapter_number FROM v7_chapter_settlements s
      JOIN v7_manuscript_versions m ON m.owner_id=s.owner_id AND m.book_id=s.book_id
        AND m.manuscript_version_id=s.manuscript_version_id
      WHERE s.owner_id=? AND s.book_id=? AND m.lifecycle='final'
      ORDER BY m.chapter_number DESC,s.created_at DESC LIMIT ?`).all(
      ownerId, bookId, Math.max(1, Math.min(50, limit))
    ) as unknown as V7ChapterSettlementWithChapterRow[];
  }

  public stageSettlement(
    ownerId: string,
    bookId: string,
    settlementKind: 'chain' | 'volume',
    scopeId: string
  ): V7CreationStageSettlementRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_creation_stage_settlements
      WHERE owner_id=? AND book_id=? AND settlement_kind=? AND scope_id=?`)
      .get(ownerId, bookId, settlementKind, scopeId) as V7CreationStageSettlementRow | undefined;
  }

  public saveStageSettlement(input: {
    stageSettlementId: string; ownerId: string; bookId: string; workflowId: string;
    settlementKind: 'chain' | 'volume'; scopeId: string; content: V7StageSettlement;
    evidenceRefs: string[]; memberKey: string; requestId: string; now: string;
  }): V7CreationStageSettlementRow {
    const existing = this.stageSettlement(input.ownerId, input.bookId, input.settlementKind, input.scopeId);
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_creation_stage_settlements(
      stage_settlement_id,owner_id,book_id,workflow_id,settlement_kind,scope_id,content_json,
      evidence_refs_json,member_key,request_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.stageSettlementId, input.ownerId, input.bookId, input.workflowId, input.settlementKind,
      input.scopeId, JSON.stringify(input.content), JSON.stringify(input.evidenceRefs), input.memberKey,
      input.requestId, input.now
    );
    return this.stageSettlement(input.ownerId, input.bookId, input.settlementKind, input.scopeId)!;
  }

  public stageSettlements(
    ownerId: string,
    bookId: string,
    settlementKind: 'chain' | 'volume'
  ): V7CreationStageSettlementRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_stage_settlements
      WHERE owner_id=? AND book_id=? AND settlement_kind=? ORDER BY created_at,scope_id`)
      .all(ownerId, bookId, settlementKind) as unknown as V7CreationStageSettlementRow[];
  }

  public stageJob(
    ownerId: string,
    bookId: string,
    settlementKind: 'chain' | 'volume',
    scopeId: string
  ): V7CreationStageJobRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_creation_stage_jobs
      WHERE owner_id=? AND book_id=? AND settlement_kind=? AND scope_id=?`)
      .get(ownerId, bookId, settlementKind, scopeId) as V7CreationStageJobRow | undefined;
  }

  public enqueueStageJob(input: {
    jobId: string; ownerId: string; bookId: string; workflowId: string;
    settlementKind: 'chain' | 'volume'; scopeId: string; sourceFingerprint: string; now: string;
  }): V7CreationStageJobRow {
    const existing = this.stageJob(input.ownerId, input.bookId, input.settlementKind, input.scopeId);
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_creation_stage_jobs(
      job_id,owner_id,book_id,workflow_id,settlement_kind,scope_id,source_fingerprint,status,
      attempt_count,lease_token,lease_expires_at,error_message,created_at,updated_at,completed_at
    ) VALUES(?,?,?,?,?,?,?,'pending',0,NULL,NULL,NULL,?,?,NULL)`).run(
      input.jobId, input.ownerId, input.bookId, input.workflowId, input.settlementKind,
      input.scopeId, input.sourceFingerprint, input.now, input.now
    );
    return this.stageJob(input.ownerId, input.bookId, input.settlementKind, input.scopeId)!;
  }

  public pendingStageJobs(limit: number): V7CreationStageJobRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_stage_jobs WHERE status IN ('pending','failed')
      AND attempt_count<5 ORDER BY created_at,job_id LIMIT ?`).all(limit) as unknown as V7CreationStageJobRow[];
  }

  public stageJobsForWorkflow(ownerId: string, bookId: string, workflowId: string): V7CreationStageJobRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_stage_jobs
      WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY created_at,job_id`)
      .all(ownerId, bookId, workflowId) as unknown as V7CreationStageJobRow[];
  }

  public leaseStageJob(input: { jobId: string; leaseToken: string; expiresAt: string; now: string }): boolean {
    return this.database.prepare(`UPDATE v7_creation_stage_jobs SET status='working',lease_token=?,lease_expires_at=?,
      attempt_count=attempt_count+1,error_message=NULL,updated_at=?
      WHERE job_id=? AND (status IN ('pending','failed') OR (status='working' AND lease_expires_at<?))`)
      .run(input.leaseToken, input.expiresAt, input.now, input.jobId, input.now).changes === 1;
  }

  public finishStageJob(input: {
    jobId: string; leaseToken: string; status: 'completed' | 'failed' | 'unknown'; message: string | null; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_creation_stage_jobs SET status=?,error_message=?,completed_at=?,
      lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND lease_token=? AND status='working'`)
      .run(input.status, input.message, input.status === 'completed' ? input.now : null,
        input.now, input.jobId, input.leaseToken).changes === 1;
  }

  public finalManuscript(ownerId: string, bookId: string, manuscriptVersionId: string): V7ManuscriptVersionRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_manuscript_versions
      WHERE owner_id=? AND book_id=? AND manuscript_version_id=? AND lifecycle='final'`)
      .get(ownerId, bookId, manuscriptVersionId) as V7ManuscriptVersionRow | undefined;
  }

  public saveSettlementAndEvents(input: {
    settlementId: string; ownerId: string; bookId: string; workflowId: string; manuscriptVersionId: string;
    manuscriptHash: string; settlement: V7ChapterSettlement; settlementHash: string; evidenceRefs: string[];
    memberKey: string; requestId: string; events: Array<{
      eventId: string; eventKind: Exclude<V7FormalizationEventRow['event_kind'],'settle_chapter'>;
      payload?: Record<string, unknown>;
    }>;
    now: string;
  }): V7ChapterSettlementRow {
    const existing = this.settlement(input.ownerId, input.bookId, input.manuscriptVersionId);
    if (existing !== undefined) return existing;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`INSERT INTO v7_chapter_settlements(
        settlement_id,owner_id,book_id,workflow_id,manuscript_version_id,manuscript_hash,settlement_json,
        settlement_hash,evidence_refs_json,member_key,request_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.settlementId, input.ownerId, input.bookId, input.workflowId, input.manuscriptVersionId,
        input.manuscriptHash, JSON.stringify(input.settlement), input.settlementHash, JSON.stringify(input.evidenceRefs),
        input.memberKey, input.requestId, input.now
      );
      for (const event of input.events) {
        this.database.prepare(`INSERT INTO v7_formalization_outbox(
          event_id,owner_id,book_id,workflow_id,source_kind,source_id,event_kind,payload_json,status,attempt_count,
          lease_token,lease_expires_at,error_message,created_at,updated_at,completed_at
        ) VALUES(?,?,?,?, 'chapter_settlement',?,?,?,'pending',0,NULL,NULL,NULL,?,?,NULL)`).run(
          event.eventId, input.ownerId, input.bookId, input.workflowId, input.settlementId, event.eventKind,
          JSON.stringify({ settlementId: input.settlementId, manuscriptVersionId: input.manuscriptVersionId, ...(event.payload ?? {}) }), input.now, input.now
        );
      }
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return this.settlement(input.ownerId, input.bookId, input.manuscriptVersionId)!;
  }

  public pendingEvents(limit: number): V7FormalizationEventRow[] {
    return this.database.prepare(`SELECT * FROM v7_formalization_outbox WHERE status IN ('pending','failed')
      AND attempt_count < 5 ORDER BY created_at,event_id LIMIT ?`).all(limit) as unknown as V7FormalizationEventRow[];
  }

  /** 作者明确继续托管时，只重开已知失败的写后任务；未知结果永远不自动重试。 */
  public retryFailedEvents(ownerId: string, bookId: string, workflowId: string, now: string): number {
    const result = this.database.prepare(`UPDATE v7_formalization_outbox
      SET status='pending',attempt_count=0,lease_token=NULL,lease_expires_at=NULL,error_message=NULL,completed_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND workflow_id=? AND status='failed'`)
      .run(now, ownerId, bookId, workflowId);
    return Number(result.changes);
  }

  public eventsForWorkflow(ownerId: string, bookId: string, workflowId: string): V7FormalizationEventRow[] {
    return this.database.prepare(`SELECT * FROM v7_formalization_outbox
      WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY created_at,event_id`)
      .all(ownerId, bookId, workflowId) as unknown as V7FormalizationEventRow[];
  }

  public event(ownerId: string, bookId: string, eventId: string): V7FormalizationEventRow | undefined {
    return this.database.prepare('SELECT * FROM v7_formalization_outbox WHERE owner_id=? AND book_id=? AND event_id=?')
      .get(ownerId, bookId, eventId) as V7FormalizationEventRow | undefined;
  }

  public leaseEvent(input: { eventId: string; leaseToken: string; expiresAt: string; now: string }): boolean {
    const result = this.database.prepare(`UPDATE v7_formalization_outbox SET status='working',lease_token=?,lease_expires_at=?,
      attempt_count=attempt_count+1,error_message=NULL,updated_at=?
      WHERE event_id=? AND (status IN ('pending','failed') OR (status='working' AND lease_expires_at<?))`)
      .run(input.leaseToken, input.expiresAt, input.now, input.eventId, input.now);
    return result.changes === 1;
  }

  public finishEvent(input: { eventId: string; leaseToken: string; status: 'completed' | 'failed' | 'unknown'; message: string | null; now: string }): boolean {
    const result = this.database.prepare(`UPDATE v7_formalization_outbox SET status=?,error_message=?,completed_at=?,
      lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE event_id=? AND lease_token=? AND status='working'`).run(
      input.status, input.message, input.status === 'completed' ? input.now : null,
      input.now, input.eventId, input.leaseToken
    );
    return result.changes === 1;
  }

  public deferEvent(eventId: string, leaseToken: string, now: string): boolean {
    const result = this.database.prepare(`UPDATE v7_formalization_outbox
      SET status='pending',attempt_count=MAX(0,attempt_count-1),error_message=NULL,
        lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE event_id=? AND lease_token=? AND status='working'`)
      .run(now, eventId, leaseToken);
    return result.changes === 1;
  }

  public applyStoryState(input: {
    ownerId: string; bookId: string; settlementId: string;
    items: Array<{ itemId: string; stateVersionId: string; kind: 'story_line' | 'foreshadowing' | 'open_question'; stableKey: string; title: string; state: string; content: unknown; contentHash: string; evidenceRefs: string[] }>;
    now: string;
  }): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const item of input.items) {
        const existing = this.database.prepare(`SELECT item_id FROM v7_story_state_items
          WHERE owner_id=? AND book_id=? AND item_kind=? AND stable_key=?`)
          .get(input.ownerId, input.bookId, item.kind, item.stableKey) as { item_id: string } | undefined;
        const itemId = existing?.item_id ?? item.itemId;
        if (existing === undefined) {
          this.database.prepare(`INSERT INTO v7_story_state_items(
            item_id,owner_id,book_id,item_kind,stable_key,title,state,active_version_id,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,NULL,?,?)`).run(
            itemId, input.ownerId, input.bookId, item.kind, item.stableKey, item.title, item.state, input.now, input.now
          );
        }
        const prior = this.database.prepare(`SELECT COALESCE(MAX(revision),0) AS revision FROM v7_story_state_versions
          WHERE owner_id=? AND book_id=? AND item_id=?`).get(input.ownerId, input.bookId, itemId) as { revision: number };
        const duplicate = this.database.prepare(`SELECT state_version_id FROM v7_story_state_versions
          WHERE owner_id=? AND book_id=? AND item_id=? AND source_settlement_id=?`)
          .get(input.ownerId, input.bookId, itemId, input.settlementId);
        if (duplicate !== undefined) continue;
        this.database.prepare(`INSERT INTO v7_story_state_versions(
          state_version_id,owner_id,book_id,item_id,revision,content_json,content_hash,source_settlement_id,evidence_refs_json,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
          item.stateVersionId, input.ownerId, input.bookId, itemId, prior.revision + 1, JSON.stringify(item.content),
          item.contentHash, input.settlementId, JSON.stringify(item.evidenceRefs), input.now
        );
        this.database.prepare(`UPDATE v7_story_state_items SET title=?,state=?,active_version_id=?,updated_at=?
          WHERE owner_id=? AND book_id=? AND item_id=?`).run(
          item.title, item.state, item.stateVersionId, input.now, input.ownerId, input.bookId, itemId
        );
      }
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  public storyState(ownerId: string, bookId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT i.item_kind,i.stable_key,i.title,i.state,v.revision,v.content_json,
      v.evidence_refs_json,v.source_settlement_id,v.created_at
      FROM v7_story_state_items i JOIN v7_story_state_versions v ON v.state_version_id=i.active_version_id
      WHERE i.owner_id=? AND i.book_id=? ORDER BY i.item_kind,i.updated_at DESC`)
      .all(ownerId, bookId) as Array<Record<string, unknown>>;
  }

  public modelCall(requestId: string): V7CreationModelCallRow | undefined {
    return this.database.prepare('SELECT * FROM v7_creation_model_calls WHERE request_id=?').get(requestId) as unknown as V7CreationModelCallRow | undefined;
  }

  public modelCallsForWorkflow(ownerId: string, bookId: string, workflowId: string): V7CreationModelCallRow[] {
    return this.database.prepare(`SELECT * FROM v7_creation_model_calls
      WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY started_at,request_id`).all(
      ownerId, bookId, workflowId
    ) as unknown as V7CreationModelCallRow[];
  }

  public maintenanceActorCalls(ownerId: string, bookId: string, workflowId: string): V7CreationActorCallRow[] {
    return this.database.prepare(`
      SELECT r.assigned_member_key AS member_key,
        CASE WHEN r.status IN ('pending','queued') THEN 'working' ELSE r.status END AS state,
        r.maintenance_run_id AS node_key,r.updated_at AS started_at,'settlement' AS run_kind
      FROM v7_character_maintenance_runs r
      JOIN v7_chapter_settlements s ON s.owner_id=r.owner_id AND s.book_id=r.book_id AND s.settlement_id=r.source_version_id
      WHERE r.owner_id=? AND r.book_id=? AND s.workflow_id=?
      UNION ALL
      SELECT r.assigned_member_key AS member_key,
        CASE WHEN r.status IN ('pending','queued') THEN 'working' ELSE r.status END AS state,
        r.maintenance_run_id AS node_key,r.updated_at AS started_at,'settlement' AS run_kind
      FROM v7_planning_maintenance_runs r
      JOIN v7_chapter_settlements s ON s.owner_id=r.owner_id AND s.book_id=r.book_id AND s.settlement_id=r.source_version_id
      WHERE r.owner_id=? AND r.book_id=? AND s.workflow_id=?
      ORDER BY started_at`)
      .all(ownerId, bookId, workflowId, ownerId, bookId, workflowId) as unknown as V7CreationActorCallRow[];
  }

  public beginModelCall(input: {
    requestId: string; ownerId: string; bookId: string; workflowId: string;
    runKind: V7CreationModelCallRow['run_kind']; nodeKey: string; memberKey: string;
    provider: string; modelId: string; plan: 'coding' | 'agent'; purpose: V7CreationModelCallRow['purpose'];
    promptHash: string; reservedTokens: number; governanceRevision: number; temperature: number; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_creation_model_calls(
      request_id,owner_id,book_id,workflow_id,run_kind,node_key,member_key,provider,model_id,plan,purpose,state,
      prompt_hash,reserved_tokens,governance_revision,temperature,input_tokens,output_tokens,cash_micros,output_text,failure_message,started_at,completed_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'working',?,?,?,?,NULL,NULL,NULL,NULL,NULL,?,NULL,?)`).run(
      input.requestId, input.ownerId, input.bookId, input.workflowId, input.runKind, input.nodeKey,
      input.memberKey, input.provider, input.modelId, input.plan, input.purpose,
      input.promptHash, input.reservedTokens, input.governanceRevision, input.temperature, input.now, input.now
    );
  }

  public completeModelCall(input: { requestId: string; inputTokens: number; outputTokens: number; cashMicros: number; outputText: string; now: string }): void {
    this.database.prepare(`UPDATE v7_creation_model_calls SET state='succeeded',input_tokens=?,output_tokens=?,cash_micros=?,
      output_text=?,failure_message=NULL,completed_at=?,updated_at=? WHERE request_id=? AND state='working'`).run(
      input.inputTokens, input.outputTokens, input.cashMicros, input.outputText, input.now, input.now, input.requestId
    );
  }

  public failModelCall(requestId: string, state: 'failed' | 'unknown', message: string, now: string): void {
    this.database.prepare(`UPDATE v7_creation_model_calls SET state=?,failure_message=?,completed_at=?,updated_at=?
      WHERE request_id=? AND state='working'`).run(state, message, now, now, requestId);
  }

  public audit(ownerId: string, bookId: string, workflowId: string): Record<string, unknown> {
    const count = (table: string): number => {
      const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=? AND book_id=? AND workflow_id=?`)
        .get(ownerId, bookId, workflowId) as { count: number };
      return row.count;
    };
    const workflow = this.workflow(ownerId, bookId, workflowId);
    const requestedCandidateCount = (() => {
      if (workflow === undefined) return 1;
      try {
        const value = Number((JSON.parse(workflow.checkpoint_json) as { requestedCandidateCount?: unknown }).requestedCandidateCount);
        return value === 2 || value === 3 ? value : 1;
      } catch {
        return 1;
      }
    })();
    const contextPacks = (this.database.prepare(`SELECT context_pack_id,task_kind,task_id,status,assigned_member_key,
      length(COALESCE(content_json,'')) AS content_characters,error_message,updated_at,content_json
      FROM v7_creation_context_packs WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY created_at`)
      .all(ownerId, bookId, workflowId) as Array<Record<string, unknown>>)
      .map(contextPackAuditSummary);
    const options = this.database.prepare(`SELECT option_id,option_kind,scope_id,seat_key,member_key,created_at
      FROM v7_creation_options WHERE owner_id=? AND book_id=? AND workflow_id=?
      ORDER BY CASE seat_key WHEN 'structure' THEN 1 WHEN 'commercial' THEN 2 ELSE 3 END`)
      .all(ownerId, bookId, workflowId) as unknown[];
    const outlineCandidates = this.database.prepare(`SELECT candidate_id,chain_scope_id,seat_key,lifecycle,member_key,
      review_member_key,reviewed_at,selected_at,created_at FROM v7_chapter_outline_draft_candidates
      WHERE owner_id=? AND book_id=? AND workflow_id=?
      ORDER BY CASE seat_key WHEN 'option_1' THEN 1 WHEN 'option_2' THEN 2 ELSE 3 END,created_at`)
      .all(ownerId, bookId, workflowId) as unknown[];
    const calls = this.database.prepare(`SELECT request_id,run_kind,node_key,member_key,provider,model_id,state,temperature,
      input_tokens,output_tokens,cash_micros,failure_message,started_at,completed_at
      FROM v7_creation_model_calls WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY started_at,request_id`)
      .all(ownerId, bookId, workflowId) as unknown[];
    return {
      workflow,
      requestedCandidateCount,
      contextPacks,
      options,
      outlineCandidates,
      calls,
      counts: {
        contextPacks: count('v7_creation_context_packs'), options: count('v7_creation_options'),
        optionReviews: count('v7_creation_option_reviews'), decisions: count('v7_creation_decisions'),
        outlineDraftCandidates: count('v7_chapter_outline_draft_candidates'),
        outlines: count('v7_chapter_outline_sequences'), manuscripts: count('v7_manuscript_versions'),
        manuscriptReviews: count('v7_manuscript_reviews'), settlements: count('v7_chapter_settlements'),
        modelCalls: count('v7_creation_model_calls'), outbox: count('v7_formalization_outbox'),
        finalizeReceipts: count('v7_manuscript_finalize_receipts'),
        taskControls: count('v7_creation_task_controls')
      }
    };
  }
}

function contextPackAuditSummary(row: Record<string, unknown>): Record<string, unknown> {
  const { content_json: rawContent, ...publicRow } = row;
  if (typeof rawContent !== 'string' || rawContent.trim().length === 0) return publicRow;
  try {
    const pack = JSON.parse(rawContent) as V7CreationContextPack;
    return {
      ...publicRow,
      context_summary: {
        taskPersona: pack.taskPersona,
        taskResponsibilities: pack.taskResponsibilities,
        creativeSpace: pack.creativeSpace,
        methodPlan: {
          mode: pack.methodPlan.mode,
          publicSummary: pack.methodPlan.publicSummary,
          candidateCount: pack.methodPlan.candidates.length,
          candidates: pack.methodPlan.candidates.map((candidate) => ({
            publicExplanation: candidate.publicExplanation,
            responsibilities: candidate.responsibilities,
            caution: candidate.caution
          }))
        },
        selectedSources: pack.selectedSources.map((source) => ({
          sourceKey: source.sourceKey,
          sourceKind: source.sourceKind,
          authority: source.authority,
          label: source.label
        })),
        excludedSources: pack.excludedSources,
        openQuestions: pack.openQuestions,
        characterCount: pack.characterCount,
        budgetChars: pack.budgetChars,
        estimatedTokens: pack.estimatedTokens
      }
    };
  } catch {
    return publicRow;
  }
}

function isFixedCreationRole(roleKey: string): boolean {
  return [
    'context_editor', 'chief_editor', 'planning_writer',
    'lead_writer', 'independent_reviewer', 'settlement_editor'
  ].includes(roleKey);
}
