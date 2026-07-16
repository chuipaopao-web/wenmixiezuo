import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkerHeartbeat } from '../../apps/worker/src/health/heartbeat.js';
import { WorkerLoop } from '../../apps/worker/src/runtime/worker-loop.js';
import { TaskClaimer } from '../../apps/worker/src/scheduler/task-claimer.js';
import { TaskService } from '../../apps/api/src/application/tasks/task-service.js';
import { initializeRuntimeBook } from '../helpers/runtime-fixture.js';
import { createTestContext, MutableClock, SequenceIds, type TestContext } from '../helpers/test-context.js';

describe('Worker 24小时逻辑稳定性', () => {
  let context: TestContext | undefined;
  let heartbeat: WorkerHeartbeat | undefined;
  afterEach(() => {
    heartbeat?.stop();
    context?.close();
  });

  it('以每分钟一个调度周期覆盖24小时，无僵尸任务、暂存残留或无界状态增长', async () => {
    context = createTestContext('wenmi-worker-soak-');
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-soak', bookId: 'book-soak' };
    initializeRuntimeBook(context, scope, ids, clock, '24小时稳定性书');
    const workerId = 'worker-logical-24h';
    heartbeat = new WorkerHeartbeat(context.database, {
      databasePath: context.config.databasePath,
      releaseId: context.config.releaseId,
      workerId,
      apiBaseUrl: 'http://127.0.0.1:1'
    });
    heartbeat.start();
    const loop = new WorkerLoop(new TaskClaimer(context.database, workerId), heartbeat);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const heapBefore = process.memoryUsage().heapUsed;

    for (let minute = 0; minute < 24 * 60; minute += 1) {
      if (minute % 60 === 0) {
        const taskId = `soak-hour-${String(minute / 60).padStart(2, '0')}`;
        tasks.create(scope, { taskId, taskType: 'runtime_probe', idempotencyKey: taskId, initialPhase: 'execute', brief: { logicalMinute: minute } });
        tasks.queue(scope, taskId);
      }
      await loop.runOnce();
      clock.advance(60_000);
    }
    await loop.runOnce();
    context.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 24 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ? AND status <> 'succeeded'`).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM worker_health WHERE worker_id = ?`).get(workerId)).toEqual({ count: 1 });
    expect(context.database.prepare(`SELECT current_task_id FROM worker_health WHERE worker_id = ?`).get(workerId)).toEqual({ current_task_id: null });
    const stagingPath = resolve(context.dataDir, 'staging');
    expect(existsSync(stagingPath) ? readdirSync(stagingPath) : []).toEqual([]);
    expect(heapGrowth).toBeLessThan(32 * 1024 * 1024);
  }, 30_000);
});
