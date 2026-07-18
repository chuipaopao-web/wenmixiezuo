import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface ExpressionProfileRecord {
  expressionProfileId: string;
  version: number;
  narrativePerson: 'first' | 'third' | 'mixed' | null;
  viewpointDistance: 'close' | 'medium' | 'distant' | 'adaptive' | null;
  languageTone: unknown;
  textDensity: 'light' | 'balanced' | 'dense' | 'adaptive' | null;
  targetAudience: string | null;
  contentBoundaries: unknown;
  humorSeriousness: 'humorous' | 'balanced' | 'serious' | 'adaptive' | null;
  voiceEvidence: unknown;
  impactScope: unknown;
  status: 'provisional' | 'confirmed' | 'superseded' | 'archived';
}

interface ExpressionRow {
  expression_profile_id: string; version: number; narrative_person: ExpressionProfileRecord['narrativePerson'];
  viewpoint_distance: ExpressionProfileRecord['viewpointDistance']; language_tone_json: string;
  text_density: ExpressionProfileRecord['textDensity']; target_audience: string | null;
  content_boundaries_json: string; humor_seriousness: ExpressionProfileRecord['humorSeriousness'];
  voice_evidence_json: string; impact_scope_json: string; status: ExpressionProfileRecord['status'];
}

export class ExpressionProfileRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public active(scope: BookScope): ExpressionProfileRecord | null {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT * FROM book_expression_profiles
      WHERE owner_id = ? AND book_id = ? AND status IN ('provisional', 'confirmed')
      ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as ExpressionRow | undefined;
    return row === undefined ? null : mapExpression(row);
  }

  public nextVersion(scope: BookScope): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) AS version FROM book_expression_profiles
      WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { version: number };
    return row.version + 1;
  }

  public supersedeActive(scope: BookScope, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE book_expression_profiles SET status = 'superseded'
      WHERE owner_id = ? AND book_id = ? AND status IN ('provisional', 'confirmed')
    `).run(scope.ownerId, scope.bookId);
    void now;
  }

  public create(scope: BookScope, input: {
    profileId: string; version: number; narrativePerson?: string | null; viewpointDistance?: string | null;
    languageToneJson: string; textDensity?: string | null; targetAudience?: string | null;
    contentBoundariesJson: string; humorSeriousness?: string | null; voiceEvidenceJson: string;
    impactScopeJson: string; status: 'provisional' | 'confirmed'; now: string;
  }): ExpressionProfileRecord {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO book_expression_profiles (
        expression_profile_id, owner_id, book_id, version, narrative_person,
        viewpoint_distance, language_tone_json, text_density, target_audience,
        content_boundaries_json, humor_seriousness, voice_evidence_json,
        impact_scope_json, status, created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.profileId, scope.ownerId, scope.bookId, input.version,
      input.narrativePerson ?? null, input.viewpointDistance ?? null, input.languageToneJson,
      input.textDensity ?? null, input.targetAudience ?? null, input.contentBoundariesJson,
      input.humorSeriousness ?? null, input.voiceEvidenceJson, input.impactScopeJson,
      input.status, input.now, input.status === 'confirmed' ? input.now : null
    );
    return this.active(scope)!;
  }
}

function mapExpression(row: ExpressionRow): ExpressionProfileRecord {
  return {
    expressionProfileId: row.expression_profile_id,
    version: row.version,
    narrativePerson: row.narrative_person,
    viewpointDistance: row.viewpoint_distance,
    languageTone: JSON.parse(row.language_tone_json) as unknown,
    textDensity: row.text_density,
    targetAudience: row.target_audience,
    contentBoundaries: JSON.parse(row.content_boundaries_json) as unknown,
    humorSeriousness: row.humor_seriousness,
    voiceEvidence: JSON.parse(row.voice_evidence_json) as unknown,
    impactScope: JSON.parse(row.impact_scope_json) as unknown,
    status: row.status
  };
}
