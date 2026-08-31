import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('首位管理员接管账号体系启用前的本机数据', () => {
  it('44版迁移只重绑唯一空管理员并完整保留旧书与会话', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmi-admin-adoption-'));
    temporaryDirectories.push(root);
    const stagedMigrations = resolve(root, 'migrations-through-0043');
    mkdirSync(stagedMigrations);
    const migrations = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql') && name < '0044_first_admin_legacy_owner.sql')) {
      copyFileSync(resolve(migrations, file), resolve(stagedMigrations, file));
    }

    const database = openDatabase(resolve(root, 'wenmi.sqlite'));
    try {
      runMigrations(database, stagedMigrations);
      const now = '2026-08-11T00:00:00.000Z';
      database.prepare(`
        INSERT INTO owners (owner_id, display_name, version, created_at, updated_at)
        VALUES ('owner-local-boss', '老板', 1, ?, ?),
               ('empty-admin-owner', '管理员', 1, ?, ?)
      `).run(now, now, now, now);
      database.prepare(`
        INSERT INTO books (
          book_id, owner_id, title, status, version, positioning_version,
          canon_revision, editor_epoch, created_at, updated_at
        ) VALUES ('legacy-book', 'owner-local-boss', '原本机书籍', 'active', 1, 0, 0, 0, ?, ?)
      `).run(now, now);
      database.prepare(`
        INSERT INTO user_accounts (
          user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
          role, status, created_at, updated_at, last_login_at
        ) VALUES ('admin-user', 'empty-admin-owner', 'boss@example.com', '管理员',
          'salt', 'hash', 'admin', 'active', ?, ?, ?)
      `).run(now, now, now);
      database.prepare(`
        INSERT INTO auth_sessions (
          session_id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at
        ) VALUES ('session-1', 'admin-user', ?, ?, '2026-08-25T00:00:00.000Z', ?, NULL)
      `).run('a'.repeat(64), now, now);

      const bookBefore = database.prepare('SELECT * FROM books WHERE book_id = ?').get('legacy-book');
      const upgraded = runMigrations(database, migrations);
      expect(upgraded.applied.at(-1)).toBe('0105_v7_planning_generation_retries.sql');
      expect(upgraded.applied.slice(-24)).toEqual([
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
        '0101_unified_account_usage_projection.sql', '0102_v7_clean_cutover_guard.sql',
        '0103_membership_action_idempotency.sql', '0104_v7_opening_idea_capacity.sql',
        '0105_v7_planning_generation_retries.sql'
      ]);

      expect(upgraded.applied.slice(0, -24)).toEqual(['0044_first_admin_legacy_owner.sql', '0045_user_memberships.sql', '0046_model_call_error_detail.sql', '0047_opening_drafts.sql', '0048_book_branding_designs.sql', '0049_review_challenger_seat.sql', '0050_settlement_follow_ups.sql', '0051_setting_item_versions.sql', '0052_setting_discussion_fragments.sql', '0053_setting_pending_candidate.sql', '0054_setting_quality_reports.sql', '0055_chapter_challenger_reviews.sql', '0056_platform_model_scheme.sql', '0057_membership_tiers.sql', '0058_layered_volume_and_event_chain.sql', '0059_layered_constraints_and_context.sql', '0060_first_volume_launch_progress.sql', '0061_story_thread_keys.sql', '0062_setting_gap_status.sql', '0063_independent_admin_console.sql', '0064_setting_member_resilience.sql', '0065_v6_core_workflow.sql', '0066_ai_editorial_node_batches.sql', '0067_chapter_editor_synthesis_requests.sql', '0068_rolling_storyline_growth.sql', '0069_prebook_opening_design_calls.sql', '0070_v7_opening_agent.sql', '0071_v7_opening_agent_governance.sql', '0072_v7_setting_editorial_department.sql', '0073_v7_book_title_design.sql', '0074_v7_book_cover_design.sql', '0075_v7_opening_prompt_and_platform.sql', '0076_v7_planning_trees.sql', '0077_v7_planning_editorial_runtime.sql', '0078_v7_planning_generation_request_hash.sql', '0079_v7_planning_maintenance_runs.sql', '0080_v7_planning_adjustment_decisions.sql', '0081_v7_planning_route_selection.sql']);
      expect(database.prepare('SELECT owner_id FROM user_accounts WHERE user_id = ?').get('admin-user'))
        .toEqual({ owner_id: 'owner-local-boss' });
      expect(database.prepare('SELECT * FROM books WHERE book_id = ?').get('legacy-book')).toEqual(bookBefore);
      expect(database.prepare('SELECT user_id, revoked_at FROM auth_sessions WHERE session_id = ?').get('session-1'))
        .toEqual({ user_id: 'admin-user', revoked_at: null });
      expect(database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(runMigrations(database, migrations).applied).toEqual([]);
    } finally {
      database.close();
    }
  });
});
