import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

describe('阶段3从Schema 2升级', () => {
  it('保留已有书籍并新增运行表', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmai-runtime-upgrade-'));
    const migrations = resolve(root, 'migrations');
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    mkdirSync(migrations);
    for (const name of ['0001_foundation.sql', '0002_data_safety.sql']) {
      writeFileSync(resolve(migrations, name), readFileSync(resolve(source, name)));
    }
    const database = openDatabase(resolve(root, 'database.sqlite'));
    try {
      runMigrations(database, migrations);
      database.prepare("INSERT INTO release_runs VALUES ('release-old', '文脉写作', 2, 'v1', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO owners VALUES ('owner-one', '老板', 1, '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO books (book_id, owner_id, title, status, created_at, updated_at) VALUES ('book-alpha', 'owner-one', '旧书', 'draft', '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      writeFileSync(resolve(migrations, '0003_runtime.sql'), readFileSync(resolve(source, '0003_runtime.sql')));
      expect(runMigrations(database, migrations).applied).toEqual(['0003_runtime.sql']);
      expect(database.prepare("SELECT title FROM books WHERE book_id = 'book-alpha'").get()).toEqual({ title: '旧书' });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'tasks'").get()).toEqual({ name: 'tasks' });
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

