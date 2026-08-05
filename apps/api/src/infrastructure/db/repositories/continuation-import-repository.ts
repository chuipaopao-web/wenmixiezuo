import type { DatabaseSync } from 'node:sqlite';
import type { RoleKey } from '../../../domain/roles.js';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export type ContinuationImportStatus = 'parsed' | 'importing' | 'ready' | 'failed' | 'cancelled';
export type ContinuationImportChapterStatus = 'preview' | 'excluded' | 'chapter_created' | 'manuscript_registered' | 'imported';

export interface ContinuationImportRow {
  continuation_import_id: string;
  owner_id: string;
  book_id: string;
  source_name: string;
  source_relative_path: string;
  source_hash: string;
  parser_version: string;
  status: ContinuationImportStatus;
  source_character_count: number;
  included_chapter_count: number;
  imported_chapter_count: number;
  last_completed_ordinal: number;
  attempt_count: number;
  warnings_json: string;
  active_task_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
}

export interface ContinuationImportChapterRow {
  continuation_import_chapter_id: string;
  continuation_import_id: string;
  owner_id: string;
  book_id: string;
  ordinal: number;
  detected_title: string;
  edited_title: string;
  content_start: number;
  content_end: number;
  content_hash: string;
  character_count: number;
  included: number;
  status: ContinuationImportChapterStatus;
  target_chapter_number: number | null;
  target_chapter_id: string | null;
  target_manuscript_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ContinuationAnalysisStatus = 'pending' | 'analyzing' | 'ready' | 'failed';

export interface ContinuationBaselineRow {
  baseline_id: string;
  continuation_import_id: string;
  owner_id: string;
  book_id: string;
  status: ContinuationAnalysisStatus;
  analyzed_chapter_count: number;
  total_chapter_count: number;
  summary_text: string | null;
  structured_json: string;
  active_task_id: string | null;
  canon_revision: number;
  attempt_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ContinuationChapterAnalysisRow {
  analysis_id: string;
  continuation_import_id: string;
  continuation_import_chapter_id: string;
  owner_id: string;
  book_id: string;
  chapter_id: string;
  manuscript_version_id: string;
  status: ContinuationAnalysisStatus;
  summary_text: string | null;
  structured_json: string;
  source_hash: string;
  model_snapshot_id: string | null;
  agent_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ContinuationAnalysisAgentRow {
  agent_id: string;
  model_snapshot_id: string;
  provider: string;
  model_id: string;
  role_key: RoleKey;
}

export interface ReverseChapterOutlineArtifactRow {
  artifact_id: string;
  active_version_id: string;
  content_json: string;
}

export class ContinuationImportRepository {
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

  public assertBookExists(scope: BookScope): void {
    assertBookScope(scope);
    const row = this.database.prepare('SELECT 1 FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId);
    if (row === undefined) throw new Error('书籍不存在或越权');
  }

  public hasChapters(scope: BookScope): boolean {
    assertBookScope(scope);
    return this.database.prepare('SELECT 1 FROM chapters WHERE owner_id = ? AND book_id = ? LIMIT 1')
      .get(scope.ownerId, scope.bookId) !== undefined;
  }

  public hasActiveChapterTask(scope: BookScope): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM tasks WHERE owner_id = ? AND book_id = ? AND chapter_id IS NOT NULL
      AND status IN ('pending','queued','working','waiting_confirmation','paused','blocked','interrupted') LIMIT 1`)
      .get(scope.ownerId, scope.bookId) !== undefined;
  }

  public hasUnrelatedChapter(scope: BookScope, importId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM chapters c WHERE c.owner_id = ? AND c.book_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM continuation_import_chapters i
        WHERE i.continuation_import_id = ? AND i.owner_id = c.owner_id AND i.book_id = c.book_id
          AND i.target_chapter_id = c.chapter_id
      ) LIMIT 1`).get(scope.ownerId, scope.bookId, importId) !== undefined;
  }

  public firstVolumeId(scope: BookScope): string | null {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT volume_id FROM volumes WHERE owner_id = ? AND book_id = ?
      ORDER BY volume_number LIMIT 1`).get(scope.ownerId, scope.bookId) as { volume_id: string } | undefined;
    return row?.volume_id ?? null;
  }

  public manuscriptExists(scope: BookScope, manuscriptVersionId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM manuscript_versions
      WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ?`)
      .get(manuscriptVersionId, scope.ownerId, scope.bookId) !== undefined;
  }

  public chapterSettlement(scope: BookScope, chapterId: string): { status: string; canonManuscriptVersionId: string | null } | null {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT settlement_status, canon_manuscript_version_id FROM chapters
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
      .get(chapterId, scope.ownerId, scope.bookId) as { settlement_status: string; canon_manuscript_version_id: string | null } | undefined;
    return row === undefined ? null : { status: row.settlement_status, canonManuscriptVersionId: row.canon_manuscript_version_id };
  }

  public findBySourceHash(scope: BookScope, sourceHash: string): ContinuationImportRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM continuation_imports
      WHERE owner_id = ? AND book_id = ? AND source_hash = ?`)
      .get(scope.ownerId, scope.bookId, sourceHash) as ContinuationImportRow | undefined;
  }

  public latest(scope: BookScope): ContinuationImportRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM continuation_imports
      WHERE owner_id = ? AND book_id = ? ORDER BY updated_at DESC, continuation_import_id DESC LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as ContinuationImportRow | undefined;
  }

  public insertImport(scope: BookScope, row: {
    importId: string; sourceName: string; sourceRelativePath: string; sourceHash: string; parserVersion: string;
    sourceCharacterCount: number; warningsJson: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO continuation_imports (
      continuation_import_id, owner_id, book_id, source_name, source_relative_path, source_hash,
      parser_version, status, source_character_count, warnings_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'parsed', ?, ?, ?, ?)`)
      .run(row.importId, scope.ownerId, scope.bookId, row.sourceName, row.sourceRelativePath, row.sourceHash,
        row.parserVersion, row.sourceCharacterCount, row.warningsJson, row.now, row.now);
  }

  public insertChapter(scope: BookScope, row: {
    importChapterId: string; importId: string; ordinal: number; detectedTitle: string; contentStart: number;
    contentEnd: number; contentHash: string; characterCount: number; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO continuation_import_chapters (
      continuation_import_chapter_id, continuation_import_id, owner_id, book_id, ordinal,
      detected_title, edited_title, content_start, content_end, content_hash, character_count,
      included, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'preview', ?, ?)`)
      .run(row.importChapterId, row.importId, scope.ownerId, scope.bookId, row.ordinal,
        row.detectedTitle, row.detectedTitle, row.contentStart, row.contentEnd, row.contentHash,
        row.characterCount, row.now, row.now);
  }

  public requireImport(scope: BookScope, importId: string): ContinuationImportRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM continuation_imports
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ?`)
      .get(importId, scope.ownerId, scope.bookId) as ContinuationImportRow | undefined;
  }

  public chapters(scope: BookScope, importId: string): ContinuationImportChapterRow[] {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM continuation_import_chapters
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ? ORDER BY ordinal`)
      .all(importId, scope.ownerId, scope.bookId) as unknown as ContinuationImportChapterRow[];
  }

  public baseline(scope: BookScope, importId: string): ContinuationBaselineRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM continuation_baselines
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ?`)
      .get(importId, scope.ownerId, scope.bookId) as ContinuationBaselineRow | undefined;
  }

  public latestReadyBaseline(scope: BookScope): ContinuationBaselineRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM continuation_baselines
      WHERE owner_id = ? AND book_id = ? AND status = 'ready'
      ORDER BY updated_at DESC, baseline_id DESC LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as ContinuationBaselineRow | undefined;
  }

  public chapterAnalyses(scope: BookScope, importId: string): ContinuationChapterAnalysisRow[] {
    assertBookScope(scope);
    return this.database.prepare(`SELECT a.* FROM continuation_chapter_analyses a
      JOIN continuation_import_chapters c ON c.continuation_import_chapter_id = a.continuation_import_chapter_id
      WHERE a.continuation_import_id = ? AND a.owner_id = ? AND a.book_id = ? ORDER BY c.ordinal`)
      .all(importId, scope.ownerId, scope.bookId) as unknown as ContinuationChapterAnalysisRow[];
  }

  public reverseChapterOutlineArtifact(
    scope: BookScope,
    importChapterId: string
  ): ReverseChapterOutlineArtifactRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT a.artifact_id, a.active_version_id, v.content_json
      FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
        AND json_extract(v.content_json, '$.reverseOutlineSchema') = 'reverse_chapter_outline_v1'
        AND json_extract(v.content_json, '$.sourceImportChapterId') = ?
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, importChapterId) as ReverseChapterOutlineArtifactRow | undefined;
  }

  public settingAgent(scope: BookScope): { agent_id: string; model_snapshot_id: string } | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id
      FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND r.role_key = 'setting'
      ORDER BY a.created_at, a.agent_id LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { agent_id: string; model_snapshot_id: string } | undefined;
  }

  public analysisAgent(scope: BookScope, agentId: string, modelSnapshotId: string): ContinuationAnalysisAgentRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT a.agent_id, m.model_snapshot_id, m.provider, m.model_id, r.role_key
      FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = ? AND m.owner_id = a.owner_id AND m.book_id = a.book_id
      WHERE a.agent_id = ? AND a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND r.role_key = 'setting'
    `).get(modelSnapshotId, agentId, scope.ownerId, scope.bookId) as ContinuationAnalysisAgentRow | undefined;
  }

  public activeBudgetId(scope: BookScope): string | null {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT budget_id FROM budgets
      WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
    return row?.budget_id ?? null;
  }

  public beginAnalysis(scope: BookScope, input: {
    baselineId: string; importId: string; taskId: string; totalChapterCount: number; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO continuation_baselines (
      baseline_id, continuation_import_id, owner_id, book_id, status, total_chapter_count,
      active_task_id, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, 1, ?, ?)
    ON CONFLICT(owner_id, book_id, continuation_import_id) DO UPDATE SET
      status = 'pending', active_task_id = excluded.active_task_id,
      total_chapter_count = excluded.total_chapter_count,
      attempt_count = continuation_baselines.attempt_count + 1,
      error_message = NULL, completed_at = NULL, updated_at = excluded.updated_at`)
      .run(input.baselineId, input.importId, scope.ownerId, scope.bookId, input.totalChapterCount,
        input.taskId, input.now, input.now);
  }

  public markBaselineAnalyzing(scope: BookScope, importId: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE continuation_baselines SET status = 'analyzing', updated_at = ?
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ? AND status IN ('pending','analyzing')`)
      .run(now, importId, scope.ownerId, scope.bookId);
  }

  public saveChapterAnalysis(scope: BookScope, input: {
    analysisId: string; importId: string; importChapterId: string; chapterId: string;
    manuscriptVersionId: string; summary: string; structuredJson: string; sourceHash: string;
    modelSnapshotId: string; agentId: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO continuation_chapter_analyses (
      analysis_id, continuation_import_id, continuation_import_chapter_id, owner_id, book_id,
      chapter_id, manuscript_version_id, status, summary_text, structured_json, source_hash,
      model_snapshot_id, agent_id, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, book_id, continuation_import_id, continuation_import_chapter_id) DO UPDATE SET
      status = 'ready', summary_text = excluded.summary_text, structured_json = excluded.structured_json,
      source_hash = excluded.source_hash, model_snapshot_id = excluded.model_snapshot_id,
      agent_id = excluded.agent_id, error_message = NULL, updated_at = excluded.updated_at,
      completed_at = excluded.completed_at`)
      .run(input.analysisId, input.importId, input.importChapterId, scope.ownerId, scope.bookId,
        input.chapterId, input.manuscriptVersionId, input.summary, input.structuredJson, input.sourceHash,
        input.modelSnapshotId, input.agentId, input.now, input.now, input.now);
    this.database.prepare(`UPDATE continuation_baselines SET analyzed_chapter_count = (
      SELECT COUNT(*) FROM continuation_chapter_analyses
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ? AND status = 'ready'
    ), updated_at = ? WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ?`)
      .run(input.importId, scope.ownerId, scope.bookId, input.now, input.importId, scope.ownerId, scope.bookId);
  }

  public markBaselineReady(scope: BookScope, importId: string, summary: string, structuredJson: string, canonRevision: number, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE continuation_baselines SET status = 'ready', summary_text = ?,
      structured_json = ?, analyzed_chapter_count = total_chapter_count, active_task_id = NULL,
      canon_revision = ?, error_message = NULL, completed_at = ?, updated_at = ?
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ? AND status IN ('pending','analyzing')`)
      .run(summary, structuredJson, canonRevision, now, now, importId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new Error('续写资料基线状态已经变化');
  }

  public markBaselineFailed(scope: BookScope, importId: string, message: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE continuation_baselines SET status = 'failed', active_task_id = NULL,
      error_message = ?, updated_at = ? WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ?`)
      .run(message.slice(0, 500), now, importId, scope.ownerId, scope.bookId);
  }

  public applyConfirmation(scope: BookScope, importId: string, updates: Array<{
    importChapterId: string; title: string; included: boolean;
  }>, now: string): void {
    assertBookScope(scope);
    for (const update of updates) {
      const result = this.database.prepare(`UPDATE continuation_import_chapters SET edited_title = ?, included = ?,
        status = CASE WHEN ? = 1 THEN CASE WHEN status = 'excluded' THEN 'preview' ELSE status END ELSE 'excluded' END,
        updated_at = ? WHERE continuation_import_chapter_id = ? AND continuation_import_id = ?
          AND owner_id = ? AND book_id = ? AND status IN ('preview','excluded')`)
        .run(update.title, update.included ? 1 : 0, update.included ? 1 : 0, now,
          update.importChapterId, importId, scope.ownerId, scope.bookId);
      if (result.changes !== 1) throw new Error('导入章节预览已经变化，请重新载入');
    }
  }

  public beginAttempt(scope: BookScope, importId: string, includedCount: number, taskId: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE continuation_imports SET status = 'importing',
      included_chapter_count = ?, attempt_count = attempt_count + 1, active_task_id = ?,
      error_code = NULL, error_message = NULL, confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ? AND status IN ('parsed','failed','importing')`)
      .run(includedCount, taskId, now, now, importId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new Error('导入状态不能确认');
  }

  public markChapterCreated(scope: BookScope, importChapterId: string, chapterNumber: number, chapterId: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE continuation_import_chapters SET status = 'chapter_created', target_chapter_number = ?,
      target_chapter_id = ?, updated_at = ? WHERE continuation_import_chapter_id = ? AND owner_id = ? AND book_id = ?
        AND status = 'preview'`).run(chapterNumber, chapterId, now, importChapterId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new Error('导入章节创建检查点已经变化');
  }

  public markManuscriptRegistered(scope: BookScope, importChapterId: string, manuscriptVersionId: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE continuation_import_chapters SET status = 'manuscript_registered',
      target_manuscript_version_id = ?, updated_at = ? WHERE continuation_import_chapter_id = ?
        AND owner_id = ? AND book_id = ? AND status = 'chapter_created'`)
      .run(manuscriptVersionId, now, importChapterId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new Error('导入正文登记检查点已经变化');
  }

  public markImported(scope: BookScope, importId: string, importChapterId: string, ordinal: number, now: string): void {
    assertBookScope(scope);
    this.runInTransaction(() => {
      const result = this.database.prepare(`UPDATE continuation_import_chapters SET status = 'imported', updated_at = ?
        WHERE continuation_import_chapter_id = ? AND continuation_import_id = ? AND owner_id = ? AND book_id = ?
          AND status = 'manuscript_registered'`).run(now, importChapterId, importId, scope.ownerId, scope.bookId);
      if (result.changes !== 1) throw new Error('导入章节检查点状态已经变化');
      this.database.prepare(`UPDATE continuation_imports SET imported_chapter_count = (
          SELECT COUNT(*) FROM continuation_import_chapters WHERE continuation_import_id = ?
            AND owner_id = ? AND book_id = ? AND status = 'imported'
        ), last_completed_ordinal = MAX(last_completed_ordinal, ?), updated_at = ?
        WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ?`)
        .run(importId, scope.ownerId, scope.bookId, ordinal, now, importId, scope.ownerId, scope.bookId);
    });
  }

  public markReady(scope: BookScope, importId: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE continuation_imports SET status = 'ready', active_task_id = NULL,
      error_code = NULL, error_message = NULL, completed_at = ?, updated_at = ?
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ? AND status = 'importing'`)
      .run(now, now, importId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new Error('导入完成状态已经变化');
  }

  public markFailed(scope: BookScope, importId: string, errorCode: string, message: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE continuation_imports SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
      WHERE continuation_import_id = ? AND owner_id = ? AND book_id = ? AND status = 'importing'`)
      .run(errorCode, message.slice(0, 500), now, importId, scope.ownerId, scope.bookId);
  }

  public markTaskFailed(scope: BookScope, taskId: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE tasks SET status = 'failed', error_code = 'CONTINUATION_IMPORT_FAILED',
      current_phase = 'failed', updated_at = ? WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'pending'`)
      .run(now, taskId, scope.ownerId, scope.bookId);
  }
}
