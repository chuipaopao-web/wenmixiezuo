/** B1返修：真实迁移器（0122含alias/release_relations/canonical列）初次及重入。 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');

function freshDb(): { database: DatabaseSync; root: string } {
  const root = mkdtempSync(resolve(tmpdir(), 'b1r-mig-'));
  const database = new DatabaseSync(resolve(root, 'wenmi.sqlite'));
  return { database, root };
}

describe('creative-reference migration 0122 (revised)', () => {
  it('真实迁移器首次执行创建全部表（含返修新增）；重入安全', () => {
    const { database, root } = freshDb();
    try {
      const first = runMigrations(database, MIGRATIONS_DIR);
      expect(first.applied).toContain('0122_creative_reference.sql');
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'creative_reference_%'").all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name).sort()).toEqual([
        'creative_reference_aliases', 'creative_reference_cards', 'creative_reference_counters',
        'creative_reference_relations', 'creative_reference_release_relations', 'creative_reference_releases', 'creative_reference_revisions'
      ]);
      const again = runMigrations(database, MIGRATIONS_DIR);
      expect(again.applied).toEqual([]);
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('不触碰既有合成表数据；新表无书籍归属列', () => {
    const { database, root } = freshDb();
    try {
      runMigrations(database, MIGRATIONS_DIR);
      database.exec("CREATE TABLE legacy_demo(owner_id TEXT, book_id TEXT, PRIMARY KEY(owner_id,book_id)) STRICT");
      database.prepare('INSERT INTO legacy_demo VALUES (?,?)').run('owner-1', 'book-1');
      runMigrations(database, MIGRATIONS_DIR);
      expect((database.prepare('SELECT COUNT(*) c FROM legacy_demo').get() as { c: number }).c).toBe(1);
      const columns = database.prepare("SELECT name FROM pragma_table_info('creative_reference_cards')").all() as Array<{ name: string }>;
      const names = columns.map((c) => c.name);
      expect(names).not.toContain('owner_id');
      expect(names).not.toContain('book_id');
      expect(names).toContain('create_request_fingerprint');
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('迁移校验和约束真实生效：篡改后重入报错', () => {
    const { database, root } = freshDb();
    try {
      runMigrations(database, MIGRATIONS_DIR);
      database.prepare("UPDATE schema_migrations SET checksum='tampered' WHERE name='0122_creative_reference.sql'").run();
      expect(() => runMigrations(database, MIGRATIONS_DIR)).toThrow(/校验和/);
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
