import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('Schema 9升级到当前表达、知识、对象协作与设定工作区', () => {
  it('只向前追加当前迁移，保留旧书并可重复执行', () => {
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
      expect(upgraded.applied.at(-1)).toBe('0102_v7_clean_cutover_guard.sql');
      expect(upgraded.applied.slice(-21)).toEqual([
        '0082_v7_character_memory.sql', '0083_v7_character_task_retries.sql',
        '0084_v7_creation_pipeline.sql', '0085_v7_planning_task_retries.sql',
        '0086_v7_creation_commercial_closure.sql', '0087_v7_creation_stage_jobs.sql',
        '0088_v7_managed_creation.sql', '0089_v7_unified_agent_governance.sql',
        '0090_v7_creation_option_member_preferences.sql', '0091_v7_prompt_context_governance.sql',
        '0092_v7_creation_fixed_role_preferences.sql', '0093_v7_context_source_scope.sql',
        '0094_v7_task_contract_skill_selection.sql',
        '0095_v7_prompt_manifest_execution_binding.sql',
        '0096_v7_outline_review.sql', '0097_v7_setting_author_revision_capacity.sql',
        '0098_v7_outline_draft_candidates.sql', '0099_v7_fast_default_manuscript_writer.sql',
        '0100_v7_fast_default_manuscript_reviewer.sql',
        '0101_unified_account_usage_projection.sql', '0102_v7_clean_cutover_guard.sql'
      ]);
      expect(upgraded.applied.slice(0, -21)).toEqual(['0010_expression_taxonomy.sql', '0011_knowledge_lifecycle_time.sql', '0012_chunk_projection_snapshots.sql', '0013_retrieval_orchestration.sql', '0014_longform_continuity.sql', '0015_agent_compression_prompts.sql', '0016_production_workflow.sql', '0017_experience_freeze.sql', '0018_portability_operations.sql', '0019_chat_attachments.sql', '0020_runtime_integrity.sql', '0021_canon_index_requests.sql', '0022_editor_review_syntheses.sql', '0023_manuscript_protagonist_workspace.sql', '0024_settled_chapter_generation_status.sql', '0025_opening_blueprints.sql', '0026_creative_sessions_and_context_policy.sql', '0027_attribute_formula_categories.sql', '0028_agent_prompt_preferences.sql', '0029_setting_outline_workspace.sql', '0030_planning_stage_and_style.sql', '0031_book_purge_retrieval_index.sql', '0032_setting_outline_decision_content.sql', '0033_retire_volume_outline.sql', '0034_existing_manuscript_continuation.sql', '0035_continuation_analysis.sql', '0036_author_planning_inputs.sql', '0037_author_input_link_order.sql', '0038_volume_planning.sql', '0039_story_event_planning.sql', '0040_event_chapter_outlines.sql', '0041_planning_settlement_assessments.sql', '0042_author_attachments.sql', '0043_user_accounts.sql', '0044_first_admin_legacy_owner.sql', '0045_user_memberships.sql', '0046_model_call_error_detail.sql', '0047_opening_drafts.sql', '0048_book_branding_designs.sql', '0049_review_challenger_seat.sql', '0050_settlement_follow_ups.sql', '0051_setting_item_versions.sql', '0052_setting_discussion_fragments.sql', '0053_setting_pending_candidate.sql', '0054_setting_quality_reports.sql', '0055_chapter_challenger_reviews.sql', '0056_platform_model_scheme.sql', '0057_membership_tiers.sql', '0058_layered_volume_and_event_chain.sql', '0059_layered_constraints_and_context.sql', '0060_first_volume_launch_progress.sql', '0061_story_thread_keys.sql', '0062_setting_gap_status.sql', '0063_independent_admin_console.sql', '0064_setting_member_resilience.sql', '0065_v6_core_workflow.sql', '0066_ai_editorial_node_batches.sql', '0067_chapter_editor_synthesis_requests.sql', '0068_rolling_storyline_growth.sql', '0069_prebook_opening_design_calls.sql', '0070_v7_opening_agent.sql', '0071_v7_opening_agent_governance.sql', '0072_v7_setting_editorial_department.sql', '0073_v7_book_title_design.sql', '0074_v7_book_cover_design.sql', '0075_v7_opening_prompt_and_platform.sql', '0076_v7_planning_trees.sql', '0077_v7_planning_editorial_runtime.sql', '0078_v7_planning_generation_request_hash.sql', '0079_v7_planning_maintenance_runs.sql', '0080_v7_planning_adjustment_decisions.sql', '0081_v7_planning_route_selection.sql']);
      expect(database.prepare(`SELECT title, canon_revision FROM books WHERE book_id = 'book-1'`).get()).toEqual({ title: '旧书', canon_revision: 0 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('knowledge_revisions')`).get()).toEqual({ count: expect.any(Number) });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('book_opening_blueprints')`).get()).toEqual({ count: 12 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('positioning_drafts') WHERE name = 'opening_blueprint_json'`).get()).toEqual({ count: 1 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM creative_sessions`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM setting_outline_workspace`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM continuation_imports`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM author_planning_inputs`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM volume_plans`).get()).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT planning_version, stage FROM creation_workflow_states
        WHERE owner_id = 'owner-1' AND book_id = 'book-1'
      `).get()).toEqual({ planning_version: 1, stage: 'book_profile_draft' });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('setting_outline_workspace') WHERE name = 'content_text'`).get()).toEqual({ count: 1 });
      expect(runMigrations(database, source).applied).toEqual([]);
    } finally {
      database.close();
    }
  });
});
