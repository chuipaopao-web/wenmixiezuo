import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('单章完整创作流水线', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('完成预检、上下文、初稿、硬检查、异模型审校、定点重写、事实和正史结算', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '创作闭环测试书', text: '林澈在旧城追查导师失踪之谜' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1, { firstChapterTitle: '雨夜北塔' });
    const result = await batches.run(scope, batch.batchId);

    expect(result.batch.status).toBe('completed');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual(expect.objectContaining({ status: 'completed', phase: 'completed', rewriteCount: 1 }));
    const chapterId = batch.chapterIds[0]!;
    expect(context.database.prepare(`SELECT settlement_status, generation_status FROM chapters WHERE chapter_id = ?`).get(chapterId))
      .toEqual({ settlement_status: 'settled', generation_status: 'completed' });
    const manuscripts = context.database.prepare(`
      SELECT manuscript_version_id, parent_version_id, word_count, status, content_hash
      FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY created_at, manuscript_version_id
    `).all(scope.ownerId, scope.bookId, chapterId) as unknown as Array<{ manuscript_version_id: string; parent_version_id: string | null; word_count: number; status: string; content_hash: string }>;
    expect(manuscripts).toHaveLength(2);
    expect(manuscripts.every((item) => item.word_count >= 2_500 && item.word_count <= 3_500)).toBe(true);
    expect(manuscripts[1]?.parent_version_id).toBe(manuscripts[0]?.manuscript_version_id);
    expect(manuscripts[1]?.status).toBe('canon');
    expect(new Set(manuscripts.map((item) => item.content_hash)).size).toBe(2);

    const reviews = context.database.prepare(`
      SELECT round_number, verdict FROM review_rounds WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY round_number
    `).all(scope.ownerId, scope.bookId, chapterId);
    expect(reviews).toEqual([{ round_number: 1, verdict: 'rewrite' }, { round_number: 2, verdict: 'pass' }]);
    const issue = context.database.prepare(`
      SELECT location_text, issue_type, severity, evidence_text, required_action, status
      FROM review_issues WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
    `).get(scope.ownerId, scope.bookId, chapterId) as Record<string, unknown>;
    expect(issue).toEqual(expect.objectContaining({
      location_text: '首个场景转折处', issue_type: 'style_repetition', severity: 'major',
      evidence_text: '就在这时，就在这时', status: 'resolved'
    }));
    expect(String(issue.required_action)).toContain('删除重复转折词');

    const calls = context.database.prepare(`
      SELECT provider, model_id, context_pack_id, state FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? ORDER BY created_at, request_id
    `).all(scope.ownerId, scope.bookId, batch.taskIds[0]!) as unknown as Array<{ provider: string; model_id: string; context_pack_id: string | null; state: string }>;
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.state === 'succeeded' && call.context_pack_id !== null)).toBe(true);
    const writerModels = new Set(calls.filter((call) => call.provider.includes('writer')).map((call) => `${call.provider}/${call.model_id}`));
    const reviewerModels = new Set(calls.filter((call) => call.provider.includes('reviewer')).map((call) => `${call.provider}/${call.model_id}`));
    expect(writerModels.size).toBe(1);
    expect(reviewerModels.size).toBe(1);
    expect([...writerModels][0]).not.toBe([...reviewerModels][0]);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM budget_reservations WHERE owner_id = ? AND book_id = ? AND status = 'settled'`).get(scope.ownerId, scope.bookId)).toEqual({ count: 4 });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 1 });
  });
});
