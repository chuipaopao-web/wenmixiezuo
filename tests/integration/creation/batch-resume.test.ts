import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('连续多章串行与断点续跑', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('连续5章在第2章后中断并从第3章继续，不重复已完成章节', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '五章续跑书', text: '围绕北塔与三个日期展开连续剧情' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 5);
    const firstRun = await batches.run(scope, batch.batchId, { pauseAfterCompletedChapters: 2 });
    expect(firstRun.batch.status).toBe('paused');
    expect(firstRun.batch.nextIndex).toBe(2);
    expect(firstRun.results).toHaveLength(2);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ? AND settlement_status = 'settled'`).get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
    const firstTwoHashes = context.database.prepare(`
      SELECT content_hash FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND status = 'canon' ORDER BY chapter_id
    `).all(scope.ownerId, scope.bookId);

    const resumed = await batches.run(scope, batch.batchId);
    expect(resumed.batch.status).toBe('completed');
    expect(resumed.batch.nextIndex).toBe(5);
    expect(resumed.results).toHaveLength(3);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ? AND settlement_status = 'settled'`).get(scope.ownerId, scope.bookId)).toEqual({ count: 5 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND status = 'canon'`).get(scope.ownerId, scope.bookId)).toEqual({ count: 5 });
    expect(context.database.prepare(`SELECT content_hash FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND status = 'canon' ORDER BY chapter_id LIMIT 2`).all(scope.ownerId, scope.bookId)).toEqual(firstTwoHashes);
    const words = context.database.prepare(`SELECT word_count FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND status = 'canon'`)
      .all(scope.ownerId, scope.bookId) as unknown as Array<{ word_count: number }>;
    expect(words).toHaveLength(5);
    expect(words.every((row) => row.word_count >= 2_500 && row.word_count <= 3_500)).toBe(true);
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 5 });
  });

  it('在审校检查点暂停同一章并继续，不重复生成初稿', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '章内检查点书', text: '测试安全暂停与继续' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1);
    const paused = await batches.run(scope, batch.batchId, { pauseAfterPhase: 'review' });
    expect(paused.batch.status).toBe('paused');
    expect(paused.results[0]).toEqual(expect.objectContaining({ status: 'paused', phase: 'rewrite' }));
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE chapter_id = ?`).get(batch.chapterIds[0]!)).toEqual({ count: 1 });
    const resumed = await batches.run(scope, batch.batchId);
    expect(resumed.batch.status).toBe('completed');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE chapter_id = ?`).get(batch.chapterIds[0]!)).toEqual({ count: 2 });
    expect(context.database.prepare(`SELECT attempt_count FROM tasks WHERE task_id = ?`).get(batch.taskIds[0]!)).toEqual({ attempt_count: 2 });
  });
});
