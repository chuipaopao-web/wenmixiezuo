import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export type ChapterRequestCount = 1 | 3 | 4 | 5;

export interface WritingReadiness {
  ready: boolean;
  chapterNumbers: number[];
  outlineVersionIds: Record<number, string>;
  missing: string[];
}

interface OutlineRow {
  artifact_version_id: string;
  chapter_number: number;
  source_decision_id: string | null;
}

export class WritingReadinessService {
  public constructor(private readonly database: DatabaseSync) {}

  public inspect(scope: BookScope, count: ChapterRequestCount): WritingReadiness {
    assertBookScope(scope);
    const book = this.database.prepare(`SELECT 1 FROM books WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .get(scope.ownerId, scope.bookId);
    if (book === undefined) throw new DomainError(errorCodes.bookNotFound, '书籍不存在、已归档或越权', {}, false, 404);
    const firstNumber = this.nextChapterNumber(scope);
    const chapterNumbers = Array.from({ length: count }, (_, index) => firstNumber + index);
    const missing: string[] = [];
    const planning = this.database.prepare(`
      SELECT stage, active_style_version_id, setting_baseline_version_id,
        master_outline_version_id, volume_outline_version_id
      FROM book_planning_states WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as {
      stage: string; active_style_version_id: string | null; setting_baseline_version_id: string | null;
      master_outline_version_id: string | null; volume_outline_version_id: string | null;
    } | undefined;
    if (planning === undefined) missing.push('planning_state');
    else {
      if (planning.active_style_version_id === null) missing.push('confirmed_style_baseline');
      if (planning.setting_baseline_version_id === null) missing.push('confirmed_setting_baseline');
      if (planning.master_outline_version_id === null) missing.push('confirmed_master_outline');
      if (planning.volume_outline_version_id === null) missing.push('confirmed_volume_outline');
      if (!['chapter_outline_ready', 'writing_enabled'].includes(planning.stage)) missing.push('planning_stage');
    }
    const expression = this.database.prepare(`SELECT status, narrative_person, viewpoint_distance
      FROM book_expression_profiles WHERE owner_id = ? AND book_id = ? AND status IN ('provisional', 'confirmed')
      ORDER BY version DESC LIMIT 1`).get(scope.ownerId, scope.bookId) as { status: string; narrative_person: string | null; viewpoint_distance: string | null } | undefined;
    if (expression?.status !== 'confirmed' || expression.narrative_person === null || expression.viewpoint_distance === null) {
      missing.push('confirmed_expression_viewpoint');
    }
    for (const type of ['creative_plan', 'story_bible', 'master_outline']) {
      const active = this.database.prepare(`
        SELECT 1 FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
        WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = ?
          AND a.status = 'active' AND v.status = 'selected'
        LIMIT 1
      `).get(scope.ownerId, scope.bookId, type);
      if (active === undefined) missing.push(type);
    }
    const outlineVersionIds: Record<number, string> = {};
    for (const chapterNumber of chapterNumbers) {
      const outline = this.database.prepare(`
        SELECT v.artifact_version_id,
          CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER) AS chapter_number,
          json_extract(v.content_json, '$.sourceDecisionId') AS source_decision_id
        FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
        WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
          AND a.status = 'active' AND v.status = 'selected'
          AND CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER) = ?
        ORDER BY v.created_at DESC LIMIT 1
      `).get(scope.ownerId, scope.bookId, chapterNumber) as OutlineRow | undefined;
      if (outline === undefined || outline.source_decision_id === null) {
        missing.push(`chapter_outline:${chapterNumber}`);
        continue;
      }
      const confirmed = this.database.prepare(`
        SELECT 1 FROM discussion_decisions
        WHERE decision_id = ? AND owner_id = ? AND book_id = ? AND boss_confirmed = 1
      `).get(outline.source_decision_id, scope.ownerId, scope.bookId);
      if (confirmed === undefined) {
        missing.push(`confirmed_outline:${chapterNumber}`);
        continue;
      }
      outlineVersionIds[chapterNumber] = outline.artifact_version_id;
    }
    return { ready: missing.length === 0, chapterNumbers, outlineVersionIds, missing };
  }

  public assertReady(scope: BookScope, count: ChapterRequestCount): WritingReadiness {
    const readiness = this.inspect(scope, count);
    if (!readiness.ready) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '创作资料尚未准备完成：请先与主编和相关成员讨论，并明确确认创作方案后再开写',
        { missing: readiness.missing, requestedChapterNumbers: readiness.chapterNumbers },
        false,
        409
      );
    }
    return readiness;
  }

  public outlineVersionId(scope: BookScope, chapterNumber: number): string {
    const row = this.database.prepare(`
      SELECT v.artifact_version_id FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      JOIN discussion_decisions d
        ON d.decision_id = json_extract(v.content_json, '$.sourceDecisionId')
       AND d.owner_id = v.owner_id AND d.book_id = v.book_id AND d.boss_confirmed = 1
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
        AND a.status = 'active' AND v.status = 'selected'
        AND CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER) = ?
      ORDER BY v.created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapterNumber) as { artifact_version_id: string } | undefined;
    if (row === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, `第${chapterNumber}章缺少老板确认的章纲`, { chapterNumber }, false, 409);
    }
    return row.artifact_version_id;
  }

  private nextChapterNumber(scope: BookScope): number {
    const settled = this.database.prepare(`
      SELECT COALESCE(MAX(chapter_number), 0) AS last
      FROM chapters WHERE owner_id = ? AND book_id = ? AND settlement_status = 'settled'
    `).get(scope.ownerId, scope.bookId) as { last: number };
    return settled.last + 1;
  }
}
