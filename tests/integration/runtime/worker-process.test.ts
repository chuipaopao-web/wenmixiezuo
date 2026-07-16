import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
let child: ChildProcess | undefined;
afterEach(async () => {
  if (child !== undefined && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolvePromise) => child!.once('exit', () => resolvePromise()));
  }
  child = undefined;
  context?.close();
  context = undefined;
});

describe('独立Worker进程', () => {
  it('从共享SQLite领取runtime_probe并持久完成', async () => {
    context = createTestContext('wenmi-worker-process-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    initializeRuntimeBook(context, scope, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-process', taskType: 'runtime_probe', idempotencyKey: 'process', initialPhase: 'execute', brief: {} });
    tasks.queue(scope, 'task-process');

    child = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'apps/worker/src/main.ts')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WENMI_DATA_DIR: context.dataDir,
        WENMI_PROJECT_ROOT: process.cwd(),
        WENMI_WORKER_ID: 'worker-process-test'
      },
      stdio: 'ignore'
    });

    const deadline = Date.now() + 8_000;
    let status = tasks.require(scope, 'task-process').status;
    while (status !== 'succeeded' && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      status = tasks.require(scope, 'task-process').status;
    }
    expect(status).toBe('succeeded');
    expect(context.database.prepare("SELECT current_task_id FROM worker_health WHERE worker_id = 'worker-process-test'").get())
      .toEqual({ current_task_id: null });
  });
});
