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
});
