import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface ChapterChallengerReviewRow {
  review_id: string;
  owner_id: string;
  book_id: string;
  chapter_id: string;
  manuscript_version_id: string;
  task_id: string;
  status: 'working' | 'succeeded' | 'failed' | 'cancelled';
  report_json: string | null;
  report_hash: string | null;
  agent_id: string | null;
  model_snapshot_id: string | null;
  input_tokens: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export class ChapterChallengerReviewRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public insert(scope: BookScope, input: {
    reviewId: string; chapterId: string; manuscriptVersionId: string; taskId: string; now: string;
  }): void {
    this.database.prepare(`
      INSERT INTO chapter_challenger_reviews (
        review_id, owner_id, book_id, chapter_id, manuscript_version_id, task_id,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'working', ?, ?)
    `).run(input.reviewId, scope.ownerId, scope.bookId, input.chapterId, input.manuscriptVersionId, input.taskId, input.now, input.now);
  }

  public findById(scope: BookScope, reviewId: string): ChapterChallengerReviewRow | undefined {
    return this.database.prepare(`
      SELECT * FROM chapter_challenger_reviews WHERE owner_id = ? AND book_id = ? AND review_id = ?
    `).get(scope.ownerId, scope.bookId, reviewId) as ChapterChallengerReviewRow | undefined;
  }

  public latestForChapter(scope: BookScope, chapterId: string): ChapterChallengerReviewRow | undefined {
    return this.database.prepare(`
      SELECT * FROM chapter_challenger_reviews
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
      ORDER BY created_at DESC, review_id DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapterId) as ChapterChallengerReviewRow | undefined;
  }

  public workingForChapter(scope: BookScope, chapterId: string): ChapterChallengerReviewRow | undefined {
    return this.database.prepare(`
      SELECT * FROM chapter_challenger_reviews
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND status = 'working'
      ORDER BY created_at DESC, review_id DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapterId) as ChapterChallengerReviewRow | undefined;
  }

  public markSucceeded(scope: BookScope, reviewId: string, input: {
    reportJson: string; reportHash: string; agentId: string; modelSnapshotId: string; inputTokens: number; now: string;
  }): void {
    this.database.prepare(`
      UPDATE chapter_challenger_reviews
      SET status = 'succeeded', report_json = ?, report_hash = ?, agent_id = ?, model_snapshot_id = ?,
        input_tokens = ?, error_code = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND review_id = ?
    `).run(input.reportJson, input.reportHash, input.agentId, input.modelSnapshotId, input.inputTokens, input.now,
      scope.ownerId, scope.bookId, reviewId);
  }

  public markFailed(scope: BookScope, reviewId: string, errorCode: string, now: string): void {
    this.database.prepare(`
      UPDATE chapter_challenger_reviews SET status = 'failed', error_code = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND review_id = ?
    `).run(errorCode, now, scope.ownerId, scope.bookId, reviewId);
  }

  public markCancelled(scope: BookScope, reviewId: string, now: string): void {
    this.database.prepare(`
      UPDATE chapter_challenger_reviews SET status = 'cancelled', updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND review_id = ?
    `).run(now, scope.ownerId, scope.bookId, reviewId);
  }

  /** 找茬目标章节与正文版本：定稿优先，其次当前稿。 */
  public chapterManuscriptTarget(scope: BookScope, chapterId: string): {
    chapterId: string; chapterNumber: number; manuscriptVersionId: string | null;
  } | undefined {
    const row = this.database.prepare(`
      SELECT chapter_id, chapter_number, COALESCE(canon_manuscript_version_id, current_manuscript_version_id) AS manuscript_version_id
      FROM chapters WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
    `).get(scope.ownerId, scope.bookId, chapterId) as
    { chapter_id: string; chapter_number: number; manuscript_version_id: string | null } | undefined;
    return row === undefined
      ? undefined
      : { chapterId: row.chapter_id, chapterNumber: row.chapter_number, manuscriptVersionId: row.manuscript_version_id };
  }

  public manuscriptRelativePath(scope: BookScope, manuscriptVersionId: string): string | undefined {
    return (this.database.prepare(`
      SELECT f.relative_path FROM manuscript_versions m JOIN file_registry f ON f.file_id = m.file_id
      WHERE m.manuscript_version_id = ? AND m.owner_id = ? AND m.book_id = ? AND f.status = 'active'
    `).get(manuscriptVersionId, scope.ownerId, scope.bookId) as { relative_path: string } | undefined)?.relative_path;
  }

  public confirmedSettingItems(scope: BookScope): Array<{ itemKey: string; label: string; content: string }> {
    const rows = this.database.prepare(`
      SELECT item_key, label, content_text FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND item_status = '已确认' AND content_text IS NOT NULL
      ORDER BY sort_order, item_key LIMIT 24
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ item_key: string; label: string; content_text: string }>;
    return rows.map((row) => ({ itemKey: row.item_key, label: row.label, content: row.content_text }));
  }

  public volumeToneContentJson(scope: BookScope, chapterId: string): string | undefined {
    return (this.database.prepare(`
      SELECT v.content_json
      FROM chapters c
      JOIN volume_plans p ON p.owner_id = c.owner_id AND p.book_id = c.book_id AND p.physical_volume_id = c.volume_id
      JOIN volume_plan_versions v ON v.volume_plan_version_id = p.active_version_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_id = ?
      ORDER BY p.plan_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapterId) as { content_json: string } | undefined)?.content_json;
  }

  public bookRevisions(scope: BookScope): { canonRevision: number; positioningVersion: number } {
    const row = this.database.prepare(`
      SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number } | undefined;
    return {
      canonRevision: row?.canon_revision ?? 0,
      positioningVersion: row?.positioning_version ?? 0
    };
  }

  public hasUnresolvedModelCall(scope: BookScope, requestId: string): boolean {
    return this.database.prepare(`
      SELECT 1
      FROM model_calls m
      JOIN model_call_reconciliations r ON r.request_id = m.request_id
      WHERE m.owner_id = ? AND m.book_id = ? AND m.request_id = ?
        AND r.state = 'awaiting_provider'
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, requestId) !== undefined;
  }
}
