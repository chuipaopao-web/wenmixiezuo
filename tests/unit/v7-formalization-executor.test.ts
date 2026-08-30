import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { V7FormalizationExecutor } from '../../apps/worker/src/executors/v7-formalization-executor.js';

let database: DatabaseSync | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  database?.close();
  database = undefined;
});

describe('V7写后维护Worker', () => {
  it('没有积压时不访问API', async () => {
    database = createDatabase();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const executor = new V7FormalizationExecutor(database, 'http://127.0.0.1:43111', 'worker-one', 'worker-token');
    await expect(executor.runNext()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('发现积压时只下发一次受保护的追赶请求', async () => {
    database = createDatabase();
    database.prepare(`INSERT INTO v7_formalization_outbox(status,attempt_count) VALUES('pending',0)`).run();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const executor = new V7FormalizationExecutor(database, 'http://127.0.0.1:43111', 'worker-one', 'worker-token');
    await expect(executor.runNext()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:43111/api/v1/internal/worker/v7/creation-formalization/process',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-wenmi-worker-id': 'worker-one', 'x-wenmi-worker-token': 'worker-token' }),
        body: JSON.stringify({ limit: 1 })
      })
    );
  });

  it('API拒绝追赶时明确失败而不是伪装完成', async () => {
    database = createDatabase();
    database.prepare(`INSERT INTO v7_formalization_outbox(status,attempt_count) VALUES('failed',1)`).run();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    const executor = new V7FormalizationExecutor(database, 'http://127.0.0.1:43111', 'worker-one', 'worker-token');
    await expect(executor.runNext()).rejects.toThrow('V7_FORMALIZATION_API_503');
  });
});

function createDatabase(): DatabaseSync {
  const result = new DatabaseSync(':memory:');
  result.exec(`CREATE TABLE v7_formalization_outbox(
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL
  )`);
  return result;
}
