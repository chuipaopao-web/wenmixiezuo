import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface PlanningChainRow {
  volume_content_json: string;
  volume_version: number;
  event_content_json: string;
  event_version: number;
  sequence_content_json: string;
  sequence_version: number;
  planned_content_json: string;
}

export class PlanningChainContextRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public artifactContentJson(scope: BookScope, artifactVersionId: string): string | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT content_json FROM artifact_versions
      WHERE owner_id=? AND book_id=? AND artifact_version_id=?`)
      .get(scope.ownerId, scope.bookId, artifactVersionId) as { content_json: string } | undefined;
    return row?.content_json;
  }

  public activeChain(scope: BookScope, input: {
    artifactVersionId: string;
    eventChapterOutlineVersionId: string;
    eventChapterSequenceVersionId: string;
    eventId: string;
    eventVersionId: string;
    volumePlanVersionId: string;
  }): PlanningChainRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT vv.content_json AS volume_content_json,vv.version AS volume_version,
        ev.content_json AS event_content_json,ev.version AS event_version,
        sv.content_json AS sequence_content_json,sv.version AS sequence_version,o.planned_content_json
      FROM event_chapter_outline_versions ov
      JOIN event_chapter_outlines o ON o.event_chapter_outline_id=ov.event_chapter_outline_id
        AND o.owner_id=ov.owner_id AND o.book_id=ov.book_id
      JOIN event_chapter_sequences s ON s.event_chapter_sequence_id=o.event_chapter_sequence_id
        AND s.owner_id=o.owner_id AND s.book_id=o.book_id
      JOIN event_chapter_sequence_versions sv ON sv.event_chapter_sequence_version_id=ov.sequence_version_id
        AND sv.owner_id=ov.owner_id AND sv.book_id=ov.book_id
      JOIN story_event_versions ev ON ev.story_event_version_id=ov.event_version_id
        AND ev.owner_id=ov.owner_id AND ev.book_id=ov.book_id
      JOIN volume_plan_versions vv ON vv.volume_plan_version_id=ov.volume_plan_version_id
        AND vv.owner_id=ov.owner_id AND vv.book_id=ov.book_id
      JOIN creation_workflow_states w ON w.owner_id=ov.owner_id AND w.book_id=ov.book_id
      WHERE ov.owner_id=? AND ov.book_id=? AND ov.artifact_version_id=?
        AND ov.event_chapter_outline_version_id=? AND ov.sequence_version_id=?
        AND o.event_id=? AND ov.event_version_id=? AND ov.volume_plan_version_id=? AND ov.status='frozen'
        AND o.status IN ('frozen','settled') AND o.active_version_id=ov.event_chapter_outline_version_id
        AND s.status IN ('active','completed') AND s.active_version_id=ov.sequence_version_id
        AND sv.status='active' AND ev.status='active' AND vv.status='active'
        AND w.active_event_id=o.event_id AND w.active_event_version_id=ov.event_version_id
        AND w.active_volume_plan_version_id=ov.volume_plan_version_id
        AND w.stage IN ('next_chapters_ready','manuscript_in_progress','waiting_for_author','chapter_settlement_in_progress')
      LIMIT 1`).get(scope.ownerId, scope.bookId, input.artifactVersionId,
        input.eventChapterOutlineVersionId, input.eventChapterSequenceVersionId, input.eventId,
        input.eventVersionId, input.volumePlanVersionId) as PlanningChainRow | undefined;
  }
  public historicalChain(scope: BookScope, input: {
    artifactVersionId: string;
    eventChapterOutlineVersionId: string;
    eventChapterSequenceVersionId: string;
    eventId: string;
    eventVersionId: string;
    volumePlanVersionId: string;
  }): PlanningChainRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT vv.content_json AS volume_content_json,vv.version AS volume_version,
        ev.content_json AS event_content_json,ev.version AS event_version,
        sv.content_json AS sequence_content_json,sv.version AS sequence_version,o.planned_content_json
      FROM event_chapter_outline_versions ov
      JOIN event_chapter_outlines o ON o.event_chapter_outline_id=ov.event_chapter_outline_id
        AND o.owner_id=ov.owner_id AND o.book_id=ov.book_id
      JOIN event_chapter_sequence_versions sv ON sv.event_chapter_sequence_version_id=ov.sequence_version_id
        AND sv.owner_id=ov.owner_id AND sv.book_id=ov.book_id
      JOIN story_event_versions ev ON ev.story_event_version_id=ov.event_version_id
        AND ev.owner_id=ov.owner_id AND ev.book_id=ov.book_id
      JOIN volume_plan_versions vv ON vv.volume_plan_version_id=ov.volume_plan_version_id
        AND vv.owner_id=ov.owner_id AND vv.book_id=ov.book_id
      WHERE ov.owner_id=? AND ov.book_id=? AND ov.artifact_version_id=?
        AND ov.event_chapter_outline_version_id=? AND ov.sequence_version_id=?
        AND o.event_id=? AND ov.event_version_id=? AND ov.volume_plan_version_id=?
        AND ov.status IN ('frozen','superseded')
      LIMIT 1`).get(scope.ownerId, scope.bookId, input.artifactVersionId,
        input.eventChapterOutlineVersionId, input.eventChapterSequenceVersionId, input.eventId,
        input.eventVersionId, input.volumePlanVersionId) as PlanningChainRow | undefined;
  }
}
