import type { DatabaseSync } from 'node:sqlite';

export type V7PlanningSnapshotPurpose = 'recipe_design' | 'tree_generation' | 'settlement_maintenance';
export type V7PlanningSnapshotAuthority = 'formal' | 'goal' | 'actual';
export type V7PlanningSnapshotSourceKind = 'opening' | 'setting' | 'author_goal' | 'confirmed_tree' | 'settlement';

export interface V7PlanningSnapshotRow {
  snapshot_id: string;
  owner_id: string;
  book_id: string;
  tree_kind: 'book' | 'volume' | 'chain';
  scope_id: string;
  purpose: V7PlanningSnapshotPurpose;
  source_fingerprint: string;
  compiled_content_json: string;
  excluded_sources_json: string;
  created_at: string;
}

export interface V7PlanningSourceItemRow {
  source_item_id: string;
  snapshot_id: string;
  owner_id: string;
  book_id: string;
  source_kind: V7PlanningSnapshotSourceKind;
  source_id: string;
  source_version: string;
  authority: V7PlanningSnapshotAuthority;
  label: string;
  content_json: string;
  content_hash: string;
  included_reason: string;
  sequence: number;
  created_at: string;
}

export interface SaveV7PlanningSnapshotInput {
  snapshotId: string;
  ownerId: string;
  bookId: string;
  treeKind: V7PlanningSnapshotRow['tree_kind'];
  scopeId: string;
  purpose: V7PlanningSnapshotPurpose;
  sourceFingerprint: string;
  compiledContent: unknown;
  excludedSources: readonly string[];
  createdAt: string;
  items: readonly {
    sourceItemId: string;
    sourceKind: V7PlanningSnapshotSourceKind;
    sourceId: string;
    sourceVersion: string;
    authority: V7PlanningSnapshotAuthority;
    label: string;
    content: unknown;
    contentHash: string;
    includedReason: string;
    sequence: number;
  }[];
}

export interface V7PlanningRecipeRunRow {
  run_id: string;
  owner_id: string;
  book_id: string;
  snapshot_id: string;
  idempotency_key: string;
  request_hash: string;
  status: 'queued' | 'working' | 'awaiting_author' | 'completed' | 'partially_failed' | 'failed' | 'cancelled';
  current_phase: string;
  roster_json: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  error_message: string | null;
  checkpoint_json: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface V7PlanningRecipeProposalRow {
  proposal_id: string;
  owner_id: string;
  book_id: string;
  run_id: string;
  seat_key: 'chief_editor' | 'structure_deputy' | 'commercial_deputy' | 'chief_comparison';
  member_key: string;
  member_snapshot_json: string;
  source_snapshot_id: string;
  proposal_json: string;
  proposal_hash: string;
  source_proposal_ids_json: string;
  request_id: string;
  created_at: string;
}

export interface V7PlanningRecipeVersionRow {
  recipe_version_id: string;
  owner_id: string;
  book_id: string;
  revision: number;
  lifecycle: 'candidate' | 'confirmed' | 'superseded';
  recipe_json: string;
  recipe_hash: string;
  source_snapshot_id: string;
  source_proposal_ids_json: string;
  created_by: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface V7PlanningMethodSearchRow {
  search_id: string;
  owner_id: string;
  book_id: string;
  run_id: string;
  seat_key: 'chief_editor' | 'structure_deputy' | 'commercial_deputy';
  member_key: string;
  member_snapshot_json: string;
  source_snapshot_id: string;
  search_request_json: string;
  candidate_methods_json: string;
  search_hash: string;
  retrieval_version: string;
  request_id: string;
  created_at: string;
}

export interface V7PlanningRouteCandidateRow {
  route_id: string;
  owner_id: string;
  book_id: string;
  run_id: string;
  recipe_proposal_id: string;
  method_search_id: string;
  member_key: string;
  member_snapshot_json: string;
  route_json: string;
  route_hash: string;
  request_id: string;
  created_at: string;
}

export interface V7PlanningRouteReviewRow {
  review_id: string;
  owner_id: string;
  book_id: string;
  run_id: string;
  member_key: string;
  member_snapshot_json: string;
  route_ids_json: string;
  review_json: string;
  review_hash: string;
  request_id: string;
  created_at: string;
}

export interface V7PlanningRouteVersionRow {
  route_version_id: string;
  owner_id: string;
  book_id: string;
  revision: number;
  lifecycle: 'candidate' | 'confirmed' | 'superseded';
  route_json: string;
  route_hash: string;
  recipe_version_id: string;
  source_snapshot_id: string;
  source_route_ids_json: string;
  created_by: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface V7PlanningRouteDecisionRow {
  decision_id: string;
  owner_id: string;
  book_id: string;
  run_id: string;
  route_version_id: string;
  recipe_version_id: string;
  idempotency_key: string;
  decision_kind: 'select' | 'adjust' | 'merge';
  source_route_ids_json: string;
  author_note: string;
  created_at: string;
}

export interface V7PlanningGenerationRunRow {
  generation_run_id: string;
  owner_id: string;
  book_id: string;
  tree_kind: 'book' | 'volume' | 'chain';
  scope_id: string;
  recipe_version_id: string;
  source_snapshot_id: string;
  parent_tree_version_id: string | null;
  assigned_member_key: string;
  member_snapshot_json: string;
  idempotency_key: string;
  request_hash: string;
  route_version_id: string | null;
  status: 'queued' | 'working' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  request_id: string | null;
  candidate_tree_version_id: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export type V7PlanningRecipeTaskRow = V7PlanningRecipeRunRow & { book_title: string; model_calls: number };
export type V7PlanningGenerationTaskRow = V7PlanningGenerationRunRow & {
  book_title: string;
  model_calls: number;
  result_lifecycle: 'candidate' | 'confirmed' | 'superseded' | null;
};

export interface V7PlanningModelCallRow {
  request_id: string;
  owner_id: string;
  book_id: string;
  run_id: string;
  run_kind: 'recipe' | 'tree' | 'maintenance';
  node_key: string;
  member_key: string;
  provider: string;
  model_id: string;
  plan: 'coding' | 'agent';
  state: 'working' | 'succeeded' | 'failed' | 'unknown';
  output_text: string | null;
  failure_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  started_at: string;
}

export interface V7PlanningMaintenanceRunRow {
  maintenance_run_id: string;
  owner_id: string;
  book_id: string;
  source_kind: 'chapter_settlement' | 'event_settlement' | 'volume_settlement';
  source_version_id: string;
  source_hash: string;
  source_snapshot_json: string;
  confirmed_tree_refs_json: string;
  assigned_member_key: string;
  member_snapshot_json: string;
  status: 'queued' | 'working' | 'succeeded' | 'failed' | 'unknown';
  request_id: string | null;
  result_json: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface V7PlanningAdjustmentSuggestionRow {
  suggestion_id: string;
  owner_id: string;
  book_id: string;
  tree_kind: 'book' | 'volume' | 'chain';
  scope_id: string;
  node_key: string;
  source_kind: V7PlanningMaintenanceRunRow['source_kind'];
  source_version_id: string;
  state: 'pending' | 'accepted' | 'dismissed' | 'superseded';
  public_summary: string;
  suggestion_json: string;
  created_at: string;
  decided_at: string | null;
}

export class V7PlanningRuntimeRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public formalOpening(ownerId: string, bookId: string): Record<string, unknown> | undefined {
    return this.database.prepare(`SELECT o.opening_blueprint_id,o.version,o.blueprint_json,o.content_hash,b.title
      FROM books b JOIN book_opening_blueprints o ON o.owner_id=b.owner_id AND o.book_id=b.book_id
      WHERE b.owner_id=? AND b.book_id=? AND b.status='active' AND o.status='active'`)
      .get(ownerId, bookId) as Record<string, unknown> | undefined;
  }

  public confirmedSettings(ownerId: string, bookId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT i.item_key,i.item_label,v.version_id,v.revision,v.content_json
      FROM v7_setting_items i JOIN v7_setting_item_versions v
        ON v.version_id=i.active_version_id AND v.owner_id=i.owner_id AND v.book_id=i.book_id
      WHERE i.owner_id=? AND i.book_id=? AND i.state='confirmed' AND v.status='confirmed'
      ORDER BY i.group_title,i.item_label,i.item_key`)
      .all(ownerId, bookId) as Array<Record<string, unknown>>;
  }

  public confirmedTree(
    ownerId: string,
    bookId: string,
    treeKind: 'book' | 'volume' | 'chain',
    scopeId: string
  ): Record<string, unknown> | undefined {
    return this.database.prepare(`SELECT v.tree_version_id,v.tree_kind,v.scope_id,v.revision,v.content_json,v.content_hash
      FROM v7_planning_tree_heads h JOIN v7_planning_tree_versions v
        ON v.tree_version_id=h.confirmed_version_id AND v.owner_id=h.owner_id AND v.book_id=h.book_id
      WHERE h.owner_id=? AND h.book_id=? AND h.tree_kind=? AND h.scope_id=?`)
      .get(ownerId, bookId, treeKind, scopeId) as Record<string, unknown> | undefined;
  }

  public confirmedTrees(
    ownerId: string,
    bookId: string,
    treeKind?: 'book' | 'volume' | 'chain'
  ): Array<Record<string, unknown>> {
    const select = `SELECT h.tree_kind,h.scope_id,v.tree_version_id,v.revision,v.content_hash,v.content_json,v.confirmed_at
      FROM v7_planning_tree_heads h JOIN v7_planning_tree_versions v
        ON v.owner_id=h.owner_id AND v.book_id=h.book_id AND v.tree_version_id=h.confirmed_version_id`;
    if (treeKind === undefined) {
      return this.database.prepare(`${select}
        WHERE h.owner_id=? AND h.book_id=? ORDER BY h.tree_kind,h.scope_id`)
        .all(ownerId, bookId) as Array<Record<string, unknown>>;
    }
    return this.database.prepare(`${select}
      WHERE h.owner_id=? AND h.book_id=? AND h.tree_kind=?
      ORDER BY v.confirmed_at DESC,v.revision DESC`)
      .all(ownerId, bookId, treeKind) as Array<Record<string, unknown>>;
  }

  public latestNodeActuals(
    ownerId: string,
    bookId: string,
    treeKind: 'book' | 'volume' | 'chain',
    scopeId: string
  ): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT a.* FROM v7_planning_node_actuals a
      WHERE a.owner_id=? AND a.book_id=? AND a.tree_kind=? AND a.scope_id=?
        AND a.revision=(SELECT MAX(b.revision) FROM v7_planning_node_actuals b
          WHERE b.owner_id=a.owner_id AND b.book_id=a.book_id AND b.tree_kind=a.tree_kind
            AND b.scope_id=a.scope_id AND b.node_key=a.node_key)
      ORDER BY a.node_key`).all(ownerId, bookId, treeKind, scopeId) as Array<Record<string, unknown>>;
  }

  public activeSettlement(
    ownerId: string,
    bookId: string,
    settlementId: string,
    stageType: 'chapter' | 'story_arc' | 'volume'
  ): Record<string, unknown> | undefined {
    return this.database.prepare(`SELECT * FROM stage_settlements
      WHERE owner_id=? AND book_id=? AND stage_settlement_id=? AND stage_type=? AND status='active'`)
      .get(ownerId, bookId, settlementId, stageType) as Record<string, unknown> | undefined;
  }

  public settlementSources(ownerId: string, bookId: string, settlementId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT source_type,source_id,source_hash,source_locator_json
      FROM stage_settlement_sources WHERE owner_id=? AND book_id=? AND stage_settlement_id=? ORDER BY source_type,source_id`)
      .all(ownerId, bookId, settlementId) as Array<Record<string, unknown>>;
  }

  public snapshotByFingerprint(input: {
    ownerId: string;
    bookId: string;
    treeKind: V7PlanningSnapshotRow['tree_kind'];
    scopeId: string;
    purpose: V7PlanningSnapshotPurpose;
    sourceFingerprint: string;
  }): V7PlanningSnapshotRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_source_snapshots
      WHERE owner_id=? AND book_id=? AND tree_kind=? AND scope_id=? AND purpose=? AND source_fingerprint=?`)
      .get(input.ownerId, input.bookId, input.treeKind, input.scopeId, input.purpose, input.sourceFingerprint) as V7PlanningSnapshotRow | undefined;
  }

  public snapshot(ownerId: string, bookId: string, snapshotId: string): V7PlanningSnapshotRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_source_snapshots
      WHERE owner_id=? AND book_id=? AND snapshot_id=?`)
      .get(ownerId, bookId, snapshotId) as V7PlanningSnapshotRow | undefined;
  }

  public snapshotItems(ownerId: string, bookId: string, snapshotId: string): V7PlanningSourceItemRow[] {
    return this.database.prepare(`SELECT * FROM v7_planning_source_items
      WHERE owner_id=? AND book_id=? AND snapshot_id=? ORDER BY sequence`)
      .all(ownerId, bookId, snapshotId) as unknown as V7PlanningSourceItemRow[];
  }

  public saveSnapshot(input: SaveV7PlanningSnapshotInput): V7PlanningSnapshotRow {
    const existing = this.snapshotByFingerprint(input);
    if (existing !== undefined) return existing;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const repeated = this.snapshotByFingerprint(input);
      if (repeated !== undefined) {
        this.database.exec('COMMIT');
        return repeated;
      }
      this.database.prepare(`INSERT INTO v7_planning_source_snapshots
        (snapshot_id,owner_id,book_id,tree_kind,scope_id,purpose,source_fingerprint,
         compiled_content_json,excluded_sources_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        input.snapshotId, input.ownerId, input.bookId, input.treeKind, input.scopeId, input.purpose,
        input.sourceFingerprint, JSON.stringify(input.compiledContent), JSON.stringify(input.excludedSources), input.createdAt
      );
      const insert = this.database.prepare(`INSERT INTO v7_planning_source_items
        (source_item_id,snapshot_id,owner_id,book_id,source_kind,source_id,source_version,authority,
         label,content_json,content_hash,included_reason,sequence,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of input.items) {
        insert.run(
          item.sourceItemId, input.snapshotId, input.ownerId, input.bookId, item.sourceKind,
          item.sourceId, item.sourceVersion, item.authority, item.label, JSON.stringify(item.content),
          item.contentHash, item.includedReason, item.sequence, input.createdAt
        );
      }
      this.database.exec('COMMIT');
      const saved = this.snapshot(input.ownerId, input.bookId, input.snapshotId);
      if (saved === undefined) throw new Error('规划资料快照保存后无法读取');
      return saved;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public recipeRunByKey(ownerId: string, bookId: string, idempotencyKey: string): V7PlanningRecipeRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_recipe_runs
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`).get(ownerId, bookId, idempotencyKey) as V7PlanningRecipeRunRow | undefined;
  }

  public recipeRun(ownerId: string, bookId: string, runId: string): V7PlanningRecipeRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_recipe_runs
      WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, runId) as V7PlanningRecipeRunRow | undefined;
  }

  public latestPlanningRouteRun(ownerId: string, bookId: string): V7PlanningRecipeRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_recipe_runs
      WHERE owner_id=? AND book_id=? AND (roster_json LIKE '%"routeWriters"%' OR roster_json LIKE '%"three-chief-direct-v1"%')
      ORDER BY created_at DESC,run_id DESC LIMIT 1`)
      .get(ownerId, bookId) as V7PlanningRecipeRunRow | undefined;
  }

  public planningRouteTasks(ownerId: string, limit: number): V7PlanningRecipeTaskRow[] {
    return this.database.prepare(`SELECT r.*,b.title AS book_title,
        (SELECT COUNT(*) FROM v7_planning_model_calls c
          WHERE c.owner_id=r.owner_id AND c.book_id=r.book_id AND c.run_id=r.run_id) AS model_calls
      FROM v7_planning_recipe_runs r JOIN books b ON b.owner_id=r.owner_id AND b.book_id=r.book_id
      WHERE r.owner_id=? AND (r.roster_json LIKE '%"routeWriters"%' OR r.roster_json LIKE '%"three-chief-direct-v1"%')
      ORDER BY r.updated_at DESC,r.run_id DESC LIMIT ?`)
      .all(ownerId, limit) as unknown as V7PlanningRecipeTaskRow[];
  }

  public adminPlanningRouteTasks(limit: number): V7PlanningRecipeTaskRow[] {
    return this.database.prepare(`SELECT r.*,b.title AS book_title,
        (SELECT COUNT(*) FROM v7_planning_model_calls c
          WHERE c.owner_id=r.owner_id AND c.book_id=r.book_id AND c.run_id=r.run_id) AS model_calls
      FROM v7_planning_recipe_runs r JOIN books b ON b.owner_id=r.owner_id AND b.book_id=r.book_id
      WHERE r.roster_json LIKE '%"routeWriters"%' OR r.roster_json LIKE '%"three-chief-direct-v1"%'
      ORDER BY r.updated_at DESC,r.run_id DESC LIMIT ?`)
      .all(limit) as unknown as V7PlanningRecipeTaskRow[];
  }

  public cancelRecipeRun(ownerId: string, bookId: string, runId: string, now: string): V7PlanningRecipeRunRow {
    const current = this.recipeRun(ownerId, bookId, runId);
    if (current === undefined) throw new Error('规划任务不存在');
    if (['queued', 'working', 'partially_failed'].includes(current.status)) {
      this.database.prepare(`UPDATE v7_planning_recipe_runs
        SET status='cancelled',current_phase='cancelled',error_message=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
        WHERE owner_id=? AND book_id=? AND run_id=? AND status IN ('queued','working','partially_failed')`)
        .run('任务已停止，已经完成的方案仍然保留。', now, ownerId, bookId, runId);
    }
    return this.recipeRun(ownerId, bookId, runId) ?? current;
  }

  public createRecipeRun(input: {
    runId: string; ownerId: string; bookId: string; snapshotId: string; idempotencyKey: string;
    requestHash: string; roster: unknown; now: string;
  }): V7PlanningRecipeRunRow {
    const existing = this.recipeRunByKey(input.ownerId, input.bookId, input.idempotencyKey);
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_planning_recipe_runs
      (run_id,owner_id,book_id,snapshot_id,idempotency_key,request_hash,status,current_phase,
       roster_json,checkpoint_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'queued','independent_proposals',?,'{}',?,?)`).run(
      input.runId, input.ownerId, input.bookId, input.snapshotId, input.idempotencyKey,
      input.requestHash, JSON.stringify(input.roster), input.now, input.now
    );
    const saved = this.recipeRun(input.ownerId, input.bookId, input.runId);
    if (saved === undefined) throw new Error('规划配方任务保存后无法读取');
    return saved;
  }

  public markRecipeRun(input: {
    ownerId: string; bookId: string; runId: string; status: V7PlanningRecipeRunRow['status'];
    phase: string; checkpoint?: unknown; errorMessage?: string | null; now: string;
  }): void {
    const result = this.database.prepare(`UPDATE v7_planning_recipe_runs SET status=?,current_phase=?,
      checkpoint_json=?,error_message=?,updated_at=? WHERE owner_id=? AND book_id=? AND run_id=?`)
      .run(input.status, input.phase, JSON.stringify(input.checkpoint ?? {}), input.errorMessage ?? null,
        input.now, input.ownerId, input.bookId, input.runId);
    if (result.changes !== 1) throw new Error('规划配方任务状态更新失败');
  }

  public retryRecipeRun(
    ownerId: string,
    bookId: string,
    runId: string,
    now: string
  ): V7PlanningRecipeRunRow | undefined {
    const result = this.database.prepare(`UPDATE v7_planning_recipe_runs
      SET status='queued',current_phase='route_design',retry_count=retry_count+1,
        error_message=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND run_id=?
        AND status IN ('failed','partially_failed','awaiting_author')`)
      .run(now, ownerId, bookId, runId);
    if (result.changes !== 1) return undefined;
    return this.recipeRun(ownerId, bookId, runId);
  }

  public recipeProposals(ownerId: string, bookId: string, runId: string): V7PlanningRecipeProposalRow[] {
    return this.database.prepare(`SELECT * FROM v7_planning_recipe_proposals
      WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at,proposal_id`)
      .all(ownerId, bookId, runId) as unknown as V7PlanningRecipeProposalRow[];
  }

  public saveRecipeProposal(input: {
    proposalId: string; ownerId: string; bookId: string; runId: string;
    seatKey: V7PlanningRecipeProposalRow['seat_key']; memberKey: string; memberSnapshot: unknown;
    sourceSnapshotId: string; proposal: unknown; proposalHash: string; sourceProposalIds: readonly string[];
    requestId: string; now: string;
  }): V7PlanningRecipeProposalRow {
    const existing = this.database.prepare(`SELECT * FROM v7_planning_recipe_proposals
      WHERE owner_id=? AND book_id=? AND request_id=?`).get(input.ownerId, input.bookId, input.requestId) as V7PlanningRecipeProposalRow | undefined;
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_planning_recipe_proposals
      (proposal_id,owner_id,book_id,run_id,seat_key,member_key,member_snapshot_json,source_snapshot_id,
       proposal_json,proposal_hash,source_proposal_ids_json,request_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.proposalId, input.ownerId, input.bookId, input.runId, input.seatKey, input.memberKey,
      JSON.stringify(input.memberSnapshot), input.sourceSnapshotId, JSON.stringify(input.proposal), input.proposalHash,
      JSON.stringify(input.sourceProposalIds), input.requestId, input.now
    );
    const saved = this.database.prepare(`SELECT * FROM v7_planning_recipe_proposals
      WHERE owner_id=? AND book_id=? AND proposal_id=?`).get(input.ownerId, input.bookId, input.proposalId) as V7PlanningRecipeProposalRow | undefined;
    if (saved === undefined) throw new Error('规划配方提案保存后无法读取');
    return saved;
  }

  public methodSearches(ownerId: string, bookId: string, runId: string): V7PlanningMethodSearchRow[] {
    return this.database.prepare(`SELECT * FROM v7_planning_method_searches
      WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at,search_id`)
      .all(ownerId, bookId, runId) as unknown as V7PlanningMethodSearchRow[];
  }

  public methodSearchBySeat(
    ownerId: string,
    bookId: string,
    runId: string,
    seatKey: V7PlanningMethodSearchRow['seat_key']
  ): V7PlanningMethodSearchRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_method_searches
      WHERE owner_id=? AND book_id=? AND run_id=? AND seat_key=?`)
      .get(ownerId, bookId, runId, seatKey) as V7PlanningMethodSearchRow | undefined;
  }

  public saveMethodSearch(input: {
    searchId: string; ownerId: string; bookId: string; runId: string;
    seatKey: V7PlanningMethodSearchRow['seat_key']; memberKey: string; memberSnapshot: unknown;
    sourceSnapshotId: string; searchRequest: unknown; candidateMethods: unknown; searchHash: string;
    retrievalVersion: string; requestId: string; now: string;
  }): V7PlanningMethodSearchRow {
    const existing = this.database.prepare(`SELECT * FROM v7_planning_method_searches
      WHERE owner_id=? AND book_id=? AND request_id=?`).get(input.ownerId, input.bookId, input.requestId) as V7PlanningMethodSearchRow | undefined;
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_planning_method_searches
      (search_id,owner_id,book_id,run_id,seat_key,member_key,member_snapshot_json,source_snapshot_id,
       search_request_json,candidate_methods_json,search_hash,retrieval_version,request_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.searchId, input.ownerId, input.bookId, input.runId, input.seatKey, input.memberKey,
      JSON.stringify(input.memberSnapshot), input.sourceSnapshotId, JSON.stringify(input.searchRequest),
      JSON.stringify(input.candidateMethods), input.searchHash, input.retrievalVersion, input.requestId, input.now
    );
    const saved = this.methodSearchBySeat(input.ownerId, input.bookId, input.runId, input.seatKey);
    if (saved === undefined) throw new Error('方法检索保存后无法读取');
    return saved;
  }

  public routeCandidates(ownerId: string, bookId: string, runId: string): V7PlanningRouteCandidateRow[] {
    return this.database.prepare(`SELECT * FROM v7_planning_route_candidates
      WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY created_at,route_id`)
      .all(ownerId, bookId, runId) as unknown as V7PlanningRouteCandidateRow[];
  }

  public routeCandidate(ownerId: string, bookId: string, routeId: string): V7PlanningRouteCandidateRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_route_candidates
      WHERE owner_id=? AND book_id=? AND route_id=?`).get(ownerId, bookId, routeId) as V7PlanningRouteCandidateRow | undefined;
  }

  public saveRouteCandidate(input: {
    routeId: string; ownerId: string; bookId: string; runId: string; recipeProposalId: string;
    methodSearchId: string; memberKey: string; memberSnapshot: unknown; route: unknown;
    routeHash: string; requestId: string; now: string;
  }): V7PlanningRouteCandidateRow {
    const existing = this.database.prepare(`SELECT * FROM v7_planning_route_candidates
      WHERE owner_id=? AND book_id=? AND request_id=?`).get(input.ownerId, input.bookId, input.requestId) as V7PlanningRouteCandidateRow | undefined;
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_planning_route_candidates
      (route_id,owner_id,book_id,run_id,recipe_proposal_id,method_search_id,member_key,
       member_snapshot_json,route_json,route_hash,request_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.routeId, input.ownerId, input.bookId, input.runId, input.recipeProposalId,
      input.methodSearchId, input.memberKey, JSON.stringify(input.memberSnapshot), JSON.stringify(input.route),
      input.routeHash, input.requestId, input.now
    );
    const saved = this.routeCandidate(input.ownerId, input.bookId, input.routeId);
    if (saved === undefined) throw new Error('故事路线保存后无法读取');
    return saved;
  }

  public routeReview(ownerId: string, bookId: string, runId: string): V7PlanningRouteReviewRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_route_reviews
      WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, runId) as V7PlanningRouteReviewRow | undefined;
  }

  public saveRouteReview(input: {
    reviewId: string; ownerId: string; bookId: string; runId: string; memberKey: string;
    memberSnapshot: unknown; routeIds: readonly string[]; review: unknown; reviewHash: string;
    requestId: string; now: string;
  }): V7PlanningRouteReviewRow {
    const existing = this.routeReview(input.ownerId, input.bookId, input.runId);
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_planning_route_reviews
      (review_id,owner_id,book_id,run_id,member_key,member_snapshot_json,route_ids_json,
       review_json,review_hash,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.reviewId, input.ownerId, input.bookId, input.runId, input.memberKey,
      JSON.stringify(input.memberSnapshot), JSON.stringify(input.routeIds), JSON.stringify(input.review),
      input.reviewHash, input.requestId, input.now
    );
    const saved = this.routeReview(input.ownerId, input.bookId, input.runId);
    if (saved === undefined) throw new Error('主编路线点评保存后无法读取');
    return saved;
  }

  public routeVersion(ownerId: string, bookId: string, routeVersionId: string): V7PlanningRouteVersionRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_route_versions
      WHERE owner_id=? AND book_id=? AND route_version_id=?`).get(ownerId, bookId, routeVersionId) as V7PlanningRouteVersionRow | undefined;
  }

  public activeRoute(ownerId: string, bookId: string, lifecycle: 'candidate' | 'confirmed'): V7PlanningRouteVersionRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_route_versions
      WHERE owner_id=? AND book_id=? AND lifecycle=? ORDER BY revision DESC LIMIT 1`)
      .get(ownerId, bookId, lifecycle) as V7PlanningRouteVersionRow | undefined;
  }

  public routeDecisionByKey(ownerId: string, bookId: string, idempotencyKey: string): {
    run_id: string; route_version_id: string; recipe_version_id: string; decision_kind: 'select' | 'adjust' | 'merge';
    source_route_ids_json: string; author_note: string;
  } | undefined {
    return this.database.prepare(`SELECT run_id,route_version_id,recipe_version_id,decision_kind,
      source_route_ids_json,author_note FROM v7_planning_route_decisions
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`).get(ownerId, bookId, idempotencyKey) as {
        run_id: string; route_version_id: string; recipe_version_id: string; decision_kind: 'select' | 'adjust' | 'merge';
        source_route_ids_json: string; author_note: string;
      } | undefined;
  }

  public currentConfirmedRouteDecision(
    ownerId: string,
    bookId: string,
    runId: string
  ): V7PlanningRouteDecisionRow | undefined {
    return this.database.prepare(`SELECT d.* FROM v7_planning_route_decisions d
      JOIN v7_planning_recipe_runs run ON run.owner_id=d.owner_id AND run.book_id=d.book_id AND run.run_id=d.run_id
      JOIN v7_planning_route_versions route ON route.owner_id=d.owner_id AND route.book_id=d.book_id
        AND route.route_version_id=d.route_version_id
      JOIN v7_planning_recipe_versions recipe ON recipe.owner_id=d.owner_id AND recipe.book_id=d.book_id
        AND recipe.recipe_version_id=d.recipe_version_id
      WHERE d.owner_id=? AND d.book_id=? AND d.run_id=?
        AND run.status='completed' AND run.current_phase='route_confirmed'
        AND route.lifecycle='confirmed' AND recipe.lifecycle='confirmed'
        AND route.recipe_version_id=d.recipe_version_id
      ORDER BY d.created_at DESC,d.decision_id DESC LIMIT 1`)
      .get(ownerId, bookId, runId) as V7PlanningRouteDecisionRow | undefined;
  }

  public confirmPlanningRoute(input: {
    decisionId: string; routeVersionId: string; recipeVersionId: string;
    ownerId: string; bookId: string; runId: string; idempotencyKey: string;
    decisionKind: 'select' | 'adjust' | 'merge'; authorNote: string; sourceRouteIds: readonly string[];
    route: unknown; routeHash: string; recipe: unknown; recipeHash: string;
    sourceSnapshotId: string; sourceProposalIds: readonly string[]; createdBy: string; now: string;
  }): { route: V7PlanningRouteVersionRow; recipe: V7PlanningRecipeVersionRow } {
    const prior = this.routeDecisionByKey(input.ownerId, input.bookId, input.idempotencyKey);
    if (prior !== undefined) {
      return {
        route: this.requireRouteVersion(input.ownerId, input.bookId, prior.route_version_id),
        recipe: this.requireRecipeVersion(input.ownerId, input.bookId, prior.recipe_version_id)
      };
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const run = this.recipeRun(input.ownerId, input.bookId, input.runId);
      if (run === undefined || run.status !== 'awaiting_author') throw new Error('三套故事路线还没有全部整理完成');
      this.database.prepare(`UPDATE v7_planning_recipe_versions SET lifecycle='superseded'
        WHERE owner_id=? AND book_id=? AND lifecycle IN ('candidate','confirmed')`).run(input.ownerId, input.bookId);
      this.database.prepare(`UPDATE v7_planning_route_versions SET lifecycle='superseded'
        WHERE owner_id=? AND book_id=? AND lifecycle IN ('candidate','confirmed')`).run(input.ownerId, input.bookId);
      const recipeRevision = Number((this.database.prepare(`SELECT COALESCE(MAX(revision),0)+1 AS revision
        FROM v7_planning_recipe_versions WHERE owner_id=? AND book_id=?`).get(input.ownerId, input.bookId) as { revision: number }).revision);
      const routeRevision = Number((this.database.prepare(`SELECT COALESCE(MAX(revision),0)+1 AS revision
        FROM v7_planning_route_versions WHERE owner_id=? AND book_id=?`).get(input.ownerId, input.bookId) as { revision: number }).revision);
      this.database.prepare(`INSERT INTO v7_planning_recipe_versions
        (recipe_version_id,owner_id,book_id,revision,lifecycle,recipe_json,recipe_hash,source_snapshot_id,
         source_proposal_ids_json,created_by,created_at,confirmed_at)
        VALUES (?,?,?,?,'confirmed',?,?,?,?,?,?,?)`).run(
        input.recipeVersionId, input.ownerId, input.bookId, recipeRevision, JSON.stringify(input.recipe),
        input.recipeHash, input.sourceSnapshotId, JSON.stringify(input.sourceProposalIds), input.createdBy,
        input.now, input.now
      );
      this.database.prepare(`INSERT INTO v7_planning_route_versions
        (route_version_id,owner_id,book_id,revision,lifecycle,route_json,route_hash,recipe_version_id,
         source_snapshot_id,source_route_ids_json,created_by,created_at,confirmed_at)
        VALUES (?,?,?,?,'confirmed',?,?,?,?,?,?,?,?)`).run(
        input.routeVersionId, input.ownerId, input.bookId, routeRevision, JSON.stringify(input.route),
        input.routeHash, input.recipeVersionId, input.sourceSnapshotId, JSON.stringify(input.sourceRouteIds),
        input.createdBy, input.now, input.now
      );
      this.database.prepare(`INSERT INTO v7_planning_route_decisions
        (decision_id,owner_id,book_id,run_id,route_version_id,recipe_version_id,idempotency_key,
         decision_kind,source_route_ids_json,author_note,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.decisionId, input.ownerId, input.bookId, input.runId, input.routeVersionId,
        input.recipeVersionId, input.idempotencyKey, input.decisionKind,
        JSON.stringify(input.sourceRouteIds), input.authorNote, input.now
      );
      this.database.prepare(`UPDATE v7_planning_recipe_runs SET status='completed',current_phase='route_confirmed',
        checkpoint_json=?,updated_at=? WHERE owner_id=? AND book_id=? AND run_id=?`).run(
        JSON.stringify({ routeVersionId: input.routeVersionId, recipeVersionId: input.recipeVersionId }),
        input.now, input.ownerId, input.bookId, input.runId
      );
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return {
      route: this.requireRouteVersion(input.ownerId, input.bookId, input.routeVersionId),
      recipe: this.requireRecipeVersion(input.ownerId, input.bookId, input.recipeVersionId)
    };
  }

  public saveCandidateRecipe(input: {
    recipeVersionId: string; ownerId: string; bookId: string; recipe: unknown; recipeHash: string;
    sourceSnapshotId: string; sourceProposalIds: readonly string[]; createdBy: string; now: string;
  }): V7PlanningRecipeVersionRow {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`UPDATE v7_planning_recipe_versions SET lifecycle='superseded'
        WHERE owner_id=? AND book_id=? AND lifecycle='candidate'`).run(input.ownerId, input.bookId);
      const revision = Number((this.database.prepare(`SELECT COALESCE(MAX(revision),0)+1 AS revision
        FROM v7_planning_recipe_versions WHERE owner_id=? AND book_id=?`).get(input.ownerId, input.bookId) as { revision: number }).revision);
      this.database.prepare(`INSERT INTO v7_planning_recipe_versions
        (recipe_version_id,owner_id,book_id,revision,lifecycle,recipe_json,recipe_hash,source_snapshot_id,
         source_proposal_ids_json,created_by,created_at)
        VALUES (?,?,?,?,'candidate',?,?,?,?,?,?)`).run(
        input.recipeVersionId, input.ownerId, input.bookId, revision, JSON.stringify(input.recipe), input.recipeHash,
        input.sourceSnapshotId, JSON.stringify(input.sourceProposalIds), input.createdBy, input.now
      );
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return this.requireRecipeVersion(input.ownerId, input.bookId, input.recipeVersionId);
  }

  public recipeVersion(ownerId: string, bookId: string, recipeVersionId: string): V7PlanningRecipeVersionRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_recipe_versions
      WHERE owner_id=? AND book_id=? AND recipe_version_id=?`).get(ownerId, bookId, recipeVersionId) as V7PlanningRecipeVersionRow | undefined;
  }

  public activeRecipe(ownerId: string, bookId: string, lifecycle: 'candidate' | 'confirmed'): V7PlanningRecipeVersionRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_recipe_versions
      WHERE owner_id=? AND book_id=? AND lifecycle=? ORDER BY revision DESC LIMIT 1`)
      .get(ownerId, bookId, lifecycle) as V7PlanningRecipeVersionRow | undefined;
  }

  public recipeDecisionByKey(ownerId: string, bookId: string, idempotencyKey: string): {
    run_id: string;
    recipe_version_id: string;
    decision_kind: string;
    author_note: string;
  } | undefined {
    return this.database.prepare(`SELECT run_id,recipe_version_id,decision_kind,author_note
      FROM v7_planning_recipe_decisions
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`)
      .get(ownerId, bookId, idempotencyKey) as {
        run_id: string;
        recipe_version_id: string;
        decision_kind: string;
        author_note: string;
      } | undefined;
  }

  public confirmRecipe(input: {
    ownerId: string; bookId: string; recipeVersionId: string; runId: string; decisionId: string;
    idempotencyKey: string; decisionKind: string; authorNote: string; now: string;
  }): V7PlanningRecipeVersionRow {
    const prior = this.database.prepare(`SELECT recipe_version_id FROM v7_planning_recipe_decisions
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`).get(input.ownerId, input.bookId, input.idempotencyKey) as { recipe_version_id: string } | undefined;
    if (prior !== undefined) return this.requireRecipeVersion(input.ownerId, input.bookId, prior.recipe_version_id);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const candidate = this.requireRecipeVersion(input.ownerId, input.bookId, input.recipeVersionId);
      if (candidate.lifecycle !== 'candidate') throw new Error('只有当前候选配方可以确认');
      this.database.prepare(`UPDATE v7_planning_recipe_versions SET lifecycle='superseded'
        WHERE owner_id=? AND book_id=? AND lifecycle='confirmed'`).run(input.ownerId, input.bookId);
      const updated = this.database.prepare(`UPDATE v7_planning_recipe_versions SET lifecycle='confirmed',confirmed_at=?
        WHERE owner_id=? AND book_id=? AND recipe_version_id=? AND lifecycle='candidate'`)
        .run(input.now, input.ownerId, input.bookId, input.recipeVersionId);
      if (updated.changes !== 1) throw new Error('规划配方确认时版本已经变化');
      this.database.prepare(`INSERT INTO v7_planning_recipe_decisions
        (decision_id,owner_id,book_id,run_id,recipe_version_id,idempotency_key,decision_kind,author_note,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        input.decisionId, input.ownerId, input.bookId, input.runId, input.recipeVersionId,
        input.idempotencyKey, input.decisionKind, input.authorNote, input.now
      );
      this.database.prepare(`UPDATE v7_planning_recipe_runs SET status='completed',current_phase='confirmed',updated_at=?
        WHERE owner_id=? AND book_id=? AND run_id=?`).run(input.now, input.ownerId, input.bookId, input.runId);
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return this.requireRecipeVersion(input.ownerId, input.bookId, input.recipeVersionId);
  }

  public generationByKey(ownerId: string, bookId: string, idempotencyKey: string): V7PlanningGenerationRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_generation_runs
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`).get(ownerId, bookId, idempotencyKey) as V7PlanningGenerationRunRow | undefined;
  }

  public generation(ownerId: string, bookId: string, generationRunId: string): V7PlanningGenerationRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_generation_runs
      WHERE owner_id=? AND book_id=? AND generation_run_id=?`).get(ownerId, bookId, generationRunId) as V7PlanningGenerationRunRow | undefined;
  }

  public latestGeneration(
    ownerId: string,
    bookId: string,
    treeKind: V7PlanningGenerationRunRow['tree_kind'],
    scopeId: string
  ): V7PlanningGenerationRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_generation_runs
      WHERE owner_id=? AND book_id=? AND tree_kind=? AND scope_id=?
      ORDER BY created_at DESC,generation_run_id DESC LIMIT 1`)
      .get(ownerId, bookId, treeKind, scopeId) as V7PlanningGenerationRunRow | undefined;
  }

  public latestBookTreeGenerationForRoute(
    ownerId: string,
    bookId: string,
    routeVersionId: string
  ): V7PlanningGenerationRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_generation_runs
      WHERE owner_id=? AND book_id=? AND tree_kind='book' AND scope_id=? AND route_version_id=?
      ORDER BY created_at DESC,generation_run_id DESC LIMIT 1`)
      .get(ownerId, bookId, bookId, routeVersionId) as V7PlanningGenerationRunRow | undefined;
  }

  public planningGenerationTasks(ownerId: string, limit: number): V7PlanningGenerationTaskRow[] {
    return this.database.prepare(`SELECT r.*,b.title AS book_title,v.lifecycle AS result_lifecycle,
        (SELECT COUNT(*) FROM v7_planning_model_calls c
          WHERE c.owner_id=r.owner_id AND c.book_id=r.book_id AND c.run_id=r.generation_run_id) AS model_calls
      FROM v7_planning_generation_runs r JOIN books b ON b.owner_id=r.owner_id AND b.book_id=r.book_id
      LEFT JOIN v7_planning_tree_versions v ON v.owner_id=r.owner_id AND v.book_id=r.book_id
        AND v.tree_version_id=r.candidate_tree_version_id
      WHERE r.owner_id=? ORDER BY r.updated_at DESC,r.generation_run_id DESC LIMIT ?`)
      .all(ownerId, limit) as unknown as V7PlanningGenerationTaskRow[];
  }

  public adminPlanningGenerationTasks(limit: number): V7PlanningGenerationTaskRow[] {
    return this.database.prepare(`SELECT r.*,b.title AS book_title,v.lifecycle AS result_lifecycle,
        (SELECT COUNT(*) FROM v7_planning_model_calls c
          WHERE c.owner_id=r.owner_id AND c.book_id=r.book_id AND c.run_id=r.generation_run_id) AS model_calls
      FROM v7_planning_generation_runs r JOIN books b ON b.owner_id=r.owner_id AND b.book_id=r.book_id
      LEFT JOIN v7_planning_tree_versions v ON v.owner_id=r.owner_id AND v.book_id=r.book_id
        AND v.tree_version_id=r.candidate_tree_version_id
      ORDER BY r.updated_at DESC,r.generation_run_id DESC LIMIT ?`)
      .all(limit) as unknown as V7PlanningGenerationTaskRow[];
  }

  public cancelGeneration(ownerId: string, bookId: string, generationRunId: string, now: string): V7PlanningGenerationRunRow {
    const current = this.generation(ownerId, bookId, generationRunId);
    if (current === undefined) throw new Error('规划树任务不存在');
    // unknown 也允许停止：结果未知且长时间无人认领时，这是作者唯一的
    // 逃生口（停止后可重新续接，创建当前形状的替代任务）；迟到成功只会
    // 被丢弃，不会产生新的模型消耗。
    if (['queued', 'working', 'unknown'].includes(current.status)) {
      this.database.prepare(`UPDATE v7_planning_generation_runs
        SET status='cancelled',error_message=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND generation_run_id=? AND status IN ('queued','working','unknown')`)
        .run('任务已停止，已经完成的内容仍然保留。', now, ownerId, bookId, generationRunId);
    }
    return this.generation(ownerId, bookId, generationRunId) ?? current;
  }

  public createGeneration(input: {
    generationRunId: string; ownerId: string; bookId: string; treeKind: V7PlanningGenerationRunRow['tree_kind'];
    scopeId: string; recipeVersionId: string; sourceSnapshotId: string; parentTreeVersionId: string | null;
    routeVersionId?: string | null; assignedMemberKey: string; memberSnapshot: unknown;
    idempotencyKey: string; requestHash: string; now: string;
  }): V7PlanningGenerationRunRow {
    const existing = this.generationByKey(input.ownerId, input.bookId, input.idempotencyKey);
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_planning_generation_runs
      (generation_run_id,owner_id,book_id,tree_kind,scope_id,recipe_version_id,source_snapshot_id,
       parent_tree_version_id,assigned_member_key,member_snapshot_json,idempotency_key,status,created_at,updated_at,request_hash,route_version_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?,?)
      ON CONFLICT(owner_id,book_id,idempotency_key) DO NOTHING`).run(
      input.generationRunId, input.ownerId, input.bookId, input.treeKind, input.scopeId,
      input.recipeVersionId, input.sourceSnapshotId, input.parentTreeVersionId, input.assignedMemberKey,
      JSON.stringify(input.memberSnapshot), input.idempotencyKey, input.now, input.now, input.requestHash, input.routeVersionId ?? null
    );
    const saved = this.generationByKey(input.ownerId, input.bookId, input.idempotencyKey);
    if (saved === undefined) throw new Error('规划树生成任务保存后无法读取');
    return saved;
  }

  public markGeneration(input: {
    ownerId: string; bookId: string; generationRunId: string; status: V7PlanningGenerationRunRow['status'];
    requestId?: string | null; candidateTreeVersionId?: string | null; assignedMemberKey?: string;
    memberSnapshot?: unknown; errorMessage?: string | null; now: string;
  }): void {
    const current = this.generation(input.ownerId, input.bookId, input.generationRunId);
    if (current === undefined) throw new Error('规划树生成任务不存在');
    this.database.prepare(`UPDATE v7_planning_generation_runs SET status=?,request_id=?,candidate_tree_version_id=?,
      assigned_member_key=?,member_snapshot_json=?,error_message=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND generation_run_id=?`).run(
      input.status, input.requestId ?? current.request_id, input.candidateTreeVersionId ?? current.candidate_tree_version_id,
      input.assignedMemberKey ?? current.assigned_member_key,
      input.memberSnapshot === undefined ? current.member_snapshot_json : JSON.stringify(input.memberSnapshot),
      input.errorMessage ?? null, input.now, input.ownerId, input.bookId, input.generationRunId
    );
  }

  public markGenerationWorking(input: {
    ownerId: string; bookId: string; generationRunId: string;
    assignedMemberKey: string; memberSnapshot: unknown; now: string;
  }): boolean {
    const memberSnapshotJson = JSON.stringify(input.memberSnapshot);
    const result = this.database.prepare(`UPDATE v7_planning_generation_runs
      SET status='working',assigned_member_key=?,member_snapshot_json=?,error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND generation_run_id=? AND status='queued'`)
      .run(
        input.assignedMemberKey,
        memberSnapshotJson,
        input.now,
        input.ownerId,
        input.bookId,
        input.generationRunId
      );
    return result.changes === 1;
  }

  public retryGeneration(
    ownerId: string,
    bookId: string,
    generationRunId: string,
    now: string
  ): V7PlanningGenerationRunRow | undefined {
    const result = this.database.prepare(`UPDATE v7_planning_generation_runs
      SET status='queued',retry_count=retry_count+1,request_id=NULL,error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND generation_run_id=? AND status='failed'`)
      .run(now, ownerId, bookId, generationRunId);
    if (result.changes !== 1) return undefined;
    return this.generation(ownerId, bookId, generationRunId);
  }

  public maintenanceBySource(
    ownerId: string,
    bookId: string,
    sourceKind: V7PlanningMaintenanceRunRow['source_kind'],
    sourceVersionId: string
  ): V7PlanningMaintenanceRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_maintenance_runs
      WHERE owner_id=? AND book_id=? AND source_kind=? AND source_version_id=?`)
      .get(ownerId, bookId, sourceKind, sourceVersionId) as V7PlanningMaintenanceRunRow | undefined;
  }

  public maintenance(ownerId: string, bookId: string, runId: string): V7PlanningMaintenanceRunRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_maintenance_runs
      WHERE owner_id=? AND book_id=? AND maintenance_run_id=?`)
      .get(ownerId, bookId, runId) as V7PlanningMaintenanceRunRow | undefined;
  }

  public createMaintenance(input: {
    runId: string; ownerId: string; bookId: string; sourceKind: V7PlanningMaintenanceRunRow['source_kind'];
    sourceVersionId: string; sourceHash: string; sourceSnapshot: unknown; confirmedTreeRefs: unknown;
    assignedMemberKey: string; memberSnapshot: unknown; now: string;
  }): V7PlanningMaintenanceRunRow {
    const existing = this.maintenanceBySource(input.ownerId, input.bookId, input.sourceKind, input.sourceVersionId);
    if (existing !== undefined) return existing;
    this.database.prepare(`INSERT INTO v7_planning_maintenance_runs
      (maintenance_run_id,owner_id,book_id,source_kind,source_version_id,source_hash,source_snapshot_json,
       confirmed_tree_refs_json,assigned_member_key,member_snapshot_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'queued',?,?)`).run(
      input.runId, input.ownerId, input.bookId, input.sourceKind, input.sourceVersionId, input.sourceHash,
      JSON.stringify(input.sourceSnapshot), JSON.stringify(input.confirmedTreeRefs), input.assignedMemberKey,
      JSON.stringify(input.memberSnapshot), input.now, input.now
    );
    const saved = this.maintenance(input.ownerId, input.bookId, input.runId);
    if (saved === undefined) throw new Error('规划维护任务保存后无法读取');
    return saved;
  }

  public markMaintenance(input: {
    ownerId: string; bookId: string; runId: string; status: V7PlanningMaintenanceRunRow['status'];
    assignedMemberKey?: string; requestId?: string | null; result?: unknown; errorMessage?: string | null; now: string;
  }): void {
    const current = this.maintenance(input.ownerId, input.bookId, input.runId);
    if (current === undefined) throw new Error('规划维护任务不存在');
    this.database.prepare(`UPDATE v7_planning_maintenance_runs SET status=?,assigned_member_key=?,request_id=?,
      result_json=?,error_message=?,updated_at=? WHERE owner_id=? AND book_id=? AND maintenance_run_id=?`).run(
      input.status, input.assignedMemberKey ?? current.assigned_member_key, input.requestId ?? current.request_id,
      input.result === undefined ? current.result_json : JSON.stringify(input.result), input.errorMessage ?? null, input.now,
      input.ownerId, input.bookId, input.runId
    );
  }

  public resetMaintenanceForRetry(ownerId: string, bookId: string, runId: string, now: string): number {
    return Number(this.database.prepare(`UPDATE v7_planning_maintenance_runs
      SET status='queued',retry_count=retry_count+1,request_id=NULL,error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND maintenance_run_id=? AND status='failed'`).run(
      now, ownerId, bookId, runId
    ).changes);
  }

  public saveAdjustmentSuggestion(input: {
    suggestionId: string; ownerId: string; bookId: string; treeKind: 'book' | 'volume' | 'chain';
    scopeId: string; nodeKey: string; sourceKind: V7PlanningMaintenanceRunRow['source_kind'];
    sourceVersionId: string; publicSummary: string; suggestion: unknown; now: string;
  }): void {
    this.database.prepare(`INSERT OR IGNORE INTO v7_planning_adjustment_suggestions
      (suggestion_id,owner_id,book_id,tree_kind,scope_id,node_key,source_kind,source_version_id,state,
       public_summary,suggestion_json,created_at) VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)`).run(
      input.suggestionId, input.ownerId, input.bookId, input.treeKind, input.scopeId, input.nodeKey,
      input.sourceKind, input.sourceVersionId, input.publicSummary, JSON.stringify(input.suggestion), input.now
    );
  }

  public pendingAdjustmentSuggestions(ownerId: string, bookId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT suggestion_id AS suggestionId,tree_kind AS treeKind,scope_id AS scopeId,
      node_key AS nodeKey,source_kind AS sourceKind,source_version_id AS sourceVersionId,
      public_summary AS publicSummary,suggestion_json AS suggestion,state,created_at AS createdAt
      FROM v7_planning_adjustment_suggestions WHERE owner_id=? AND book_id=? AND state='pending'
      ORDER BY created_at,suggestion_id`).all(ownerId, bookId) as Array<Record<string, unknown>>;
  }

  public acceptedAdjustmentSuggestions(ownerId: string, bookId: string): V7PlanningAdjustmentSuggestionRow[] {
    return this.database.prepare(`SELECT * FROM v7_planning_adjustment_suggestions
      WHERE owner_id=? AND book_id=? AND state='accepted' ORDER BY decided_at,suggestion_id`)
      .all(ownerId, bookId) as unknown as V7PlanningAdjustmentSuggestionRow[];
  }

  public decideAdjustmentSuggestion(input: {
    decisionId: string;
    ownerId: string;
    bookId: string;
    suggestionId: string;
    idempotencyKey: string;
    decision: 'accept' | 'dismiss';
    authorNote: string;
    now: string;
  }): V7PlanningAdjustmentSuggestionRow {
    const prior = this.database.prepare(`SELECT suggestion_id,decision,author_note
      FROM v7_planning_adjustment_decisions WHERE owner_id=? AND book_id=? AND idempotency_key=?`)
      .get(input.ownerId, input.bookId, input.idempotencyKey) as {
        suggestion_id: string; decision: 'accept' | 'dismiss'; author_note: string;
      } | undefined;
    if (prior !== undefined) {
      if (prior.suggestion_id !== input.suggestionId || prior.decision !== input.decision || prior.author_note !== input.authorNote) {
        throw new Error('本次操作编号已经用于另一项规划建议决定');
      }
      return this.requireAdjustmentSuggestion(input.ownerId, input.bookId, input.suggestionId);
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const suggestion = this.requireAdjustmentSuggestion(input.ownerId, input.bookId, input.suggestionId);
      if (suggestion.state !== 'pending') throw new Error('这条规划建议已经处理');
      const updated = this.database.prepare(`UPDATE v7_planning_adjustment_suggestions SET state=?,decided_at=?
        WHERE owner_id=? AND book_id=? AND suggestion_id=? AND state='pending'`).run(
        input.decision === 'accept' ? 'accepted' : 'dismissed', input.now,
        input.ownerId, input.bookId, input.suggestionId
      );
      if (updated.changes !== 1) throw new Error('规划建议状态已经变化');
      this.database.prepare(`INSERT INTO v7_planning_adjustment_decisions
        (decision_id,owner_id,book_id,suggestion_id,idempotency_key,decision,author_note,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        input.decisionId, input.ownerId, input.bookId, input.suggestionId, input.idempotencyKey,
        input.decision, input.authorNote, input.now
      );
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return this.requireAdjustmentSuggestion(input.ownerId, input.bookId, input.suggestionId);
  }

  public modelCall(requestId: string): V7PlanningModelCallRow | undefined {
    return this.database.prepare(`SELECT request_id,owner_id,book_id,run_id,run_kind,node_key,member_key,provider,
      model_id,plan,state,output_text,failure_message,input_tokens,output_tokens,started_at
      FROM v7_planning_model_calls WHERE request_id=?`).get(requestId) as V7PlanningModelCallRow | undefined;
  }

  public modelCallsForRun(ownerId: string, bookId: string, runId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT request_id AS requestId,run_kind AS runKind,node_key AS nodeKey,
      member_key AS memberKey,provider,model_id AS modelId,plan,state,input_tokens AS inputTokens,
      output_tokens AS outputTokens,failure_message AS failureMessage,started_at AS startedAt,completed_at AS completedAt
      FROM v7_planning_model_calls WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY started_at`)
      .all(ownerId, bookId, runId) as Array<Record<string, unknown>>;
  }

  public beginModelCall(input: {
    requestId: string; ownerId: string; bookId: string; runId: string;
    runKind: V7PlanningModelCallRow['run_kind']; nodeKey: string; memberKey: string;
    provider: string; modelId: string; plan: 'coding' | 'agent'; promptHash: string;
    reservedTokens: number; governanceRevision: number; temperature: number; now: string;
  }): boolean {
    const result = this.database.prepare(`INSERT INTO v7_planning_model_calls
      (request_id,owner_id,book_id,run_id,run_kind,node_key,member_key,provider,model_id,plan,state,
       prompt_hash,reserved_tokens,governance_revision,temperature,started_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'working',?,?,?,?,?,?)
      ON CONFLICT(request_id) DO NOTHING`).run(
      input.requestId, input.ownerId, input.bookId, input.runId, input.runKind, input.nodeKey,
      input.memberKey, input.provider, input.modelId, input.plan, input.promptHash,
      input.reservedTokens, input.governanceRevision, input.temperature, input.now, input.now
    );
    return result.changes === 1;
  }

  public completeModelCall(input: {
    requestId: string; inputTokens: number; outputTokens: number; cashMicros: number;
    outputText: string; now: string;
  }): boolean {
    const result = this.database.prepare(`UPDATE v7_planning_model_calls SET state='succeeded',input_tokens=?,
      output_tokens=?,cash_micros=?,output_text=?,failure_message=NULL,completed_at=?,updated_at=?
      WHERE request_id=? AND state IN ('working','unknown')`)
      .run(input.inputTokens, input.outputTokens, input.cashMicros, input.outputText, input.now, input.now, input.requestId);
    return result.changes === 1;
  }

  public failModelCall(requestId: string, state: 'failed' | 'unknown', message: string, now: string): boolean {
    const result = this.database.prepare(`UPDATE v7_planning_model_calls SET state=?,failure_message=?,
      completed_at=CASE WHEN ?='failed' THEN ? ELSE completed_at END,updated_at=?
      WHERE request_id=? AND state='working'`).run(state, message.slice(0, 1000), state, now, now, requestId);
    return result.changes === 1;
  }

  private requireRecipeVersion(ownerId: string, bookId: string, recipeVersionId: string): V7PlanningRecipeVersionRow {
    const row = this.recipeVersion(ownerId, bookId, recipeVersionId);
    if (row === undefined) throw new Error('规划配方版本不存在或不属于本书');
    return row;
  }

  private requireRouteVersion(ownerId: string, bookId: string, routeVersionId: string): V7PlanningRouteVersionRow {
    const row = this.routeVersion(ownerId, bookId, routeVersionId);
    if (row === undefined) throw new Error('故事路线版本不存在或不属于本书');
    return row;
  }

  private requireAdjustmentSuggestion(ownerId: string, bookId: string, suggestionId: string): V7PlanningAdjustmentSuggestionRow {
    const row = this.database.prepare(`SELECT * FROM v7_planning_adjustment_suggestions
      WHERE owner_id=? AND book_id=? AND suggestion_id=?`).get(ownerId, bookId, suggestionId) as V7PlanningAdjustmentSuggestionRow | undefined;
    if (row === undefined) throw new Error('规划建议不存在或不属于本书');
    return row;
  }
}
