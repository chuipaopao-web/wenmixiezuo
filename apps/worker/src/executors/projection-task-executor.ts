import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

interface ProjectionRow {
  projection_outbox_id: string;
  owner_id: string;
  book_id: string;
  projection_type: string;
  source_snapshot_id: string;
  required_canon_revision: number;
}

export class ProjectionTaskExecutor {
  public constructor(private readonly database: DatabaseSync, private readonly workerId: string) {}

  public runNext(now = new Date()): boolean {
    const row = this.claim(now);
    if (row === null) return false;
    const jobId = `projection-${randomUUID()}`;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      this.database.prepare(`
        INSERT INTO projection_jobs (
          projection_job_id, owner_id, book_id, projection_outbox_id, projection_type,
          source_snapshot_id, worker_id, status, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', ?, ?, ?)
      `).run(jobId, row.owner_id, row.book_id, row.projection_outbox_id, row.projection_type,
        row.source_snapshot_id, this.workerId, now.toISOString(), now.toISOString(), now.toISOString());
      const probes = this.execute(row);
      this.switchWatermark(row, now.toISOString());
      this.database.prepare(`
        UPDATE projection_jobs SET status = 'ready', probe_result_json = ?, finished_at = ?, updated_at = ?
        WHERE projection_job_id = ?
      `).run(JSON.stringify(probes), now.toISOString(), now.toISOString(), jobId);
      this.database.prepare(`UPDATE projection_outbox SET status = 'completed', updated_at = ? WHERE projection_outbox_id = ?`)
        .run(now.toISOString(), row.projection_outbox_id);
      this.database.exec('COMMIT');
      return true;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database.prepare(`
          INSERT OR REPLACE INTO projection_jobs (
            projection_job_id, owner_id, book_id, projection_outbox_id, projection_type,
            source_snapshot_id, worker_id, status, error_code, started_at, finished_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?, ?)
        `).run(jobId, row.owner_id, row.book_id, row.projection_outbox_id, row.projection_type,
          row.source_snapshot_id, this.workerId, error instanceof Error ? error.name : 'UNKNOWN',
          now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString());
        this.database.prepare(`UPDATE projection_outbox SET status = 'failed', updated_at = ? WHERE projection_outbox_id = ?`)
          .run(now.toISOString(), row.projection_outbox_id);
        this.database.exec('COMMIT');
      } catch (writeError) {
        if (this.database.isTransaction) this.database.exec('ROLLBACK');
        throw writeError;
      }
      return true;
    }
  }

  private claim(now: Date): ProjectionRow | null {
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
      this.database.exec('COMMIT');
      return row;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private execute(row: ProjectionRow): Record<string, unknown> {
    const snapshot = this.database.prepare(`
      SELECT status, canon_revision FROM chunk_snapshots
      WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ?
    `).get(row.owner_id, row.book_id, row.source_snapshot_id) as { status: string; canon_revision: number } | undefined;
    if (snapshot?.status !== 'ready' || snapshot.canon_revision !== row.required_canon_revision) throw new Error('PROJECTION_SOURCE_NOT_READY');
    if (row.projection_type !== 'fts') throw new Error('PROJECTION_EXECUTOR_NOT_AVAILABLE');
    this.database.prepare(`DELETE FROM content_chunks_fts WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ?`)
      .run(row.owner_id, row.book_id, row.source_snapshot_id);
    const chunks = this.database.prepare(`
      SELECT content_chunk_id, index_text FROM content_chunks
      WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ? AND validation_status = 'valid' AND fts_eligible = 1
      ORDER BY ordinal
    `).all(row.owner_id, row.book_id, row.source_snapshot_id) as unknown as Array<{ content_chunk_id: string; index_text: string }>;
    const insert = this.database.prepare(`INSERT INTO content_chunks_fts(content_chunk_id, owner_id, book_id, chunk_snapshot_id, index_text) VALUES (?, ?, ?, ?, ?)`);
    for (const chunk of chunks) insert.run(chunk.content_chunk_id, row.owner_id, row.book_id, row.source_snapshot_id, lexicalizeChinese(chunk.index_text));
    return { rows: chunks.length, sourceReady: true, scopeChecked: true, ftsProbe: chunks.length > 0 };
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
