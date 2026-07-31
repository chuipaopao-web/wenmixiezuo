import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export type NarrativeProjectionType = 'emotion' | 'mainline' | 'subplot' | 'hook' | 'information_gap';

type ProjectionTrack = 'planned' | 'actual';

interface ProjectionDraft {
  type: NarrativeProjectionType;
  track: ProjectionTrack;
  order: number;
  content: Record<string, unknown>;
  sourceIds: string[];
}

interface ChapterOutlineRow {
  chapter_number: number;
  content_json: string;
  artifact_version_id: string;
}

interface ChapterQualityRow {
  chapter_id: string;
  chapter_number: number;
  scores_json: string | null;
}

interface PlanningArtifactRow {
  artifact_type: 'master_outline';
  title: string;
  content_json: string;
  artifact_version_id: string;
}

interface StageSettlementRow {
  stage_settlement_id: string;
  stage_key: string;
  chapter_start: number;
  chapter_end: number;
  irreversible_results_json: string;
  open_threads_json: string;
  knowledge_changes_json: string;
}

interface CommitmentRow {
  narrative_commitment_id: string;
  commitment_type: string;
  title: string;
  description: string;
  opened_chapter: number;
  status: string;
  resolved_chapter: number | null;
}

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

    const outlines = this.database.prepare(`
      SELECT json_extract(v.content_json, '$.chapterNumber') AS chapter_number, v.content_json, v.artifact_version_id
      FROM artifact_versions v JOIN artifacts a ON a.artifact_id = v.artifact_id
      WHERE v.owner_id = ? AND v.book_id = ? AND a.artifact_type = 'chapter_outline' AND v.status = 'selected'
      ORDER BY CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER)
    `).all(scope.ownerId, scope.bookId) as unknown as ChapterOutlineRow[];
    const planningArtifacts = this.database.prepare(`
      SELECT a.artifact_type, a.title, v.content_json, v.artifact_version_id
      FROM artifact_versions v JOIN artifacts a ON a.artifact_id = v.artifact_id
      WHERE v.owner_id = ? AND v.book_id = ? AND a.artifact_type = 'master_outline'
        AND v.status = 'selected'
      ORDER BY v.version DESC
    `).all(scope.ownerId, scope.bookId) as unknown as PlanningArtifactRow[];
    const chapters = this.database.prepare(`
      SELECT c.chapter_id, c.chapter_number, q.scores_json
      FROM chapters c
      LEFT JOIN chapter_quality_metrics q ON q.quality_metric_id = (
        SELECT q2.quality_metric_id
        FROM chapter_quality_metrics q2
        WHERE q2.owner_id = c.owner_id AND q2.book_id = c.book_id
          AND q2.chapter_id = c.chapter_id
        ORDER BY q2.created_at DESC, q2.rowid DESC
        LIMIT 1
      )
      WHERE c.owner_id = ? AND c.book_id = ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number
    `).all(scope.ownerId, scope.bookId) as unknown as ChapterQualityRow[];
    const settlements = this.database.prepare(`
      SELECT stage_settlement_id, stage_key, chapter_start, chapter_end, irreversible_results_json,
        open_threads_json, knowledge_changes_json
      FROM stage_settlements
      WHERE owner_id = ? AND book_id = ? AND stage_type = 'story_arc' AND status = 'active'
      ORDER BY chapter_start, chapter_end, version
    `).all(scope.ownerId, scope.bookId) as unknown as StageSettlementRow[];
    const commitments = this.database.prepare(`
      SELECT nc.narrative_commitment_id, nc.commitment_type, nc.title, nc.description,
        nc.opened_chapter, nc.status,
        COALESCE(rc.chapter_number, rmc.chapter_number) AS resolved_chapter
      FROM narrative_commitments nc
      LEFT JOIN chapters rc ON rc.owner_id = nc.owner_id AND rc.book_id = nc.book_id
        AND rc.chapter_id = nc.resolution_source_id
      LEFT JOIN manuscript_versions rmv ON rmv.owner_id = nc.owner_id AND rmv.book_id = nc.book_id
        AND rmv.manuscript_version_id = nc.resolution_source_id
      LEFT JOIN chapters rmc ON rmc.owner_id = rmv.owner_id AND rmc.book_id = rmv.book_id
        AND rmc.chapter_id = rmv.chapter_id
      WHERE nc.owner_id = ? AND nc.book_id = ?
        AND nc.commitment_type IN ('promise', 'foreshadowing', 'mystery', 'threat')
      ORDER BY nc.opened_chapter, nc.created_at, nc.narrative_commitment_id
    `).all(scope.ownerId, scope.bookId) as unknown as CommitmentRow[];

    const drafts: ProjectionDraft[] = [
      ...plannedMainline(planningArtifacts),
      ...plannedChapterProjections(outlines),
      ...actualStageProjections(settlements),
      ...actualEmotionProjections(chapters),
      ...actualCommitmentProjections(commitments)
    ];
    const now = this.clock.now().toISOString();
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`DELETE FROM narrative_projections WHERE owner_id = ? AND book_id = ?`)
        .run(scope.ownerId, scope.bookId);
      for (const draft of drafts) {
        this.insert(scope, draft.type, draft.track, draft.order, book.canon_revision, draft.content, draft.sourceIds, now);
      }
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return drafts.length;
  }

  public list(scope: BookScope, projectionType?: NarrativeProjectionType): unknown[] {
    assertBookScope(scope);
    if (projectionType === undefined) {
      return this.database.prepare(`
        SELECT * FROM narrative_projections
        WHERE owner_id = ? AND book_id = ?
        ORDER BY projection_type, track, chapter_number
      `).all(scope.ownerId, scope.bookId);
    }
    return this.database.prepare(`
      SELECT * FROM narrative_projections
      WHERE owner_id = ? AND book_id = ? AND projection_type = ?
      ORDER BY track, chapter_number
    `).all(scope.ownerId, scope.bookId, projectionType);
  }

  private insert(
    scope: BookScope,
    type: NarrativeProjectionType,
    track: ProjectionTrack,
    order: number,
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
    `).run(
      this.ids.next(), scope.ownerId, scope.bookId, type, track, order,
      canonRevision, JSON.stringify(content), JSON.stringify(sourceIds), now
    );
  }
}

function plannedMainline(rows: PlanningArtifactRow[]): ProjectionDraft[] {
  const master = rows.find((row) => row.artifact_type === 'master_outline');
  if (master === undefined) return [];
  const content = parseRecord(master.content_json);
  return recordArray(content.majorStages).flatMap((stage, index) => {
    const title = readableText(stage.title, 100) ?? `阶段${index + 1}`;
    const chapterRange = childRecord(stage.chapterRange);
    const mainline = childRecord(stage.mainline);
    const isStageMasterV2 = content.outlineSchema === 'stage_master_v2';
    const encounter = readableText(mainline.encounter, 180);
    const resolution = readableText(mainline.resolution, 180);
    const stageResult = readableText(mainline.result, 180);
    const legacyGoal = readableText(stage.goal, 240);
    const legacyTurningPoint = readableText(stage.turningPoint, 180);
    const legacyResult = readableText(stage.result, 180);
    const summary = isStageMasterV2
      ? conciseSummary([encounter, resolution, stageResult])
      : conciseSummary([legacyGoal, legacyTurningPoint, legacyResult]);
    if (summary === null) return [];
    return [{
      type: 'mainline' as const,
      track: 'planned' as const,
      order: index + 1,
      content: compact({
        scopeLabel: title,
        summary,
        chapterStart: positiveInteger(isStageMasterV2 ? chapterRange.start : stage.chapterStart),
        chapterEnd: positiveInteger(isStageMasterV2 ? chapterRange.end : stage.chapterEnd),
        result: isStageMasterV2
          ? readableText(stage.stageSummary, 180) ?? stageResult
          : legacyResult
      }),
      sourceIds: [master.artifact_version_id]
    }];
  });
}

function plannedChapterProjections(outlines: ChapterOutlineRow[]): ProjectionDraft[] {
  return outlines.flatMap((outline) => {
    const content = parseRecord(outline.content_json);
    const chapter = positiveInteger(outline.chapter_number);
    if (chapter === null) return [];
    const scopeLabel = `第${chapter}章`;
    const sourceIds = [outline.artifact_version_id];
    const drafts: ProjectionDraft[] = [];

    const emotionFlow = emotionList(content.emotionalArc ?? content.emotionFlow ?? content.emotion);
    if (emotionFlow.length > 0) {
      drafts.push({
        type: 'emotion', track: 'planned', order: chapter, sourceIds,
        content: compact({
          scopeLabel,
          emotionFlow,
          baseline: readableText(content.baseline ?? content.payoffTone ?? content.tone, 40)
        })
      });
    }

    const subplotSummary = summarizedItems(content.subplots ?? content.subplot);
    if (subplotSummary !== null) {
      drafts.push({
        type: 'subplot', track: 'planned', order: chapter, sourceIds,
        content: { scopeLabel, summary: subplotSummary }
      });
    }

    const hookItems = [
      ...hookItemsFromValue(content.hook, '钩子', chapter),
      ...hookItemsFromValue(content.foreshadowings ?? content.foreshadowing, '伏笔', chapter)
    ];
    if (hookItems.length > 0) {
      drafts.push({
        type: 'hook', track: 'planned', order: chapter, sourceIds,
        content: { scopeLabel, items: hookItems }
      });
    }

    const informationItems = informationGapItems(content.informationGaps ?? content.informationGap);
    if (informationItems.length > 0) {
      drafts.push({
        type: 'information_gap', track: 'planned', order: chapter, sourceIds,
        content: { scopeLabel, items: informationItems }
      });
    }
    return drafts;
  });
}

function actualStageProjections(rows: StageSettlementRow[]): ProjectionDraft[] {
  return rows.flatMap((row, index) => {
    const scopeLabel = rangeLabel(row.chapter_start, row.chapter_end);
    const sourceIds = [row.stage_settlement_id];
    const drafts: ProjectionDraft[] = [];
    const results = textList(parseJson(row.irreversible_results_json), 4, 180);
    const summary = conciseSummary(results);
    if (summary !== null) {
      drafts.push({
        type: 'mainline', track: 'actual', order: index + 1, sourceIds,
        content: {
          scopeLabel,
          summary,
          chapterStart: row.chapter_start,
          chapterEnd: row.chapter_end
        }
      });
    }
    const subplotSummary = explicitSubplotSummary(parseJson(row.open_threads_json));
    if (subplotSummary !== null) {
      drafts.push({
        type: 'subplot', track: 'actual', order: row.chapter_start, sourceIds,
        content: { scopeLabel, parentScopeLabel: scopeLabel, summary: subplotSummary }
      });
    }
    const gaps = informationGapItems(parseJson(row.knowledge_changes_json));
    if (gaps.length > 0) {
      drafts.push({
        type: 'information_gap', track: 'actual', order: row.chapter_start, sourceIds,
        content: { scopeLabel, items: gaps }
      });
    }
    return drafts;
  });
}

function actualEmotionProjections(chapters: ChapterQualityRow[]): ProjectionDraft[] {
  return chapters.flatMap((chapter) => {
    if (chapter.scores_json === null) return [];
    const quality = parseRecord(chapter.scores_json);
    const experience = childRecord(quality.experience);
    const emotionFlow = emotionList(experience.emotionFlow ?? experience.emotionalArc ?? experience.emotion)
      .concat(extractEmotionFlow(readableText(experience.summary, 360)));
    const uniqueFlow = [...new Set(emotionFlow)].slice(0, 12);
    if (uniqueFlow.length === 0) return [];
    return [{
      type: 'emotion',
      track: 'actual',
      order: chapter.chapter_number,
      sourceIds: [chapter.chapter_id],
      content: compact({
        scopeLabel: `第${chapter.chapter_number}章`,
        emotionFlow: uniqueFlow,
        baseline: readableText(experience.baseline ?? experience.payoffTone, 40)
          ?? extractBaseline(readableText(experience.summary, 360))
      })
    }];
  });
}

function actualCommitmentProjections(rows: CommitmentRow[]): ProjectionDraft[] {
  const grouped = new Map<number, CommitmentRow[]>();
  for (const row of rows) grouped.set(row.opened_chapter, [...(grouped.get(row.opened_chapter) ?? []), row]);
  return [...grouped.entries()].map(([chapter, commitments]) => ({
    type: 'hook',
    track: 'actual',
    order: chapter,
    sourceIds: commitments.map((item) => item.narrative_commitment_id),
    content: {
      scopeLabel: `第${chapter}章`,
      items: commitments.map((item) => compact({
        kind: item.commitment_type === 'foreshadowing' ? '伏笔' : '钩子',
        summary: readableText(item.description, 220) ?? readableText(item.title, 120) ?? '已记录',
        status: commitmentStatus(item.status),
        openedChapter: item.opened_chapter,
        resolvedChapter: positiveInteger(item.resolved_chapter)
      }))
    }
  }));
}

function hookItemsFromValue(value: unknown, kind: '钩子' | '伏笔', chapter: number): Array<Record<string, unknown>> {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    const record = childRecord(item);
    const summary = readableText(typeof item === 'string' ? item : record.summary ?? record.description ?? record.title, 220);
    if (summary === null) return [];
    return [{ kind, summary, status: '章纲计划', openedChapter: chapter }];
  }).slice(0, 8);
}

function informationGapItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = childRecord(item);
    const summary = readableText(record.summary ?? record.description ?? record.content, 220);
    const knowers = textList(record.knowers ?? record.knownBy, 8, 80);
    const unaware = textList(record.unaware ?? record.unknownTo, 8, 80);
    const readerState = readableText(record.readerState ?? record.readerKnowledge, 80);
    if (summary === null || knowers.length === 0 || unaware.length === 0 || readerState === null) return [];
    return [{ summary, knowers, unaware, readerState }];
  }).slice(0, 8);
}

function explicitSubplotSummary(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const summaries = value.flatMap((item) => {
    const record = childRecord(item);
    const kind = readableText(record.kind ?? record.type, 40);
    if (kind === null || !/^(?:subplot|side_plot|支线)$/iu.test(kind)) return [];
    const summary = readableText(record.summary ?? record.description ?? record.title, 180);
    return summary === null ? [] : [summary];
  });
  return conciseSummary(summaries);
}

function summarizedItems(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [];
  const summaries = values.flatMap((item) => {
    if (typeof item === 'string') {
      const text = readableText(item, 180);
      return text === null ? [] : [text];
    }
    const record = childRecord(item);
    const text = readableText(record.summary ?? record.description ?? record.title, 180);
    return text === null ? [] : [text];
  });
  return conciseSummary(summaries);
}

function emotionList(value: unknown): string[] {
  if (Array.isArray(value)) return textList(value, 12, 40);
  const text = readableText(value, 160);
  if (text === null) return [];
  return text.split(/\s*(?:→|->|—|–|-|、|，|,)\s*/u).map((item) => item.trim()).filter(Boolean).slice(0, 12);
}

function extractEmotionFlow(summary: string | null): string[] {
  if (summary === null) return [];
  const quoted = /情绪曲线(?:呈|为|是|：|:)?\s*[「“"]([^」”"]{2,100})[」”"]/u.exec(summary);
  if (quoted?.[1] !== undefined) return emotionList(quoted[1]);
  const arrowSequence = /情绪曲线(?:呈|为|是|：|:)?\s*((?:[\p{Script=Han}A-Za-z]{1,8}\s*(?:→|->|—|–|-)\s*){1,7}[\p{Script=Han}A-Za-z]{1,8})/u.exec(summary);
  return arrowSequence?.[1] === undefined ? [] : emotionList(arrowSequence[1]);
}

function extractBaseline(summary: string | null): string | null {
  if (summary === null) return null;
  const match = /(?:整体|本章)?(?:兑现|基调|爽虐基调)(?:为|是|：|:)?\s*([爽平虐](?:转[爽平虐])?)/u.exec(summary);
  return match?.[1] ?? null;
}

function commitmentStatus(status: string): string {
  const labels: Record<string, string> = {
    open: '待兑现',
    due: '待回收',
    fulfilled: '已回收',
    violated: '已逾期',
    retired: '已归档'
  };
  return labels[status] ?? '已记录';
}

function rangeLabel(start: number, end: number): string {
  return start === end ? `第${start}章` : `第${start}—${end}章`;
}

function conciseSummary(parts: Array<string | null>): string | null {
  const text = parts.filter((item): item is string => item !== null && item.trim().length > 0)
    .map((item) => item.replace(/[。；\s]+$/u, '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('；');
  if (text.length === 0) return null;
  const normalized = `${text}。`;
  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 358)}……`;
}

function parseRecord(value: string): Record<string, unknown> {
  return childRecord(parseJson(value));
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function childRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map(childRecord).filter((item) => Object.keys(item).length > 0);
}

function textList(value: unknown, limit: number, maximum: number): string[] {
  if (!Array.isArray(value)) {
    const single = readableText(value, maximum);
    return single === null ? [] : [single];
  }
  return value.flatMap((item) => {
    const text = readableText(item, maximum);
    return text === null ? [] : [text];
  }).slice(0, limit);
}

function readableText(value: unknown, maximum = 420): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return null;
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(1, maximum - 2))}……`;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => (
    value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)
  )));
}
