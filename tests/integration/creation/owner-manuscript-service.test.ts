import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { OwnerManuscriptService } from '../../../apps/api/src/application/creation/owner-manuscript-service.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { ChapterPipelineService } from '../../../apps/api/src/application/creation/chapter-pipeline-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { countNovelCharacters } from '../../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import { resolveInside } from '../../../apps/api/src/infrastructure/files/file-utils.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds } from '../../helpers/test-context.js';

describe('owner manuscript withdrawal', () => {
  it('exposes the withdrawal through the scoped HTTP API', async () => {
    const context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock, { content: 'Saved owner manuscript.' });
    context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'completed' WHERE task_id = ?`)
      .run(fixture.taskId);
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${fixture.scope.bookId}/chapters/${fixture.chapterId}/manuscripts/current/withdraw`,
        payload: { expectedManuscriptVersionId: fixture.manuscriptVersionId }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({
        withdrawnManuscriptVersionId: fixture.manuscriptVersionId,
        currentManuscriptVersionId: null,
        retainedInHistory: true
      });
      expect(context.database.prepare(`SELECT current_manuscript_version_id FROM chapters
        WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
        .get(fixture.scope.ownerId, fixture.scope.bookId, fixture.chapterId))
        .toEqual({ current_manuscript_version_id: null });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions
        WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ?`)
        .get(fixture.scope.ownerId, fixture.scope.bookId, fixture.manuscriptVersionId))
        .toEqual({ count: 1 });
    } finally {
      await app.close();
      context.close();
    }
  });

  it('withdraws the current unsettled manuscript without deleting immutable history', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const fixture = createKnowledgeFixture(context, ids, clock, { content: 'Author manuscript to withdraw.' });
      context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'completed' WHERE task_id = ?`).run(fixture.taskId);
      const service = new OwnerManuscriptService(
        context.database, context.dataDir, context.config.releaseId, ids, clock
      );

      const result = service.withdrawDraft(fixture.scope, {
        chapterId: fixture.chapterId,
        expectedManuscriptVersionId: fixture.manuscriptVersionId
      });

      expect(result).toEqual({
        withdrawnManuscriptVersionId: fixture.manuscriptVersionId,
        currentManuscriptVersionId: null,
        retainedInHistory: true
      });
      expect(context.database.prepare(`SELECT current_manuscript_version_id, canon_manuscript_version_id,
          generation_status, settlement_status FROM chapters WHERE chapter_id = ?`)
        .get(fixture.chapterId)).toEqual({
        current_manuscript_version_id: null,
        canon_manuscript_version_id: null,
        generation_status: 'not_started',
        settlement_status: 'unsettled'
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions
        WHERE manuscript_version_id = ?`).get(fixture.manuscriptVersionId)).toEqual({ count: 1 });
    } finally {
      context.close();
    }
  });

  it('refuses to withdraw a settled manuscript or a stale active version', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const fixture = createKnowledgeFixture(context, ids, clock, { content: 'Protected manuscript.' });
      context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'completed' WHERE task_id = ?`).run(fixture.taskId);
      const service = new OwnerManuscriptService(
        context.database, context.dataDir, context.config.releaseId, ids, clock
      );

      expect(() => service.withdrawDraft(fixture.scope, {
        chapterId: fixture.chapterId,
        expectedManuscriptVersionId: 'stale-version'
      })).toThrow('正文基线已经变化');

      context.database.prepare(`UPDATE chapters SET settlement_status = 'settled',
        canon_manuscript_version_id = current_manuscript_version_id WHERE chapter_id = ?`).run(fixture.chapterId);
      expect(() => service.withdrawDraft(fixture.scope, {
        chapterId: fixture.chapterId,
        expectedManuscriptVersionId: fixture.manuscriptVersionId
      })).toThrow('已定稿正史不能删除');
    } finally {
      context.close();
    }
  });
});

describe('作者正文修订', () => {
  it('允许已规划但尚无正文的章节以空CAS基线创建第一份作者草稿', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '空稿首存书' });
      const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
      const chapters = new ChapterCatalogService(context.database, ids, clock);
      const volumeId = chapters.createVolume(scope, 1, '第一卷');
      const planned = chapters.createChapter(scope, volumeId, 1, '第一章');
      const saved = new OwnerManuscriptService(
        context.database, context.dataDir, context.config.releaseId, ids, clock
      ).saveDraft(scope, {
        chapterId: planned.chapterId,
        baseManuscriptVersionId: null,
        content: '作者从空白章节开始写下第一份正文。',
        note: '作者创建第一稿'
      });

      expect(saved).toMatchObject({ parentVersionId: null, status: 'candidate', unchanged: false });
      expect(context.database.prepare(`SELECT current_manuscript_version_id, settlement_status FROM chapters
        WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`).get(scope.ownerId, scope.bookId, planned.chapterId)).toEqual({
        current_manuscript_version_id: saved.manuscriptVersionId,
        settlement_status: 'unsettled'
      });
    } finally {
      context.close();
    }
  });

  it('保存新不可变版本、保留旧稿并拒绝陈旧基线和已结算编辑', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const fixture = createKnowledgeFixture(context, ids, clock, { content: '第一版正文，旧稿必须保留。' });
      context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'completed' WHERE task_id = ?`).run(fixture.taskId);
      const service = new OwnerManuscriptService(context.database, context.dataDir, context.config.releaseId, ids, clock);
      const saved = service.saveDraft(fixture.scope, {
        chapterId: fixture.chapterId, baseManuscriptVersionId: fixture.manuscriptVersionId,
        content: '第二版正文，由作者修改并保存为新版本。', note: '调整人物语气'
      });
      expect(saved).toMatchObject({ parentVersionId: fixture.manuscriptVersionId, status: 'candidate', unchanged: false });
      const versions = context.database.prepare(`SELECT m.manuscript_version_id, m.creator_kind, m.edit_note, f.relative_path
        FROM manuscript_versions m JOIN file_registry f ON f.file_id = m.file_id
        WHERE m.owner_id = ? AND m.book_id = ? AND m.chapter_id = ? ORDER BY m.created_at, m.manuscript_version_id`)
        .all(fixture.scope.ownerId, fixture.scope.bookId, fixture.chapterId) as unknown as Array<{
          manuscript_version_id: string; creator_kind: string; edit_note: string | null; relative_path: string;
        }>;
      expect(versions).toHaveLength(2);
      expect(versions[1]).toMatchObject({ manuscript_version_id: saved.manuscriptVersionId, creator_kind: 'owner', edit_note: '调整人物语气' });
      expect(readFileSync(resolveInside(context.dataDir, versions[0]!.relative_path), 'utf8')).toBe(fixture.content);
      expect(context.database.prepare('SELECT current_manuscript_version_id FROM chapters WHERE chapter_id = ?').get(fixture.chapterId))
        .toEqual({ current_manuscript_version_id: saved.manuscriptVersionId });
      expect(() => service.saveDraft(fixture.scope, {
        chapterId: fixture.chapterId, baseManuscriptVersionId: fixture.manuscriptVersionId, content: '陈旧编辑'
      })).toThrow('正文基线已经变化');
      context.database.prepare(`UPDATE chapters SET settlement_status = 'settled' WHERE chapter_id = ?`).run(fixture.chapterId);
      expect(() => service.saveDraft(fixture.scope, {
        chapterId: fixture.chapterId, baseManuscriptVersionId: saved.manuscriptVersionId, content: '试图覆盖正史'
      })).toThrow('正史已结算正文只读');
    } finally {
      context.close();
    }
  });

  it('定稿和重写都排入真实章节流水线并绑定当前版本', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const finalizeFixture = createKnowledgeFixture(context, ids, clock, { title: '定稿书' });
      context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'completed' WHERE task_id = ?`).run(finalizeFixture.taskId);
      const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
      const finalize = batches.scheduleExistingRevision(finalizeFixture.scope, finalizeFixture.chapterId, finalizeFixture.manuscriptVersionId, 'review_existing');
      expect(context.database.prepare('SELECT status, task_brief_json FROM tasks WHERE task_id = ?').get(finalize.taskId)).toEqual({
        status: 'queued',
        task_brief_json: expect.stringContaining('review_existing')
      });
      context.database.prepare(`UPDATE tasks SET status = 'blocked', error_code = 'QUALITY_BLOCKED' WHERE task_id = ?`).run(finalize.taskId);
      const rewrite = batches.scheduleExistingRevision(finalizeFixture.scope, finalizeFixture.chapterId, finalizeFixture.manuscriptVersionId, 'rewrite_existing', '强化冲突并保留人物动机');
      const rewriteTask = context.database.prepare('SELECT status, task_brief_json FROM tasks WHERE task_id = ?').get(rewrite.taskId) as { status: string; task_brief_json: string };
      expect(rewriteTask.status).toBe('queued');
      expect(JSON.parse(rewriteTask.task_brief_json)).toMatchObject({
        operation: 'rewrite_existing', manuscriptVersionId: finalizeFixture.manuscriptVersionId,
        instruction: '强化冲突并保留人物动机'
      });
    } finally {
      context.close();
    }
  });

  it('uses the same effective-character count as the chapter hard check', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const fixture = createKnowledgeFixture(context, ids, clock, { content: 'Original draft.' });
      context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'completed' WHERE task_id = ?`).run(fixture.taskId);
      const content = '陆沉星在井边停下。\n\nHe checked the broken ruler: 12 marks.';
      const saved = new OwnerManuscriptService(
        context.database, context.dataDir, context.config.releaseId, ids, clock
      ).saveDraft(fixture.scope, {
        chapterId: fixture.chapterId,
        baseManuscriptVersionId: fixture.manuscriptVersionId,
        content
      });

      expect(saved.wordCount).toBe(countNovelCharacters(content));
      expect(context.database.prepare(`SELECT word_count FROM manuscript_versions WHERE manuscript_version_id = ?`)
        .get(saved.manuscriptVersionId)).toEqual({ word_count: countNovelCharacters(content) });
    } finally {
      context.close();
    }
  });

  it('allows an owner correction after a quality-blocked task has released its lease', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const fixture = createKnowledgeFixture(context, ids, clock, { content: 'A complete candidate manuscript.' });
      context.database.prepare(`UPDATE tasks SET status = 'blocked', current_phase = 'review',
        error_code = 'QUALITY_BLOCKED', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE task_id = ?`).run(fixture.taskId);

      const saved = new OwnerManuscriptService(
        context.database, context.dataDir, context.config.releaseId, ids, clock
      ).saveDraft(fixture.scope, {
        chapterId: fixture.chapterId,
        baseManuscriptVersionId: fixture.manuscriptVersionId,
        content: 'A corrected complete candidate manuscript.',
        note: 'Resolve the blocking review findings.'
      });

      expect(saved).toMatchObject({ parentVersionId: fixture.manuscriptVersionId, unchanged: false });
    } finally {
      context.close();
    }
  });

  it('作者修改后的正文从硬检查开始走多席审校，不重复生成初稿也不直接进入正史', async () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
        title: '作者定稿审校书', text: '林澈在旧城追查导师失踪之谜'
      });
      const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
      prepareBookForWriting(context, scope, ids, clock, 1);
      const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
      const initial = batches.scheduleNewChapters(scope, 1, { firstChapterTitle: '雨夜北塔' });
      const generated = await batches.run(scope, initial.batchId);
      expect(generated.results[0]?.status).toBe('awaiting_confirmation');
      const chapterId = initial.chapterIds[0]!;
      const generatedVersionId = generated.results[0]!.manuscriptVersionId!;
      const manuscript = context.database.prepare(`SELECT f.relative_path FROM manuscript_versions m
        JOIN file_registry f ON f.file_id = m.file_id
        WHERE m.manuscript_version_id = ? AND m.owner_id = ? AND m.book_id = ?`)
        .get(generatedVersionId, scope.ownerId, scope.bookId) as { relative_path: string };
      const generatedContent = readFileSync(resolveInside(context.dataDir, manuscript.relative_path), 'utf8');
      const editedContent = `${generatedContent.slice(0, -1)}！`;
      const ownerVersion = new OwnerManuscriptService(
        context.database, context.dataDir, context.config.releaseId, ids, clock
      ).saveDraft(scope, {
        chapterId, baseManuscriptVersionId: generatedVersionId, content: editedContent, note: '作者微调句末语气'
      });
      expect(context.database.prepare(`SELECT status FROM confirmations WHERE target_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(generatedVersionId)).toEqual({ status: 'superseded' });
      expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
        .get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });

      const scheduled = batches.scheduleExistingRevision(scope, chapterId, ownerVersion.manuscriptVersionId, 'review_existing');
      const tasks = new TaskService(context.database, context.config.releaseId, clock);
      const workerId = 'owner-review-worker';
      const claimed = tasks.claimNext(workerId, 120_000);
      expect(claimed?.taskId).toBe(scheduled.taskId);
      const result = await new ChapterPipelineService(
        context.database, context.dataDir, context.config.releaseId, ids, clock
      ).executeClaimed(scope, scheduled.taskId, workerId, undefined, {
        leaseToken: claimed!.leaseToken!, attemptNo: claimed!.currentAttemptNo
      });

      expect(result.status).toBe('awaiting_confirmation');
      expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
        .get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM review_reports WHERE owner_id = ? AND book_id = ?
        AND manuscript_version_id = ?`).get(scope.ownerId, scope.bookId, result.manuscriptVersionId)).toEqual({ count: 4 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM retrieval_query_plans WHERE owner_id = ? AND book_id = ?
        AND task_id = ? AND mode = 'drafting'`).get(scope.ownerId, scope.bookId, scheduled.taskId)).toEqual({ count: 0 });
    } finally {
      context.close();
    }
  });
});
