import { ChapterCatalogService } from '../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { TaskService } from '../../apps/api/src/application/tasks/task-service.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import { PromotionService } from '../../apps/api/src/infrastructure/recovery/promotion-service.js';
import { initializeDomainBook } from './domain-fixture.js';
import type { TestContext } from './test-context.js';

export interface KnowledgeFixture {
  scope: { ownerId: string; bookId: string };
  chapterId: string;
  volumeId: string;
  manuscriptVersionId: string;
  taskId: string;
  agentId: string;
  content: string;
}

export function createKnowledgeFixture(
  context: TestContext,
  ids: IdGenerator,
  clock: Clock,
  options: { ownerId?: string; chapterNumber?: number; content?: string; title?: string } = {}
): KnowledgeFixture {
  const ownerId = options.ownerId ?? context.config.ownerId;
  const book = initializeDomainBook(context, ownerId, ids, clock, {
    title: options.title ?? '正史测试书',
    text: '一部验证人物状态、时间线和正史结算的长篇小说'
  });
  const scope = { ownerId, bookId: book.bookId };
  const catalog = new ChapterCatalogService(context.database, ids, clock);
  const volumeId = catalog.createVolume(scope, 1, '第一卷');
  const chapter = catalog.createChapter(scope, volumeId, options.chapterNumber ?? 1, '第一章');
  const agent = context.database.prepare(`
    SELECT agent_id FROM agent_instances WHERE owner_id = ? AND book_id = ? ORDER BY agent_id LIMIT 1
  `).get(ownerId, book.bookId) as { agent_id: string };
  const taskId = ids.next();
  new TaskService(context.database, context.config.releaseId, clock).create(scope, {
    taskId,
    taskType: 'chapter_write',
    assignedAgentId: agent.agent_id,
    chapterId: chapter.chapterId,
    idempotencyKey: `write:${chapter.chapterId}`,
    initialPhase: 'draft',
    brief: { chapterId: chapter.chapterId }
  });
  const content = options.content ?? '夜雨落在旧城，林澈握紧唯一的铜钥匙，记住了北塔的约定。';
  const promotion = new PromotionService(context.database, context.dataDir, clock);
  const staged = promotion.stageText(taskId, content);
  const manuscriptVersionId = ids.next();
  const fileId = ids.next();
  promotion.promote(scope, {
    ...staged,
    operationId: ids.next(),
    fileId,
    chapterId: chapter.chapterId,
    versionId: manuscriptVersionId
  });
  catalog.registerManuscript(scope, {
    manuscriptVersionId,
    chapterId: chapter.chapterId,
    authorAgentId: agent.agent_id,
    modelProvider: 'wenmi-deterministic',
    modelId: 'fake-novel-v1',
    sourceTaskId: taskId,
    fileId,
    contentHash: staged.contentHash,
    wordCount: [...content].filter((character) => !/\s/u.test(character)).length,
    status: 'approved'
  });
  return { scope, chapterId: chapter.chapterId, volumeId, manuscriptVersionId, taskId, agentId: agent.agent_id, content };
}

export function addApprovedChapter(
  context: TestContext,
  ids: IdGenerator,
  clock: Clock,
  fixture: KnowledgeFixture,
  chapterNumber: number,
  content = `第${chapterNumber}章的不可变正文`
): { chapterId: string; manuscriptVersionId: string; taskId: string } {
  const catalog = new ChapterCatalogService(context.database, ids, clock);
  const chapter = catalog.createChapter(fixture.scope, fixture.volumeId, chapterNumber, `第${chapterNumber}章`);
  const taskId = ids.next();
  new TaskService(context.database, context.config.releaseId, clock).create(fixture.scope, {
    taskId,
    taskType: 'chapter_write',
    assignedAgentId: fixture.agentId,
    chapterId: chapter.chapterId,
    idempotencyKey: `write:${chapter.chapterId}`,
    initialPhase: 'draft',
    brief: { chapterId: chapter.chapterId }
  });
  const promotion = new PromotionService(context.database, context.dataDir, clock);
  const staged = promotion.stageText(taskId, content);
  const manuscriptVersionId = ids.next();
  const fileId = ids.next();
  promotion.promote(fixture.scope, {
    ...staged,
    operationId: ids.next(), fileId, chapterId: chapter.chapterId, versionId: manuscriptVersionId
  });
  catalog.registerManuscript(fixture.scope, {
    manuscriptVersionId, chapterId: chapter.chapterId, authorAgentId: fixture.agentId,
    modelProvider: 'wenmi-deterministic', modelId: 'fake-novel-v1', sourceTaskId: taskId,
    fileId, contentHash: staged.contentHash, wordCount: [...content].length, status: 'approved'
  });
  return { chapterId: chapter.chapterId, manuscriptVersionId, taskId };
}
