import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

describe('阶段4从Schema 3升级', () => {
  it('保留运行任务并新增小说领域表', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmai-domain-upgrade-'));
    const migrations = resolve(root, 'migrations');
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    mkdirSync(migrations);
    for (const name of ['0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql']) writeFileSync(resolve(migrations, name), readFileSync(resolve(source, name)));
    const database = openDatabase(resolve(root, 'database.sqlite'));
    try {
      runMigrations(database, migrations);
      database.prepare("INSERT INTO release_runs VALUES ('release-old', '文脉写作', 3, 'v1', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO owners VALUES ('owner-one', '老板', 1, '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO books (book_id, owner_id, title, status, created_at, updated_at) VALUES ('book-alpha', 'owner-one', '旧书', 'draft', '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO tasks (task_id, release_id, owner_id, book_id, task_type, task_brief_json, status, current_phase, idempotency_key, checkpoint_json, created_at, updated_at) VALUES ('task-old', 'release-old', 'owner-one', 'book-alpha', 'probe', '{}', 'pending', 'start', 'old', '{}', '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      writeFileSync(resolve(migrations, '0004_novel_domain.sql'), readFileSync(resolve(source, '0004_novel_domain.sql')));
      expect(runMigrations(database, migrations).applied).toEqual(['0004_novel_domain.sql']);
      expect(database.prepare("SELECT status FROM tasks WHERE task_id = 'task-old'").get()).toEqual({ status: 'pending' });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'artifacts'").get()).toEqual({ name: 'artifacts' });
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
