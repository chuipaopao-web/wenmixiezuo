import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

describe('阶段6从Schema 5升级', () => {
  it('保留已有正史并新增可恢复创作流水线表', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmai-creation-upgrade-'));
    const migrations = resolve(root, 'migrations');
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    mkdirSync(migrations);
    for (const name of ['0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql', '0004_novel_domain.sql', '0005_memory_canon.sql']) {
      writeFileSync(resolve(migrations, name), readFileSync(resolve(source, name)));
    }
    const database = openDatabase(resolve(root, 'database.sqlite'));
    try {
      runMigrations(database, migrations);
      database.prepare("INSERT INTO release_runs VALUES ('release-old', '文脉写作', 5, 'v1', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO owners VALUES ('owner-one', '老板', 1, '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO books (book_id, owner_id, title, status, canon_revision, created_at, updated_at) VALUES ('book-alpha', 'owner-one', '正史书', 'active', 0, '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO canon_revisions (canon_revision_id, owner_id, book_id, revision, reason, content_hash, created_at) VALUES ('canon-zero', 'owner-one', 'book-alpha', 0, 'initial', ?, '2026-07-16T00:00:00Z')").run('0'.repeat(64));
      writeFileSync(resolve(migrations, '0006_creation_pipeline.sql'), readFileSync(resolve(source, '0006_creation_pipeline.sql')));
      expect(runMigrations(database, migrations).applied).toEqual(['0006_creation_pipeline.sql']);
      expect(database.prepare("SELECT canon_revision_id FROM canon_revisions WHERE book_id = 'book-alpha'").get()).toEqual({ canon_revision_id: 'canon-zero' });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'chapter_pipeline_runs'").get()).toEqual({ name: 'chapter_pipeline_runs' });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'review_issues'").get()).toEqual({ name: 'review_issues' });
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
