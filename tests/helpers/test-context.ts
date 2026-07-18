import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { readReleaseId } from '../../apps/api/src/infrastructure/project-root.js';

export class FixedClock implements Clock {
  public constructor(private readonly value = new Date('2026-07-16T00:00:00.000Z')) {}
  public now(): Date { return new Date(this.value); }
}

export class MutableClock implements Clock {
  public constructor(private value = new Date('2026-07-16T00:00:00.000Z')) {}
  public now(): Date { return new Date(this.value); }
  public advance(milliseconds: number): void { this.value = new Date(this.value.getTime() + milliseconds); }
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

export function createTestContext(prefix = 'wenmi-test-'): TestContext {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  const dataDir = resolve(root, 'data');
  const config: RuntimeConfig = {
    apiHost: '127.0.0.1',
    apiPort: 43111,
    dataDir,
    databasePath: resolve(dataDir, 'database', 'wenmi.sqlite'),
    projectRoot: process.cwd(),
    releaseId: readReleaseId(process.cwd()),
    ownerId: 'owner-local-boss',
    webOrigin: 'http://127.0.0.1:43110',
    workerToken: 'test-worker-token-00000000000000000000000000000000',
    modelRuntime: loadModelRuntimeConfig({}, { codexWorkingDirectory: resolve(dataDir, 'cache', 'codex-runtime') })
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
