import type { DatabaseSync } from 'node:sqlite';

export interface V7CharacterProfileRow {
  profile_id: string;
  owner_id: string;
  book_id: string;
  entity_id: string;
  source_protagonist_profile_id: string | null;
  display_name: string;
  narrative_tier: 'core' | 'important' | 'supporting' | 'cameo' | 'unknown';
  status: 'active' | 'archived';
  active_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface V7CharacterProfileVersionRow {
  profile_version_id: string;
  profile_id: string;
  revision: number;
  lifecycle: 'candidate' | 'active' | 'superseded' | 'archived';
  authority_layer: 'candidate' | 'confirmed_reference' | 'canon_derived';
  content_json: string;
  content_hash: string;
  source_kind: 'opening' | 'setting' | 'owner' | 'canon' | 'import' | 'agent';
  source_id: string | null;
  source_canon_revision: number;
  based_on_version_id: string | null;
  created_by_type: 'owner' | 'agent' | 'system';
  created_by_id: string;
  created_at: string;
  activated_at: string | null;
}

export interface V7CharacterContextPackRow {
  context_pack_id: string;
  owner_id: string;
  book_id: string;
  task_kind: string;
  task_id: string;
  task_brief: string;
  source_canon_revision: number;
  selection_member_key: string;
  member_snapshot_json: string;
  candidate_entity_ids_json: string;
  selected_entity_ids_json: string | null;
  selected_fields_json: string | null;
  selection_reasons_json: string | null;
  open_questions_json: string | null;
  content_json: string | null;
  estimated_tokens: number | null;
  content_hash: string | null;
  idempotency_key: string;
  request_hash: string;
  status: 'queued' | 'working' | 'active' | 'failed' | 'unknown' | 'invalidated';
  retry_count: number;
  request_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  invalidated_at: string | null;
}

export interface V7CharacterMaintenanceRow {
  maintenance_run_id: string;
  owner_id: string;
  book_id: string;
  source_kind: 'chapter_settlement' | 'event_settlement' | 'volume_settlement';
  source_version_id: string;
  source_hash: string;
  source_canon_revision: number;
  source_snapshot_json: string;
  evidence_refs_json: string;
  assigned_member_key: string;
  member_snapshot_json: string;
  status: 'queued' | 'working' | 'awaiting_review' | 'completed' | 'failed' | 'unknown';
  retry_count: number;
  request_id: string | null;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface V7CharacterModelCallRow {
  request_id: string;
  owner_id: string;
  book_id: string;
  run_id: string;
  run_kind: 'context_pack' | 'maintenance';
  member_key: string;
  provider: string;
  model_id: string;
  plan: 'coding' | 'agent';
  state: 'working' | 'succeeded' | 'failed' | 'unknown';
  output_text: string | null;
  failure_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export class V7CharacterMemoryRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public runInTransaction<T>(work: () => T): T {
    if (this.database.isTransaction) return work();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public book(ownerId: string, bookId: string): { canon_revision: number } | undefined {
    return this.database.prepare('SELECT canon_revision FROM books WHERE owner_id=? AND book_id=?')
      .get(ownerId, bookId) as { canon_revision: number } | undefined;
  }

  public characterEntity(ownerId: string, bookId: string, entityId: string): { entity_id: string; canonical_name: string; aliases_json: string } | undefined {
    return this.database.prepare(`SELECT entity_id,canonical_name,aliases_json FROM entities
      WHERE owner_id=? AND book_id=? AND entity_id=? AND entity_type='character' AND status='active'`)
      .get(ownerId, bookId, entityId) as { entity_id: string; canonical_name: string; aliases_json: string } | undefined;
  }

  public characterEntityByName(ownerId: string, bookId: string, name: string): Array<{ entity_id: string }> {
    return this.database.prepare(`SELECT entity_id FROM entities
      WHERE owner_id=? AND book_id=? AND entity_type='character' AND status='active' AND canonical_name=? ORDER BY entity_id`)
      .all(ownerId, bookId, name) as Array<{ entity_id: string }>;
  }

  public unlinkedProtagonists(ownerId: string, bookId: string): Array<{
    protagonist_profile_id: string;
    display_name: string;
    is_primary: number;
  }> {
    return this.database.prepare(`SELECT protagonist_profile_id,display_name,is_primary FROM protagonist_profiles
      WHERE owner_id=? AND book_id=? AND status='active' AND entity_id IS NULL
      ORDER BY is_primary DESC,created_at,protagonist_profile_id`).all(ownerId, bookId) as Array<{
        protagonist_profile_id: string; display_name: string; is_primary: number;
      }>;
  }

  public linkedProtagonists(ownerId: string, bookId: string): Array<{
    protagonist_profile_id: string;
    entity_id: string;
    display_name: string;
    is_primary: number;
  }> {
    return this.database.prepare(`SELECT protagonist_profile_id,entity_id,display_name,is_primary FROM protagonist_profiles
      WHERE owner_id=? AND book_id=? AND status='active' AND entity_id IS NOT NULL
      ORDER BY is_primary DESC,created_at,protagonist_profile_id`).all(ownerId, bookId) as Array<{
        protagonist_profile_id: string; entity_id: string; display_name: string; is_primary: number;
      }>;
  }

  public linkProtagonist(ownerId: string, bookId: string, protagonistProfileId: string, entityId: string, now: string): void {
    this.database.prepare(`UPDATE protagonist_profiles SET entity_id=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND protagonist_profile_id=? AND entity_id IS NULL`)
      .run(entityId, now, ownerId, bookId, protagonistProfileId);
  }

  public allCharacterEntities(ownerId: string, bookId: string): Array<{ entity_id: string; canonical_name: string }> {
    return this.database.prepare(`SELECT entity_id,canonical_name FROM entities
      WHERE owner_id=? AND book_id=? AND entity_type='character' AND status='active' ORDER BY created_at,entity_id`)
      .all(ownerId, bookId) as Array<{ entity_id: string; canonical_name: string }>;
  }

  public allCharacterIdentities(ownerId: string, bookId: string): Array<{
    entity_id: string; canonical_name: string; aliases_json: string;
  }> {
    return this.database.prepare(`SELECT entity_id,canonical_name,aliases_json FROM entities
      WHERE owner_id=? AND book_id=? AND entity_type='character' AND status='active'
      ORDER BY created_at,entity_id`).all(ownerId, bookId) as Array<{
        entity_id: string; canonical_name: string; aliases_json: string;
      }>;
  }

  public updateCharacterAliases(
    ownerId: string,
    bookId: string,
    entityId: string,
    aliasesJson: string,
    now: string
  ): number {
    return Number(this.database.prepare(`UPDATE entities SET aliases_json=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND entity_id=? AND entity_type='character' AND status='active'`).run(
      aliasesJson, now, ownerId, bookId, entityId
    ).changes);
  }

  public profileByEntity(ownerId: string, bookId: string, entityId: string): V7CharacterProfileRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_profiles WHERE owner_id=? AND book_id=? AND entity_id=?`)
      .get(ownerId, bookId, entityId) as V7CharacterProfileRow | undefined;
  }

  public profile(ownerId: string, bookId: string, profileId: string): V7CharacterProfileRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_profiles WHERE owner_id=? AND book_id=? AND profile_id=?`)
      .get(ownerId, bookId, profileId) as V7CharacterProfileRow | undefined;
  }

  public insertProfile(input: {
    profileId: string; ownerId: string; bookId: string; entityId: string; sourceProtagonistProfileId: string | null;
    displayName: string; narrativeTier: V7CharacterProfileRow['narrative_tier']; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_character_profiles
      (profile_id,owner_id,book_id,entity_id,source_protagonist_profile_id,display_name,narrative_tier,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'active',?,?)`).run(
      input.profileId, input.ownerId, input.bookId, input.entityId, input.sourceProtagonistProfileId,
      input.displayName, input.narrativeTier, input.now, input.now
    );
  }

  public updateProfileOrganization(input: {
    ownerId: string; bookId: string; profileId: string; displayName: string;
    narrativeTier: V7CharacterProfileRow['narrative_tier']; status: 'active' | 'archived'; now: string;
  }): number {
    return Number(this.database.prepare(`UPDATE v7_character_profiles
      SET display_name=?,narrative_tier=?,status=?,updated_at=? WHERE owner_id=? AND book_id=? AND profile_id=?`)
      .run(input.displayName, input.narrativeTier, input.status, input.now, input.ownerId, input.bookId, input.profileId).changes);
  }

  public listProfiles(ownerId: string, bookId: string, includeArchived: boolean): V7CharacterProfileRow[] {
    const sql = includeArchived
      ? `SELECT * FROM v7_character_profiles WHERE owner_id=? AND book_id=? ORDER BY status,narrative_tier,display_name,profile_id`
      : `SELECT * FROM v7_character_profiles WHERE owner_id=? AND book_id=? AND status='active' ORDER BY narrative_tier,display_name,profile_id`;
    return this.database.prepare(sql).all(ownerId, bookId) as unknown as V7CharacterProfileRow[];
  }

  public profileVersion(ownerId: string, bookId: string, versionId: string): V7CharacterProfileVersionRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_profile_versions
      WHERE owner_id=? AND book_id=? AND profile_version_id=?`).get(ownerId, bookId, versionId) as V7CharacterProfileVersionRow | undefined;
  }

  public activeProfileVersion(ownerId: string, bookId: string, profileId: string): V7CharacterProfileVersionRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_profile_versions
      WHERE owner_id=? AND book_id=? AND profile_id=? AND lifecycle='active'`)
      .get(ownerId, bookId, profileId) as V7CharacterProfileVersionRow | undefined;
  }

  public profileVersionHistory(ownerId: string, bookId: string, profileId: string): V7CharacterProfileVersionRow[] {
    return this.database.prepare(`SELECT * FROM v7_character_profile_versions
      WHERE owner_id=? AND book_id=? AND profile_id=? ORDER BY revision DESC`)
      .all(ownerId, bookId, profileId) as unknown as V7CharacterProfileVersionRow[];
  }

  public nextProfileRevision(ownerId: string, bookId: string, profileId: string): number {
    const row = this.database.prepare(`SELECT COALESCE(MAX(revision),0) AS revision FROM v7_character_profile_versions
      WHERE owner_id=? AND book_id=? AND profile_id=?`).get(ownerId, bookId, profileId) as { revision: number };
    return row.revision + 1;
  }

  public insertProfileVersion(input: {
    versionId: string; ownerId: string; bookId: string; profileId: string; revision: number;
    lifecycle: V7CharacterProfileVersionRow['lifecycle']; authorityLayer: V7CharacterProfileVersionRow['authority_layer'];
    contentJson: string; contentHash: string; sourceKind: V7CharacterProfileVersionRow['source_kind']; sourceId: string | null;
    sourceCanonRevision: number; basedOnVersionId: string | null; createdByType: V7CharacterProfileVersionRow['created_by_type'];
    createdById: string; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_character_profile_versions
      (profile_version_id,owner_id,book_id,profile_id,revision,lifecycle,authority_layer,content_json,content_hash,
       source_kind,source_id,source_canon_revision,based_on_version_id,created_by_type,created_by_id,created_at,activated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='active' THEN ? ELSE NULL END)`).run(
      input.versionId, input.ownerId, input.bookId, input.profileId, input.revision, input.lifecycle,
      input.authorityLayer, input.contentJson, input.contentHash, input.sourceKind, input.sourceId,
      input.sourceCanonRevision, input.basedOnVersionId, input.createdByType, input.createdById, input.now,
      input.lifecycle, input.now
    );
    if (input.lifecycle === 'active') {
      this.database.prepare(`UPDATE v7_character_profiles SET active_version_id=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND profile_id=?`)
        .run(input.versionId, input.now, input.ownerId, input.bookId, input.profileId);
    }
  }

  public activateProfileVersion(ownerId: string, bookId: string, profileId: string, versionId: string, now: string): void {
    this.database.prepare(`UPDATE v7_character_profile_versions SET lifecycle='superseded'
      WHERE owner_id=? AND book_id=? AND profile_id=? AND lifecycle='active'`).run(ownerId, bookId, profileId);
    const activated = this.database.prepare(`UPDATE v7_character_profile_versions SET lifecycle='active',activated_at=COALESCE(activated_at,?)
      WHERE owner_id=? AND book_id=? AND profile_id=? AND profile_version_id=? AND lifecycle IN ('candidate','superseded')`)
      .run(now, ownerId, bookId, profileId, versionId);
    if (activated.changes !== 1) throw new Error('人物档案版本不存在、越权或状态不能激活');
    this.database.prepare(`UPDATE v7_character_profiles SET active_version_id=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND profile_id=?`).run(versionId, now, ownerId, bookId, profileId);
  }

  public actionByKey(ownerId: string, bookId: string, key: string): {
    action_id: string; profile_id: string; profile_version_id: string | null; request_hash: string; action_kind: string;
  } | undefined {
    return this.database.prepare(`SELECT action_id,profile_id,profile_version_id,request_hash,action_kind
      FROM v7_character_profile_actions WHERE owner_id=? AND book_id=? AND idempotency_key=?`)
      .get(ownerId, bookId, key) as {
        action_id: string; profile_id: string; profile_version_id: string | null; request_hash: string; action_kind: string;
      } | undefined;
  }

  public insertAction(input: {
    actionId: string; ownerId: string; bookId: string; profileId: string; profileVersionId: string | null;
    actionKind: string; idempotencyKey: string; requestHash: string; actorType: string; actorId: string;
    detailJson: string; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_character_profile_actions
      (action_id,owner_id,book_id,profile_id,profile_version_id,action_kind,idempotency_key,request_hash,actor_type,actor_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.actionId, input.ownerId, input.bookId, input.profileId, input.profileVersionId, input.actionKind,
      input.idempotencyKey, input.requestHash, input.actorType, input.actorId, input.detailJson, input.now
    );
  }

  public actionHistory(ownerId: string, bookId: string, profileId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT action_id AS actionId,profile_version_id AS profileVersionId,
      action_kind AS actionKind,actor_type AS actorType,actor_id AS actorId,detail_json AS detail,created_at AS createdAt
      FROM v7_character_profile_actions WHERE owner_id=? AND book_id=? AND profile_id=?
      ORDER BY created_at DESC,action_id DESC`).all(ownerId, bookId, profileId) as Array<Record<string, unknown>>;
  }

  public currentState(ownerId: string, bookId: string, entityId: string, canonRevision: number): unknown | null {
    const row = this.database.prepare(`SELECT state_json FROM character_state_projection
      WHERE owner_id=? AND book_id=? AND entity_id=? AND canon_revision=?`)
      .get(ownerId, bookId, entityId, canonRevision) as { state_json: string } | undefined;
    return row === undefined ? null : JSON.parse(row.state_json) as unknown;
  }

  public relationships(ownerId: string, bookId: string, entityId: string, canonRevision: number): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT relation_key AS relationKey,to_value_json AS target,source_fact_id AS sourceFactId
      FROM relationship_projection WHERE owner_id=? AND book_id=? AND from_entity_id=? AND canon_revision=?
      ORDER BY relation_key,relationship_id`).all(ownerId, bookId, entityId, canonRevision) as Array<Record<string, unknown>>;
  }

  public knowledge(ownerId: string, bookId: string, entityId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT fact_id AS factId,subject_entity_id AS subjectEntityId,relation_key AS relationKey,
      value_json AS value,epistemic_status AS epistemicStatus,viewpoint_entity_id AS viewpointEntityId,
      knowledge_subject_id AS knowledgeSubjectId,knowledge_time_start AS knowledgeTimeStart,
      knowledge_time_end AS knowledgeTimeEnd,source_chapter_id AS sourceChapterId
      FROM fact_assertions WHERE owner_id=? AND book_id=? AND status='active'
        AND (knowledge_subject_id=? OR viewpoint_entity_id=?)
      ORDER BY created_at,fact_id`).all(ownerId, bookId, entityId, entityId) as Array<Record<string, unknown>>;
  }

  public factHistory(ownerId: string, bookId: string, entityId: string, limit = 100): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT fact_id AS factId,relation_key AS relationKey,value_json AS value,
      epistemic_status AS epistemicStatus,negated,source_chapter_id AS sourceChapterId,
      source_manuscript_version_id AS sourceManuscriptVersionId,status,created_at AS createdAt
      FROM fact_assertions WHERE owner_id=? AND book_id=? AND subject_entity_id=?
      ORDER BY created_at DESC,fact_id DESC LIMIT ?`).all(ownerId, bookId, entityId, limit) as Array<Record<string, unknown>>;
  }

  public openingReference(ownerId: string, bookId: string, sourceProtagonistProfileId: string | null): Array<Record<string, unknown>> {
    if (sourceProtagonistProfileId === null) return [];
    return this.database.prepare(`SELECT category,logical_key AS logicalKey,label,value_json AS value,
      authority_layer AS authorityLayer,source_kind AS sourceKind,revision
      FROM protagonist_state_entries WHERE owner_id=? AND book_id=? AND protagonist_profile_id=?
      ORDER BY logical_key,revision DESC`).all(ownerId, bookId, sourceProtagonistProfileId) as Array<Record<string, unknown>>;
  }

  public contextPackByKey(ownerId: string, bookId: string, key: string): V7CharacterContextPackRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_context_packs
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`).get(ownerId, bookId, key) as V7CharacterContextPackRow | undefined;
  }

  public contextPack(ownerId: string, bookId: string, packId: string): V7CharacterContextPackRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_context_packs
      WHERE owner_id=? AND book_id=? AND context_pack_id=?`).get(ownerId, bookId, packId) as V7CharacterContextPackRow | undefined;
  }

  public listContextPacks(
    ownerId: string,
    bookId: string,
    taskKind: string | null,
    taskId: string | null,
    limit: number
  ): V7CharacterContextPackRow[] {
    return this.database.prepare(`SELECT * FROM v7_character_context_packs
      WHERE owner_id=? AND book_id=?
        AND (? IS NULL OR task_kind=?)
        AND (? IS NULL OR task_id=?)
      ORDER BY created_at DESC,context_pack_id DESC LIMIT ?`).all(
      ownerId, bookId, taskKind, taskKind, taskId, taskId, limit
    ) as unknown as V7CharacterContextPackRow[];
  }

  public createContextPack(input: {
    packId: string; ownerId: string; bookId: string; taskKind: string; taskId: string; taskBrief: string;
    canonRevision: number; memberKey: string; memberSnapshotJson: string; candidateEntityIdsJson: string;
    idempotencyKey: string; requestHash: string; now: string;
  }): V7CharacterContextPackRow {
    this.database.prepare(`INSERT INTO v7_character_context_packs
      (context_pack_id,owner_id,book_id,task_kind,task_id,task_brief,source_canon_revision,selection_member_key,
       member_snapshot_json,candidate_entity_ids_json,idempotency_key,request_hash,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)`).run(
      input.packId, input.ownerId, input.bookId, input.taskKind, input.taskId, input.taskBrief, input.canonRevision,
      input.memberKey, input.memberSnapshotJson, input.candidateEntityIdsJson, input.idempotencyKey, input.requestHash,
      input.now, input.now
    );
    return this.contextPack(input.ownerId, input.bookId, input.packId)!;
  }

  public markContextPack(input: {
    ownerId: string; bookId: string; packId: string; status: V7CharacterContextPackRow['status']; memberKey?: string;
    requestId?: string | null; selectedEntityIdsJson?: string; selectedFieldsJson?: string; selectionReasonsJson?: string;
    openQuestionsJson?: string; contentJson?: string; estimatedTokens?: number; contentHash?: string; errorMessage?: string | null; now: string;
  }): void {
    this.database.prepare(`UPDATE v7_character_context_packs SET status=?,selection_member_key=COALESCE(?,selection_member_key),
      request_id=COALESCE(?,request_id),selected_entity_ids_json=COALESCE(?,selected_entity_ids_json),
      selected_fields_json=COALESCE(?,selected_fields_json),selection_reasons_json=COALESCE(?,selection_reasons_json),
      open_questions_json=COALESCE(?,open_questions_json),content_json=COALESCE(?,content_json),
      estimated_tokens=COALESCE(?,estimated_tokens),content_hash=COALESCE(?,content_hash),error_message=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND context_pack_id=?`).run(
      input.status, input.memberKey ?? null, input.requestId ?? null, input.selectedEntityIdsJson ?? null,
      input.selectedFieldsJson ?? null, input.selectionReasonsJson ?? null, input.openQuestionsJson ?? null,
      input.contentJson ?? null, input.estimatedTokens ?? null, input.contentHash ?? null, input.errorMessage ?? null,
      input.now, input.ownerId, input.bookId, input.packId
    );
  }

  public resetContextPackForRetry(ownerId: string, bookId: string, packId: string, now: string): number {
    return Number(this.database.prepare(`UPDATE v7_character_context_packs
      SET status='queued',retry_count=retry_count+1,request_id=NULL,error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND context_pack_id=? AND status='failed'`).run(
      now, ownerId, bookId, packId
    ).changes);
  }

  public maintenanceBySource(ownerId: string, bookId: string, sourceKind: string, sourceVersionId: string): V7CharacterMaintenanceRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_maintenance_runs
      WHERE owner_id=? AND book_id=? AND source_kind=? AND source_version_id=?`)
      .get(ownerId, bookId, sourceKind, sourceVersionId) as V7CharacterMaintenanceRow | undefined;
  }

  public maintenance(ownerId: string, bookId: string, runId: string): V7CharacterMaintenanceRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_maintenance_runs
      WHERE owner_id=? AND book_id=? AND maintenance_run_id=?`).get(ownerId, bookId, runId) as V7CharacterMaintenanceRow | undefined;
  }

  public createMaintenance(input: {
    runId: string; ownerId: string; bookId: string; sourceKind: V7CharacterMaintenanceRow['source_kind'];
    sourceVersionId: string; sourceHash: string; sourceCanonRevision: number; sourceSnapshotJson: string;
    evidenceRefsJson: string; memberKey: string; memberSnapshotJson: string; now: string;
  }): V7CharacterMaintenanceRow {
    this.database.prepare(`INSERT INTO v7_character_maintenance_runs
      (maintenance_run_id,owner_id,book_id,source_kind,source_version_id,source_hash,source_canon_revision,
       source_snapshot_json,evidence_refs_json,assigned_member_key,member_snapshot_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)`).run(
      input.runId, input.ownerId, input.bookId, input.sourceKind, input.sourceVersionId, input.sourceHash,
      input.sourceCanonRevision, input.sourceSnapshotJson, input.evidenceRefsJson, input.memberKey,
      input.memberSnapshotJson, input.now, input.now
    );
    return this.maintenance(input.ownerId, input.bookId, input.runId)!;
  }

  public markMaintenance(input: {
    ownerId: string; bookId: string; runId: string; status: V7CharacterMaintenanceRow['status'];
    memberKey?: string; requestId?: string | null; resultJson?: string; errorMessage?: string | null; now: string;
  }): void {
    this.database.prepare(`UPDATE v7_character_maintenance_runs SET status=?,assigned_member_key=COALESCE(?,assigned_member_key),
      request_id=COALESCE(?,request_id),result_json=COALESCE(?,result_json),error_message=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND maintenance_run_id=?`).run(
      input.status, input.memberKey ?? null, input.requestId ?? null, input.resultJson ?? null,
      input.errorMessage ?? null, input.now, input.ownerId, input.bookId, input.runId
    );
  }

  public resetMaintenanceForRetry(ownerId: string, bookId: string, runId: string, now: string): number {
    return Number(this.database.prepare(`UPDATE v7_character_maintenance_runs
      SET status='queued',retry_count=retry_count+1,request_id=NULL,error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND maintenance_run_id=? AND status='failed'`).run(
      now, ownerId, bookId, runId
    ).changes);
  }

  public activeSettlement(ownerId: string, bookId: string, settlementId: string, stageType: string): Record<string, unknown> | undefined {
    return this.database.prepare(`SELECT * FROM stage_settlements
      WHERE owner_id=? AND book_id=? AND stage_settlement_id=? AND stage_type=? AND status='active'`)
      .get(ownerId, bookId, settlementId, stageType) as Record<string, unknown> | undefined;
  }

  public settlementSources(ownerId: string, bookId: string, settlementId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT source_type,source_id,source_hash,source_locator_json
      FROM stage_settlement_sources WHERE owner_id=? AND book_id=? AND stage_settlement_id=?
      ORDER BY source_type,source_id`).all(ownerId, bookId, settlementId) as Array<Record<string, unknown>>;
  }

  public replaceMaintenanceResult(input: {
    ownerId: string; bookId: string; runId: string; changes: Array<{
      candidateId: string; entityId: string; kind: string; fieldPath: string; proposedValueJson: string;
      publicSummary: string; reason: string; evidenceRefsJson: string;
    }>; issues: Array<{
      issueId: string; entityId: string; kind: string; severity: string; publicSummary: string;
      evidenceRefsJson: string; suggestedAction: string;
    }>; now: string;
  }): void {
    this.runInTransaction(() => {
      this.database.prepare(`UPDATE v7_character_change_candidates SET state='superseded'
        WHERE owner_id=? AND book_id=? AND maintenance_run_id=? AND state='pending'`)
        .run(input.ownerId, input.bookId, input.runId);
      this.database.prepare(`UPDATE v7_character_review_issues SET state='superseded'
        WHERE owner_id=? AND book_id=? AND maintenance_run_id=? AND state='open'`)
        .run(input.ownerId, input.bookId, input.runId);
      const change = this.database.prepare(`INSERT INTO v7_character_change_candidates
        (candidate_id,owner_id,book_id,maintenance_run_id,entity_id,candidate_kind,field_path,proposed_value_json,
         public_summary,reason,evidence_refs_json,state,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?)`);
      for (const item of input.changes) change.run(
        item.candidateId, input.ownerId, input.bookId, input.runId, item.entityId, item.kind, item.fieldPath,
        item.proposedValueJson, item.publicSummary, item.reason, item.evidenceRefsJson, input.now
      );
      const issue = this.database.prepare(`INSERT INTO v7_character_review_issues
        (issue_id,owner_id,book_id,maintenance_run_id,entity_id,issue_kind,severity,public_summary,
         evidence_refs_json,suggested_action,state,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'open',?)`);
      for (const item of input.issues) issue.run(
        item.issueId, input.ownerId, input.bookId, input.runId, item.entityId, item.kind, item.severity,
        item.publicSummary, item.evidenceRefsJson, item.suggestedAction, input.now
      );
    });
  }

  public pendingCandidates(ownerId: string, bookId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT candidate_id AS candidateId,maintenance_run_id AS maintenanceRunId,
      entity_id AS entityId,candidate_kind AS kind,field_path AS fieldPath,proposed_value_json AS proposedValue,
      public_summary AS publicSummary,reason,evidence_refs_json AS evidenceRefs,state,created_at AS createdAt
      FROM v7_character_change_candidates WHERE owner_id=? AND book_id=? AND state='pending'
      ORDER BY created_at,candidate_id`).all(ownerId, bookId) as Array<Record<string, unknown>>;
  }

  public changeCandidate(ownerId: string, bookId: string, candidateId: string): Record<string, unknown> | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_change_candidates
      WHERE owner_id=? AND book_id=? AND candidate_id=?`).get(ownerId, bookId, candidateId) as Record<string, unknown> | undefined;
  }

  public decideCandidate(input: {
    ownerId: string; bookId: string; candidateId: string; state: 'accepted' | 'dismissed'; decidedBy: string; now: string;
  }): number {
    return Number(this.database.prepare(`UPDATE v7_character_change_candidates
      SET state=?,decided_by=?,decided_at=?
      WHERE owner_id=? AND book_id=? AND candidate_id=? AND state='pending'`).run(
      input.state, input.decidedBy, input.now, input.ownerId, input.bookId, input.candidateId
    ).changes);
  }

  public openIssues(ownerId: string, bookId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT issue_id AS issueId,maintenance_run_id AS maintenanceRunId,entity_id AS entityId,
      issue_kind AS kind,severity,public_summary AS publicSummary,evidence_refs_json AS evidenceRefs,
      suggested_action AS suggestedAction,state,created_at AS createdAt
      FROM v7_character_review_issues WHERE owner_id=? AND book_id=? AND state='open'
      ORDER BY CASE severity WHEN 'blocking' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,created_at,issue_id`)
      .all(ownerId, bookId) as Array<Record<string, unknown>>;
  }

  public reviewIssue(ownerId: string, bookId: string, issueId: string): Record<string, unknown> | undefined {
    return this.database.prepare(`SELECT * FROM v7_character_review_issues
      WHERE owner_id=? AND book_id=? AND issue_id=?`).get(ownerId, bookId, issueId) as Record<string, unknown> | undefined;
  }

  public decideIssue(input: {
    ownerId: string; bookId: string; issueId: string; state: 'resolved' | 'dismissed'; now: string;
  }): number {
    return Number(this.database.prepare(`UPDATE v7_character_review_issues SET state=?,resolved_at=?
      WHERE owner_id=? AND book_id=? AND issue_id=? AND state='open'`).run(
      input.state, input.now, input.ownerId, input.bookId, input.issueId
    ).changes);
  }

  public modelCall(requestId: string): V7CharacterModelCallRow | undefined {
    return this.database.prepare(`SELECT request_id,owner_id,book_id,run_id,run_kind,member_key,provider,model_id,plan,
      state,output_text,failure_message,input_tokens,output_tokens FROM v7_character_model_calls WHERE request_id=?`)
      .get(requestId) as V7CharacterModelCallRow | undefined;
  }

  public modelCalls(ownerId: string, bookId: string, runId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT request_id AS requestId,run_kind AS runKind,member_key AS memberKey,provider,
      model_id AS modelId,plan,state,input_tokens AS inputTokens,output_tokens AS outputTokens,
      failure_message AS failureMessage,started_at AS startedAt,completed_at AS completedAt
      FROM v7_character_model_calls WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY started_at,request_id`)
      .all(ownerId, bookId, runId) as Array<Record<string, unknown>>;
  }

  public succeededMaintenanceCalls(ownerId: string, bookId: string, runId: string): V7CharacterModelCallRow[] {
    return this.database.prepare(`SELECT request_id,owner_id,book_id,run_id,run_kind,member_key,provider,model_id,plan,
      state,output_text,failure_message,input_tokens,output_tokens FROM v7_character_model_calls
      WHERE owner_id=? AND book_id=? AND run_id=? AND run_kind='maintenance' AND state='succeeded' AND output_text IS NOT NULL
      ORDER BY completed_at,request_id`)
      .all(ownerId, bookId, runId) as unknown as V7CharacterModelCallRow[];
  }

  public startModelCall(input: {
    requestId: string; ownerId: string; bookId: string; runId: string; runKind: 'context_pack' | 'maintenance';
    memberKey: string; provider: string; modelId: string; plan: 'coding' | 'agent'; promptHash: string;
    reservedTokens: number; governanceRevision: number; temperature: number; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_character_model_calls
      (request_id,owner_id,book_id,run_id,run_kind,member_key,provider,model_id,plan,state,prompt_hash,
       reserved_tokens,governance_revision,temperature,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'working',?,?,?,?,?,?)`).run(
      input.requestId, input.ownerId, input.bookId, input.runId, input.runKind, input.memberKey,
      input.provider, input.modelId, input.plan, input.promptHash, input.reservedTokens,
      input.governanceRevision, input.temperature, input.now, input.now
    );
  }

  public completeModelCall(input: {
    requestId: string; inputTokens: number; outputTokens: number; cashMicros: number; outputText: string; now: string;
  }): void {
    const result = this.database.prepare(`UPDATE v7_character_model_calls SET state='succeeded',input_tokens=?,output_tokens=?,
      cash_micros=?,output_text=?,completed_at=?,updated_at=? WHERE request_id=? AND state='working'`).run(
      input.inputTokens, input.outputTokens, input.cashMicros, input.outputText, input.now, input.now, input.requestId
    );
    if (result.changes !== 1) throw new Error('人物资料模型调用状态已经变化');
  }

  public failModelCall(requestId: string, state: 'failed' | 'unknown', message: string, now: string): void {
    this.database.prepare(`UPDATE v7_character_model_calls SET state=?,failure_message=?,
      completed_at=CASE WHEN ?='failed' THEN ? ELSE completed_at END,updated_at=?
      WHERE request_id=? AND state='working'`).run(state, message.slice(0, 1_000), state, now, now, requestId);
  }
}
