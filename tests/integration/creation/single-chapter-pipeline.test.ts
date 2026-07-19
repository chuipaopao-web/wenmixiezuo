import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { ChapterApprovalService } from '../../../apps/api/src/application/creation/chapter-approval-service.js';
import { ProductionWorkflowRepository } from '../../../apps/api/src/infrastructure/db/repositories/production-workflow-repository.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';

describe('单章完整创作流水线', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('完成工单、三异模型点评和定点重写，老板确认前不入正史，确认后才结算', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '创作闭环测试书', text: '林澈在旧城追查导师失踪之谜' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1, { firstChapterTitle: '雨夜北塔' });
    const result = await batches.run(scope, batch.batchId);

    expect(result.batch.status).toBe('paused');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual(expect.objectContaining({ status: 'awaiting_confirmation', phase: 'completed', rewriteCount: 1 }));
    const chapterId = batch.chapterIds[0]!;
    expect(context.database.prepare(`SELECT settlement_status, generation_status FROM chapters WHERE chapter_id = ?`).get(chapterId))
      .toEqual({ settlement_status: 'awaiting_confirmation', generation_status: 'completed' });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
    expect(context.database.prepare(`SELECT status FROM tasks WHERE task_id = ?`).get(batch.taskIds[0]!)).toEqual({ status: 'waiting_confirmation' });
    const confirmation = context.database.prepare(`SELECT confirmation_id, expected_canon_revision FROM confirmations
      WHERE owner_id = ? AND book_id = ? AND target_type = 'manuscript' AND status = 'pending'`).get(scope.ownerId, scope.bookId) as { confirmation_id: string; expected_canon_revision: number };
    const approval = new ChapterApprovalService(
      new ProductionWorkflowRepository(context.database), context.dataDir, context.config.releaseId, ids, clock,
      new ChapterCatalogService(context.database, ids, clock), new CanonService(context.database, ids, clock),
      new TaskService(context.database, context.config.releaseId, clock)
    );
    expect(approval.resolve(scope, confirmation.confirmation_id, confirmation.expected_canon_revision, true)).toEqual({ status: 'settled', canonRevision: 1 });
    const completed = await batches.run(scope, batch.batchId);
    expect(completed.batch.status).toBe('completed');
    const manuscripts = context.database.prepare(`
      SELECT manuscript_version_id, parent_version_id, word_count, status, content_hash
      FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY created_at, manuscript_version_id
    `).all(scope.ownerId, scope.bookId, chapterId) as unknown as Array<{ manuscript_version_id: string; parent_version_id: string | null; word_count: number; status: string; content_hash: string }>;
    expect(manuscripts).toHaveLength(2);
    expect(manuscripts.every((item) => item.word_count >= 2_500 && item.word_count <= 3_500)).toBe(true);
    expect(manuscripts[1]?.parent_version_id).toBe(manuscripts[0]?.manuscript_version_id);
    expect(manuscripts[1]?.status).toBe('canon');
    expect(new Set(manuscripts.map((item) => item.content_hash)).size).toBe(2);

    const panels = context.database.prepare(`SELECT review_round, status, manuscript_version_id FROM review_panels
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY review_round`).all(scope.ownerId, scope.bookId, chapterId);
    expect(panels).toEqual([
      expect.objectContaining({ review_round: 1, status: 'complete' }),
      expect.objectContaining({ review_round: 2, status: 'complete' })
    ]);
    const reports = context.database.prepare(`SELECT reviewer_role, model_snapshot_id, manuscript_version_id, report_json
      FROM review_reports WHERE owner_id = ? AND book_id = ? ORDER BY created_at, reviewer_role`).all(scope.ownerId, scope.bookId) as unknown as Array<{ reviewer_role: string; model_snapshot_id: string; manuscript_version_id: string; report_json: string }>;
    expect(reports).toHaveLength(6);
    for (const version of new Set(reports.map((report) => report.manuscript_version_id))) {
      const sameVersion = reports.filter((report) => report.manuscript_version_id === version);
      expect(new Set(sameVersion.map((report) => report.reviewer_role))).toEqual(new Set(['fact', 'literary', 'experience']));
      expect(new Set(sameVersion.map((report) => report.model_snapshot_id)).size).toBe(3);
    }
    const literary = reports.find((report) => report.reviewer_role === 'literary')!;
    expect(JSON.parse(literary.report_json)).toEqual(expect.objectContaining({ aiStyle: expect.objectContaining({ isAuthorshipProbability: false }) }));
    const experience = reports.find((report) => report.reviewer_role === 'experience')!;
    expect(JSON.parse(experience.report_json)).toEqual(expect.objectContaining({ politicalRisk: expect.any(Object), sexualContentRisk: expect.any(Object) }));

    const calls = context.database.prepare(`
      SELECT provider, model_id, context_pack_id, state FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? ORDER BY created_at, request_id
    `).all(scope.ownerId, scope.bookId, batch.taskIds[0]!) as unknown as Array<{ provider: string; model_id: string; context_pack_id: string | null; state: string }>;
    expect(calls).toHaveLength(8);
    expect(calls.every((call) => call.state === 'succeeded' && call.context_pack_id !== null)).toBe(true);
    const writerModels = new Set(calls.filter((call) => call.provider.includes('writer')).map((call) => `${call.provider}/${call.model_id}`));
    const reviewerModels = new Set(calls.filter((call) => !call.provider.includes('writer')).map((call) => `${call.provider}/${call.model_id}`));
    expect(writerModels.size).toBe(1);
    expect(reviewerModels.size).toBe(3);
    expect([...writerModels][0]).not.toBe([...reviewerModels][0]);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM budget_reservations WHERE owner_id = ? AND book_id = ? AND status = 'settled'`).get(scope.ownerId, scope.bookId)).toEqual({ count: 8 });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 1 });
  });

  it('老板拒绝候选正文后沿用同一任务定点重写，不把拒稿写入正史', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '拒稿重写书', text: '旧城追踪与人物抉择' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');
    expect(approvePendingManuscript(context, scope, ids, clock, false)).toEqual({ status: 'rejected' });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
    expect(context.database.prepare(`SELECT status, current_phase FROM tasks WHERE task_id = ?`).get(batch.taskIds[0]!)).toEqual({ status: 'paused', current_phase: 'rewrite' });
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');
    approvePendingManuscript(context, scope, ids, clock);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('completed');
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 1 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`).get(scope.ownerId, scope.bookId, batch.chapterIds[0]!)).toEqual({ count: 3 });
  });
});
