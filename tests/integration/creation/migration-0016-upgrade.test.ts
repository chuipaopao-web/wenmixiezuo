import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

describe('Schema 15升级到16', () => {
  it('保留历史稿件点评表并增加工单、三点评冻结字段和正文确认门禁', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmi-production-upgrade-'));
    const migrations = resolve(root, 'migrations');
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    mkdirSync(migrations);
    const previous = [
      '0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql', '0004_novel_domain.sql',
      '0005_memory_canon.sql', '0006_creation_pipeline.sql', '0007_experience_copyright.sql',
      '0008_agent_personas.sql', '0009_role_titles.sql', '0010_expression_taxonomy.sql',
      '0011_knowledge_lifecycle_time.sql', '0012_chunk_projection_snapshots.sql',
      '0013_retrieval_orchestration.sql', '0014_longform_continuity.sql', '0015_agent_compression_prompts.sql'
    ];
    for (const file of previous) {
      writeFileSync(resolve(migrations, file), readFileSync(resolve(source, file)));
    }
    const database = openDatabase(resolve(root, 'database.sqlite'));
    try {
      runMigrations(database, migrations);
      writeFileSync(resolve(migrations, '0016_production_workflow.sql'), readFileSync(resolve(source, '0016_production_workflow.sql')));
      expect(runMigrations(database, migrations).applied).toEqual(['0016_production_workflow.sql']);
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('writing_orders','writing_order_sources','chapter_approval_gates') ORDER BY name").all();
      expect(tables).toEqual([{ name: 'chapter_approval_gates' }, { name: 'writing_order_sources' }, { name: 'writing_orders' }]);
      const columns = database.prepare(`PRAGMA table_info(review_panels)`).all() as unknown as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['review_round', 'manuscript_hash', 'writer_epoch', 'writing_order_id']));
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
