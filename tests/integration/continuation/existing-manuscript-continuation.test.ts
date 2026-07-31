import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExistingManuscriptContinuationService } from '../../../apps/api/src/application/continuation/existing-manuscript-continuation-service.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('已有正文续写导入', () => {
  let context: TestContext | null = null;
  afterEach(() => { context?.close(); context = null; });

  it('预览不写业务章节，作者确认后逐章结算且可以安全重试', () => {
    context = createTestContext('wenmi-continuation-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '已有三万字' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new ExistingManuscriptContinuationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const source = '作者说明\n\n第一章 雨夜归来\n林昭推开旧门。\n\n第二章 缺页账本\n账本少了一页。';

    const preview = service.preview(scope, { sourceName: '旧稿.txt', text: source });
    expect(preview).toMatchObject({ status: 'parsed', sourceName: '旧稿.txt' });
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual(['前言', '第一章 雨夜归来', '第二章 缺页账本']);
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare('SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
    const persistedSource = context.database.prepare(`SELECT source_relative_path FROM continuation_imports
      WHERE owner_id = ? AND book_id = ? AND continuation_import_id = ?`)
      .get(scope.ownerId, scope.bookId, preview.importId) as { source_relative_path: string };
    expect(persistedSource.source_relative_path).toMatch(new RegExp(`^books/${scope.bookId}/continuation-imports/`));
    expect(existsSync(resolve(context.dataDir, persistedSource.source_relative_path))).toBe(true);
    const resumed = new ExistingManuscriptContinuationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    ).latest(scope);
    expect(resumed).toEqual(preview);

    const confirmation = preview.chapters.map((chapter) => ({
      importChapterId: chapter.importChapterId,
      title: chapter.title,
      included: chapter.title !== '前言'
    }));
    const ready = service.confirm(scope, preview.importId, { chapters: confirmation });
    expect(ready).toMatchObject({ status: 'ready', includedChapterCount: 2, importedChapterCount: 2, lastCompletedOrdinal: 3 });
    expect(ready.chapters.map((chapter) => ({ title: chapter.title, included: chapter.included, status: chapter.status }))).toEqual([
      { title: '前言', included: false, status: 'excluded' },
      { title: '第一章 雨夜归来', included: true, status: 'imported' },
      { title: '第二章 缺页账本', included: true, status: 'imported' }
    ]);
    expect(context.database.prepare(`SELECT chapter_number, title, settlement_status FROM chapters
      WHERE owner_id = ? AND book_id = ? ORDER BY chapter_number`).all(scope.ownerId, scope.bookId)).toEqual([
      { chapter_number: 1, title: '第一章 雨夜归来', settlement_status: 'settled' },
      { chapter_number: 2, title: '第二章 缺页账本', settlement_status: 'settled' }
    ]);
    expect(context.database.prepare(`SELECT creator_kind, model_provider, model_id, status, word_count
      FROM manuscript_versions WHERE owner_id = ? AND book_id = ? ORDER BY created_at, manuscript_version_id`)
      .all(scope.ownerId, scope.bookId)).toEqual([
        { creator_kind: 'import', model_provider: 'import', model_id: 'author-existing-manuscript', status: 'canon', word_count: 7 },
        { creator_kind: 'import', model_provider: 'import', model_id: 'author-existing-manuscript', status: 'canon', word_count: 7 }
      ]);
    expect(context.database.prepare('SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM canon_index_requests
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });

    const retried = service.confirm(scope, preview.importId, { chapters: confirmation });
    expect(retried).toEqual(ready);
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
  });

  it('禁止向已有章节的书再次导入整本前文', () => {
    context = createTestContext('wenmi-continuation-existing-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '已有章节的书' });
    const scope = { ownerId: context.config.ownerId, bookId: first.bookId };
    context.database.prepare(`INSERT INTO volumes (
      volume_id, owner_id, book_id, volume_number, title, status, created_at, updated_at
    ) VALUES ('manual-volume', ?, ?, 1, '正文', 'active', ?, ?)`)
      .run(scope.ownerId, scope.bookId, clock.now().toISOString(), clock.now().toISOString());
    context.database.prepare(`INSERT INTO chapters (
      chapter_id, owner_id, book_id, volume_id, chapter_number, title, plan_status,
      generation_status, settlement_status, created_at, updated_at
    ) VALUES ('manual-chapter', ?, ?, 'manual-volume', 1, '旧章', 'planned', 'not_started', 'unsettled', ?, ?)`)
      .run(scope.ownerId, scope.bookId, clock.now().toISOString(), clock.now().toISOString());
    const service = new ExistingManuscriptContinuationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    expect(() => service.preview(scope, { sourceName: '重复.txt', text: '第一章\n正文' }))
      .toThrow('不能再导入整本前文基线');
  });

  it('HTTP入口完成预览、确认和主编诊断交接，不误启双编剧', async () => {
    context = createTestContext('wenmi-continuation-api-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '接口续写书' });
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const previewResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${book.bookId}/continuation-imports/preview`,
        payload: { sourceName: '正文.txt', text: '第一章 开门\n门外有人。\n第二章 来客\n来客递上旧信。' }
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = previewResponse.json().data as {
        importId: string;
        chapters: Array<{ importChapterId: string; title: string; included: boolean }>;
      };
      const latestResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/books/${book.bookId}/continuation-imports/latest`
      });
      expect(latestResponse.statusCode).toBe(200);
      expect(latestResponse.json().data).toMatchObject({ importId: preview.importId, status: 'parsed' });
      const confirmResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${book.bookId}/continuation-imports/${preview.importId}/confirm`,
        payload: { chapters: preview.chapters.map((chapter) => ({ ...chapter, title: chapter.title })) }
      });
      expect(confirmResponse.statusCode).toBe(200);
      expect(confirmResponse.json().data).toMatchObject({ status: 'ready', importedChapterCount: 2 });
      const firstChapter = context.database.prepare(`SELECT chapter_id FROM chapters
        WHERE owner_id = ? AND book_id = ? AND chapter_number = 1`).get(context.config.ownerId, book.bookId) as { chapter_id: string };
      const content = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/chapters/${firstChapter.chapter_id}/content` });
      expect(content.statusCode).toBe(200);
      expect(content.json().data.content).toBe('门外有人。');

      const handoff = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${book.bookId}/messages`,
        payload: { content: '【续写诊断资料包】\n已确认导入2章，请主编先诊断，不要直接开写。', attachmentIds: [] }
      });
      expect(handoff.statusCode).toBe(200);
      expect(handoff.json().data.action).toMatchObject({
        kind: 'conversation_reply_scheduled',
        intake: { selectedAction: 'preserve_continuation_handoff_packet' }
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
        WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'`).get(context.config.ownerId, book.bookId)).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });
});
