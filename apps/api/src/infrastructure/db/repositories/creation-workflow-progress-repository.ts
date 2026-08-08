import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface WorkflowProgressRow {
  planningVersion: number;
  stage: string;
  activeEventId: string | null;
  frozenChapterOutlineRefsJson: string;
}

export interface FrozenChapterOutlineRow {
  outlineId: string;
  artifactId: string;
}

export class CreationWorkflowProgressRepository {
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

  public markManuscriptStarted(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE creation_workflow_states SET stage='manuscript_in_progress',
      waiting_task_id=?,blocking_reason=NULL,updated_at=datetime('now')
      WHERE owner_id=? AND book_id=? AND stage='next_chapters_ready'`)
      .run(taskId, scope.ownerId, scope.bookId);
  }

  public markWaitingForAuthor(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE creation_workflow_states SET stage='waiting_for_author',
      waiting_task_id=?,blocking_reason=NULL,updated_at=datetime('now')
      WHERE owner_id=? AND book_id=? AND stage IN ('manuscript_in_progress','waiting_for_author')`)
      .run(taskId, scope.ownerId, scope.bookId);
  }

  public markAuthorRejected(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE creation_workflow_states SET stage='manuscript_in_progress',
      waiting_task_id=?,blocking_reason='作者要求修改当前章',updated_at=datetime('now')
      WHERE owner_id=? AND book_id=? AND stage IN ('waiting_for_author','chapter_settlement_in_progress')`)
      .run(taskId, scope.ownerId, scope.bookId);
  }

  public markChapterSettlementStarted(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE creation_workflow_states SET stage='chapter_settlement_in_progress',
      waiting_task_id=?,blocking_reason=NULL,updated_at=datetime('now')
      WHERE owner_id=? AND book_id=? AND stage='waiting_for_author'`)
      .run(taskId, scope.ownerId, scope.bookId);
  }

  public workflow(scope: BookScope): WorkflowProgressRow | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT planning_version,stage,active_event_id,frozen_chapter_outline_refs_json
      FROM creation_workflow_states WHERE owner_id=? AND book_id=?`)
      .get(scope.ownerId, scope.bookId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      planningVersion: Number(row.planning_version),
      stage: String(row.stage),
      activeEventId: typeof row.active_event_id === 'string' ? row.active_event_id : null,
      frozenChapterOutlineRefsJson: String(row.frozen_chapter_outline_refs_json)
    };
  }

  public frozenOutlineForChapter(
    scope: BookScope,
    eventId: string,
    chapterNumber: number
  ): FrozenChapterOutlineRow | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT o.event_chapter_outline_id AS outline_id,a.artifact_id
      FROM event_chapter_outlines o
      JOIN event_chapter_outline_versions ov ON ov.event_chapter_outline_version_id=o.active_version_id
        AND ov.owner_id=o.owner_id AND ov.book_id=o.book_id
      JOIN artifact_versions av ON av.artifact_version_id=ov.artifact_version_id
        AND av.owner_id=ov.owner_id AND av.book_id=ov.book_id
      JOIN artifacts a ON a.artifact_id=av.artifact_id AND a.owner_id=av.owner_id AND a.book_id=av.book_id
      JOIN event_chapter_sequences seq ON seq.event_chapter_sequence_id=o.event_chapter_sequence_id
        AND seq.owner_id=o.owner_id AND seq.book_id=o.book_id AND seq.active_version_id=ov.sequence_version_id
      JOIN event_chapter_sequence_versions sv ON sv.event_chapter_sequence_version_id=ov.sequence_version_id
        AND sv.owner_id=ov.owner_id AND sv.book_id=ov.book_id
      JOIN story_event_versions ev ON ev.story_event_version_id=ov.event_version_id
        AND ev.owner_id=ov.owner_id AND ev.book_id=ov.book_id
      JOIN volume_plan_versions vv ON vv.volume_plan_version_id=ov.volume_plan_version_id
        AND vv.owner_id=ov.owner_id AND vv.book_id=ov.book_id
      JOIN creation_workflow_states w ON w.owner_id=ov.owner_id AND w.book_id=ov.book_id
        AND w.active_event_id=o.event_id AND w.active_event_version_id=ov.event_version_id
        AND w.active_volume_plan_version_id=ov.volume_plan_version_id
      WHERE o.owner_id=? AND o.book_id=? AND o.event_id=? AND o.chapter_number=?
        AND o.status='frozen' AND ov.status='frozen' AND a.artifact_type='chapter_outline'
        AND seq.status IN ('active','completed') AND sv.status='active' AND ev.status='active' AND vv.status='active'
      LIMIT 1`).get(scope.ownerId, scope.bookId, eventId, chapterNumber) as
        { outline_id: string; artifact_id: string } | undefined;
    return row === undefined ? undefined : { outlineId: row.outline_id, artifactId: row.artifact_id };
  }

  public settleOutline(scope: BookScope, outlineId: string, now: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`UPDATE event_chapter_outlines SET status='settled',revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND event_chapter_outline_id=? AND status='frozen'`)
      .run(now, scope.ownerId, scope.bookId, outlineId).changes === 1;
  }

  public remainingOutlineCount(scope: BookScope, eventId: string): number {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM event_chapter_outlines
      WHERE owner_id=? AND book_id=? AND event_id=? AND status IN ('planned','candidate','frozen')`)
      .get(scope.ownerId, scope.bookId, eventId) as { count: number };
    return row.count;
  }

  public advanceAfterChapterSettlement(scope: BookScope, input: {
    expectedPlanningVersion: number;
    eventId: string;
    stage: string;
    refsJson: string;
    now: string;
  }): boolean {
    assertBookScope(scope);
    return this.database.prepare(`UPDATE creation_workflow_states SET planning_version=planning_version+1,stage=?,
      frozen_chapter_outline_refs_json=?,waiting_task_id=NULL,blocking_reason=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND planning_version=? AND active_event_id=?
        AND stage IN ('next_chapters_ready','manuscript_in_progress','waiting_for_author','chapter_settlement_in_progress')`)
      .run(input.stage, input.refsJson, input.now, scope.ownerId, scope.bookId,
        input.expectedPlanningVersion, input.eventId).changes === 1;
  }
}