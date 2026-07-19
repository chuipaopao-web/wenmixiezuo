import { afterEach, describe, expect, it } from 'vitest';
import { BookLifecycleService } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { requiredPermanentDeleteText } from '../../../apps/api/src/domain/permanent-delete.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('书籍生命周期与删除墓碑', () => {
  it('使用乐观版本归档和恢复', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    service.ensureOwner(scope);
    const created = service.createDraft(scope, '甲书');
    const archived = service.archive(scope, created.version);
    expect(archived.status).toBe('archived');
    const restored = service.restoreFromArchive(scope, archived.version);
    expect(restored.status).toBe('active');
    expect(() => service.archive(scope, created.version)).toThrow('版本已经变化');
  });

  it('模糊或错误确认词不能永久删除', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    service.ensureOwner(scope);
    const created = service.createDraft(scope, '甲书');
    service.archive(scope, created.version);
    expect(() => service.permanentlyDelete(scope, '好')).toThrow('确认词不匹配');
    expect(new BookRepository(context.database).require(scope).title).toBe('甲书');
  });

  it('严格确认后删除临时测试书并留下不可变墓碑', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    service.ensureOwner(scope);
    const created = service.createDraft(scope, '甲书');
    service.archive(scope, created.version);
    service.permanentlyDelete(scope, requiredPermanentDeleteText('甲书', scope.bookId));
    expect(new BookRepository(context.database).find(scope)).toBeNull();
    const tombstone = context.database.prepare('SELECT deleted_book_id, deleted_book_title FROM deletion_tombstones WHERE owner_id = ?')
      .get(scope.ownerId);
    expect(tombstone).toEqual({ deleted_book_id: 'book-alpha', deleted_book_title: '甲书' });
    expect(() => service.createDraft(scope, '甲书复活')).toThrow('墓碑禁止');
  });

  it('活动书即使确认词正确也不能永久删除', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-active' };
    service.ensureOwner(scope);
    service.createDraft(scope, '活动书');
    expect(() => service.permanentlyDelete(scope, requiredPermanentDeleteText('活动书', scope.bookId)))
      .toThrow('只有已归档书籍可以永久删除');
    expect(new BookRepository(context.database).require(scope).title).toBe('活动书');
  });
});
