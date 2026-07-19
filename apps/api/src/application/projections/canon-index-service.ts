import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ChunkSnapshotRepository } from '../../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { ProjectionRepository } from '../../infrastructure/db/repositories/projection-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';
import { ChunkSnapshotService, type ChunkSourceInput } from '../memory/chunk-snapshot-service.js';
import { StructuralChunker } from '../memory/structural-chunker.js';
import { ProjectionJobService } from './projection-job-service.js';

interface IndexRequestRow {
  canon_revision: number;
  status: string;
  worker_id: string | null;
}

export class CanonIndexService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public executeClaimed(scope: BookScope, requestId: string, workerId: string): {
    status: 'completed' | 'superseded'; snapshotId: string | null; sourceCount: number;
  } {
    assertBookScope(scope);
    const request = this.database.prepare(`
      SELECT canon_revision, status, worker_id FROM canon_index_requests
      WHERE canon_index_request_id = ? AND owner_id = ? AND book_id = ?
    `).get(requestId, scope.ownerId, scope.bookId) as IndexRequestRow | undefined;
    if (request === undefined || request.status !== 'claimed' || request.worker_id !== workerId) {
      throw new Error('正史索引请求未由指定Worker持有');
    }
    const book = this.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number } | undefined;
    if (book === undefined) throw new Error('书籍不存在或越权');
    if (book.canon_revision !== request.canon_revision) {
      const result = this.database.prepare(`
        UPDATE canon_index_requests SET status = 'superseded', claimed_at = NULL, updated_at = ?, completed_at = ?
        WHERE canon_index_request_id = ? AND owner_id = ? AND book_id = ? AND status = 'claimed' AND worker_id = ?
      `).run(this.clock.now().toISOString(), this.clock.now().toISOString(), requestId,
        scope.ownerId, scope.bookId, workerId);
      if (result.changes !== 1) throw new Error('正史索引请求状态冲突');
      return { status: 'superseded', snapshotId: null, sourceCount: 0 };
    }

    const sources = this.loadAuthoritySources(scope, request.canon_revision);
    const existing = this.database.prepare(`
      SELECT chunk_snapshot_id FROM chunk_snapshots
      WHERE owner_id = ? AND book_id = ? AND canon_revision = ? AND status = 'ready'
      ORDER BY ready_at DESC, created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, request.canon_revision) as { chunk_snapshot_id: string } | undefined;
    const snapshotId = existing?.chunk_snapshot_id ?? new ChunkSnapshotService(
      new ChunkSnapshotRepository(this.database), new UnitOfWork(this.database), new StructuralChunker(), this.ids, this.clock
    ).buildMany(scope, sources, request.canon_revision).snapshotId;

    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const jobs = new ProjectionJobService(
        new ProjectionRepository(this.database), new UnitOfWork(this.database), this.ids, this.clock
      );
      for (const projectionType of ['fts', 'vector'] as const) {
        jobs.enqueue(scope, {
          projectionType,
          sourceSnapshotId: snapshotId,
          requiredCanonRevision: request.canon_revision,
          idempotencyKey: `canon:${request.canon_revision}:${snapshotId}:${projectionType}`,
          payload: { trigger: 'canon_settlement', requestId }
        });
      }
      const completed = this.database.prepare(`
        UPDATE canon_index_requests SET status = 'completed', worker_id = NULL, claimed_at = NULL, chunk_snapshot_id = ?,
          error_code = NULL, updated_at = ?, completed_at = ?
        WHERE canon_index_request_id = ? AND owner_id = ? AND book_id = ? AND status = 'claimed' AND worker_id = ?
      `).run(snapshotId, now, now, requestId, scope.ownerId, scope.bookId, workerId);
      if (completed.changes !== 1) throw new Error('正史索引请求完成栅栏被拒绝');
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return { status: 'completed', snapshotId, sourceCount: sources.length };
  }

  private loadAuthoritySources(scope: BookScope, canonRevision: number): ChunkSourceInput[] {
    const manuscripts = this.database.prepare(`
      SELECT m.manuscript_version_id, m.content_hash, f.relative_path, c.chapter_number, c.title
      FROM chapters c
      JOIN manuscript_versions m ON m.manuscript_version_id = c.canon_manuscript_version_id
        AND m.owner_id = c.owner_id AND m.book_id = c.book_id AND m.status = 'canon'
      JOIN file_registry f ON f.file_id = m.file_id AND f.owner_id = m.owner_id AND f.book_id = m.book_id AND f.status = 'active'
      WHERE c.owner_id = ? AND c.book_id = ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      manuscript_version_id: string; content_hash: string; relative_path: string; chapter_number: number; title: string;
    }>;
    const sources: ChunkSourceInput[] = manuscripts.map((row) => {
      const content = readFileSync(resolveInside(this.dataDir, row.relative_path), 'utf8').normalize('NFC');
      if (sha256(content) !== row.content_hash) throw new Error(`正史正文文件哈希不匹配：${row.manuscript_version_id}`);
      return {
        sourceType: 'manuscript', sourceId: row.manuscript_version_id, sourceVersion: row.content_hash,
        content, sourceHash: row.content_hash,
        sourceLocator: { manuscriptVersionId: row.manuscript_version_id, chapterNumber: row.chapter_number },
        lifecycleLayer: 'canon', authorityGrade: 'D', title: `第${row.chapter_number}章 ${row.title}`,
        embeddingHeader: `正史正文 第${row.chapter_number}章 ${row.title}`
      };
    });
    const artifacts = this.database.prepare(`
      SELECT a.artifact_type, a.title, v.artifact_version_id, v.version, v.content_json
      FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.status = 'active' AND v.status = 'selected'
      ORDER BY a.artifact_type, a.title
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      artifact_type: string; title: string; artifact_version_id: string; version: number; content_json: string;
    }>;
    for (const row of artifacts) {
      const content = row.content_json.normalize('NFC');
      sources.push({
        sourceType: row.artifact_type.includes('outline') ? 'outline' : 'setting',
        sourceId: row.artifact_version_id, sourceVersion: String(row.version), content, sourceHash: sha256(content),
        sourceLocator: { artifactVersionId: row.artifact_version_id, artifactType: row.artifact_type },
        lifecycleLayer: 'canon', authorityGrade: 'D', title: row.title,
        embeddingHeader: `${row.artifact_type} ${row.title}`
      });
    }
    const facts = this.database.prepare(`
      SELECT f.fact_id, f.relation_key, f.value_json, f.grade, e.canonical_name
      FROM fact_assertions f JOIN entities e ON e.entity_id = f.subject_entity_id
        AND e.owner_id = f.owner_id AND e.book_id = f.book_id
      WHERE f.owner_id = ? AND f.book_id = ? AND f.status = 'active'
      ORDER BY e.canonical_name, f.relation_key, f.fact_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      fact_id: string; relation_key: string; value_json: string; grade: 'A' | 'B' | 'C' | 'D'; canonical_name: string;
    }>;
    for (const row of facts) {
      const content = `${row.canonical_name} ${row.relation_key} ${row.value_json}`.normalize('NFC');
      sources.push({
        sourceType: 'fact', sourceId: row.fact_id, sourceVersion: String(canonRevision), content,
        sourceHash: sha256(content), sourceLocator: { factId: row.fact_id, canonRevision },
        lifecycleLayer: 'canon', authorityGrade: row.grade, title: `${row.canonical_name}·${row.relation_key}`,
        embeddingHeader: `正史事实 ${row.canonical_name} ${row.relation_key}`
      });
    }
    if (sources.length === 0) throw new Error('正史索引请求没有可切片的权威来源');
    return sources;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
