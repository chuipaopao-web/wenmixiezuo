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
        '0068_rolling_storyline_growth.sql',
        '0069_prebook_opening_design_calls.sql',
        '0070_v7_opening_agent.sql',
        '0071_v7_opening_agent_governance.sql',
        '0072_v7_setting_editorial_department.sql',
        '0073_v7_book_title_design.sql',
        '0074_v7_book_cover_design.sql',
        '0075_v7_opening_prompt_and_platform.sql',
        '0076_v7_planning_trees.sql',
        '0077_v7_planning_editorial_runtime.sql',
        '0078_v7_planning_generation_request_hash.sql',
        '0079_v7_planning_maintenance_runs.sql',
        '0080_v7_planning_adjustment_decisions.sql',
        '0081_v7_planning_route_selection.sql',
        '0082_v7_character_memory.sql',
        '0083_v7_character_task_retries.sql',
        '0084_v7_creation_pipeline.sql',
        '0085_v7_planning_task_retries.sql',
        '0086_v7_creation_commercial_closure.sql',
        '0087_v7_creation_stage_jobs.sql',
        '0088_v7_managed_creation.sql',
        '0089_v7_unified_agent_governance.sql',
        '0090_v7_creation_option_member_preferences.sql',
        '0091_v7_prompt_context_governance.sql',
        '0092_v7_creation_fixed_role_preferences.sql',
        '0093_v7_context_source_scope.sql',
        '0094_v7_task_contract_skill_selection.sql',
        '0095_v7_prompt_manifest_execution_binding.sql',
        '0096_v7_outline_review.sql',
        '0097_v7_setting_author_revision_capacity.sql',
        '0098_v7_outline_draft_candidates.sql',
        '0099_v7_fast_default_manuscript_writer.sql',
        '0100_v7_fast_default_manuscript_reviewer.sql',
        '0101_unified_account_usage_projection.sql',
        '0102_v7_clean_cutover_guard.sql',
        '0103_membership_action_idempotency.sql',
        '0104_v7_opening_idea_capacity.sql',
        '0105_v7_planning_generation_retries.sql',
        '0106_v7_setting_failure_recovery.sql'
      ]);
      expect(second.applied).toEqual([]);
      expect(database.prepare(`SELECT name,"notnull" AS required,dflt_value AS defaultValue
        FROM pragma_table_info('v7_planning_recipe_runs') WHERE name='retry_count'`).get()).toEqual({
        name: 'retry_count', required: 1, defaultValue: '0'
      });
      expect(database.prepare(`SELECT name,"notnull" AS required,dflt_value AS defaultValue
        FROM pragma_table_info('v7_planning_generation_runs') WHERE name='retry_count'`).get()).toEqual({
        name: 'retry_count', required: 1, defaultValue: '0'
      });
      expect(database.prepare(`SELECT name FROM pragma_table_info('v7_setting_batches')
        WHERE name IN ('error_code','failure_stage','retry_safety') ORDER BY name`).all()).toEqual([
        { name: 'error_code' }, { name: 'failure_stage' }, { name: 'retry_safety' }
      ]);
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
        'storyline_frontier_versions', 'storyline_open_questions_v6', 'storyline_growth_rounds_v6',
        'storyline_growth_candidates_v6', 'storyline_growth_decisions_v6', 'creative_template_versions_v6',
        'storyline_settlement_projection_receipts_v6', 'prebook_opening_design_calls',
        'v7_opening_agent_tasks', 'v7_opening_agent_candidates', 'v7_opening_agent_model_calls',
        'v7_setting_batches', 'v7_setting_item_jobs', 'v7_setting_items', 'v7_setting_item_versions',
        'v7_setting_outputs', 'v7_setting_model_calls', 'v7_setting_member_events',
        'v7_book_title_design_calls', 'v7_book_cover_designs',
        'clean_cutover_operations', 'clean_cutover_delete_guard',
        'v7_planning_tree_heads', 'v7_planning_tree_versions', 'v7_planning_tree_actions', 'v7_planning_node_actuals',
        'v7_planning_source_snapshots', 'v7_planning_source_items', 'v7_planning_recipe_runs',
        'v7_planning_recipe_proposals', 'v7_planning_recipe_versions', 'v7_planning_recipe_decisions',
        'v7_planning_generation_runs', 'v7_planning_maintenance_runs', 'v7_planning_model_calls',
        'v7_planning_adjustment_suggestions', 'v7_planning_adjustment_decisions',
        'v7_character_profiles', 'v7_character_profile_versions', 'v7_character_profile_actions',
        'v7_character_context_packs', 'v7_character_maintenance_runs', 'v7_character_change_candidates',
        'v7_character_review_issues', 'v7_character_model_calls',
        'v7_creation_workflows', 'v7_creation_context_packs', 'v7_creation_options',
        'v7_creation_option_reviews', 'v7_creation_decisions', 'v7_chapter_outline_sequences',
        'v7_chapter_outline_draft_candidates',
        'v7_manuscript_versions', 'v7_manuscript_reviews', 'v7_chapter_settlements',
        'v7_story_state_items', 'v7_story_state_versions', 'v7_formalization_outbox',
        'v7_creation_model_calls', 'v7_creation_stage_jobs', 'v7_managed_creation_runs',
        'v7_creation_option_member_preferences', 'v7_creation_fixed_member_preferences',
        'v7_agent_governance_meta', 'v7_agent_governance_member_settings',
        'v7_agent_governance_task_policies', 'v7_agent_governance_events',
        'v7_prompt_governance_meta', 'v7_prompt_asset_versions', 'v7_book_genre_profiles',
        'v7_task_contracts', 'v7_context_pack_traces', 'v7_context_source_traces',
        'v7_prompt_manifests', 'v7_prompt_governance_events',
        'account_usage_supplemental_calls'
      ]));
      const batchColumns = database.prepare("PRAGMA table_info('ai_node_batches_v6')").all() as Array<{ name: string }>;
      expect(batchColumns.map((row) => row.name)).toEqual(expect.arrayContaining(['template_version_id', 'template_hash']));
      const openingTaskColumns = database.prepare("PRAGMA table_info('v7_opening_agent_tasks')").all() as Array<{ name: string }>;
      expect(openingTaskColumns.map((row) => row.name)).toContain('publishing_platform');
      const openingTaskSql = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='v7_opening_agent_tasks'").get() as { sql: string };
      expect(openingTaskSql.sql).toContain('length(idea_text) BETWEEN 4 AND 2000');
      const openingCallColumns = database.prepare("PRAGMA table_info('v7_opening_agent_model_calls')").all() as Array<{ name: string }>;
      expect(openingCallColumns.map((row) => row.name)).toEqual(expect.arrayContaining([
        'task_contract_json', 'context_pack_json', 'prompt_manifest_json'
      ]));
      const openingMemberColumns = database.prepare("PRAGMA table_info('v7_opening_agent_member_settings')").all() as Array<{ name: string }>;
      expect(openingMemberColumns.map((row) => row.name)).toContain('prompt_instruction');
      const settingJobSql = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='v7_setting_item_jobs'").get() as { sql: string };
      expect(settingJobSql.sql).toContain('length(author_note) <= 3200');
      const promptManifestColumns = database.prepare("PRAGMA table_info('v7_prompt_manifests')").all() as Array<{ name: string }>;
      expect(promptManifestColumns.map((row) => row.name)).toEqual(expect.arrayContaining([
        'provider', 'model_id', 'plan', 'max_output_tokens'
      ]));
      const outlineColumns = database.prepare("PRAGMA table_info('v7_chapter_outline_sequences')").all() as Array<{ name: string }>;
      expect(outlineColumns.map((row) => row.name)).toEqual(expect.arrayContaining([
        'review_json', 'review_member_key', 'review_member_snapshot_json', 'review_request_id', 'reviewed_at'
      ]));
      const characterPackColumns = database.prepare("PRAGMA table_info('v7_character_context_packs')").all() as Array<{ name: string }>;
      const characterMaintenanceColumns = database.prepare("PRAGMA table_info('v7_character_maintenance_runs')").all() as Array<{ name: string }>;
      const planningMaintenanceColumns = database.prepare("PRAGMA table_info('v7_planning_maintenance_runs')").all() as Array<{ name: string }>;
      expect(characterPackColumns.map((row) => row.name)).toContain('retry_count');
      expect(characterMaintenanceColumns.map((row) => row.name)).toContain('retry_count');
      expect(planningMaintenanceColumns.map((row) => row.name)).toContain('retry_count');
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

  it('0106只增加失败恢复结构，不根据旧文案批量改写历史任务', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const sourceDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(sourceDir).filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < '0106_')) {
      copyFileSync(resolve(sourceDir, file), resolve(migrationsDir, file));
    }
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      const now = '2026-08-31T00:00:00.000Z';
      database.prepare('INSERT INTO owners (owner_id,display_name,created_at,updated_at) VALUES (?,?,?,?)')
        .run('owner-setting-recovery', '设定恢复作者', now, now);
      database.prepare(`INSERT INTO user_accounts(
        user_id,owner_id,email_normalized,display_name,password_salt,password_hash,role,status,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,'user','active',?,?)`).run(
        'user-setting-recovery', 'owner-setting-recovery', 'setting-recovery@example.com', '设定恢复作者',
        'salt', 'hash', now, now
      );
      database.prepare("INSERT INTO books (book_id,owner_id,title,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
        .run('book-setting-recovery', 'owner-setting-recovery', '设定恢复测试书', now, now);
      const insertBatch = database.prepare(`INSERT INTO v7_setting_batches(
        batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,
        opening_version,opening_hash,roster_json,lease_token,lease_expires_at,error_message,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,1,?,'[]',NULL,NULL,?,?,?)`);
      insertBatch.run(
        'batch-membership-old', 'owner-setting-recovery', 'book-setting-recovery', 'setting-membership-old',
        'a'.repeat(64), 'partially_failed', '["world-stage","rules-costs"]', '[]', 'b'.repeat(64),
        '召集AI团队需使用算力，本期剩余算力值不足以继续这一步，请联系管理员微信595341366续费。', now, now
      );
      insertBatch.run(
        'batch-unrelated-old', 'owner-setting-recovery', 'book-setting-recovery', 'setting-unrelated-old',
        'c'.repeat(64), 'partially_failed', '["social-order"]', '[]', 'd'.repeat(64),
        '旧模型返回内容无法解析', now, now
      );
      insertBatch.run(
        'batch-redesign-orphan', 'owner-setting-recovery', 'book-setting-recovery', 'redesign-old-orphan',
        'e'.repeat(64), 'working', '["world-stage"]', '[]', 'f'.repeat(64), null, now, now
      );
      insertBatch.run(
        'batch-recommendation-live', 'owner-setting-recovery', 'book-setting-recovery', 'setting-recommendation-live',
        '1'.repeat(64), 'working', '[]', '{"taskKind":"catalog_recommendation"}', '2'.repeat(64), null, now, now
      );
      const insertJob = database.prepare(`INSERT INTO v7_setting_item_jobs(
        job_id,owner_id,book_id,batch_id,item_key,item_label,group_title,item_prompt,state,
        attempted_members_json,attempt_count,author_note,revision,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'[]',0,'',0,?,?)`);
      insertJob.run(
        'job-membership-old', 'owner-setting-recovery', 'book-setting-recovery', 'batch-membership-old',
        'world-stage', '世界舞台', '世界设定', '设计世界舞台', 'failed', now, now
      );
      insertJob.run(
        'job-membership-completed', 'owner-setting-recovery', 'book-setting-recovery', 'batch-membership-old',
        'rules-costs', '规则代价', '世界设定', '设计规则代价', 'needs_author', now, now
      );
      insertJob.run(
        'job-unrelated-old', 'owner-setting-recovery', 'book-setting-recovery', 'batch-unrelated-old',
        'social-order', '社会秩序', '世界设定', '设计社会秩序', 'failed', now, now
      );
      database.prepare(`INSERT INTO v7_setting_model_calls(
        request_id,owner_id,book_id,batch_id,item_key,node_key,member_key,provider,model_id,plan,state,
        prompt_hash,reserved_tokens,started_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'coding','working',?,8000,?,?)`).run(
        'call-redesign-orphan', 'owner-setting-recovery', 'book-setting-recovery', 'batch-redesign-orphan',
        'world-stage', 'redesign', 'planner-test', 'provider-test', 'model-test', '3'.repeat(64), now, now
      );

      copyFileSync(
        resolve(sourceDir, '0106_v7_setting_failure_recovery.sql'),
        resolve(migrationsDir, '0106_v7_setting_failure_recovery.sql')
      );
      expect(runMigrations(database, migrationsDir).applied).toEqual(['0106_v7_setting_failure_recovery.sql']);
      expect(database.prepare(`SELECT status,error_message,error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE batch_id='batch-membership-old'`).get()).toEqual({
        status: 'partially_failed',
        error_message: '召集AI团队需使用算力，本期剩余算力值不足以继续这一步，请联系管理员微信595341366续费。',
        error_code: null,
        failure_stage: null,
        retry_safety: null
      });
      expect(database.prepare(`SELECT item_key AS itemKey,state FROM v7_setting_item_jobs
        WHERE batch_id='batch-membership-old' ORDER BY item_key`).all()).toEqual([
        { itemKey: 'rules-costs', state: 'needs_author' },
        { itemKey: 'world-stage', state: 'failed' }
      ]);
      expect(database.prepare(`SELECT error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE batch_id='batch-unrelated-old'`).get()).toEqual({
        error_code: null, failure_stage: null, retry_safety: null
      });
      expect(database.prepare(`SELECT status,error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE batch_id='batch-redesign-orphan'`).get()).toEqual({
        status: 'working', error_code: null, failure_stage: null, retry_safety: null
      });
      expect(database.prepare(`SELECT state,completed_at AS completedAt FROM v7_setting_model_calls
        WHERE request_id='call-redesign-orphan'`).get()).toEqual({
        state: 'working', completedAt: null
      });
      expect(database.prepare(`SELECT status,error_code FROM v7_setting_batches
        WHERE batch_id='batch-recommendation-live'`).get()).toEqual({ status: 'working', error_code: null });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(runMigrations(database, migrationsDir).applied).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('0104在保留开书任务子记录和外键的前提下把原始想法容量升级到2000字', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const sourceDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(sourceDir).filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < '0104_')) {
      copyFileSync(resolve(sourceDir, file), resolve(migrationsDir, file));
    }
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      const now = '2026-08-31T00:00:00.000Z';
      database.prepare('INSERT INTO owners (owner_id,display_name,created_at,updated_at) VALUES (?,?,?,?)')
        .run('owner-opening-capacity', '开书容量作者', now, now);
      database.prepare(`INSERT INTO user_accounts(
        user_id,owner_id,email_normalized,display_name,password_salt,password_hash,role,status,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,'user','active',?,?)`).run(
        'user-opening-capacity', 'owner-opening-capacity', 'opening-capacity@example.com', '开书容量作者',
        'salt', 'hash', now, now
      );
      database.prepare(`INSERT INTO v7_opening_agent_tasks(
        task_id,owner_id,idempotency_key,request_hash,idea_text,idea_version,idea_hash,
        selected_chief_member_key,selected_screenwriter_member_key,status,phase,state_json,
        created_at,updated_at,member_roster_json,publishing_platform
      ) VALUES (?,?,?,?,?,1,?,NULL,NULL,'awaiting_author_confirmation','complete','{}',?,?,'[]','qidian')`).run(
        'opening-capacity-existing', 'owner-opening-capacity', 'opening-capacity-existing',
        'a'.repeat(64), '旧任务想法', 'b'.repeat(64), now, now
      );
      database.prepare(`INSERT INTO v7_opening_agent_candidates(
        candidate_id,owner_id,task_id,kind,version,content_json,created_by_member_key,
        model_request_id,source_candidate_ids_json,created_at
      ) VALUES (?,?,?,'opening_package',1,'{}','author',?,'[]',?)`).run(
        'opening-capacity-candidate', 'owner-opening-capacity', 'opening-capacity-existing',
        'opening-capacity-candidate-request', now
      );
      database.prepare(`INSERT INTO v7_opening_agent_model_calls(
        request_id,owner_id,task_id,node_key,member_key,provider,model_id,plan,state,prompt_hash,
        reserved_tokens,input_tokens,output_tokens,cash_micros,output_text,started_at,completed_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,'coding','succeeded',?,100,10,20,0,'{}',?,?,?,?)`).run(
        'opening-capacity-call', 'owner-opening-capacity', 'opening-capacity-existing', 'package_design',
        'planner-test', 'provider-test', 'model-test', 'c'.repeat(64), now, now, now, now
      );

      copyFileSync(
        resolve(sourceDir, '0104_v7_opening_idea_capacity.sql'),
        resolve(migrationsDir, '0104_v7_opening_idea_capacity.sql')
      );
      expect(runMigrations(database, migrationsDir).applied).toEqual(['0104_v7_opening_idea_capacity.sql']);
      expect(database.prepare(`SELECT idea_text,member_roster_json,publishing_platform FROM v7_opening_agent_tasks
        WHERE task_id='opening-capacity-existing'`).get()).toEqual({
        idea_text: '旧任务想法', member_roster_json: '[]', publishing_platform: 'qidian'
      });
      expect(database.prepare("SELECT task_id FROM v7_opening_agent_candidates WHERE candidate_id='opening-capacity-candidate'").get())
        .toEqual({ task_id: 'opening-capacity-existing' });
      expect(database.prepare("SELECT task_id FROM v7_opening_agent_model_calls WHERE request_id='opening-capacity-call'").get())
        .toEqual({ task_id: 'opening-capacity-existing' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });

      const insertTask = database.prepare(`INSERT INTO v7_opening_agent_tasks(
        task_id,owner_id,idempotency_key,request_hash,idea_text,idea_version,idea_hash,
        status,phase,created_at,updated_at,publishing_platform
      ) VALUES (?,?,?,?,?,1,?,'queued','package_design',?,?,'fanqie')`);
      insertTask.run(
        'opening-capacity-2000', 'owner-opening-capacity', 'opening-capacity-limit-2000',
        'd'.repeat(64), '张'.repeat(2_000), 'e'.repeat(64), now, now
      );
      expect(() => insertTask.run(
        'opening-capacity-2001', 'owner-opening-capacity', 'opening-capacity-limit-2001',
        'f'.repeat(64), '张'.repeat(2_001), '0'.repeat(64), now, now
      )).toThrow();
      expect(runMigrations(database, migrationsDir).applied).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('0092把旧章纲偏好兼容投影到固定策划岗位且保留历史记录', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const sourceDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(sourceDir).filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < '0092_')) {
      copyFileSync(resolve(sourceDir, file), resolve(migrationsDir, file));
    }
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      const now = '2026-08-28T00:00:00.000Z';
      database.prepare('INSERT INTO owners (owner_id,display_name,created_at,updated_at) VALUES (?,?,?,?)')
        .run('owner-role-compat', '岗位兼容作者', now, now);
      database.prepare("INSERT INTO books (book_id,owner_id,title,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
        .run('book-role-compat', 'owner-role-compat', '岗位兼容测试书', now, now);
      database.prepare(`INSERT INTO v7_creation_workflows(
        workflow_id,owner_id,book_id,volume_scope_id,chain_scope_id,stage,status,first_volume,author_goal,
        idempotency_key,request_hash,checkpoint_json,error_message,created_at,updated_at
      ) VALUES (?,?,?,?,NULL,'context_selection','queued',1,NULL,?,?, '{}',NULL,?,?)`).run(
        'workflow-role-compat', 'owner-role-compat', 'book-role-compat', 'volume-1',
        'role-compat-idempotency', 'a'.repeat(64), now, now
      );
      const insertLegacy = database.prepare(`INSERT INTO v7_creation_member_preferences(
        owner_id,book_id,workflow_id,role_key,member_key,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?)`);
      insertLegacy.run(
        'owner-role-compat', 'book-role-compat', 'workflow-role-compat',
        'outline_writer', 'creation-outline-glm-5-3', now, now
      );
      insertLegacy.run(
        'owner-role-compat', 'book-role-compat', 'workflow-role-compat',
        'structure_writer', 'planner-deepseek-v4-pro', now, now
      );

      copyFileSync(
        resolve(sourceDir, '0092_v7_creation_fixed_role_preferences.sql'),
        resolve(migrationsDir, '0092_v7_creation_fixed_role_preferences.sql')
      );
      expect(runMigrations(database, migrationsDir).applied).toEqual(['0092_v7_creation_fixed_role_preferences.sql']);
      expect(database.prepare(`SELECT role_key,member_key FROM v7_creation_fixed_member_preferences
        WHERE owner_id=? AND book_id=? AND workflow_id=?`).all(
        'owner-role-compat', 'book-role-compat', 'workflow-role-compat'
      )).toEqual([{ role_key: 'planning_writer', member_key: 'creation-outline-glm-5-3' }]);
      expect(database.prepare(`SELECT option_seat_key,member_key FROM v7_creation_option_member_preferences
        WHERE owner_id=? AND book_id=? AND workflow_id=?`).all(
        'owner-role-compat', 'book-role-compat', 'workflow-role-compat'
      )).toEqual([{ option_seat_key: 'option_1', member_key: 'planner-deepseek-v4-pro' }]);
      expect(database.prepare(`SELECT role_key,member_key FROM v7_creation_member_preferences
        WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY role_key`).all(
        'owner-role-compat', 'book-role-compat', 'workflow-role-compat'
      )).toEqual([
        { role_key: 'outline_writer', member_key: 'creation-outline-glm-5-3' },
        { role_key: 'structure_writer', member_key: 'planner-deepseek-v4-pro' }
      ]);
    } finally {
      database.close();
    }
  });

  it('0093为0091历史资料来源回填书籍范围后重新冻结，不破坏既有快照', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const sourceDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(sourceDir).filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < '0093_')) {
      copyFileSync(resolve(sourceDir, file), resolve(migrationsDir, file));
    }
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      const now = '2026-08-28T00:00:00.000Z';
      database.prepare('INSERT INTO owners (owner_id,display_name,created_at,updated_at) VALUES (?,?,?,?)')
        .run('owner-context-upgrade', '资料包升级作者', now, now);
      database.prepare("INSERT INTO books (book_id,owner_id,title,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
        .run('book-context-upgrade', 'owner-context-upgrade', '资料包升级测试书', now, now);
      database.prepare(`INSERT INTO v7_context_pack_traces(
        context_pack_id,owner_id,book_id,task_id,policy_version,token_budget,estimated_tokens,
        content_json,content_hash,lifecycle_status,created_at
      ) VALUES (?,?,?,?,?,1000,10,'{}',?,'active',?)`).run(
        'context-upgrade-1', 'owner-context-upgrade', 'book-context-upgrade', 'task-context-upgrade',
        'test-v1', createHash('sha256').update('{}').digest('hex'), now
      );
      database.prepare(`INSERT INTO v7_context_source_traces(
        trace_id,context_pack_id,sequence,source_key,source_type,source_id,source_version,authority,
        decision,reason,content_hash,estimated_tokens
      ) VALUES (?,?,0,'opening','book_profile','opening-1','1','confirmed','included','正式开书资料',?,10)`).run(
        'trace-upgrade-1', 'context-upgrade-1', 'b'.repeat(64)
      );

      copyFileSync(resolve(sourceDir, '0093_v7_context_source_scope.sql'), resolve(migrationsDir, '0093_v7_context_source_scope.sql'));
      expect(runMigrations(database, migrationsDir).applied).toEqual(['0093_v7_context_source_scope.sql']);
      expect(database.prepare(`SELECT owner_id,book_id,source_key FROM v7_context_source_traces WHERE trace_id=?`)
        .get('trace-upgrade-1')).toEqual({ owner_id: 'owner-context-upgrade', book_id: 'book-context-upgrade', source_key: 'opening' });
      expect(() => database.prepare(`UPDATE v7_context_source_traces SET reason='改写' WHERE trace_id=?`).run('trace-upgrade-1'))
        .toThrow('immutable');
      expect(() => database.prepare(`INSERT INTO v7_context_source_traces(
        trace_id,context_pack_id,owner_id,book_id,sequence,source_key,source_type,source_id,source_version,
        authority,decision,reason,content_hash,estimated_tokens
      ) VALUES (?,?,?,?,1,'bad','book_profile','bad','1','confirmed','included','错书',?,1)`).run(
        'trace-upgrade-bad', 'context-upgrade-1', 'other-owner', 'other-book', 'c'.repeat(64)
      )).toThrow('scope mismatch');
    } finally {
      database.close();
    }
  });

  it('0094为历史任务合同补入空Skill选择并重新冻结快照', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const sourceDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(sourceDir).filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < '0094_')) {
      copyFileSync(resolve(sourceDir, file), resolve(migrationsDir, file));
    }
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      const now = '2026-08-28T00:00:00.000Z';
      database.prepare('INSERT INTO owners (owner_id,display_name,created_at,updated_at) VALUES (?,?,?,?)')
        .run('owner-skill-upgrade', '合同升级作者', now, now);
      database.prepare("INSERT INTO books (book_id,owner_id,title,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
        .run('book-skill-upgrade', 'owner-skill-upgrade', '合同升级测试书', now, now);
      database.prepare(`INSERT INTO v7_task_contracts(
        contract_id,version,owner_id,book_id,task_id,task_kind,workstation_key,operation_mode,objective,
        must_preserve_json,allowed_changes_json,forbidden_changes_json,success_criteria_json,output_contract_json,
        author_instruction_version,based_on_task_id,lifecycle_status,content_hash,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'[]','[]','[]','[]','{}',NULL,NULL,'active',?,?)`).run(
        'contract-skill-upgrade', 1, 'owner-skill-upgrade', 'book-skill-upgrade', 'task-skill-upgrade',
        'opening_design', 'opening', 'fresh', '测试历史任务合同', 'd'.repeat(64), now
      );

      copyFileSync(resolve(sourceDir, '0094_v7_task_contract_skill_selection.sql'), resolve(migrationsDir, '0094_v7_task_contract_skill_selection.sql'));
      expect(runMigrations(database, migrationsDir).applied).toEqual(['0094_v7_task_contract_skill_selection.sql']);
      expect(database.prepare(`SELECT selected_skill_keys_json FROM v7_task_contracts WHERE contract_id=?`)
        .get('contract-skill-upgrade')).toEqual({ selected_skill_keys_json: '[]' });
      expect(() => database.prepare(`UPDATE v7_task_contracts SET selected_skill_keys_json='["data-boundary"]' WHERE contract_id=?`)
        .run('contract-skill-upgrade')).toThrow('immutable');
    } finally {
      database.close();
    }
  });

  it('0095为历史PromptManifest补入具体模型绑定并冻结重试依据', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const sourceDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(sourceDir).filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < '0095_')) {
      copyFileSync(resolve(sourceDir, file), resolve(migrationsDir, file));
    }
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      const now = '2026-08-28T00:00:00.000Z';
      database.exec('PRAGMA foreign_keys=OFF');
      database.prepare(`INSERT INTO v7_prompt_manifests(
        manifest_id,owner_id,book_id,task_id,member_key,role_key,workstation_key,task_kind,operation_mode,
        role_prompt_version_id,workstation_prompt_version_id,genre_profile_id,genre_profile_version,
        skill_version_ids_json,task_contract_id,task_contract_version,context_pack_id,context_pack_hash,
        model_profile_key,governance_revision,temperature,allowed_tools_json,compiled_blocks_json,
        compiled_prompt,compiled_prompt_hash,lifecycle_status,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`).run(
        'manifest-binding-upgrade', 'owner-binding-upgrade', 'book-binding-upgrade', 'task-binding-upgrade',
        'planner-kimi-k3', 'chief-editor', 'planning-tree', 'planning_tree', 'fresh',
        'role-binding-upgrade', 'workstation-binding-upgrade', null, null,
        '[]', 'contract-binding-upgrade', 1, 'context-binding-upgrade', 'a'.repeat(64),
        'kimi-k3', 1, 0.42, '[]', '{}', 'legacy compiled prompt', 'b'.repeat(64), now
      );

      copyFileSync(resolve(sourceDir, '0095_v7_prompt_manifest_execution_binding.sql'), resolve(migrationsDir, '0095_v7_prompt_manifest_execution_binding.sql'));
      expect(runMigrations(database, migrationsDir).applied).toEqual(['0095_v7_prompt_manifest_execution_binding.sql']);
      expect(database.prepare(`SELECT provider,model_id,plan,max_output_tokens FROM v7_prompt_manifests WHERE manifest_id=?`)
        .get('manifest-binding-upgrade')).toEqual({
        provider: 'volcengine-ark-agent-plan',
        model_id: 'kimi-k3',
        plan: 'agent',
        max_output_tokens: 12000
      });
      expect(() => database.prepare(`UPDATE v7_prompt_manifests SET max_output_tokens=6000 WHERE manifest_id=?`)
        .run('manifest-binding-upgrade')).toThrow('immutable');
      expect(runMigrations(database, migrationsDir).applied).toEqual([]);
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

  it('需要临时关闭外键的迁移若产生断链会完整回滚并恢复外键门禁', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    writeFileSync(resolve(migrationsDir, '0001_parent_child.sql'), `
      CREATE TABLE parents(id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE children(id TEXT PRIMARY KEY,parent_id TEXT NOT NULL REFERENCES parents(id)) STRICT;
      INSERT INTO parents(id) VALUES ('parent-kept');
      INSERT INTO children(id,parent_id) VALUES ('child-kept','parent-kept');
    `, 'utf8');
    writeFileSync(resolve(migrationsDir, '0002_broken_parent_rebuild.sql'), `-- wenmi-migration: foreign-keys-off
      CREATE TABLE parents_next(id TEXT PRIMARY KEY) STRICT;
      INSERT INTO parents_next(id) VALUES ('different-parent');
      DROP TABLE parents;
      ALTER TABLE parents_next RENAME TO parents;
    `, 'utf8');
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      expect(() => runMigrations(database, migrationsDir)).toThrow('迁移 0002_broken_parent_rebuild.sql 失败');
      expect(database.prepare('SELECT * FROM parents').all()).toEqual([{ id: 'parent-kept' }]);
      expect(database.prepare('SELECT * FROM children').all()).toEqual([{ id: 'child-kept', parent_id: 'parent-kept' }]);
      expect(database.prepare('SELECT name FROM schema_migrations ORDER BY name').all()).toEqual([
        expect.objectContaining({ name: '0001_parent_child.sql' })
      ]);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
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
