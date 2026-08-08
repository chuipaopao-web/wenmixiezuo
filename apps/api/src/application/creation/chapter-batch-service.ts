import type { DatabaseSync } from 'node:sqlite';
import { ChapterCatalogService } from '../chapters/chapter-catalog-service.js';
import { TaskService } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ChapterPipelineService, type PipelinePhase, type PipelineResult } from './chapter-pipeline-service.js';
import { WriterSelectionService } from './writer-selection-service.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../infrastructure/models/model-runtime-config.js';
import { WritingReadinessService, type ChapterRequestCount } from './writing-readiness-service.js';
import { CreationWorkflowProgressService } from './creation-workflow-progress-service.js';

export interface ChapterBatchRecord {
  batchId: string;
  chapterIds: string[];
  taskIds: string[];
  nextIndex: number;
  status: 'pending' | 'working' | 'paused' | 'failed' | 'completed' | 'cancelled';
  checkpoint: Record<string, unknown>;
}

interface BatchRow {
  batch_id: string;
  chapter_ids_json: string;
  task_ids_json: string;
  next_index: number;
  status: ChapterBatchRecord['status'];
  checkpoint_json: string;
}

export class ChapterBatchService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}))
  ) {}

  public scheduleNewChapters(
    scope: BookScope,
    count: 1 | 3 | 4 | 5,
    options: {
      volumeTitle?: string;
      firstChapterTitle?: string;
      productionMode?: 'formal_production' | 'trial_draft';
    } = {}
  ): ChapterBatchRecord {
    assertBookScope(scope);
    if (![1, 3, 4, 5].includes(count)) throw new Error('首版批次只能安排1章或连续3至5章');
    const readiness = new WritingReadinessService(this.database).assertReady(scope, count);
    const catalog = new ChapterCatalogService(this.database, this.ids, this.clock);
    let volume = this.database.prepare(`
      SELECT volume_id FROM volumes WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY volume_number LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { volume_id: string } | undefined;
    if (volume === undefined) volume = { volume_id: catalog.createVolume(scope, 1, options.volumeTitle ?? '第一卷') };
    const chapterIds: string[] = [];
    for (const [index, number] of readiness.chapterNumbers.entries()) {
      const existing = this.database.prepare(`
        SELECT c.chapter_id,
          c.generation_status,
          (SELECT COUNT(*) FROM manuscript_versions m WHERE m.owner_id = c.owner_id AND m.book_id = c.book_id AND m.chapter_id = c.chapter_id) AS manuscript_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = c.owner_id AND t.book_id = c.book_id AND t.chapter_id = c.chapter_id
            AND t.status IN ('pending','queued','working','waiting_confirmation','paused','interrupted')) AS active_task_count
        FROM chapters c WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number = ? AND c.settlement_status = 'unsettled'
      `).get(scope.ownerId, scope.bookId, number) as {
        chapter_id: string; generation_status: string; manuscript_count: number; active_task_count: number;
      } | undefined;
      if (existing !== undefined) {
        const safeRetry = existing.generation_status === 'failed' && existing.active_task_count === 0;
        if ((!safeRetry && existing.manuscript_count !== 0) || existing.active_task_count !== 0) {
          throw new Error(`第${number}章已有正文或活动任务，不能重复安排`);
        }
        this.database.prepare(`
          UPDATE chapters SET title = ?, plan_status = 'planned', generation_status = 'not_started', updated_at = ?
          WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
        `).run(this.plannedChapterTitle(scope, number, options.firstChapterTitle), this.clock.now().toISOString(),
          existing.chapter_id, scope.ownerId, scope.bookId);
        chapterIds.push(existing.chapter_id);
      } else {
        chapterIds.push(catalog.createChapter(
          scope,
          volume.volume_id,
          number,
          this.plannedChapterTitle(scope, number, index === 0 ? options.firstChapterTitle : undefined)
        ).chapterId);
      }
    }
    return this.scheduleExisting(scope, chapterIds, {
      productionMode: options.productionMode ?? 'formal_production'
    });
  }

  private plannedChapterTitle(scope: BookScope, chapterNumber: number, explicitTitle?: string): string {
    if (explicitTitle?.trim()) return explicitTitle.trim();
    const row = this.database.prepare(`
      SELECT v.content_json
      FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ?
        AND a.artifact_type = 'chapter_outline' AND a.title = ?
        AND a.status = 'active' AND v.status = 'selected'
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, `第${chapterNumber}章章纲`) as { content_json: string } | undefined;
    if (row !== undefined) {
      const content = JSON.parse(row.content_json) as { title?: unknown };
      if (typeof content.title === 'string' && content.title.trim()) return content.title.trim();
    }
    return `第${chapterNumber}章`;
  }

  public scheduleExisting(
    scope: BookScope,
    chapterIds: string[],
    options: { productionMode?: 'formal_production' | 'trial_draft' } = {}
  ): ChapterBatchRecord {
    assertBookScope(scope);
    if (chapterIds.length !== 1 && (chapterIds.length < 3 || chapterIds.length > 5)) throw new Error('首版批次只能安排1章或连续3至5章');
    new WritingReadinessService(this.database).assertReady(scope, chapterIds.length as ChapterRequestCount);
    const selection = new WriterSelectionService(this.database, this.ids, this.clock).select(scope);
    const book = this.database.prepare(`SELECT editor_epoch FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { editor_epoch: number };
    const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string };
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    const taskIds: string[] = [];
    for (const [index, chapterId] of chapterIds.entries()) {
      const chapter = this.database.prepare(`SELECT chapter_number FROM chapters WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
        .get(chapterId, scope.ownerId, scope.bookId) as { chapter_number: number } | undefined;
      if (chapter === undefined) throw new Error('批次章节不存在或越权');
      const taskId = this.ids.next();
      const attempt = this.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND task_type = 'chapter_creation'`)
        .get(scope.ownerId, scope.bookId, chapterId) as { count: number };
      tasks.create(scope, {
        taskId,
        taskType: 'chapter_creation',
        assignedAgentId: selection.writerAgentId,
        chapterId,
        idempotencyKey: `chapter-creation:${chapterId}:attempt:${attempt.count + 1}`,
        budgetId: budget.budget_id,
        requiredEditorEpoch: book.editor_epoch,
        initialPhase: 'preflight',
        brief: {
          chapterId,
          chapterNumber: chapter.chapter_number,
          batchIndex: index,
          productionMode: options.productionMode ?? 'formal_production'
        }
      });
      if (index > 0) tasks.addDependency(scope, taskId, taskIds[index - 1]!);
      tasks.queue(scope, taskId);
      taskIds.push(taskId);
    }
    const batchId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO chapter_batches (
        batch_id, owner_id, book_id, chapter_ids_json, task_ids_json,
        next_index, status, checkpoint_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'pending', '{}', ?, ?)
    `).run(batchId, scope.ownerId, scope.bookId, JSON.stringify(chapterIds), JSON.stringify(taskIds), now, now);
    new CreationWorkflowProgressService(this.database).markManuscriptStarted(scope, taskIds[0]!);
    return this.require(scope, batchId);
  }

  public scheduleExistingRevision(
    scope: BookScope,
    chapterId: string,
    manuscriptVersionId: string,
    operation: 'review_existing' | 'rewrite_existing',
    instruction: string | null = null
  ): { taskId: string; operation: 'review_existing' | 'rewrite_existing'; manuscriptVersionId: string } {
    assertBookScope(scope);
    const chapter = this.database.prepare(`SELECT chapter_number, settlement_status, current_manuscript_version_id
      FROM chapters WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
      .get(chapterId, scope.ownerId, scope.bookId) as {
        chapter_number: number; settlement_status: string; current_manuscript_version_id: string | null;
      } | undefined;
    if (chapter === undefined) throw new DomainError(errorCodes.bookScopeViolation, '章节不存在或越权', {}, false, 404);
    if (chapter.settlement_status === 'settled') throw new DomainError(errorCodes.operationIncomplete, '正史已结算章节不能通过草稿入口重写或定稿', {}, false, 409);
    if (chapter.current_manuscript_version_id !== manuscriptVersionId) throw new DomainError(errorCodes.operationIncomplete, '提交的正文已经不是当前版本', {}, true, 409);
    const manuscript = this.database.prepare(`SELECT 1 FROM manuscript_versions
      WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ? AND chapter_id = ?
        AND status IN ('draft','candidate','under_review','approved')`)
      .get(manuscriptVersionId, scope.ownerId, scope.bookId, chapterId);
    if (manuscript === undefined) throw new DomainError(errorCodes.bookScopeViolation, '当前正文版本不存在、越权或状态不可提交', {}, false, 404);
    const active = this.database.prepare(`SELECT 1 FROM tasks WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
      AND status IN ('pending','queued','working','waiting_confirmation','paused','interrupted') LIMIT 1`)
      .get(scope.ownerId, scope.bookId, chapterId);
    if (active !== undefined) throw new DomainError(errorCodes.taskAlreadyRunning, '本章已有进行中或待确认任务，请先处理当前任务', {}, false, 409);
    const selection = new WriterSelectionService(this.database, this.ids, this.clock).select(scope);
    const book = this.database.prepare(`SELECT editor_epoch FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { editor_epoch: number };
    const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
    if (budget === undefined) throw new DomainError(errorCodes.budgetExhausted, '书籍没有活动预算', {}, false, 409);
    const taskId = this.ids.next();
    const attempts = this.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND task_type = 'chapter_creation'`)
      .get(scope.ownerId, scope.bookId, chapterId) as { count: number };
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    tasks.create(scope, {
      taskId, taskType: 'chapter_creation', assignedAgentId: selection.writerAgentId, chapterId,
      idempotencyKey: `chapter-${operation}:${chapterId}:${manuscriptVersionId}:attempt:${attempts.count + 1}`,
      budgetId: budget.budget_id, requiredEditorEpoch: book.editor_epoch, initialPhase: 'preflight',
      brief: { operation, chapterId, chapterNumber: chapter.chapter_number, manuscriptVersionId, instruction: instruction ?? '' }
    });
    tasks.queue(scope, taskId);
    return { taskId, operation, manuscriptVersionId };
  }

  public async run(
    scope: BookScope,
    batchId: string,
    options: { pauseAfterCompletedChapters?: number; pauseAfterPhase?: PipelinePhase; workerId?: string } = {}
  ): Promise<{ batch: ChapterBatchRecord; results: PipelineResult[] }> {
    let batch = this.require(scope, batchId);
    if (batch.status === 'completed') return { batch, results: [] };
    const workerId = options.workerId ?? `batch-worker:${batchId}`;
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    const pipeline = new ChapterPipelineService(this.database, this.dataDir, this.releaseId, this.ids, this.clock, this.modelAdapters);
    const results: PipelineResult[] = [];
    this.database.prepare(`UPDATE chapter_batches SET status = 'working', updated_at = ? WHERE batch_id = ? AND owner_id = ? AND book_id = ?`)
      .run(this.clock.now().toISOString(), batchId, scope.ownerId, scope.bookId);
    try {
      while (batch.nextIndex < batch.chapterIds.length) {
        const taskId = batch.taskIds[batch.nextIndex]!;
        const task = tasks.require(scope, taskId);
        if (task.status === 'succeeded') {
          const nextIndex = batch.nextIndex + 1;
          this.database.prepare(`UPDATE chapter_batches SET next_index = ?, checkpoint_json = ?, updated_at = ?
            WHERE batch_id = ? AND owner_id = ? AND book_id = ?`)
            .run(nextIndex, JSON.stringify({ confirmedChapterId: batch.chapterIds[batch.nextIndex], completedTaskId: taskId }),
              this.clock.now().toISOString(), batchId, scope.ownerId, scope.bookId);
          batch = this.require(scope, batchId);
          continue;
        }
        if (task.status === 'cancelled') {
          this.database.prepare(`UPDATE chapter_batches SET status = 'cancelled', checkpoint_json = ?, updated_at = ?
            WHERE batch_id = ? AND owner_id = ? AND book_id = ?`)
            .run(JSON.stringify({ reason: 'owner_rejected', taskId }), this.clock.now().toISOString(), batchId, scope.ownerId, scope.bookId);
          return { batch: this.require(scope, batchId), results };
        }
        if (task.status === 'paused') tasks.queue(scope, taskId);
        const claimed = tasks.claimNext(workerId, 120_000);
        if (claimed === null || claimed.taskId !== taskId) throw new Error('批次下一章节任务未能按依赖顺序领取');
        const result = await pipeline.executeClaimed(scope, taskId, workerId, options.pauseAfterPhase, {
          leaseToken: claimed.leaseToken!,
          attemptNo: claimed.currentAttemptNo
        });
        results.push(result);
        if (result.status === 'paused') {
          this.pause(scope, batchId, batch.nextIndex, { reason: 'phase_checkpoint', phase: result.phase, taskId });
          return { batch: this.require(scope, batchId), results };
        }
        if (result.status === 'awaiting_confirmation') {
          this.pause(scope, batchId, batch.nextIndex, { reason: 'owner_confirmation', taskId, manuscriptVersionId: result.manuscriptVersionId });
          return { batch: this.require(scope, batchId), results };
        }
        if (result.status === 'blocked') {
          this.database.prepare(`UPDATE chapter_batches SET status = 'failed', checkpoint_json = ?, updated_at = ?
            WHERE batch_id = ? AND owner_id = ? AND book_id = ?`)
            .run(JSON.stringify({ reason: 'quality_blocked', taskId, manuscriptVersionId: result.manuscriptVersionId }),
              this.clock.now().toISOString(), batchId, scope.ownerId, scope.bookId);
          return { batch: this.require(scope, batchId), results };
        }
        const nextIndex = batch.nextIndex + 1;
        this.database.prepare(`
          UPDATE chapter_batches SET next_index = ?, checkpoint_json = ?, updated_at = ?
          WHERE batch_id = ? AND owner_id = ? AND book_id = ?
        `).run(nextIndex, JSON.stringify({ completedChapterId: batch.chapterIds[batch.nextIndex], completedTaskId: taskId }), this.clock.now().toISOString(), batchId, scope.ownerId, scope.bookId);
        batch = this.require(scope, batchId);
        if (options.pauseAfterCompletedChapters !== undefined && nextIndex >= options.pauseAfterCompletedChapters && nextIndex < batch.chapterIds.length) {
          this.pause(scope, batchId, nextIndex, { reason: 'batch_checkpoint', completedChapters: nextIndex });
          return { batch: this.require(scope, batchId), results };
        }
      }
      this.database.prepare(`UPDATE chapter_batches SET status = 'completed', updated_at = ? WHERE batch_id = ? AND owner_id = ? AND book_id = ?`)
        .run(this.clock.now().toISOString(), batchId, scope.ownerId, scope.bookId);
      return { batch: this.require(scope, batchId), results };
    } catch (error) {
      this.database.prepare(`UPDATE chapter_batches SET status = 'failed', checkpoint_json = ?, updated_at = ? WHERE batch_id = ? AND owner_id = ? AND book_id = ?`)
        .run(JSON.stringify({ error: error instanceof Error ? error.message : String(error), nextIndex: batch.nextIndex }), this.clock.now().toISOString(), batchId, scope.ownerId, scope.bookId);
      throw error;
    }
  }

  public require(scope: BookScope, batchId: string): ChapterBatchRecord {
    const row = this.database.prepare(`SELECT * FROM chapter_batches WHERE batch_id = ? AND owner_id = ? AND book_id = ?`)
      .get(batchId, scope.ownerId, scope.bookId) as BatchRow | undefined;
    if (row === undefined) throw new Error('章节批次不存在或越权');
    return {
      batchId: row.batch_id,
      chapterIds: JSON.parse(row.chapter_ids_json) as string[],
      taskIds: JSON.parse(row.task_ids_json) as string[],
      nextIndex: row.next_index,
      status: row.status,
      checkpoint: JSON.parse(row.checkpoint_json) as Record<string, unknown>
    };
  }

  private pause(scope: BookScope, batchId: string, nextIndex: number, checkpoint: Record<string, unknown>): void {
    this.database.prepare(`
      UPDATE chapter_batches SET next_index = ?, status = 'paused', checkpoint_json = ?, updated_at = ?
      WHERE batch_id = ? AND owner_id = ? AND book_id = ?
    `).run(nextIndex, JSON.stringify(checkpoint), this.clock.now().toISOString(), batchId, scope.ownerId, scope.bookId);
  }
}
