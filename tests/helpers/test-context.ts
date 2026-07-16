import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';

export class FixedClock implements Clock {
  public constructor(private readonly value = new Date('2026-07-16T00:00:00.000Z')) {}
  public now(): Date { return new Date(this.value); }
}

export class SequenceIds implements IdGenerator {
  #value = 0;
  public next(): string {
    this.#value += 1;
    return `generated-${String(this.#value).padStart(4, '0')}`;
  }
}

export interface TestContext {
  root: string;
  dataDir: string;
  database: DatabaseSync;
  config: RuntimeConfig;
  close(): void;
}

export function createTestContext(prefix = 'wenmai-test-'): TestContext {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  const dataDir = resolve(root, 'data');
  const config: RuntimeConfig = {
    apiHost: '127.0.0.1',
    apiPort: 43111,
    dataDir,
    databasePath: resolve(dataDir, 'database', 'wenmai.sqlite'),
    projectRoot: process.cwd(),
    releaseId: 'wm-v1-20260716-220959-d5dd704d',
    webOrigin: 'http://127.0.0.1:43110'
  };
  const database = openDatabase(config.databasePath);
  bootstrapDatabase(database, config);
  return {
    root,
    dataDir,
    database,
    config,
    close() {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  };
}

