import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface LegacyPositioningSnapshot {
  fields: Array<{ key: string; value: unknown; sourceStatus?: string }>;
  createdAt: string | null;
}

export class LegacyBookUpgradeRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public listBooks(): BookScope[] {
    return (this.database.prepare(`
      SELECT owner_id, book_id FROM books WHERE status <> 'purged' ORDER BY owner_id, book_id
    `).all() as unknown as Array<{ owner_id: string; book_id: string }>).map((row) => ({
      ownerId: row.owner_id,
      bookId: row.book_id
    }));
  }

  public currentTeamCount(scope: BookScope): number {
    assertBookScope(scope);
    return (this.database.prepare(`
      SELECT COUNT(*) AS count FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND role_template_version = 2 AND enabled = 1
    `).get(scope.ownerId, scope.bookId) as { count: number }).count;
  }

  public legacyEnabledCount(scope: BookScope): number {
    assertBookScope(scope);
    return (this.database.prepare(`
      SELECT COUNT(*) AS count FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND role_template_version = 1 AND enabled = 1
    `).get(scope.ownerId, scope.bookId) as { count: number }).count;
  }

  public hasNonterminalTasks(scope: BookScope): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT 1 FROM tasks WHERE owner_id = ? AND book_id = ?
        AND status IN ('pending', 'queued', 'working', 'waiting_confirmation', 'paused', 'blocked', 'interrupted')
      LIMIT 1
    `).get(scope.ownerId, scope.bookId) !== undefined;
  }

  public currentRoleAgentId(scope: BookScope, roleKey: 'chief_editor' | 'lead_writer'): string {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT a.agent_id FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.role_template_version = 2 AND a.enabled = 1 AND r.role_key = ?
    `).get(scope.ownerId, scope.bookId, roleKey) as { agent_id: string } | undefined;
    if (row === undefined) throw new Error(`书籍${scope.bookId}缺少当前岗位：${roleKey}`);
    return row.agent_id;
  }

  public legacyPositioning(scope: BookScope): LegacyPositioningSnapshot {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT fields_json, created_at FROM positioning_versions
      WHERE owner_id = ? AND book_id = ? ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { fields_json: string; created_at: string } | undefined;
    if (row === undefined) return { fields: [], createdAt: null };
    return {
      fields: JSON.parse(row.fields_json) as LegacyPositioningSnapshot['fields'],
      createdAt: row.created_at
    };
  }

  public hasOnboardingProfile(scope: BookScope): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM book_onboarding_profiles WHERE owner_id = ? AND book_id = ? LIMIT 1`)
      .get(scope.ownerId, scope.bookId) !== undefined;
  }

  public insertOnboardingProfile(scope: BookScope, input: {
    id: string; genre: string | null; classification: string | null; targetAudience: string | null;
    expectedScaleChars: number | null; expressionBaseline: string | null; fieldSourcesJson: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO book_onboarding_profiles (
        onboarding_profile_id, owner_id, book_id, version, genre, classification,
        target_audience, expected_scale_chars, initial_expression_baseline,
        field_sources_json, status, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'provisional', ?)
    `).run(input.id, scope.ownerId, scope.bookId, input.genre, input.classification, input.targetAudience,
      input.expectedScaleChars, input.expressionBaseline, input.fieldSourcesJson, input.now);
  }

  public hasExpressionProfile(scope: BookScope): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM book_expression_profiles WHERE owner_id = ? AND book_id = ? LIMIT 1`)
      .get(scope.ownerId, scope.bookId) !== undefined;
  }

  public insertExpressionProfile(scope: BookScope, input: {
    id: string; targetAudience: string | null; languageToneJson: string; voiceEvidenceJson: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO book_expression_profiles (
        expression_profile_id, owner_id, book_id, version, narrative_person,
        viewpoint_distance, language_tone_json, text_density, target_audience,
        content_boundaries_json, humor_seriousness, voice_evidence_json,
        impact_scope_json, status, created_at
      ) VALUES (?, ?, ?, 1, NULL, NULL, ?, 'adaptive', ?, '{}', 'adaptive', ?, ?, 'provisional', ?)
    `).run(input.id, scope.ownerId, scope.bookId, input.languageToneJson, input.targetAudience,
      input.voiceEvidenceJson, JSON.stringify({
        appliesFrom: 'next_formal_work_order',
        migratedFrom: 'legacy-positioning-v1',
        narrativeViewpointRequiresConfirmation: true
      }), input.now);
  }

  public finalizeTeamUpgrade(scope: BookScope, input: {
    chiefEditorAgentId: string; leadWriterAgentId: string; now: string; leaseExpiresAt: string;
  }): number {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO editor_leases (
        owner_id, book_id, active_editor_agent_id, candidate_editor_agent_id,
        editor_epoch, lease_expires_at, takeover_state, takeover_id, updated_at
      ) VALUES (?, ?, ?, NULL, 1, ?, 'stable', NULL, ?)
      ON CONFLICT(owner_id, book_id) DO UPDATE SET
        active_editor_agent_id = excluded.active_editor_agent_id,
        candidate_editor_agent_id = NULL,
        editor_epoch = editor_leases.editor_epoch + 1,
        lease_expires_at = excluded.lease_expires_at,
        takeover_state = 'stable', takeover_id = NULL, updated_at = excluded.updated_at
    `).run(scope.ownerId, scope.bookId, input.chiefEditorAgentId, input.leaseExpiresAt, input.now);
    this.database.prepare(`
      UPDATE books SET active_editor_agent_id = ?,
        editor_epoch = (SELECT editor_epoch FROM editor_leases WHERE owner_id = ? AND book_id = ?),
        version = version + 1, updated_at = ?
      WHERE owner_id = ? AND book_id = ?
    `).run(input.chiefEditorAgentId, scope.ownerId, scope.bookId, input.now, scope.ownerId, scope.bookId);
    this.database.prepare(`
      UPDATE writer_leases SET active_writer_agent_id = ?, writer_epoch = writer_epoch + 1,
        lease_expires_at = ?, takeover_state = 'stable', updated_at = ?
      WHERE owner_id = ? AND book_id = ?
    `).run(input.leadWriterAgentId, input.leaseExpiresAt, input.now, scope.ownerId, scope.bookId);
    this.database.prepare(`
      UPDATE writer_selections SET status = 'superseded'
      WHERE owner_id = ? AND book_id = ? AND status = 'selected'
    `).run(scope.ownerId, scope.bookId);
    this.database.prepare(`
      UPDATE takeover_packages SET status = 'cancelled'
      WHERE owner_id = ? AND book_id = ? AND status IN ('preparing', 'ready')
    `).run(scope.ownerId, scope.bookId);
    return Number(this.database.prepare(`
      UPDATE agent_instances SET enabled = 0, activation_state = 'disabled', updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND role_template_version = 1 AND enabled = 1
    `).run(input.now, scope.ownerId, scope.bookId).changes);
  }
}
