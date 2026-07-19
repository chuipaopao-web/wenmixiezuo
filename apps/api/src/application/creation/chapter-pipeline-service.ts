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
import { WriterSelectionService, type WriterSelection } from './writer-selection-service.js';
import { CopyrightService } from '../copyright/copyright-service.js';
import { WritingReadinessService } from './writing-readiness-service.js';
import { ChapterStateRecoveryService } from './chapter-state-recovery-service.js';
import { WritingOrderService } from './writing-order-service.js';
import { ProductionReviewService } from './production-review-service.js';
import { ProductionWorkflowRepository } from '../../infrastructure/db/repositories/production-workflow-repository.js';
import { WriterLeaseRepository } from '../../infrastructure/db/repositories/writer-lease-repository.js';
import { WriterLeaseService } from '../agents/writer-lease-service.js';
import type { ProductionReview } from '../../contracts/production-review.js';

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
    private readonly modelAdapters: ModelAdapterFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}))
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
    let run = this.findOrCreateRun(scope, taskId, task.chapter_id);
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
      const failure = this.database.prepare(`
        UPDATE tasks SET status = ?, error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
          lease_token = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ? AND status = 'working'
          AND lease_expires_at > ? AND (? IS NULL OR (lease_token = ? AND current_attempt_no = ?))
      `).run(cancelRequested ? 'cancelled' : qualityBlocked ? 'blocked' : 'failed', errorCode, now,
        taskId, scope.ownerId, scope.bookId, workerId, now, leaseFence?.leaseToken ?? null,
        leaseFence?.leaseToken ?? null, leaseFence?.attemptNo ?? 0);
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
    return this.mapResult(row, row.confirmation_id !== null ? 'awaiting_confirmation' : row.status === 'completed' ? 'completed' : 'paused');
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
        { sourceClass: 'hard', sourceType: 'writing_contract', sourceId: selectedContract.artifactVersionId, reason: '主编签发的当前写作契约', content: JSON.stringify(selectedContract.content) }
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
        writing_order_id = ?, writer_epoch = ?, phase = 'context', status = 'working', updated_at = ? WHERE pipeline_run_id = ?
    `).run(outline.artifactVersionId, selectedContract.artifactVersionId, order.writingOrderId, lease.epoch,
      this.clock.now().toISOString(), run.pipeline_run_id);
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
    const planningSources = this.database.prepare(`
      SELECT a.artifact_type, v.artifact_version_id, v.version, v.content_json
      FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.status = 'active'
        AND a.artifact_type IN ('creative_plan', 'story_bible', 'master_outline')
      ORDER BY CASE a.artifact_type WHEN 'creative_plan' THEN 0 WHEN 'story_bible' THEN 1 ELSE 2 END
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
    const chapter = this.requireChapter(scope, run.chapter_id);
    const previous = this.database.prepare(`
      SELECT e.state_json FROM chapters c JOIN chapter_end_states e ON e.chapter_end_state_id = c.chapter_end_state_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number < ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapter.chapter_number) as { state_json: string } | undefined;
    const prompt = JSON.stringify({ operation: 'draft', chapterNumber: chapter.chapter_number, title: chapter.title, previousState: previous?.state_json ?? '故事刚刚开始' });
    const writerModel = this.modelIdentity(scope, run.writer_model_snapshot_id);
    const adapter = this.modelAdapters.resolve(writerModel.provider, writerModel.modelId, 'novel_writer', 'writer');
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
    if (run.writing_order_id === null || run.writer_epoch === null) throw new Error('审校缺少冻结工单或写手epoch');
    new WriterLeaseService(new WriterLeaseRepository(this.database), this.clock)
      .assertCanCommit(scope, run.writer_agent_id, run.writer_epoch);
    const content = this.loadManuscript(scope, run.current_manuscript_version_id);
    const manuscriptHash = createHash('sha256').update(content).digest('hex');
    const writerModel = this.modelIdentity(scope, run.writer_model_snapshot_id);
    const reviews = new ProductionReviewService(new ProductionWorkflowRepository(this.database), this.ids, this.clock);
    const panel = reviews.openPanel(scope, {
      chapterId: run.chapter_id, manuscriptVersionId: run.current_manuscript_version_id, manuscriptHash,
      reviewRound: run.rewrite_count + 1, writerAgentId: run.writer_agent_id, writerProvider: writerModel.provider,
      writerModelId: writerModel.modelId, writerModelSnapshotId: run.writer_model_snapshot_id, writerEpoch: run.writer_epoch,
      writingOrderId: run.writing_order_id, canonRevision: run.expected_canon_revision,
      bindingRevisionId: run.binding_revision_id
    });
    this.database.prepare(`UPDATE chapter_pipeline_runs SET review_panel_id = ?, updated_at = ? WHERE pipeline_run_id = ?`)
      .run(panel.panelId, this.clock.now().toISOString(), run.pipeline_run_id);
    const reports: ProductionReview[] = [];
    for (const reviewer of panel.reviewers) {
      const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
        taskId: run.task_id, agentId: reviewer.agent.agentId, chapterId: run.chapter_id,
        canonRevision: run.expected_canon_revision, positioningVersion: run.expected_positioning_version,
        tokenBudget: 12_000,
        hardSources: [{ sourceType: 'current_manuscript', sourceId: run.current_manuscript_version_id, content, reason: '三点评席共同读取的同一不可变完整正文', priority: 100 }],
        optionalSources: []
      });
      const adapter = this.modelAdapters.resolve(reviewer.agent.provider, reviewer.agent.modelId, 'novel_reviewer', reviewer.agent.roleKey as never);
      const output = await this.executeModel(
        scope, run, `review-${run.rewrite_count + 1}-${reviewer.role}-${panel.panelId}`, reviewer.agent.agentId,
        reviewer.agent.modelSnapshotId, adapter,
        JSON.stringify({
          reviewerRole: reviewer.role,
          manuscriptVersionId: run.current_manuscript_version_id,
          modelSnapshotId: reviewer.agent.modelSnapshotId,
          content,
          contract: reviewer.role === 'literary'
            ? '返回带段落计数、可解释证据且isAuthorshipProbability=false的aiStyle对象'
            : reviewer.role === 'experience'
              ? '分别返回politicalRisk和sexualContentRisk，包含位置、证据、动作和policyVersion'
              : '核对连续性、人物状态、因果与硬约束'
        }),
        pack.contextPackId
      );
      try {
        reports.push(reviews.persist(scope, {
          panelId: panel.panelId, role: reviewer.role, manuscriptVersionId: run.current_manuscript_version_id,
          modelSnapshotId: reviewer.agent.modelSnapshotId, agentId: reviewer.agent.agentId, raw: output,
          inputTokens: estimateTokens(content)
        }));
      } catch (error) {
        new ProductionWorkflowRepository(this.database).blockReviewPanel(scope, panel.panelId);
        throw new QualityBlockedError(`点评报告未通过结构校验：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const merged = reviews.merge(scope, {
      panelId: panel.panelId, manuscriptVersionId: run.current_manuscript_version_id,
      revisionRound: run.rewrite_count + 1, reports
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
    const content = this.loadManuscript(scope, run.current_manuscript_version_id);
    const issues = this.database.prepare(`
      SELECT j.value AS required_action FROM revision_orders r, json_each(r.hard_actions_json) j
      WHERE r.owner_id = ? AND r.book_id = ? AND r.manuscript_version_id = ? AND r.status = 'active'
      ORDER BY r.created_at, j.key
    `).all(scope.ownerId, scope.bookId, run.current_manuscript_version_id) as unknown as Array<{ required_action: string }>;
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
    const writerModel = this.modelIdentity(scope, run.writer_model_snapshot_id);
    const adapter = this.modelAdapters.resolve(writerModel.provider, writerModel.modelId, 'novel_writer', 'writer');
    const output = await this.executeModel(
      scope, run, `rewrite-${run.rewrite_count + 1}`, run.writer_agent_id, run.writer_model_snapshot_id,
      adapter, JSON.stringify({ operation: 'rewrite', content, requiredActions }), pack.contextPackId
    );
    const nextVersionId = this.promoteManuscript(scope, run, output, run.current_manuscript_version_id, adapter, 'candidate');
    const now = this.clock.now().toISOString();
    this.database.prepare(`UPDATE revision_orders SET status = 'completed'
      WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ? AND status = 'active'`)
      .run(scope.ownerId, scope.bookId, run.current_manuscript_version_id);
    this.database.prepare(`
      UPDATE chapter_pipeline_runs SET current_manuscript_version_id = ?, rewrite_count = rewrite_count + 1,
        phase = 'hard_check', updated_at = ? WHERE pipeline_run_id = ?
    `).run(nextVersionId, now, run.pipeline_run_id);
    return this.reload(run.pipeline_run_id);
  }

  private extractFacts(scope: BookScope, run: PipelineRow): PipelineRow {
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
  }

  private settle(scope: BookScope, run: PipelineRow): PipelineRow {
    if (run.confirmation_id === null) throw new Error('结算阶段缺少老板确认单');
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
      if (existing.status === 'failed' && existing.current_manuscript_version_id === null) {
        const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
          .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
        this.database.prepare(`
          UPDATE chapter_pipeline_runs SET task_id = ?, outline_version_id = NULL,
            writing_contract_version_id = NULL, context_pack_id = NULL, writing_order_id = NULL,
            writer_epoch = NULL, review_panel_id = NULL, confirmation_id = NULL, phase = 'preflight',
            status = 'working', error_code = NULL, expected_canon_revision = ?,
            expected_positioning_version = ?, updated_at = ? WHERE pipeline_run_id = ?
        `).run(taskId, book.canon_revision, book.positioning_version, this.clock.now().toISOString(), existing.pipeline_run_id);
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
    const lease = this.database.prepare(`
      SELECT lease_token, current_attempt_no FROM tasks
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working'
    `).get(run.task_id, scope.ownerId, scope.bookId) as { lease_token: string | null; current_attempt_no: number } | undefined;
    if (lease === undefined || lease.lease_token === null) throw new Error('模型调用缺少活动任务租约');
    const budgets = new BudgetService(this.database, this.ids, this.clock);
    const reservationId = budgets.reserve(scope, budget.budget_id, requestId, 50_000, 0);
    const modelPrompt = adapter.provider.startsWith('local-deterministic')
      ? prompt
      : this.promptWithContext(scope, contextPackId, phaseKey, prompt);
    const result = await new ModelCallService(this.database, this.clock, budgets).execute(scope, {
      requestId,
      taskId: run.task_id,
      phaseKey,
      agentId,
      modelSnapshotId,
      provider: adapter.provider,
      modelId: adapter.modelId,
      input: modelPrompt,
      parameters: JSON.stringify({
        maxOutputTokens: 8_000,
        planOnly: !adapter.provider.startsWith('local-deterministic'),
        cashFallbackAllowed: false
      }),
      reservationId,
      contextPackId,
      leaseToken: lease.lease_token,
      attemptNo: lease.current_attempt_no
    }, adapter, {
      requestId, taskId: run.task_id, ownerId: scope.ownerId, bookId: scope.bookId,
      agentId, prompt: modelPrompt, maxOutputTokens: 8_000
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

  private promptWithContext(scope: BookScope, contextPackId: string, phaseKey: string, taskInput: string): string {
    const row = this.database.prepare(`
      SELECT source_manifest_json, content_hash FROM context_packs
      WHERE context_pack_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
    `).get(contextPackId, scope.ownerId, scope.bookId) as { source_manifest_json: string; content_hash: string } | undefined;
    if (row === undefined) throw new Error('模型上下文包不存在、已失效或越权');
    const parsedTaskInput = JSON.parse(taskInput) as unknown;
    const compactTaskInput = phaseKey.startsWith('review-')
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

class QualityBlockedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QualityBlockedError';
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

function manuscriptEndingExcerpt(content: string): string {
  const normalized = content.trim();
  if (normalized.length === 0) throw new Error('正文为空，不能提取章末状态');
  return normalized.slice(-600);
}
