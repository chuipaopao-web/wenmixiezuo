import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';
import { assertBookScope } from '../../../domain/scope.js';
import type { EpistemicStatus, KnowledgeAuthorityGrade, KnowledgeLayer, KnowledgeRevisionRecord, KnowledgeRevisionStatus, TemporalScopeInput, TemporalScopeRecord } from '../../../contracts/knowledge-lifecycle.js';

interface RevisionRow {
  knowledge_revision_id: string;
  knowledge_item_id: string;
  revision: number;
  lifecycle_layer: KnowledgeLayer;
  authority_grade: KnowledgeAuthorityGrade;
  epistemic_status: EpistemicStatus;
  negated: number;
  viewpoint_entity_id: string | null;
  temporal_scope_id: string;
  content_json: string;
  content_text: string;
  content_hash: string;
  evidence_json: string;
  source_type: string;
  source_id: string;
  source_hash: string | null;
  source_locator_json: string;
  canon_revision: number;
  status: KnowledgeRevisionStatus;
  created_at: string;
}

export interface CreateKnowledgeRevisionInput {
  revisionId: string;
  itemId: string;
  parentRevisionId?: string | null;
  revision: number;
  layer: KnowledgeLayer;
  authorityGrade: KnowledgeAuthorityGrade;
  epistemicStatus: EpistemicStatus;
  negated: boolean;
  viewpointEntityId?: string | null;
  temporalScopeId: string;
  contentJson: string;
  contentText: string;
  contentHash: string;
  evidenceJson: string;
  sourceType: string;
  sourceId: string;
  sourceHash?: string | null;
  sourceLocatorJson: string;
  canonRevision: number;
  extractorVersion?: string | null;
  createdByType: 'boss' | 'agent' | 'system' | 'migration';
  createdById?: string | null;
  status: KnowledgeRevisionStatus;
  now: string;
}

export class KnowledgeRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public ensureItem(scope: BookScope, itemId: string, knowledgeType: string, canonicalKey: string, now: string): { itemId: string; created: boolean } {
    assertBookScope(scope);
    const existing = this.database.prepare(`
      SELECT knowledge_item_id FROM knowledge_items
      WHERE owner_id = ? AND book_id = ? AND knowledge_type = ? AND canonical_key = ?
    `).get(scope.ownerId, scope.bookId, knowledgeType, canonicalKey) as { knowledge_item_id: string } | undefined;
    if (existing !== undefined) return { itemId: existing.knowledge_item_id, created: false };
    this.database.prepare(`
      INSERT INTO knowledge_items (
        knowledge_item_id, owner_id, book_id, knowledge_type, canonical_key,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(itemId, scope.ownerId, scope.bookId, knowledgeType, canonicalKey, now, now);
    return { itemId, created: true };
  }

  public nextRevision(scope: BookScope, itemId: string): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(revision), 0) AS revision FROM knowledge_revisions
      WHERE owner_id = ? AND book_id = ? AND knowledge_item_id = ?
    `).get(scope.ownerId, scope.bookId, itemId) as { revision: number };
    return row.revision + 1;
  }

  public createTemporalScope(scope: BookScope, temporalScopeId: string, input: TemporalScopeInput, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO temporal_scopes (
        temporal_scope_id, owner_id, book_id, world_time_start, world_time_end,
        knowledge_subject_type, knowledge_subject_id, knowledge_time_start, knowledge_time_end,
        recorded_at, canon_revision, narrative_chapter_start, narrative_chapter_end,
        calendar_key, temporal_completeness, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      temporalScopeId, scope.ownerId, scope.bookId,
      input.worldTimeStart ?? null, input.worldTimeEnd ?? null,
      input.knowledgeSubjectType ?? null, input.knowledgeSubjectId ?? null,
      input.knowledgeTimeStart ?? null, input.knowledgeTimeEnd ?? null,
      input.recordedAt ?? now, input.canonRevision,
      input.narrativeChapterStart ?? null, input.narrativeChapterEnd ?? null,
      input.calendarKey ?? null, input.completeness, now
    );
  }

  public createRevision(scope: BookScope, input: CreateKnowledgeRevisionInput): KnowledgeRevisionRecord {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO knowledge_revisions (
        knowledge_revision_id, knowledge_item_id, owner_id, book_id, parent_revision_id,
        revision, lifecycle_layer, authority_grade, epistemic_status, negated,
        viewpoint_entity_id, temporal_scope_id, content_json, content_text, content_hash,
        evidence_json, source_type, source_id, source_hash, source_locator_json,
        canon_revision, extractor_version, created_by_type, created_by_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.revisionId, input.itemId, scope.ownerId, scope.bookId, input.parentRevisionId ?? null,
      input.revision, input.layer, input.authorityGrade, input.epistemicStatus, input.negated ? 1 : 0,
      input.viewpointEntityId ?? null, input.temporalScopeId, input.contentJson, input.contentText, input.contentHash,
      input.evidenceJson, input.sourceType, input.sourceId, input.sourceHash ?? null, input.sourceLocatorJson,
      input.canonRevision, input.extractorVersion ?? null, input.createdByType, input.createdById ?? null, input.status, input.now
    );
    return this.requireRevision(scope, input.revisionId);
  }

  public requireTemporalScope(scope: BookScope, temporalScopeId: string): TemporalScopeRecord {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT temporal_scope_id, world_time_start, world_time_end, knowledge_subject_id,
             knowledge_time_start, knowledge_time_end, recorded_at, canon_revision, temporal_completeness
      FROM temporal_scopes WHERE owner_id = ? AND book_id = ? AND temporal_scope_id = ?
    `).get(scope.ownerId, scope.bookId, temporalScopeId) as {
      temporal_scope_id: string; world_time_start: string | null; world_time_end: string | null;
      knowledge_subject_id: string | null; knowledge_time_start: string | null; knowledge_time_end: string | null;
      recorded_at: string; canon_revision: number; temporal_completeness: TemporalScopeRecord['completeness'];
    } | undefined;
    if (row === undefined) throw new Error('时间范围不存在或越权');
    return {
      temporalScopeId: row.temporal_scope_id,
      worldTimeStart: row.world_time_start,
      worldTimeEnd: row.world_time_end,
      knowledgeSubjectId: row.knowledge_subject_id,
      knowledgeTimeStart: row.knowledge_time_start,
      knowledgeTimeEnd: row.knowledge_time_end,
      recordedAt: row.recorded_at,
      canonRevision: row.canon_revision,
      completeness: row.temporal_completeness
    };
  }

  public requireRevision(scope: BookScope, revisionId: string): KnowledgeRevisionRecord {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT * FROM knowledge_revisions
      WHERE owner_id = ? AND book_id = ? AND knowledge_revision_id = ?
    `).get(scope.ownerId, scope.bookId, revisionId) as RevisionRow | undefined;
    if (row === undefined) throw new Error('知识版本不存在或越权');
    return mapRevision(row);
  }

  public findActiveCandidateByKey(scope: BookScope, knowledgeType: string, canonicalKey: string): KnowledgeRevisionRecord | null {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT r.* FROM knowledge_revisions r
      JOIN knowledge_items i ON i.knowledge_item_id = r.knowledge_item_id
        AND i.owner_id = r.owner_id AND i.book_id = r.book_id
      WHERE r.owner_id = ? AND r.book_id = ? AND i.knowledge_type = ? AND i.canonical_key = ?
        AND r.lifecycle_layer = 'candidate' AND r.status = 'active'
      ORDER BY r.revision DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, knowledgeType, canonicalKey) as RevisionRow | undefined;
    return row === undefined ? null : mapRevision(row);
  }

  public setRevisionStatus(scope: BookScope, revisionId: string, expected: KnowledgeRevisionStatus, next: KnowledgeRevisionStatus, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE knowledge_revisions SET status = ?, reviewed_at = ?
      WHERE owner_id = ? AND book_id = ? AND knowledge_revision_id = ? AND status = ?
    `).run(next, now, scope.ownerId, scope.bookId, revisionId, expected);
    if (result.changes !== 1) throw new Error('知识版本状态已经变化');
  }

  public setCurrentRevision(scope: BookScope, itemId: string, revisionId: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE knowledge_items SET current_revision_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND knowledge_item_id = ? AND status = 'active'
    `).run(revisionId, now, scope.ownerId, scope.bookId, itemId);
    if (result.changes !== 1) throw new Error('知识项目不存在或越权');
  }

  public createPromotion(scope: BookScope, input: {
    promotionId: string; itemId: string; temporaryRevisionId?: string | null; candidateRevisionId: string;
    canonRevisionId: string; checksJson: string; decisionType: string; decisionSourceType: string;
    decisionSourceId: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO knowledge_promotions (
        knowledge_promotion_id, owner_id, book_id, knowledge_item_id,
        source_temporary_revision_id, candidate_revision_id, promoted_canon_revision_id,
        checks_json, decision_type, decision_source_type, decision_source_id,
        status, created_at, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?, ?)
    `).run(
      input.promotionId, scope.ownerId, scope.bookId, input.itemId,
      input.temporaryRevisionId ?? null, input.candidateRevisionId, input.canonRevisionId,
      input.checksJson, input.decisionType, input.decisionSourceType, input.decisionSourceId,
      input.now, input.now
    );
  }

  public createCanonSourceBinding(scope: BookScope, input: {
    bindingId: string; knowledgeRevisionId: string; canonRevisionId?: string | null;
    sourceType: string; sourceId: string; sourceHash: string; sourceLocatorJson: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO canon_source_bindings (
        canon_source_binding_id, owner_id, book_id, knowledge_revision_id,
        canon_revision_id, canon_source_type, canon_source_id, source_hash,
        source_locator_json, evidence_checked_at, binding_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      input.bindingId, scope.ownerId, scope.bookId, input.knowledgeRevisionId,
      input.canonRevisionId ?? null, input.sourceType, input.sourceId, input.sourceHash,
      input.sourceLocatorJson, input.now, input.now
    );
  }

  public listCanonAt(scope: BookScope, filters: {
    knowledgeType?: string; canonicalKey?: string; canonRevision: number;
    worldTime?: string; knowledgeTime?: string; viewpointEntityId?: string;
  }): KnowledgeRevisionRecord[] {
    assertBookScope(scope);
    const conditions = [
      `r.owner_id = ?`, `r.book_id = ?`, `r.lifecycle_layer = 'canon'`, `r.status = 'active'`,
      `r.canon_revision <= ?`, `t.status = 'active'`
    ];
    const parameters: Array<string | number | null> = [scope.ownerId, scope.bookId, filters.canonRevision];
    if (filters.knowledgeType !== undefined) { conditions.push('i.knowledge_type = ?'); parameters.push(filters.knowledgeType); }
    if (filters.canonicalKey !== undefined) { conditions.push('i.canonical_key = ?'); parameters.push(filters.canonicalKey); }
    if (filters.worldTime !== undefined) {
      conditions.push('t.world_time_start IS NOT NULL AND t.world_time_start <= ? AND (t.world_time_end IS NULL OR t.world_time_end >= ?)');
      parameters.push(filters.worldTime, filters.worldTime);
    }
    if (filters.viewpointEntityId !== undefined) {
      conditions.push('(t.knowledge_subject_id IS NULL OR (t.knowledge_subject_id = ? AND ? IS NOT NULL AND (t.knowledge_time_start IS NULL OR t.knowledge_time_start <= ?) AND (t.knowledge_time_end IS NULL OR t.knowledge_time_end >= ?)))');
      parameters.push(filters.viewpointEntityId, filters.knowledgeTime ?? null, filters.knowledgeTime ?? null, filters.knowledgeTime ?? null);
    } else {
      conditions.push('t.knowledge_subject_id IS NULL');
    }
    const rows = this.database.prepare(`
      SELECT r.* FROM knowledge_revisions r
      JOIN knowledge_items i ON i.knowledge_item_id = r.knowledge_item_id AND i.owner_id = r.owner_id AND i.book_id = r.book_id
      JOIN temporal_scopes t ON t.temporal_scope_id = r.temporal_scope_id AND t.owner_id = r.owner_id AND t.book_id = r.book_id
      WHERE ${conditions.join(' AND ')} ORDER BY r.canon_revision DESC, r.created_at DESC
    `).all(...parameters) as unknown as RevisionRow[];
    return rows.map(mapRevision);
  }

  public listLegacyFacts(scope: BookScope): Array<{
    factId: string; subjectEntityId: string; relationKey: string; value: unknown;
    storyTimeStart: string | null; storyTimeEnd: string | null; evidence: unknown[];
    grade: KnowledgeAuthorityGrade; status: string; sourceChapterId: string | null;
    sourceManuscriptVersionId: string | null; sourceHash: string | null; createdAt: string;
  }> {
    assertBookScope(scope);
    const rows = this.database.prepare(`
      SELECT f.fact_id, f.subject_entity_id, f.relation_key, f.value_json,
             f.story_time_start, f.story_time_end, f.evidence_json, f.grade, f.status,
             f.source_chapter_id, f.source_manuscript_version_id, m.content_hash, f.created_at
      FROM fact_assertions f
      LEFT JOIN manuscript_versions m ON m.manuscript_version_id = f.source_manuscript_version_id
        AND m.owner_id = f.owner_id AND m.book_id = f.book_id
      WHERE f.owner_id = ? AND f.book_id = ? AND NOT EXISTS (
        SELECT 1 FROM knowledge_revisions r
        WHERE r.owner_id = f.owner_id AND r.book_id = f.book_id
          AND r.source_type = 'legacy_fact_assertion' AND r.source_id = f.fact_id
      ) ORDER BY f.created_at, f.fact_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      fact_id: string; subject_entity_id: string; relation_key: string; value_json: string;
      story_time_start: string | null; story_time_end: string | null; evidence_json: string;
      grade: KnowledgeAuthorityGrade; status: string; source_chapter_id: string | null;
      source_manuscript_version_id: string | null; content_hash: string | null; created_at: string;
    }>;
    return rows.map((row) => ({
      factId: row.fact_id,
      subjectEntityId: row.subject_entity_id,
      relationKey: row.relation_key,
      value: JSON.parse(row.value_json) as unknown,
      storyTimeStart: row.story_time_start,
      storyTimeEnd: row.story_time_end,
      evidence: JSON.parse(row.evidence_json) as unknown[],
      grade: row.grade,
      status: row.status,
      sourceChapterId: row.source_chapter_id,
      sourceManuscriptVersionId: row.source_manuscript_version_id,
      sourceHash: row.content_hash,
      createdAt: row.created_at
    }));
  }
}

function mapRevision(row: RevisionRow): KnowledgeRevisionRecord {
  return {
    knowledgeRevisionId: row.knowledge_revision_id,
    knowledgeItemId: row.knowledge_item_id,
    revision: row.revision,
    layer: row.lifecycle_layer,
    authorityGrade: row.authority_grade,
    epistemicStatus: row.epistemic_status,
    negated: row.negated === 1,
    viewpointEntityId: row.viewpoint_entity_id,
    temporalScopeId: row.temporal_scope_id,
    content: JSON.parse(row.content_json) as unknown,
    contentText: row.content_text,
    contentHash: row.content_hash,
    evidence: JSON.parse(row.evidence_json) as unknown[],
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceHash: row.source_hash,
    sourceLocator: JSON.parse(row.source_locator_json) as Record<string, unknown>,
    canonRevision: row.canon_revision,
    status: row.status,
    createdAt: row.created_at
  };
}
