import { afterEach, describe, expect, it } from 'vitest';
import { BookLifecycleService } from '../../apps/api/src/application/books/book-lifecycle-service.js';
import { BookRepository } from '../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('Repository自动隔离契约', () => {
  it('错误owner和错误book都不能读取目标书籍', () => {
    context = createTestContext();
    const lifecycle = new BookLifecycleService(
      context.database,
      context.dataDir,
      new SequenceIds(),
      new FixedClock()
    );
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    lifecycle.ensureOwner({ ownerId: 'owner-two' });
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-alpha' }, '甲书');
    const books = new BookRepository(context.database);
    expect(books.find({ ownerId: 'owner-two', bookId: 'book-alpha' })).toBeNull();
    expect(books.find({ ownerId: 'owner-one', bookId: 'book-beta' })).toBeNull();
    expect(books.list({ ownerId: 'owner-two' })).toEqual([]);
  });
});
