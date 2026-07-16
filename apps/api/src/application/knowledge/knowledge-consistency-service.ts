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
    return issues;
  }
}
