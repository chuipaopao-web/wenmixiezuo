import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertOwnerScope, type OwnerScope } from '../../domain/scope.js';
import { portableRelative, resolveInside, sha256File } from '../../infrastructure/files/file-utils.js';

export type QuarantineKind = 'import' | 'restore';

export interface QuarantineRecord {
  quarantineId: string;
  sourceHash: string;
  storedRelativePath: string;
  status: 'pending' | 'validated' | 'rejected';
}

export class QuarantineService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public register(scope: OwnerScope, sourcePath: string, kind: QuarantineKind, intendedBookId: string | null): QuarantineRecord {
    assertOwnerScope(scope);
    const quarantineId = this.ids.next();
    const sourceHash = sha256File(sourcePath);
    const extension = kind === 'import' ? '.import' : '.restore';
    const targetPath = resolveInside(this.dataDir, `quarantine/${quarantineId}/${sourceHash}${extension}`);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    if (sha256File(targetPath) !== sourceHash || statSync(targetPath).size !== statSync(sourcePath).size) {
      throw new Error('隔离区复制校验失败');
    }
    const now = this.clock.now().toISOString();
    const relativePath = portableRelative(this.dataDir, targetPath);
    this.database.prepare(`
      INSERT INTO quarantine_items (
        quarantine_id, owner_id, intended_book_id, kind, source_path, source_hash,
        status, validation_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', '{}', ?, ?)
    `).run(quarantineId, scope.ownerId, intendedBookId, kind, relativePath, sourceHash, now, now);
    return { quarantineId, sourceHash, storedRelativePath: relativePath, status: 'pending' };
  }

  public recordValidation(scope: OwnerScope, quarantineId: string, valid: boolean, checks: Record<string, unknown>): void {
    assertOwnerScope(scope);
    const item = this.database.prepare(`
      SELECT intended_book_id FROM quarantine_items WHERE quarantine_id = ? AND owner_id = ? AND status = 'pending'
    `).get(quarantineId, scope.ownerId) as { intended_book_id: string | null } | undefined;
    if (item === undefined) throw new Error('隔离项不存在、越权或已经处理');
    if (valid && item.intended_book_id !== null) {
      const tombstone = this.database.prepare(`
        SELECT 1 FROM deletion_tombstones WHERE owner_id = ? AND deleted_book_id = ?
      `).get(scope.ownerId, item.intended_book_id);
      if (tombstone !== undefined) throw new Error('删除墓碑禁止隔离项恢复已删除书籍');
    }
    const result = this.database.prepare(`
      UPDATE quarantine_items SET status = ?, validation_json = ?, updated_at = ?
      WHERE quarantine_id = ? AND owner_id = ? AND status = 'pending'
    `).run(valid ? 'validated' : 'rejected', JSON.stringify(checks), this.clock.now().toISOString(), quarantineId, scope.ownerId);
    if (result.changes !== 1) throw new Error('隔离项不存在、越权或已经处理');
  }
}
