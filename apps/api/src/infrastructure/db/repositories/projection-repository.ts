import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';
import type { ProjectionType } from '../../../contracts/projections.js';

export class ProjectionRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public clearLegacyDerived(scope: BookScope): void {
    assertBookScope(scope);
    this.database.prepare('DELETE FROM character_state_projection WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
    this.database.prepare('DELETE FROM timeline_projection WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
    this.database.prepare('DELETE FROM relationship_projection WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
  }

  public enqueue(scope: BookScope, input: {
    outboxId: string; projectionType: ProjectionType; sourceSnapshotId: string;
    requiredCanonRevision: number; idempotencyKey: string; payloadJson: string; now: string;
  }): { outboxId: string; created: boolean } {
    assertBookScope(scope);
    const existing = this.database.prepare(`
      SELECT projection_outbox_id FROM projection_outbox
      WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?
    `).get(scope.ownerId, scope.bookId, input.idempotencyKey) as { projection_outbox_id: string } | undefined;
    if (existing !== undefined) return { outboxId: existing.projection_outbox_id, created: false };
    this.database.prepare(`
      INSERT INTO projection_outbox (
        projection_outbox_id, owner_id, book_id, projection_type, source_snapshot_id,
        required_canon_revision, idempotency_key, payload_json, status, attempts, available_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    `).run(input.outboxId, scope.ownerId, scope.bookId, input.projectionType, input.sourceSnapshotId,
      input.requiredCanonRevision, input.idempotencyKey, input.payloadJson, input.now, input.now, input.now);
    return { outboxId: input.outboxId, created: true };
  }

  public claim(scope: BookScope, outboxId: string, jobId: string, workerId: string, now: string): void {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT projection_type, source_snapshot_id FROM projection_outbox
      WHERE owner_id = ? AND book_id = ? AND projection_outbox_id = ? AND status = 'pending' AND available_at <= ?
    `).get(scope.ownerId, scope.bookId, outboxId, now) as { projection_type: string; source_snapshot_id: string } | undefined;
    if (row === undefined) throw new Error('投影任务不可领取或对象越权');
    this.database.prepare(`UPDATE projection_outbox SET status = 'claimed', attempts = attempts + 1, updated_at = ? WHERE projection_outbox_id = ?`)
      .run(now, outboxId);
    this.database.prepare(`
      INSERT INTO projection_jobs (
        projection_job_id, owner_id, book_id, projection_outbox_id, projection_type,
        source_snapshot_id, worker_id, status, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', ?, ?, ?)
    `).run(jobId, scope.ownerId, scope.bookId, outboxId, row.projection_type, row.source_snapshot_id, workerId, now, now, now);
  }

  public complete(scope: BookScope, outboxId: string, jobId: string, probeResultJson: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE projection_jobs SET status = 'ready', probe_result_json = ?, finished_at = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND projection_job_id = ? AND projection_outbox_id = ? AND status IN ('building','validating')
    `).run(probeResultJson, now, now, scope.ownerId, scope.bookId, jobId, outboxId);
    if (result.changes !== 1) throw new Error('投影任务状态已经变化');
    this.database.prepare(`UPDATE projection_outbox SET status = 'completed', updated_at = ? WHERE projection_outbox_id = ? AND status = 'claimed'`)
      .run(now, outboxId);
  }

  public fail(scope: BookScope, outboxId: string, jobId: string, errorCode: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE projection_jobs SET status = 'failed', error_code = ?, finished_at = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND projection_job_id = ? AND projection_outbox_id = ?
    `).run(errorCode, now, now, scope.ownerId, scope.bookId, jobId, outboxId);
    this.database.prepare(`UPDATE projection_outbox SET status = 'failed', updated_at = ? WHERE projection_outbox_id = ?`)
      .run(now, outboxId);
  }
}
