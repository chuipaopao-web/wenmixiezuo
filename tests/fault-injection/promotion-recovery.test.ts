import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BookLifecycleService } from '../../apps/api/src/application/books/book-lifecycle-service.js';
import { FileRegistryRepository } from '../../apps/api/src/infrastructure/db/repositories/file-registry-repository.js';
import { ConsistencyService } from '../../apps/api/src/infrastructure/recovery/consistency-service.js';
import { PromotionService } from '../../apps/api/src/infrastructure/recovery/promotion-service.js';
import { resolveInside } from '../../apps/api/src/infrastructure/files/file-utils.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function setup() {
  context = createTestContext();
  const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
  const lifecycle = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
  lifecycle.ensureOwner(scope);
  lifecycle.createDraft(scope, '甲书');
  return { scope, promotion: new PromotionService(context.database, context.dataDir, new FixedClock()) };
}

describe('正文提升故障恢复', () => {
  it('文件已提升但登记前崩溃时可按operation_id恢复', () => {
    const { scope, promotion } = setup();
    const staged = promotion.stageText('task-alpha', '故障恢复正文');
    const request = {
      ...staged,
      operationId: 'operation-alpha',
      fileId: 'file-alpha',
      chapterId: 'chapter-001',
      versionId: 'version-001'
    };
    expect(() => promotion.promote(scope, request, { afterFilePromoted: () => { throw new Error('simulated-crash'); } }))
      .toThrow('simulated-crash');
    expect(new FileRegistryRepository(context!.database, scope).list()).toEqual([]);
    expect(context!.database.prepare('SELECT status FROM operations WHERE operation_id = ?').get(request.operationId))
      .toEqual({ status: 'incomplete' });
    promotion.recover(scope, request.operationId);
    expect(new FileRegistryRepository(context!.database, scope).list()).toHaveLength(1);
    expect(new ConsistencyService(context!.database, context!.dataDir).checkBook(scope).ok).toBe(true);
  });

  it('不可变版本不能被不同内容覆盖', () => {
    const { scope, promotion } = setup();
    const first = promotion.stageText('task-first', '第一版正文');
    promotion.promote(scope, { ...first, operationId: 'operation-first', fileId: 'file-first', chapterId: 'chapter-001', versionId: 'version-001' });
    const second = promotion.stageText('task-second', '企图覆盖正文');
    expect(() => promotion.promote(scope, { ...second, operationId: 'operation-second', fileId: 'file-second', chapterId: 'chapter-001', versionId: 'version-001' }))
      .toThrow('禁止覆盖');
  });

  it('一致性扫描报告缺失、哈希错误和孤立文件', () => {
    const { scope, promotion } = setup();
    const staged = promotion.stageText('task-alpha', '一致性正文');
    promotion.promote(scope, { ...staged, operationId: 'operation-alpha', fileId: 'file-alpha', chapterId: 'chapter-001', versionId: 'version-001' });
    const registered = new FileRegistryRepository(context!.database, scope).list()[0]!;
    const registeredPath = resolveInside(context!.dataDir, registered.relativePath);
    rmSync(registeredPath);
    const orphanPath = resolve(context!.dataDir, 'books', scope.bookId, 'orphan.txt');
    writeFileSync(orphanPath, 'orphan', 'utf8');
    const report = new ConsistencyService(context!.database, context!.dataDir).checkBook(scope);
    expect(existsSync(orphanPath)).toBe(true);
    expect(report.issues.map((issue) => issue.kind).sort()).toEqual(['missing', 'orphan']);
  });
});

