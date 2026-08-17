import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export type BookBrandingDesignKind = 'title' | 'synopsis';

export interface BookBrandingDesignRow {
  design_id: string;
  owner_id: string;
  book_id: string;
  kind: BookBrandingDesignKind;
  task_id: string;
  status: 'working' | 'succeeded' | 'failed' | 'cancelled';
  options_json: string;
  source_fingerprint: string;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface FirstVolumePlanSnapshot {
  volumePlanId: string;
  planNumber: number;
  status: string;
  activeVersionId: string | null;
  activeVersionContent: string | null;
  activeVersionHash: string | null;
}

export class BookBrandingDesignRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public firstVolumePlan(scope: BookScope): FirstVolumePlanSnapshot | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT p.volume_plan_id, p.plan_number, p.status, p.active_version_id,
        v.content_json AS active_version_content, v.content_hash AS active_version_hash
      FROM volume_plans p
      LEFT JOIN volume_plan_versions v
        ON v.owner_id = p.owner_id AND v.book_id = p.book_id
       AND v.volume_plan_id = p.volume_plan_id AND v.volume_plan_version_id = p.active_version_id
      WHERE p.owner_id = ? AND p.book_id = ? AND p.plan_number = 1
      LIMIT 1
    `).get(scope.ownerId, scope.bookId) as {
      volume_plan_id: string; plan_number: number; status: string;
      active_version_id: string | null;
      active_version_content: string | null; active_version_hash: string | null;
    } | undefined;
    if (row === undefined) return undefined;
    return {
      volumePlanId: row.volume_plan_id,
      planNumber: row.plan_number,
      status: row.status,
      activeVersionId: row.active_version_id,
      activeVersionContent: row.active_version_content,
      activeVersionHash: row.active_version_hash
    };
  }

  public insert(scope: BookScope, input: {
    designId: string;
    kind: BookBrandingDesignKind;
    taskId: string;
    sourceFingerprint: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO book_branding_designs (
        design_id, owner_id, book_id, kind, task_id, status, options_json,
        source_fingerprint, error_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'working', '[]', ?, NULL, ?, ?)
    `).run(
      input.designId, scope.ownerId, scope.bookId, input.kind, input.taskId,
      input.sourceFingerprint, input.now, input.now
    );
  }

  public findById(scope: BookScope, designId: string): BookBrandingDesignRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT * FROM book_branding_designs
      WHERE owner_id = ? AND book_id = ? AND design_id = ?
    `).get(scope.ownerId, scope.bookId, designId) as BookBrandingDesignRow | undefined;
  }

  public findByTask(scope: BookScope, taskId: string): BookBrandingDesignRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT * FROM book_branding_designs
      WHERE owner_id = ? AND book_id = ? AND task_id = ?
    `).get(scope.ownerId, scope.bookId, taskId) as BookBrandingDesignRow | undefined;
  }

  public latest(scope: BookScope, kind: BookBrandingDesignKind): BookBrandingDesignRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT * FROM book_branding_designs
      WHERE owner_id = ? AND book_id = ? AND kind = ?
      ORDER BY created_at DESC, design_id DESC
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, kind) as BookBrandingDesignRow | undefined;
  }

  public working(scope: BookScope, kind: BookBrandingDesignKind): BookBrandingDesignRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT * FROM book_branding_designs
      WHERE owner_id = ? AND book_id = ? AND kind = ? AND status = 'working'
      ORDER BY created_at DESC, design_id DESC
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, kind) as BookBrandingDesignRow | undefined;
  }

  public markSucceeded(scope: BookScope, designId: string, optionsJson: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE book_branding_designs
      SET status = 'succeeded', options_json = ?, error_code = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND design_id = ?
    `).run(optionsJson, now, scope.ownerId, scope.bookId, designId);
  }

  public markFailed(scope: BookScope, designId: string, errorCode: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE book_branding_designs
      SET status = 'failed', error_code = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND design_id = ?
    `).run(errorCode, now, scope.ownerId, scope.bookId, designId);
  }

  public markCancelled(scope: BookScope, designId: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE book_branding_designs
      SET status = 'cancelled', updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND design_id = ? AND status = 'working'
    `).run(now, scope.ownerId, scope.bookId, designId);
  }
}
