import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { assessManuscriptMetaNarration, assessManuscriptParagraphReuse } from '@wenmi/contracts';
import { ArtifactService } from '../artifacts/artifact-service.js';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ChapterCatalogService } from '../chapters/chapter-catalog-service.js';
import { ContextPackService, estimateTokens, type ContextSource } from '../memory/context-pack-service.js';
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
import { StyleCapsuleService } from './style-capsule-service.js';
import { ChapterStateRecoveryService } from './chapter-state-recovery-service.js';
import { WritingOrderService } from './writing-order-service.js';
import { ProductionReviewService, reportsForEditorSynthesis } from './production-review-service.js';
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
import { runWithSqliteBusyRetry } from '../../infrastructure/db/sqlite-busy-retry.js';
import { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import { compactStageSettlementContext } from '../continuity/stage-settlement-presentation.js';
import { WRITER_CONTEXT_POLICY } from '../memory/writer-context-policy.js';
import { ManuscriptQualitySnapshotService } from './manuscript-quality-snapshot-service.js';
import { compileChapterOutlineForWriter } from './chapter-outline-compiler.js';
import { PlanningChainContextService } from './planning-chain-context-service.js';
import { CreationWorkflowProgressService } from './creation-workflow-progress-service.js';
import { BookProfileViewService } from '../books/book-profile-view-service.js';
import {
  buildChapterContinuityAnchors,
  checkChapterContinuityAnchors,
  compactChapterContinuityAnchors,
  parseChapterContinuityAnchors,
  type ChapterContinuityAnchors
} from './continuity-anchor-service.js';

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
      if (run.phase === 'review' && run.review_panel_id !== null) {
        new ProductionWorkflowRepository(this.database).blockReviewPanel(scope, run.review_panel_id);
      }
      const cancelRequested = (this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?`)
        .get(taskId, scope.ownerId, scope.bookId) as { cancel_requested: number } | undefined)?.cancel_requested === 1;
      const qualityBlocked = error instanceof QualityBlockedError;
      const restoredBest = qualityBlocked
        && this.reload(run.pipeline_run_id).current_manuscript_version_id !== run.current_manuscript_version_id;
      const errorCode = cancelRequested ? 'TASK_CANCELLED' : qualityBlocked ? 'QUALITY_BLOCKED' : error instanceof DomainError ? error.code : 'PIPELINE_FAILED';
      this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'failed', error_code = ?, updated_at = ? WHERE pipeline_run_id = ?`)
        .run(errorCode, now, run.pipeline_run_id);
      if (!cancelRequested) {
        this.database.prepare(`UPDATE chapters SET generation_status = ?, updated_at = ?
          WHERE chapter_id = ? AND owner_id = ? AND book_id = ? AND settlement_status <> 'settled'`)
          .run(restoredBest ? 'completed' : 'failed', now, run.chapter_id, scope.ownerId, scope.bookId);
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
      const reviewWriter = operation !== 'review_existing' || existingManuscriptVersionId === null
        ? null
        : this.database.prepare(`
            WITH RECURSIVE lineage(
              manuscript_version_id, parent_version_id, author_agent_id, model_provider, model_id, source_task_id, depth
            ) AS (
              SELECT manuscript_version_id, parent_version_id, author_agent_id, model_provider, model_id, source_task_id, 0
              FROM manuscript_versions
              WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ? AND chapter_id = ?
              UNION ALL
              SELECT parent.manuscript_version_id, parent.parent_version_id, parent.author_agent_id,
                parent.model_provider, parent.model_id, parent.source_task_id, lineage.depth + 1
              FROM manuscript_versions parent
              JOIN lineage ON parent.manuscript_version_id = lineage.parent_version_id
              WHERE parent.owner_id = ? AND parent.book_id = ? AND parent.chapter_id = ? AND lineage.depth < 64
            )
            SELECT lineage.author_agent_id AS writer_agent_id,
              COALESCE(call.model_snapshot_id, b.model_snapshot_id, agent.model_snapshot_id) AS writer_model_snapshot_id
            FROM lineage
            LEFT JOIN model_calls call ON call.owner_id = ? AND call.book_id = ?
              AND call.task_id = lineage.source_task_id AND call.agent_id = lineage.author_agent_id
              AND call.provider = lineage.model_provider AND call.model_id = lineage.model_id AND call.state = 'succeeded'
            LEFT JOIN agent_model_bindings b ON b.owner_id = ? AND b.book_id = ?
              AND b.agent_model_binding_revision_id = ? AND b.agent_id = lineage.author_agent_id
              AND b.provider = lineage.model_provider AND b.model_id = lineage.model_id AND b.status = 'active'
            LEFT JOIN agent_instances agent ON agent.owner_id = ? AND agent.book_id = ?
              AND agent.agent_id = lineage.author_agent_id AND agent.enabled = 1
            WHERE lineage.model_provider <> 'manual'
              AND COALESCE(call.model_snapshot_id, b.model_snapshot_id, agent.model_snapshot_id) IS NOT NULL
            ORDER BY lineage.depth, call.completed_at DESC LIMIT 1
          `).get(
            existingManuscriptVersionId, scope.ownerId, scope.bookId, run.chapter_id,
            scope.ownerId, scope.bookId, run.chapter_id,
            scope.ownerId, scope.bookId,
            scope.ownerId, scope.bookId, run.binding_revision_id,
            scope.ownerId, scope.bookId
          ) as {
            writer_agent_id: string; writer_model_snapshot_id: string;
          } | undefined;
      if (operation === 'review_existing' && reviewWriter === undefined) {
        throw new QualityBlockedError('定稿审校无法从不可变稿件和冻结模型绑定核实真实写手，已拒绝用默认主笔冒充作者');
      }
      const effectiveWriterAgentId = reviewWriter?.writer_agent_id ?? run.writer_agent_id;
      const effectiveWriterModelSnapshotId = reviewWriter?.writer_model_snapshot_id ?? run.writer_model_snapshot_id;
      if (chapter.settlement_status === 'settled' && operation === null) return this.advance(run, 'completed');
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
      const revisingSettled = chapter.settlement_status === 'settled' && operation !== null;
      const outlineVersionId = revisingSettled
        ? this.settledRevisionOutlineVersionId(scope, run.chapter_id, existingManuscriptVersionId)
        : new WritingReadinessService(this.database).outlineVersionId(scope, chapter.chapter_number);
      const outline = artifacts.requireVersion(scope, outlineVersionId);
      new PlanningChainContextService(this.database).validate(
        scope, outline.artifactVersionId, revisingSettled ? 'historical' : 'active'
      );
      const contractContent = {
        chapterId: run.chapter_id,
        pov: '服从老板已确认的创作方案；未明确时采用第三人称限知',
        tense: '服从老板已确认的创作方案；未明确时采用现代中文小说常用叙事时态',
        targetWords: 2_900,
        hardConstraints: ['优先2700至3200有效字，且不得少于2350或超过3650', '不得占位', '服从当前正史', '不得脱离已确认章纲补造关键设定', `章纲版本：${outlineVersionId}`]
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
      const objective = firstString(
        outlineContent.chapterFunction,
        outlineContent.goal,
        outlineContent.objective
      ) ?? `完成第${chapter.chapter_number}章已确认章纲`;
      const outlineCast = Array.isArray(outlineContent.cast)
        ? outlineContent.cast
          .filter(isRecordValue)
          .map((participant) => firstString(participant.name))
          .filter((name): name is string => name !== null)
        : [];
      const outlineEnding = isRecordValue(outlineContent.ending) ? outlineContent.ending : {};
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
          participants: outlineCast.length > 0
            ? outlineCast
            : Array.isArray(outlineContent.participants) ? outlineContent.participants : [],
          endingInterface: firstString(
            outlineEnding.nextChapterInterface,
            outlineEnding.hook,
            outlineContent.hook
          ) ?? '形成可追踪的章末状态'
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
        .beginOrder(scope, effectiveWriterAgentId, order.writingOrderId, { taskId: run.task_id, chapterId: run.chapter_id, phase: 'preflight' });
      this.database.prepare(`
        UPDATE chapters SET plan_status = 'ready', generation_status = 'working', updated_at = ?
        WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
      `).run(this.clock.now().toISOString(), run.chapter_id, scope.ownerId, scope.bookId);
      this.database.prepare(`
        UPDATE chapter_pipeline_runs SET outline_version_id = ?, writing_contract_version_id = ?,
          writing_order_id = ?, writer_agent_id = ?, writer_model_snapshot_id = ?, writer_epoch = ?, current_manuscript_version_id = ?, phase = ?,
          status = 'working', updated_at = ? WHERE pipeline_run_id = ?
      `).run(outline.artifactVersionId, selectedContract.artifactVersionId, order.writingOrderId,
        effectiveWriterAgentId, effectiveWriterModelSnapshotId, lease.epoch,
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
      SELECT e.state_json, c.canon_manuscript_version_id
      FROM chapters c JOIN chapter_end_states e ON e.chapter_end_state_id = c.chapter_end_state_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number < ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapter.chapter_number) as {
      state_json: string;
      canon_manuscript_version_id: string;
    } | undefined;
    const continuity = new LongformContinuityRepository(this.database);
    const settlements = continuity.writerSettlementContext(scope, chapter.chapter_number, 3);
    const commitments = continuity.listCommitments(scope, chapter.chapter_number).slice(0, 8);
    const draftPolicy = WRITER_CONTEXT_POLICY.draft;
    const style = new StyleCapsuleService(this.database).active(scope);
    const openingProfile = new BookProfileViewService(this.database).find(scope);
    const workOrder = compactWriterWorkOrder(outline.content, contract.content, draftPolicy.workOrderMaximum);
    const hardSources: ContextSource[] = [
      {
        sourceType: 'system_rule',
        sourceId: 'writing-safety-v2',
        content: '只写本章正文；服从已确认正史与本章工单；不得写占位、解释或擅自新增重大设定。',
        reason: '正文生产硬规则',
        priority: 100
      },
      {
        sourceType: 'chapter_work_order',
        sourceId: `${run.outline_version_id}:${run.writing_contract_version_id}`,
        content: workOrder,
        reason: '本章唯一目标、章纲与写作契约，合计不超过1500字',
        priority: 100,
        version: `${outline.version}:${contract.version}`
      },
      ...(openingProfile === null ? [] : [{
        sourceType: 'opening_profile',
        sourceId: `opening-profile:${scope.bookId}:${openingProfile.version}`,
        content: clipContext(JSON.stringify({
          title: openingProfile.title,
          category: openingProfile.category,
          subjects: openingProfile.subjects,
          mainTags: openingProfile.mainTags,
          protagonists: openingProfile.protagonists.map((protagonist) => ({
            role: protagonist.role,
            name: protagonist.name,
            age: protagonist.age,
            background: protagonist.background,
            personalities: protagonist.personalities
          })),
          storyDirection: openingProfile.storyDirection,
          mustFollow: openingProfile.mustFollow
        }), draftPolicy.openingProfileMaximum),
        reason: '老板确认的开书定位、人物、故事方向和必须遵守项；正文不得擅自改写专名或核心方向',
        priority: 100,
        version: openingProfile.version
      }]),
      {
        sourceType: 'style_baseline',
        sourceId: style.styleVersionId,
        content: style.capsule,
        reason: '可追溯的场景表达短胶囊；按本章功能动态选择，不机械打卡',
        priority: 100,
        version: style.styleVersionId
      },
      ...(settlements.length === 0 ? [] : [{
        sourceType: 'stage_settlement_context',
        sourceId: settlements.map((item) => item.settlementId).join(':'),
        content: compactStageSettlementContext(settlements, draftPolicy.stageSettlementMaximum),
        reason: '按卷总结、最近剧情阶段和阶段后章节分层压缩；需要细节时再按来源回查正史原文',
        priority: 99,
        version: settlements.map((item) => item.version).join(':')
      }])
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
    if (previous !== undefined) {
      const previousAnchors = parseChapterContinuityAnchors(previous.state_json)
        ?? buildChapterContinuityAnchors(this.loadManuscript(scope, previous.canon_manuscript_version_id));
      hardSources.push({
        sourceType: 'previous_chapter_end',
        sourceId: `previous:${chapter.chapter_number - 1}`,
        content: clipContext(previous.state_json, draftPolicy.previousStateMaximum),
        reason: '前章结尾后的当前人物与场景状态',
        priority: 100
      });
      hardSources.push({
        sourceType: 'previous_chapter_tail',
        sourceId: previous.canon_manuscript_version_id,
        content: tailContext(this.loadManuscript(scope, previous.canon_manuscript_version_id), draftPolicy.previousTailMaximum),
        reason: '前章结尾原文，用于保持相邻章动作、语气和钩子连续',
        priority: 100
      });
      hardSources.push({
        sourceType: 'previous_chapter_anchors',
        sourceId: `anchors:${previous.canon_manuscript_version_id}`,
        content: clipContext(compactChapterContinuityAnchors(previousAnchors), 450),
        reason: '前章全文提取的稳定编号、专名和机构锚点；相同对象不得无解释改名或改号',
        priority: 100
      });
    }
    if (commitments.length > 0) {
      hardSources.push({
        sourceType: 'active_commitments',
        sourceId: `commitments:${scope.bookId}:${chapter.chapter_number}`,
        content: clipContext(JSON.stringify(commitments.map((item) => ({
          id: item.commitmentId,
          type: item.type,
          title: item.title,
          description: item.description,
          status: item.status,
          due: [item.earliestDueChapter, item.latestDueChapter]
        }))), draftPolicy.commitmentsMaximum),
        reason: '仍开放且可能影响本章的伏笔、承诺和因果债',
        priority: 98
      });
    }
    const retrievalSources = await new RetrievalContextSourceService(this.retrieval).collect(scope, {
      query: JSON.stringify({ chapterNumber: chapter.chapter_number, title: chapter.title, outline: outline.content, contract: contract.content }),
      roleKey: 'lead_writer', mode: 'drafting', canonRevision: run.expected_canon_revision,
      taskId: run.task_id, sourceTypes: ['manuscript', 'fact', 'outline', 'setting', 'wiki', 'voice'], limit: 8
    });
    hardSources.push(...retrievalSources.hardSources.slice(0, 4).map((source) => ({
      ...source,
      content: clipContext(source.content, draftPolicy.hardRetrievalMaximum),
      reason: `${source.reason}；已按主笔最小资料包压缩`
    })));
    const optionalSources = retrievalSources.optionalSources.slice(0, 6).map((source) => ({
      ...source,
      content: clipContext(source.content, draftPolicy.optionalRetrievalMaximum)
    }));
    new CopyrightService(this.database, this.ids, this.clock).assertWriterContextSafe([...hardSources, ...optionalSources]);
    const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
      taskId: run.task_id,
      agentId: run.writer_agent_id,
      chapterId: run.chapter_id,
      canonRevision: run.expected_canon_revision,
      positioningVersion: run.expected_positioning_version,
      outlineVersionId: run.outline_version_id,
      writingContractVersionId: run.writing_contract_version_id,
      tokenBudget: taskBrief.operation === 'rewrite_existing'
        ? WRITER_CONTEXT_POLICY.ownerRewrite.tokenBudget
        : draftPolicy.tokenBudget,
      characterBudget: taskBrief.operation === 'rewrite_existing'
        ? WRITER_CONTEXT_POLICY.ownerRewrite.characterBudget
        : draftPolicy.characterBudget,
      policyVersion: taskBrief.operation === 'rewrite_existing'
        ? WRITER_CONTEXT_POLICY.ownerRewrite.policyVersion
        : draftPolicy.policyVersion,
      hardSources,
      optionalSources
    });
    runWithSqliteBusyRetry(() => this.database
      .prepare(`UPDATE chapter_pipeline_runs SET context_pack_id = ?, phase = 'draft', updated_at = ? WHERE pipeline_run_id = ?`)
      .run(pack.contextPackId, this.clock.now().toISOString(), run.pipeline_run_id));
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
      previousState: previous === undefined
        ? '故事刚刚开始'
        : '上一章已定稿；必须从资料包中的前章结尾原文和事实锚点自然承接，不得输出JSON、字段名、版本号或资料来源。',
      lengthContract: writerLengthContract(),
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
    const hardCheck = this.evaluateHardChecks(scope, run, content);
    this.recordHardCheck(scope, run, run.current_manuscript_version_id, hardCheck);
    const { passed } = hardCheck;
    if (!passed) {
      if (run.rewrite_count >= 2) throw new QualityBlockedError('两轮定点修复后正文硬检查仍未通过，已停止机械补写');
      return this.advance(run, 'rewrite');
    }
    const copyright = new CopyrightService(this.database, this.ids, this.clock)
      .checkTargetAgainstAllSources(scope, 'manuscript', run.current_manuscript_version_id, content);
    if (copyright.decision !== 'pass') {
      throw new DomainError(errorCodes.copyrightBlocked, '正文版权检查未通过，必须重新设计', { copyright }, false, 409);
    }
    if (this.taskBrief(scope, run.task_id).productionMode === 'trial_draft') {
      return this.advance(run, 'completed');
    }
    return this.advance(run, 'review');
  }

  private async review(scope: BookScope, run: PipelineRow): Promise<PipelineRow> {
    if (run.current_manuscript_version_id === null) throw new Error('审校缺少正文版本');
    const manuscriptVersionId = run.current_manuscript_version_id;
    if (run.writing_order_id === null || run.writer_epoch === null
      || run.outline_version_id === null || run.writing_contract_version_id === null) {
      throw new Error('审校缺少冻结章纲、写作契约、工单或写手epoch');
    }
    const writerLease = this.renewWriterForModelPhase(scope, run);
    const content = this.loadManuscript(scope, manuscriptVersionId);
    const artifacts = new ArtifactService(this.database, this.ids, this.clock);
    const frozenOutline = artifacts.requireVersion(scope, run.outline_version_id);
    const frozenContract = artifacts.requireVersion(scope, run.writing_contract_version_id);
    const chapter = this.requireChapter(scope, run.chapter_id);
    const previousChapter = this.database.prepare(`
      SELECT e.state_json, c.canon_manuscript_version_id FROM chapters c JOIN chapter_end_states e
        ON e.chapter_end_state_id = c.chapter_end_state_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number < ?
        AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapter.chapter_number) as {
      state_json: string; canon_manuscript_version_id: string;
    } | undefined;
    const frozenReviewSources: ContextSource[] = [
      {
        sourceType: 'chapter_outline', sourceId: run.outline_version_id,
        content: JSON.stringify(frozenOutline.content), reason: '本章审校必须核对的冻结章纲',
        priority: 100, version: frozenOutline.version
      },
      {
        sourceType: 'writing_contract', sourceId: run.writing_contract_version_id,
        content: JSON.stringify(frozenContract.content), reason: '本章审校必须核对的冻结写作契约',
        priority: 100, version: frozenContract.version
      },
      ...(previousChapter === undefined ? [] : [{
        sourceType: 'previous_chapter_end', sourceId: `previous:${chapter.chapter_number - 1}`,
        content: previousChapter.state_json, reason: '前一章已结算的硬状态', priority: 99
      }, {
        sourceType: 'previous_chapter_tail', sourceId: previousChapter.canon_manuscript_version_id,
        content: tailContext(this.loadManuscript(scope, previousChapter.canon_manuscript_version_id), 800),
        reason: '前一章定稿结尾；只用于核对相邻章动作、人物位置和因果衔接', priority: 98
      }, {
        sourceType: 'previous_chapter_anchors', sourceId: `anchors:${previousChapter.canon_manuscript_version_id}`,
        content: compactChapterContinuityAnchors(
          parseChapterContinuityAnchors(previousChapter.state_json)
            ?? buildChapterContinuityAnchors(this.loadManuscript(scope, previousChapter.canon_manuscript_version_id))
        ),
        reason: '前章全文提取的稳定编号、专名和机构锚点；核对同一对象是否无解释漂移', priority: 99
      }])
    ];
    const revisionOperation = this.taskBrief(scope, run.task_id).operation;
    const planningMode = chapter.settlement_status === 'settled'
      && (revisionOperation === 'review_existing' || revisionOperation === 'rewrite_existing')
      ? 'historical' as const
      : 'active' as const;
    const planningFactSources = new PlanningChainContextService(this.database)
      .factReviewSources(scope, frozenOutline.artifactVersionId, planningMode);
    const boundedFrozenReviewSources = frozenReviewSources.map((source) => ({
      ...source,
      content: clipContext(source.content,
        source.sourceType === 'writing_contract' ? 1_000
          : source.sourceType === 'previous_chapter_end' ? 500
            : source.sourceType === 'previous_chapter_tail' ? 400
              : source.sourceType === 'previous_chapter_anchors' ? 450
              : 700)
    }));
    const manuscriptHash = createHash('sha256').update(content).digest('hex');
    const writerModel = this.modelIdentity(scope, run.writer_model_snapshot_id);
    const workflowRepository = new ProductionWorkflowRepository(this.database);
    const reviews = new ProductionReviewService(workflowRepository, this.ids, this.clock);
    if (run.review_panel_id !== null) workflowRepository.blockReviewPanel(scope, run.review_panel_id);
    const resumedPanel = reviews.resumeIncompletePanel(scope, {
      manuscriptVersionId,
      manuscriptHash,
      writerModelSnapshotId: run.writer_model_snapshot_id,
      canonRevision: run.expected_canon_revision,
      bindingRevisionId: run.binding_revision_id
    });
    const usedReviewRounds = (this.database.prepare(`
      SELECT review_round FROM review_panels
      WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ?
      ORDER BY review_round
    `).all(scope.ownerId, scope.bookId, manuscriptVersionId) as unknown as Array<{ review_round: number }>)
      .map((row) => row.review_round);
    const completedExactManuscriptAttempts = (this.database.prepare(`
      SELECT COUNT(*) AS attempt_count FROM review_panels
      WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ? AND status IN ('complete', 'blocked')
    `).get(scope.ownerId, scope.bookId, manuscriptVersionId) as { attempt_count: number }).attempt_count;
    const reviewRound = nextExactManuscriptReviewAttempt(usedReviewRounds, resumedPanel?.reviewRound);
    const revisionRound = revisionRoundForRewriteCount(run.rewrite_count);
    if (hasExhaustedExactManuscriptReviewAttempts(completedExactManuscriptAttempts, resumedPanel !== null)) {
      throw new QualityBlockedError('同一正文已完成三次独立审校尝试，仍未形成可用报告；已停止继续消耗套餐额度');
    }
    const panel = resumedPanel ?? reviews.openPanel(scope, {
      chapterId: run.chapter_id, manuscriptVersionId, manuscriptHash,
      reviewRound, writerAgentId: run.writer_agent_id, writerProvider: writerModel.provider,
      writerModelId: writerModel.modelId, writerModelSnapshotId: run.writer_model_snapshot_id, writerEpoch: run.writer_epoch,
      writingOrderId: run.writing_order_id, canonRevision: run.expected_canon_revision,
      bindingRevisionId: run.binding_revision_id
    });
    this.database.prepare(`UPDATE chapter_pipeline_runs SET review_panel_id = ?, updated_at = ? WHERE pipeline_run_id = ?`)
      .run(panel.panelId, this.clock.now().toISOString(), run.pipeline_run_id);
    const reviewPromises = panel.reviewers.map(async (reviewer): Promise<ProductionReview> => {
      const existingReport = reviews.existingReport(scope, {
        panelId: panel.panelId,
        role: reviewer.role,
        manuscriptVersionId,
        modelSnapshotId: reviewer.agent.modelSnapshotId
      });
      if (existingReport !== null) return existingReport;
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
        limit: reviewer.role === 'fact' ? 8 : 6
      });
      const factPreviousChapterSource: ContextSource[] = reviewer.role === 'fact' && previousChapter !== undefined
        ? [{
            sourceType: 'previous_chapter_full',
            sourceId: previousChapter.canon_manuscript_version_id,
            content: clipContext(this.loadManuscript(scope, previousChapter.canon_manuscript_version_id), 6_000),
            reason: '事实席专用的前一章完整定稿；先逐项对照实体客观字段，再核对因果与知情状态',
            priority: 100
          }]
        : [];
      const roleFrozenReviewSources = reviewer.role === 'fact'
        ? boundedFrozenReviewSources.filter((source) => !['previous_chapter_tail', 'previous_chapter_anchors'].includes(source.sourceType))
        : boundedFrozenReviewSources;
      const reviewCharacterBudget = reviewer.role === 'fact' ? 15_000 : 8_500;
      const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
        taskId: run.task_id, agentId: reviewer.agent.agentId, chapterId: run.chapter_id,
        canonRevision: run.expected_canon_revision, positioningVersion: run.expected_positioning_version,
        tokenBudget: reviewCharacterBudget,
        characterBudget: reviewCharacterBudget,
        policyVersion: reviewer.role === 'fact'
          ? 'production-review-fact-context-v5-planning-chain-15000chars'
          : `production-review-${reviewer.role}-context-v2-8500chars`,
        hardSources: [
          { sourceType: 'current_manuscript', sourceId: manuscriptVersionId, content, reason: '三点评席共同读取的同一不可变完整正文', priority: 100 },
          ...roleFrozenReviewSources,
          ...factPreviousChapterSource,
          ...(reviewer.role === 'fact' ? planningFactSources : []),
          ...reviewerSources.hardSources.slice(0, 1).map((source) => ({
            ...source,
            content: clipContext(source.content, 300)
          }))
        ],
        optionalSources: reviewerSources.optionalSources
      });
      const adapter = this.modelAdapters.resolve(reviewer.agent.provider, reviewer.agent.modelId, 'novel_reviewer', reviewer.agent.roleKey as never);
      const reviewPhase = `review-${reviewRound}-${reviewer.role}-${panel.panelId}`;
      const requiredSchema = productionReviewOutputContract(reviewer.role, {
        reviewerRole: reviewer.role,
        manuscriptVersionId,
        modelSnapshotId: reviewer.agent.modelSnapshotId
      });
      const reviewPrompt = JSON.stringify({
          reviewerRole: reviewer.role,
          manuscriptVersionId,
          modelSnapshotId: reviewer.agent.modelSnapshotId,
          requiredSchema,
          sourceBoundaryContract: [
            'sources中sourceType=current_manuscript且order=0的是本轮唯一待审正文；所有retrieval:*来源都是已定稿前史或参考资料，不是本章的重复片段。',
            '事实席还会收到sourceType=previous_chapter_full的前一章完整定稿；它只用于逐项核对相邻章节中同一人物、物件、场所、制度和时间细节，不得把前章动作归入本章。',
            '事实席必须执行两遍检查：第一遍按同一实体逐项比较编号及编号种类、日期时间、颜色材质、数量尺寸、位置、身份/状态和已经完成的动作；第二遍再检查因果链、人物知情与规则。发现明确不同值时必须引用当前稿和前章定稿两端。',
            '评价本章动机、节奏、视角和语言时，只能把current_manuscript中的动作归入本章；检索前史仅用于核对时间顺序与已确认事实，不得把前史事件冒充本章事件。',
            '声称人物动机矛盾时，必须分别引用current_manuscript中的当前动机证据和已定稿前史中的冲突证据，并说明两者为何不能按时间先后、意外后果、信息差或开放谜团同时成立。',
            '不得仅凭行为后果推断主观故意；文本没有明确建立故意时，意外携带、争抢、失误和未知原因不能改写成蓄意行为。'
          ],
          severityRubric: reviewer.role === 'fact'
            ? [
                'pass只能包含minor或observation；存在major必须为rewrite；存在不能自动修复的blocker必须为blocked。',
                'major必须证明同一稿件内部自相矛盾、违反已确认正史/规则、人物状态不可能或因果动作不可成立，并引用冲突两端。',
                '局部说明不足、可由常识合理推断的动作、开放谜团、尚未解释的异常机制和可选设定建议只能是minor或observation；缺少解释本身不是矛盾。',
                '只有问题存在两个都自洽的阅读方式、属于措辞偏好或局部说明不足时，才可判minor/pass。若同一实体的编号种类、日期时间、颜色材质、数量尺寸、位置、身份/状态或已完成动作与前章定稿明确不同，必须判major/rewrite；即使只需补充、删除或替换一两句，也不得因修复成本低而降级。',
                '前文已经出现但本章没有再次复述的细节，不能仅凭“未提及”判为major。只有本章明确否认该事实、遗漏使因果动作无法成立，或该细节属于章纲/写作工单硬要求时，才可判major；否则最多minor。',
                'retrieval:fact中的H车道objective正史事实优先于人物说法、旧章节中的当时认知和conflicted/claim资料；早期误认死亡、后续发现假尸或本人归队属于时间推进，不是正文自相矛盾。',
                '发现资料冲突时必须比较认识状态、正史修订与叙事先后；claim或conflicted资料不能单独推翻objective事实，也不能要求老板重复裁决已经在后续正史中解决的信息。'
              ]
            : reviewer.role === 'literary'
              ? [
                  'pass只能包含minor或observation；存在major必须为rewrite；存在不能自动修复的blocker必须为blocked。',
                  'major只用于核心人物动机无法成立、场景因果断裂、全文持续性语言问题或章末钩子失效，必须说明不修会怎样破坏本章。',
                  '局部AI腔、单句替换偏好、可选意象、故意留白、开放谜团、节奏微调和另一种同样成立的表达只能是minor或observation；不得要求唯一措辞。',
                  '若requiredAction只需补充、删除或替换一两句，添加身份/前情注记、动作过渡或认知提示，精简副词或增加微反应，则属于局部低成本建议，severity最高只能是minor且verdict应为pass；不得用major强制偏好的解释密度。',
                  '人物知晓危险并不排除饥渴、恐惧、犹豫、冲动或隐瞒等同时存在的动机；除非正文明确证明两种状态在同一时刻不可共存，否则不得判为动机断裂。',
                  '正史、时间线、世界规则和设定边界的客观裁决属于事实席；文学席可记录阅读疑点，但不得仅因新线索尚未解释或缺少前置说明就判定lore/canon/continuity blocker。'
                ]
              : [
                  'pass只能包含minor或observation；存在major必须为rewrite；存在不能自动修复的blocker必须为blocked。',
                  'major只用于会显著造成跳读/弃读、情绪逻辑断裂或核心钩子不可理解的问题；低成本体验优化只能是minor。',
                  '若requiredAction只需补充、删除或替换一两句，添加身份/前情注记、动作过渡、微反应或一句钩子台词，则severity最高只能是minor且verdict应为pass。',
                  '长篇连载章节可以直接承接上一章并从动作中开始，不强制每章复述前情；只要当前场景可理解，缺少回顾最多是observation。正文已用岗位称呼、持有物或行动展示职责时，不得仅因没有背景履历判定人物根基缺失。',
                  '政治/情色风险等级必须基于明确政策证据，不能由题材、冲突强度或个人不适推断。'
                ],
          ...(adapter.provider.startsWith('local-deterministic') ? { content } : {}),
          factExtractionScope: reviewer.role === 'fact'
            ? '逐项检查正文中实际出现且会影响后续的人物、势力、地点、道具/资源、规则、事件、关系与状态；只保存有正文原句证据的类别，不要求凑齐，不得把规划或猜测写成事实。' : undefined,
          contract: reviewer.role === 'literary'
            ? '返回带段落计数、可解释证据且isAuthorshipProbability=false的aiStyle对象'
            : reviewer.role === 'experience'
              ? '分别返回politicalRisk和sexualContentRisk，包含位置、证据、动作和policyVersion'
              : '核对连续性、人物状态、因果与硬约束，最多返回8个最重要问题；另返回最多16条factCandidates，只保留会影响后续章节的持久事实。每条含subjectName、entityType、relationKey、value、正文原句evidenceQuote、evidenceLocation、epistemicStatus、negated、viewpointName、knowledgeSubjectName、knowledgeTimeStart、knowledgeTimeEnd、storyTimeStart、storyTimeEnd；未知字段使用null，不得把主体猜成观点/知情主体，不确定、梦境、谎言或角色认知不得冒充objective。人物关系必须使用 relationship.<关系类型> 作为 relationKey（例如 relationship.acquaintance），value只填写另一方的准确姓名，不得使用“角色关系”等自由键，也不得把整段关系说明塞进value。对正文明确写出的持久资料，可按实际语义使用可选键：人物age、personality、affiliation、realm、strength、attributes、equipment；势力leader、member_count、strength、level、base、position、members；地点birthplace、type、parent、direction、description；道具或资源owner、type、level、amount、attributes、effects、status、acquire、lost。以上只是帮助正确归类的命名参考，不要求每个对象或章节凑齐；正文没写明就不输出。主角当前状态只在正文明确给出且对后续创作有持续价值时记录，使用 protagonist_state.<本书分类>.<状态键>（绝对值）或 protagonist_delta.<本书分类>.<状态键>（增减值）；分类必须随本书内容生成，无法可靠归类时写 unclassified 以请求作者确认，不得硬套固定模板，也不得记录转瞬即逝的动作、情绪或从模糊文学描写猜测数值'
        });
      let output: string;
      try {
        output = await this.executeModel(
          scope, run, reviewPhase, reviewer.agent.agentId, reviewer.agent.modelSnapshotId,
          adapter, reviewPrompt, pack.contextPackId
        );
      } catch (error) {
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
            scope, run, `review-repair-${reviewRound}-${reviewer.role}-${panel.panelId}`,
            reviewer.agent.agentId, reviewer.agent.modelSnapshotId, adapter,
            JSON.stringify({
              operation: 'repair_review_json',
              validationError: firstValidationError instanceof Error ? firstValidationError.message : String(firstValidationError),
              invalidOutput: output.slice(0, 12_000),
              originalContract: JSON.parse(reviewPrompt) as unknown,
              requiredSchema,
              instruction: '严格按requiredSchema修正JSON结构、英文键名、英文枚举和版本绑定；verdict只允许pass|rewrite|blocked，issue只允许location、issueType、severity、evidence、requiredAction；不得新增正文中没有的证据，只输出一个JSON对象。'
            }),
            pack.contextPackId
          );
          return reviews.persist(scope, {
            panelId: panel.panelId, role: reviewer.role, manuscriptVersionId,
            modelSnapshotId: reviewer.agent.modelSnapshotId, agentId: reviewer.agent.agentId, raw: repaired,
            inputTokens: estimateTokens(content), allowDroppingInvalidFactCandidates: true, normalizeLocalBlockers: true,
            normalizeAiStyleEvidence: true, normalizeRepairedVerdict: true, normalizeMalformedJsonStrings: true,
            normalizeRiskArrays: true, normalizeScoreArray: true, normalizeIssueLocations: true,
            normalizeRepairedSeverity: true, normalizeIssueFieldAliases: true,
            normalizeFrozenBindings: true, normalizeProvisionalDraftBlockers: true,
            normalizeFactOmissionMajor: true
          });
        } catch (repairError) {
          throw new QualityBlockedError(`点评报告定向修复一次后仍未通过：${repairError instanceof Error ? repairError.message : String(repairError)}`);
        }
      }
    });
    // 三席必须真正结束后再让任务进入终态。Promise.all 会在首个失败时提前返回，
    // 使其余真实模型调用在租约释放后变成“结果未知”；allSettled 保留完整审计证据。
    const settledReviews = await Promise.allSettled(reviewPromises);
    const failedReviews = settledReviews.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
    if (failedReviews.length > 0) {
      workflowRepository.blockReviewPanel(scope, panel.panelId);
      const first = failedReviews[0]!.reason;
      throw first instanceof QualityBlockedError
        ? first
        : new QualityBlockedError(`点评席未完成：${first instanceof Error ? first.message : String(first)}`);
    }
    const reports = settledReviews.map((item) => (item as PromiseFulfilledResult<ProductionReview>).value);
    const synthesisReports = reportsForEditorSynthesis(reports);
    const activeEditor = this.database.prepare(`SELECT active_editor_agent_id FROM books
      WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { active_editor_agent_id: string | null } | undefined;
    const editor = activeEditor?.active_editor_agent_id === null || activeEditor === undefined
      ? undefined
      : workflowRepository.currentTeam(scope, run.binding_revision_id)
          .find((agent) => agent.agentId === activeEditor.active_editor_agent_id);
    if (editor === undefined) throw new QualityBlockedError('当前模型绑定缺少活动主编，不能综合三席报告');
    const editorSharesReviewerModel = panel.reviewers.some((reviewer) =>
      reviewer.agent.provider === editor.provider && reviewer.agent.modelId === editor.modelId);
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
        content: JSON.stringify(synthesisReports),
        reason: '主编只综合三份结构化点评，不读取正文进行第四次点评',
        priority: 100
      }],
      optionalSources: []
    });
    const editorAdapter = this.modelAdapters.resolve(editor.provider, editor.modelId, 'review_synthesis', editor.roleKey as never);
    // P0-4: 主编综合调用前按真实任务心跳续租，避免主编租约因无续期而过期被误判为 stable
    new EditorLeaseService(this.database, this.ids, this.clock).heartbeatRenew(scope, editor.agentId);
    let synthesisRaw: string;
    try {
      synthesisRaw = await this.executeModel(
        scope,
        run,
        `editor-synthesis-${reviewRound}-${panel.panelId}`,
        editor.agentId,
        editor.modelSnapshotId,
        editorAdapter,
        JSON.stringify({
          operation: 'review_synthesis',
          panelId: panel.panelId,
          manuscriptVersionId,
          reports: synthesisReports,
          editorModelIndependence: {
            sharesProviderAndModelWithReviewer: editorSharesReviewerModel,
            rule: editorSharesReviewerModel
              ? '主编综合与一名点评席共享模型来源；必须披露重合，且不能把该席与主编视为两份独立佐证。'
              : '主编综合与三名点评席不存在模型来源重合。'
          },
          rules: [
            '只综合三席已提交的结构化报告，不推测正文中未被报告指出的问题',
            '不能降级任何blocker、重大问题或高等级合规风险',
            '按修改收益与牵连范围排列问题索引，并保留真实分歧',
            '三席不是简单多数投票，但单个主观席也不是共识；缺少独立佐证的文学或体验异议必须作为异议保留，不能追逐每轮变化的风格目标。',
            '客观正史、时间线和事实连续性由事实席负责核验。若只有文学席把这类问题标为blocker，而事实席以明确证据判定通过、体验席也未阻断，主编必须保留分歧并要求一次定点复核，不得把文学席与同源主编当成两份独立佐证，也不得直接要求老板重复裁决已结算正史。',
            '两轮有界改写后，如果事实席和另一独立席通过，且没有blocker、安全、合规、客观连续性或跨席硬问题，应把剩余主观异议交给老板确认，不得下达第三轮改写。'
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
      const synthesisPhase = `editor-synthesis-${reviewRound}-${panel.panelId}`;
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
          scope, run, `editor-synthesis-repair-${reviewRound}-${panel.panelId}`,
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
          issueCount: reports.flatMap((report) => report.issues).length,
          normalizeRepairedShape: true,
          normalizeMalformedJsonStrings: true
        });
      } catch (repairError) {
        workflowRepository.blockReviewPanel(scope, panel.panelId);
        throw new QualityBlockedError(`主编综合定向修复一次后仍未通过：${repairError instanceof Error ? repairError.message : String(repairError)}`);
      }
    }
    writerLease.assertCanCommit(scope, run.writer_agent_id, run.writer_epoch);
    const merged = reviews.merge(scope, {
      panelId: panel.panelId, manuscriptVersionId,
      revisionRound, reports, editorSynthesis
    });
    const qualitySnapshots = new ManuscriptQualitySnapshotService(
      this.database, this.ids, this.clock
    );
    const quality = qualitySnapshots.record(scope, {
      chapterId: run.chapter_id,
      manuscriptVersionId,
      reviewPanelId: panel.panelId,
      reports
    });
    const operation = this.taskBrief(scope, run.task_id).operation;
    if (shouldRestorePreviousBest(operation, quality.retainPreviousBest)
      && quality.bestVersionId !== null) {
      qualitySnapshots.restoreBest(scope, {
        chapterId: run.chapter_id,
        rejectedVersionId: manuscriptVersionId,
        bestVersionId: quality.bestVersionId,
        pipelineRunId: run.pipeline_run_id
      });
      if (quality.hardBlocked) {
        throw new QualityBlockedError('三异模型点评发现硬阻断问题；已保留问题证据并恢复上一最佳稿');
      }
      const bestPanel = this.database.prepare(`
        SELECT review_panel_id FROM manuscript_quality_snapshots
        WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND manuscript_version_id = ?
        ORDER BY created_at DESC, manuscript_quality_snapshot_id DESC LIMIT 1
      `).get(scope.ownerId, scope.bookId, run.chapter_id, quality.bestVersionId) as {
        review_panel_id: string;
      } | undefined;
      if (bestPanel === undefined) {
        throw new QualityBlockedError('已恢复上一最佳稿，但缺少可追溯的三席点评快照');
      }
      this.database.prepare(`
        UPDATE chapter_pipeline_runs
        SET current_manuscript_version_id = ?, review_panel_id = ?, phase = 'facts', updated_at = ?
        WHERE pipeline_run_id = ?
      `).run(
        quality.bestVersionId,
        bestPanel.review_panel_id,
        this.clock.now().toISOString(),
        run.pipeline_run_id
      );
      return this.reload(run.pipeline_run_id);
    }
    if (merged.verdict === 'blocked') {
      if (quality.hardBlocked) {
        throw new QualityBlockedError('三异模型点评发现事实、连续性或合规硬阻断问题，已保留稿件和证据');
      }
      // Literary and experience disagreements must remain visible to the owner,
      // but they must not create a dead end after the bounded automatic rewrite.
      return this.advance(run, 'facts');
    }
    if (merged.verdict === 'rewrite') {
      if (!shouldAutomaticallyRewriteReview(operation, run.rewrite_count)) {
        return this.advance(run, 'facts');
      }
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
    if (requiredActions.length === 0) {
      const hardCheck = this.database.prepare(`
        SELECT checks_json FROM hard_check_results
        WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ? AND passed = 0
        ORDER BY created_at DESC, hard_check_id DESC LIMIT 1
      `).get(scope.ownerId, scope.bookId, run.current_manuscript_version_id) as { checks_json: string } | undefined;
      if (hardCheck !== undefined) {
        const checks = JSON.parse(hardCheck.checks_json) as {
          length?: {
            passed?: boolean; characterCount?: number;
            targetMinimum?: number; targetMaximum?: number;
            minimum?: number; maximum?: number;
          };
          noPlaceholder?: { passed?: boolean };
          noMarkdownChapterHeading?: { passed?: boolean };
          noInternalWorkflowPayload?: { passed?: boolean };
          noQualityGovernanceNarration?: { passed?: boolean; issues?: Array<{ evidence: string }> };
          noCrossChapterTemplateReuse?: { passed?: boolean; sharedParagraphs?: number; ratio?: number; referenceChapterNumber?: number | null };
          continuityAnchors?: {
            passed?: boolean;
            conflicts?: Array<{ field: string; expected: string[]; actual: string[] }>;
          };
        };
        if (checks.length?.passed === false) {
          const characterCount = checks.length.characterCount;
          const isTooShort = typeof characterCount === 'number'
            && characterCount < (checks.length.minimum ?? 2_350);
          requiredActions.push(
            isTooShort
              ? `全文当前有效字符${characterCount ?? '未知'}，低于硬下限；在不改变事实、人物选择和章末钩子的前提下扩充到2700至3200个汉字、字母或数字有效字符（不计标点和空白）；只补充有因果作用的动作、感官、对话或过渡，禁止同义复述和空泛凑字`
              : `全文当前有效字符${characterCount ?? '未知'}，超过硬上限；在不改变事实、人物选择和章末钩子的前提下压缩到2700至3200个汉字、字母或数字有效字符（不计标点和空白）；优先删除解释、复述和无因果作用的段落`
          );
        }
        if (checks.noPlaceholder?.passed === false) requiredActions.push('删除全部占位标记并补成完整、可阅读的叙事内容');
        if (checks.noMarkdownChapterHeading?.passed === false) requiredActions.push('删除正文中的Markdown章节标题行；章节标题由系统单独显示，正文只能保留小说内容');
        if (checks.noInternalWorkflowPayload?.passed === false) requiredActions.push('删除正文中泄露的JSON、字段名、版本号、来源编号和工作流载荷；只保留自然可读的小说叙事，并完整保持原有情节与长度');
        if (checks.noQualityGovernanceNarration?.passed === false) requiredActions.push('把正文里的资料核对、正式结论、结算说明、质量规则和对读者的解释全部改写为正在发生的场景、动作、对白、感官与后果；不能在小说里解释系统如何管理正史或为什么这样写');
        if (checks.noCrossChapterTemplateReuse?.passed === false) requiredActions.push(`当前正文与最近章节${checks.noCrossChapterTemplateReuse.referenceChapterNumber === undefined || checks.noCrossChapterTemplateReuse.referenceChapterNumber === null ? '' : `（第${checks.noCrossChapterTemplateReuse.referenceChapterNumber}章）`}重复了${checks.noCrossChapterTemplateReuse.sharedParagraphs ?? '多处'}个长段落；保留事实和承接状态，重新设计本章场景调度、动作、对白、感官和转折，禁止仅换标题、地点、数值或段落顺序`);
        if (checks.continuityAnchors?.passed === false) {
          for (const conflict of checks.continuityAnchors.conflicts ?? []) {
            requiredActions.push(
              `${conflict.field}发生无解释漂移：前章已确认值为${conflict.expected.join('、')}，本稿写成${conflict.actual.join('、')}；同一对象必须恢复前章值，除非正文明确写出更正、转移或另一个对象的因果`
            );
          }
        }
      }
    }
    if (requiredActions.length === 0) throw new QualityBlockedError('硬检查未通过但没有形成可执行的定点修改要求');
    requiredActions.push(rewriteLengthGuardAction(countNovelCharacters(content)));
    const rewriteSources: ContextSource[] = [
      { sourceType: 'current_manuscript', sourceId: run.current_manuscript_version_id, content, reason: '待定点重写的完整正文', priority: 100 },
      { sourceType: 'review_issues', sourceId: `review:${run.rewrite_count + 1}`, content: JSON.stringify(requiredActions), reason: '结构化修改要求', priority: 100 }
    ];
    const inheritedPack = run.context_pack_id === null ? undefined : this.database.prepare(`
      SELECT source_manifest_json FROM context_packs
      WHERE context_pack_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
    `).get(run.context_pack_id, scope.ownerId, scope.bookId) as { source_manifest_json: string } | undefined;
    const inheritedSources = inheritedPack === undefined
      ? []
      : (JSON.parse(inheritedPack.source_manifest_json) as Array<{
          sourceType: string; sourceId: string; content: string; reason: string;
          priority: number; version: string | number | null; hard: boolean;
        }>).filter((source) => !['current_manuscript', 'review_issues'].includes(source.sourceType))
          .map((source): ContextSource & { hard: boolean } => ({
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            content: source.content,
            reason: `沿用初稿冻结上下文：${source.reason}`,
            priority: source.priority,
            ...(source.version === null ? {} : { version: source.version }),
            hard: source.hard
          }));
    // A targeted rewrite already carries the complete current manuscript. Re-injecting the
    // draft pack's stage summary, previous chapter tail and retrieval hits duplicates material
    // that is now embodied in that manuscript, consumes the bounded rewrite budget and can pull
    // the writer away from the requested local edits. Keep only the compact contracts that still
    // govern the replacement text; the immutable work order remains the authority for facts and
    // boundaries, while the current manuscript preserves the realised scene and continuity.
    const rewriteContracts = inheritedSources.filter((source) => isTargetedRewriteContractSource(source.sourceType));
    const rewriteHardSources = [...rewriteSources, ...rewriteContracts];
    const rewriteOptionalSources: ContextSource[] = [];
    new CopyrightService(this.database, this.ids, this.clock).assertWriterContextSafe([...rewriteHardSources, ...rewriteOptionalSources]);
    const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
      taskId: run.task_id, agentId: run.writer_agent_id, chapterId: run.chapter_id,
      canonRevision: run.expected_canon_revision, positioningVersion: run.expected_positioning_version,
      tokenBudget: WRITER_CONTEXT_POLICY.targetedRewrite.tokenBudget,
      characterBudget: WRITER_CONTEXT_POLICY.targetedRewrite.characterBudget,
      policyVersion: WRITER_CONTEXT_POLICY.targetedRewrite.policyVersion,
      hardSources: rewriteHardSources, optionalSources: rewriteOptionalSources
    });
    const writerModel = this.modelIdentity(scope, run.writer_model_snapshot_id);
    const adapter = this.modelAdapters.resolve(writerModel.provider, writerModel.modelId, 'novel_writer', 'writer');
    let output: string;
    try {
      const lengthContract = writerLengthContract();
      output = await this.executeModel(
        scope, run, `rewrite-${run.rewrite_count + 1}`, run.writer_agent_id, run.writer_model_snapshot_id,
        adapter, JSON.stringify({ operation: 'rewrite', content, requiredActions, lengthContract }), pack.contextPackId
      );
    } catch (error) {
      if (!(error instanceof ModelTechnicalFailureError)) throw error;
      return this.takeOverWriterOrBlock(scope, run, 'rewrite', error.message);
    }
    writerLease.assertCanCommit(scope, run.writer_agent_id, run.writer_epoch!);
    const candidateHardCheck = this.evaluateHardChecks(scope, run, output);
    const currentPassedHardCheck = (this.database.prepare(`
      SELECT passed FROM hard_check_results
      WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ?
      ORDER BY created_at DESC, hard_check_id DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, run.current_manuscript_version_id) as { passed: number } | undefined)?.passed === 1;
    this.promoteManuscript(scope, run, output, run.current_manuscript_version_id, adapter, 'candidate', (nextVersionId) => {
      const now = this.clock.now().toISOString();
      const recovery = decideRewriteCandidateRecovery(
        currentPassedHardCheck,
        candidateHardCheck.passed,
        run.rewrite_count
      );
      if (recovery !== 'accept') {
        // A literary/experience rewrite is not allowed to destroy an objective gate already met
        // by the reviewed manuscript. Keep the rejected immutable candidate for audit, restore the
        // hard-valid reviewed version, and spend at most the existing two-attempt rewrite budget.
        // After the second rejected candidate, preserve the unresolved reviewer disagreement for
        // the owner instead of either accepting defective prose or starting an unbounded loop.
        this.database.prepare(`UPDATE manuscript_versions SET status = 'rejected'
          WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ?`)
          .run(nextVersionId, scope.ownerId, scope.bookId);
        this.database.prepare(`UPDATE chapters
          SET current_manuscript_version_id = ?, generation_status = 'completed', updated_at = ?
          WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
          .run(run.current_manuscript_version_id, now, run.chapter_id, scope.ownerId, scope.bookId);
        this.recordHardCheck(scope, run, nextVersionId, candidateHardCheck);
        const nextRewriteCount = run.rewrite_count + 1;
        if (recovery === 'retain_for_owner') {
          this.database.prepare(`UPDATE revision_orders SET status = 'cancelled'
            WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ? AND status = 'active'`)
            .run(scope.ownerId, scope.bookId, run.current_manuscript_version_id);
        }
        this.database.prepare(`
          UPDATE chapter_pipeline_runs SET current_manuscript_version_id = ?, rewrite_count = ?,
            phase = ?, updated_at = ? WHERE pipeline_run_id = ?
        `).run(
          run.current_manuscript_version_id,
          nextRewriteCount,
          recovery === 'retain_for_owner' ? 'facts' : 'rewrite',
          now,
          run.pipeline_run_id
        );
        return;
      }
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

  private evaluateHardChecks(scope: BookScope, run: PipelineRow, content: string) {
    const characterCount = countNovelCharacters(content);
    const targetMinimum = 2_700;
    const targetMaximum = 3_200;
    const hardMinimum = 2_350;
    const hardMaximum = 3_650;
    const recentManuscripts = this.recentCanonManuscripts(scope, run.chapter_id);
    const reuseChecks = recentManuscripts.map((reference) => ({
      ...assessManuscriptParagraphReuse(content, reference.content),
      referenceChapterNumber: reference.chapterNumber
    }));
    const worstReuse = reuseChecks.sort((left, right) => right.ratio - left.ratio || right.sharedParagraphs - left.sharedParagraphs)[0];
    const checks = {
      fullImmutableVersion: true,
      length: {
        passed: characterCount >= hardMinimum && characterCount <= hardMaximum,
        targetMet: characterCount >= targetMinimum && characterCount <= targetMaximum,
        characterCount,
        targetMinimum,
        targetMaximum,
        minimum: hardMinimum,
        maximum: hardMaximum,
        policy: 'target-with-bounded-hard-tolerance-v1'
      },
      noPlaceholder: { passed: !containsExplicitPlaceholder(content) },
      noMarkdownChapterHeading: { passed: !containsMarkdownChapterHeading(content) },
      noInternalWorkflowPayload: { passed: !containsInternalWorkflowPayload(content) },
      noQualityGovernanceNarration: assessManuscriptMetaNarration(content),
      noCrossChapterTemplateReuse: worstReuse === undefined
        ? { passed: true, sharedParagraphs: 0, currentParagraphs: 0, referenceParagraphs: 0, ratio: 0, comparedChapterCount: 0, referenceChapterNumber: null }
        : { ...worstReuse, passed: reuseChecks.every((check) => check.passed), comparedChapterCount: reuseChecks.length },
      continuityAnchors: checkChapterContinuityAnchors(content, this.previousContinuityAnchors(scope, run.chapter_id)),
      hookAssessment: { deterministicGate: false, delegatedTo: 'experience_reviewer', reason: '标点不能证明章末钩子有效' }
    };
    return {
      checks,
      passed: checks.length.passed && checks.noPlaceholder.passed
        && checks.noMarkdownChapterHeading.passed && checks.noInternalWorkflowPayload.passed
        && checks.noQualityGovernanceNarration.passed && checks.noCrossChapterTemplateReuse.passed
        && checks.continuityAnchors.passed
    };
  }

  private recordHardCheck(
    scope: BookScope,
    run: PipelineRow,
    manuscriptVersionId: string,
    hardCheck: ReturnType<ChapterPipelineService['evaluateHardChecks']>
  ): void {
    this.database.prepare(`
      INSERT INTO hard_check_results (
        hard_check_id, owner_id, book_id, chapter_id, manuscript_version_id,
        passed, checks_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.ids.next(), scope.ownerId, scope.bookId, run.chapter_id, manuscriptVersionId,
      hardCheck.passed ? 1 : 0, JSON.stringify(hardCheck.checks), this.clock.now().toISOString()
    );
  }

  private extractFacts(scope: BookScope, run: PipelineRow): PipelineRow {
    return new UnitOfWork(this.database).run(() => {
      if (run.current_manuscript_version_id === null || run.review_panel_id === null) throw new Error('正文确认门禁缺少稿件或三点评轮次');
      const chapter = this.requireChapter(scope, run.chapter_id);
      const taskBrief = this.taskBrief(scope, run.task_id);
      const revisingSettled = chapter.settlement_status === 'settled'
        && ['review_existing', 'rewrite_existing'].includes(String(taskBrief.operation ?? ''));
      const confirmationId = this.ids.next();
      new ProductionWorkflowRepository(this.database).createApprovalGate(scope, {
        gateId: this.ids.next(), confirmationId, chapterId: run.chapter_id, taskId: run.task_id,
        manuscriptVersionId: run.current_manuscript_version_id, reviewPanelId: run.review_panel_id,
        expectedCanonRevision: run.expected_canon_revision,
        scopeData: { chapterNumber: chapter.chapter_number, chapterTitle: chapter.title, manuscriptVersionId: run.current_manuscript_version_id },
        impact: { onAccept: ['选中当前不可变正文', '抽取带来源的事实候选', '章节结算并创建新正史版本'], onReject: ['保留临时稿和点评证据', '不进入正史'], cashCostCny: 0 },
        now: this.clock.now().toISOString()
      });
      if (!revisingSettled) {
        this.database.prepare(`UPDATE chapters SET settlement_status = 'awaiting_confirmation', updated_at = ? WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
          .run(this.clock.now().toISOString(), run.chapter_id, scope.ownerId, scope.bookId);
      }
      this.database.prepare(`UPDATE chapter_pipeline_runs SET confirmation_id = ?, updated_at = ? WHERE pipeline_run_id = ?`)
        .run(confirmationId, this.clock.now().toISOString(), run.pipeline_run_id);
      if (!revisingSettled) new CreationWorkflowProgressService(this.database).markWaitingForAuthor(scope, run.task_id);
      return this.advance(run, 'settlement');
    });
  }

  private settle(_scope: BookScope, run: PipelineRow): PipelineRow {
    if (run.confirmation_id === null) throw new Error('结算阶段缺少老板确认单');
    return this.advance(run, 'completed');
  }

  private findOrCreateRun(scope: BookScope, taskId: string, chapterId: string, taskBrief: Record<string, unknown>): PipelineRow {
    const existing = this.database.prepare(`SELECT * FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, chapterId) as PipelineRow | undefined;
    if (existing !== undefined) {
      if (existing.status === 'failed' && existing.task_id === taskId) {
        if (existing.writing_order_id !== null && existing.writer_epoch !== null) {
          new WriterLeaseService(new WriterLeaseRepository(this.database), this.clock).resumeExactOrder(
            scope,
            existing.writer_agent_id,
            existing.writer_epoch,
            existing.writing_order_id,
            { taskId, chapterId, phase: existing.phase, resumedFromFailure: true }
          );
        }
        this.database.prepare(`UPDATE chapter_pipeline_runs
          SET status = 'working', error_code = NULL, updated_at = ? WHERE pipeline_run_id = ?`)
          .run(this.clock.now().toISOString(), existing.pipeline_run_id);
        return this.reload(existing.pipeline_run_id);
      }
      if (existing.status === 'paused' && existing.task_id === taskId) {
        this.database.prepare(`UPDATE chapter_pipeline_runs SET status = 'working', updated_at = ? WHERE pipeline_run_id = ?`)
          .run(this.clock.now().toISOString(), existing.pipeline_run_id);
        return this.reload(existing.pipeline_run_id);
      }
      const explicitExistingOperation = taskBrief.operation === 'review_existing' || taskBrief.operation === 'rewrite_existing';
      if ((existing.status === 'failed' && existing.task_id !== taskId)
        || (explicitExistingOperation && existing.task_id !== taskId && ['completed', 'paused'].includes(existing.status))) {
        const requestedManuscriptVersionId = typeof taskBrief.manuscriptVersionId === 'string'
          ? taskBrief.manuscriptVersionId
          : null;
        const continuingSameVersion = existing.status === 'failed'
          && requestedManuscriptVersionId !== null
          && existing.current_manuscript_version_id === requestedManuscriptVersionId;
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
            confirmation_id = NULL, rewrite_count = ?, phase = 'preflight',
            status = 'working', error_code = NULL, expected_canon_revision = ?,
            expected_positioning_version = ?, updated_at = ? WHERE pipeline_run_id = ?
        `).run(taskId, selection.writerSelectionId, selection.writerAgentId, selection.writerModelSnapshotId,
          selection.reviewerAgentId, selection.reviewerModelSnapshotId,
          bindingRevision?.agent_model_binding_revision_id ?? null,
          resumedRewriteCount(existing.rewrite_count, continuingSameVersion, taskBrief.operation),
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

  private settledRevisionOutlineVersionId(
    scope: BookScope,
    chapterId: string,
    manuscriptVersionId: string | null
  ): string {
    if (manuscriptVersionId === null) throw new Error('已结算章节修订缺少正史正文版本');
    const outlineVersionId = new ProductionWorkflowRepository(this.database)
      .settledRevisionOutlineVersionId(scope, chapterId, manuscriptVersionId);
    if (outlineVersionId === null) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '已结算章节缺少可追溯的原冻结章纲，不能创建正式修订。',
        { chapterId, manuscriptVersionId },
        false,
        409
      );
    }
    return outlineVersionId;
  }
  private taskBrief(scope: BookScope, taskId: string): Record<string, unknown> {
    const row = this.database.prepare(`SELECT task_brief_json FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?`)
      .get(taskId, scope.ownerId, scope.bookId) as { task_brief_json: string } | undefined;
    if (row === undefined) throw new Error('章节任务不存在或越权');
    return JSON.parse(row.task_brief_json) as Record<string, unknown>;
  }

  private requireBoundManuscript(scope: BookScope, chapterId: string, manuscriptVersionId: string): void {
    const row = this.database.prepare(`SELECT 1 FROM manuscript_versions WHERE manuscript_version_id = ?
      AND owner_id = ? AND book_id = ? AND chapter_id = ? AND status IN ('draft','candidate','under_review','approved','canon')`)
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
    // The deterministic writer is an acceptance fixture, but it must still receive
    // the same compiled book/volume/event/outline context as a real writer. Keeping
    // draft prompts context-free made technical E2E runs silently produce an
    // unrelated canned story, so those runs could not validate the workflow's most
    // important context contract. Deterministic reviewers keep their compact schema
    // input because they validate protocol behavior rather than story generation.
    const modelPrompt = adapter.provider.startsWith('local-deterministic')
      ? phaseKey === 'draft'
        ? this.deterministicDraftPromptWithContext(scope, contextPackId, prompt)
        : prompt
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
      const reservedTokens = modelReservationTokenCeiling({
        provider: adapter.provider,
        estimatedPromptTokens: estimateTokens(modelPrompt),
        packBudget,
        maxOutputTokens
      });
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
        const providerResultUnknown = call?.state === 'interrupted' && call.error_class === 'provider_result_unknown';
        if (providerResultUnknown) {
          // 结果未知时不能对同一模型盲目重试；把它提升为写手接管信号。旧写手即使
          // 迟到返回，也会被随后递增的 writer_epoch 提交栅栏拒绝。
          throw new ModelTechnicalFailureError(
            `模型调用结果状态未知，停止原模型重试并请求副笔从安全检查点接管：${error instanceof Error ? error.message : String(error)}`
          );
        }
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
    const contentHash = createHash('sha256').update(content).digest('hex');
    const existing = this.database.prepare(`
      SELECT manuscript_version_id FROM manuscript_versions
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND content_hash = ?
        AND status IN ('draft', 'candidate', 'under_review', 'approved', 'canon')
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, run.chapter_id, contentHash) as { manuscript_version_id: string } | undefined;
    if (existing !== undefined) {
      if (run.writer_epoch === null) throw new Error('正文登记缺少写手epoch');
      return new UnitOfWork(this.database).run(() => {
        new WriterLeaseService(new WriterLeaseRepository(this.database), this.clock)
          .assertCanCommit(scope, run.writer_agent_id, run.writer_epoch!);
        const now = this.clock.now().toISOString();
        this.database.prepare(`
          UPDATE chapters SET current_manuscript_version_id = ?, generation_status = 'completed', updated_at = ?
          WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
        `).run(existing.manuscript_version_id, now, run.chapter_id, scope.ownerId, scope.bookId);
        afterRegister?.(existing.manuscript_version_id);
        return existing.manuscript_version_id;
      });
    }
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

  private recentCanonManuscripts(scope: BookScope, chapterId: string): Array<{ chapterNumber: number; content: string }> {
    const chapter = this.requireChapter(scope, chapterId);
    const previous = this.database.prepare(`
      SELECT c.chapter_number, c.canon_manuscript_version_id
      FROM chapters c
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number < ?
        AND c.settlement_status = 'settled' AND c.canon_manuscript_version_id IS NOT NULL
      ORDER BY c.chapter_number DESC LIMIT 5
    `).all(scope.ownerId, scope.bookId, chapter.chapter_number) as unknown as Array<{
      chapter_number: number; canon_manuscript_version_id: string;
    }>;
    return previous.map((item) => ({
      chapterNumber: item.chapter_number,
      content: this.loadManuscript(scope, item.canon_manuscript_version_id)
    }));
  }

  private previousContinuityAnchors(scope: BookScope, chapterId: string): ChapterContinuityAnchors | null {
    const chapter = this.requireChapter(scope, chapterId);
    const previous = this.database.prepare(`
      SELECT e.state_json, c.canon_manuscript_version_id
      FROM chapters c JOIN chapter_end_states e ON e.chapter_end_state_id = c.chapter_end_state_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number < ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapter.chapter_number) as {
      state_json: string; canon_manuscript_version_id: string;
    } | undefined;
    if (previous === undefined) return null;
    return parseChapterContinuityAnchors(previous.state_json)
      ?? buildChapterContinuityAnchors(this.loadManuscript(scope, previous.canon_manuscript_version_id));
  }

  private promptWithContext(scope: BookScope, contextPackId: string, phaseKey: string, taskInput: string): string {
    const row = this.database.prepare(`
      SELECT source_manifest_json, content_hash FROM context_packs
      WHERE context_pack_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
    `).get(contextPackId, scope.ownerId, scope.bookId) as { source_manifest_json: string; content_hash: string } | undefined;
    if (row === undefined) throw new Error('模型上下文包不存在、已失效或越权');
    const parsedTaskInput = JSON.parse(taskInput) as unknown;
    const compactTaskInput = compactChapterModelTaskInput(phaseKey, parsedTaskInput);
    const storedSources = JSON.parse(row.source_manifest_json) as unknown;
    return JSON.stringify({
      phase: phaseKey,
      sources: phaseKey.startsWith('draft') || phaseKey.startsWith('rewrite')
        ? compactWriterPromptSources(storedSources)
        : storedSources,
      taskInput: compactTaskInput
    });
  }

  private deterministicDraftPromptWithContext(scope: BookScope, contextPackId: string, taskInput: string): string {
    const row = this.database.prepare(`
      SELECT source_manifest_json FROM context_packs
      WHERE context_pack_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
    `).get(contextPackId, scope.ownerId, scope.bookId) as { source_manifest_json: string } | undefined;
    if (row === undefined) throw new Error('本地验收写手的上下文包不存在、已失效或越权');
    const parsed = JSON.parse(taskInput) as unknown;
    if (!isRecordValue(parsed)) throw new Error('本地验收写手任务格式无效');
    return JSON.stringify({
      ...parsed,
      sources: JSON.parse(row.source_manifest_json) as unknown
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

export function compactWriterPromptSources(value: unknown): Array<{
  role: string;
  required: boolean;
  content: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecordValue(item) || typeof item.content !== 'string' || item.content.trim().length === 0) return [];
    const sourceType = typeof item.sourceType === 'string' ? item.sourceType : '';
    return [{
      role: writerSourceRole(sourceType),
      required: item.hard === true,
      content: item.content
    }];
  });
}

function writerSourceRole(sourceType: string): string {
  const roles: Record<string, string> = {
    system_rule: '本章写作底线',
    chapter_work_order: '本章章纲与写作要求',
    opening_profile: '开书信息与人物定位',
    style_baseline: '本书表达习惯',
    stage_settlement_context: '分卷与事件已经发生的进展',
    current_manuscript: '需要修改的完整正文',
    owner_rewrite_instruction: '作者本次修改要求',
    previous_chapter_end: '上一章结束后的当前状态',
    previous_chapter_tail: '上一章结尾原文',
    previous_chapter_anchors: '前后文必须保持一致的专名与编号',
    active_commitments: '仍在推进的线索、承诺与因果债'
  };
  return roles[sourceType] ?? (sourceType.includes('voice')
    ? '与本章有关的人物声音'
    : sourceType.includes('manuscript')
      ? '与本章有关的已定稿前文'
      : '与本章有关的正式资料');
}
export function compactChapterModelTaskInput(phaseKey: string, parsedTaskInput: unknown): unknown {
  if (phaseKey.startsWith('review-repair-') || phaseKey.startsWith('editor-synthesis-repair-')) return parsedTaskInput;
  if (phaseKey.startsWith('editor-synthesis-')) {
    return isRecordValue(parsedTaskInput)
      ? {
          operation: parsedTaskInput.operation,
          panelId: parsedTaskInput.panelId,
          manuscriptVersionId: parsedTaskInput.manuscriptVersionId,
          rules: parsedTaskInput.rules,
          output: parsedTaskInput.output
        }
      : { operation: 'review_synthesis' };
  }
  if (phaseKey.startsWith('review-')) {
    return isRecordValue(parsedTaskInput)
      ? {
          operation: 'review',
          reviewerRole: parsedTaskInput.reviewerRole,
          manuscriptVersionId: parsedTaskInput.manuscriptVersionId,
          modelSnapshotId: parsedTaskInput.modelSnapshotId,
          requiredSchema: parsedTaskInput.requiredSchema,
          sourceBoundaryContract: parsedTaskInput.sourceBoundaryContract,
          severityRubric: parsedTaskInput.severityRubric,
          contract: parsedTaskInput.contract
        }
      : { operation: 'review' };
  }
  if (phaseKey.startsWith('rewrite-')) {
    return isRecordValue(parsedTaskInput)
      ? {
          operation: 'rewrite',
          requiredActions: parsedTaskInput.requiredActions,
          outputContract: {
            kind: 'complete_chapter_replacement',
            targetCharacterRange: [2_700, 3_200],
            hardCharacterRange: [2_350, 3_650],
            preserveUnchangedParagraphs: true,
            forbidExcerptOrSummary: true,
            instruction: '当前完整正文已在sources中。必须返回修改后的整章正文，不能只返回修改片段；未修改部分也必须完整保留。'
          }
        }
      : { operation: 'rewrite' };
  }
  return parsedTaskInput;
}

export function isTargetedRewriteContractSource(sourceType: string): boolean {
  return sourceType === 'system_rule'
    || sourceType === 'chapter_work_order'
    || sourceType === 'opening_profile'
    || sourceType === 'style_baseline'
    || sourceType === 'previous_chapter_anchors';
}

export function hasExhaustedExactManuscriptReviewAttempts(completedAttempts: number, resumingIncompletePanel: boolean): boolean {
  return !resumingIncompletePanel && completedAttempts >= 3;
}

export function nextExactManuscriptReviewAttempt(usedAttempts: number[], resumedAttempt?: number): number {
  if (resumedAttempt !== undefined) return resumedAttempt;
  return [1, 2, 3].find((attempt) => !usedAttempts.includes(attempt)) ?? 4;
}

export function revisionRoundForRewriteCount(rewriteCount: number): number {
  return Math.max(1, rewriteCount + 1);
}

export function resumedRewriteCount(
  existingRewriteCount: number,
  continuingSameVersion: boolean,
  operation: unknown
): number {
  // Re-submitting the exact draft for review must not buy infinite automatic rewrites.
  // An explicit owner rewrite is a new creative instruction, so it receives a fresh bounded
  // two-rewrite window even when its immutable base version is the previously blocked draft.
  return continuingSameVersion && operation === 'review_existing' ? existingRewriteCount : 0;
}

export function shouldAutomaticallyRewriteReview(
  operation: unknown,
  rewriteCount: number
): boolean {
  // “定稿审校”审的是老板/作者明确选择的不可变稿件。点评意见必须保留并展示，
  // 但不能让主笔在作者不知情时覆盖这份稿件；只有普通生产或明确“重写”任务
  // 才进入最多两轮的自动定点改写。
  return operation !== 'review_existing' && rewriteCount < 2;
}

function outputTokenLimit(phaseKey: string): number {
  if (phaseKey.startsWith('draft') || phaseKey.startsWith('rewrite')) return 8_000;
  if (phaseKey.startsWith('review-')) return 6_000;
  if (phaseKey.startsWith('editor-synthesis')) return 2_000;
  return 4_000;
}

export function modelReservationTokenCeiling(input: {
  provider: string; estimatedPromptTokens: number; packBudget: number; maxOutputTokens: number;
}): number {
  if (input.provider.startsWith('local-deterministic')) {
    return Math.ceil(input.estimatedPromptTokens * 1.15) + input.maxOutputTokens;
  }
  // Subscription usage includes provider-side system instructions and, for Codex, the fixed
  // execution protocol that is not part of our context-pack token budget. Real long-form calls
  // show a stable ~22k-token Codex wrapper; reserve a bounded 24k overhead so a completed chapter
  // is not discarded merely because the local estimate cannot see that wrapper. Settlement still
  // records only the actual usage and cash remains frozen at zero.
  const protocolOverhead = input.provider === 'openai-codex-subscription' ? 24_000 : 0;
  const estimatedInputCeiling = Math.max(
    Math.ceil(input.packBudget * 1.35),
    Math.ceil(input.estimatedPromptTokens * 1.25)
  ) + protocolOverhead;
  return estimatedInputCeiling + input.maxOutputTokens;
}

function productionReviewOutputContract(
  role: 'fact' | 'literary' | 'experience',
  identity: { reviewerRole: string; manuscriptVersionId: string; modelSnapshotId: string }
): Record<string, unknown> {
  const common: Record<string, unknown> = {
    reviewerRole: { const: identity.reviewerRole },
    manuscriptVersionId: { const: identity.manuscriptVersionId },
    modelSnapshotId: { const: identity.modelSnapshotId },
    verdict: { enum: ['pass', 'rewrite', 'blocked'], note: '必须使用英文枚举；pass不得包含major或blocker' },
    summary: '非空字符串',
    issues: {
      type: 'array', maxItems: 8,
      items: {
        location: '正文位置', issueType: '问题类型',
        severity: {
          enum: ['blocker', 'major', 'minor', 'observation'],
          rule: 'blocker仅用于无法自动定点修复、必须停止或等待老板确认的问题；任何能给出局部修改动作的质量问题必须标为major或更低'
        },
        evidence: '正文原句或可核验依据', requiredAction: '可执行修改要求'
      }
    },
    scores: { note: '至少一个0至100的有限数值；键名可按职责命名' }
  };
  if (role === 'fact') {
    common.factCandidates = {
      type: 'array', maxItems: 16, note: '只保留会影响后续章节的持久事实',
      items: {
        subjectName: '实体原名', entityType: { enum: ['character', 'location', 'organization', 'item', 'resource', 'skill', 'stat_panel', 'world_rule', 'event', 'foreshadowing', 'hook'] },
        relationKey: '稳定关系键；人物关系固定使用 relationship.<关系类型>', value: '事实值；人物关系仅填另一方准确姓名', evidenceQuote: '正文原句', evidenceLocation: '正文位置',
        epistemicStatus: { enum: ['objective', 'claim', 'belief', 'lie', 'dream', 'plan', 'counterfactual', 'ambiguous', 'conflicted'] },
        negated: false, viewpointName: null, knowledgeSubjectName: null, knowledgeTimeStart: null,
        knowledgeTimeEnd: null, storyTimeStart: null, storyTimeEnd: null
      }
    };
  } else if (role === 'literary') {
    common.aiStyle = {
      riskScore: '0至100数值', flaggedParagraphCount: '非负整数', totalParagraphCount: '正整数',
      flaggedParagraphRatio: 'flaggedParagraphCount/totalParagraphCount', isAuthorshipProbability: false,
      evidence: ['每项必须是带段落位置的字符串证据']
    };
  } else {
    const risk = {
      level: { enum: ['none', 'low', 'medium', 'high', 'blocked'] },
      locations: ['非none时必须有正文位置'], evidence: ['非none时必须有正文原句'],
      recommendedAction: '非空字符串', policyVersion: '非空字符串'
    };
    common.politicalRisk = risk;
    common.sexualContentRisk = risk;
  }
  return { type: 'object', onlyTheseTopLevelFields: true, required: common };
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

export function compactWriterWorkOrder(
  outline: Record<string, unknown>,
  contract: Record<string, unknown>,
  maxCharacters: number
): string {
  if (outline.outlineSchema === 'chapter_outline_v2') {
    const contractParts = [
      typeof contract.targetWords === 'number' ? `目标字数约${contract.targetWords}字` : '',
      typeof contract.pov === 'string' ? `视角：${contract.pov}` : '',
      typeof contract.tense === 'string' ? `叙事时态：${contract.tense}` : '',
      Array.isArray(contract.hardConstraints)
        ? `写作硬约束：${contract.hardConstraints.filter((item): item is string => typeof item === 'string').join('；')}`
        : ''
    ].filter(Boolean);
    const contractText = contractParts.join('；');
    if (contractText.length > 240) {
      throw new Error('写作契约硬信息超过240字，请先去除重复约束，不能静默截断');
    }
    const outlineMaximum = Math.min(1_350, maxCharacters - contractText.length - 6);
    if (outlineMaximum < 800) throw new Error('章纲与写作契约的上下文预算不足');
    const outlineText = compileChapterOutlineForWriter(outline, outlineMaximum);
    const compiled = `${outlineText}\n写作契约：${contractText}`;
    if (compiled.length > maxCharacters) throw new Error('章纲与写作契约超过主笔工单预算');
    return compiled;
  }
  const outlineKeys = ['chapterNumber', 'title', 'goal', 'objective', 'beats', 'scenes', 'hook', 'mustInclude', 'mustAvoid'];
  const contractKeys = [
    'targetCharacters', 'narrativePerson', 'viewpointDistance', 'languageTone', 'textDensity',
    'hardConstraints', 'preserve', 'avoid', 'acceptance', 'style'
  ];
  const outlineText = JSON.stringify(pickContextFields(outline, outlineKeys));
  const contractText = JSON.stringify(pickContextFields(contract, contractKeys));
  const outlineBudget = Math.max(1, Math.floor((maxCharacters - 12) * 0.68));
  const contractBudget = Math.max(1, maxCharacters - outlineBudget - 12);
  return `本章章纲：${clipContext(outlineText, outlineBudget)}\n写作契约：${clipContext(contractText, contractBudget)}`;
}

export function clipContext(content: string, maxCharacters: number): string {
  const normalized = content.trim();
  if (normalized.length <= maxCharacters) return normalized;
  if (maxCharacters <= 1) return '…'.slice(0, maxCharacters);
  return `${normalized.slice(0, maxCharacters - 1)}…`;
}

export function tailContext(content: string, maxCharacters: number): string {
  const normalized = content.trim();
  if (normalized.length <= maxCharacters) return normalized;
  if (maxCharacters <= 1) return '…'.slice(0, maxCharacters);
  return `…${normalized.slice(-(maxCharacters - 1))}`;
}

export function shouldRestorePreviousBest(
  operation: unknown,
  retainPreviousBest: boolean
): boolean {
  // An owner-submitted finalization explicitly selects the manuscript under review.
  // Subjective score regression remains visible as a disagreement, but must not
  // silently replace that manuscript with an older version. Objective blockers
  // are still enforced by the fact, compliance, and hard-quality gates.
  return retainPreviousBest && operation !== 'review_existing';
}

function pickContextFields(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const selected = Object.fromEntries(keys
    .filter((key) => Object.hasOwn(value, key))
    .map((key) => [key, value[key]]));
  return Object.keys(selected).length > 0 ? selected : value;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message);
  return value.trim();
}

function writerLengthContract(): Record<string, unknown> {
  return {
    generationAimMinimum: 2_700,
    generationAimMaximum: 3_200,
    acceptedMinimum: 2_350,
    acceptedMaximum: 3_650,
    unit: '有效汉字、字母或数字（不计标点和空白）',
    instruction: '只输出完整小说正文，优先控制在2700至3200有效字符；允许的硬边界为2350至3650。要求较多时压缩解释和同义复述，不得靠扩写逐条解释要求。'
  };
}

export function rewriteLengthGuardAction(characterCount: number): string {
  return `修订前正文为${characterCount}个有效字符。本轮所有文学性、体验和事实修改必须同时满足字数硬约束：修订后优先保持在2700至3200个有效汉字、字母或数字，严禁少于2350或超过3650；要求冲突时压缩解释、同义复述和无因果段落，不得破坏已通过的硬门禁。`;
}

export function decideRewriteCandidateRecovery(
  currentPassedHardCheck: boolean,
  candidatePassedHardCheck: boolean,
  rewriteCount: number
): 'accept' | 'retry_rewrite' | 'retain_for_owner' {
  if (!currentPassedHardCheck || candidatePassedHardCheck) return 'accept';
  return rewriteCount + 1 >= 2 ? 'retain_for_owner' : 'retry_rewrite';
}

export function containsExplicitPlaceholder(content: string): boolean {
  return /(?:【|\[|<)\s*(?:TODO|待补|待填写|占位)\s*(?:】|\]|>)|(?:^|\n)\s*(?:TODO|待补|待填写|占位)\s*(?=\n|$)/iu.test(content);
}

export function containsMarkdownChapterHeading(content: string): boolean {
  return /(?:^|\n)\s*#\s+\S/u.test(content);
}

export function containsInternalWorkflowPayload(content: string): boolean {
  return /(?:workflowArtifact|confirmed_decisions|ContextPack|context_pack|contextPack|system\s*prompt|模型快照|检索记录|正式来源|质量门禁|硬检查|工作流载荷|```json|"(?:chapterNumber|continuityAnchors|sourceId|source_id|owner_id|book_id|prompt|schema)"\s*:|\bundefined\b)/iu.test(content);
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
