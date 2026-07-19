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
        WENMI_PROJECT_ROOT: process.cwd(),
        WENMI_DATA_DIR: context.dataDir,
        WENMI_WORKER_ID: workerId,
        WENMI_API_BASE_URL: 'http://127.0.0.1:1'
      },
      stdio: 'ignore'
    });
    const first = await waitForHeartbeat(context.database, workerId, 5_000);
    expect(child.exitCode).toBeNull();
    expect(first).toBeDefined();
    await delay(5_200);
    const second = context.database.prepare(`SELECT heartbeat_at FROM worker_health WHERE worker_id = ?`).get(workerId) as { heartbeat_at: string };
    expect(Date.parse(second.heartbeat_at)).toBeGreaterThan(Date.parse(first!.heartbeat_at));
  });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForHeartbeat(database: TestContext['database'], workerId: string, timeoutMs: number): Promise<{ heartbeat_at: string } | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = database.prepare(`SELECT heartbeat_at FROM worker_health WHERE worker_id = ?`).get(workerId) as { heartbeat_at: string } | undefined;
    if (row !== undefined) return row;
    await delay(50);
  }
  return undefined;
}
