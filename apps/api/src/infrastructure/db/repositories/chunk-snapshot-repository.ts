import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';
import type { ProjectionType, ProjectionWatermark, SnapshotStatus } from '../../../contracts/projections.js';

export class ChunkSnapshotRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public createSnapshot(scope: BookScope, input: {
    snapshotId: string; strategyVersion: string; normalizationVersion: string;
    embeddingTextPolicyVersion: string; canonRevision: number; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO chunk_snapshots (
        chunk_snapshot_id, owner_id, book_id, strategy_version, normalization_version,
        embedding_text_policy_version, canon_revision, coverage_json, validation_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', 'building', ?)
    `).run(input.snapshotId, scope.ownerId, scope.bookId, input.strategyVersion, input.normalizationVersion, input.embeddingTextPolicyVersion, input.canonRevision, input.now);
  }

  public addSource(scope: BookScope, input: {
    snapshotSourceId: string; snapshotId: string; sourceType: string; sourceId: string; sourceVersion: string;
    sourceHash: string; sourceBytes: number; sourceLocatorJson: string;
    lifecycleLayer: string; authorityGrade: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO chunk_snapshot_sources (
        chunk_snapshot_source_id, owner_id, book_id, chunk_snapshot_id, source_type, source_id,
        source_version, source_hash, source_bytes, source_locator_json, lifecycle_layer, authority_grade, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.snapshotSourceId, scope.ownerId, scope.bookId, input.snapshotId, input.sourceType, input.sourceId,
      input.sourceVersion, input.sourceHash, input.sourceBytes, input.sourceLocatorJson, input.lifecycleLayer, input.authorityGrade, input.now);
  }

  public addNode(scope: BookScope, input: {
    nodeId: string; snapshotId: string; sourceType: string; sourceId: string; sourceVersion: string;
    parentNodeId?: string | null; nodeType: string; title?: string | null; byteStart: number; byteEnd: number;
    ordinal: number; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO content_nodes (
        content_node_id, owner_id, book_id, chunk_snapshot_id, source_type, source_id, source_version,
        parent_node_id, node_type, title, byte_start, byte_end, ordinal, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(input.nodeId, scope.ownerId, scope.bookId, input.snapshotId, input.sourceType, input.sourceId, input.sourceVersion,
      input.parentNodeId ?? null, input.nodeType, input.title ?? null, input.byteStart, input.byteEnd, input.ordinal, input.now);
  }

  public addChunk(scope: BookScope, input: {
    chunkId: string; snapshotId: string; nodeId: string; sourceType: string; sourceId: string; sourceVersion: string;
    sourceHash: string; contentHash: string; indexTextHash: string; indexText: string; embeddingText: string;
    byteStart: number; byteEnd: number; paragraphStart: number; paragraphEnd: number;
    previousChunkId?: string | null; nextChunkId?: string | null; ordinal: number; chunkType: string;
    lifecycleLayer: string; authorityGrade: string; narrativeMode: string; canonRevision: number;
    policyVersion: string; normalizationVersion: string; embeddingTextPolicyVersion: string;
    boundaryConfidence: number; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO content_chunks (
        content_chunk_id, owner_id, book_id, chunk_snapshot_id, content_node_id, source_type, source_id,
        source_version, source_hash, content_hash, index_text_hash, index_text, embedding_text,
        byte_start, byte_end, paragraph_start, paragraph_end, previous_chunk_id, next_chunk_id, ordinal,
        chunk_type, retrieval_granularity, fts_eligible, vector_eligible, direct_injection_eligible,
        lifecycle_layer, authority_grade, narrative_mode, canon_revision, chunk_policy_version,
        normalization_version, embedding_text_policy_version, boundary_confidence, validation_status,
        retention_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'leaf', 1, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', 'rebuildable', ?)
    `).run(
      input.chunkId, scope.ownerId, scope.bookId, input.snapshotId, input.nodeId, input.sourceType, input.sourceId,
      input.sourceVersion, input.sourceHash, input.contentHash, input.indexTextHash, input.indexText, input.embeddingText,
      input.byteStart, input.byteEnd, input.paragraphStart, input.paragraphEnd, input.previousChunkId ?? null,
      input.nextChunkId ?? null, input.ordinal, input.chunkType, input.lifecycleLayer, input.authorityGrade,
      input.narrativeMode, input.canonRevision, input.policyVersion, input.normalizationVersion,
      input.embeddingTextPolicyVersion, input.boundaryConfidence, input.now
    );
  }

  public replaceFts(scope: BookScope, snapshotId: string): number {
    assertBookScope(scope);
    this.database.prepare(`DELETE FROM content_chunks_fts WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ?`)
      .run(scope.ownerId, scope.bookId, snapshotId);
    const rows = this.database.prepare(`
      SELECT content_chunk_id, index_text FROM content_chunks
      WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ? AND fts_eligible = 1 AND validation_status = 'valid'
      ORDER BY ordinal
    `).all(scope.ownerId, scope.bookId, snapshotId) as unknown as Array<{ content_chunk_id: string; index_text: string }>;
    const insert = this.database.prepare(`
      INSERT INTO content_chunks_fts(content_chunk_id, owner_id, book_id, chunk_snapshot_id, index_text)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of rows) insert.run(row.content_chunk_id, scope.ownerId, scope.bookId, snapshotId, lexicalizeChinese(row.index_text));
    return rows.length;
  }

  public completeSnapshot(scope: BookScope, snapshotId: string, input: {
    expected: SnapshotStatus; next: SnapshotStatus; sourceCount: number; nodeCount: number; chunkCount: number;
    coverageJson: string; validationJson: string; now: string; failureCode?: string | null;
  }): void {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE chunk_snapshots SET source_count = ?, node_count = ?, chunk_count = ?, coverage_json = ?,
        validation_json = ?, status = ?, failure_code = ?, validated_at = CASE WHEN ? IN ('validated','ready') THEN ? ELSE validated_at END,
        ready_at = CASE WHEN ? = 'ready' THEN ? ELSE ready_at END
      WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ? AND status = ?
    `).run(input.sourceCount, input.nodeCount, input.chunkCount, input.coverageJson, input.validationJson,
      input.next, input.failureCode ?? null, input.next, input.now, input.next, input.now,
      scope.ownerId, scope.bookId, snapshotId, input.expected);
    if (result.changes !== 1) throw new Error('切片快照状态已变化或对象越权');
  }

  public switchWatermark(scope: BookScope, input: {
    watermarkId: string; projectionType: ProjectionType; snapshotId: string; canonRevision: number; now: string;
  }): ProjectionWatermark {
    assertBookScope(scope);
    const snapshot = this.database.prepare(`
      SELECT status, canon_revision FROM chunk_snapshots WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ?
    `).get(scope.ownerId, scope.bookId, input.snapshotId) as { status: string; canon_revision: number } | undefined;
    if (snapshot?.status !== 'ready' || snapshot.canon_revision !== input.canonRevision) throw new Error('只有同水位ready快照可以切换');
    const previous = this.database.prepare(`
      SELECT active_snapshot_id FROM projection_watermarks WHERE owner_id = ? AND book_id = ? AND projection_type = ?
    `).get(scope.ownerId, scope.bookId, input.projectionType) as { active_snapshot_id: string | null } | undefined;
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
    `).run(input.watermarkId, scope.ownerId, scope.bookId, input.projectionType, input.snapshotId,
      previous?.active_snapshot_id ?? null, input.canonRevision, input.now);
    return this.requireWatermark(scope, input.projectionType);
  }

  public requireWatermark(scope: BookScope, projectionType: ProjectionType): ProjectionWatermark {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT projection_type, active_snapshot_id, previous_snapshot_id, canon_revision, status
      FROM projection_watermarks WHERE owner_id = ? AND book_id = ? AND projection_type = ?
    `).get(scope.ownerId, scope.bookId, projectionType) as {
      projection_type: ProjectionType; active_snapshot_id: string | null; previous_snapshot_id: string | null;
      canon_revision: number; status: ProjectionWatermark['status'];
    } | undefined;
    if (row === undefined) throw new Error('投影水位不存在或越权');
    return { projectionType: row.projection_type, activeSnapshotId: row.active_snapshot_id,
      previousSnapshotId: row.previous_snapshot_id, canonRevision: row.canon_revision, status: row.status };
  }

  public searchFts(scope: BookScope, snapshotId: string, query: string, limit: number): Array<{ chunkId: string; rank: number; text: string }> {
    assertBookScope(scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('FTS返回数量无效');
    return this.database.prepare(`
      SELECT f.content_chunk_id AS chunkId, bm25(content_chunks_fts) AS rank, c.index_text AS text
      FROM content_chunks_fts f JOIN content_chunks c ON c.content_chunk_id = f.content_chunk_id
        AND c.owner_id = f.owner_id AND c.book_id = f.book_id AND c.chunk_snapshot_id = f.chunk_snapshot_id
      WHERE content_chunks_fts MATCH ? AND f.owner_id = ? AND f.book_id = ? AND f.chunk_snapshot_id = ?
      ORDER BY rank LIMIT ?
    `).all(ftsQuery(query), scope.ownerId, scope.bookId, snapshotId, limit) as unknown as Array<{ chunkId: string; rank: number; text: string }>;
  }
}

function lexicalizeChinese(text: string): string {
  const cjkRuns = text.match(/[\p{Script=Han}]+/gu) ?? [];
  const tokens: string[] = [];
  for (const run of cjkRuns) {
    const characters = [...run];
    tokens.push(...characters);
    for (let index = 0; index + 1 < characters.length; index += 1) tokens.push(`${characters[index]}${characters[index + 1]}`);
  }
  return `${text}\n${tokens.join(' ')}`;
}

function ftsQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) throw new Error('FTS查询不能为空');
  const tokens = trimmed.match(/[\p{Script=Han}]{1,2}|[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.length === 0) throw new Error('FTS查询没有有效词元');
  return [...new Set(tokens)].map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
}
