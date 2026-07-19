import { afterEach, describe, expect, it } from 'vitest';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { DeterministicModelAdapter } from '../../../apps/api/src/infrastructure/models/deterministic-model.js';
import { MutableClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('Worker 24小时逻辑时钟耐久回放', () => {
  it('以1440个一分钟心跳、确定性模型和三次租约崩溃验证恢复且不残留僵尸任务', async () => {
    context = createTestContext('wenmi-worker-soak-');
    const ids = new SequenceIds();
    const clock = new MutableClock(new Date('2026-07-19T00:00:00.000Z'));
    const startedAt = clock.now().getTime();
    const scope = { ownerId: 'owner-one', bookId: 'book-soak' };
    initializeRuntimeBook(context, scope, ids, clock, '耐久回放书');
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const model = new DeterministicModelAdapter('wenmi-fixture-v2-soak');
    let logicalMinutes = 0;
    let recoveredLeases = 0;
    let modelInvocations = 0;
    let totalCashCostCny = 0;

    for (let hour = 1; hour <= 24; hour += 1) {
      const taskId = `soak-task-${String(hour).padStart(2, '0')}`;
      tasks.create(scope, {
        taskId,
        taskType: 'deterministic_soak_probe',
        idempotencyKey: `soak-hour-${hour}`,
        initialPhase: 'deterministic_generation',
        brief: { hour }
      });
      tasks.queue(scope, taskId);
      const workerId = `worker-soak-${hour}`;
      expect(tasks.claimNext(workerId, 90_000)?.taskId).toBe(taskId);
      const request = {
        requestId: `request-${hour}`,
        taskId,
        ownerId: scope.ownerId,
        bookId: scope.bookId,
        agentId: 'local-secretary-soak',
        prompt: `第${hour}小时确定性耐久探测`,
        maxOutputTokens: 128
      };
      const original = await model.generate(request);
      modelInvocations += 1;
      totalCashCostCny += original.cashCostCny;
      tasks.checkpoint(scope, taskId, workerId, 'heartbeat_soak', { output: original.output, logicalMinutes });

      let minuteInHour = 0;
      let activeWorker = workerId;
      const shouldCrash = hour === 6 || hour === 12 || hour === 18;
      while (minuteInHour < 60) {
        const crashNow = shouldCrash && minuteInHour === 29;
        const stepMinutes = crashNow ? 2 : 1;
        clock.advance(stepMinutes * 60_000);
        logicalMinutes += stepMinutes;
        minuteInHour += stepMinutes;
        if (crashNow) {
          expect(() => tasks.heartbeat(scope, taskId, activeWorker, 90_000)).toThrow('已过期');
          const recovered = tasks.recoverExpired();
          expect(recovered).toHaveLength(1);
          expect(recovered[0]?.status).toBe('queued');
          recoveredLeases += 1;
          activeWorker = `${workerId}-recovered`;
          expect(tasks.claimNext(activeWorker, 90_000)?.attemptCount).toBe(2);
          const replayed = await model.generate(request);
          modelInvocations += 1;
          totalCashCostCny += replayed.cashCostCny;
          expect(replayed.output).toBe(original.output);
          tasks.checkpoint(scope, taskId, activeWorker, 'heartbeat_soak', { output: replayed.output, logicalMinutes, recovered: true });
        } else {
          tasks.heartbeat(scope, taskId, activeWorker, 90_000);
        }
      }
      expect(tasks.complete(scope, taskId, activeWorker).status).toBe('succeeded');
    }

    expect(logicalMinutes).toBe(1_440);
    expect(clock.now().getTime() - startedAt).toBe(24 * 60 * 60 * 1_000);
    expect(recoveredLeases).toBe(3);
    expect(modelInvocations).toBe(27);
    expect(totalCashCostCny).toBe(0);
    expect(tasks.list(scope)).toHaveLength(24);
    expect(tasks.list(scope).every((task) => task.status === 'succeeded' && task.leaseOwner === null && task.leaseExpiresAt === null)).toBe(true);
    expect(context.database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status IN ('queued','working','interrupted')").get()).toEqual({ count: 0 });
    expect(context.database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(context.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
