import { afterEach, describe, expect, it } from 'vitest';
import { ChapterChallengerReviewService } from '../../../apps/api/src/application/creation/chapter-challenger-review-service.js';
import { ChapterChallengerReviewPipelineService } from '../../../apps/api/src/application/creation/chapter-challenger-review-pipeline-service.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { ContextPackService } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { ChapterChallengerReviewRepository } from '../../../apps/api/src/infrastructure/db/repositories/chapter-challenger-review-repository.js';
import { VolumePlanGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-generation-repository.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('挑剔读者按需找茬（每章固定三审之外）', () => {
  let context: TestContext | undefined;

  afterEach(() => {
    context?.close();
    context = undefined;
  });

  it('章节还没有正文时提示先让主笔写出来', () => {
    context = createTestContext('wenmi-challenger-gate-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '找茬门禁测试书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const catalog = new ChapterCatalogService(context.database, ids, clock);
    const volumeId = catalog.createVolume(scope, 1, '第一卷');
    const chapter = catalog.createChapter(scope, volumeId, 1, '第一章');
    const service = challengerService(context, ids, clock);

    expect(() => service.start(scope, { chapterId: chapter.chapterId, idempotencyKey: 'challenger-gate-1' }))
      .toThrow('这一章还没有正文');
  });

  it('作者点击后妙玉单独跑一次找茬，结果只供参考且可重复发起', async () => {
    context = createTestContext('wenmi-challenger-flow-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock, {
      content: '夜雨落在旧城，林澈握紧唯一的铜钥匙，记住了北塔的约定。'
    });
    context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'completed' WHERE task_id = ?`)
      .run(fixture.taskId);
    const scope = fixture.scope;
    const service = challengerService(context, ids, clock);

    const scheduled = service.start(scope, { chapterId: fixture.chapterId, idempotencyKey: 'challenger-flow-1' });
    expect(scheduled).toMatchObject({ status: 'working', taskStatus: 'queued' });
    expect(scheduled.member?.roleKey).toBe('experience_challenger');
    expect(scheduled.manuscriptVersionId).toBe(fixture.manuscriptVersionId);
    // 进行中的找茬不重复起任务。
    expect(service.start(scope, { chapterId: fixture.chapterId, idempotencyKey: 'challenger-flow-2' }).taskId)
      .toBe(scheduled.taskId);

    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const claim = tasks.claimNext('worker-challenger', 120_000);
    expect(claim?.taskId).toBe(scheduled.taskId);
    const repository = new ChapterChallengerReviewRepository(context.database);
    const budgets = new BudgetService(context.database, ids, clock);
    const pipeline = new ChapterChallengerReviewPipelineService(
      context.dataDir,
      repository,
      tasks,
      budgets,
      new ModelCallService(context.database, clock, budgets),
      new ContextPackService(context.database, ids, clock),
      ids,
      clock,
      new ModelAdapterFactory(context.config.modelRuntime)
    );
    const result = await pipeline.executeClaimed(scope, scheduled.taskId, 'worker-challenger', {
      leaseToken: claim!.leaseToken!,
      attemptNo: claim!.currentAttemptNo
    });

    expect(result).toMatchObject({ status: 'succeeded', reviewId: scheduled.reviewId });
    const latest = service.latest(scope, fixture.chapterId);
    expect(latest).toMatchObject({ status: 'succeeded', taskStatus: 'succeeded' });
    expect(latest?.report?.verdict).toBe('pass');
    expect(typeof latest?.report?.summary).toBe('string');
    // 找茬是独立任务，不在每章固定审校面板里：不为它创建 review_panels 记录。
    const panels = context.database.prepare(`
      SELECT COUNT(*) AS count FROM review_panels WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { count: number };
    expect(panels.count).toBe(0);
    const calls = context.database.prepare(`
      SELECT phase_key FROM model_calls WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'succeeded'
    `).all(scope.ownerId, scope.bookId, scheduled.taskId) as unknown as Array<{ phase_key: string }>;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.phase_key).toContain('chapter-challenger-review');

    // 已经出结果后，作者可以针对同一章再次发起新一轮找茬。
    const again = service.start(scope, { chapterId: fixture.chapterId, idempotencyKey: 'challenger-flow-3' });
    expect(again.status).toBe('working');
    expect(again.taskId).not.toBe(scheduled.taskId);
  });
});

function challengerService(context: TestContext, ids: SequenceIds, clock: FixedClock): ChapterChallengerReviewService {
  return new ChapterChallengerReviewService(
    new ChapterChallengerReviewRepository(context.database),
    new VolumePlanGenerationRepository(context.database),
    new TaskService(context.database, context.config.releaseId, clock),
    new UnitOfWork(context.database),
    ids,
    clock
  );
}
