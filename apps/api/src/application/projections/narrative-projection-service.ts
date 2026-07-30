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
        const content = parseRecord(outline.content_json);
        const goal = readableText(content.goal);
        const beats = readableList(content.beats);
        const hook = readableText(content.hook);
        const emotionalArc = readableList(content.emotionalArc ?? content.emotion);
        const subplots = readableList(content.subplots ?? content.subplot);
        const informationGaps = readableList(content.informationGaps ?? content.informationGap);
        this.insert(scope, 'mainline', 'planned', outline.chapter_number, book.canon_revision, compact({
          title: readableText(content.title),
          goal,
          beats
        }), [outline.artifact_version_id], now);
        this.insert(scope, 'hook', 'planned', outline.chapter_number, book.canon_revision, compact({
          hook,
          status: hook === null ? '待补充标注' : null
        }), [outline.artifact_version_id], now);
        this.insert(scope, 'emotion', 'planned', outline.chapter_number, book.canon_revision, emotionalArc.length > 0
          ? { emotionalArc }
          : { status: '待补充标注', planningBasis: [goal, ...beats].filter((value): value is string => value !== null).slice(0, 4) },
        [outline.artifact_version_id], now);
        this.insert(scope, 'subplot', 'planned', outline.chapter_number, book.canon_revision, subplots.length > 0
          ? { subplots }
          : { status: '待补充标注', planningBasis: beats.slice(0, 4) },
        [outline.artifact_version_id], now);
        this.insert(scope, 'information_gap', 'planned', outline.chapter_number, book.canon_revision, informationGaps.length > 0
          ? { openQuestions: informationGaps }
          : compact({
              status: hook === null ? '待补充标注' : '由章末钩子承载',
              openQuestions: hook === null ? [] : [hook]
            }),
        [outline.artifact_version_id], now);
      }
      for (const chapter of chapters.filter((candidate) => candidate.settlement_status === 'settled' && candidate.state_json !== null)) {
        const state = parseRecord(chapter.state_json!);
        const quality = chapter.scores_json === null ? {} : parseRecord(chapter.scores_json);
        const experience = childRecord(quality.experience);
        const factReview = childRecord(quality.fact);
        const literary = childRecord(quality.literary);
        const experienceSummary = readableText(experience.summary);
        const factSummary = readableText(factReview.summary);
        const literarySummary = readableText(literary.summary);
        const experienceScores = childRecord(experience.scores);
        const emotionalScores = compact({
          emotionalFulfillment: finiteNumber(experienceScores.emotionalFulfillment),
          overallExperience: finiteNumber(experienceScores.overallExperience)
        });
        const developments = factDevelopments(factReview.factCandidates);
        const informationIssues = [
          ...readableIssues(experience.issues),
          ...readableIssues(factReview.issues),
          ...readableIssues(literary.issues)
        ].filter((issue) => /信息差|悬念|未知|留白|歧义/u.test(issue.type));
        const endingExcerpt = tailExcerpt(state.endingExcerpt);
        const sources = [chapter.chapter_id];
        this.insert(scope, 'mainline', 'actual', chapter.chapter_number, book.canon_revision, compact({
          chapterTitle: chapter.title,
          summary: factSummary ?? readableText(state.chapterSummary) ?? '本章已定稿，尚未形成独立剧情摘要。'
        }), sources, now);
        this.insert(scope, 'hook', 'actual', chapter.chapter_number, book.canon_revision, compact({
          endingExcerpt,
          hookStrength: finiteNumber(experienceScores.hookStrength),
          status: endingExcerpt === null ? '待补充分析' : null
        }), sources, now);
        this.insert(scope, 'emotion', 'actual', chapter.chapter_number, book.canon_revision, compact({
          summary: experienceSummary ?? literarySummary ?? '本章已定稿，审校资料尚未形成独立情绪总结。',
          scores: Object.keys(emotionalScores).length > 0 ? emotionalScores : null
        }), sources, now);
        this.insert(scope, 'subplot', 'actual', chapter.chapter_number, book.canon_revision, developments.length > 0
          ? { developments }
          : { status: '待补充分析', basis: factSummary ?? '本章尚无可单独识别的人物或势力支线事实。' },
        sources, now);
        this.insert(scope, 'information_gap', 'actual', chapter.chapter_number, book.canon_revision, compact({
          openQuestions: informationIssues.map((issue) => issue.evidence).slice(0, 6),
          endingSituation: endingExcerpt,
          status: informationIssues.length === 0 && endingExcerpt === null ? '待补充分析' : null
        }), sources, now);
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

function parseRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return childRecord(parsed);
}

function childRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readableText(value: unknown, maximum = 420): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum)}……`;
}

function readableList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = readableText(item, 280);
    return text === null ? [] : [text];
  }).slice(0, 12);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => (
    value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)
  )));
}

function tailExcerpt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.length <= 420 ? normalized : `……${normalized.slice(-420)}`;
}

function factDevelopments(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = childRecord(item);
    const entityType = readableText(record.entityType, 40);
    if (entityType === null || !['character', 'organization', 'location', 'event'].includes(entityType)) return [];
    const subject = readableText(record.subjectName, 80);
    const detail = readableText(record.value, 220);
    if (subject === null || detail === null) return [];
    return [{ subject, entityType, detail }];
  }).slice(0, 8);
}

function readableIssues(value: unknown): Array<{ type: string; evidence: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = childRecord(item);
    const type = readableText(record.issueType, 80);
    const evidence = readableText(record.evidence, 280);
    return type === null || evidence === null ? [] : [{ type, evidence }];
  }).slice(0, 16);
}
