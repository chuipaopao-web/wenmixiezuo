import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { captureChildProcessDiagnostics, workerSourceProcessArgs } from '../../helpers/worker-process.js';

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
    child = spawn(process.execPath, workerSourceProcessArgs(), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WENMI_PROJECT_ROOT: process.cwd(),
        WENMI_DATA_DIR: context.dataDir,
        WENMI_WORKER_ID: workerId,
        WENMI_API_BASE_URL: 'http://127.0.0.1:1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const diagnostics = captureChildProcessDiagnostics(child);
    // 全量测试并发编译大量 TypeScript 时，子进程首次加载 tsx 可能超过 5 秒；
    // 这里等待真实心跳而不是把主机负载误判成 Worker 退出，后续仍验证心跳持续更新。
    const first = await waitForHeartbeat(context.database, workerId, 15_000);
    expect(child.exitCode, diagnostics.summary()).toBeNull();
    expect(first, diagnostics.summary()).toBeDefined();
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
