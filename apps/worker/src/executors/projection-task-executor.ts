import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

interface ProjectionRow {
  projection_outbox_id: string;
  owner_id: string;
  book_id: string;
  projection_type: string;
  source_snapshot_id: string;
  required_canon_revision: number;
}

interface ProjectionEmbedding {
  readonly modelSnapshotId: string;
  readonly dimension: number;
  readonly available: boolean;
  readonly degradationReason: string | null;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

interface ProjectionVectorStore {
  readonly available: boolean;
  readonly degradationReason: string | null;
  rebuild(scope: { ownerId: string; bookId: string }, tableName: string, records: Array<{
    chunkId: string; snapshotId: string; text: string; vector: number[];
  }>): Promise<void>;
  search(scope: { ownerId: string; bookId: string }, tableName: string, snapshotId: string,
    vector: number[], limit: number): Promise<Array<{ chunkId: string; text: string; distance: number }>>;
}

interface EmbeddingModelMetadata {
  modelId: string;
  modelVersion: string;
  source: string;
  license: string;
  localPath: string;
  filesJson: string;
  tokenizerId: string;
  normalized: boolean;
  queryInstruction: string;
  quantization: string | null;
  assetHash: string;
}

export interface VectorProjectionRuntime {
  embedding: ProjectionEmbedding;
  store: ProjectionVectorStore;
  model: EmbeddingModelMetadata;
  indexPath?: string;
  batchSize?: number;
}

interface VectorBuildResult {
  rows: number;
  tableName: string;
  manifestHash: string;
  embeddingSnapshotId: string;
  probeDistance: number;
}

interface ProjectionChunkRow {
  content_chunk_id: string;
  chunk_snapshot_id: string;
  index_text: string;
  embedding_text: string;
}

export class ProjectionTaskExecutor {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly workerId: string,
    private readonly vectorRuntime?: VectorProjectionRuntime
  ) {}

  public async runNext(now = new Date()): Promise<boolean> {
    const jobId = `projection-${randomUUID()}`;
    const row = this.claim(now, jobId);
    if (row === null) return false;
    if (!this.isCurrentCanonRevision(row)) {
      this.supersede(row, jobId, now.toISOString());
      return true;
    }
    try {
      const vectorBuild = row.projection_type === 'vector' ? await this.buildVector(row) : null;
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.requireReadySnapshot(row);
        const probes = row.projection_type === 'fts'
          ? this.executeFts(row)
          : row.projection_type === 'vector' && vectorBuild !== null
            ? this.finalizeVector(row, vectorBuild, now.toISOString())
            : (() => { throw new Error('PROJECTION_EXECUTOR_NOT_AVAILABLE'); })();
        this.switchWatermark(row, now.toISOString());
        this.database.prepare(`
          UPDATE projection_jobs SET status = 'ready', probe_result_json = ?, finished_at = ?, updated_at = ?
          WHERE projection_job_id = ? AND status = 'building'
        `).run(JSON.stringify(probes), now.toISOString(), now.toISOString(), jobId);
        this.database.prepare(`UPDATE projection_outbox SET status = 'completed', updated_at = ? WHERE projection_outbox_id = ? AND status = 'claimed'`)
          .run(now.toISOString(), row.projection_outbox_id);
        if (row.projection_type === 'vector') this.writeCapability(row, 'available', null, { activeSnapshotId: row.source_snapshot_id }, now.toISOString());
        this.database.exec('COMMIT');
      } catch (error) {
        if (this.database.isTransaction) this.database.exec('ROLLBACK');
        throw error;
      }
      return true;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      if (!this.isCurrentCanonRevision(row)) {
        this.supersede(row, jobId, now.toISOString());
        return true;
      }
      const code = errorCode(error);
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database.prepare(`
          UPDATE projection_jobs SET status = 'failed', error_code = ?, finished_at = ?, updated_at = ?
          WHERE projection_job_id = ?
        `).run(code, now.toISOString(), now.toISOString(), jobId);
        this.database.prepare(`UPDATE projection_outbox SET status = 'failed', updated_at = ? WHERE projection_outbox_id = ?`)
          .run(now.toISOString(), row.projection_outbox_id);
        if (row.projection_type === 'vector') this.writeCapability(row, 'degraded', code, { previousWatermarkKept: true }, now.toISOString());
        this.database.exec('COMMIT');
      } catch (writeError) {
        if (this.database.isTransaction) this.database.exec('ROLLBACK');
        throw writeError;
      }
      return true;
    }
  }

  private claim(now: Date, jobId: string): ProjectionRow | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare(`
        SELECT projection_outbox_id, owner_id, book_id, projection_type, source_snapshot_id, required_canon_revision
        FROM projection_outbox WHERE status = 'pending' AND available_at <= ?
        ORDER BY created_at, projection_outbox_id LIMIT 1
      `).get(now.toISOString()) as ProjectionRow | undefined;
      if (row === undefined) { this.database.exec('COMMIT'); return null; }
      const result = this.database.prepare(`
        UPDATE projection_outbox SET status = 'claimed', attempts = attempts + 1, updated_at = ?
        WHERE projection_outbox_id = ? AND status = 'pending'
      `).run(now.toISOString(), row.projection_outbox_id);
      if (result.changes !== 1) { this.database.exec('ROLLBACK'); return null; }
      this.database.prepare(`
        INSERT INTO projection_jobs (
          projection_job_id, owner_id, book_id, projection_outbox_id, projection_type,
          source_snapshot_id, worker_id, status, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', ?, ?, ?)
      `).run(jobId, row.owner_id, row.book_id, row.projection_outbox_id, row.projection_type,
        row.source_snapshot_id, this.workerId, now.toISOString(), now.toISOString(), now.toISOString());
      this.database.exec('COMMIT');
      return row;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private isCurrentCanonRevision(row: ProjectionRow): boolean {
    const book = this.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(row.owner_id, row.book_id) as { canon_revision: number } | undefined;
    return book?.canon_revision === row.required_canon_revision;
  }

  private supersede(row: ProjectionRow, jobId: string, now: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`UPDATE projection_jobs SET status = 'cancelled', error_code = 'STALE_CANON_REVISION',
        finished_at = ?, updated_at = ? WHERE projection_job_id = ? AND status = 'building'`)
        .run(now, now, jobId);
      this.database.prepare(`UPDATE projection_outbox SET status = 'superseded', updated_at = ?
        WHERE projection_outbox_id = ? AND status = 'claimed'`).run(now, row.projection_outbox_id);
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private requireReadySnapshot(row: ProjectionRow): void {
    const snapshot = this.database.prepare(`
      SELECT s.status, s.canon_revision, b.canon_revision AS book_canon_revision
      FROM chunk_snapshots s JOIN books b ON b.owner_id = s.owner_id AND b.book_id = s.book_id
      WHERE s.owner_id = ? AND s.book_id = ? AND s.chunk_snapshot_id = ?
    `).get(row.owner_id, row.book_id, row.source_snapshot_id) as {
      status: string; canon_revision: number; book_canon_revision: number;
    } | undefined;
    if (snapshot?.status !== 'ready' || snapshot.canon_revision !== row.required_canon_revision
      || snapshot.book_canon_revision !== row.required_canon_revision) throw new Error('PROJECTION_SOURCE_NOT_READY');
  }

  private executeFts(row: ProjectionRow): Record<string, unknown> {
    this.requireReadySnapshot(row);
    const chunks = this.listProjectionChunks(row, 'fts');
    const insert = this.database.prepare(`INSERT INTO content_chunks_fts(content_chunk_id, owner_id, book_id, chunk_snapshot_id, index_text) VALUES (?, ?, ?, ?, ?)`);
    const remove = this.database.prepare(`DELETE FROM content_chunks_fts
      WHERE content_chunk_id = ? AND owner_id = ? AND book_id = ? AND chunk_snapshot_id = ?`);
    for (const chunk of chunks) {
      remove.run(chunk.content_chunk_id, row.owner_id, row.book_id, chunk.chunk_snapshot_id);
      insert.run(chunk.content_chunk_id, row.owner_id, row.book_id, chunk.chunk_snapshot_id, lexicalizeChinese(chunk.index_text));
    }
    return { rows: chunks.length, sourceReady: true, scopeChecked: true, ftsProbe: chunks.length > 0 };
  }

  private listProjectionChunks(row: ProjectionRow, eligibility: 'fts' | 'vector'): ProjectionChunkRow[] {
    const snapshot = this.database.prepare(`SELECT snapshot_kind FROM chunk_snapshots
      WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ?`)
      .get(row.owner_id, row.book_id, row.source_snapshot_id) as { snapshot_kind: string } | undefined;
    if (snapshot === undefined) throw new Error('PROJECTION_SOURCE_NOT_READY');
    const eligibilityColumn = eligibility === 'fts' ? 'fts_eligible' : 'vector_eligible';
    if (snapshot.snapshot_kind !== 'manifest') return this.database.prepare(`
      SELECT content_chunk_id, chunk_snapshot_id, index_text, embedding_text FROM content_chunks
      WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ? AND validation_status = 'valid'
        AND ${eligibilityColumn} = 1 ORDER BY ordinal, content_chunk_id
    `).all(row.owner_id, row.book_id, row.source_snapshot_id) as unknown as ProjectionChunkRow[];
    return this.database.prepare(`
      SELECT c.content_chunk_id, c.chunk_snapshot_id, c.index_text, c.embedding_text
      FROM chunk_snapshot_memberships m JOIN content_chunks c
        ON c.owner_id = m.owner_id AND c.book_id = m.book_id AND c.chunk_snapshot_id = m.member_snapshot_id
        AND c.source_type = m.source_type AND c.source_id = m.source_id AND c.source_version = m.source_version
        AND c.source_hash = m.source_hash
      WHERE m.owner_id = ? AND m.book_id = ? AND m.manifest_snapshot_id = ?
        AND c.validation_status = 'valid' AND c.${eligibilityColumn} = 1
      ORDER BY m.source_type, m.source_id, c.ordinal, c.content_chunk_id
    `).all(row.owner_id, row.book_id, row.source_snapshot_id) as unknown as ProjectionChunkRow[];
  }

  private async buildVector(row: ProjectionRow): Promise<VectorBuildResult> {
    this.requireReadySnapshot(row);
    const runtime = this.vectorRuntime;
    if (runtime === undefined || !runtime.embedding.available || !runtime.store.available) {
      throw new Error(runtime?.embedding.degradationReason ?? runtime?.store.degradationReason ?? 'VECTOR_RUNTIME_UNAVAILABLE');
    }
    if (!Number.isInteger(runtime.embedding.dimension) || runtime.embedding.dimension < 8) throw new Error('VECTOR_DIMENSION_INVALID');
    const chunks = this.listProjectionChunks(row, 'vector');
    if (chunks.length === 0) throw new Error('VECTOR_SOURCE_EMPTY');
    const cacheKey = digest(`${runtime.embedding.modelSnapshotId}\0${runtime.model.assetHash}\0${runtime.embedding.dimension}`);
    const vectorsByHash = new Map<string, number[]>();
    const textByHash = new Map<string, string>();
    for (const chunk of chunks) textByHash.set(digest(chunk.embedding_text), chunk.embedding_text);
    const readCached = this.database.prepare(`SELECT dimension, vector_json FROM embedding_vector_cache
      WHERE embedding_cache_key = ? AND embedding_text_hash = ?`);
    for (const hash of textByHash.keys()) {
      const cached = readCached.get(cacheKey, hash) as { dimension: number; vector_json: string } | undefined;
      if (cached === undefined || cached.dimension !== runtime.embedding.dimension) continue;
      const vector = JSON.parse(cached.vector_json) as unknown;
      if (Array.isArray(vector) && vector.length === runtime.embedding.dimension
        && vector.every((value) => typeof value === 'number' && Number.isFinite(value))) vectorsByHash.set(hash, vector as number[]);
    }
    const missing = [...textByHash.entries()].filter(([hash]) => !vectorsByHash.has(hash));
    const batchSize = Math.max(1, Math.min(runtime.batchSize ?? 32, 128));
    for (let start = 0; start < missing.length; start += batchSize) {
      const batch = missing.slice(start, start + batchSize);
      const embedded = await runtime.embedding.embedDocuments(batch.map(([, text]) => text));
      if (embedded.length !== batch.length) throw new Error('VECTOR_BATCH_COUNT_MISMATCH');
      for (let index = 0; index < embedded.length; index += 1) {
        const vector = embedded[index]!;
        if (vector.length !== runtime.embedding.dimension || vector.some((value) => !Number.isFinite(value))) throw new Error('VECTOR_DIMENSION_MISMATCH');
        vectorsByHash.set(batch[index]![0], vector);
      }
    }
    const insertCache = this.database.prepare(`INSERT OR IGNORE INTO embedding_vector_cache (
      embedding_cache_key, embedding_text_hash, dimension, vector_json, created_at
    ) VALUES (?, ?, ?, ?, ?)`);
    for (const [hash] of missing) insertCache.run(cacheKey, hash, runtime.embedding.dimension,
      JSON.stringify(vectorsByHash.get(hash)!), new Date().toISOString());
    const vectors = chunks.map((chunk) => vectorsByHash.get(digest(chunk.embedding_text))!);
    const scope = { ownerId: row.owner_id, bookId: row.book_id };
    const tableName = `wmv_${digest(`${row.owner_id}\0${row.book_id}\0${runtime.embedding.modelSnapshotId}\0slot-${row.required_canon_revision % 2}`).slice(0, 48)}`;
    await runtime.store.rebuild(scope, tableName, chunks.map((chunk, index) => ({
      chunkId: chunk.content_chunk_id, snapshotId: row.source_snapshot_id, text: chunk.embedding_text, vector: vectors[index]!
    })));
    const probe = await runtime.store.search(scope, tableName, row.source_snapshot_id, vectors[0]!, 1);
    if (probe[0]?.chunkId !== chunks[0]!.content_chunk_id || !Number.isFinite(probe[0].distance)) throw new Error('VECTOR_PROBE_FAILED');
    const embeddingSnapshotId = `embedding-${digest(`${runtime.model.modelId}\0${runtime.model.modelVersion}\0${runtime.model.assetHash}`).slice(0, 40)}`;
    const manifestHash = digest(JSON.stringify({ tableName, snapshotId: row.source_snapshot_id, model: runtime.embedding.modelSnapshotId,
      dimension: runtime.embedding.dimension, rows: chunks.length }));
    return { rows: chunks.length, tableName, manifestHash, embeddingSnapshotId, probeDistance: probe[0].distance };
  }

  private finalizeVector(row: ProjectionRow, build: VectorBuildResult, now: string): Record<string, unknown> {
    const runtime = this.vectorRuntime!;
    this.database.prepare(`
      INSERT INTO embedding_model_snapshots (
        embedding_model_snapshot_id, model_id, model_version, source, license, local_path,
        files_json, tokenizer_id, dimension, normalized, query_instruction, quantization,
        asset_hash, status, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
      ON CONFLICT(model_id, model_version, asset_hash) DO UPDATE SET
        status = 'available', verified_at = excluded.verified_at
    `).run(build.embeddingSnapshotId, runtime.model.modelId, runtime.model.modelVersion, runtime.model.source,
      runtime.model.license, runtime.model.localPath, runtime.model.filesJson, runtime.model.tokenizerId,
      runtime.embedding.dimension, runtime.model.normalized ? 1 : 0, runtime.model.queryInstruction,
      runtime.model.quantization, runtime.model.assetHash, now);
    const registered = this.database.prepare(`
      SELECT embedding_model_snapshot_id FROM embedding_model_snapshots
      WHERE model_id = ? AND model_version = ? AND asset_hash = ?
    `).get(runtime.model.modelId, runtime.model.modelVersion, runtime.model.assetHash) as {
      embedding_model_snapshot_id: string;
    } | undefined;
    if (registered === undefined) throw new Error('EMBEDDING_SNAPSHOT_REGISTRATION_FAILED');
    const embeddingSnapshotId = registered.embedding_model_snapshot_id;
    const manifestId = `vector-manifest-${digest(`${row.owner_id}\0${row.book_id}\0${row.source_snapshot_id}\0${embeddingSnapshotId}`).slice(0, 36)}`;
    this.database.prepare(`
      UPDATE vector_index_manifests SET status = 'superseded'
      WHERE owner_id = ? AND book_id = ? AND status = 'ready' AND chunk_snapshot_id <> ?
    `).run(row.owner_id, row.book_id, row.source_snapshot_id);
    this.database.prepare(`
      INSERT INTO vector_index_manifests (
        vector_index_manifest_id, owner_id, book_id, chunk_snapshot_id, embedding_model_snapshot_id,
        index_path, table_name, dimension, chunk_policy_version, canon_revision, row_count,
        manifest_hash, status, created_at, ready_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT strategy_version FROM chunk_snapshots WHERE chunk_snapshot_id = ? AND owner_id = ? AND book_id = ?),
        ?, ?, ?, 'ready', ?, ?)
      ON CONFLICT(owner_id, book_id, chunk_snapshot_id, embedding_model_snapshot_id) DO UPDATE SET
        index_path = excluded.index_path, table_name = excluded.table_name, dimension = excluded.dimension,
        canon_revision = excluded.canon_revision, row_count = excluded.row_count,
        manifest_hash = excluded.manifest_hash, status = 'ready', ready_at = excluded.ready_at
    `).run(manifestId, row.owner_id, row.book_id, row.source_snapshot_id, embeddingSnapshotId,
      runtime.indexPath ?? 'data/indexes/lancedb', build.tableName, runtime.embedding.dimension,
      row.source_snapshot_id, row.owner_id, row.book_id, row.required_canon_revision, build.rows,
      build.manifestHash, now, now);
    return { rows: build.rows, sourceReady: true, scopeChecked: true, vectorProbe: true,
      tableName: build.tableName, embeddingSnapshotId, probeDistance: build.probeDistance };
  }

  private switchWatermark(row: ProjectionRow, now: string): void {
    const existing = this.database.prepare(`
      SELECT active_snapshot_id FROM projection_watermarks WHERE owner_id = ? AND book_id = ? AND projection_type = ?
    `).get(row.owner_id, row.book_id, row.projection_type) as { active_snapshot_id: string | null } | undefined;
    this.database.prepare(`
      INSERT INTO projection_watermarks (
        projection_watermark_id, owner_id, book_id, projection_type, active_snapshot_id,
        previous_snapshot_id, canon_revision, completed_source_ordinal, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'ready', ?)
      ON CONFLICT(owner_id, book_id, projection_type) DO UPDATE SET
        previous_snapshot_id = projection_watermarks.active_snapshot_id,
        active_snapshot_id = excluded.active_snapshot_id,
        canon_revision = excluded.canon_revision,
        status = 'ready', last_error_code = NULL, updated_at = excluded.updated_at
    `).run(`watermark-${randomUUID()}`, row.owner_id, row.book_id, row.projection_type,
      row.source_snapshot_id, existing?.active_snapshot_id ?? null, row.required_canon_revision, now);
  }

  private writeCapability(row: ProjectionRow, status: 'available' | 'degraded', reasonCode: string | null,
    details: Record<string, unknown>, now: string): void {
    this.database.prepare(`
      INSERT INTO book_capability_states (
        book_capability_state_id, owner_id, book_id, capability_key, status, reason_code, details_json, checked_at
      ) VALUES (?, ?, ?, 'vector-search', ?, ?, ?, ?)
      ON CONFLICT(owner_id, book_id, capability_key) DO UPDATE SET
        status = excluded.status, reason_code = excluded.reason_code,
        details_json = excluded.details_json, checked_at = excluded.checked_at
    `).run(`capability-${digest(`${row.owner_id}\0${row.book_id}\0vector-search`).slice(0, 36)}`,
      row.owner_id, row.book_id, status, reasonCode, JSON.stringify(details), now);
  }
}

function lexicalizeChinese(text: string): string {
  const tokens: string[] = [];
  for (const run of text.match(/[\p{Script=Han}]+/gu) ?? []) {
    const characters = [...run];
    tokens.push(...characters);
    for (let index = 0; index + 1 < characters.length; index += 1) tokens.push(`${characters[index]}${characters[index + 1]}`);
  }
  return `${text}\n${tokens.join(' ')}`;
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_PROJECTION_ERROR';
  return /^[A-Z][A-Z0-9_:-]{2,120}$/u.test(error.message) ? error.message : error.name.toUpperCase();
}
