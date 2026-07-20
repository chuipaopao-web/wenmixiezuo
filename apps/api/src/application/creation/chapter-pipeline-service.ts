import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ArtifactService } from '../artifacts/artifact-service.js';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ChapterCatalogService } from '../chapters/chapter-catalog-service.js';
import { CanonService } from '../knowledge/canon-service.js';
import { ContextPackService, estimateTokens, type ContextSource } from '../memory/context-pack-service.js';
import { MemoryService } from '../memory/memory-service.js';
import { TaskService, type TaskLeaseFence } from '../tasks/task-service.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';
import {
  countNovelCharacters,
  type StructuredReview
} from '../../infrastructure/models/deterministic-novel-models.js';
import type { ModelAdapter } from '../../infrastructure/models/model-adapter.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../infrastructure/models/model-runtime-config.js';
import { PromotionService } from '../../infrastructure/recovery/promotion-service.js';
import { WriterSelectionService } from './writer-selection-service.js';
import { CopyrightService } from '../copyright/copyright-service.js';
import { WritingReadinessService } from './writing-readiness-service.js';
import { ChapterStateRecoveryService } from './chapter-state-recovery-service.js';
import { WritingOrderService } from './writing-order-service.js';
import { ProductionReviewService } from './production-review-service.js';
import { ProductionWorkflowRepository } from '../../infrastructure/db/repositories/production-workflow-repository.js';
import { WriterLeaseRepository } from '../../infrastructure/db/repositories/writer-lease-repository.js';
import { WriterLeaseService } from '../agents/writer-lease-service.js';
import type { EditorReviewSynthesis, ProductionReview } from '../../contracts/production-review.js';
import { HybridRetrievalService } from '../memory/hybrid-retrieval-service.js';
import { RetrievalContextSourceService } from '../memory/retrieval-context-source-service.js';
import { RetrievalOrchestrationRepository } from '../../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';
import { ChunkSnapshotRepository } from '../../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { EditorLeaseService } from '../editors/editor-lease-service.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export type PipelinePhase = 'preflight' | 'context' | 'draft' | 'hard_check' | 'review' | 'rewrite' | 'facts' | 'settlement' | 'completed';

export interface PipelineResult {
  pipelineRunId: string;
  chapterId: string;
  taskId: string;
  status: 'paused' | 'awaiting_confirmation' | 'blocked' | 'completed';
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
  error_code: string | null;
  writer_takeover_count: number;
  writer_takeover_reason: string | null;
  writing_order_id: string | null;
  writer_epoch: number | null;
  review_panel_id: string | null;
  confirmation_id: string | null;
  binding_revision_id: string | null;
}

interface ChapterRow { chapter_number: number; title: string; settlement_status: string }

export class ChapterPipelineService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory = new ModelAdapterFactory(loadModelRuntimeConfig({})),
    private readonly retrieval: HybridRetrievalService = new HybridRetrievalService(
      new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
      new ChunkSnapshotRepository(database), ids, clock
    )
  ) {}

  public async executeClaimed(
    scope: BookScope,
    taskId: string,
    workerId: string,
    pauseAfterPhase?: PipelinePhase,
    leaseFence?: TaskLeaseFence
  ): Promise<PipelineResult> {
    assertBookScope(scope);
    const task = this.database.prepare(`
      SELECT chapter_id, status, lease_owner FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?
    `).get(taskId, scope.ownerId, scope.bookId) as { chapter_id: string | null; status: string; lease_owner: string | null } | undefined;
    const currentTask = new TaskService(this.database, this.releaseId, this.clock).require(scope, taskId);
    if (task === undefined || task.chapter_id === null || task.status !== 'working' || task.lease_owner !== workerId
      || (leaseFence !== undefined && (currentTask.leaseToken !== leaseFence.leaseToken || currentTask.currentAttemptNo !== leaseFence.attemptNo))) {
      throw new Error('章节任务未由指定Worker持有');
    }
    let run = this.findOrCreateRun(scope, taskId, task.chapter_id, currentTask.brief);
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    try {
      while (run.phase !== 'completed') {
        const completedPhase = run.phase;
        run = await this.executePhase(scope, run);
        tasks.checkpoint(scope, taskId, workerId, run.phase, { completedPhase, pipelineRunId: run.pipeline_run_id, manuscriptVersionId: run.current_manuscript_version_id, rewriteCount: run.rewrite_count }, leaseFence);
        if (pauseAfterPhase === completedPhase) {
          this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'paused', updated_at = ? WHERE pipeline_run_id = ?`)
            .run(this.clock.now().toISOString(), run.pipeline_run_id);
          tasks.requestPause(scope, taskId);
          tasks.pauseAtCheckpoint(scope, taskId, workerId, leaseFence);
          return this.mapResult(run, 'paused');
        }
      }
      this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'completed', updated_at = ? WHERE pipeline_run_id = ?`)
        .run(this.clock.now().toISOString(), run.pipeline_run_id);
      if (run.confirmation_id !== null) {
        tasks.waitForConfirmation(scope, taskId, workerId, leaseFence);
        return this.mapResult(run, 'awaiting_confirmation');
      }
      tasks.complete(scope, taskId, workerId, leaseFence);
      return this.mapResult(run, 'completed');
    } catch (error) {
      const now = this.clock.now().toISOString();
      const cancelRequested = (this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?`)
        .get(taskId, scope.ownerId, scope.bookId) as { cancel_requested: number } | undefined)?.cancel_requested === 1;
      const qualityBlocked = error instanceof QualityBlockedError;
      const errorCode = cancelRequested ? 'TASK_CANCELLED' : qualityBlocked ? 'QUALITY_BLOCKED' : error instanceof DomainError ? error.code : 'PIPELINE_FAILED';
      this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'failed', error_code = ?, updated_at = ? WHERE pipeline_run_id = ?`)
        .run(errorCode, now, run.pipeline_run_id);
      if (!cancelRequested) {
        this.database.prepare(`UPDATE chapters SET generation_status = 'failed', updated_at = ?
          WHERE chapter_id = ? AND owner_id = ? AND book_id = ? AND settlement_status <> 'settled'`)
          .run(now, run.chapter_id, scope.ownerId, scope.bookId);
      }
      const failure = this.database.prepare(`
        UPDATE tasks SET status = ?, error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
          lease_token = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ? AND status = 'working'
          AND lease_expires_at > ? AND (? IS NULL OR (lease_token = ? AND current_attempt_no = ?))
          AND (required_editor_epoch = 0 OR required_editor_epoch = (
            SELECT editor_epoch FROM books WHERE owner_id = ? AND book_id = ?
          ))
      `).run(cancelRequested ? 'cancelled' : qualityBlocked ? 'blocked' : 'failed', errorCode, now,
        taskId, scope.ownerId, scope.bookId, workerId, now, leaseFence?.leaseToken ?? null,
        leaseFence?.leaseToken ?? null, leaseFence?.attemptNo ?? 0, scope.ownerId, scope.bookId);
      if (failure.changes !== 1) throw error;
      this.database.prepare(`
        UPDATE task_attempts SET status = ?, error_code = ?, completed_at = ?
        WHERE owner_id = ? AND book_id = ? AND task_id = ? AND attempt_no = ? AND status = 'working'
      `).run(cancelRequested ? 'cancelled' : qualityBlocked ? 'blocked' : 'failed', errorCode, now,
        scope.ownerId, scope.bookId, taskId, leaseFence?.attemptNo ?? currentTask.currentAttemptNo);
      if (cancelRequested) {
        new ChapterStateRecoveryService(this.database, this.clock).reconcileCancelledChapter(scope, task.chapter_id);
      }
      if (qualityBlocked) return this.mapResult(this.reload(run.pipeline_run_id), 'blocked');
      throw error;
    }
  }

  public requireRun(scope: BookScope, chapterId: string): PipelineResult {
    const row = this.database.prepare(`SELECT * FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, chapterId) as PipelineRow | undefined;
    if (row === undefined) throw new Error('章节流水线不存在或越权');
    const status: PipelineResult['status'] = row.confirmation_id !== null
      ? 'awaiting_confirmation'
      : row.status === 'completed'
        ? 'completed'
        : row.status === 'failed' && row.error_code === 'QUALITY_BLOCKED'
          ? 'blocked'
          : 'paused';
    return this.mapResult(row, status);
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
    return new UnitOfWork(this.database).run(() => {
      new CopyrightService(this.database, this.ids, this.clock).validatePreGeneration(scope);
      const chapter = this.requireChapter(scope, run.chapter_id);
      const taskBrief = this.taskBrief(scope, run.task_id);
      const operation = taskBrief.operation === 'review_existing' || taskBrief.operation === 'rewrite_existing'
        ? taskBrief.operation : null;
      const existingManuscriptVersionId = operation === null ? null : requiredString(taskBrief.manuscriptVersionId, '正文任务缺少绑定版本');
      if (existingManuscriptVersionId !== null) this.requireBoundManuscript(scope, run.chapter_id, existingManuscriptVersionId);
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
      const outlineVersionId = new WritingReadinessService(this.database).outlineVersionId(scope, chapter.chapter_number);
      const outline = artifacts.requireVersion(scope, outlineVersionId);
      const contractContent = {
        chapterId: run.chapter_id,
        pov: '服从老板已确认的创作方案；未明确时采用第三人称限知',
        tense: '服从老板已确认的创作方案；未明确时采用现代中文小说常用叙事时态',
        targetWords: 2_900,
        hardConstraints: ['2500至3500字', '不得占位', '服从当前正史', '不得脱离已确认章纲补造关键设定', `章纲版本：${outlineVersionId}`]
      };
      const existingContract = this.database.prepare(`
        SELECT artifact_id FROM artifacts WHERE owner_id = ? AND book_id = ? AND artifact_type = 'writing_contract' AND title = ?
      `).get(scope.ownerId, scope.bookId, `第${chapter.chapter_number}章写作契约`) as { artifact_id: string } | undefined;
      const contract = existingContract === undefined
        ? artifacts.create(scope, 'writing_contract', `第${chapter.chapter_number}章写作契约`, contractContent, 'candidate')
        : artifacts.addVersion(scope, existingContract.artifact_id, contractContent);
      const selectedContract = artifacts.select(scope, contract.artifactId, contract.artifactVersionId);
      const outlineContent = asObject(outline.content);
      const sourceDecisionId = requiredString(outlineContent.sourceDecisionId, '章纲缺少老板确认决定来源');
      const objective = firstString(outlineContent.goal, outlineContent.objective) ?? `完成第${chapter.chapter_number}章已确认章纲`;
      const order = new WritingOrderService(new ProductionWorkflowRepository(this.database), this.ids, this.clock).create(scope, {
        chapterId: run.chapter_id,
        taskId: run.task_id,
        sourceDecisionId,
        outlineVersionId: outline.artifactVersionId,
        contractVersionId: selectedContract.artifactVersionId,
        objective,
        sceneScope: {
          chapterNumber: chapter.chapter_number,
          title: chapter.title,
          pov: contractContent.pov,
          timeAndPlace: firstString(outlineContent.time, outlineContent.place) ?? '服从已确认章纲与前章结算状态',
          participants: Array.isArray(outlineContent.participants) ? outlineContent.participants : [],
          endingInterface: firstString(outlineContent.hook) ?? '形成可追踪的章末状态'
        },
        hardConstraints: contractContent.hardConstraints,
        creativeFreedom: ['具体动作、意象、对白和节奏由活动主笔创造', '软风格建议可按场景目的调整', '不得为提高审校分数抹平人物声音'],
        canonRevision: run.expected_canon_revision,
        positioningVersion: run.expected_positioning_version,
        sources: [
          { sourceClass: 'hard', sourceType: 'chapter_outline', sourceId: outline.artifactVersionId, reason: '老板确认的当前章纲', content: JSON.stringify(outline.content) },
          { sourceClass: 'hard', sourceType: 'writing_contract', sourceId: selectedContract.artifactVersionId, reason: '主编签发的当前写作契约', content: JSON.stringify(selectedContract.content) },
          ...(existingManuscriptVersionId === null ? [] : [{
            sourceClass: 'hard' as const, sourceType: 'owner_manuscript', sourceId: existingManuscriptVersionId,
            reason: operation === 'review_existing' ? '老板提交定稿审校的当前不可变正文' : '老板要求主笔重写的当前不可变正文',
            content: this.loadManuscript(scope, existingManuscriptVersionId)
          }])
        ]
      });
      const lease = new WriterLeaseService(new WriterLeaseRepository(this.database), this.clock)
        .beginOrder(scope, run.writer_agent_id, order.writingOrderId, { taskId: run.task_id, chapterId: run.chapter_id, phase: 'preflight' });
      this.database.prepare(`
        UPDATE chapters SET plan_status = 'ready', generation_status = 'working', updated_at = ?
        WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
      `).run(this.clock.now().toISOString(), run.chapter_id, scope.ownerId, scope.bookId);
      this.database.prepare(`
        UPDATE chapter_pipeline_runs SET outline_version_id = ?, writing_contract_version_id = ?,
          writing_order_id = ?, writer_epoch = ?, current_manuscript_version_id = ?, phase = ?,
          status = 'working', updated_at = ? WHERE pipeline_run_id = ?
      `).run(outline.artifactVersionId, selectedContract.artifactVersionId, order.writingOrderId, lease.epoch,
        existingManuscriptVersionId, operation === 'review_existing' ? 'hard_check' : 'context',
        this.clock.now().toISOString(), run.pipeline_run_id);
      return this.reload(run.pipeline_run_id);
    });
  }

  private async buildDraftContext(scope: BookScope, run: PipelineRow): Promise<PipelineRow> {
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
    const planningSources = this.database.prepare(`
      SELECT a.artifact_type, v.artifact_version_id, v.version, v.content_json
      FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.status = 'active'
        AND a.artifact_type = 'creative_plan'
      ORDER BY a.created_at DESC LIMIT 3
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ artifact_type: string; artifact_version_id: string; version: number; content_json: string }>;
    const hardSources: ContextSource[] = [
      { sourceType: 'system_rule', sourceId: 'writing-safety-v1', content: '正文必须完整、原创、服从正史；不得静默覆盖旧版本；不得包含占位符。', reason: '系统与老板硬规则', priority: 100 },
      ...planningSources.map((source) => ({
        sourceType: source.artifact_type,
        sourceId: source.artifact_version_id,
        content: source.content_json,
        reason: '老板确认后选中的全书创作资料',
        priority: 100,
        version: source.version
      })),
      { sourceType: 'chapter_outline', sourceId: run.outline_version_id, content: JSON.stringify(outline.content), reason: '当前章纲', priority: 100, version: outline.version },
      { sourceType: 'writing_contract', sourceId: run.writing_contract_version_id, content: JSON.stringify(contract.content), reason: '当前写作契约', priority: 100, version: contract.version }
    ];
    const taskBrief = this.taskBrief(scope, run.task_id);
    if (taskBrief.operation === 'rewrite_existing') {
      const manuscriptVersionId = requiredString(taskBrief.manuscriptVersionId, '重写任务缺少正文版本');
      this.requireBoundManuscript(scope, run.chapter_id, manuscriptVersionId);
      hardSources.push({
        sourceType: 'current_manuscript', sourceId: manuscriptVersionId,
        content: this.loadManuscript(scope, manuscriptVersionId), reason: '老板要求重写的当前完整正文', priority: 100
      });
      hardSources.push({
        sourceType: 'owner_rewrite_instruction', sourceId: `instruction:${run.task_id}`,
        content: typeof taskBrief.instruction === 'string' && taskBrief.instruction.trim().length > 0
          ? taskBrief.instruction.trim() : '在保持已确认正史与章纲的前提下重写本章，提升人物声音、情绪与阅读体验。',
        reason: '老板本次重写要求', priority: 100
      });
    }
    if (previous !== undefined) hardSources.push({ sourceType: 'previous_chapter_end', sourceId: `previous:${chapter.chapter_number - 1}`, content: previous.state_json, reason: '前章结算硬状态', priority: 100 });
    const retrievalSources = await new RetrievalContextSourceService(this.retrieval).collect(scope, {
      query: JSON.stringify({ chapterNumber: chapter.chapter_number, title: chapter.title, outline: outline.content, contract: contract.content }),
      roleKey: 'lead_writer', mode: 'drafting', canonRevision: run.expected_canon_revision,
      taskId: run.task_id, sourceTypes: ['manuscript', 'fact', 'outline', 'setting', 'wiki', 'voice'], limit: 14
    });
    hardSources.push(...retrievalSources.hardSources);
    const optionalSources = [
      ...retrievalSources.optionalSources,
      ...new MemoryService(this.database, this.ids, this.clock).listActive(scope, { canonRevision: run.expected_canon_revision })
        .slice(0, 12)
        .map((memory, index) => ({ sourceType: `memory:${memory.layer}`, sourceId: memory.memoryId, content: memory.content, reason: '与当前书籍相关的活动记忆', priority: 45 - index }))
    ];
    new CopyrightService(this.database, this.ids, this.clock).assertWriterContextSafe([...hardSources, ...optionalSources]);
    const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
      taskId: run.task_id,
      agentId: run.writer_agent_id,
      chapterId: run.chapter_id,
      canonRevision: run.expected_canon_revision,
      positioningVersion: run.expected_positioning_version,
      outlineVersionId: run.outline_version_id,
      writingContractVersionId: run.writing_contract_version_id,
      tokenBudget: 24_000,
      hardSources,
      optionalSources
    });
    this.database.prepare(`UPDATE chapter_pipeline_runs SET context_pack_id = ?, phase = 'draft', updated_at = ? WHERE pipeline_run_id = ?`)
      .run(pack.contextPackId, this.clock.now().toISOString(), run.pipeline_run_id);
    return this.reload(run.pipeline_run_id);
  }

  private async generateDraft(scope: BookScope, run: PipelineRow): Promise<PipelineRow> {
    if (run.context_pack_id === null) throw new Error('初稿上下文包缺失');
    const writerLease = this.renewWriterForModelPhase(scope, run);
    const chapter = this.requireChapter(scope, run.chapter_id);
    const previous = this.database.prepare(`
      SELECT e.state_json FROM chapters c JOIN chapter_end_states e ON e.chapter_end_state_id = c.chapter_end_state_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number < ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapter.chapter_number) as { state_json: string } | undefined;
    const taskBrief = this.taskBrief(scope, run.task_id);
    const rewriteBase = taskBrief.operation === 'rewrite_existing'
      ? requiredString(taskBrief.manuscriptVersionId, '重写任务缺少正文版本') : null;
    const prompt = JSON.stringify({
      operation: rewriteBase === null ? 'draft' : 'rewrite', chapterNumber: chapter.chapter_number, title: chapter.title,
      previousState: previous?.state_json ?? '故事刚刚开始',
      ...(rewriteBase === null ? {} : {
        content: this.loadManuscript(scope, rewriteBase),
        requiredActions: [typeof taskBrief.instruction === 'string' && taskBrief.instruction.trim().length > 0
          ? taskBrief.instruction.trim() : '完整重写本章并保持正史、章纲和人物连续性']
      })
    });
    const writerModel = this.modelIdentity(scope, run.writer_model_snapshot_id);
    const adapter = this.modelAdapters.resolve(writerModel.provider, writerModel.modelId, 'novel_writer', 'writer');
    let output: string;
    try {
      output = await this.executeModel(scope, run, 'draft', run.writer_agent_id, run.writer_model_snapshot_id, adapter, prompt, run.context_pack_id);
    } catch (error) {
      if (!(error instanceof ModelTechnicalFailureError)) throw error;
      return this.takeOverWriterOrBlock(scope, run, 'draft', error.message);
    }
    writerLease.assertCanCommit(scope, run.writer_agent_id, run.writer_epoch!);
    this.promoteManuscript(scope, run, output, rewriteBase, adapter, 'candidate', (manuscriptVersionId) => {
      this.database.prepare(`UPDATE chapter_pipeline_runs SET current_manuscript_version_id = ?, phase = 'hard_check', updated_at = ? WHERE pipeline_run_id = ?`)
        .run(manuscriptVersionId, this.clock.now().toISOString(), run.pipeline_run_id);
    });
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
      hookAssessment: { deterministicGate: false, delegatedTo: 'experience_reviewer', reason: '标点不能证明章末钩子有效' }
    };
    const passed = checks.length.passed && checks.noPlaceholder.passed;
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
    const manuscriptVersionId = run.current_manuscript_version_id;
    if (run.writing_order_id === null || run.writer_epoch === null) throw new Error('审校缺少冻结工单或写手epoch');
    const writerLease = this.renewWriterForModelPhase(scope, run);
    const content = this.loadManuscript(scope, manuscriptVersionId);
    const manuscriptHash = createHash('sha256').update(content).digest('hex');
    const writerModel = this.modelIdentity(scope, run.writer_model_snapshot_id);
    const workflowRepository = new ProductionWorkflowRepository(this.database);
    const reviews = new ProductionReviewService(workflowRepository, this.ids, this.clock);
    if (run.review_panel_id !== null) workflowRepository.blockReviewPanel(scope, run.review_panel_id);
    const panel = reviews.openPanel(scope, {
      chapterId: run.chapter_id, manuscriptVersionId, manuscriptHash,
      reviewRound: run.rewrite_count + 1, writerAgentId: run.writer_agent_id, writerProvider: writerModel.provider,
      writerModelId: writerModel.modelId, writerModelSnapshotId: run.writer_model_snapshot_id, writerEpoch: run.writer_epoch,
      writingOrderId: run.writing_order_id, canonRevision: run.expected_canon_revision,
      bindingRevisionId: run.binding_revision_id
    });
    this.database.prepare(`UPDATE chapter_pipeline_runs SET review_panel_id = ?, updated_at = ? WHERE pipeline_run_id = ?`)
      .run(panel.panelId, this.clock.now().toISOString(), run.pipeline_run_id);
    const reports: ProductionReview[] = await Promise.all(panel.reviewers.map(async (reviewer) => {
      const reviewerSources = await new RetrievalContextSourceService(this.retrieval).collect(scope, {
        query: reviewRetrievalQuery(content, this.requireChapter(scope, run.chapter_id)),
        roleKey: reviewer.agent.roleKey,
        mode: 'review',
        canonRevision: run.expected_canon_revision,
        taskId: run.task_id,
        sourceTypes: reviewer.role === 'fact'
          ? ['fact', 'manuscript', 'outline', 'setting', 'wiki']
          : reviewer.role === 'literary'
            ? ['voice', 'manuscript', 'outline']
            : ['manuscript', 'outline', 'setting', 'wiki'],
        limit: reviewer.role === 'fact' ? 14 : 8
      });
      const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
        taskId: run.task_id, agentId: reviewer.agent.agentId, chapterId: run.chapter_id,
        canonRevision: run.expected_canon_revision, positioningVersion: run.expected_positioning_version,
        tokenBudget: 12_000,
        hardSources: [
          { sourceType: 'current_manuscript', sourceId: manuscriptVersionId, content, reason: '三点评席共同读取的同一不可变完整正文', priority: 100 },
          ...reviewerSources.hardSources
        ],
        optionalSources: reviewerSources.optionalSources
      });
      const adapter = this.modelAdapters.resolve(reviewer.agent.provider, reviewer.agent.modelId, 'novel_reviewer', reviewer.agent.roleKey as never);
      const reviewPhase = `review-${run.rewrite_count + 1}-${reviewer.role}-${panel.panelId}`;
      const reviewPrompt = JSON.stringify({
          reviewerRole: reviewer.role,
          manuscriptVersionId,
          modelSnapshotId: reviewer.agent.modelSnapshotId,
          ...(adapter.provider.startsWith('local-deterministic') ? { content } : {}),
          contract: reviewer.role === 'literary'
            ? '返回带段落计数、可解释证据且isAuthorshipProbability=false的aiStyle对象'
            : reviewer.role === 'experience'
              ? '分别返回politicalRisk和sexualContentRisk，包含位置、证据、动作和policyVersion'
              : '核对连续性、人物状态、因果与硬约束；另返回factCandidates数组，每条含subjectName、entityType、relationKey、value、正文原句evidenceQuote、evidenceLocation、epistemicStatus、negated、viewpointName、knowledgeSubjectName、knowledgeTimeStart、knowledgeTimeEnd、storyTimeStart、storyTimeEnd；未知字段使用null，不得把主体猜成观点/知情主体，不确定、梦境、谎言或角色认知不得冒充objective。主角当前状态只在正文明确给出且对后续创作有持续价值时记录，使用 protagonist_state.<本书分类>.<状态键>（绝对值）或 protagonist_delta.<本书分类>.<状态键>（增减值）；分类必须随本书内容生成，无法可靠归类时写 unclassified 以请求作者确认，不得硬套固定模板，也不得记录转瞬即逝的动作、情绪或从模糊文学描写猜测数值'
        });
      let output: string;
      try {
        output = await this.executeModel(
          scope, run, reviewPhase, reviewer.agent.agentId, reviewer.agent.modelSnapshotId,
          adapter, reviewPrompt, pack.contextPackId
        );
      } catch (error) {
        workflowRepository.blockReviewPanel(scope, panel.panelId);
        throw new QualityBlockedError(`点评席在一次技术重试后仍不可用：${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        return reviews.persist(scope, {
          panelId: panel.panelId, role: reviewer.role, manuscriptVersionId,
          modelSnapshotId: reviewer.agent.modelSnapshotId, agentId: reviewer.agent.agentId, raw: output,
          inputTokens: estimateTokens(content)
        });
      } catch (firstValidationError) {
        try {
          const repaired = await this.executeModel(
            scope, run, `review-repair-${run.rewrite_count + 1}-${reviewer.role}-${panel.panelId}`,
            reviewer.agent.agentId, reviewer.agent.modelSnapshotId, adapter,
            JSON.stringify({
              operation: 'repair_review_json',
              validationError: firstValidationError instanceof Error ? firstValidationError.message : String(firstValidationError),
              invalidOutput: output.slice(0, 12_000),
              originalContract: JSON.parse(reviewPrompt) as unknown,
              instruction: '只修正JSON结构、字段、枚举和版本绑定；不得新增正文中没有的证据，只输出一个JSON对象。'
            }),
            pack.contextPackId
          );
          return reviews.persist(scope, {
            panelId: panel.panelId, role: reviewer.role, manuscriptVersionId,
            modelSnapshotId: reviewer.agent.modelSnapshotId, agentId: reviewer.agent.agentId, raw: repaired,
            inputTokens: estimateTokens(content)
          });
        } catch (repairError) {
          workflowRepository.blockReviewPanel(scope, panel.panelId);
          throw new QualityBlockedError(`点评报告定向修复一次后仍未通过：${repairError instanceof Error ? repairError.message : String(repairError)}`);
        }
      }
    }));
    const activeEditor = this.database.prepare(`SELECT active_editor_agent_id FROM books
      WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { active_editor_agent_id: string | null } | undefined;
    const editor = activeEditor?.active_editor_agent_id === null || activeEditor === undefined
      ? undefined
      : workflowRepository.currentTeam(scope, run.binding_revision_id)
          .find((agent) => agent.agentId === activeEditor.active_editor_agent_id);
    if (editor === undefined) throw new QualityBlockedError('当前模型绑定缺少活动主编，不能综合三席报告');
    const editorPack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
      taskId: run.task_id,
      agentId: editor.agentId,
      chapterId: run.chapter_id,
      canonRevision: run.expected_canon_revision,
      positioningVersion: run.expected_positioning_version,
      tokenBudget: 8_000,
      hardSources: [{
        sourceType: 'review_reports',
        sourceId: `panel:${panel.panelId}`,
        content: JSON.stringify(reports),
        reason: '主编只综合三份结构化点评，不读取正文进行第四次点评',
        priority: 100
      }],
      optionalSources: []
    });
    const editorAdapter = this.modelAdapters.resolve(editor.provider, editor.modelId, 'discussion', editor.roleKey as never);
    let synthesisRaw: string;
    try {
      synthesisRaw = await this.executeModel(
        scope,
        run,
        `editor-synthesis-${run.rewrite_count + 1}-${panel.panelId}`,
        editor.agentId,
        editor.modelSnapshotId,
        editorAdapter,
        JSON.stringify({
          operation: 'review_synthesis',
          panelId: panel.panelId,
          manuscriptVersionId,
          reports,
          rules: [
            '只综合三席已提交的结构化报告，不推测正文中未被报告指出的问题',
            '不能降级任何blocker、重大问题或高等级合规风险',
            '按修改收益与牵连范围排列问题索引，并保留真实分歧'
          ],
          output: {
            panelId: '原值', manuscriptVersionId: '原值', recommendedVerdict: 'pass|rewrite|blocked',
            priorityIssueIndexes: ['三席issues按报告顺序展开后的零基索引'],
            preservedDisagreements: ['需要保留的分歧'], rationale: '综合理由'
          }
        }),
        editorPack.contextPackId
      );
    } catch (error) {
      workflowRepository.blockReviewPanel(scope, panel.panelId);
      const synthesisPhase = `editor-synthesis-${run.rewrite_count + 1}-${panel.panelId}`;
      const technicalFailures = (this.database.prepare(`SELECT COUNT(*) AS count FROM model_calls
        WHERE owner_id = ? AND book_id = ? AND task_id = ? AND agent_id = ?
          AND phase_key LIKE ? AND state = 'failed' AND error_class = 'technical_failure'`)
        .get(scope.ownerId, scope.bookId, run.task_id, editor.agentId, `${synthesisPhase}:%`) as { count: number }).count;
      if (technicalFailures < 2) throw error;
      const takeover = new EditorLeaseService(this.database, this.ids, this.clock).tryAutomaticTakeover(scope, editor.agentId);
      throw new QualityBlockedError(takeover.takenOver
        ? `主编模型连续技术失败，已由候任主编接管；当前任务将按新epoch恢复：${takeover.activeEditorAgentId}`
        : `主编模型连续技术失败且未能安全接管：${takeover.reason}`);
    }
    let editorSynthesis: EditorReviewSynthesis;
    try {
      editorSynthesis = reviews.persistEditorSynthesis(scope, {
        panelId: panel.panelId,
        manuscriptVersionId,
        editorAgentId: editor.agentId,
        modelSnapshotId: editor.modelSnapshotId,
        raw: synthesisRaw,
        issueCount: reports.flatMap((report) => report.issues).length
      });
    } catch (firstValidationError) {
      try {
        const repaired = await this.executeModel(
          scope, run, `editor-synthesis-repair-${run.rewrite_count + 1}-${panel.panelId}`,
          editor.agentId, editor.modelSnapshotId, editorAdapter,
          JSON.stringify({
            operation: 'repair_editor_synthesis_json',
            validationError: firstValidationError instanceof Error ? firstValidationError.message : String(firstValidationError),
            invalidOutput: synthesisRaw.slice(0, 12_000),
            panelId: panel.panelId,
            manuscriptVersionId,
            issueCount: reports.flatMap((report) => report.issues).length,
            instruction: '只修正JSON结构、字段、枚举、问题索引和版本绑定；不能降级三席风险，只输出一个JSON对象。'
          }),
          editorPack.contextPackId
        );
        editorSynthesis = reviews.persistEditorSynthesis(scope, {
          panelId: panel.panelId,
          manuscriptVersionId,
          editorAgentId: editor.agentId,
          modelSnapshotId: editor.modelSnapshotId,
          raw: repaired,
          issueCount: reports.flatMap((report) => report.issues).length
        });
      } catch (repairError) {
        workflowRepository.blockReviewPanel(scope, panel.panelId);
        throw new QualityBlockedError(`主编综合定向修复一次后仍未通过：${repairError instanceof Error ? repairError.message : String(repairError)}`);
      }
    }
    writerLease.assertCanCommit(scope, run.writer_agent_id, run.writer_epoch);
    const merged = reviews.merge(scope, {
      panelId: panel.panelId, manuscriptVersionId,
      revisionRound: run.rewrite_count + 1, reports, editorSynthesis
    });
    if (merged.verdict === 'blocked') throw new QualityBlockedError('三异模型点评发现阻断问题，已保留稿件和证据');
    if (merged.verdict === 'rewrite') {
      if (run.rewrite_count >= 2) throw new QualityBlockedError('两轮定点重写后仍未通过，已停止机械重写');
      return this.advance(run, 'rewrite');
    }
    return this.advance(run, 'facts');
  }

  private async rewrite(scope: BookScope, run: PipelineRow): Promise<PipelineRow> {
    if (run.current_manuscript_version_id === null) throw new Error('定点重写缺少正文版本');
    const writerLease = this.renewWriterForModelPhase(scope, run);
    const content = this.loadManuscript(scope, run.current_manuscript_version_id);
    const issues = this.database.prepare(`
      SELECT j.value AS required_action FROM revision_orders r, json_each(r.hard_actions_json) j
      WHERE r.owner_id = ? AND r.book_id = ? AND r.manuscript_version_id = ? AND r.status = 'active'
      ORDER BY r.created_at, j.key
    `).all(scope.ownerId, scope.bookId, run.current_manuscript_version_id) as unknown as Array<{ required_action: string }>;
    const requiredActions = issues.map((issue) => issue.required_action);
    const rewriteSources: ContextSource[] = [
      { sourceType: 'current_manuscript', sourceId: run.current_manuscript_version_id, content, reason: '待定点重写的完整正文', priority: 100 },
      { sourceType: 'review_issues', sourceId: `review:${run.rewrite_count + 1}`, content: JSON.stringify(requiredActions), reason: '结构化修改要求', priority: 100 }
    ];
    new CopyrightService(this.database, this.ids, this.clock).assertWriterContextSafe(rewriteSources);
    const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
      taskId: run.task_id, agentId: run.writer_agent_id, chapterId: run.chapter_id,
      canonRevision: run.expected_canon_revision, positioningVersion: run.expected_positioning_version,
      tokenBudget: 12_000,
      hardSources: rewriteSources, optionalSources: []
    });
    const writerModel = this.modelIdentity(scope, run.writer_model_snapshot_id);
    const adapter = this.modelAdapters.resolve(writerModel.provider, writerModel.modelId, 'novel_writer', 'writer');
    let output: string;
    try {
      output = await this.executeModel(
        scope, run, `rewrite-${run.rewrite_count + 1}`, run.writer_agent_id, run.writer_model_snapshot_id,
        adapter, JSON.stringify({ operation: 'rewrite', content, requiredActions }), pack.contextPackId
      );
    } catch (error) {
      if (!(error instanceof ModelTechnicalFailureError)) throw error;
      return this.takeOverWriterOrBlock(scope, run, 'rewrite', error.message);
    }
    writerLease.assertCanCommit(scope, run.writer_agent_id, run.writer_epoch!);
    this.promoteManuscript(scope, run, output, run.current_manuscript_version_id, adapter, 'candidate', (nextVersionId) => {
      const now = this.clock.now().toISOString();
      this.database.prepare(`UPDATE revision_orders SET status = 'completed'
        WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ? AND status = 'active'`)
        .run(scope.ownerId, scope.bookId, run.current_manuscript_version_id);
      this.database.prepare(`
        UPDATE chapter_pipeline_runs SET current_manuscript_version_id = ?, rewrite_count = rewrite_count + 1,
          phase = 'hard_check', updated_at = ? WHERE pipeline_run_id = ?
      `).run(nextVersionId, now, run.pipeline_run_id);
    });
    return this.reload(run.pipeline_run_id);
  }

  private extractFacts(scope: BookScope, run: PipelineRow): PipelineRow {
    return new UnitOfWork(this.database).run(() => {
      if (run.current_manuscript_version_id === null || run.review_panel_id === null) throw new Error('正文确认门禁缺少稿件或三点评轮次');
      const chapter = this.requireChapter(scope, run.chapter_id);
      const confirmationId = this.ids.next();
      new ProductionWorkflowRepository(this.database).createApprovalGate(scope, {
        gateId: this.ids.next(), confirmationId, chapterId: run.chapter_id, taskId: run.task_id,
        manuscriptVersionId: run.current_manuscript_version_id, reviewPanelId: run.review_panel_id,
        expectedCanonRevision: run.expected_canon_revision,
        scopeData: { chapterNumber: chapter.chapter_number, chapterTitle: chapter.title, manuscriptVersionId: run.current_manuscript_version_id },
        impact: { onAccept: ['选中当前不可变正文', '抽取带来源的事实候选', '章节结算并创建新正史版本'], onReject: ['保留临时稿和点评证据', '不进入正史'], cashCostCny: 0 },
        now: this.clock.now().toISOString()
      });
      this.database.prepare(`UPDATE chapters SET settlement_status = 'awaiting_confirmation', updated_at = ? WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
        .run(this.clock.now().toISOString(), run.chapter_id, scope.ownerId, scope.bookId);
      this.database.prepare(`UPDATE chapter_pipeline_runs SET confirmation_id = ?, updated_at = ? WHERE pipeline_run_id = ?`)
        .run(confirmationId, this.clock.now().toISOString(), run.pipeline_run_id);
      return this.advance(run, 'settlement');
    });
  }

  private settle(scope: BookScope, run: PipelineRow): PipelineRow {
    if (run.confirmation_id === null) throw new Error('结算阶段缺少老板确认单');
    return this.advance(run, 'completed');
  }

  private findOrCreateRun(scope: BookScope, taskId: string, chapterId: string, taskBrief: Record<string, unknown>): PipelineRow {
    const existing = this.database.prepare(`SELECT * FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, chapterId) as PipelineRow | undefined;
    if (existing !== undefined) {
      if (existing.status === 'paused') {
        this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'working', updated_at = ? WHERE pipeline_run_id = ?`)
          .run(this.clock.now().toISOString(), existing.pipeline_run_id);
        return this.reload(existing.pipeline_run_id);
      }
      const explicitExistingOperation = taskBrief.operation === 'review_existing' || taskBrief.operation === 'rewrite_existing';
      if ((existing.status === 'failed' && (existing.current_manuscript_version_id === null || existing.task_id !== taskId))
        || (explicitExistingOperation && existing.task_id !== taskId && existing.status === 'completed')) {
        const selection = new WriterSelectionService(this.database, this.ids, this.clock).select(scope);
        const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
          .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
        const bindingRevision = this.database.prepare(`SELECT agent_model_binding_revision_id FROM agent_model_binding_revisions
          WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1`)
          .get(scope.ownerId, scope.bookId) as { agent_model_binding_revision_id: string } | undefined;
        this.database.prepare(`
          UPDATE chapter_pipeline_runs SET task_id = ?, writer_selection_id = ?,
            writer_agent_id = ?, writer_model_snapshot_id = ?, reviewer_agent_id = ?, reviewer_model_snapshot_id = ?,
            binding_revision_id = ?, writer_takeover_count = 0, writer_takeover_reason = NULL,
            outline_version_id = NULL,
            writing_contract_version_id = NULL, context_pack_id = NULL, writing_order_id = NULL,
            current_manuscript_version_id = NULL, writer_epoch = NULL, review_panel_id = NULL,
            confirmation_id = NULL, rewrite_count = 0, phase = 'preflight',
            status = 'working', error_code = NULL, expected_canon_revision = ?,
            expected_positioning_version = ?, updated_at = ? WHERE pipeline_run_id = ?
        `).run(taskId, selection.writerSelectionId, selection.writerAgentId, selection.writerModelSnapshotId,
          selection.reviewerAgentId, selection.reviewerModelSnapshotId,
          bindingRevision?.agent_model_binding_revision_id ?? null,
          book.canon_revision, book.positioning_version, this.clock.now().toISOString(), existing.pipeline_run_id);
        return this.reload(existing.pipeline_run_id);
      }
      if (existing.task_id !== taskId) throw new Error('章节已有不可安全复用的流水线运行记录');
      return existing;
    }
    const selection = new WriterSelectionService(this.database, this.ids, this.clock).select(scope);
    const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
    const bindingRevision = this.database.prepare(`SELECT agent_model_binding_revision_id FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { agent_model_binding_revision_id: string } | undefined;
    const pipelineRunId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO chapter_pipeline_runs (
        pipeline_run_id, owner_id, book_id, chapter_id, task_id, writer_selection_id,
        writer_agent_id, writer_model_snapshot_id, reviewer_agent_id, reviewer_model_snapshot_id,
        expected_canon_revision, expected_positioning_version, binding_revision_id, phase, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preflight', 'working', ?, ?)
    `).run(
      pipelineRunId, scope.ownerId, scope.bookId, chapterId, taskId, selection.writerSelectionId,
      selection.writerAgentId, selection.writerModelSnapshotId, selection.reviewerAgentId,
      selection.reviewerModelSnapshotId, book.canon_revision, book.positioning_version,
      bindingRevision?.agent_model_binding_revision_id ?? null, now, now
    );
    return this.reload(pipelineRunId);
  }

  private taskBrief(scope: BookScope, taskId: string): Record<string, unknown> {
    const row = this.database.prepare(`SELECT task_brief_json FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?`)
      .get(taskId, scope.ownerId, scope.bookId) as { task_brief_json: string } | undefined;
    if (row === undefined) throw new Error('章节任务不存在或越权');
    return JSON.parse(row.task_brief_json) as Record<string, unknown>;
  }

  private requireBoundManuscript(scope: BookScope, chapterId: string, manuscriptVersionId: string): void {
    const row = this.database.prepare(`SELECT 1 FROM manuscript_versions WHERE manuscript_version_id = ?
      AND owner_id = ? AND book_id = ? AND chapter_id = ? AND status IN ('draft','candidate','under_review','approved')`)
      .get(manuscriptVersionId, scope.ownerId, scope.bookId, chapterId);
    if (row === undefined) throw new Error('正文任务绑定版本不存在、越权或状态不可用');
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
    const lease = this.database.prepare(`
      SELECT lease_token, current_attempt_no FROM tasks
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working'
    `).get(run.task_id, scope.ownerId, scope.bookId) as { lease_token: string | null; current_attempt_no: number } | undefined;
    if (lease === undefined || lease.lease_token === null) throw new Error('模型调用缺少活动任务租约');
    const budgets = new BudgetService(this.database, this.ids, this.clock);
    const modelPrompt = adapter.provider.startsWith('local-deterministic')
      ? prompt
      : this.promptWithContext(scope, contextPackId, phaseKey, prompt);
    const inputHash = createHash('sha256').update(modelPrompt).digest('hex');
    const reusable = this.database.prepare(`
      SELECT r.output_text FROM model_calls m JOIN model_call_results r ON r.request_id = m.request_id
      WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ? AND m.model_snapshot_id = ?
        AND m.input_hash = ? AND m.phase_key LIKE ? AND m.state = 'succeeded'
      ORDER BY m.completed_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, run.task_id, modelSnapshotId, inputHash, `${phaseKey}:attempt-%`) as { output_text: string } | undefined;
    if (reusable !== undefined) return reusable.output_text;
    let lastError: unknown;
    for (let technicalTry = 1; technicalTry <= 2; technicalTry += 1) {
      const requestId = this.ids.next();
      const maxOutputTokens = outputTokenLimit(phaseKey);
      const packBudget = (this.database.prepare(`SELECT token_budget FROM context_packs
        WHERE context_pack_id = ? AND owner_id = ? AND book_id = ?`)
        .get(contextPackId, scope.ownerId, scope.bookId) as { token_budget: number } | undefined)?.token_budget ?? 0;
      const estimatedInputCeiling = adapter.provider.startsWith('local-deterministic')
        ? Math.ceil(estimateTokens(modelPrompt) * 1.15)
        : Math.max(packBudget, Math.ceil(estimateTokens(modelPrompt) * 1.15));
      const reservedTokens = estimatedInputCeiling + maxOutputTokens;
      const reservationId = budgets.reserve(scope, budget.budget_id, requestId, reservedTokens, 0);
      const effectivePhaseKey = `${phaseKey}:attempt-${lease.current_attempt_no}:try-${technicalTry}`;
      try {
        const result = await new ModelCallService(this.database, this.clock, budgets).execute(scope, {
          requestId,
          taskId: run.task_id,
          phaseKey: effectivePhaseKey,
          agentId,
          modelSnapshotId,
          provider: adapter.provider,
          modelId: adapter.modelId,
          input: modelPrompt,
          parameters: JSON.stringify({
            maxOutputTokens,
            planOnly: !adapter.provider.startsWith('local-deterministic'),
            cashFallbackAllowed: false
          }),
          reservationId,
          contextPackId,
          leaseToken: lease.lease_token,
          attemptNo: lease.current_attempt_no
        }, adapter, {
          requestId, taskId: run.task_id, ownerId: scope.ownerId, bookId: scope.bookId,
          agentId, prompt: modelPrompt, maxOutputTokens
        });
        return result.output;
      } catch (error) {
        lastError = error;
        const call = this.database.prepare(`SELECT state, error_class FROM model_calls
          WHERE request_id = ? AND owner_id = ? AND book_id = ?`)
          .get(requestId, scope.ownerId, scope.bookId) as { state: string; error_class: string | null } | undefined;
        const retryableTechnicalFailure = call?.state === 'failed' && call.error_class === 'technical_failure';
        if (!retryableTechnicalFailure) throw error;
        if (technicalTry === 2) {
          throw new ModelTechnicalFailureError(
            `模型在一次自动重试后仍发生技术失败：${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('模型调用失败');
  }

  private promoteManuscript(
    scope: BookScope,
    run: PipelineRow,
    content: string,
    parentVersionId: string | null,
    adapter: ModelAdapter,
    status: 'candidate',
    afterRegister?: (manuscriptVersionId: string) => void
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
    if (run.writer_epoch === null) throw new Error('正文登记缺少写手epoch');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      new WriterLeaseService(new WriterLeaseRepository(this.database), this.clock)
        .assertCanCommit(scope, run.writer_agent_id, run.writer_epoch);
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
      afterRegister?.(manuscriptVersionId);
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return manuscriptVersionId;
  }

  private renewWriterForModelPhase(scope: BookScope, run: PipelineRow): WriterLeaseService {
    if (run.writer_epoch === null) throw new Error('模型阶段缺少写手epoch');
    const service = new WriterLeaseService(new WriterLeaseRepository(this.database), this.clock);
    service.assertCanCommit(scope, run.writer_agent_id, run.writer_epoch);
    // 最长模型调用可达15分钟；本阶段内延长租约，阶段结束仍再次校验epoch。
    service.renew(scope, run.writer_agent_id, run.writer_epoch, 15 * 60_000);
    return service;
  }

  private takeOverWriterOrBlock(
    scope: BookScope,
    run: PipelineRow,
    resumePhase: Extract<PipelinePhase, 'draft' | 'rewrite'>,
    reason: string
  ): PipelineRow {
    if (run.writer_epoch === null || run.writing_order_id === null) {
      throw new QualityBlockedError('主笔技术故障，但流水线缺少可验证的写手检查点，不能安全接管');
    }
    if (run.writer_takeover_count >= 1) {
      throw new QualityBlockedError('主笔技术故障且本章已经接管过一次；为避免循环换笔，正文保持暂存并等待老板处理');
    }
    const team = new ProductionWorkflowRepository(this.database).currentTeam(scope, run.binding_revision_id);
    const candidate = team.find((agent) => agent.roleKey === 'backup_writer' && agent.agentId !== run.writer_agent_id);
    if (candidate === undefined) {
      throw new QualityBlockedError('主笔技术故障，但冻结模型绑定中没有可用副笔，正文保持暂存');
    }
    try {
      return new UnitOfWork(this.database).run(() => {
        const lease = new WriterLeaseService(new WriterLeaseRepository(this.database), this.clock).takeover(
          scope,
          run.writer_epoch!,
          candidate.agentId,
          run.writing_order_id!,
          {
            pipelineRunId: run.pipeline_run_id,
            chapterId: run.chapter_id,
            resumePhase,
            previousWriterAgentId: run.writer_agent_id,
            previousManuscriptVersionId: run.current_manuscript_version_id,
            reason
          },
          candidate.modelSnapshotId
        );
        const nextPhase: PipelinePhase = resumePhase === 'draft' ? 'context' : 'rewrite';
        const now = this.clock.now().toISOString();
        const updated = this.database.prepare(`
          UPDATE chapter_pipeline_runs SET writer_agent_id = ?, writer_model_snapshot_id = ?,
            writer_epoch = ?, writer_takeover_count = writer_takeover_count + 1,
            writer_takeover_reason = ?, context_pack_id = CASE WHEN ? = 'context' THEN NULL ELSE context_pack_id END,
            review_panel_id = NULL, phase = ?, status = 'working', error_code = NULL, updated_at = ?
          WHERE pipeline_run_id = ? AND owner_id = ? AND book_id = ? AND writer_agent_id = ?
            AND writer_epoch = ? AND writer_takeover_count = 0
        `).run(candidate.agentId, candidate.modelSnapshotId, lease.epoch, reason, nextPhase, nextPhase, now,
          run.pipeline_run_id, scope.ownerId, scope.bookId, run.writer_agent_id, run.writer_epoch);
        if (updated.changes !== 1) throw new Error('主笔接管时流水线版本已变化，拒绝重复接管');
        this.database.prepare(`UPDATE tasks SET assigned_agent_id = ?, checkpoint_json = ?, updated_at = ?
          WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working'`)
          .run(candidate.agentId, JSON.stringify({
            pipelineRunId: run.pipeline_run_id,
            writerTakeover: true,
            previousWriterAgentId: run.writer_agent_id,
            activeWriterAgentId: candidate.agentId,
            writerEpoch: lease.epoch,
            resumePhase: nextPhase
          }), now, run.task_id, scope.ownerId, scope.bookId);
        return this.reload(run.pipeline_run_id);
      });
    } catch (error) {
      throw new QualityBlockedError(`主笔技术故障且未能安全接管：${error instanceof Error ? error.message : String(error)}`);
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

  private promptWithContext(scope: BookScope, contextPackId: string, phaseKey: string, taskInput: string): string {
    const row = this.database.prepare(`
      SELECT source_manifest_json, content_hash FROM context_packs
      WHERE context_pack_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
    `).get(contextPackId, scope.ownerId, scope.bookId) as { source_manifest_json: string; content_hash: string } | undefined;
    if (row === undefined) throw new Error('模型上下文包不存在、已失效或越权');
    const parsedTaskInput = JSON.parse(taskInput) as unknown;
    const compactTaskInput = phaseKey.startsWith('review-repair-') || phaseKey.startsWith('editor-synthesis-repair-')
      ? parsedTaskInput
      : phaseKey.startsWith('editor-synthesis-')
        ? isRecordValue(parsedTaskInput)
          ? {
              operation: parsedTaskInput.operation,
              panelId: parsedTaskInput.panelId,
              manuscriptVersionId: parsedTaskInput.manuscriptVersionId,
              rules: parsedTaskInput.rules,
              output: parsedTaskInput.output
            }
          : { operation: 'review_synthesis' }
      : phaseKey.startsWith('review-')
      ? isRecordValue(parsedTaskInput)
        ? {
            operation: 'review',
            reviewerRole: parsedTaskInput.reviewerRole,
            manuscriptVersionId: parsedTaskInput.manuscriptVersionId,
            modelSnapshotId: parsedTaskInput.modelSnapshotId,
            contract: parsedTaskInput.contract
          }
        : { operation: 'review' }
      : phaseKey.startsWith('rewrite-')
        ? { operation: 'rewrite' }
        : parsedTaskInput;
    return JSON.stringify({
      phase: phaseKey,
      contextPackHash: row.content_hash,
      sources: JSON.parse(row.source_manifest_json) as unknown,
      taskInput: compactTaskInput
    });
  }

  private modelIdentity(scope: BookScope, snapshotId: string): { provider: string; modelId: string } {
    const row = this.database.prepare(`
      SELECT provider, model_id FROM model_config_snapshots
      WHERE model_snapshot_id = ? AND owner_id = ? AND book_id = ?
    `).get(snapshotId, scope.ownerId, scope.bookId) as { provider: string; model_id: string } | undefined;
    if (row === undefined) throw new Error('模型快照不存在或越权');
    return { provider: row.provider, modelId: row.model_id };
  }

  private mapResult(run: PipelineRow, status: PipelineResult['status']): PipelineResult {
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

function outputTokenLimit(phaseKey: string): number {
  if (phaseKey.startsWith('draft') || phaseKey.startsWith('rewrite')) return 8_000;
  if (phaseKey.startsWith('review-')) return 4_000;
  if (phaseKey.startsWith('editor-synthesis')) return 2_000;
  return 4_000;
}

class QualityBlockedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QualityBlockedError';
  }
}

class ModelTechnicalFailureError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ModelTechnicalFailureError';
  }
}

export function parseStructuredReview(raw: string): StructuredReview {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('审校模型未返回JSON对象');
  let value: unknown;
  try {
    value = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new Error('审校模型返回的JSON无法解析');
  }
  if (!isRecord(value)) throw new Error('审校结果必须是JSON对象');
  const verdicts = new Set(['pass', 'rewrite', 'blocked']);
  if (typeof value.verdict !== 'string' || !verdicts.has(value.verdict)) throw new Error('审校结果verdict无效');
  if (typeof value.summary !== 'string' || value.summary.trim().length === 0) throw new Error('审校结果summary缺失');
  if (!Array.isArray(value.issues)) throw new Error('审校结果issues必须是数组');
  const severities = new Set(['blocker', 'major', 'minor', 'observation']);
  const issues = value.issues.map((issue) => {
    if (!isRecord(issue)) throw new Error('审校问题必须是对象');
    for (const field of ['location', 'issueType', 'severity', 'evidence', 'requiredAction'] as const) {
      if (typeof issue[field] !== 'string' || issue[field].trim().length === 0) throw new Error(`审校问题字段${field}无效`);
    }
    if (!severities.has(issue.severity as string)) throw new Error('审校问题severity无效');
    return {
      location: (issue.location as string).trim(),
      issueType: (issue.issueType as string).trim(),
      severity: issue.severity as StructuredReview['issues'][number]['severity'],
      evidence: (issue.evidence as string).trim(),
      requiredAction: (issue.requiredAction as string).trim()
    };
  });
  if (!isRecord(value.scores)) throw new Error('审校结果scores必须是对象');
  const rawScores = value.scores;
  const scoreKeys = ['continuity', 'character', 'pacing', 'style', 'hook'] as const;
  const scores = Object.fromEntries(scoreKeys.map((key) => {
    const score = rawScores[key];
    if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > 100) throw new Error(`审校评分${key}无效`);
    return [key, score as number];
  })) as StructuredReview['scores'];
  return {
    verdict: value.verdict as StructuredReview['verdict'],
    summary: value.summary,
    issues,
    scores
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!isRecordValue(value)) throw new Error('规划成果内容必须是对象');
  return value;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message);
  return value.trim();
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function reviewRetrievalQuery(content: string, chapter: ChapterRow): string {
  const normalized = content.trim();
  const head = normalized.slice(0, 700);
  const tail = normalized.length > 700 ? normalized.slice(-700) : '';
  return `第${chapter.chapter_number}章 ${chapter.title}\n${head}\n${tail}`;
}
