import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export type NarrativeProjectionType = 'emotion' | 'mainline' | 'subplot' | 'hook' | 'information_gap';

export class NarrativeProjectionService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public rebuild(scope: BookScope): number {
    assertBookScope(scope);
    const book = this.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number } | undefined;
    if (book === undefined) throw new Error('书籍不存在或越权');
    const chapters = this.database.prepare(`
      SELECT c.chapter_id, c.chapter_number, c.title, c.settlement_status,
        e.state_json, q.scores_json
      FROM chapters c
      LEFT JOIN chapter_end_states e ON e.chapter_end_state_id = c.chapter_end_state_id
      LEFT JOIN chapter_quality_metrics q ON q.chapter_id = c.chapter_id
      WHERE c.owner_id = ? AND c.book_id = ? ORDER BY c.chapter_number
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      chapter_id: string;
      chapter_number: number;
      title: string;
      settlement_status: string;
      state_json: string | null;
      scores_json: string | null;
    }>;
    const outlines = this.database.prepare(`
      SELECT json_extract(v.content_json, '$.chapterNumber') AS chapter_number, v.content_json, v.artifact_version_id
      FROM artifact_versions v JOIN artifacts a ON a.artifact_id = v.artifact_id
      WHERE v.owner_id = ? AND v.book_id = ? AND a.artifact_type = 'chapter_outline' AND v.status = 'selected'
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ chapter_number: number; content_json: string; artifact_version_id: string }>;
    const now = this.clock.now().toISOString();
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`DELETE FROM narrative_projections WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
      for (const outline of outlines) {
        const content = JSON.parse(outline.content_json) as { goal?: unknown; beats?: unknown; hook?: unknown };
        this.insert(scope, 'mainline', 'planned', outline.chapter_number, book.canon_revision, { goal: content.goal, beats: content.beats }, [outline.artifact_version_id], now);
        this.insert(scope, 'hook', 'planned', outline.chapter_number, book.canon_revision, { hook: content.hook }, [outline.artifact_version_id], now);
        this.insert(scope, 'emotion', 'planned', outline.chapter_number, book.canon_revision, { status: 'not_extracted', source: 'chapter_outline' }, [outline.artifact_version_id], now);
        this.insert(scope, 'subplot', 'planned', outline.chapter_number, book.canon_revision, { status: 'not_extracted', source: 'chapter_outline' }, [outline.artifact_version_id], now);
        this.insert(scope, 'information_gap', 'planned', outline.chapter_number, book.canon_revision, { status: 'not_extracted', source: 'chapter_outline' }, [outline.artifact_version_id], now);
      }
      for (const chapter of chapters.filter((candidate) => candidate.settlement_status === 'settled' && candidate.state_json !== null)) {
        const state = JSON.parse(chapter.state_json!) as Record<string, unknown>;
        const quality = chapter.scores_json === null ? {} : JSON.parse(chapter.scores_json) as Record<string, unknown>;
        const sources = [chapter.chapter_id];
        this.insert(scope, 'mainline', 'actual', chapter.chapter_number, book.canon_revision, { chapterTitle: chapter.title, chapterState: state }, sources, now);
        this.insert(scope, 'hook', 'actual', chapter.chapter_number, book.canon_revision, { endingExcerpt: state.endingExcerpt ?? null }, sources, now);
        this.insert(scope, 'emotion', 'actual', chapter.chapter_number, book.canon_revision, { status: 'not_extracted', quality, source: 'selected_manuscript' }, sources, now);
        this.insert(scope, 'subplot', 'actual', chapter.chapter_number, book.canon_revision, { status: 'not_extracted', source: 'selected_manuscript' }, sources, now);
        this.insert(scope, 'information_gap', 'actual', chapter.chapter_number, book.canon_revision, { status: 'not_extracted', source: 'selected_manuscript' }, sources, now);
      }
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return outlines.length * 5 + chapters.filter((chapter) => chapter.settlement_status === 'settled' && chapter.state_json !== null).length * 5;
  }

  public list(scope: BookScope, projectionType?: NarrativeProjectionType): unknown[] {
    assertBookScope(scope);
    if (projectionType === undefined) {
      return this.database.prepare(`SELECT * FROM narrative_projections WHERE owner_id = ? AND book_id = ? ORDER BY projection_type, track, chapter_number`)
        .all(scope.ownerId, scope.bookId);
    }
    return this.database.prepare(`SELECT * FROM narrative_projections WHERE owner_id = ? AND book_id = ? AND projection_type = ? ORDER BY track, chapter_number`)
      .all(scope.ownerId, scope.bookId, projectionType);
  }

  private insert(
    scope: BookScope,
    type: NarrativeProjectionType,
    track: 'planned' | 'actual',
    chapterNumber: number,
    canonRevision: number,
    content: Record<string, unknown>,
    sourceIds: string[],
    now: string
  ): void {
    this.database.prepare(`
      INSERT INTO narrative_projections (
        projection_id, owner_id, book_id, projection_type, track, chapter_number,
        canon_revision, content_json, source_ids_json, rebuilt_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(this.ids.next(), scope.ownerId, scope.bookId, type, track, chapterNumber, canonRevision, JSON.stringify(content), JSON.stringify(sourceIds), now);
  }
}
