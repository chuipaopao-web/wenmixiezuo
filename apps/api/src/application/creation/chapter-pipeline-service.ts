import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { ArtifactService } from '../artifacts/artifact-service.js';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ChapterCatalogService } from '../chapters/chapter-catalog-service.js';
import { CanonService } from '../knowledge/canon-service.js';
import { ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import { MemoryService } from '../memory/memory-service.js';
import { TaskService } from '../tasks/task-service.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';
import {
  countNovelCharacters,
  DeterministicNovelCandidateBAdapter,
  DeterministicNovelReviewerAdapter,
  DeterministicNovelWriterAdapter,
  type StructuredReview
} from '../../infrastructure/models/deterministic-novel-models.js';
import type { ModelAdapter } from '../../infrastructure/models/model-adapter.js';
import { PromotionService } from '../../infrastructure/recovery/promotion-service.js';
import { WriterSelectionService, type WriterSelection } from './writer-selection-service.js';
import { CopyrightService } from '../copyright/copyright-service.js';

export type PipelinePhase = 'preflight' | 'context' | 'draft' | 'hard_check' | 'review' | 'rewrite' | 'facts' | 'settlement' | 'completed';

export interface PipelineResult {
  pipelineRunId: string;
  chapterId: string;
  taskId: string;
  status: 'paused' | 'completed';
  phase: PipelinePhase;
  manuscriptVersionId: string | null;
  rewriteCount: number;
}

interface PipelineRow {
  pipeline_run_id: string;
  chapter_id: string;
  task_id: string;
  writer_selection_id: string;
  writer_agent_id: string;
  writer_model_snapshot_id: string;
  reviewer_agent_id: string;
  reviewer_model_snapshot_id: string;
  outline_version_id: string | null;
  writing_contract_version_id: string | null;
  context_pack_id: string | null;
  current_manuscript_version_id: string | null;
  expected_canon_revision: number;
  expected_positioning_version: number;
  phase: PipelinePhase;
  rewrite_count: number;
  status: string;
}

interface ChapterRow { chapter_number: number; title: string; settlement_status: string }

export class ChapterPipelineService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public async executeClaimed(
    scope: BookScope,
    taskId: string,
    workerId: string,
    pauseAfterPhase?: PipelinePhase
  ): Promise<PipelineResult> {
    assertBookScope(scope);
    const task = this.database.prepare(`
      SELECT chapter_id, status, lease_owner FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?
    `).get(taskId, scope.ownerId, scope.bookId) as { chapter_id: string | null; status: string; lease_owner: string | null } | undefined;
    if (task === undefined || task.chapter_id === null || task.status !== 'working' || task.lease_owner !== workerId) {
      throw new Error('章节任务未由指定Worker持有');
    }
    let run = this.findOrCreateRun(scope, taskId, task.chapter_id);
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    try {
      while (run.phase !== 'completed') {
        const completedPhase = run.phase;
        run = await this.executePhase(scope, run);
        tasks.checkpoint(scope, taskId, workerId, run.phase, { completedPhase, pipelineRunId: run.pipeline_run_id, manuscriptVersionId: run.current_manuscript_version_id, rewriteCount: run.rewrite_count });
        if (pauseAfterPhase === completedPhase) {
          this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'paused', updated_at = ? WHERE pipeline_run_id = ?`)
            .run(this.clock.now().toISOString(), run.pipeline_run_id);
          tasks.requestPause(scope, taskId);
          tasks.pauseAtCheckpoint(scope, taskId, workerId);
          return this.mapResult(run, 'paused');
        }
      }
      this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'completed', updated_at = ? WHERE pipeline_run_id = ?`)
        .run(this.clock.now().toISOString(), run.pipeline_run_id);
      tasks.complete(scope, taskId, workerId);
      return this.mapResult(run, 'completed');
    } catch (error) {
      const now = this.clock.now().toISOString();
      const cancelRequested = (this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?`)
        .get(taskId, scope.ownerId, scope.bookId) as { cancel_requested: number } | undefined)?.cancel_requested === 1;
      const errorCode = cancelRequested ? 'TASK_CANCELLED' : error instanceof DomainError ? error.code : 'PIPELINE_FAILED';
      this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'failed', error_code = ?, updated_at = ? WHERE pipeline_run_id = ?`)
        .run(errorCode, now, run.pipeline_run_id);
      this.database.prepare(`
        UPDATE tasks SET status = ?, error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
          heartbeat_at = NULL, updated_at = ? WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ?
      `).run(cancelRequested ? 'cancelled' : 'failed', errorCode, now, taskId, scope.ownerId, scope.bookId, workerId);
      throw error;
    }
  }

  public requireRun(scope: BookScope, chapterId: string): PipelineResult {
    const row = this.database.prepare(`SELECT * FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, chapterId) as PipelineRow | undefined;
    if (row === undefined) throw new Error('章节流水线不存在或越权');
    return this.mapResult(row, row.status === 'completed' ? 'completed' : 'paused');
  }

  private async executePhase(scope: BookScope, run: PipelineRow): Promise<PipelineRow> {
    switch (run.phase) {
      case 'preflight': return this.preflight(scope, run);
      case 'context': return this.buildDraftContext(scope, run);
      case 'draft': return this.generateDraft(scope, run);
      case 'hard_check': return this.hardCheck(scope, run);
      case 'review': return this.review(scope, run);
      case 'rewrite': return this.rewrite(scope, run);
      case 'facts': return this.extractFacts(scope, run);
      case 'settlement': return this.settle(scope, run);
      case 'completed': return run;
    }
  }

  private preflight(scope: BookScope, run: PipelineRow): PipelineRow {
    new CopyrightService(this.database, this.ids, this.clock).validatePreGeneration(scope);
    const chapter = this.requireChapter(scope, run.chapter_id);
    if (chapter.settlement_status === 'settled') return this.advance(run, 'completed');
    const previous = this.database.prepare(`
      SELECT chapter_id, settlement_status FROM chapters
      WHERE owner_id = ? AND book_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapter.chapter_number) as { chapter_id: string; settlement_status: string } | undefined;
    if (previous !== undefined && previous.settlement_status !== 'settled') {
      throw new DomainError(errorCodes.chapterDependencyUnsettled, '前章尚未结算，当前章不能启动', { previousChapterId: previous.chapter_id }, false, 409);
    }
    const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
    if (book.canon_revision !== run.expected_canon_revision || book.positioning_version !== run.expected_positioning_version) {
      throw new DomainError(errorCodes.canonRevisionConflict, '流水线输入版本已经失效', { expectedCanonRevision: run.expected_canon_revision, actualCanonRevision: book.canon_revision }, false, 409);
    }
    const artifacts = new ArtifactService(this.database, this.ids, this.clock);
    const outline = artifacts.create(scope, 'chapter_outline', `第${chapter.chapter_number}章章纲`, {
      chapterNumber: chapter.chapter_number,
      goal: '沿线索进入新场景并留下可验证的章末钩子',
      beats: ['观察异常', '验证线索', '做出选择', '形成新钩子'],
      hook: '更高层的灯重新亮起'
    }, 'candidate');
    artifacts.select(scope, outline.artifactId, outline.artifactVersionId);
    const contract = artifacts.create(scope, 'writing_contract', `第${chapter.chapter_number}章写作契约`, {
      chapterId: run.chapter_id,
      pov: '第三人称限知',
      tense: '过去时叙事',
      targetWords: 2_900,
      hardConstraints: ['2500至3500字', '不得占位', '服从当前正史', '结尾保留具体钩子']
    }, 'candidate');
    artifacts.select(scope, contract.artifactId, contract.artifactVersionId);
    this.database.prepare(`
      UPDATE chapters SET plan_status = 'ready', generation_status = 'working', updated_at = ?
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
    `).run(this.clock.now().toISOString(), run.chapter_id, scope.ownerId, scope.bookId);
    this.database.prepare(`
      UPDATE chapter_pipeline_runs SET outline_version_id = ?, writing_contract_version_id = ?,
        phase = 'context', status = 'working', updated_at = ? WHERE pipeline_run_id = ?
    `).run(outline.artifactVersionId, contract.artifactVersionId, this.clock.now().toISOString(), run.pipeline_run_id);
    return this.reload(run.pipeline_run_id);
  }

  private buildDraftContext(scope: BookScope, run: PipelineRow): PipelineRow {
    if (run.outline_version_id === null || run.writing_contract_version_id === null) throw new Error('章纲或写作契约缺失');
    const artifacts = new ArtifactService(this.database, this.ids, this.clock);
    const outline = artifacts.requireVersion(scope, run.outline_version_id);
    const contract = artifacts.requireVersion(scope, run.writing_contract_version_id);
    const chapter = this.requireChapter(scope, run.chapter_id);
    const previous = this.database.prepare(`
      SELECT e.state_json FROM chapters c JOIN chapter_end_states e ON e.chapter_end_state_id = c.chapter_end_state_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number < ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapter.chapter_number) as { state_json: string } | undefined;
    const hardSources: ContextSource[] = [
      { sourceType: 'system_rule', sourceId: 'writing-safety-v1', content: '正文必须完整、原创、服从正史；不得静默覆盖旧版本；不得包含占位符。', reason: '系统与老板硬规则', priority: 100 },
      { sourceType: 'chapter_outline', sourceId: run.outline_version_id, content: JSON.stringify(outline.content), reason: '当前章纲', priority: 100, version: outline.version },
      { sourceType: 'writing_contract', sourceId: run.writing_contract_version_id, content: JSON.stringify(contract.content), reason: '当前写作契约', priority: 100, version: contract.version }
    ];
    if (previous !== undefined) hardSources.push({ sourceType: 'previous_chapter_end', sourceId: `previous:${chapter.chapter_number - 1}`, content: previous.state_json, reason: '前章结算硬状态', priority: 100 });
    const optionalSources = new MemoryService(this.database, this.ids, this.clock).listActive(scope, { canonRevision: run.expected_canon_revision })
      .slice(0, 12)
      .map((memory, index) => ({ sourceType: `memory:${memory.layer}`, sourceId: memory.memoryId, content: memory.content, reason: '与当前书籍相关的活动记忆', priority: 50 - index }));
    const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
      taskId: run.task_id,
      agentId: run.writer_agent_id,
      chapterId: run.chapter_id,
      canonRevision: run.expected_canon_revision,
      positioningVersion: run.expected_positioning_version,
      outlineVersionId: run.outline_version_id,
      writingContractVersionId: run.writing_contract_version_id,
      tokenBudget: 8_000,
      hardSources,
      optionalSources
    });
    this.database.prepare(`UPDATE chapter_pipeline_runs SET context_pack_id = ?, phase = 'draft', updated_at = ? WHERE pipeline_run_id = ?`)
      .run(pack.contextPackId, this.clock.now().toISOString(), run.pipeline_run_id);
    return this.reload(run.pipeline_run_id);
  }

  private async generateDraft(scope: BookScope, run: PipelineRow): Promise<PipelineRow> {
    if (run.context_pack_id === null) throw new Error('初稿上下文包缺失');
    const chapter = this.requireChapter(scope, run.chapter_id);
    const previous = this.database.prepare(`
      SELECT e.state_json FROM chapters c JOIN chapter_end_states e ON e.chapter_end_state_id = c.chapter_end_state_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number < ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapter.chapter_number) as { state_json: string } | undefined;
    const prompt = JSON.stringify({ operation: 'draft', chapterNumber: chapter.chapter_number, title: chapter.title, previousState: previous?.state_json ?? '故事刚刚开始' });
    const adapter: ModelAdapter = this.modelIdentity(run.writer_model_snapshot_id).modelId.includes('candidate-b')
      ? new DeterministicNovelCandidateBAdapter()
      : new DeterministicNovelWriterAdapter();
    const output = await this.executeModel(scope, run, 'draft', run.writer_agent_id, run.writer_model_snapshot_id, adapter, prompt, run.context_pack_id);
    const manuscriptVersionId = this.promoteManuscript(scope, run, output, null, adapter, 'candidate');
    this.database.prepare(`UPDATE chapter_pipeline_runs SET current_manuscript_version_id = ?, phase = 'hard_check', updated_at = ? WHERE pipeline_run_id = ?`)
      .run(manuscriptVersionId, this.clock.now().toISOString(), run.pipeline_run_id);
    return this.reload(run.pipeline_run_id);
  }

  private hardCheck(scope: BookScope, run: PipelineRow): PipelineRow {
    if (run.current_manuscript_version_id === null) throw new Error('硬检查缺少正文版本');
    const content = this.loadManuscript(scope, run.current_manuscript_version_id);
    const characterCount = countNovelCharacters(content);
    const checks = {
      fullImmutableVersion: true,
      length: { passed: characterCount >= 2_500 && characterCount <= 3_500, characterCount, minimum: 2_500, maximum: 3_500 },
      noPlaceholder: { passed: !/【|TODO|待补|占位/u.test(content) },
      hasHook: { passed: content.trim().length > 0 && /。|！|？/u.test(content.slice(-100)) }
    };
    const passed = checks.length.passed && checks.noPlaceholder.passed && checks.hasHook.passed;
    this.database.prepare(`
      INSERT INTO hard_check_results (
        hard_check_id, owner_id, book_id, chapter_id, manuscript_version_id,
        passed, checks_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(this.ids.next(), scope.ownerId, scope.bookId, run.chapter_id, run.current_manuscript_version_id, passed ? 1 : 0, JSON.stringify(checks), this.clock.now().toISOString());
    if (!passed) throw new DomainError(errorCodes.validation, '正文硬检查未通过', { checks }, false, 409);
    const copyright = new CopyrightService(this.database, this.ids, this.clock)
      .checkTargetAgainstAllSources(scope, 'manuscript', run.current_manuscript_version_id, content);
    if (copyright.decision !== 'pass') {
      throw new DomainError(errorCodes.copyrightBlocked, '正文版权检查未通过，必须重新设计', { copyright }, false, 409);
    }
    return this.advance(run, 'review');
  }

  private async review(scope: BookScope, run: PipelineRow): Promise<PipelineRow> {
    if (run.current_manuscript_version_id === null) throw new Error('审校缺少正文版本');
    new WriterSelectionService(this.database, this.ids, this.clock).assertDistinctModels(scope, this.selectionFromRun(run));
    const content = this.loadManuscript(scope, run.current_manuscript_version_id);
    const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
      taskId: run.task_id, agentId: run.reviewer_agent_id, chapterId: run.chapter_id,
      canonRevision: run.expected_canon_revision, positioningVersion: run.expected_positioning_version,
      tokenBudget: 10_000,
      hardSources: [{ sourceType: 'current_manuscript', sourceId: run.current_manuscript_version_id, content, reason: '当前完整正文', priority: 100 }],
      optionalSources: []
    });
    const adapter = new DeterministicNovelReviewerAdapter();
    const output = await this.executeModel(scope, run, `review-${run.rewrite_count + 1}`, run.reviewer_agent_id, run.reviewer_model_snapshot_id, adapter, JSON.stringify({ content }), pack.contextPackId);
    const review = JSON.parse(output) as StructuredReview;
    this.persistReview(scope, run, review);
    if (review.verdict === 'blocked') throw new DomainError(errorCodes.validation, '异模型审校发现阻断问题', { issues: review.issues }, false, 409);
    if (review.verdict === 'rewrite') {
      if (run.rewrite_count >= 2) throw new DomainError(errorCodes.operationIncomplete, '定点重写两次后仍未通过，停止机械重写', {}, false, 409);
      return this.advance(run, 'rewrite');
    }
    return this.advance(run, 'facts');
  }

  private async rewrite(scope: BookScope, run: PipelineRow): Promise<PipelineRow> {
    if (run.current_manuscript_version_id === null) throw new Error('定点重写缺少正文版本');
    const content = this.loadManuscript(scope, run.current_manuscript_version_id);
    const issues = this.database.prepare(`
      SELECT required_action FROM review_issues WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND status = 'open'
      ORDER BY created_at, review_issue_id
    `).all(scope.ownerId, scope.bookId, run.chapter_id) as unknown as Array<{ required_action: string }>;
    const requiredActions = issues.map((issue) => issue.required_action);
    const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
      taskId: run.task_id, agentId: run.writer_agent_id, chapterId: run.chapter_id,
      canonRevision: run.expected_canon_revision, positioningVersion: run.expected_positioning_version,
      tokenBudget: 12_000,
      hardSources: [
        { sourceType: 'current_manuscript', sourceId: run.current_manuscript_version_id, content, reason: '待定点重写的完整正文', priority: 100 },
        { sourceType: 'review_issues', sourceId: `review:${run.rewrite_count + 1}`, content: JSON.stringify(requiredActions), reason: '结构化修改要求', priority: 100 }
      ], optionalSources: []
    });
    const adapter: ModelAdapter = this.modelIdentity(run.writer_model_snapshot_id).modelId.includes('candidate-b')
      ? new DeterministicNovelCandidateBAdapter()
      : new DeterministicNovelWriterAdapter();
    const output = await this.executeModel(
      scope, run, `rewrite-${run.rewrite_count + 1}`, run.writer_agent_id, run.writer_model_snapshot_id,
      adapter, JSON.stringify({ operation: 'rewrite', content, requiredActions }), pack.contextPackId
    );
    const nextVersionId = this.promoteManuscript(scope, run, output, run.current_manuscript_version_id, adapter, 'candidate');
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      UPDATE review_issues SET status = 'resolved', resolved_by_manuscript_version_id = ?, resolved_at = ?
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND status = 'open'
    `).run(nextVersionId, now, scope.ownerId, scope.bookId, run.chapter_id);
    this.database.prepare(`
      UPDATE chapter_pipeline_runs SET current_manuscript_version_id = ?, rewrite_count = rewrite_count + 1,
        phase = 'hard_check', updated_at = ? WHERE pipeline_run_id = ?
    `).run(nextVersionId, now, run.pipeline_run_id);
    return this.reload(run.pipeline_run_id);
  }

  private extractFacts(scope: BookScope, run: PipelineRow): PipelineRow {
    if (run.current_manuscript_version_id === null) throw new Error('事实提取缺少正文版本');
    const chapter = this.requireChapter(scope, run.chapter_id);
    new ChapterCatalogService(this.database, this.ids, this.clock).selectManuscript(scope, run.chapter_id, run.current_manuscript_version_id);
    const canon = new CanonService(this.database, this.ids, this.clock);
    const entityId = canon.createEntity(scope, { entityType: 'event', canonicalName: `第${chapter.chapter_number}章已发生事件` });
    canon.proposeFact(scope, {
      subjectEntityId: entityId,
      relationKey: 'event',
      value: { chapterNumber: chapter.chapter_number, outcome: '林澈取得新线索并确认下一处目标' },
      evidence: [{ manuscriptVersionId: run.current_manuscript_version_id, location: '章末' }],
      grade: 'B',
      sourceChapterId: run.chapter_id,
      sourceManuscriptVersionId: run.current_manuscript_version_id,
      storyTimeStart: `第${chapter.chapter_number}章`
    });
    return this.advance(run, 'settlement');
  }

  private settle(scope: BookScope, run: PipelineRow): PipelineRow {
    if (run.current_manuscript_version_id === null) throw new Error('结算缺少正文版本');
    const chapter = this.requireChapter(scope, run.chapter_id);
    new CanonService(this.database, this.ids, this.clock).settleChapter(scope, run.chapter_id, run.current_manuscript_version_id, {
      chapterNumber: chapter.chapter_number,
      location: '北塔线索链',
      protagonist: { name: '林澈', alive: true, nextGoal: '找到写下第三个日期的人' },
      hook: '北塔最高层重新亮灯'
    });
    const latestReview = this.database.prepare(`
      SELECT summary FROM review_rounds WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY round_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, run.chapter_id) as { summary: string };
    const recentMajor = this.database.prepare(`
      SELECT COUNT(DISTINCT chapter_id) AS count FROM review_issues
      WHERE owner_id = ? AND book_id = ? AND issue_type = 'style_repetition' AND severity = 'major'
        AND chapter_id IN (SELECT chapter_id FROM chapters WHERE owner_id = ? AND book_id = ? ORDER BY chapter_number DESC LIMIT 2)
    `).get(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId) as { count: number };
    const switchSuggested = recentMajor.count >= 2 && run.rewrite_count >= 2;
    this.database.prepare(`
      INSERT INTO chapter_quality_metrics (
        quality_metric_id, owner_id, book_id, chapter_id, manuscript_version_id,
        scores_json, rewrite_count, repeated_major_style_issue, switch_writer_suggested, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.ids.next(), scope.ownerId, scope.bookId, run.chapter_id, run.current_manuscript_version_id,
      JSON.stringify({ finalReview: latestReview.summary, hardChecksPassed: true, independentModelReview: true }),
      run.rewrite_count, recentMajor.count >= 2 ? 1 : 0, switchSuggested ? 1 : 0, this.clock.now().toISOString()
    );
    return this.advance(run, 'completed');
  }

  private findOrCreateRun(scope: BookScope, taskId: string, chapterId: string): PipelineRow {
    const existing = this.database.prepare(`SELECT * FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, chapterId) as PipelineRow | undefined;
    if (existing !== undefined) {
      if (existing.status === 'paused') {
        this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'working', updated_at = ? WHERE pipeline_run_id = ?`)
          .run(this.clock.now().toISOString(), existing.pipeline_run_id);
        return this.reload(existing.pipeline_run_id);
      }
      return existing;
    }
    const selection = new WriterSelectionService(this.database, this.ids, this.clock).select(scope);
    const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
    const pipelineRunId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO chapter_pipeline_runs (
        pipeline_run_id, owner_id, book_id, chapter_id, task_id, writer_selection_id,
        writer_agent_id, writer_model_snapshot_id, reviewer_agent_id, reviewer_model_snapshot_id,
        expected_canon_revision, expected_positioning_version, phase, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preflight', 'working', ?, ?)
    `).run(
      pipelineRunId, scope.ownerId, scope.bookId, chapterId, taskId, selection.writerSelectionId,
      selection.writerAgentId, selection.writerModelSnapshotId, selection.reviewerAgentId,
      selection.reviewerModelSnapshotId, book.canon_revision, book.positioning_version, now, now
    );
    return this.reload(pipelineRunId);
  }

  private async executeModel(
    scope: BookScope,
    run: PipelineRow,
    phaseKey: string,
    agentId: string,
    modelSnapshotId: string,
    adapter: ModelAdapter,
    prompt: string,
    contextPackId: string
  ): Promise<string> {
    const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
    if (budget === undefined) throw new Error('书籍没有活动预算');
    const requestId = this.ids.next();
    const budgets = new BudgetService(this.database, this.ids, this.clock);
    const reservationId = budgets.reserve(scope, budget.budget_id, requestId, 20_000, 0);
    const result = await new ModelCallService(this.database, this.clock, budgets).execute(scope, {
      requestId,
      taskId: run.task_id,
      phaseKey,
      agentId,
      modelSnapshotId,
      provider: adapter.provider,
      modelId: adapter.modelId,
      input: prompt,
      parameters: JSON.stringify({ deterministic: true, maxOutputTokens: 8_000 }),
      reservationId,
      contextPackId
    }, adapter, {
      requestId, taskId: run.task_id, ownerId: scope.ownerId, bookId: scope.bookId,
      agentId, prompt, maxOutputTokens: 8_000
    });
    return result.output;
  }

  private promoteManuscript(
    scope: BookScope,
    run: PipelineRow,
    content: string,
    parentVersionId: string | null,
    adapter: ModelAdapter,
    status: 'candidate'
  ): string {
    const promotion = new PromotionService(this.database, this.dataDir, this.clock);
    const staged = promotion.stageText(run.task_id, content);
    const manuscriptVersionId = this.ids.next();
    const fileId = this.ids.next();
    promotion.promote(scope, {
      ...staged,
      operationId: this.ids.next(),
      fileId,
      chapterId: run.chapter_id,
      versionId: manuscriptVersionId
    });
    new ChapterCatalogService(this.database, this.ids, this.clock).registerManuscript(scope, {
      manuscriptVersionId,
      chapterId: run.chapter_id,
      parentVersionId,
      authorAgentId: run.writer_agent_id,
      modelProvider: adapter.provider,
      modelId: adapter.modelId,
      sourceTaskId: run.task_id,
      fileId,
      contentHash: staged.contentHash,
      wordCount: countNovelCharacters(content),
      status
    });
    return manuscriptVersionId;
  }

  private persistReview(scope: BookScope, run: PipelineRow, review: StructuredReview): void {
    if (run.current_manuscript_version_id === null) throw new Error('审校版本缺失');
    const reviewRoundId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO review_rounds (
          review_round_id, owner_id, book_id, chapter_id, manuscript_version_id,
          reviewer_agent_id, reviewer_model_snapshot_id, round_number, verdict, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reviewRoundId, scope.ownerId, scope.bookId, run.chapter_id, run.current_manuscript_version_id,
        run.reviewer_agent_id, run.reviewer_model_snapshot_id, run.rewrite_count + 1,
        review.verdict, review.summary, now
      );
      for (const issue of review.issues) {
        this.database.prepare(`
          INSERT INTO review_issues (
            review_issue_id, review_round_id, owner_id, book_id, chapter_id,
            location_text, issue_type, severity, evidence_text, required_action,
            status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
        `).run(
          this.ids.next(), reviewRoundId, scope.ownerId, scope.bookId, run.chapter_id,
          issue.location, issue.issueType, issue.severity, issue.evidence, issue.requiredAction, now
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private advance(run: PipelineRow, phase: PipelinePhase): PipelineRow {
    this.database.prepare(`UPDATE chapter_pipeline_runs SET phase = ?, updated_at = ? WHERE pipeline_run_id = ?`)
      .run(phase, this.clock.now().toISOString(), run.pipeline_run_id);
    return this.reload(run.pipeline_run_id);
  }

  private reload(pipelineRunId: string): PipelineRow {
    const row = this.database.prepare(`SELECT * FROM chapter_pipeline_runs WHERE pipeline_run_id = ?`).get(pipelineRunId) as unknown as PipelineRow | undefined;
    if (row === undefined) throw new Error('流水线运行记录缺失');
    return row;
  }

  private requireChapter(scope: BookScope, chapterId: string): ChapterRow {
    const row = this.database.prepare(`SELECT chapter_number, title, settlement_status FROM chapters WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
      .get(chapterId, scope.ownerId, scope.bookId) as ChapterRow | undefined;
    if (row === undefined) throw new Error('章节不存在或越权');
    return row;
  }

  private loadManuscript(scope: BookScope, manuscriptVersionId: string): string {
    const row = this.database.prepare(`
      SELECT f.relative_path FROM manuscript_versions m JOIN file_registry f ON f.file_id = m.file_id
      WHERE m.manuscript_version_id = ? AND m.owner_id = ? AND m.book_id = ? AND f.status = 'active'
    `).get(manuscriptVersionId, scope.ownerId, scope.bookId) as { relative_path: string } | undefined;
    if (row === undefined) throw new Error('正文文件不存在或越权');
    return readFileSync(resolveInside(this.dataDir, row.relative_path), 'utf8');
  }

  private modelIdentity(snapshotId: string): { provider: string; modelId: string } {
    const row = this.database.prepare(`SELECT provider, model_id FROM model_config_snapshots WHERE model_snapshot_id = ?`)
      .get(snapshotId) as { provider: string; model_id: string };
    return { provider: row.provider, modelId: row.model_id };
  }

  private selectionFromRun(run: PipelineRow): WriterSelection {
    return {
      writerSelectionId: run.writer_selection_id,
      mode: 'standard_blind',
      writerAgentId: run.writer_agent_id,
      writerModelSnapshotId: run.writer_model_snapshot_id,
      reviewerAgentId: run.reviewer_agent_id,
      reviewerModelSnapshotId: run.reviewer_model_snapshot_id,
      candidates: []
    };
  }

  private mapResult(run: PipelineRow, status: 'paused' | 'completed'): PipelineResult {
    return {
      pipelineRunId: run.pipeline_run_id,
      chapterId: run.chapter_id,
      taskId: run.task_id,
      status,
      phase: run.phase,
      manuscriptVersionId: run.current_manuscript_version_id,
      rewriteCount: run.rewrite_count
    };
  }
}
