import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';

const tempDirectories: string[] = [];
function createTempDirectory(): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'wenmai-migration-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('向前迁移器', () => {
  it('在空库执行并可安全重复运行', () => {
    const directory = createTempDirectory();
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    const migrationsDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    try {
      const first = runMigrations(database, migrationsDir);
      const second = runMigrations(database, migrationsDir);
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      expect(first.applied).toEqual(['0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql', '0004_novel_domain.sql']);
      expect(second.applied).toEqual([]);
      expect(tables.map((row) => row.name)).toContain('worker_health');
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(database.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
    } finally {
      database.close();
    }
  });

  it('失败迁移完整回滚且不登记版本', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    writeFileSync(resolve(migrationsDir, '0001_broken.sql'), 'CREATE TABLE should_rollback(id TEXT);\nTHIS IS INVALID;', 'utf8');
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      expect(() => runMigrations(database, migrationsDir)).toThrow('迁移 0001_broken.sql 失败');
      const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'").get();
      const applied = database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get();
      expect(table).toBeUndefined();
      expect(applied).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('拒绝已执行迁移被修改', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const migrationPath = resolve(migrationsDir, '0001_initial.sql');
    writeFileSync(migrationPath, 'CREATE TABLE stable(id TEXT PRIMARY KEY) STRICT;', 'utf8');
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      writeFileSync(migrationPath, 'CREATE TABLE changed(id TEXT PRIMARY KEY) STRICT;', 'utf8');
      expect(() => runMigrations(database, migrationsDir)).toThrow('校验和发生变化');
    } finally {
      database.close();
    }
  });
});
