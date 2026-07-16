import { afterEach, describe, expect, it } from 'vitest';
import { AdaptationService } from '../../../apps/api/src/application/books/adaptation-service.js';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import type { PositioningField, PositioningTag } from '../../../apps/api/src/domain/positioning.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('规划成果版本与题材适配失效传播', () => {
  it('成果版本不可变，可比较、选择并从历史版本创建新版本', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock);
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new ArtifactService(context.database, ids, clock);
    const firstContent = { premise: '第一版', audience: '长篇读者', tone: '克制', constraints: ['成长'], arcs: ['成长'] };
    const secondContent = { premise: '第二版', audience: '长篇读者', tone: '克制', constraints: ['成长'], arcs: ['成长', '抉择'] };
    const first = service.create(scope, 'creative_plan', '创作方案', firstContent);
    const second = service.addVersion(scope, first.artifactId, secondContent, first.artifactVersionId);
    expect(service.compare(scope, first.artifactVersionId, second.artifactVersionId).changedTopLevelKeys).toEqual(['arcs', 'premise']);
    expect(service.select(scope, first.artifactId, second.artifactVersionId).status).toBe('selected');
    const reverted = service.revert(scope, first.artifactId, first.artifactVersionId);
    expect(reverted.version).toBe(3);
    expect(reverted.content).toEqual(first.content);
    expect(service.requireVersion(scope, first.artifactVersionId).content).toEqual(firstContent);
  });

  it('定位变化创建新适配快照并精确阻断旧成果和待执行任务', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock);
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const artifacts = new ArtifactService(context.database, ids, clock);
    const plan = artifacts.create(scope, 'creative_plan', '创作方案', { premise: '游戏成长', audience: '长篇读者', tone: '热血', constraints: [] });
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-plan', taskType: 'plan', idempotencyKey: 'plan', initialPhase: 'draft', brief: {} });
    const fields: PositioningField[] = [
      { key: 'premise', label: '核心创意', value: '北宋考据故事', sourceStatus: 'explicit', evidence: '老板修改' },
      { key: 'genre', label: '题材', value: '历史', sourceStatus: 'explicit', evidence: '历史' }
    ];
    const tags: PositioningTag[] = [{ name: '北宋', category: 'genre', sourceStatus: 'explicit' }];
    const current = new BookRepository(context.database).require(scope);
    const changed = new AdaptationService(context.database, ids, clock).revisePositioning(scope, current.version, fields, tags);
    expect(changed.positioningVersion).toBe(2);
    expect(changed.invalidatedCount).toBeGreaterThanOrEqual(3);
    expect(artifacts.requireVersion(scope, plan.artifactVersionId).status).toBe('invalidated');
    expect(tasks.require(scope, 'task-plan').status).toBe('blocked');
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM adaptation_snapshots WHERE owner_id = ? AND book_id = ?').get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
  });
});
