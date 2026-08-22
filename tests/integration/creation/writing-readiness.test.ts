import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { DomainError, errorCodes } from '../../../apps/api/src/domain/errors.js';
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting, requestEditorSynthesisUntilConfirmation } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { CopyrightService } from '../../../apps/api/src/application/copyright/copyright-service.js';

describe('写作准备门禁', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('直接章节接口也不能绕过老板确认的创作方案和章纲', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '直接门禁书', text: '只有题材定位，没有剧情方案' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    expect(() => batches.scheduleNewChapters(scope, 1)).toThrowError(expect.objectContaining<Partial<DomainError>>({
      code: errorCodes.operationIncomplete
    }));
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
  });

  it('已取消或失败且没有正文的章节壳在门禁恢复后复用，不跳到下一章', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '安全重试书', text: '原创游戏副本冒险' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const copyright = new CopyrightService(context.database, ids, clock);
    const sourceId = copyright.registerSource(scope, {
      title: '待完成隔离的参考资料',
      rightsPath: 'cleanroom',
      content: '这是一段只用于验证版权预检失败与安全重试的受保护参考资料，未抽象前禁止生成正文。'
    });
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const first = batches.scheduleNewChapters(scope, 1);
    await expect(batches.run(scope, first.batchId)).rejects.toMatchObject({ code: errorCodes.copyrightBlocked });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE chapter_id = ?`).get(first.chapterIds[0]!)).toEqual({ count: 0 });

    const cardId = copyright.createStructureCard(scope, sourceId, {
      pressurePattern: '三段压力逐步增加',
      transformation: '主角从观察转为主动承担后果'
    }, []);
    copyright.buildCleanroomPackage(scope, cardId);
    const second = batches.scheduleNewChapters(scope, 1);
    expect(second.chapterIds[0]).toBe(first.chapterIds[0]);
    expect(second.taskIds[0]).not.toBe(first.taskIds[0]);
    expect((await batches.run(scope, second.batchId)).batch.status).toBe('paused');
    await requestEditorSynthesisUntilConfirmation(context, scope, ids, clock, () => batches.run(scope, second.batchId));
    approvePendingManuscript(context, scope, ids, clock);
    expect((await batches.run(scope, second.batchId)).batch.status).toBe('completed');
    expect(context.database.prepare(`SELECT chapter_number FROM chapters WHERE chapter_id = ?`).get(second.chapterIds[0]!)).toEqual({ chapter_number: 1 });
  });
});
