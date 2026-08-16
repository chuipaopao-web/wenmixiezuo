import { afterEach, describe, expect, it } from 'vitest';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { TaskClaimer } from '../../../apps/worker/src/scheduler/task-claimer.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('Worker受限Repository', () => {
  it('领取runtime_probe并只更新任务、阶段和事件表', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    initializeRuntimeBook(context, scope, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-worker', taskType: 'runtime_probe', idempotencyKey: 'worker', initialPhase: 'execute', brief: {} });
    tasks.queue(scope, 'task-worker');
    const claimer = new TaskClaimer(context.database, 'worker-test', () => clock.now());
    const claimed = claimer.claimNext(clock.now(), 120_000)!;
    expect(Date.parse(tasks.require(scope, 'task-worker').leaseExpiresAt!) - clock.now().getTime()).toBe(120_000);
    const renewedAt = new Date(clock.now().getTime() + 30_000);
    expect(() => claimer.renew(claimed, 120_000, renewedAt)).not.toThrow();
    expect(Date.parse(tasks.require(scope, 'task-worker').leaseExpiresAt!) - renewedAt.getTime()).toBe(120_000);
    claimer.complete(claimed, { deterministic: true });
    expect(tasks.require(scope, 'task-worker').status).toBe('succeeded');
    expect(context.database.prepare("SELECT status FROM task_phases WHERE task_id = 'task-worker'").get()).toEqual({ status: 'succeeded' });
    expect(context.database.prepare("SELECT COUNT(*) AS count FROM persistent_events WHERE event_type = 'task.completed'").get()).toEqual({ count: 1 });
  });

  it('不同书任务可同时领取，同书任务排队等待', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scopeA = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const scopeB = { ownerId: 'owner-two', bookId: 'book-beta' };
    initializeRuntimeBook(context, scopeA, ids, clock, '并行书甲');
    initializeRuntimeBook(context, scopeB, ids, clock, '并行书乙');
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    for (const [scope, taskId, key] of [
      [scopeA, 'task-a1', 'key-a1'], [scopeA, 'task-a2', 'key-a2'], [scopeB, 'task-b1', 'key-b1']
    ] as const) {
      tasks.create(scope, { taskId, taskType: 'runtime_probe', idempotencyKey: key, initialPhase: 'execute', brief: {} });
      tasks.queue(scope, taskId);
    }
    const claimer = new TaskClaimer(context.database, 'worker-test', () => clock.now());
    const first = claimer.claimNext(clock.now(), 120_000)!;
    const second = claimer.claimNext(clock.now(), 120_000)!;
    const third = claimer.claimNext(clock.now(), 120_000);
    // 领取顺序按 task_id：先领甲书 task-a1；同书 task-a2 被按书互斥挡住，第二次必领乙书 task-b1；之后无可领任务
    expect(first.taskId).toBe('task-a1');
    expect(second.taskId).toBe('task-b1');
    expect(third).toBeNull();
    expect(tasks.require(scopeA, 'task-a1').status).toBe('working');
    expect(tasks.require(scopeA, 'task-a2').status).toBe('queued');
    expect(tasks.require(scopeB, 'task-b1').status).toBe('working');
  });
});
