import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface ProtagonistProfileRow {
  protagonist_profile_id: string;
  entity_id: string | null;
  display_name: string;
  is_primary: number;
  status: 'active' | 'archived';
}

export interface ProtagonistStateRow {
  protagonist_state_entry_id: string; protagonist_profile_id: string; category: string; logical_key: string;
  label: string; value_type: 'number' | 'text' | 'enum' | 'list' | 'resource' | 'derived'; value_json: string; unit: string | null;
  state_status: 'active' | 'consumed' | 'lost' | 'dead' | 'retired' | 'archived'; authority_layer: 'candidate' | 'canon' | 'derived';
  effective_chapter_number: number | null; story_time: string | null;
  source_kind: 'owner' | 'canon_fact' | 'formula' | 'import'; source_id: string | null; source_fact_id: string | null;
  source_manuscript_version_id: string | null; canon_revision: number; revision: number;
  previous_entry_id: string | null; note: string | null; created_at: string;
}

export interface ProtagonistStructuredFactRow {
  fact_id: string; subject_entity_id: string; relation_key: string; value_json: string;
  source_manuscript_version_id: string | null; source_chapter_id: string | null;
  chapter_number: number | null; canon_revision: number;
}

export class ProtagonistStateRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public runInTransaction<T>(work: () => T): T {
    if (this.database.isTransaction) return work();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public clearPrimary(scope: BookScope, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE protagonist_profiles SET is_primary = 0, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND status = 'active'`).run(now, scope.ownerId, scope.bookId);
  }

  public insertProfile(scope: BookScope, input: {
    profileId: string; entityId: string | null; displayName: string; isPrimary: boolean; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO protagonist_profiles (
      protagonist_profile_id, owner_id, book_id, entity_id, display_name, is_primary, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(input.profileId, scope.ownerId, scope.bookId, input.entityId, input.displayName, input.isPrimary ? 1 : 0, input.now, input.now);
  }

  public updateProfile(scope: BookScope, input: {
    profileId: string; entityId: string | null; displayName: string; isPrimary: boolean; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE protagonist_profiles SET entity_id = ?, display_name = ?, is_primary = ?, status = 'active', updated_at = ?
      WHERE protagonist_profile_id = ? AND owner_id = ? AND book_id = ?`)
      .run(input.entityId, input.displayName, input.isPrimary ? 1 : 0, input.now, input.profileId, scope.ownerId, scope.bookId);
  }

  public archiveProfile(scope: BookScope, profileId: string, now: string): number {
    assertBookScope(scope);
    return Number(this.database.prepare(`UPDATE protagonist_profiles SET status = 'archived', is_primary = 0, updated_at = ?
      WHERE protagonist_profile_id = ? AND owner_id = ? AND book_id = ?`)
      .run(now, profileId, scope.ownerId, scope.bookId).changes);
  }

  public listProfiles(scope: BookScope, includeArchived: boolean): ProtagonistProfileRow[] {
    assertBookScope(scope);
    const statement = includeArchived
      ? `SELECT * FROM protagonist_profiles WHERE owner_id = ? AND book_id = ? ORDER BY is_primary DESC, created_at, protagonist_profile_id`
      : `SELECT * FROM protagonist_profiles WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY is_primary DESC, created_at, protagonist_profile_id`;
    return this.database.prepare(statement).all(scope.ownerId, scope.bookId) as unknown as ProtagonistProfileRow[];
  }

  public canonRevision(scope: BookScope): number | null {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number } | undefined;
    return row?.canon_revision ?? null;
  }

  public structuredFacts(scope: BookScope, chapterId: string): ProtagonistStructuredFactRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT f.fact_id, f.subject_entity_id, f.relation_key, f.value_json,
        f.source_manuscript_version_id, f.source_chapter_id, c.chapter_number,
        (SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?) AS canon_revision
      FROM fact_assertions f
      JOIN canon_bindings b ON b.fact_id = f.fact_id AND b.owner_id = f.owner_id AND b.book_id = f.book_id AND b.active = 1
      LEFT JOIN chapters c ON c.chapter_id = f.source_chapter_id
      WHERE f.owner_id = ? AND f.book_id = ? AND f.source_chapter_id = ? AND f.status = 'active'
        AND (f.relation_key LIKE 'protagonist_state.%' OR f.relation_key LIKE 'protagonist_delta.%')
      ORDER BY f.created_at, f.fact_id
    `).all(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId, chapterId) as unknown as ProtagonistStructuredFactRow[];
  }

  public hasSourceFact(scope: BookScope, factId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM protagonist_state_entries WHERE owner_id = ? AND book_id = ? AND source_fact_id = ?`)
      .get(scope.ownerId, scope.bookId, factId) !== undefined;
  }

  public activeProfileByEntity(scope: BookScope, entityId: string): ProtagonistProfileRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM protagonist_profiles
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
        AND (entity_id = ? OR (entity_id IS NULL AND display_name = (
          SELECT canonical_name FROM entities WHERE entity_id = ? AND owner_id = ? AND book_id = ? AND entity_type = 'character' AND status = 'active'
        )))
      ORDER BY CASE WHEN entity_id = ? THEN 0 ELSE 1 END LIMIT 1`)
      .get(scope.ownerId, scope.bookId, entityId, entityId, scope.ownerId, scope.bookId, entityId) as ProtagonistProfileRow | undefined;
  }

  public profileByEntityIncludingArchived(scope: BookScope, entityId: string): ProtagonistProfileRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM protagonist_profiles
      WHERE owner_id = ? AND book_id = ?
        AND (entity_id = ? OR (entity_id IS NULL AND display_name = (
          SELECT canonical_name FROM entities WHERE entity_id = ? AND owner_id = ? AND book_id = ? AND entity_type = 'character' AND status = 'active'
        )))
      ORDER BY CASE WHEN entity_id = ? THEN 0 ELSE 1 END, CASE status WHEN 'active' THEN 0 ELSE 1 END LIMIT 1`)
      .get(scope.ownerId, scope.bookId, entityId, entityId, scope.ownerId, scope.bookId, entityId) as ProtagonistProfileRow | undefined;
  }

  public activeCharacterName(scope: BookScope, entityId: string): string | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT canonical_name FROM entities
      WHERE entity_id = ? AND owner_id = ? AND book_id = ? AND entity_type = 'character' AND status = 'active'`)
      .get(entityId, scope.ownerId, scope.bookId) as { canonical_name: string } | undefined;
    return row?.canonical_name;
  }

  public uniqueActiveCharacterIdByName(scope: BookScope, displayName: string): string | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT MIN(entity_id) AS entity_id, COUNT(*) AS match_count
      FROM entities
      WHERE owner_id = ? AND book_id = ? AND entity_type = 'character'
        AND status = 'active' AND canonical_name = ?`)
      .get(scope.ownerId, scope.bookId, displayName) as { entity_id: string | null; match_count: number };
    return row.match_count === 1 && row.entity_id !== null ? row.entity_id : undefined;
  }

  public linkProfileEntity(scope: BookScope, profileId: string, entityId: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE protagonist_profiles SET entity_id = ?, updated_at = ?
      WHERE protagonist_profile_id = ? AND owner_id = ? AND book_id = ? AND entity_id IS NULL`)
      .run(entityId, now, profileId, scope.ownerId, scope.bookId);
  }

  public listHistory(scope: BookScope, profileId: string): ProtagonistStateRow[] {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM protagonist_state_entries
      WHERE owner_id = ? AND book_id = ? AND protagonist_profile_id = ?
      ORDER BY created_at, protagonist_state_entry_id`).all(scope.ownerId, scope.bookId, profileId) as unknown as ProtagonistStateRow[];
  }

  public insertState(scope: BookScope, input: {
    entryId: string; profileId: string; category: string; logicalKey: string; label: string; valueType: string;
    valueJson: string; unit: string | null; stateStatus: string; authorityLayer: string;
    effectiveChapterNumber: number | null; storyTime: string | null; sourceKind: string; sourceId: string | null;
    sourceFactId: string | null; sourceManuscriptVersionId: string | null; canonRevision: number; revision: number;
    previousEntryId: string | null; note: string | null; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO protagonist_state_entries (
      protagonist_state_entry_id, owner_id, book_id, protagonist_profile_id, category, logical_key, label,
      value_type, value_json, unit, state_status, authority_layer, effective_chapter_number, story_time,
      source_kind, source_id, source_fact_id, source_manuscript_version_id, canon_revision, revision,
      previous_entry_id, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.entryId, scope.ownerId, scope.bookId, input.profileId, input.category, input.logicalKey, input.label,
        input.valueType, input.valueJson, input.unit, input.stateStatus, input.authorityLayer,
        input.effectiveChapterNumber, input.storyTime, input.sourceKind, input.sourceId, input.sourceFactId,
        input.sourceManuscriptVersionId, input.canonRevision, input.revision, input.previousEntryId, input.note, input.now);
  }

  public latestState(scope: BookScope, profileId: string, logicalKey: string): ProtagonistStateRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM protagonist_state_entries WHERE owner_id = ? AND book_id = ?
      AND protagonist_profile_id = ? AND logical_key = ? ORDER BY revision DESC LIMIT 1`)
      .get(scope.ownerId, scope.bookId, profileId, logicalKey) as ProtagonistStateRow | undefined;
  }

  public profile(scope: BookScope, profileId: string): ProtagonistProfileRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM protagonist_profiles
      WHERE protagonist_profile_id = ? AND owner_id = ? AND book_id = ?`)
      .get(profileId, scope.ownerId, scope.bookId) as ProtagonistProfileRow | undefined;
  }

  public entry(scope: BookScope, entryId: string): ProtagonistStateRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM protagonist_state_entries
      WHERE protagonist_state_entry_id = ? AND owner_id = ? AND book_id = ?`)
      .get(entryId, scope.ownerId, scope.bookId) as ProtagonistStateRow | undefined;
  }

  public isActiveCharacter(scope: BookScope, entityId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM entities
      WHERE entity_id = ? AND owner_id = ? AND book_id = ? AND entity_type = 'character' AND status = 'active'`)
      .get(entityId, scope.ownerId, scope.bookId) !== undefined;
  }
}
