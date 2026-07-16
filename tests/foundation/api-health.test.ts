import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { createServer } from '../../apps/api/src/http/server.js';

const tempDirectories: string[] = [];
afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe('API健康检查', () => {
  it('返回发布、Schema和数据库真实状态', async () => {
    const tempDirectory = mkdtempSync(resolve(tmpdir(), 'wenmai-health-'));
    tempDirectories.push(tempDirectory);
    const config: RuntimeConfig = {
      apiHost: '127.0.0.1',
      apiPort: 43111,
      dataDir: tempDirectory,
      databasePath: resolve(tempDirectory, 'database.sqlite'),
      projectRoot: process.cwd(),
      releaseId: 'wm-v1-20260716-220959-d5dd704d',
      ownerId: 'owner-local-boss',
      webOrigin: 'http://127.0.0.1:43110'
    };
    const database = openDatabase(config.databasePath);
    bootstrapDatabase(database, config);
    const app = await createServer(config, database);
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: { status: 'ok', releaseId: config.releaseId, schemaVersion: 5 },
        meta: { version: 1 }
      });
    } finally {
      await app.close();
      database.close();
    }
  });
});
