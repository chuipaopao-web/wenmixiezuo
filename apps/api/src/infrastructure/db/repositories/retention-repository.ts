import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export type RetentionClass = 'hot' | 'archive' | 'grace' | 'rebuildable';
export type RetentionStatus = 'planned' | 'archived' | 'cleanup_eligible' | 'cleaned' | 'restored' | 'failed';

export interface RetentionRecord {
  retentionRecordId: string;
  objectType: string;
  objectId: string;
  retentionClass: RetentionClass;
  archiveReference: string | null;
  checksum: string | null;
  graceExpiresAt: string | null;
  executionStatus: RetentionStatus;
}

export class RetentionRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public plan(scope: BookScope, input: {
    retentionRecordId: string; objectType: string; objectId: string; retentionClass: RetentionClass;
    archiveReference?: string | null; checksum?: string | null; graceExpiresAt?: string | null;
    reason: string; status: RetentionStatus; now: string;
  }): RetentionRecord {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO retention_records (
        retention_record_id, owner_id, book_id, object_type, object_id, retention_class,
        archive_reference, checksum, grace_expires_at, reason, execution_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, book_id, object_type, object_id) DO UPDATE SET
        retention_class = excluded.retention_class,
        archive_reference = excluded.archive_reference,
        checksum = excluded.checksum,
        grace_expires_at = excluded.grace_expires_at,
        reason = excluded.reason,
        execution_status = excluded.execution_status,
        updated_at = excluded.updated_at
    `).run(
      input.retentionRecordId, scope.ownerId, scope.bookId, input.objectType, input.objectId,
      input.retentionClass, input.archiveReference ?? null, input.checksum ?? null,
      input.graceExpiresAt ?? null, input.reason, input.status, input.now, input.now
    );
    return this.require(scope, input.objectType, input.objectId);
  }

  public transition(scope: BookScope, objectType: string, objectId: string, expected: RetentionStatus, next: RetentionStatus, now: string, restoreResult?: unknown): RetentionRecord {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE retention_records SET execution_status = ?, restore_result_json = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND object_type = ? AND object_id = ? AND execution_status = ?
    `).run(next, restoreResult === undefined ? null : JSON.stringify(restoreResult), now, scope.ownerId, scope.bookId, objectType, objectId, expected);
    if (result.changes !== 1) throw new Error('保留记录状态已经变化或对象越权');
    return this.require(scope, objectType, objectId);
  }

  public require(scope: BookScope, objectType: string, objectId: string): RetentionRecord {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT retention_record_id, object_type, object_id, retention_class, archive_reference,
             checksum, grace_expires_at, execution_status
      FROM retention_records WHERE owner_id = ? AND book_id = ? AND object_type = ? AND object_id = ?
    `).get(scope.ownerId, scope.bookId, objectType, objectId) as {
      retention_record_id: string; object_type: string; object_id: string; retention_class: RetentionClass;
      archive_reference: string | null; checksum: string | null; grace_expires_at: string | null;
      execution_status: RetentionStatus;
    } | undefined;
    if (row === undefined) throw new Error('保留记录不存在或越权');
    return {
      retentionRecordId: row.retention_record_id, objectType: row.object_type, objectId: row.object_id,
      retentionClass: row.retention_class, archiveReference: row.archive_reference, checksum: row.checksum,
      graceExpiresAt: row.grace_expires_at, executionStatus: row.execution_status
    };
  }
}
