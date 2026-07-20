import { afterEach, describe, expect, it } from 'vitest';
import { BookLifecycleService } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { BackupService } from '../../../apps/api/src/infrastructure/recovery/backup-service.js';
import { PromotionService } from '../../../apps/api/src/infrastructure/recovery/promotion-service.js';
import { requiredPermanentDeleteText } from '../../../apps/api/src/domain/permanent-delete.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('一致性备份与临时恢复验证', () => {
  it('恢复数据库和不可变文件并逐项核对哈希', () => {
    context = createTestContext();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    lifecycle.ensureOwner(scope);
    lifecycle.createDraft(scope, '甲书');
    const promotion = new PromotionService(context.database, context.dataDir, new FixedClock());
    const staged = promotion.stageText('task-alpha', '可恢复的不可变正文');
    promotion.promote(scope, { ...staged, operationId: 'operation-alpha', fileId: 'file-alpha', chapterId: 'chapter-001', versionId: 'version-001' });

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
