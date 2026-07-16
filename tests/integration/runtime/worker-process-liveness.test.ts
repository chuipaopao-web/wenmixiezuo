import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

describe('Worker生产进程生命周期', () => {
  let context: TestContext | undefined;
  let child: ChildProcess | undefined;

  afterEach(async () => {
    if (child !== undefined && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((resolvePromise) => child!.once('exit', () => resolvePromise()));
    }
    context?.close();
  });

  it('无待执行任务时仍持续驻留并更新心跳', async () => {
    context = createTestContext();
    const workerId = 'liveness-worker';
    child = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'apps/worker/src/main.ts')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WENMAI_PROJECT_ROOT: process.cwd(),
        WENMAI_DATA_DIR: context.dataDir,
        WENMAI_WORKER_ID: workerId,
        WENMAI_API_BASE_URL: 'http://127.0.0.1:1'
      },
      stdio: 'ignore'
    });
    await delay(1_300);
    expect(child.exitCode).toBeNull();
    const first = context.database.prepare(`SELECT heartbeat_at FROM worker_health WHERE worker_id = ?`).get(workerId) as { heartbeat_at: string } | undefined;
    expect(first).toBeDefined();
    await delay(5_200);
    const second = context.database.prepare(`SELECT heartbeat_at FROM worker_health WHERE worker_id = ?`).get(workerId) as { heartbeat_at: string };
    expect(Date.parse(second.heartbeat_at)).toBeGreaterThan(Date.parse(first!.heartbeat_at));
  });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
