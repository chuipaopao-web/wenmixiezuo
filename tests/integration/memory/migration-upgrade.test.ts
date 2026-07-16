import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

describe('阶段5从Schema 4升级', () => {
  it('保留已有书籍与领域数据并新增记忆正史表', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmai-memory-upgrade-'));
    const migrations = resolve(root, 'migrations');
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    mkdirSync(migrations);
    for (const name of ['0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql', '0004_novel_domain.sql']) {
      writeFileSync(resolve(migrations, name), readFileSync(resolve(source, name)));
    }
    const database = openDatabase(resolve(root, 'database.sqlite'));
    try {
      runMigrations(database, migrations);
      database.prepare("INSERT INTO release_runs VALUES ('release-old', '文脉写作', 4, 'v1', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO owners VALUES ('owner-one', '老板', 1, '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO books (book_id, owner_id, title, status, created_at, updated_at) VALUES ('book-alpha', 'owner-one', '旧书', 'draft', '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      database.prepare("INSERT INTO positioning_drafts (draft_id, owner_id, proposed_book_id, title, input_text, fields_json, tags_json, status, version, created_at, updated_at) VALUES ('draft-old', 'owner-one', 'book-beta', '旧定位', '文本', '[]', '[]', 'editing', 1, '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')").run();
      writeFileSync(resolve(migrations, '0005_memory_canon.sql'), readFileSync(resolve(source, '0005_memory_canon.sql')));
      expect(runMigrations(database, migrations).applied).toEqual(['0005_memory_canon.sql']);
      expect(database.prepare("SELECT title FROM books WHERE book_id = 'book-alpha'").get()).toEqual({ title: '旧书' });
      expect(database.prepare("SELECT title FROM positioning_drafts WHERE draft_id = 'draft-old'").get()).toEqual({ title: '旧定位' });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'canon_revisions'").get()).toEqual({ name: 'canon_revisions' });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'content_fts'").get()).toEqual({ name: 'content_fts' });
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
