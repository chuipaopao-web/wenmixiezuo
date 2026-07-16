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
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)')
        .run(name, checksum, new Date().toISOString());
      database.exec('COMMIT');
      newlyApplied.push(name);
    } catch (error) {
      database.exec('ROLLBACK');
      throw new Error(`迁移 ${basename(name)} 失败`, { cause: error });
    }
  }

  return { applied: newlyApplied, currentVersion: names.length };
}

