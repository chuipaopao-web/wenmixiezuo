import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { resolveInside, sha256File } from '../../infrastructure/files/file-utils.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig, thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import {
  ContinuationImportRepository,
  type ContinuationAnalysisAgentRow,
  type ContinuationChapterAnalysisRow,
  type ContinuationImportChapterRow
} from '../../infrastructure/db/repositories/continuation-import-repository.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ContextPackService } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence } from '../tasks/task-service.js';
import { ArtifactService } from '../artifacts/artifact-service.js';

type AnalysisAgentRow = ContinuationAnalysisAgentRow;

type AnalysisDocument = Record<string, unknown>;

const sourceChunkCharacters = 4_200;
const analysisMaxOutputTokens = 8_192;
const analysisReservationTokens = 20_000;
const maximumSummaryCharacters = 360;
const maximumOutlineTextCharacters = 500;
const listLimits = {
  characters: 24,
  events: 24,
  locations: 16,
  relations: 20,
  rules: 20,
  resources: 20,
  openThreads: 16,
  resolvedThreads: 16,
  styleEvidence: 12,
  conflicts: 12,
  unknowns: 12
} as const;

/**
 * Builds a rebuildable continuation baseline from immutable imported chapters.
 * Import and analysis are deliberately separate failure domains: this service
 * never updates manuscript versions, chapter settlement, or canon.
 */
export class ContinuationAnalysisPipelineService {
  private readonly repository: ContinuationImportRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}))
  ) {
    this.repository = new ContinuationImportRepository(database);
  }

  public async executeClaimed(
    scope: BookScope,
    taskId: string,
    workerId: string,
    leaseFence?: TaskLeaseFence
  ): Promise<{ importId: string; analyzedChapterCount: number }> {
    assertBookScope(scope);
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    const claimed = tasks.require(scope, taskId);
    if (
      claimed.taskType !== 'continuation_analysis' || claimed.status !== 'working' || claimed.leaseOwner !== workerId
      || claimed.assignedAgentId === null
      || (leaseFence !== undefined
        && (claimed.leaseToken !== leaseFence.leaseToken || claimed.currentAttemptNo !== leaseFence.attemptNo))
    ) {
      throw new Error('续写资料整理任务未由指定 Worker 持有');
    }
    const brief = parseBrief(claimed.brief);
    this.repository.markBaselineAnalyzing(scope, brief.importId, this.clock.now().toISOString());
    try {
      const importRecord = this.repository.requireImport(scope, brief.importId);
      if (importRecord === undefined || importRecord.status !== 'ready') {
        throw new Error('已有正文尚未完成导入，不能开始资料整理');
      }
      const agent = this.requireAgent(scope, claimed.assignedAgentId, brief.modelSnapshotId);
      const bookRecord = new BookRepository(this.database).require(scope);
      const book = { canon_revision: bookRecord.canonRevision, positioning_version: bookRecord.positioningVersion };
      const sourcePath = resolveInside(this.dataDir, importRecord.source_relative_path);
      if (sha256File(sourcePath) !== importRecord.source_hash) throw new Error('已有正文原始文件缺失或校验失败');
      const source = readFileSync(sourcePath, 'utf8');
      const chapters = this.repository.chapters(scope, brief.importId)
        .filter((chapter) => chapter.included === 1 && chapter.status === 'imported')
        .sort((left, right) => left.ordinal - right.ordinal);
      if (chapters.length === 0) throw new Error('没有可整理的已导入章节');

      for (const [index, chapter] of chapters.entries()) {
        tasks.heartbeat(scope, taskId, workerId, 120_000, leaseFence);
        const existing = this.repository.chapterAnalyses(scope, brief.importId)
          .find((candidate) => candidate.continuation_import_chapter_id === chapter.continuation_import_chapter_id);
        if (existing?.status === 'ready' && existing.source_hash === chapter.content_hash) {
          tasks.checkpoint(scope, taskId, workerId, 'analyzing', {
            importId: brief.importId,
            analyzedChapterCount: index + 1,
            totalChapterCount: chapters.length,
            lastCompletedOrdinal: chapter.ordinal
          }, leaseFence);
          continue;
        }
        const content = source.slice(chapter.content_start, chapter.content_end);
        if (sha256(content) !== chapter.content_hash) throw new Error(`第 ${chapter.ordinal} 章原文校验失败`);
        const documents: AnalysisDocument[] = [];
        const chunks = splitBounded(content, sourceChunkCharacters);
        for (const [chunkIndex, chunk] of chunks.entries()) {
          documents.push(await this.analyzeChunk({
            scope,
            taskId,
            chapter,
            chunk,
            chunkIndex,
            chunkCount: chunks.length,
            agent,
            book,
            leaseFence: leaseFence ?? {
              leaseToken: claimed.leaseToken ?? '',
              attemptNo: claimed.currentAttemptNo
            }
          }));
        }
        const merged = mergeAnalysisDocuments(documents, chapter.edited_title, chapter.ordinal);
        this.repository.saveChapterAnalysis(scope, {
          analysisId: existing?.analysis_id ?? this.ids.next(),
          importId: brief.importId,
          importChapterId: chapter.continuation_import_chapter_id,
          chapterId: requireText(chapter.target_chapter_id, '导入章节缺少章节引用'),
          manuscriptVersionId: requireText(chapter.target_manuscript_version_id, '导入章节缺少正文版本引用'),
          summary: stringValue(merged.summary).slice(0, maximumSummaryCharacters),
          structuredJson: JSON.stringify(merged),
          sourceHash: chapter.content_hash,
          modelSnapshotId: agent.model_snapshot_id,
          agentId: agent.agent_id,
          now: this.clock.now().toISOString()
        });
        tasks.checkpoint(scope, taskId, workerId, 'analyzing', {
          importId: brief.importId,
          analyzedChapterCount: index + 1,
          totalChapterCount: chapters.length,
          lastCompletedOrdinal: chapter.ordinal
        }, leaseFence);
      }

      const analyses = this.repository.chapterAnalyses(scope, brief.importId)
        .filter((analysis) => analysis.status === 'ready');
      const baseline = buildBaseline(analyses, chapters);
      this.projectReadyReverseChapterOutlines(scope, brief.importId);
      this.repository.markBaselineReady(
        scope,
        brief.importId,
        baseline.summary,
        JSON.stringify(baseline),
        book.canon_revision,
        this.clock.now().toISOString()
      );
      tasks.complete(scope, taskId, workerId, leaseFence);
      return { importId: brief.importId, analyzedChapterCount: analyses.length };
    } catch (error) {
      this.repository.markBaselineFailed(scope, brief.importId, safeMessage(error), this.clock.now().toISOString());
      try { tasks.fail(scope, taskId, workerId, 'CONTINUATION_ANALYSIS_FAILED', leaseFence); } catch { /* preserve root cause */ }
      throw error;
    }
  }

  /**
   * Backfills author-visible reverse chapter outlines from an already-ready
   * continuation analysis. This deliberately performs no model call, so old
   * imports created before the projection existed can be repaired safely.
   */
  public projectReadyReverseChapterOutlines(scope: BookScope, importId: string): number {
    assertBookScope(scope);
    const chapters = this.repository.chapters(scope, importId)
      .filter((chapter) => chapter.included === 1 && chapter.status === 'imported')
      .sort((left, right) => left.ordinal - right.ordinal);
    const analyses = this.repository.chapterAnalyses(scope, importId)
      .filter((analysis) => analysis.status === 'ready');
    this.projectReverseChapterOutlines(scope, importId, analyses, chapters);
    return analyses.length;
  }

  /**
   * Publishes the rebuildable reverse outlines as author-visible planning
   * references.  The immutable imported manuscript remains authoritative;
   * these selected artifacts only make the derived chapter structure usable
   * by the planning UI and by later bounded setting discussions.
   *
   * A retry after interruption is idempotent by import-chapter identity.  If
   * the source analysis changed, a new immutable artifact version is selected
   * instead of silently overwriting the previous projection.
   */
  private projectReverseChapterOutlines(
    scope: BookScope,
    importId: string,
    analyses: ContinuationChapterAnalysisRow[],
    chapters: ContinuationImportChapterRow[]
  ): void {
    const artifacts = new ArtifactService(this.database, this.ids, this.clock);
    for (const chapter of chapters) {
      const analysis = analyses.find((candidate) =>
        candidate.continuation_import_chapter_id === chapter.continuation_import_chapter_id
      );
      if (analysis === undefined) continue;
      const stored = parseStoredDocument(analysis.structured_json);
      const reverseOutline = isRecord(stored.reverseOutline) ? stored.reverseOutline : {};
      const ending = isRecord(reverseOutline.ending) ? reverseOutline.ending : {};
      const chapterNumber = chapter.target_chapter_number ?? chapter.ordinal;
      const title = chapter.edited_title.trim() || `第${chapterNumber}章`;
      const content: Record<string, unknown> = {
        chapterNumber,
        title,
        goal: stringValue(reverseOutline.chapterGoal),
        beats: Array.isArray(reverseOutline.plotBeats) ? reverseOutline.plotBeats : [],
        hook: stringValue(ending.hook),
        reverseOutlineSchema: 'reverse_chapter_outline_v1',
        sourceKind: 'author_existing_manuscript',
        planningAuthority: 'derived_reference',
        sourceImportId: importId,
        sourceImportChapterId: chapter.continuation_import_chapter_id,
        sourceAnalysisId: analysis.analysis_id,
        sourceManuscriptVersionId: chapter.target_manuscript_version_id,
        sourceHash: chapter.content_hash,
        modelSnapshotId: analysis.model_snapshot_id,
        summary: stringValue(stored.summary),
        openingState: stringValue(reverseOutline.openingState),
        cast: Array.isArray(reverseOutline.cast) ? reverseOutline.cast : [],
        centralConflict: stringValue(reverseOutline.centralConflict),
        emotionalArc: Array.isArray(reverseOutline.emotionalArc) ? reverseOutline.emotionalArc : [],
        payoffOrPressure: Array.isArray(reverseOutline.payoffOrPressure) ? reverseOutline.payoffOrPressure : [],
        threadActions: Array.isArray(reverseOutline.threadActions) ? reverseOutline.threadActions : [],
        descriptionFocus: Array.isArray(reverseOutline.descriptionFocus) ? reverseOutline.descriptionFocus : [],
        ending: {
          result: stringValue(ending.result),
          hook: stringValue(ending.hook),
          nextChapterInterface: stringValue(ending.nextChapterInterface)
        }
      };
      const existing = this.repository.reverseChapterOutlineArtifact(
        scope,
        chapter.continuation_import_chapter_id
      );
      if (existing === undefined) {
        const created = artifacts.create(scope, 'chapter_outline', `${title} · 反向章纲`, content, 'candidate');
        artifacts.select(scope, created.artifactId, created.artifactVersionId);
        continue;
      }
      if (existing.content_json === JSON.stringify(content)) continue;
      const updated = artifacts.addVersion(scope, existing.artifact_id, content, existing.active_version_id);
      artifacts.select(scope, existing.artifact_id, updated.artifactVersionId);
    }
  }

  private requireAgent(scope: BookScope, agentId: string, modelSnapshotId: string): AnalysisAgentRow {
    const row = this.repository.analysisAgent(scope, agentId, modelSnapshotId);
    if (row === undefined) throw new Error('设定整理成员或模型快照不可用');
    return row;
  }

  private async analyzeChunk(input: {
    scope: BookScope;
    taskId: string;
    chapter: ContinuationImportChapterRow;
    chunk: string;
    chunkIndex: number;
    chunkCount: number;
    agent: AnalysisAgentRow;
    book: { canon_revision: number; positioning_version: number };
    leaseFence: TaskLeaseFence;
  }): Promise<AnalysisDocument> {
    const budgetId = this.repository.activeBudgetId(input.scope);
    if (budgetId === null) throw new Error('本书没有可用预算，无法整理已有正文');
    const contextPack = new ContextPackService(this.database, this.ids, this.clock).build(input.scope, {
      taskId: input.taskId,
      agentId: input.agent.agent_id,
      chapterId: input.chapter.target_chapter_id,
      canonRevision: input.book.canon_revision,
      positioningVersion: input.book.positioning_version,
      tokenBudget: 5_000,
      characterBudget: 6_000,
      policyVersion: 'continuation-analysis-v1',
      hardSources: [{
        sourceType: 'author_existing_manuscript',
        sourceId: `${input.chapter.target_manuscript_version_id}:chunk:${input.chunkIndex + 1}`,
        content: input.chunk,
        reason: '作者确认导入的不可变章节原文；提炼结论必须可回溯到这里',
        priority: 100,
        version: input.chapter.content_hash
      }],
      optionalSources: []
    });
    const adapter = this.modelAdapters.resolve(input.agent.provider, input.agent.model_id, 'discussion', input.agent.role_key);
    const budgets = new BudgetService(this.database, this.ids, this.clock);
    const invoke = async (prompt: string, phaseSuffix: string): Promise<string> => {
      const requestId = this.ids.next();
      const reservationId = budgets.reserve(input.scope, budgetId, requestId, analysisReservationTokens + thinkingTokenAllowance(input.agent.model_id), 0);
      const result = await new ModelCallService(this.database, this.clock, budgets).execute(input.scope, {
        requestId,
        taskId: input.taskId,
        phaseKey: `continuation:${input.chapter.ordinal}:chunk-${input.chunkIndex + 1}:attempt-${input.leaseFence.attemptNo}:${phaseSuffix}`,
        agentId: input.agent.agent_id,
        modelSnapshotId: input.agent.model_snapshot_id,
        provider: input.agent.provider,
        modelId: input.agent.model_id,
        input: prompt,
        parameters: JSON.stringify({ maxOutputTokens: analysisMaxOutputTokens, structuredOutput: true, cashFallbackAllowed: false }),
        reservationId,
        contextPackId: contextPack.contextPackId,
        leaseToken: input.leaseFence.leaseToken,
        attemptNo: input.leaseFence.attemptNo
      }, adapter, {
        requestId,
        taskId: input.taskId,
        ownerId: input.scope.ownerId,
        bookId: input.scope.bookId,
        agentId: input.agent.agent_id,
        prompt,
        maxOutputTokens: analysisMaxOutputTokens
      });
      return result.output;
    };

    const primaryPrompt = buildAnalysisPrompt(input.chapter, input.chunk, input.chunkIndex, input.chunkCount);
    try {
      return parseAnalysisOutput(await invoke(primaryPrompt, 'primary'));
    } catch (primaryError) {
      const compactPrompt = buildCompactAnalysisPrompt(input.chapter, input.chunk, input.chunkIndex, input.chunkCount);
      try {
        return parseAnalysisOutput(await invoke(compactPrompt, 'compact-retry-1'));
      } catch (retryError) {
        throw new Error(`正文提炼未返回完整结构：首次 ${safeMessage(primaryError)}；紧凑重试 ${safeMessage(retryError)}`);
      }
    }
  }
}

function buildAnalysisPrompt(
  chapter: ContinuationImportChapterRow,
  content: string,
  chunkIndex: number,
  chunkCount: number
): string {
  return JSON.stringify({
    operation: 'continuation_chapter_analysis_v1',
    instruction: [
      '你是设定与连续性整理员文姬。只提炼原文明确出现或可直接推出的内容，不续写，不补设定。',
      '输出一个JSON对象，不要Markdown。事实必须简洁；不确定内容放unknowns，冲突放conflicts。',
      '人物、事件、关系和规则尽量附带原文短证据。不得输出内部思维过程。'
    ],
    outputLimits: {
      instruction: 'Return one COMPLETE JSON object under 2600 Chinese characters. Emit summary and reverseOutline first. Every key is required; use empty arrays or empty strings when evidence is absent. Never repeat facts and never truncate JSON.',
      fieldOrder: ['summary', 'reverseOutline', 'characters', 'events', 'locations', 'relations', 'rules', 'resources', 'openThreads', 'resolvedThreads', 'styleEvidence', 'endingState', 'conflicts', 'unknowns'],
      characters: 4,
      events: 5,
      locations: 3,
      relations: 4,
      rules: 3,
      resources: 3,
      openThreads: 3,
      resolvedThreads: 3,
      styleEvidence: 3,
      plotBeats: 6,
      cast: 4,
      emotionalArc: 4,
      payoffOrPressure: 3,
      threadActions: 4,
      descriptionFocus: 3,
      conflicts: 3,
      unknowns: 3
    },
    chapter: { ordinal: chapter.ordinal, title: chapter.edited_title, chunk: chunkIndex + 1, chunkCount },
    requiredSchema: {
      summary: '本段发生了什么，最多180字',
      characters: [{ name: '姓名', identity: '身份', state: '当前状态', motivation: '动机', evidence: '短证据' }],
      events: [{ event: '事件', result: '结果', evidence: '短证据' }],
      locations: ['地点'],
      relations: [{ from: '人物/实体', to: '人物/实体', relation: '关系', evidence: '短证据' }],
      rules: [{ rule: '规则或限制', evidence: '短证据' }],
      resources: [{ owner: '持有者', item: '资源/道具/能力', state: '状态', evidence: '短证据' }],
      openThreads: ['尚未解决的问题或伏笔'],
      resolvedThreads: ['本段已解决事项'],
      styleEvidence: ['可观察的叙事或语言特征'],
      endingState: '本段结尾人物处境和未完成动作',
      reverseOutline: {
        chapterGoal: '本章实际完成的唯一剧情任务，不超过80字',
        openingState: '开章时已经成立的局面，不超过100字',
        plotBeats: [{ order: 1, action: '人物行动或事件推进', result: '造成的结果' }],
        cast: [{ name: '出场人物', chapterRole: '本章作用', objective: '本章目标', stateChange: '本章后的变化' }],
        centralConflict: '本章主要冲突，不超过120字',
        emotionalArc: ['2至5个实际情绪变化'],
        payoffOrPressure: ['已经发生的爽点、压力点或虐点；没有则空数组'],
        threadActions: [{ action: 'plant/advance/payoff', summary: '本章伏笔、钩子或线索动作' }],
        descriptionFocus: ['本章实际重点描写的对象或场面'],
        ending: {
          result: '章末已经形成的结果',
          hook: '章末钩子；没有则空字符串',
          nextChapterInterface: '下一章可直接承接的局面'
        }
      },
      conflicts: ['前后矛盾或疑似冲突'],
      unknowns: ['原文没有说明、不能猜测的事项']
    },
    content
  });
}

function buildCompactAnalysisPrompt(
  chapter: ContinuationImportChapterRow,
  content: string,
  chunkIndex: number,
  chunkCount: number
): string {
  return JSON.stringify({
    operation: 'continuation_chapter_analysis_compact_retry_v1',
    instruction: [
      '只提炼原文明示或可以直接推出的信息，不续写、不补设定。',
      '只输出一个完整 JSON 对象，不要 Markdown，不要解释，不要思维过程。',
      '总长度不超过 2200 个中文字符；任何资料不足的数组必须输出 []，字符串输出空字符串。',
      '先输出 summary 和 reverseOutline，再输出其余字段。宁可减少低价值事实，也绝不能截断 JSON。',
      '每条证据最多 24 个字；同一事实只出现一次。'
    ],
    chapter: { ordinal: chapter.ordinal, title: chapter.edited_title, chunk: chunkIndex + 1, chunkCount },
    requiredSchema: {
      summary: '本段剧情摘要，最多120字',
      reverseOutline: {
        chapterGoal: '本章实际完成的主要任务，最多60字',
        openingState: '开章局面，最多80字',
        plotBeats: [{ order: 1, action: '动作或事件', result: '结果' }],
        cast: [{ name: '人物', chapterRole: '作用', objective: '目标', stateChange: '变化' }],
        centralConflict: '主要冲突，最多80字',
        emotionalArc: ['情绪变化，最多4项'],
        payoffOrPressure: ['爽点、压力点或虐点，最多3项'],
        threadActions: [{ action: 'plant/advance/payoff', summary: '线索动作' }],
        descriptionFocus: ['重点描写对象，最多3项'],
        ending: { result: '章末结果', hook: '章末钩子或空字符串', nextChapterInterface: '下一章承接局面' }
      },
      characters: [{ name: '姓名', identity: '身份', state: '状态', motivation: '动机', evidence: '证据' }],
      events: [{ event: '事件', result: '结果', evidence: '证据' }],
      locations: ['地点'],
      relations: [{ from: '实体', to: '实体', relation: '关系', evidence: '证据' }],
      rules: [{ rule: '规则', evidence: '证据' }],
      resources: [{ owner: '持有者', item: '资源', state: '状态', evidence: '证据' }],
      openThreads: ['未解决事项'],
      resolvedThreads: ['已解决事项'],
      styleEvidence: ['叙事或语言特征'],
      endingState: '本段结尾处境',
      conflicts: ['矛盾或冲突'],
      unknowns: ['原文未说明事项']
    },
    hardLimits: {
      characters: 4,
      events: 5,
      locations: 3,
      relations: 4,
      rules: 3,
      resources: 3,
      openThreads: 3,
      resolvedThreads: 3,
      styleEvidence: 3,
      plotBeats: 6,
      cast: 4,
      conflicts: 3,
      unknowns: 3
    },
    content
  });
}

function parseBrief(parsed: Record<string, unknown>): { importId: string; modelSnapshotId: string } {
  if (typeof parsed.importId !== 'string' || typeof parsed.modelSnapshotId !== 'string') {
    throw new Error('续写资料整理任务参数不完整');
  }
  return { importId: parsed.importId, modelSnapshotId: parsed.modelSnapshotId };
}

function parseAnalysisOutput(output: string): AnalysisDocument {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('正文提炼结果不是有效JSON');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('正文提炼结果结构无效');
  const document = parsed as AnalysisDocument;
  if (typeof document.summary !== 'string' || document.summary.trim().length === 0) {
    throw new Error('正文提炼结果缺少章节摘要');
  }
  if (!isRecord(document.reverseOutline)) {
    throw new Error('正文提炼结果缺少反向章纲');
  }
  return document;
}

function mergeAnalysisDocuments(documents: AnalysisDocument[], title: string, ordinal: number): AnalysisDocument {
  return {
    chapterNumber: ordinal,
    title,
    summary: documents.map((document) => stringValue(document.summary)).filter(Boolean).join('；').slice(0, maximumSummaryCharacters),
    ...Object.fromEntries(Object.entries(listLimits).map(([key, limit]) => [key, mergeList(documents, key, limit)])),
    endingState: [...documents].reverse().map((document) => stringValue(document.endingState)).find(Boolean) ?? '',
    reverseOutline: mergeReverseOutline(documents, title, ordinal)
  };
}

function buildBaseline(rows: ContinuationChapterAnalysisRow[], chapters: ContinuationImportChapterRow[]): AnalysisDocument & { summary: string } {
  const documents = rows.map((row) => parseStoredDocument(row.structured_json));
  const chapterSummaries = rows.map((row) => {
    const chapter = chapters.find((candidate) => candidate.continuation_import_chapter_id === row.continuation_import_chapter_id);
    return { chapterNumber: chapter?.target_chapter_number ?? null, title: chapter?.edited_title ?? '', summary: row.summary_text ?? '' };
  });
  const chapterOutlines = rows.map((row, index) => {
    const chapter = chapters.find((candidate) => candidate.continuation_import_chapter_id === row.continuation_import_chapter_id);
    const stored = documents[index] ?? {};
    const outline = isRecord(stored.reverseOutline) ? stored.reverseOutline : {};
    return {
      chapterNumber: chapter?.target_chapter_number ?? null,
      title: chapter?.edited_title ?? '',
      ...outline
    };
  });
  const summary = chapterSummaries.slice(-8)
    .map((item) => `第${item.chapterNumber ?? '?'}章${item.title}：${item.summary}`)
    .join('\n')
    .slice(0, 2_400);
  return {
    summary,
    sourceKind: 'author_existing_manuscript',
    authority: 'derived_from_confirmed_manuscript',
    chapterCount: chapterSummaries.length,
    chapterSummaries,
    chapterOutlines,
    ...Object.fromEntries(Object.entries(listLimits).map(([key, limit]) => [key, mergeList(documents, key, limit * 4)])),
    endingState: [...documents].reverse().map((document) => stringValue(document.endingState)).find(Boolean) ?? ''
  };
}

function mergeReverseOutline(documents: AnalysisDocument[], title: string, ordinal: number): Record<string, unknown> {
  const outlines = documents.map((document) => isRecord(document.reverseOutline) ? document.reverseOutline : {});
  const endingRecords = outlines.map((outline) => isRecord(outline.ending) ? outline.ending : {});
  return {
    chapterNumber: ordinal,
    title,
    chapterGoal: firstText(outlines, 'chapterGoal'),
    openingState: firstText(outlines, 'openingState'),
    plotBeats: mergeNestedList(outlines, 'plotBeats', 12),
    cast: mergeNestedList(outlines, 'cast', 24),
    centralConflict: firstText(outlines, 'centralConflict'),
    emotionalArc: mergeNestedList(outlines, 'emotionalArc', 8),
    payoffOrPressure: mergeNestedList(outlines, 'payoffOrPressure', 8),
    threadActions: mergeNestedList(outlines, 'threadActions', 12),
    descriptionFocus: mergeNestedList(outlines, 'descriptionFocus', 8),
    ending: {
      result: lastText(endingRecords, 'result'),
      hook: lastText(endingRecords, 'hook'),
      nextChapterInterface: lastText(endingRecords, 'nextChapterInterface')
    }
  };
}

function mergeNestedList(documents: Array<Record<string, unknown>>, key: string, limit: number): unknown[] {
  const result: unknown[] = [];
  const seen = new Set<string>();
  for (const document of documents) {
    for (const value of Array.isArray(document[key]) ? document[key] as unknown[] : []) {
      const signature = JSON.stringify(value);
      if (seen.has(signature)) continue;
      seen.add(signature);
      result.push(value);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function firstText(documents: Array<Record<string, unknown>>, key: string): string {
  return documents.map((document) => stringValue(document[key])).find(Boolean)?.slice(0, maximumOutlineTextCharacters) ?? '';
}

function lastText(documents: Array<Record<string, unknown>>, key: string): string {
  return [...documents].reverse().map((document) => stringValue(document[key])).find(Boolean)?.slice(0, maximumOutlineTextCharacters) ?? '';
}

function mergeList(documents: AnalysisDocument[], key: string, limit: number): unknown[] {
  const result: unknown[] = [];
  const seen = new Set<string>();
  for (const document of documents) {
    const values = Array.isArray(document[key]) ? document[key] as unknown[] : [];
    for (const value of values) {
      const signature = JSON.stringify(value);
      if (!seen.has(signature)) {
        seen.add(signature);
        result.push(value);
      }
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function splitBounded(content: string, maximum: number): string[] {
  if (content.length <= maximum) return [content];
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(content.length, start + maximum);
    if (end < content.length) {
      const boundary = Math.max(content.lastIndexOf('\n', end), content.lastIndexOf('。', end));
      if (boundary > start + Math.floor(maximum * 0.65)) end = boundary + 1;
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

function parseStoredDocument(value: string): AnalysisDocument {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AnalysisDocument : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: string | null, message: string): string {
  if (value === null || value.length === 0) throw new Error(message);
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : '正文资料整理失败';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
