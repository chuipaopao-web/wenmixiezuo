import { afterEach, describe, expect, it } from 'vitest';
import { ChapterStateRecoveryService } from '../../../apps/api/src/application/creation/chapter-state-recovery-service.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('已取消章节壳状态恢复', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('启动时把无正文且最新任务已取消的孤儿章节恢复为未开始', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '恢复测试书', text: '验证取消章节壳' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const chapters = new ChapterCatalogService(context.database, ids, clock);
    const volumeId = chapters.createVolume(scope, 1, '第一卷');
    const chapterId = chapters.createChapter(scope, volumeId, 1, '第1章').chapterId;
    context.database.prepare(`UPDATE chapters SET plan_status = 'ready', generation_status = 'working' WHERE chapter_id = ?`).run(chapterId);
    const team = context.database.prepare(`SELECT agent_id FROM agent_instances WHERE owner_id = ? AND book_id = ? ORDER BY agent_id LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { agent_id: string };
    const budget = context.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string };
    const taskId = ids.next();
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, {
      taskId, taskType: 'chapter_creation', assignedAgentId: team.agent_id, chapterId,
      idempotencyKey: `recovery:${chapterId}`, budgetId: budget.budget_id,
      requiredEditorEpoch: 1, initialPhase: 'draft', brief: { chapterId, chapterNumber: 1 }
    });
    tasks.queue(scope, taskId);
    tasks.requestCancel(scope, taskId);

    expect(new ChapterStateRecoveryService(context.database, clock).reconcileAllCancelledShells()).toBe(1);
    expect(context.database.prepare(`SELECT plan_status, generation_status FROM chapters WHERE chapter_id = ?`).get(chapterId))
      .toEqual({ plan_status: 'planned', generation_status: 'not_started' });
  });
});
