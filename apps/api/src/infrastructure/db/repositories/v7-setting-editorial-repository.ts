import type { DatabaseSync } from 'node:sqlite';
import type { V7SettingBatchView, V7SettingCatalogItem, V7SettingItemView } from '@wenmi/v7-backend';

export interface V7SettingBatchRow {
  batch_id: string; owner_id: string; book_id: string; idempotency_key: string; request_hash: string;
  status: V7SettingBatchView['status']; selected_items_json: string; custom_items_json: string;
  opening_version: number; opening_hash: string; roster_json: string; created_at: string; updated_at: string;
  lease_token: string | null; lease_expires_at: string | null; error_message: string | null;
}

export interface V7SettingRecommendationStateRow {
  taskKind: 'catalog_recommendation';
  phase: 'preparing' | 'understanding' | 'organizing' | 'validating' | 'handoff' | 'ready' | 'failed';
  progress: number;
  assignedMemberKey: string | null;
  attemptedMemberKeys: string[];
  publicMessage: string;
}

export interface V7SettingFinalReviewStateRow {
  taskKind: 'batch_final_review';
  phase: 'preparing' | 'reviewing' | 'applying' | 'ready' | 'failed';
  progress: number;
  assignedMemberKey: string | null;
  attemptedMemberKeys: string[];
  publicMessage: string;
}

export interface V7GenreProfileBatchStateRow {
  taskKind: 'genre_profile';
  phase: 'queued' | 'working' | 'completed' | 'failed' | 'unknown';
  logicalTaskId: string;
  sourceFingerprint: string;
  attemptedMemberKeys: string[];
  publicMessage: string;
}

export interface V7SettingJobRow {
  job_id: string; owner_id: string; book_id: string; batch_id: string; item_key: string; item_label: string;
  group_title: string; item_prompt: string; state: V7SettingItemView['state']; assigned_member_key: string | null;
  previous_member_key: string | null; attempted_members_json: string; attempt_count: number; author_note: string;
  context_manifest_json: string | null; context_hash: string | null; active_output_id: string | null; revision: number;
  created_at: string; updated_at: string;
}

export interface V7SettingOutputRow {
  output_id: string; item_key: string; kind: string; content_json: string; member_key: string; version: number;
  request_id: string;
}

export interface V7SettingModelTaskAttemptRow {
  execution_request_id: string;
  logical_task_id: string;
  node_key: string;
  member_key: string;
  state: 'working' | 'succeeded' | 'failed' | 'unknown';
  output_text: string | null;
  failure_message: string | null;
}

export interface V7SettingOutputTaskLineage {
  request_id: string;
  version: number;
  kind: string;
}

export interface V7SettingCurrentItemRow {
  owner_id: string; book_id: string; item_key: string; item_label: string; group_title: string; item_prompt: string;
  state: 'candidate' | 'needs_author' | 'confirmed'; active_version_id: string; revision: number; source_output_id: string | null;
}

export interface V7SettingMemberEventRow {
  member_key: string; event_type: string; handoff_to_member_key: string | null;
}

export class V7SettingEditorialRepository {
  public constructor(private readonly database: DatabaseSync) {}

  /** 同一组设定的候选版本与任务状态必须整组成功或整组回滚。 */
  public atomic<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public findBatchByIdempotency(ownerId: string, bookId: string, key: string): V7SettingBatchRow | undefined {
    return this.database.prepare('SELECT * FROM v7_setting_batches WHERE owner_id=? AND book_id=? AND idempotency_key=?')
      .get(ownerId, bookId, key) as V7SettingBatchRow | undefined;
  }

  /**
   * 书级题材档案复用设定任务账本承载模型调用外键，但没有设定条目 job，
   * 因此不会进入作者端的设定批次投影。唯一键保证多进程只创建一份内部任务。
   */
  public ensureGenreProfileBatch(input: {
    batchId: string; ownerId: string; bookId: string; idempotencyKey: string; sourceFingerprint: string;
    openingVersion: number; openingHash: string; rosterJson: string; stateJson: string; now: string;
  }): V7SettingBatchRow {
    this.database.prepare(`INSERT OR IGNORE INTO v7_setting_batches
      (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,
       opening_version,opening_hash,roster_json,created_at,updated_at)
      VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?)`).run(
      input.batchId, input.ownerId, input.bookId, input.idempotencyKey, input.sourceFingerprint,
      JSON.stringify({ taskKind: 'genre_profile', profileId: null }), input.stateJson,
      input.openingVersion, input.openingHash, input.rosterJson, input.now, input.now
    );
    const row = this.genreProfileBatch(input.ownerId, input.bookId, input.idempotencyKey);
    if (row === undefined || row.request_hash !== input.sourceFingerprint) {
      throw new Error('书级题材档案内部任务幂等键冲突');
    }
    return row;
  }

  public genreProfileBatch(ownerId: string, bookId: string, idempotencyKey: string): V7SettingBatchRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_setting_batches
      WHERE owner_id=? AND book_id=? AND idempotency_key=?
        AND json_extract(custom_items_json,'$.taskKind')='genre_profile'`)
      .get(ownerId, bookId, idempotencyKey) as V7SettingBatchRow | undefined;
  }

  public claimGenreProfileBatch(input: {
    ownerId: string; bookId: string; batchId: string; token: string; leaseExpiresAt: string; now: string;
    stateJson: string;
  }): boolean {
    const result = this.database.prepare(`UPDATE v7_setting_batches
      SET status='working',custom_items_json=?,lease_token=?,lease_expires_at=?,error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=?
        AND json_extract(custom_items_json,'$.taskKind')='genre_profile'
        AND status IN ('queued','working') AND (lease_token IS NULL OR lease_expires_at<=?)`)
      .run(input.stateJson, input.token, input.leaseExpiresAt, input.now,
        input.ownerId, input.bookId, input.batchId, input.now);
    return result.changes === 1;
  }

  public renewGenreProfileLease(input: {
    ownerId: string; bookId: string; batchId: string; token: string; leaseExpiresAt: string; now: string;
  }): boolean {
    const result = this.database.prepare(`UPDATE v7_setting_batches
      SET lease_expires_at=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='working' AND lease_token=?
        AND json_extract(custom_items_json,'$.taskKind')='genre_profile'`)
      .run(input.leaseExpiresAt, input.now, input.ownerId, input.bookId, input.batchId, input.token);
    return result.changes === 1;
  }

  public markReclaimedGenreProfileCallsUnknown(
    ownerId: string,
    bookId: string,
    batchId: string,
    now: string
  ): number {
    return Number(this.database.prepare(`UPDATE v7_setting_model_calls
      SET state='unknown',failure_message=?,completed_at=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND item_key='__genre_profile__' AND state='working'
        AND EXISTS (
          SELECT 1 FROM v7_setting_batches batch
          WHERE batch.owner_id=v7_setting_model_calls.owner_id
            AND batch.book_id=v7_setting_model_calls.book_id
            AND batch.batch_id=v7_setting_model_calls.batch_id
            AND json_extract(batch.custom_items_json,'$.taskKind')='genre_profile'
        )`).run(
      '对不起，上次服务中断后无法确认题材档案结果，已停止自动重试。',
      now, now, ownerId, bookId, batchId
    ).changes);
  }

  public genreProfileModelAttempt(
    ownerId: string,
    bookId: string,
    batchId: string,
    logicalTaskId: string
  ): V7SettingModelTaskAttemptRow | undefined {
    return this.database.prepare(`SELECT call.request_id AS execution_request_id,manifest.task_id AS logical_task_id,
        call.node_key,call.member_key,call.state,call.output_text,call.failure_message
      FROM v7_setting_model_calls call
      JOIN v7_prompt_manifests manifest
        ON manifest.owner_id=call.owner_id AND manifest.book_id=call.book_id
       AND manifest.member_key=call.member_key AND manifest.compiled_prompt_hash=call.prompt_hash
      JOIN v7_setting_batches batch
        ON batch.owner_id=call.owner_id AND batch.book_id=call.book_id AND batch.batch_id=call.batch_id
      WHERE call.owner_id=? AND call.book_id=? AND call.batch_id=? AND call.item_key='__genre_profile__'
        AND manifest.task_id=? AND json_extract(batch.custom_items_json,'$.taskKind')='genre_profile'
      ORDER BY call.updated_at DESC,call.request_id DESC LIMIT 1`).get(
      ownerId, bookId, batchId, logicalTaskId
    ) as V7SettingModelTaskAttemptRow | undefined;
  }

  public completeGenreProfileBatch(input: {
    ownerId: string; bookId: string; batchId: string; token: string; profileId: string;
    stateJson: string; now: string;
  }): boolean {
    const result = this.database.prepare(`UPDATE v7_setting_batches
      SET status='completed',selected_items_json=?,custom_items_json=?,lease_token=NULL,lease_expires_at=NULL,
          error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND lease_token=?
        AND json_extract(custom_items_json,'$.taskKind')='genre_profile'`)
      .run(JSON.stringify({ taskKind: 'genre_profile', profileId: input.profileId }), input.stateJson, input.now,
        input.ownerId, input.bookId, input.batchId, input.token);
    return result.changes === 1;
  }

  public failGenreProfileBatch(input: {
    ownerId: string; bookId: string; batchId: string; token: string; stateJson: string; message: string; now: string;
  }): boolean {
    const result = this.database.prepare(`UPDATE v7_setting_batches
      SET status='partially_failed',custom_items_json=?,error_message=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND lease_token=?
        AND json_extract(custom_items_json,'$.taskKind')='genre_profile'`)
      .run(input.stateJson, input.message, input.now, input.ownerId, input.bookId, input.batchId, input.token);
    return result.changes === 1;
  }

  public resetKnownFailedGenreProfileBatch(input: {
    ownerId: string; bookId: string; batchId: string; stateJson: string; now: string;
  }): boolean {
    const result = this.database.prepare(`UPDATE v7_setting_batches
      SET status='queued',custom_items_json=?,error_message=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='partially_failed'
        AND json_extract(custom_items_json,'$.taskKind')='genre_profile'
        AND NOT EXISTS (
          SELECT 1 FROM v7_setting_model_calls call
          WHERE call.owner_id=v7_setting_batches.owner_id AND call.book_id=v7_setting_batches.book_id
            AND call.batch_id=v7_setting_batches.batch_id AND call.item_key='__genre_profile__'
            AND call.state IN ('working','unknown')
        )`)
      .run(input.stateJson, input.now, input.ownerId, input.bookId, input.batchId);
    return result.changes === 1;
  }

  public createRecommendationTask(input: {
    taskId: string; ownerId: string; bookId: string; idempotencyKey: string; requestHash: string;
    openingVersion: number; openingHash: string; rosterJson: string; stateJson: string; now: string;
  }): void {
    this.database.prepare(`INSERT OR IGNORE INTO v7_setting_batches
      (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,opening_version,opening_hash,roster_json,created_at,updated_at)
      VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?)`).run(
      input.taskId, input.ownerId, input.bookId, input.idempotencyKey, input.requestHash,
      JSON.stringify({ taskKind: 'catalog_recommendation', result: null }), input.stateJson,
      input.openingVersion, input.openingHash, input.rosterJson, input.now, input.now
    );
  }

  public latestRecommendation(
    ownerId: string,
    bookId: string,
    openingVersion: number,
    openingHash: string,
    requestHash: string
  ): V7SettingBatchRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_setting_batches
      WHERE owner_id=? AND book_id=? AND opening_version=? AND opening_hash=? AND request_hash=?
        AND json_extract(custom_items_json,'$.taskKind')='catalog_recommendation'
      ORDER BY updated_at DESC,created_at DESC LIMIT 1`).get(
      ownerId, bookId, openingVersion, openingHash, requestHash
    ) as V7SettingBatchRow | undefined;
  }

  public latestRecommendationForBook(ownerId: string, bookId: string): V7SettingBatchRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_setting_batches
      WHERE owner_id=? AND book_id=?
        AND json_extract(custom_items_json,'$.taskKind')='catalog_recommendation'
      ORDER BY created_at DESC,updated_at DESC LIMIT 1`).get(ownerId, bookId) as V7SettingBatchRow | undefined;
  }

  public recommendation(ownerId: string, bookId: string, taskId: string): V7SettingBatchRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_setting_batches
      WHERE owner_id=? AND book_id=? AND batch_id=?
        AND json_extract(custom_items_json,'$.taskKind')='catalog_recommendation'`).get(
      ownerId, bookId, taskId
    ) as V7SettingBatchRow | undefined;
  }

  public updateRecommendationState(input: {
    ownerId: string; bookId: string; taskId: string; token: string; stateJson: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_setting_batches SET custom_items_json=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='working' AND lease_token=?`)
      .run(input.stateJson, input.now, input.ownerId, input.bookId, input.taskId, input.token).changes === 1;
  }

  public completeRecommendation(input: {
    ownerId: string; bookId: string; taskId: string; token: string; resultJson: string; stateJson: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_setting_batches
      SET status='awaiting_author',selected_items_json=?,custom_items_json=?,error_message=NULL,
          lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='working' AND lease_token=?`)
      .run(input.resultJson, input.stateJson, input.now, input.ownerId, input.bookId, input.taskId, input.token).changes === 1;
  }

  public failRecommendation(input: {
    ownerId: string; bookId: string; taskId: string; token: string; stateJson: string; message: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_setting_batches
      SET status='partially_failed',custom_items_json=?,error_message=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='working' AND lease_token=?`)
      .run(input.stateJson, input.message, input.now, input.ownerId, input.bookId, input.taskId, input.token).changes === 1;
  }

  public resetRecommendation(input: {
    ownerId: string; bookId: string; taskId: string; stateJson: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_setting_batches
      SET status='queued',selected_items_json=json_object('taskKind','catalog_recommendation','result',NULL),
          custom_items_json=?,error_message=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='partially_failed'
        AND json_extract(custom_items_json,'$.taskKind')='catalog_recommendation'`)
      .run(input.stateJson, input.now, input.ownerId, input.bookId, input.taskId).changes === 1;
  }

  public createFinalReviewTask(input: {
    taskId: string; ownerId: string; bookId: string; idempotencyKey: string; requestHash: string;
    openingVersion: number; openingHash: string; rosterJson: string; stateJson: string; now: string;
  }): void {
    this.database.prepare(`INSERT OR IGNORE INTO v7_setting_batches
      (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,opening_version,opening_hash,roster_json,created_at,updated_at)
      VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?)`).run(
      input.taskId, input.ownerId, input.bookId, input.idempotencyKey, input.requestHash,
      JSON.stringify({ taskKind: 'batch_final_review', result: null }), input.stateJson,
      input.openingVersion, input.openingHash, input.rosterJson, input.now, input.now
    );
  }

  public latestFinalReview(ownerId: string, bookId: string, requestHash?: string): V7SettingBatchRow | undefined {
    const suffix = requestHash === undefined ? '' : ' AND request_hash=?';
    const values: string[] = requestHash === undefined ? [ownerId, bookId] : [ownerId, bookId, requestHash];
    return this.database.prepare(`SELECT * FROM v7_setting_batches
      WHERE owner_id=? AND book_id=?${suffix}
        AND json_extract(custom_items_json,'$.taskKind')='batch_final_review'
      ORDER BY updated_at DESC,created_at DESC LIMIT 1`).get(...values) as V7SettingBatchRow | undefined;
  }

  public latestSettingItemUpdatedAt(ownerId: string, bookId: string): string | null {
    const row = this.database.prepare(`SELECT MAX(updated_at) AS updated_at FROM v7_setting_items
      WHERE owner_id=? AND book_id=?`).get(ownerId, bookId) as { updated_at: string | null };
    return row.updated_at;
  }

  public finalReview(ownerId: string, bookId: string, taskId: string): V7SettingBatchRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_setting_batches
      WHERE owner_id=? AND book_id=? AND batch_id=?
        AND json_extract(custom_items_json,'$.taskKind')='batch_final_review'`).get(
      ownerId, bookId, taskId
    ) as V7SettingBatchRow | undefined;
  }

  public updateFinalReviewState(input: {
    ownerId: string; bookId: string; taskId: string; token: string; stateJson: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_setting_batches SET custom_items_json=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='working' AND lease_token=?`)
      .run(input.stateJson, input.now, input.ownerId, input.bookId, input.taskId, input.token).changes === 1;
  }

  public completeFinalReview(input: {
    ownerId: string; bookId: string; taskId: string; token: string; resultJson: string; stateJson: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_setting_batches
      SET status='awaiting_author',selected_items_json=?,custom_items_json=?,error_message=NULL,
          lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='working' AND lease_token=?`)
      .run(input.resultJson, input.stateJson, input.now, input.ownerId, input.bookId, input.taskId, input.token).changes === 1;
  }

  public failFinalReview(input: {
    ownerId: string; bookId: string; taskId: string; token: string; stateJson: string; message: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_setting_batches
      SET status='partially_failed',custom_items_json=?,error_message=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='working' AND lease_token=?`)
      .run(input.stateJson, input.message, input.now, input.ownerId, input.bookId, input.taskId, input.token).changes === 1;
  }

  public resetFinalReview(input: {
    ownerId: string; bookId: string; taskId: string; stateJson: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE v7_setting_batches
      SET status='queued',selected_items_json=json_object('taskKind','batch_final_review','result',NULL),
          custom_items_json=?,error_message=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='partially_failed'
        AND json_extract(custom_items_json,'$.taskKind')='batch_final_review'`)
      .run(input.stateJson, input.now, input.ownerId, input.bookId, input.taskId).changes === 1;
  }

  public createBatchWithJobs(input: {
    batch: { batchId: string; ownerId: string; bookId: string; idempotencyKey: string; requestHash: string; selectedItemsJson: string; customItemsJson: string; openingVersion: number; openingHash: string; rosterJson: string; now: string };
    jobs: Array<{ jobId: string; item: V7SettingCatalogItem; authorNote: string }>;
  }): void {
    const { batch } = input;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`INSERT INTO v7_setting_batches
        (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,opening_version,opening_hash,roster_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?)`).run(
        batch.batchId, batch.ownerId, batch.bookId, batch.idempotencyKey, batch.requestHash,
        batch.selectedItemsJson, batch.customItemsJson, batch.openingVersion, batch.openingHash, batch.rosterJson, batch.now, batch.now
      );
      const statement = this.database.prepare(`INSERT INTO v7_setting_item_jobs
        (job_id,owner_id,book_id,batch_id,item_key,item_label,group_title,item_prompt,state,attempted_members_json,author_note,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'queued','[]',?,?,?)`);
      for (const job of input.jobs) statement.run(
        job.jobId, batch.ownerId, batch.bookId, batch.batchId, job.item.key, job.item.label,
        job.item.groupTitle, job.item.prompt, job.authorNote, batch.now, batch.now
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public resetFailedJobs(ownerId: string, bookId: string, batchId: string, now: string): number {
    const reset = this.database.prepare(`UPDATE v7_setting_item_jobs SET state='queued',updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND state='failed'`).run(now, ownerId, bookId, batchId);
    if (reset.changes === 0) return 0;
    this.database.prepare(`UPDATE v7_setting_batches SET status='queued',error_message=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=?`).run(now, ownerId, bookId, batchId);
    return Number(reset.changes);
  }

  public setBatchAwaitingAuthor(ownerId: string, bookId: string, batchId: string, now: string): void {
    this.database.prepare(`UPDATE v7_setting_batches SET status='awaiting_author',updated_at=? WHERE batch_id=? AND owner_id=? AND book_id=?`)
      .run(now, batchId, ownerId, bookId);
  }

  public versionContent(ownerId: string, bookId: string, versionId: string): { content_json: string } | undefined {
    return this.database.prepare('SELECT content_json FROM v7_setting_item_versions WHERE owner_id=? AND book_id=? AND version_id=?')
      .get(ownerId, bookId, versionId) as { content_json: string } | undefined;
  }

  public hasCandidateFromBatch(ownerId: string, bookId: string, itemKey: string, batchId: string): boolean {
    return this.database.prepare(`SELECT 1 AS found FROM v7_setting_item_versions
      WHERE owner_id=? AND book_id=? AND item_key=? AND source_batch_id=? LIMIT 1`)
      .get(ownerId, bookId, itemKey, batchId) !== undefined;
  }

  public confirmItem(input: {
    ownerId: string;
    bookId: string;
    itemKey: string;
    sourceVersionId: string;
    sourceOutputId: string | null;
    expectedRevision: number;
    nextRevision: number;
    versionId: string;
    now: string;
    finalReviewAdvance?: { taskId: string; expectedResultHash: string; nextResultHash: string };
  }): boolean {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`INSERT INTO v7_setting_item_versions
        (version_id,owner_id,book_id,item_key,revision,status,content_json,source_output_id,source_batch_id,created_by,created_at)
        SELECT ?,owner_id,book_id,item_key,?,'confirmed',content_json,source_output_id,source_batch_id,'author',?
        FROM v7_setting_item_versions WHERE owner_id=? AND book_id=? AND version_id=?`)
        .run(input.versionId, input.nextRevision, input.now, input.ownerId, input.bookId, input.sourceVersionId);
      const updated = this.database.prepare(`UPDATE v7_setting_items SET state='confirmed',active_version_id=?,revision=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND item_key=? AND revision=?`)
        .run(input.versionId, input.nextRevision, input.now, input.ownerId, input.bookId, input.itemKey, input.expectedRevision);
      if (updated.changes !== 1) {
        this.database.exec('ROLLBACK');
        return false;
      }
      this.database.prepare(`UPDATE v7_setting_item_jobs SET state='confirmed',revision=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND item_key=? AND active_output_id=?`)
        .run(input.nextRevision, input.now, input.ownerId, input.bookId, input.itemKey, input.sourceOutputId);
      if (input.finalReviewAdvance !== undefined) {
        const advanced = this.database.prepare(`UPDATE v7_setting_batches
          SET selected_items_json=json_set(selected_items_json,'$.resultHash',?),updated_at=?
          WHERE owner_id=? AND book_id=? AND batch_id=? AND status IN ('awaiting_author','completed')
            AND json_extract(custom_items_json,'$.taskKind')='batch_final_review'
            AND json_extract(selected_items_json,'$.resultHash')=?`)
          .run(
            input.finalReviewAdvance.nextResultHash,
            input.now,
            input.ownerId,
            input.bookId,
            input.finalReviewAdvance.taskId,
            input.finalReviewAdvance.expectedResultHash
          );
        if (advanced.changes !== 1) {
          this.database.exec('ROLLBACK');
          return false;
        }
      }
      this.database.exec('COMMIT');
      return true;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public memberSetting(memberKey: string): { enabled: number; revision: number } | undefined {
    return this.database.prepare('SELECT enabled,revision FROM v7_setting_member_settings WHERE member_key=?')
      .get(memberKey) as { enabled: number; revision: number } | undefined;
  }

  public saveMemberSetting(input: { memberKey: string; enabled: boolean; expectedRevision: number; actorId: string; now: string; exists: boolean }): boolean {
    if (!input.exists) {
      this.database.prepare('INSERT INTO v7_setting_member_settings(member_key,enabled,revision,updated_by,updated_at) VALUES (?,?,2,?,?)')
        .run(input.memberKey, input.enabled ? 1 : 0, input.actorId, input.now);
      return true;
    }
    const result = this.database.prepare(`UPDATE v7_setting_member_settings SET enabled=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE member_key=? AND revision=?`).run(input.enabled ? 1 : 0, input.actorId, input.now, input.memberKey, input.expectedRevision);
    return result.changes === 1;
  }

  public claimBatch(input: { ownerId: string; bookId: string; batchId: string; token: string; leaseExpiresAt: string; now: string }): boolean {
    const result = this.database.prepare(`UPDATE v7_setting_batches SET status='working',lease_token=?,lease_expires_at=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status IN ('queued','working') AND (lease_token IS NULL OR lease_expires_at<=?)`)
      .run(input.token, input.leaseExpiresAt, input.now, input.ownerId, input.bookId, input.batchId, input.now);
    return result.changes === 1;
  }

  public markReclaimedModelCallsUnknown(ownerId: string, bookId: string, batchId: string, now: string): number {
    return Number(this.database.prepare(`UPDATE v7_setting_model_calls SET state='unknown',failure_message=?,completed_at=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND state='working'`).run(
        '对不起，上次服务中断后无法确认模型结果，已停止自动重试。', now, now, ownerId, bookId, batchId
      ).changes);
  }

  public renewBatchLease(input: { ownerId: string; bookId: string; batchId: string; token: string; leaseExpiresAt: string; now: string }): boolean {
    const result = this.database.prepare(`UPDATE v7_setting_batches SET lease_expires_at=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND status='working' AND lease_token=?`)
      .run(input.leaseExpiresAt, input.now, input.ownerId, input.bookId, input.batchId, input.token);
    return result.changes === 1;
  }

  public finishBatch(input: { ownerId: string; bookId: string; batchId: string; token: string; status: V7SettingBatchRow['status']; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_batches SET status=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND lease_token=?`)
      .run(input.status, input.now, input.ownerId, input.bookId, input.batchId, input.token);
  }

  public failBatch(input: { ownerId: string; bookId: string; batchId: string; token: string; message: string; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_batches SET status='partially_failed',error_message=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=? AND lease_token=?`)
      .run(input.message, input.now, input.ownerId, input.bookId, input.batchId, input.token);
  }

  public updateJobContext(input: { ownerId: string; bookId: string; jobId: string; manifestJson: string; contextHash: string; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_item_jobs SET context_manifest_json=?,context_hash=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND job_id=?`).run(input.manifestJson, input.contextHash, input.now, input.ownerId, input.bookId, input.jobId);
  }

  public assignJobMember(input: { ownerId: string; bookId: string; jobId: string; memberKey: string; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_item_jobs SET state='working',previous_member_key=assigned_member_key,assigned_member_key=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND job_id=?`).run(input.memberKey, input.now, input.ownerId, input.bookId, input.jobId);
  }

  public markJobChiefReview(input: { ownerId: string; bookId: string; jobId: string; outputId: string; memberKey: string; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_item_jobs SET state='chief_review',active_output_id=?,previous_member_key=assigned_member_key,assigned_member_key=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND job_id=?`).run(input.outputId, input.memberKey, input.now, input.ownerId, input.bookId, input.jobId);
  }

  public markJobNeedsAuthor(input: { ownerId: string; bookId: string; jobId: string; outputId: string; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_item_jobs SET state='needs_author',active_output_id=?,revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND job_id=?`).run(input.outputId, input.now, input.ownerId, input.bookId, input.jobId);
  }

  public replacePendingJobOutput(input: { ownerId: string; bookId: string; itemKey: string; outputId: string; memberKey: string; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_item_jobs
      SET state='needs_author',active_output_id=?,previous_member_key=assigned_member_key,assigned_member_key=?,revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND item_key=? AND state='needs_author'`)
      .run(input.outputId, input.memberKey, input.now, input.ownerId, input.bookId, input.itemKey);
  }

  public confirmedVersions(ownerId: string, bookId: string): Array<{ item_key: string; item_label: string; version_id: string; revision: number; content_json: string }> {
    return this.database.prepare(`SELECT i.item_key,i.item_label,v.version_id,v.revision,v.content_json FROM v7_setting_items i
      JOIN v7_setting_item_versions v ON v.version_id=i.active_version_id AND v.owner_id=i.owner_id AND v.book_id=i.book_id
      WHERE i.owner_id=? AND i.book_id=? AND i.state='confirmed' ORDER BY i.updated_at`).all(ownerId, bookId) as Array<{ item_key: string; item_label: string; version_id: string; revision: number; content_json: string }>;
  }

  public modelCall(requestId: string, ownerId: string, bookId: string): { state: string; output_text: string | null; failure_message: string | null } | undefined {
    return this.database.prepare('SELECT state,output_text,failure_message FROM v7_setting_model_calls WHERE request_id=? AND owner_id=? AND book_id=?')
      .get(requestId, ownerId, bookId) as { state: string; output_text: string | null; failure_message: string | null } | undefined;
  }

  public modelCallForLogicalTask(ownerId: string, bookId: string, logicalTaskId: string): V7SettingModelTaskAttemptRow | undefined {
    return this.database.prepare(`SELECT call.request_id AS execution_request_id,manifest.task_id AS logical_task_id,
        call.node_key,call.member_key,call.state,call.output_text,call.failure_message
      FROM v7_prompt_manifests manifest
      JOIN v7_setting_model_calls call
        ON call.owner_id=manifest.owner_id AND call.book_id=manifest.book_id
       AND call.member_key=manifest.member_key AND call.prompt_hash=manifest.compiled_prompt_hash
      WHERE manifest.owner_id=? AND manifest.book_id=? AND manifest.task_id=?
      ORDER BY call.started_at DESC,call.request_id DESC LIMIT 1`).get(
      ownerId, bookId, logicalTaskId
    ) as V7SettingModelTaskAttemptRow | undefined;
  }

  public latestModelOutcomeForJob(
    ownerId: string,
    bookId: string,
    batchId: string,
    itemKey: string,
    states: ReadonlyArray<'failed' | 'unknown'>
  ): V7SettingModelTaskAttemptRow | undefined {
    if (states.length === 0) return undefined;
    const placeholders = states.map(() => '?').join(',');
    return this.database.prepare(`SELECT call.request_id AS execution_request_id,
        COALESCE(manifest.task_id,call.request_id) AS logical_task_id,
        call.node_key,call.member_key,call.state,call.output_text,call.failure_message
      FROM v7_setting_model_calls call
      LEFT JOIN v7_prompt_manifests manifest
        ON manifest.owner_id=call.owner_id AND manifest.book_id=call.book_id
       AND manifest.member_key=call.member_key AND manifest.compiled_prompt_hash=call.prompt_hash
      WHERE call.owner_id=? AND call.book_id=? AND call.batch_id=? AND call.item_key=?
        AND call.state IN (${placeholders})
      ORDER BY call.updated_at DESC,call.request_id DESC LIMIT 1`).get(
      ownerId, bookId, batchId, itemKey, ...states
    ) as V7SettingModelTaskAttemptRow | undefined;
  }

  public latestModelOutcomeForBatch(
    ownerId: string,
    bookId: string,
    batchId: string,
    states: ReadonlyArray<'failed' | 'unknown'>
  ): V7SettingModelTaskAttemptRow | undefined {
    if (states.length === 0) return undefined;
    const placeholders = states.map(() => '?').join(',');
    return this.database.prepare(`SELECT call.request_id AS execution_request_id,
        COALESCE(manifest.task_id,call.request_id) AS logical_task_id,
        call.node_key,call.member_key,call.state,call.output_text,call.failure_message
      FROM v7_setting_model_calls call
      LEFT JOIN v7_prompt_manifests manifest
        ON manifest.owner_id=call.owner_id AND manifest.book_id=call.book_id
       AND manifest.member_key=call.member_key AND manifest.compiled_prompt_hash=call.prompt_hash
      WHERE call.owner_id=? AND call.book_id=? AND call.batch_id=?
        AND call.state IN (${placeholders})
      ORDER BY call.updated_at DESC,call.request_id DESC LIMIT 1`).get(
      ownerId, bookId, batchId, ...states
    ) as V7SettingModelTaskAttemptRow | undefined;
  }

  public startModelCall(input: { requestId: string; ownerId: string; bookId: string; batchId: string; itemKey: string; nodeKey: string; memberKey: string; provider: string; modelId: string; plan: string; promptHash: string; reservedTokens: number; governanceRevision: number; temperature: number; now: string }): void {
    this.database.prepare(`INSERT INTO v7_setting_model_calls
      (request_id,owner_id,book_id,batch_id,item_key,node_key,member_key,provider,model_id,plan,state,prompt_hash,reserved_tokens,governance_revision,temperature,started_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'working',?,?,?,?,?,?)`).run(
      input.requestId, input.ownerId, input.bookId, input.batchId, input.itemKey, input.nodeKey,
      input.memberKey, input.provider, input.modelId, input.plan, input.promptHash, input.reservedTokens,
      input.governanceRevision, input.temperature, input.now, input.now
    );
  }

  public succeedModelCall(input: { requestId: string; ownerId: string; bookId: string; inputTokens: number; outputTokens: number; cashMicros: number; output: string; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_model_calls SET state='succeeded',input_tokens=?,output_tokens=?,cash_micros=?,output_text=?,completed_at=?,updated_at=?
      WHERE request_id=? AND owner_id=? AND book_id=? AND state='working'`).run(
      input.inputTokens, input.outputTokens, input.cashMicros, input.output, input.now, input.now, input.requestId, input.ownerId, input.bookId
    );
  }

  public failModelCall(input: { requestId: string; ownerId: string; bookId: string; state: 'failed' | 'unknown'; message: string; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_model_calls SET state=?,failure_message=?,completed_at=?,updated_at=?
      WHERE request_id=? AND owner_id=? AND book_id=? AND state='working'`).run(
      input.state, input.message, input.now, input.now, input.requestId, input.ownerId, input.bookId
    );
  }

  public saveOutput(input: { outputId: string; ownerId: string; bookId: string; batchId: string; itemKey: string; kind: string; memberKey: string; contentJson: string; sourcesJson: string; requestId: string; now: string }): string {
    const existing = this.database.prepare('SELECT output_id FROM v7_setting_outputs WHERE owner_id=? AND book_id=? AND request_id=?')
      .get(input.ownerId, input.bookId, input.requestId) as { output_id: string } | undefined;
    if (existing !== undefined) return existing.output_id;
    const version = Number((this.database.prepare(`SELECT COALESCE(MAX(version),0)+1 AS version FROM v7_setting_outputs
      WHERE owner_id=? AND book_id=? AND batch_id=? AND item_key=? AND kind=?`)
      .get(input.ownerId, input.bookId, input.batchId, input.itemKey, input.kind) as { version: number }).version);
    this.database.prepare(`INSERT INTO v7_setting_outputs
      (output_id,owner_id,book_id,batch_id,item_key,kind,version,member_key,content_json,source_output_ids_json,request_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.outputId, input.ownerId, input.bookId, input.batchId, input.itemKey, input.kind, version,
      input.memberKey, input.contentJson, input.sourcesJson, input.requestId, input.now
    );
    return input.outputId;
  }

  public outputTaskLineage(ownerId: string, bookId: string, outputId: string): V7SettingOutputTaskLineage | undefined {
    return this.database.prepare(`SELECT request_id,version,kind FROM v7_setting_outputs
      WHERE owner_id=? AND book_id=? AND output_id=?`).get(ownerId, bookId, outputId) as
      V7SettingOutputTaskLineage | undefined;
  }

  public authorInstructionForBatch(ownerId: string, bookId: string, batchId: string, itemKey: string): V7SettingOutputTaskLineage | undefined {
    return this.database.prepare(`SELECT request_id,version,kind FROM v7_setting_outputs
      WHERE owner_id=? AND book_id=? AND batch_id=? AND item_key=? AND kind='author_revision'
      ORDER BY version DESC LIMIT 1`).get(ownerId, bookId, batchId, itemKey) as
      V7SettingOutputTaskLineage | undefined;
  }

  public saveCandidate(input: { versionId: string; ownerId: string; bookId: string; item: V7SettingCatalogItem; contentJson: string; outputId: string; batchId: string; createdBy: string; now: string }): number {
    const current = this.database.prepare('SELECT revision FROM v7_setting_items WHERE owner_id=? AND book_id=? AND item_key=?')
      .get(input.ownerId, input.bookId, input.item.key) as { revision: number } | undefined;
    const revision = (current?.revision ?? 0) + 1;
    // SAVEPOINT works both as a top-level atomic unit and inside the grouped
    // setting transaction. BEGIN IMMEDIATE cannot be nested.
    this.database.exec('SAVEPOINT v7_setting_candidate');
    try {
      this.database.prepare(`INSERT INTO v7_setting_item_versions
        (version_id,owner_id,book_id,item_key,revision,status,content_json,source_output_id,source_batch_id,created_by,created_at)
        VALUES (?,?,?,?,?,'candidate',?,?,?,?,?)`).run(
        input.versionId, input.ownerId, input.bookId, input.item.key, revision, input.contentJson,
        input.outputId, input.batchId, input.createdBy, input.now
      );
      this.database.prepare(`INSERT INTO v7_setting_items
        (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
        VALUES (?,?,?,?,?,?,'candidate',?,?,?)
        ON CONFLICT(owner_id,book_id,item_key) DO UPDATE SET item_label=excluded.item_label,group_title=excluded.group_title,
        item_prompt=excluded.item_prompt,state='candidate',active_version_id=excluded.active_version_id,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(input.ownerId, input.bookId, input.item.key, input.item.label, input.item.groupTitle, input.item.prompt, input.versionId, revision, input.now);
      this.database.exec('RELEASE SAVEPOINT v7_setting_candidate');
      return revision;
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT v7_setting_candidate');
      this.database.exec('RELEASE SAVEPOINT v7_setting_candidate');
      throw error;
    }
  }

  public createSyntheticBatch(input: { batchId: string; ownerId: string; bookId: string; key: string; requestHash: string; itemKey: string; openingVersion: number; openingHash: string; rosterJson: string; now: string }): void {
    this.database.prepare(`INSERT INTO v7_setting_batches
      (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,opening_version,opening_hash,roster_json,created_at,updated_at)
      VALUES (?,?,?,?,?,'working',?,?,?,?,?,?,?)`).run(
      input.batchId, input.ownerId, input.bookId, input.key, input.requestHash, JSON.stringify([input.itemKey]), '[]',
      input.openingVersion, input.openingHash, input.rosterJson, input.now, input.now
    );
  }

  public markJobWorking(input: { ownerId: string; bookId: string; jobId: string; memberKey: string; attemptedJson: string; attemptCount: number; manifestJson: string | null; contextHash: string | null; now: string }): void {
    this.database.prepare(`UPDATE v7_setting_item_jobs SET state='working',previous_member_key=assigned_member_key,assigned_member_key=?,
      attempted_members_json=?,attempt_count=?,context_manifest_json=?,context_hash=?,updated_at=? WHERE owner_id=? AND book_id=? AND job_id=?`)
      .run(input.memberKey, input.attemptedJson, input.attemptCount, input.manifestJson, input.contextHash, input.now, input.ownerId, input.bookId, input.jobId);
  }

  public markJobFailed(ownerId: string, bookId: string, jobId: string, now: string): void {
    this.database.prepare(`UPDATE v7_setting_item_jobs SET state='failed',updated_at=? WHERE owner_id=? AND book_id=? AND job_id=?`)
      .run(now, ownerId, bookId, jobId);
  }

  public insertMemberEvent(input: { eventId: string; ownerId: string; bookId: string; batchId: string; itemKey: string; memberKey: string; eventType: string; handoffTo: string | null; publicMessage: string; internalReason: string | null; now: string }): void {
    this.database.prepare(`INSERT INTO v7_setting_member_events
      (event_id,owner_id,book_id,batch_id,item_key,member_key,event_type,handoff_to_member_key,public_message,internal_reason,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.eventId, input.ownerId, input.bookId, input.batchId, input.itemKey, input.memberKey,
      input.eventType, input.handoffTo, input.publicMessage, input.internalReason, input.now
    );
  }

  public memberEvents(ownerId: string, bookId: string, batchId: string | null): V7SettingMemberEventRow[] {
    if (batchId === null) return this.database.prepare(`SELECT member_key,event_type,handoff_to_member_key FROM v7_setting_member_events
      WHERE owner_id=? AND book_id=? ORDER BY created_at`).all(ownerId, bookId) as unknown as V7SettingMemberEventRow[];
    return this.database.prepare(`SELECT member_key,event_type,handoff_to_member_key FROM v7_setting_member_events
      WHERE owner_id=? AND book_id=? AND batch_id=? ORDER BY created_at`).all(ownerId, bookId, batchId) as unknown as V7SettingMemberEventRow[];
  }

  public completedWriterCount(ownerId: string, bookId: string, memberKey: string): number {
    return Number((this.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_outputs
      WHERE owner_id=? AND book_id=? AND member_key=? AND kind='writer_proposal'`).get(ownerId, bookId, memberKey) as { count: number }).count);
  }

  public currentItem(ownerId: string, bookId: string, itemKey: string): V7SettingCurrentItemRow | undefined {
    return this.database.prepare(`SELECT i.*,v.source_output_id FROM v7_setting_items i
      LEFT JOIN v7_setting_item_versions v ON v.version_id=i.active_version_id AND v.owner_id=i.owner_id AND v.book_id=i.book_id
      WHERE i.owner_id=? AND i.book_id=? AND i.item_key=?`).get(ownerId, bookId, itemKey) as V7SettingCurrentItemRow | undefined;
  }

  public itemKeys(ownerId: string, bookId: string): string[] {
    const rows = this.database.prepare('SELECT item_key FROM v7_setting_items WHERE owner_id=? AND book_id=? ORDER BY updated_at')
      .all(ownerId, bookId) as Array<{ item_key: string }>;
    return rows.map((row) => row.item_key);
  }

  public latestEditorialBatch(ownerId: string, bookId: string): V7SettingBatchRow | undefined {
    return this.database.prepare(`SELECT b.* FROM v7_setting_batches b
      WHERE b.owner_id=? AND b.book_id=?
        AND EXISTS (
          SELECT 1 FROM v7_setting_item_jobs j
          WHERE j.owner_id=b.owner_id AND j.book_id=b.book_id AND j.batch_id=b.batch_id
        )
      ORDER BY b.updated_at DESC LIMIT 1`)
      .get(ownerId, bookId) as V7SettingBatchRow | undefined;
  }

  public batch(ownerId: string, bookId: string, batchId: string): V7SettingBatchRow | undefined {
    return this.database.prepare('SELECT * FROM v7_setting_batches WHERE owner_id=? AND book_id=? AND batch_id=?')
      .get(ownerId, bookId, batchId) as V7SettingBatchRow | undefined;
  }

  public jobs(ownerId: string, bookId: string, batchId: string): V7SettingJobRow[] {
    return this.database.prepare('SELECT * FROM v7_setting_item_jobs WHERE owner_id=? AND book_id=? AND batch_id=? ORDER BY created_at,item_key')
      .all(ownerId, bookId, batchId) as unknown as V7SettingJobRow[];
  }

  public outputs(ownerId: string, bookId: string, itemKey: string, ids: string[]): V7SettingOutputRow[] {
    if (ids.length === 0) return [];
    return this.database.prepare(`SELECT output_id,item_key,kind,content_json,member_key,version,request_id FROM v7_setting_outputs
      WHERE owner_id=? AND book_id=? AND item_key=? AND output_id IN (${ids.map(() => '?').join(',')})`)
      .all(ownerId, bookId, itemKey, ...ids) as unknown as V7SettingOutputRow[];
  }

  public latestOutputForJob(
    ownerId: string,
    bookId: string,
    batchId: string,
    itemKey: string,
    kind: string
  ): V7SettingOutputRow | undefined {
    return this.database.prepare(`SELECT output_id,item_key,kind,content_json,member_key,version,request_id
      FROM v7_setting_outputs WHERE owner_id=? AND book_id=? AND batch_id=? AND item_key=? AND kind=?
      ORDER BY version DESC,created_at DESC LIMIT 1`).get(
      ownerId, bookId, batchId, itemKey, kind
    ) as V7SettingOutputRow | undefined;
  }
}
