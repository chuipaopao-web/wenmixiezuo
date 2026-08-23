import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';

const tempDirectories: string[] = [];
function createTempDirectory(): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'wenmi-migration-'));
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
      expect(first.applied).toEqual([
        '0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql', '0004_novel_domain.sql',
        '0005_memory_canon.sql', '0006_creation_pipeline.sql', '0007_experience_copyright.sql',
        '0008_agent_personas.sql', '0009_role_titles.sql', '0010_expression_taxonomy.sql',
        '0011_knowledge_lifecycle_time.sql', '0012_chunk_projection_snapshots.sql',
        '0013_retrieval_orchestration.sql', '0014_longform_continuity.sql',
        '0015_agent_compression_prompts.sql', '0016_production_workflow.sql',
        '0017_experience_freeze.sql', '0018_portability_operations.sql', '0019_chat_attachments.sql',
        '0020_runtime_integrity.sql',
        '0021_canon_index_requests.sql',
        '0022_editor_review_syntheses.sql',
        '0023_manuscript_protagonist_workspace.sql',
        '0024_settled_chapter_generation_status.sql',
        '0025_opening_blueprints.sql',
        '0026_creative_sessions_and_context_policy.sql',
        '0027_attribute_formula_categories.sql',
        '0028_agent_prompt_preferences.sql',
        '0029_setting_outline_workspace.sql',
        '0030_planning_stage_and_style.sql',
        '0031_book_purge_retrieval_index.sql',
        '0032_setting_outline_decision_content.sql',
        '0033_retire_volume_outline.sql',
        '0034_existing_manuscript_continuation.sql', '0035_continuation_analysis.sql',
        '0036_author_planning_inputs.sql', '0037_author_input_link_order.sql', '0038_volume_planning.sql',
        '0039_story_event_planning.sql', '0040_event_chapter_outlines.sql', '0041_planning_settlement_assessments.sql',
        '0042_author_attachments.sql',
        '0043_user_accounts.sql',
        '0044_first_admin_legacy_owner.sql',
        '0045_user_memberships.sql',
        '0046_model_call_error_detail.sql',
        '0047_opening_drafts.sql', '0048_book_branding_designs.sql', '0049_review_challenger_seat.sql',
        '0050_settlement_follow_ups.sql',
        '0051_setting_item_versions.sql', '0052_setting_discussion_fragments.sql',
        '0053_setting_pending_candidate.sql', '0054_setting_quality_reports.sql',
        '0055_chapter_challenger_reviews.sql',
        '0056_platform_model_scheme.sql',
        '0057_membership_tiers.sql',
        '0058_layered_volume_and_event_chain.sql',
        '0059_layered_constraints_and_context.sql',
        '0060_first_volume_launch_progress.sql', '0061_story_thread_keys.sql',
        '0062_setting_gap_status.sql',
        '0063_independent_admin_console.sql',
        '0064_setting_member_resilience.sql',
        '0065_v6_core_workflow.sql',
        '0066_ai_editorial_node_batches.sql', '0067_chapter_editor_synthesis_requests.sql',
        '0068_rolling_storyline_growth.sql'
      ]);
      expect(second.applied).toEqual([]);
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
        'storyline_frontier_versions', 'storyline_open_questions_v6', 'storyline_growth_rounds_v6',
        'storyline_growth_candidates_v6', 'storyline_growth_decisions_v6', 'creative_template_versions_v6',
        'storyline_settlement_projection_receipts_v6'
      ]));
      const batchColumns = database.prepare("PRAGMA table_info('ai_node_batches_v6')").all() as Array<{ name: string }>;
      expect(batchColumns.map((row) => row.name)).toEqual(expect.arrayContaining(['template_version_id', 'template_hash']));
      expect(tables.map((row) => row.name)).toContain('worker_health');
      expect(tables.map((row) => row.name)).toContain('author_attachments');
      expect(tables.map((row) => row.name)).not.toContain('chat_attachments');
      expect(tables.map((row) => row.name)).toContain('task_attempts');
      expect(tables.map((row) => row.name)).toContain('model_call_results');
      expect(tables.map((row) => row.name)).toContain('protagonist_profiles');
      expect(tables.map((row) => row.name)).toContain('protagonist_state_entries');
      expect(tables.map((row) => row.name)).toContain('attribute_formulas');
      expect(tables.map((row) => row.name)).toContain('book_opening_blueprints');
      expect(tables.map((row) => row.name)).toContain('creative_sessions');
      expect(tables.map((row) => row.name)).toContain('creative_blackboard_revisions');
      expect(tables.map((row) => row.name)).toContain('narrative_forecasts');
      expect(tables.map((row) => row.name)).toContain('agent_prompt_preferences');
      expect(tables.map((row) => row.name)).toContain('setting_outline_workspace');
      expect(tables.map((row) => row.name)).toContain('continuation_imports');
      expect(tables.map((row) => row.name)).toContain('continuation_import_chapters');
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
        'author_planning_inputs', 'author_planning_input_decisions', 'author_planning_input_links'
      ]));
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
        'volume_direction_versions', 'book_story_spine_versions', 'event_chain_versions',
        'story_thread_records', 'setting_clauses', 'setting_gap_decisions', 'context_pack_components'
      ]));
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
        'book_storyline_topology_versions', 'storylines', 'storyline_versions', 'storyline_relations',
        'storyline_volume_participations', 'character_cards', 'event_role_assignments',
        'creative_ledger_entries', 'author_object_drafts', 'workflow_invalidations_v6'
      ]));
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
        'agent_role_pools_v6', 'agent_member_settings_v6', 'agent_skill_versions_v6',
        'ai_node_author_inputs_v6', 'ai_node_batches_v6', 'ai_node_batch_members_v6', 'ai_node_results_v6'
      ]));
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
        'membership_transactions', 'user_feedback', 'admin_issue_records',
        'platform_prompt_overrides', 'model_call_prompt_snapshots', 'narrative_method_overrides'
      ]));
      const settingOutlineColumns = database.prepare('PRAGMA table_info(setting_outline_workspace)').all() as Array<{ name: string }>;
      expect(settingOutlineColumns.map((row) => row.name)).toEqual(expect.arrayContaining([
        'content_text', 'source_discussion_id', 'source_decision_id', 'candidate_at', 'confirmed_at'
      ]));
      const manuscriptColumns = database.prepare('PRAGMA table_info(manuscript_versions)').all() as Array<{ name: string }>;
      expect(manuscriptColumns.map((row) => row.name)).toEqual(expect.arrayContaining(['creator_kind', 'edit_note']));
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(database.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
    } finally {
      database.close();
    }
  });

  it('0068保留正文、结算、调用审计哈希，并容忍历史账本重复记录', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const sourceDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(sourceDir).filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < '0068_')) {
      copyFileSync(resolve(sourceDir, file), resolve(migrationsDir, file));
    }
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    const digest = (table: string): string => createHash('sha256')
      .update(JSON.stringify(database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())).digest('hex');
    try {
      runMigrations(database, migrationsDir);
      database.exec('PRAGMA foreign_keys=OFF');
      const now = '2026-08-23T00:00:00.000Z';
      database.prepare('INSERT INTO owners (owner_id,display_name,created_at,updated_at) VALUES (?,?,?,?)')
        .run('owner-hash', '迁移哈希作者', now, now);
      database.prepare("INSERT INTO books (book_id,owner_id,title,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
        .run('book-hash', 'owner-hash', '迁移哈希书', now, now);
      database.prepare(`INSERT INTO manuscript_versions (manuscript_version_id,owner_id,book_id,chapter_id,parent_version_id,
        author_agent_id,model_provider,model_id,source_task_id,file_id,content_hash,word_count,status,created_at)
        VALUES ('manuscript-hash','owner-hash','book-hash','chapter-hash',NULL,'agent-hash','manual','owner-edit',
          'task-hash','file-hash',?,321,'canon',?)`).run('a'.repeat(64), now);
      database.prepare(`INSERT INTO stage_settlements (stage_settlement_id,owner_id,book_id,stage_type,stage_key,version,
        chapter_start,chapter_end,canon_revision,irreversible_results_json,entity_states_json,closed_threads_json,
        open_threads_json,relationship_changes_json,knowledge_changes_json,resource_changes_json,rule_changes_json,
        exclusions_json,status,created_at,activated_at) VALUES ('settlement-hash','owner-hash','book-hash','volume','volume-hash',
          1,1,10,1,'["结果"]','{}','[]','[]','[]','[]','[]','[]','[]','active',?,?)`).run(now, now);
      database.prepare(`INSERT INTO model_calls (request_id,owner_id,book_id,task_id,phase_key,agent_id,provider,model_id,
        model_snapshot_id,input_hash,parameters_hash,context_pack_id,reservation_id,state,input_tokens,output_tokens,
        cash_micros,duration_ms,result_reference,created_at) VALUES ('call-hash','owner-hash','book-hash','task-hash','draft',
          'agent-hash','provider-hash','model-hash','snapshot-hash',?,?,'pack-hash','reservation-hash','succeeded',100,200,0,10,'result-hash',?)`)
        .run('b'.repeat(64), 'c'.repeat(64), now);
      const insertLedger = database.prepare(`INSERT INTO creative_ledger_entries (ledger_entry_id,owner_id,book_id,ledger_type,
        truth_status,scope_type,scope_id,subject_key,entry_status,content_json,source_kind,source_version_id,created_at)
        VALUES (?,'owner-hash','book-hash','storyline','actual','volume','volume-hash','line-hash','advanced','{"actual":"结果"}',
          'volume_settlement','settlement-hash',?)`);
      insertLedger.run('ledger-duplicate-a', now); insertLedger.run('ledger-duplicate-b', now);
      const before = { manuscript: digest('manuscript_versions'), settlement: digest('stage_settlements'), calls: digest('model_calls') };

      copyFileSync(resolve(sourceDir, '0068_rolling_storyline_growth.sql'), resolve(migrationsDir, '0068_rolling_storyline_growth.sql'));
      expect(runMigrations(database, migrationsDir).applied).toEqual(['0068_rolling_storyline_growth.sql']);
      expect({ manuscript: digest('manuscript_versions'), settlement: digest('stage_settlements'), calls: digest('model_calls') }).toEqual(before);
      expect(database.prepare("SELECT COUNT(*) AS count FROM creative_ledger_entries WHERE subject_key='line-hash'").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='storyline_settlement_projection_receipts_v6'").get())
        .toEqual({ name: 'storyline_settlement_projection_receipts_v6' });
    } finally { database.close(); }
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

  it('把已有职责长称安全升级为女性姓名和短岗位', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    writeFileSync(resolve(migrationsDir, '0001_legacy_agents.sql'), `
      CREATE TABLE role_templates (
        role_template_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        role_key TEXT NOT NULL,
        display_name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE agent_instances (
        role_template_id TEXT NOT NULL,
        role_template_version INTEGER NOT NULL,
        display_name TEXT NOT NULL
      ) STRICT;
      INSERT INTO role_templates VALUES
        ('role-chief-editor', 1, 'chief_editor', '总编与编排'),
        ('role-style-editor', 1, 'style_editor', '文风编辑与去AI味专家');
      INSERT INTO agent_instances VALUES
        ('role-chief-editor', 1, '总编与编排'),
        ('role-style-editor', 1, '文风编辑与去AI味专家');
    `, 'utf8');
    const personaMigration = readFileSync(resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations/0008_agent_personas.sql'), 'utf8');
    writeFileSync(resolve(migrationsDir, '0002_agent_personas.sql'), personaMigration, 'utf8');
    const titleMigration = readFileSync(resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations/0009_role_titles.sql'), 'utf8');
    writeFileSync(resolve(migrationsDir, '0003_role_titles.sql'), titleMigration, 'utf8');
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      expect(database.prepare('SELECT role_key, display_name FROM role_templates ORDER BY role_key').all()).toEqual([
        { role_key: 'chief_editor', display_name: '主编' },
        { role_key: 'style_editor', display_name: '文编' }
      ]);
      expect(database.prepare('SELECT role_template_id, display_name FROM agent_instances ORDER BY role_template_id').all()).toEqual([
        { role_template_id: 'role-chief-editor', display_name: '貂蝉' },
        { role_template_id: 'role-style-editor', display_name: '清照' }
      ]);
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

  it('拒绝已执行迁移文件从迁移目录消失', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const migrationPath = resolve(migrationsDir, '0001_initial.sql');
    writeFileSync(migrationPath, 'CREATE TABLE stable(id TEXT PRIMARY KEY) STRICT;', 'utf8');
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      rmSync(migrationPath);
      expect(() => runMigrations(database, migrationsDir)).toThrow('已执行迁移文件缺失');
    } finally {
      database.close();
    }
  });
});
