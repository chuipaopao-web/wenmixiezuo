import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerHeartbeat } from '../../apps/worker/src/health/heartbeat.js';

describe('Worker心跳写锁容错', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('全书删除持有SQLite写锁时延后心跳而不让Worker退出', () => {
    const busyError = Object.assign(new Error('database is locked'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 5,
      errstr: 'database is locked'
    });
    const run = vi.fn()
      .mockImplementationOnce(() => { throw busyError; })
      .mockReturnValue({ changes: 1 });
    const database = {
      prepare: vi.fn(() => ({ run }))
    } as unknown as DatabaseSync;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const heartbeat = new WorkerHeartbeat(database, {
      dataDir: 'D:\\wenmixiezuo\\data',
      databasePath: 'D:\\wenmixiezuo\\data\\database\\wenmi.sqlite',
      releaseId: 'test-release',
      workerId: 'busy-heartbeat-worker',
      apiBaseUrl: 'http://127.0.0.1:43111',
      workerToken: 'test-worker-token',
      v7FormalizationEnabled: false
    });

    expect(() => heartbeat.setCurrentTask('book-purge-in-progress')).not.toThrow();
    expect(() => heartbeat.setCurrentTask(null)).not.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"reason":"database-busy"'));
  });

  it('非临时锁错误仍然上抛，避免掩盖数据库损坏', () => {
    const database = {
      prepare: vi.fn(() => ({
        run: vi.fn(() => { throw new Error('no such table: worker_health'); })
      }))
    } as unknown as DatabaseSync;
    const heartbeat = new WorkerHeartbeat(database, {
      dataDir: 'D:\\wenmixiezuo\\data',
      databasePath: 'D:\\wenmixiezuo\\data\\database\\wenmi.sqlite',
      releaseId: 'test-release',
      workerId: 'broken-heartbeat-worker',
      apiBaseUrl: 'http://127.0.0.1:43111',
      workerToken: 'test-worker-token',
      v7FormalizationEnabled: false
    });

    expect(() => heartbeat.setCurrentTask(null)).toThrow('no such table');
  });
});
