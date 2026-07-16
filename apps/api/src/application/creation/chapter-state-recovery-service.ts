import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export class ChapterStateRecoveryService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly clock: Clock
  ) {}

  public reconcileAllCancelledShells(): number {
    return Number(this.database.prepare(`
      UPDATE chapters SET plan_status = 'planned', generation_status = 'not_started', updated_at = ?
      WHERE settlement_status = 'unsettled' AND current_manuscript_version_id IS NULL
        AND generation_status IN ('working', 'paused', 'failed')
        AND NOT EXISTS (
          SELECT 1 FROM manuscript_versions m
          WHERE m.owner_id = chapters.owner_id AND m.book_id = chapters.book_id AND m.chapter_id = chapters.chapter_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM tasks active
          WHERE active.owner_id = chapters.owner_id AND active.book_id = chapters.book_id
            AND active.chapter_id = chapters.chapter_id
            AND active.status IN ('pending', 'queued', 'working', 'waiting_confirmation', 'paused', 'blocked', 'interrupted')
        )
        AND 'cancelled' = (
          SELECT latest.status FROM tasks latest
          WHERE latest.owner_id = chapters.owner_id AND latest.book_id = chapters.book_id
            AND latest.chapter_id = chapters.chapter_id AND latest.task_type = 'chapter_creation'
          ORDER BY latest.rowid DESC LIMIT 1
        )
    `).run(this.clock.now().toISOString()).changes);
  }

  public reconcileCancelledChapter(scope: BookScope, chapterId: string): boolean {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE chapters SET plan_status = 'planned', generation_status = 'not_started', updated_at = ?
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
        AND settlement_status = 'unsettled' AND current_manuscript_version_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM manuscript_versions m
          WHERE m.owner_id = chapters.owner_id AND m.book_id = chapters.book_id AND m.chapter_id = chapters.chapter_id
        )
    `).run(this.clock.now().toISOString(), chapterId, scope.ownerId, scope.bookId);
    return result.changes === 1;
  }
}
