import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BookLifecycleService } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { BackupService } from '../../../apps/api/src/infrastructure/recovery/backup-service.js';
import { requiredPermanentDeleteText } from '../../../apps/api/src/domain/permanent-delete.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeV7Book } from '../../helpers/v7-book-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('一致性备份与临时恢复验证', () => {
  it('恢复数据库和不可变文件并逐项核对哈希', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeV7Book(context, 'owner-one', ids, clock, { title: '甲书' });
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const content = '可恢复的不可变正文';
    const relativePath = `books/${scope.ownerId}/${scope.bookId}/manuscripts/version-001.txt`;
    const filePath = resolve(context.dataDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
    const hash = createHash('sha256').update(content, 'utf8').digest('hex');
    context.database.prepare(`INSERT INTO operations (
      operation_id,owner_id,book_id,operation_type,status,payload_json,created_at,updated_at
    ) VALUES (?,?,?,'v7_formalize','succeeded','{}',?,?)`).run(
      'operation-alpha', scope.ownerId, scope.bookId, clock.now().toISOString(), clock.now().toISOString()
    );
    context.database.prepare(`INSERT INTO file_registry (
      file_id,owner_id,book_id,chapter_id,version_id,relative_path,content_hash,size_bytes,status,operation_id,created_at
    ) VALUES (?,?,?,NULL,?,?,?,?,'active',?,?)`).run(
      'file-alpha', scope.ownerId, scope.bookId, 'version-001', relativePath, hash,
      Buffer.byteLength(content), 'operation-alpha', clock.now().toISOString()
    );

    const backups = new BackupService(context.database, context.config);
    const created = backups.create();
    const verified = backups.verify(created.backupId);
    expect(created.fileCount).toBe(1);
    expect(verified.verified).toBe(true);
    expect(verified.fileCount).toBe(1);
    const row = context.database.prepare('SELECT status, database_hash, manifest_hash FROM backups WHERE backup_id = ?')
      .get(created.backupId) as { status: string; database_hash: string; manifest_hash: string };
    expect(row.status).toBe('verified');
    expect(row.database_hash).toHaveLength(64);
    expect(row.manifest_hash).toHaveLength(64);
    backups.discardVerification(verified.restorePath);
  });

  it('当前删除墓碑阻止旧备份复活测试书', () => {
    context = createTestContext();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    lifecycle.ensureOwner(scope);
    lifecycle.createDraft(scope, '甲书');
    const backups = new BackupService(context.database, context.config);
    const created = backups.create();
    lifecycle.archive(scope, 1);
    lifecycle.permanentlyDelete(scope, requiredPermanentDeleteText('甲书', scope.bookId));
    expect(() => backups.verify(created.backupId)).toThrow('墓碑禁止备份复活');
  });

  it('清单已经落盘但状态仍为creating时可恢复验证，不要求重新复制备份', () => {
    context = createTestContext();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    lifecycle.ensureOwner(scope);
    lifecycle.createDraft(scope, '甲书');
    const backups = new BackupService(context.database, context.config);
    const created = backups.create();
    context.database.prepare(`UPDATE backups SET status = 'creating', database_hash = NULL,
      manifest_hash = NULL, file_count = 0 WHERE backup_id = ?`).run(created.backupId);

    const verified = backups.verify(created.backupId);
    expect(verified.verified).toBe(true);
    expect(context.database.prepare(`SELECT status, database_hash, manifest_hash FROM backups WHERE backup_id = ?`)
      .get(created.backupId)).toEqual({
        status: 'verified',
        database_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        manifest_hash: expect.stringMatching(/^[a-f0-9]{64}$/u)
      });
    backups.discardVerification(verified.restorePath);
  });
});
