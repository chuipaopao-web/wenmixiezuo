import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { createServer } from '../../apps/api/src/http/v7-server.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';

const tempDirectories: string[] = [];
afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe('API健康检查', () => {
  it('返回发布、Schema和数据库真实状态', async () => {
    const tempDirectory = mkdtempSync(resolve(tmpdir(), 'wenmi-health-'));
    tempDirectories.push(tempDirectory);
    const config: RuntimeConfig = {
      apiHost: '127.0.0.1',
      apiPort: 43111,
      dataDir: tempDirectory,
      databasePath: resolve(tempDirectory, 'database.sqlite'),
      projectRoot: process.cwd(),
      releaseId: 'wm-v1-20260716-220959-d5dd704d',
      ownerId: 'owner-local-boss',
      webOrigin: 'http://127.0.0.1:43110',
      adminOrigin: null,
      workerToken: 'test-worker-token-00000000000000000000000000000000',
      promptViewPassword: 'test-prompt-view-password',
      modelRuntime: loadModelRuntimeConfig({}),
      publicOrigin: null
    };
    const database = openDatabase(config.databasePath);
    bootstrapDatabase(database, config);
    const app = await createServer(config, database);
    try {
      app.get('/__test/unhandled-error', async () => {
        throw new Error('SQL failure at C:\\private\\secret.sqlite');
      });
      const response = await app.inject({ method: 'GET', url: '/health', headers: { host: '127.0.0.1:43111' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: {
          status: 'ok', releaseId: config.releaseId, time: expect.any(String)
        },
        meta: { version: 1 }
      });
      const body = response.body.toLowerCase();
      expect(body).not.toContain('authorization');
      expect(body).not.toContain('bearer ');
      expect(body).not.toContain('api_key');

      const failed = await app.inject({ method: 'GET', url: '/__test/unhandled-error', headers: { host: '127.0.0.1:43111' } });
      expect(failed.statusCode).toBe(500);
      expect(failed.json()).toMatchObject({
        error: {
          code: 'INTERNAL_ERROR',
          message: '这次没有顺利完成，请稍后再试。问题已经留下本地追踪信息，方便继续排查。'
        },
        meta: { requestId: expect.any(String) }
      });
      expect(failed.body).not.toContain('SQL failure');
      expect(failed.body).not.toContain('secret.sqlite');
      expect(failed.body).not.toContain('内部错误');
    } finally {
      await app.close();
      database.close();
    }
  });
});
