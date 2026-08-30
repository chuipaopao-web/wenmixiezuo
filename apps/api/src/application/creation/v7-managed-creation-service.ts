import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { V7CreationRuntimeRepository, type V7ManagedCreationRunRow } from '../../infrastructure/db/repositories/v7-creation-runtime-repository.js';
import { V7CreationModelError } from '../../infrastructure/models/v7-creation-model-gateway.js';
import { V7CreationFormalizationService } from './v7-creation-formalization-service.js';
import { V7CreationWorkflowService, type V7CreationWorkflowView } from './v7-creation-workflow-service.js';

const LEASE_MILLISECONDS = 20 * 60_000;
const MAX_LOCAL_STEPS = 100;

/**
 * 作者明确下单后的本链托管执行器。租约和状态由系统维护；写作、复核与结算语义仍由对应成员完成。
 * 未知结果必须冻结，绝不自动重复调用。
 */
export class V7ManagedCreationService {
  private readonly repository: V7CreationRuntimeRepository;
  private readonly active = new Set<string>();

  public constructor(
    database: DatabaseSync,
    private readonly workflows: V7CreationWorkflowService,
    private readonly formalization: V7CreationFormalizationService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new V7CreationRuntimeRepository(database);
  }

  public activate(ownerId: string, bookId: string, workflowId: string, input: {
    writerMemberKey?: unknown;
    reviewerMemberKey?: unknown;
  }): V7CreationWorkflowView {
    let run = this.requireWorkflow(ownerId, bookId, workflowId);
    const writerMemberKey = optionalMemberKey(input.writerMemberKey);
    const reviewerMemberKey = optionalMemberKey(input.reviewerMemberKey);
    if (run.status === 'unknown') {
      const unknownCall = this.repository.modelCallsForWorkflow(ownerId, bookId, workflowId)
        .filter((call) => call.state === 'unknown')
        .at(-1);
      if (unknownCall?.run_kind !== 'manuscript') {
        throw conflict('上一次工作结果还不能确认，为避免重复扣费，请先等待或由管理员核对供应商结果。');
      }
      if (writerMemberKey === null || writerMemberKey === unknownCall.member_key) {
        throw conflict('上一次正文结果还不能确认。若要继续，请明确换一位主笔，系统不会自动重复下单。');
      }
      // The timeout call remains immutable and auditable. A different writer
      // is only allowed after the author explicitly selects that member in the
      // recovery UI; automatic managed retries still stop on unknown results.
      this.repository.updateWorkflow({
        ownerId, bookId, workflowId, stage: run.stage, status: 'working',
        checkpoint: {
          ...parseObject(run.checkpoint_json),
          acknowledgedUnknownRequestId: unknownCall.request_id,
          acknowledgedUnknownMemberKey: unknownCall.member_key
        },
        errorMessage: null, now: this.now()
      });
      run = this.requireWorkflow(ownerId, bookId, workflowId);
    }
    if (run.status === 'completed') throw conflict('这项任务已经结束。');
    if (run.status === 'cancelled') {
      if (!['manuscript', 'manuscript_confirmation', 'settlement'].includes(run.stage)) {
        throw conflict('这项工作尚未进入正文阶段，请从当前页面重新开始。');
      }
      this.repository.updateWorkflow({
        ownerId, bookId, workflowId, stage: run.stage, status: 'working',
        checkpoint: parseObject(run.checkpoint_json), errorMessage: null, now: this.now()
      });
      run = this.requireWorkflow(ownerId, bookId, workflowId);
    }
    if (!['manuscript', 'manuscript_confirmation', 'settlement'].includes(run.stage)) {
      throw conflict('请先确认本链章纲，再开始托管创作。');
    }
    if (writerMemberKey !== null) this.workflows.chooseMember(ownerId, bookId, workflowId, { roleKey: 'lead_writer', memberKey: writerMemberKey });
    if (reviewerMemberKey !== null) this.workflows.chooseMember(ownerId, bookId, workflowId, { roleKey: 'independent_reviewer', memberKey: reviewerMemberKey });
    this.repository.saveManagedRun({ ownerId, bookId, workflowId, mode: 'managed', writerMemberKey, reviewerMemberKey, now: this.now() });
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId, stage: run.stage, status: 'working',
      checkpoint: parseObject(run.checkpoint_json), errorMessage: null, now: this.now()
    });
    // 先保存托管状态，再由写后维护按数据库中的真实完成结果推进断点。
    // 若反过来执行，旧的 settlement 快照会覆盖刚刚算出的 manuscript 阶段。
    if (run.stage === 'settlement') this.formalization.retryFailed(ownerId, bookId, workflowId);
    this.kick(ownerId, bookId, workflowId);
    return this.workflows.get(ownerId, bookId, workflowId);
  }

  public kick(ownerId: string, bookId: string, workflowId: string): void {
    if (this.active.has(workflowId)) return;
    this.active.add(workflowId);
    void this.drain(ownerId, bookId, workflowId).finally(() => this.active.delete(workflowId));
  }

  public async processPending(limit = 1): Promise<{ processed: number; advanced: number; stopped: number }> {
    const rows = this.repository.pendingManagedRuns(Math.max(1, Math.min(limit, 20)), this.now());
    let advanced = 0;
    let stopped = 0;
    for (const row of rows) {
      if (await this.advance(row)) advanced += 1;
      else stopped += 1;
    }
    return { processed: rows.length, advanced, stopped };
  }

  private async drain(ownerId: string, bookId: string, workflowId: string): Promise<void> {
    for (let step = 0; step < MAX_LOCAL_STEPS; step += 1) {
      const row = this.repository.managedRun(ownerId, bookId, workflowId);
      if (row === undefined || row.mode !== 'managed' || row.status !== 'active') return;
      if (!await this.advance(row)) return;
    }
    const row = this.repository.managedRun(ownerId, bookId, workflowId);
    if (row !== undefined && row.status === 'active') {
      this.fail(row, 'failed', '对不起，这条链的连续工作次数超过安全上限，已暂停，请检查后再继续。');
    }
  }

  private async advance(row: V7ManagedCreationRunRow): Promise<boolean> {
    const leaseToken = this.ids.next();
    const now = this.now();
    if (!this.repository.claimManagedRun(row.workflow_id, leaseToken, new Date(Date.parse(now) + LEASE_MILLISECONDS).toISOString(), now)) return false;
    try {
      const run = this.requireWorkflow(row.owner_id, row.book_id, row.workflow_id);
      if (run.status === 'cancelled') {
        this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'cancelled', message: '任务已停止，已经完成的正文仍然保留。', now: this.now() });
        return false;
      }
      const view = this.workflows.get(row.owner_id, row.book_id, row.workflow_id);
      if (view.stage === 'completed') {
        this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'completed', message: null, now: this.now() });
        return false;
      }
      if (view.stage === 'manuscript') {
        if (view.progress.nextChapterNumber === null) {
          this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'active', message: null, now: this.now() });
          return false;
        }
        this.repository.updateWorkflow({
          ownerId: row.owner_id, bookId: row.book_id, workflowId: row.workflow_id, stage: run.stage, status: 'working',
          checkpoint: parseObject(run.checkpoint_json), errorMessage: null, now: this.now()
        });
        await this.workflows.generateManuscript(row.owner_id, row.book_id, row.workflow_id, {
          chapterNumber: view.progress.nextChapterNumber,
          ...(row.writer_member_key === null ? {} : { writerMemberKey: row.writer_member_key }),
          ...(row.reviewer_member_key === null ? {} : { reviewerMemberKey: row.reviewer_member_key })
        });
        this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'active', message: null, now: this.now() });
        return true;
      }
      if (view.stage === 'manuscript_confirmation') {
        if (view.manuscript?.review?.passed !== true) {
          this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'failed', message: '对不起，这一章没有通过复核，正文和修改意见已经保留。', now: this.now() });
          return false;
        }
        this.workflows.finalizeManuscript(row.owner_id, row.book_id, row.workflow_id, {
          manuscriptVersionId: view.manuscript.manuscriptVersionId,
          idempotencyKey: `managed-finalize:${row.workflow_id}:${view.manuscript.manuscriptVersionId}`
        });
        this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'active', message: null, now: this.now() });
        return true;
      }
      if (view.stage === 'settlement') {
        const summary = await this.formalization.processPending(24);
        const refreshed = this.workflows.get(row.owner_id, row.book_id, row.workflow_id);
        if (refreshed.stage === 'completed') {
          this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'completed', message: null, now: this.now() });
          return false;
        }
        if (refreshed.status === 'failed') {
          this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'failed', message: refreshed.errorMessage ?? '对不起，写后整理没有完成。', now: this.now() });
          return false;
        }
        if (refreshed.stage === 'manuscript') {
          const latest = this.requireWorkflow(row.owner_id, row.book_id, row.workflow_id);
          this.repository.updateWorkflow({
            ownerId: row.owner_id, bookId: row.book_id, workflowId: row.workflow_id, stage: latest.stage, status: 'working',
            checkpoint: parseObject(latest.checkpoint_json), errorMessage: null, now: this.now()
          });
          this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'active', message: null, now: this.now() });
          return true;
        }
        this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'active', message: null, now: this.now() });
        return summary.processed > 0;
      }
      this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status: 'paused', message: '需要您先完成当前选择，托管创作没有继续下单。', now: this.now() });
      return false;
    } catch (error) {
      const unknown = error instanceof V7CreationModelError && error.outcomeUnknown;
      const message = unknown
        ? '对不起，这次工作结果还不能确认，已停止重复下单。'
        : `对不起，这次没有完成。${publicFailure(error)}`;
      this.repository.releaseManagedRun({
        workflowId: row.workflow_id, leaseToken, status: unknown ? 'unknown' : 'failed', message, now: this.now()
      });
      const current = this.repository.workflow(row.owner_id, row.book_id, row.workflow_id);
      if (current !== undefined && current.status !== 'cancelled') {
        this.repository.updateWorkflow({
          ownerId: row.owner_id, bookId: row.book_id, workflowId: row.workflow_id, stage: current.stage,
          status: unknown ? 'unknown' : 'failed', checkpoint: parseObject(current.checkpoint_json), errorMessage: message, now: this.now()
        });
      }
      return false;
    }
  }

  private fail(row: V7ManagedCreationRunRow, status: 'failed' | 'unknown', message: string): void {
    const leaseToken = this.ids.next();
    const now = this.now();
    if (!this.repository.claimManagedRun(row.workflow_id, leaseToken, new Date(Date.parse(now) + LEASE_MILLISECONDS).toISOString(), now)) return;
    this.repository.releaseManagedRun({ workflowId: row.workflow_id, leaseToken, status, message, now: this.now() });
  }

  private requireWorkflow(ownerId: string, bookId: string, workflowId: string) {
    const run = this.repository.workflow(ownerId, bookId, workflowId);
    if (run === undefined) throw new DomainError(errorCodes.bookNotFound, '创作任务不存在或不属于本书。', {}, false, 404);
    return run;
  }

  private now(): string { return this.clock.now().toISOString(); }
}

function optionalMemberKey(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 120) throw conflict('成员选择无效。');
  return value.trim();
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function publicFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return '成员没有交回可用结果。';
}

function conflict(message: string): DomainError {
  return new DomainError(errorCodes.validation, message, {}, false, 409);
}
