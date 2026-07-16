import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export interface ChapterRecord {
  chapterId: string;
  volumeId: string;
  chapterNumber: number;
  title: string;
  planStatus: string;
  generationStatus: string;
  settlementStatus: string;
  currentManuscriptVersionId: string | null;
  canonManuscriptVersionId: string | null;
}

interface ChapterRow {
  chapter_id: string;
  volume_id: string;
  chapter_number: number;
  title: string;
  plan_status: string;
  generation_status: string;
  settlement_status: string;
  current_manuscript_version_id: string | null;
  canon_manuscript_version_id: string | null;
}

export interface ManuscriptInput {
  manuscriptVersionId: string;
  chapterId: string;
  parentVersionId?: string | null;
  authorAgentId: string;
  modelProvider: string;
  modelId: string;
  sourceTaskId: string;
  fileId: string;
  contentHash: string;
  wordCount: number;
  status?: 'draft' | 'candidate' | 'under_review' | 'approved';
}

export class ChapterCatalogService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public createVolume(scope: BookScope, volumeNumber: number, title: string): string {
    assertBookScope(scope);
    const volumeId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO volumes (volume_id, owner_id, book_id, volume_number, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(volumeId, scope.ownerId, scope.bookId, volumeNumber, title, now, now);
    return volumeId;
  }

  public createChapter(scope: BookScope, volumeId: string, chapterNumber: number, title: string): ChapterRecord {
    assertBookScope(scope);
    const volume = this.database.prepare(`
      SELECT 1 FROM volumes WHERE volume_id = ? AND owner_id = ? AND book_id = ?
    `).get(volumeId, scope.ownerId, scope.bookId);
    if (volume === undefined) throw new Error('卷不存在或不属于当前书籍');
    const chapterId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO chapters (
        chapter_id, owner_id, book_id, volume_id, chapter_number, title,
        plan_status, generation_status, settlement_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'planned', 'not_started', 'unsettled', ?, ?)
    `).run(chapterId, scope.ownerId, scope.bookId, volumeId, chapterNumber, title, now, now);
    return this.requireChapter(scope, chapterId);
  }

  public registerManuscript(scope: BookScope, input: ManuscriptInput): void {
    assertBookScope(scope);
    this.requireChapter(scope, input.chapterId);
    const now = this.clock.now().toISOString();
    const status = input.status ?? 'candidate';
    this.database.prepare(`
      INSERT INTO manuscript_versions (
        manuscript_version_id, owner_id, book_id, chapter_id, parent_version_id,
        author_agent_id, model_provider, model_id, source_task_id, file_id,
        content_hash, word_count, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.manuscriptVersionId, scope.ownerId, scope.bookId, input.chapterId,
      input.parentVersionId ?? null, input.authorAgentId, input.modelProvider,
      input.modelId, input.sourceTaskId, input.fileId, input.contentHash,
      input.wordCount, status, now
    );
    this.database.prepare(`
      UPDATE chapters SET current_manuscript_version_id = ?, generation_status = 'completed',
        updated_at = ?, version = version + 1 WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
    `).run(input.manuscriptVersionId, now, input.chapterId, scope.ownerId, scope.bookId);
  }

  public selectManuscript(scope: BookScope, chapterId: string, manuscriptVersionId: string): void {
    this.requireChapter(scope, chapterId);
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE manuscript_versions SET status = 'approved', confirmed_at = ?
      WHERE manuscript_version_id = ? AND chapter_id = ? AND owner_id = ? AND book_id = ?
        AND status IN ('draft', 'candidate', 'under_review', 'approved')
    `).run(now, manuscriptVersionId, chapterId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new Error('候选正文不存在或状态不可选定');
    this.database.prepare(`
      UPDATE chapters SET current_manuscript_version_id = ?, updated_at = ?, version = version + 1
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
    `).run(manuscriptVersionId, now, chapterId, scope.ownerId, scope.bookId);
  }

  public requireChapter(scope: BookScope, chapterId: string): ChapterRecord {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT * FROM chapters WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
    `).get(chapterId, scope.ownerId, scope.bookId) as ChapterRow | undefined;
    if (row === undefined) throw new Error('章节不存在或越权');
    return mapChapter(row);
  }

  public list(scope: BookScope): ChapterRecord[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`
      SELECT * FROM chapters WHERE owner_id = ? AND book_id = ? ORDER BY chapter_number
    `).all(scope.ownerId, scope.bookId) as unknown as ChapterRow[];
    return rows.map(mapChapter);
  }
}

function mapChapter(row: ChapterRow): ChapterRecord {
  return {
    chapterId: row.chapter_id,
    volumeId: row.volume_id,
    chapterNumber: row.chapter_number,
    title: row.title,
    planStatus: row.plan_status,
    generationStatus: row.generation_status,
    settlementStatus: row.settlement_status,
    currentManuscriptVersionId: row.current_manuscript_version_id,
    canonManuscriptVersionId: row.canon_manuscript_version_id
  };
}
