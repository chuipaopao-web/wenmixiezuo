import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export interface KnowledgeConsistencyIssue {
  code: string;
  targetId: string;
  details: Record<string, unknown>;
}

export class KnowledgeConsistencyService {
  public constructor(private readonly database: DatabaseSync) {}

  public inspect(scope: BookScope): KnowledgeConsistencyIssue[] {
    assertBookScope(scope);
    const issues: KnowledgeConsistencyIssue[] = [];
    const book = this.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number } | undefined;
    if (book === undefined) throw new Error('书籍不存在或越权');
    if (book.canon_revision > 0) {
      const revision = this.database.prepare(`SELECT canon_revision_id FROM canon_revisions WHERE owner_id = ? AND book_id = ? AND revision = ?`)
        .get(scope.ownerId, scope.bookId, book.canon_revision);
      if (revision === undefined) issues.push({ code: 'CANON_REVISION_MISSING', targetId: scope.bookId, details: { revision: book.canon_revision } });
    }
    const brokenChapters = this.database.prepare(`
      SELECT chapter_id, canon_manuscript_version_id, chapter_end_state_id FROM chapters
      WHERE owner_id = ? AND book_id = ? AND settlement_status = 'settled'
        AND (canon_manuscript_version_id IS NULL OR chapter_end_state_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM manuscript_versions m WHERE m.manuscript_version_id = chapters.canon_manuscript_version_id
            AND m.owner_id = chapters.owner_id AND m.book_id = chapters.book_id AND m.status = 'canon'
        ) OR NOT EXISTS (
          SELECT 1 FROM chapter_end_states e WHERE e.chapter_end_state_id = chapters.chapter_end_state_id
            AND e.owner_id = chapters.owner_id AND e.book_id = chapters.book_id
        ))
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ chapter_id: string; canon_manuscript_version_id: string | null; chapter_end_state_id: string | null }>;
    for (const chapter of brokenChapters) issues.push({ code: 'SETTLED_CHAPTER_INCOMPLETE', targetId: chapter.chapter_id, details: chapter });
    const stalePacks = this.database.prepare(`
      SELECT context_pack_id, canon_revision FROM context_packs
      WHERE owner_id = ? AND book_id = ? AND status = 'active' AND canon_revision < ?
    `).all(scope.ownerId, scope.bookId, book.canon_revision) as unknown as Array<{ context_pack_id: string; canon_revision: number }>;
    for (const pack of stalePacks) issues.push({ code: 'STALE_CONTEXT_ACTIVE', targetId: pack.context_pack_id, details: { canonRevision: pack.canon_revision } });
    const foreignBindings = this.database.prepare(`
      SELECT b.fact_id FROM canon_bindings b JOIN fact_assertions f ON f.fact_id = b.fact_id
      WHERE b.owner_id = ? AND b.book_id = ? AND (f.owner_id <> b.owner_id OR f.book_id <> b.book_id)
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ fact_id: string }>;
    for (const binding of foreignBindings) issues.push({ code: 'CANON_BINDING_SCOPE_MISMATCH', targetId: binding.fact_id, details: {} });
    const brokenKnowledge = this.database.prepare(`
      SELECT r.knowledge_revision_id, r.temporal_scope_id
      FROM knowledge_revisions r
      WHERE r.owner_id = ? AND r.book_id = ? AND r.lifecycle_layer = 'canon' AND r.status = 'active'
        AND (NOT EXISTS (
          SELECT 1 FROM temporal_scopes t
          WHERE t.owner_id = r.owner_id AND t.book_id = r.book_id
            AND t.temporal_scope_id = r.temporal_scope_id
        ) OR NOT EXISTS (
          SELECT 1 FROM canon_source_bindings b
          WHERE b.owner_id = r.owner_id AND b.book_id = r.book_id
            AND b.knowledge_revision_id = r.knowledge_revision_id AND b.binding_status = 'active'
        ))
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ knowledge_revision_id: string; temporal_scope_id: string }>;
    for (const revision of brokenKnowledge) {
      issues.push({ code: 'CANON_KNOWLEDGE_EVIDENCE_INCOMPLETE', targetId: revision.knowledge_revision_id, details: { temporalScopeId: revision.temporal_scope_id } });
    }
    const currentRevisionMismatches = this.database.prepare(`
      SELECT i.knowledge_item_id, i.current_revision_id
      FROM knowledge_items i
      WHERE i.owner_id = ? AND i.book_id = ? AND i.current_revision_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM knowledge_revisions r
          WHERE r.owner_id = i.owner_id AND r.book_id = i.book_id
            AND r.knowledge_item_id = i.knowledge_item_id
            AND r.knowledge_revision_id = i.current_revision_id
        )
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ knowledge_item_id: string; current_revision_id: string }>;
    for (const item of currentRevisionMismatches) {
      issues.push({ code: 'KNOWLEDGE_CURRENT_REVISION_MISMATCH', targetId: item.knowledge_item_id, details: { currentRevisionId: item.current_revision_id } });
    }
    return issues;
  }
}
