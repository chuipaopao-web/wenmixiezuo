import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export interface MigrationResult {
  applied: string[];
  currentVersion: number;
}

interface MigrationRow {
  name: string;
  checksum: string;
}

interface ForeignKeyPragmaRow {
  foreign_keys: number;
}

interface ForeignKeyViolationRow {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

const FOREIGN_KEYS_OFF_MARKER = '-- wenmi-migration: foreign-keys-off';

function foreignKeyState(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA foreign_keys').get() as unknown as ForeignKeyPragmaRow | undefined;
  if (row === undefined || (row.foreign_keys !== 0 && row.foreign_keys !== 1)) {
    throw new Error('迁移器无法读取外键校验状态');
  }
  return row.foreign_keys;
}

export function runMigrations(database: DatabaseSync, migrationsDir: string): MigrationResult {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const appliedRows = database.prepare('SELECT name, checksum FROM schema_migrations').all() as unknown as MigrationRow[];
  const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));
  const names = readdirSync(migrationsDir)
    .filter((name) => /^[0-9]{4}_[a-z0-9_-]+\.sql$/.test(name))
    .sort();
  const available = new Set(names);
  const missingApplied = appliedRows.map((row) => row.name).filter((name) => !available.has(name)).sort();
  if (missingApplied.length > 0) {
    throw new Error(`已执行迁移文件缺失：${missingApplied.join(', ')}`);
  }
  const newlyApplied: string[] = [];

  for (const name of names) {
    const sql = readFileSync(resolve(migrationsDir, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existingChecksum = applied.get(name);
    if (existingChecksum !== undefined) {
      if (existingChecksum !== checksum) {
        throw new Error(`已合并迁移 ${name} 的校验和发生变化`);
      }
      continue;
    }
    const firstDirective = sql.split(/\r?\n/u).map((line) => line.trim()).find((line) => line.length > 0);
    const requiresForeignKeysOff = firstDirective === FOREIGN_KEYS_OFF_MARKER;
    const foreignKeysWereEnabled = foreignKeyState(database) === 1;
    let transactionOpen = false;
    try {
      if (requiresForeignKeysOff && foreignKeysWereEnabled) {
        database.exec('PRAGMA foreign_keys = OFF');
        const disabled = foreignKeyState(database);
        if (disabled !== 0) throw new Error('迁移器无法临时关闭外键校验');
      }
      database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      database.exec(sql);
      if (requiresForeignKeysOff) {
        const violations = database.prepare('PRAGMA foreign_key_check').all() as unknown as ForeignKeyViolationRow[];
        if (violations.length > 0) {
          const first = violations[0]!;
          throw new Error(`外键校验失败：${first.table} -> ${first.parent}`);
        }
      }
      database.prepare('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)')
        .run(name, checksum, new Date().toISOString());
      database.exec('COMMIT');
      transactionOpen = false;
      newlyApplied.push(name);
    } catch (error) {
      if (transactionOpen) database.exec('ROLLBACK');
      throw new Error(`迁移 ${basename(name)} 失败`, { cause: error });
    } finally {
      if (requiresForeignKeysOff && foreignKeysWereEnabled) {
        database.exec('PRAGMA foreign_keys = ON');
        const restored = foreignKeyState(database);
        if (restored !== 1) throw new Error('迁移器无法恢复外键校验');
      }
    }
  }

  return { applied: newlyApplied, currentVersion: names.length };
}
