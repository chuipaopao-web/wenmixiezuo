import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface OwnerManuscriptChapterRow {
  settlement_status: string;
  current_manuscript_version_id: string | null;
  canon_manuscript_version_id: string | null;
}

export interface OwnerManuscriptVersionRow {
  manuscript_version_id: string;
  parent_version_id: string | null;
  word_count: number;
  status: string;
}

export interface OwnerManuscriptGateRow {
  confirmation_id: string;
  task_id: string;
}

export class OwnerManuscriptRepository {
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

  public chapter(scope: BookScope, chapterId: string): OwnerManuscriptChapterRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT settlement_status, current_manuscript_version_id, canon_manuscript_version_id FROM chapters
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
      .get(chapterId, scope.ownerId, scope.bookId) as OwnerManuscriptChapterRow | undefined;
  }

  public withdrawCurrentManuscript(
    scope: BookScope,
    chapterId: string,
    expectedManuscriptVersionId: string,
    now: string
  ): boolean {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE chapters
      SET current_manuscript_version_id = NULL, generation_status = 'not_started',
        settlement_status = 'unsettled', updated_at = ?, version = version + 1
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
        AND current_manuscript_version_id = ? AND canon_manuscript_version_id IS NULL
        AND settlement_status <> 'settled'`)
      .run(now, chapterId, scope.ownerId, scope.bookId, expectedManuscriptVersionId);
    return result.changes === 1;
  }

  public hasUnsafeTask(scope: BookScope, chapterId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM tasks WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
      AND status IN ('pending','queued','working','paused','interrupted') LIMIT 1`)
      .get(scope.ownerId, scope.bookId, chapterId) !== undefined;
  }

  public manuscriptByHash(scope: BookScope, chapterId: string, contentHash: string): OwnerManuscriptVersionRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT manuscript_version_id, parent_version_id, word_count, status
      FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND content_hash = ?`)
      .get(scope.ownerId, scope.bookId, chapterId, contentHash) as OwnerManuscriptVersionRow | undefined;
  }

  public leadWriterAgentId(scope: BookScope): string | null {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT a.agent_id FROM agent_instances a JOIN role_templates r
      ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = 'lead_writer' AND a.enabled = 1
        AND a.activation_state IN ('idle','standby')
      ORDER BY CASE a.activation_state WHEN 'idle' THEN 0 ELSE 1 END, a.created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { agent_id: string } | undefined;
    return row?.agent_id ?? null;
  }

  public awaitingGates(scope: BookScope, chapterId: string): OwnerManuscriptGateRow[] {
    assertBookScope(scope);
    return this.database.prepare(`SELECT confirmation_id, task_id FROM chapter_approval_gates
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND status = 'awaiting_owner'`)
      .all(scope.ownerId, scope.bookId, chapterId) as unknown as OwnerManuscriptGateRow[];
  }

  public supersedeGate(scope: BookScope, gate: OwnerManuscriptGateRow, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE chapter_approval_gates SET status = 'superseded', decision_note = ?, resolved_at = ?
      WHERE confirmation_id = ? AND owner_id = ? AND book_id = ? AND status = 'awaiting_owner'`)
      .run('作者保存了新的正文版本', now, gate.confirmation_id, scope.ownerId, scope.bookId);
    this.database.prepare(`UPDATE confirmations SET status = 'superseded', resolved_at = ? WHERE confirmation_id = ? AND status = 'pending'`)
      .run(now, gate.confirmation_id);
    this.database.prepare(`UPDATE tasks SET status = 'cancelled', current_phase = 'owner_edited_new_version', cancel_requested = 1, updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'waiting_confirmation'`)
      .run(now, gate.task_id, scope.ownerId, scope.bookId);
  }

  public markChapterUnsettled(scope: BookScope, chapterId: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE chapters SET settlement_status = 'unsettled', updated_at = ?
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`).run(now, chapterId, scope.ownerId, scope.bookId);
  }

  public failOwnerEditTask(scope: BookScope, taskId: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE tasks SET status = 'failed', error_code = 'OWNER_EDIT_FAILED', updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'pending'`)
      .run(now, taskId, scope.ownerId, scope.bookId);
  }

  public archiveFile(scope: BookScope, fileId: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE file_registry SET status = 'archived', archived_at = ?
      WHERE file_id = ? AND owner_id = ? AND book_id = ?`).run(now, fileId, scope.ownerId, scope.bookId);
  }

  /** 该书是否已有正文正史：有正文的书在清空或改动设定前需要更强的警告。 */
  public hasCanonChapters(scope: BookScope): boolean {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT COUNT(*) AS total FROM chapters
      WHERE owner_id = ? AND book_id = ? AND canon_manuscript_version_id IS NOT NULL
    `).get(scope.ownerId, scope.bookId) as { total: number };
    return row.total > 0;
  }
}
