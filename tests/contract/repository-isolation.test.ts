import { afterEach, describe, expect, it } from 'vitest';
import { BookLifecycleService } from '../../apps/api/src/application/books/book-lifecycle-service.js';
import { BookRepository } from '../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { FileRegistryRepository } from '../../apps/api/src/infrastructure/db/repositories/file-registry-repository.js';
import { PromotionService } from '../../apps/api/src/infrastructure/recovery/promotion-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('Repository自动隔离契约', () => {
  it('错误owner和错误book都不能读取目标书籍', () => {
    context = createTestContext();
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    lifecycle.ensureOwner({ ownerId: 'owner-two' });
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-alpha' }, '甲书');
    const books = new BookRepository(context.database);
    expect(books.find({ ownerId: 'owner-two', bookId: 'book-alpha' })).toBeNull();
    expect(books.find({ ownerId: 'owner-one', bookId: 'book-beta' })).toBeNull();
    expect(books.list({ ownerId: 'owner-two' })).toEqual([]);
  });

  it('文件Repository在构造时绑定范围且无法跨书查询', () => {
    context = createTestContext();
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-alpha' }, '甲书');
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-beta' }, '乙书');
    const promotion = new PromotionService(context.database, context.dataDir, new FixedClock());
    const staged = promotion.stageText('task-alpha', '甲书不可变正文');
    promotion.promote({ ownerId: 'owner-one', bookId: 'book-alpha' }, {
      ...staged,
      operationId: 'operation-alpha',
      fileId: 'file-alpha',
      chapterId: 'chapter-001',
      versionId: 'version-001'
    });
    expect(new FileRegistryRepository(context.database, { ownerId: 'owner-one', bookId: 'book-alpha' }).list()).toHaveLength(1);
    expect(new FileRegistryRepository(context.database, { ownerId: 'owner-one', bookId: 'book-beta' }).list()).toEqual([]);
  });
});

