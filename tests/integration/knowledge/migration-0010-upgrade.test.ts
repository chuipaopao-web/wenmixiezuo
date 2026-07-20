import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('Schema 9升级到表达、知识生命周期与切片投影', () => {
  it('只向前追加0010—0023，保留旧书并可重复执行', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmi-migration-0010-'));
    cleanup.push(root);
    const legacyMigrations = resolve(root, 'legacy');
    mkdirSync(legacyMigrations);
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (let index = 1; index <= 9; index += 1) {
      const prefix = String(index).padStart(4, '0');
      const name = [
        '0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql', '0004_novel_domain.sql',
        '0005_memory_canon.sql', '0006_creation_pipeline.sql', '0007_experience_copyright.sql',
        '0008_agent_personas.sql', '0009_role_titles.sql'
      ].find((candidate) => candidate.startsWith(prefix))!;
      copyFileSync(resolve(source, name), resolve(legacyMigrations, name));
    }
    const database = new DatabaseSync(resolve(root, 'upgrade.sqlite'));
    database.exec('PRAGMA foreign_keys = ON');
    try {
      expect(runMigrations(database, legacyMigrations).currentVersion).toBe(9);
      database.prepare(`INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES ('owner-1', '老板', 1, '2026-01-01', '2026-01-01')`).run();
      database.prepare(`
        INSERT INTO books (book_id, owner_id, title, status, version, positioning_version, canon_revision, editor_epoch, created_at, updated_at)
        VALUES ('book-1', 'owner-1', '旧书', 'active', 1, 0, 0, 0, '2026-01-01', '2026-01-01')
      `).run();
      const upgraded = runMigrations(database, source);
      expect(upgraded.applied).toEqual(['0010_expression_taxonomy.sql', '0011_knowledge_lifecycle_time.sql', '0012_chunk_projection_snapshots.sql', '0013_retrieval_orchestration.sql', '0014_longform_continuity.sql', '0015_agent_compression_prompts.sql', '0016_production_workflow.sql', '0017_experience_freeze.sql', '0018_portability_operations.sql', '0019_chat_attachments.sql', '0020_runtime_integrity.sql', '0021_canon_index_requests.sql', '0022_editor_review_syntheses.sql', '0023_manuscript_protagonist_workspace.sql']);
      expect(database.prepare(`SELECT title, canon_revision FROM books WHERE book_id = 'book-1'`).get()).toEqual({ title: '旧书', canon_revision: 0 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('knowledge_revisions')`).get()).toEqual({ count: expect.any(Number) });
      expect(runMigrations(database, source).applied).toEqual([]);
    } finally {
      database.close();
    }
  });
});
