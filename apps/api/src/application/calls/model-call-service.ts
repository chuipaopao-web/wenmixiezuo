import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ModelAdapterError, type ModelAdapter, type ModelRequest, type ModelResult } from '../../infrastructure/models/model-adapter.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { EventStore } from '../events/event-store.js';

export interface BeginModelCall {
  requestId: string;
  taskId: string;
  phaseKey: string;
  agentId: string;
  modelSnapshotId: string;
  provider: string;
  modelId: string;
  input: string;
  parameters: string;
  reservationId: string;
  contextPackId?: string | null;
  leaseToken?: string | null;
  attemptNo?: number | null;
}

const activeModelCallControllers = new Map<string, AbortController>();

export function cancelActiveModelCall(requestId: string): boolean {
  const controller = activeModelCallControllers.get(requestId);
  if (controller === undefined) return false;
  controller.abort(new DOMException('模型调用已取消', 'AbortError'));
  return true;
}

export class ModelCallService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly clock: Clock,
    private readonly budgets: BudgetService,
    private readonly events?: EventStore
  ) {}

  public begin(scope: BookScope, call: BeginModelCall): string {
    assertBookScope(scope);
    const inputHash = createHash('sha256').update(call.input).digest('hex');
    const parametersHash = createHash('sha256').update(call.parameters).digest('hex');
    const existing = this.database.prepare(`
      SELECT request_id FROM model_calls
      WHERE task_id = ? AND phase_key = ? AND model_snapshot_id = ? AND input_hash = ?
    `).get(call.taskId, call.phaseKey, call.modelSnapshotId, inputHash) as { request_id: string } | undefined;
    if (existing !== undefined) return existing.request_id;
    const valid = this.database.prepare(`
      SELECT 1
      FROM tasks t
      JOIN agent_instances a ON a.agent_id = ? AND a.owner_id = t.owner_id AND a.book_id = t.book_id
      JOIN model_config_snapshots m ON m.model_snapshot_id = ? AND m.owner_id = t.owner_id AND m.book_id = t.book_id
        AND m.provider = ? AND m.model_id = ?
      JOIN budget_reservations r ON r.reservation_id = ? AND r.owner_id = t.owner_id AND r.book_id = t.book_id
        AND r.request_id = ? AND r.status = 'reserved'
      WHERE t.task_id = ? AND t.owner_id = ? AND t.book_id = ?
    `).get(call.agentId, call.modelSnapshotId, call.provider, call.modelId, call.reservationId,
      call.requestId, call.taskId, scope.ownerId, scope.bookId);
    if (valid === undefined) throw new Error('模型调用引用越权或不完整');
    this.database.prepare(`
      INSERT INTO model_calls (
        request_id, owner_id, book_id, task_id, phase_key, agent_id, provider,
        model_id, model_snapshot_id, input_hash, parameters_hash, reservation_id,
        context_pack_id, state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      call.requestId, scope.ownerId, scope.bookId, call.taskId, call.phaseKey, call.agentId,
      call.provider, call.modelId, call.modelSnapshotId, inputHash, parametersHash,
      call.reservationId, call.contextPackId ?? null, this.clock.now().toISOString()
    );
    return call.requestId;
  }

  public async execute(scope: BookScope, call: BeginModelCall, adapter: ModelAdapter, request: ModelRequest): Promise<ModelResult> {
    if (adapter.provider !== call.provider || adapter.modelId !== call.modelId) throw new Error('模型适配器与配置快照来源不匹配');
    const preference = this.database.prepare(`
      SELECT prompt_preference_id, version, content
      FROM agent_prompt_preferences
      WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND status = 'active'
      ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, call.agentId) as {
      prompt_preference_id: string; version: number; content: string;
    } | undefined;
    const effectiveCall = preference === undefined ? call : {
      ...call,
      input: `${call.input}\n[prompt-preference:${preference.prompt_preference_id}:v${preference.version}]`
    };
    const effectiveRequest = preference === undefined || preference.content.trim().length === 0
      ? request
      : { ...request, supplementalInstructions: preference.content };
    const requestId = this.begin(scope, effectiveCall);
    if (preference !== undefined && requestId === call.requestId) {
      this.database.prepare(`
        UPDATE model_calls SET prompt_preference_id = ?
        WHERE request_id = ? AND owner_id = ? AND book_id = ?
      `).run(preference.prompt_preference_id, requestId, scope.ownerId, scope.bookId);
    }
    if (requestId !== call.requestId) {
      const reusable = this.loadSucceededResult(scope, requestId, call.provider, call.modelId);
      if (reusable !== null) {
        this.budgets.release(scope, call.reservationId);
        return reusable;
      }
      this.budgets.release(scope, call.reservationId);
      throw new Error('相同输入的模型调用状态未知或未完成，拒绝重复调用');
    }
    const controller = new AbortController();
    activeModelCallControllers.set(requestId, controller);
    const startedAt = Date.now();
    let completedResult: ModelResult | null = null;
    let completedDurationMs = 0;
    this.database.prepare(`UPDATE model_calls SET state = 'working', started_at = ? WHERE request_id = ? AND state = 'pending'`)
      .run(this.clock.now().toISOString(), requestId);
    this.events?.append(scope, 'model_call.started', { requestId, taskId: call.taskId, provider: adapter.provider, modelId: adapter.modelId });
    try {
      const result = await adapter.generate(effectiveRequest, controller.signal);
      if (result.provider !== adapter.provider || result.modelId !== adapter.modelId) {
        throw new Error('模型返回来源与已验证适配器不一致');
      }
      const durationMs = Math.max(0, Date.now() - startedAt);
      completedResult = result;
      completedDurationMs = durationMs;
      const completedAt = this.clock.now().toISOString();
      const outputHash = createHash('sha256').update(result.output).digest('hex');
      const cashMicros = Math.round(result.cashCostCny * 1_000_000);
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const taskFence = this.database.prepare(`
          SELECT 1 FROM tasks t JOIN books b ON b.owner_id = t.owner_id AND b.book_id = t.book_id
          WHERE t.task_id = ? AND t.owner_id = ? AND t.book_id = ?
            AND (? IS NULL OR (
              t.status = 'working' AND t.lease_expires_at > ? AND t.lease_token = ? AND t.current_attempt_no = ?
              AND (t.required_editor_epoch = 0 OR t.required_editor_epoch = b.editor_epoch)
            ))
        `).get(call.taskId, scope.ownerId, scope.bookId, call.leaseToken ?? null,
          completedAt, call.leaseToken ?? null, call.attemptNo ?? 0);
        if (taskFence === undefined) throw new Error('MODEL_CALL_COMMIT_FENCE_REJECTED');
        const recorded = this.database.prepare(`
          UPDATE model_calls SET input_tokens = ?, output_tokens = ?, cash_micros = ?,
            duration_ms = ?, result_reference = ?, completed_at = ?
          WHERE request_id = ? AND owner_id = ? AND book_id = ? AND state = 'working'
        `).run(result.inputTokens, result.outputTokens, cashMicros, durationMs,
          `model-call-result:${requestId}`, completedAt, requestId, scope.ownerId, scope.bookId);
        if (recorded.changes !== 1) throw new Error('MODEL_CALL_STATE_CHANGED');
        this.database.prepare(`
          INSERT INTO model_call_results (
            model_call_result_id, request_id, owner_id, book_id, output_text, output_hash,
            input_tokens, output_tokens, cash_micros, duration_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`result-${requestId}`, requestId, scope.ownerId, scope.bookId, result.output, outputHash,
          result.inputTokens, result.outputTokens, cashMicros, durationMs, completedAt);
        this.budgets.settle(scope, call.reservationId, {
          taskId: call.taskId,
          provider: result.provider,
          modelId: result.modelId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cashMicros,
          durationMs
        });
        const succeeded = this.database.prepare(`
          UPDATE model_calls SET state = 'succeeded' WHERE request_id = ? AND state = 'working'
        `).run(requestId);
        if (succeeded.changes !== 1) throw new Error('MODEL_CALL_SUCCESS_COMMIT_REJECTED');
        this.database.exec('COMMIT');
      } catch (error) {
        if (this.database.isTransaction) this.database.exec('ROLLBACK');
        throw error;
      }
      return result;
    } catch (error) {
      const fencedOut = error instanceof Error && error.message === 'MODEL_CALL_COMMIT_FENCE_REJECTED';
      if (fencedOut && completedResult !== null) {
        this.persistDiscardedLateResult(scope, call, requestId, completedResult, completedDurationMs);
        this.events?.append(scope, 'model_call.interrupted', { requestId, taskId: call.taskId, reason: 'commit_fence_lost' });
        throw error;
      }
      const providerOutcomeUnknown = error instanceof ModelAdapterError && error.outcomeUnknown;
      const interrupted = fencedOut || providerOutcomeUnknown || controller.signal.aborted
        || (error instanceof Error && error.name === 'AbortError');
      const failureClass = error instanceof ModelAdapterError ? error.failureClass : 'technical_failure';
      // 真实错误（含 provider 返回的状态与脱敏详情）落库，避免被上层错误映射吞成通用
      // INVALID_REQUEST_BODY 后无法诊断（如"讨论任务重试17次全失败但看不到原因"事故）。
      const errorDetail = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
      this.database.prepare(`
        UPDATE model_calls SET state = ?, error_class = ?, error_detail = ?, completed_at = ? WHERE request_id = ? AND state IN ('pending', 'working')
      `).run(interrupted ? 'interrupted' : 'failed', fencedOut ? 'lease_or_epoch_lost'
        : providerOutcomeUnknown ? 'provider_result_unknown' : interrupted ? 'cancelled' : failureClass,
      errorDetail, this.clock.now().toISOString(), requestId);
      if (interrupted) {
        if (adapter.provider.startsWith('local-deterministic')) {
          this.budgets.release(scope, call.reservationId);
          this.database.prepare(`
            INSERT INTO model_call_reconciliations (
              request_id, owner_id, book_id, state, reason_code, details_json, created_at, resolved_at
            ) VALUES (?, ?, ?, 'retry_safe', 'LOCAL_CALL_INTERRUPTED', '{}', ?, ?)
            ON CONFLICT(request_id) DO UPDATE SET state = 'retry_safe',
              reason_code = excluded.reason_code, resolved_at = excluded.resolved_at
          `).run(requestId, scope.ownerId, scope.bookId, this.clock.now().toISOString(), this.clock.now().toISOString());
        } else this.database.prepare(`
          INSERT INTO model_call_reconciliations (
            request_id, owner_id, book_id, state, reason_code, details_json, created_at
          ) VALUES (?, ?, ?, 'awaiting_provider', ?, '{}', ?)
          ON CONFLICT(request_id) DO NOTHING
        `).run(requestId, scope.ownerId, scope.bookId,
          fencedOut ? 'COMMIT_FENCE_LOST_RESULT_UNKNOWN'
            : providerOutcomeUnknown ? 'PROVIDER_RESULT_UNKNOWN' : 'INTERRUPTED_RESULT_UNKNOWN',
          this.clock.now().toISOString());
      }
      if (!interrupted) this.budgets.release(scope, call.reservationId);
      if (interrupted) this.events?.append(scope, 'model_call.interrupted', { requestId, taskId: call.taskId });
      throw error;
    } finally {
      activeModelCallControllers.delete(requestId);
    }
  }

  public cancel(requestId: string): boolean {
    return cancelActiveModelCall(requestId);
  }

  private loadSucceededResult(scope: BookScope, requestId: string, provider: string, modelId: string): ModelResult | null {
    const row = this.database.prepare(`
      SELECT r.output_text, r.input_tokens, r.output_tokens, r.cash_micros
      FROM model_calls m JOIN model_call_results r ON r.request_id = m.request_id
      WHERE m.request_id = ? AND m.owner_id = ? AND m.book_id = ? AND m.state = 'succeeded'
        AND m.provider = ? AND m.model_id = ?
    `).get(requestId, scope.ownerId, scope.bookId, provider, modelId) as {
      output_text: string; input_tokens: number; output_tokens: number; cash_micros: number;
    } | undefined;
    if (row === undefined) return null;
    return {
      provider,
      modelId,
      output: row.output_text,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cashCostCny: row.cash_micros / 1_000_000,
      state: 'succeeded'
    };
  }

  private persistDiscardedLateResult(
    scope: BookScope,
    call: BeginModelCall,
    requestId: string,
    result: ModelResult,
    durationMs: number
  ): void {
    const now = this.clock.now().toISOString();
    const outputHash = createHash('sha256').update(result.output).digest('hex');
    const cashMicros = Math.round(result.cashCostCny * 1_000_000);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO model_call_results (
          model_call_result_id, request_id, owner_id, book_id, output_text, output_hash,
          input_tokens, output_tokens, cash_micros, duration_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id) DO NOTHING
      `).run(`result-${requestId}`, requestId, scope.ownerId, scope.bookId, result.output, outputHash,
        result.inputTokens, result.outputTokens, cashMicros, durationMs, now);
      this.budgets.settle(scope, call.reservationId, {
        taskId: call.taskId,
        provider: result.provider,
        modelId: result.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cashMicros,
        durationMs
      });
      this.database.prepare(`
        UPDATE model_calls SET state = 'interrupted', input_tokens = ?, output_tokens = ?, cash_micros = ?,
          duration_ms = ?, result_reference = ?, error_class = 'lease_or_epoch_lost', completed_at = ?
        WHERE request_id = ? AND owner_id = ? AND book_id = ? AND state = 'working'
      `).run(result.inputTokens, result.outputTokens, cashMicros, durationMs,
        `model-call-result:${requestId}`, now, requestId, scope.ownerId, scope.bookId);
      this.database.prepare(`
        INSERT INTO model_call_reconciliations (
          request_id, owner_id, book_id, state, reason_code, details_json, created_at, resolved_at
        ) VALUES (?, ?, ?, 'discarded', 'COMMIT_FENCE_LOST_RESULT_DISCARDED', '{}', ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET state = 'discarded',
          reason_code = excluded.reason_code, resolved_at = excluded.resolved_at
      `).run(requestId, scope.ownerId, scope.bookId, now, now);
      this.database.exec('COMMIT');
    } catch (persistError) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw persistError;
    }
  }

  public reconcileInterruptedCall(scope: BookScope, requestId: string): {
    requestId: string;
    finalState: 'reusable' | 'retry_safe' | 'discarded' | 'awaiting_provider';
    settled: boolean;
    reason: string;
  } {
    // P0-5: 远程中断调用的主动调和入口。按本地已有证据决定终态，不猜测 provider 侧结果。
    assertBookScope(scope);
    const call = this.database.prepare(`
      SELECT task_id, reservation_id, provider, model_id, state, started_at
      FROM model_calls WHERE request_id = ? AND owner_id = ? AND book_id = ?
    `).get(requestId, scope.ownerId, scope.bookId) as {
      task_id: string; reservation_id: string; provider: string; model_id: string;
      state: string; started_at: string | null;
    } | undefined;
    if (call === undefined) throw new Error('调和失败：找不到对应的模型调用记录');
    if (call.state !== 'interrupted') {
      return { requestId, finalState: 'awaiting_provider', settled: false, reason: `调用当前状态为 ${call.state}，非中断态，无需调和` };
    }
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      SELECT output_text, input_tokens, output_tokens, cash_micros, duration_ms
      FROM model_call_results WHERE request_id = ? AND owner_id = ? AND book_id = ?
    `).get(requestId, scope.ownerId, scope.bookId) as {
      output_text: string; input_tokens: number; output_tokens: number; cash_micros: number; duration_ms: number;
    } | undefined;
    if (result !== undefined) {
      // 找到已完成结果 -> 按真实用量结算，标记可复用（原子：settle 加入外层事务）
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.budgets.settle(scope, call.reservation_id, {
          taskId: call.task_id, provider: call.provider, modelId: call.model_id,
          inputTokens: result.input_tokens, outputTokens: result.output_tokens,
          cashMicros: result.cash_micros, durationMs: result.duration_ms
        });
        this.database.prepare(`
          UPDATE model_calls SET state = 'succeeded', input_tokens = ?, output_tokens = ?, cash_micros = ?,
            duration_ms = ?, result_reference = ?, completed_at = ?
          WHERE request_id = ? AND owner_id = ? AND book_id = ? AND state = 'interrupted'
        `).run(result.input_tokens, result.output_tokens, result.cash_micros, result.duration_ms,
          `model-call-result:${requestId}`, now, requestId, scope.ownerId, scope.bookId);
        this.database.prepare(`
          INSERT INTO model_call_reconciliations (request_id, owner_id, book_id, state, reason_code, details_json, created_at, resolved_at)
          VALUES (?, ?, ?, 'reusable', 'LATE_RESULT_RECONCILED', '{}', ?, ?)
          ON CONFLICT(request_id) DO UPDATE SET state = 'reusable', reason_code = 'LATE_RESULT_RECONCILED', resolved_at = excluded.resolved_at
        `).run(requestId, scope.ownerId, scope.bookId, now, now);
        this.database.exec('COMMIT');
      } catch (error) {
        if (this.database.isTransaction) this.database.exec('ROLLBACK');
        throw error;
      }
      return { requestId, finalState: 'reusable', settled: true, reason: '找到已完成结果，按真实用量结算并标记可复用' };
    }
    const provenNotExecuted = call.provider.startsWith('local-deterministic') || call.started_at === null;
    if (provenNotExecuted) {
      // 可证明未执行 -> 释放预留并标记可安全重试（release 自开事务，故不外包）
      this.budgets.release(scope, call.reservation_id);
      this.database.prepare(`
        INSERT INTO model_call_reconciliations (request_id, owner_id, book_id, state, reason_code, details_json, created_at, resolved_at)
        VALUES (?, ?, ?, 'retry_safe', 'PROVEN_NOT_EXECUTED', '{}', ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET state = 'retry_safe', reason_code = 'PROVEN_NOT_EXECUTED', resolved_at = excluded.resolved_at
      `).run(requestId, scope.ownerId, scope.bookId, now, now);
      return { requestId, finalState: 'retry_safe', settled: false, reason: '可证明未执行，释放预留并标记可安全重试' };
    }
    // 远程中断、无结果、本地无法证明未执行 -> 保持 awaiting_provider，记录调和尝试，UI 显示未决而非静默占用
    const prior = this.database.prepare(`SELECT details_json FROM model_call_reconciliations WHERE request_id = ? AND owner_id = ? AND book_id = ?`)
      .get(requestId, scope.ownerId, scope.bookId) as { details_json: string } | undefined;
    const attemptCount = prior === undefined ? 1 : (Number((JSON.parse(prior.details_json) as { attemptCount?: number }).attemptCount) || 0) + 1;
    this.database.prepare(`
      INSERT INTO model_call_reconciliations (request_id, owner_id, book_id, state, reason_code, details_json, created_at)
      VALUES (?, ?, ?, 'awaiting_provider', 'NO_RESULT_QUERY_UNAVAILABLE', ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET state = 'awaiting_provider',
        reason_code = 'NO_RESULT_QUERY_UNAVAILABLE', details_json = excluded.details_json
    `).run(requestId, scope.ownerId, scope.bookId, JSON.stringify({ attemptCount }), now);
    return { requestId, finalState: 'awaiting_provider', settled: false, reason: '供应商结果未知且本地无法查询，保持冻结等待人工或供应商确认' };
  }

  /**
   * 自动兜底：中断超过宽限期仍无结果的调用，释放冻结预算并标记失败，
   * 避免重启/断网后预留永久冻结、用户新书被"预算不足"卡死。
   * 同时清理解雇重启残留的"无主预留"（有预留无调用记录）。
   * 返回处理的调用与预留数量，供启动与周期巡检记录。
   */
  public sweepStaleInterruptedCalls(staleMs: number): { releasedCalls: number; releasedOrphans: number } {
    const cutoff = new Date(this.clock.now().getTime() - staleMs).toISOString();
    const now = this.clock.now().toISOString();
    const staleCalls = this.database.prepare(`
      SELECT c.request_id, c.owner_id, c.book_id, c.reservation_id
      FROM model_calls c
      WHERE c.state = 'interrupted' AND COALESCE(c.completed_at, c.created_at) < ?
        AND NOT EXISTS (
          SELECT 1 FROM model_call_results r WHERE r.request_id = c.request_id
            AND r.owner_id = c.owner_id AND r.book_id = c.book_id
        )
    `).all(cutoff) as unknown as Array<{ request_id: string; owner_id: string; book_id: string; reservation_id: string }>;
    let releasedCalls = 0;
    for (const call of staleCalls) {
      const scope = { ownerId: call.owner_id, bookId: call.book_id };
      this.budgets.release(scope, call.reservation_id);
      this.database.prepare(`
        UPDATE model_calls SET state = 'failed', error_class = 'interrupted_timeout', completed_at = ?
        WHERE request_id = ? AND owner_id = ? AND book_id = ? AND state = 'interrupted'
      `).run(now, call.request_id, call.owner_id, call.book_id);
      this.database.prepare(`
        INSERT INTO model_call_reconciliations (request_id, owner_id, book_id, state, reason_code, details_json, created_at, resolved_at)
        VALUES (?, ?, ?, 'discarded', 'AUTO_RELEASE_STALE_TIMEOUT', '{}', ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET state = 'discarded', reason_code = 'AUTO_RELEASE_STALE_TIMEOUT', resolved_at = excluded.resolved_at
      `).run(call.request_id, call.owner_id, call.book_id, now, now);
      releasedCalls += 1;
    }
    const orphans = this.database.prepare(`
      SELECT reservation_id, owner_id, book_id FROM budget_reservations
      WHERE status = 'reserved' AND created_at < ?
        AND request_id NOT IN (SELECT request_id FROM model_calls)
    `).all(cutoff) as unknown as Array<{ reservation_id: string; owner_id: string; book_id: string }>;
    for (const orphan of orphans) {
      this.budgets.release({ ownerId: orphan.owner_id, bookId: orphan.book_id }, orphan.reservation_id);
    }
    return { releasedCalls, releasedOrphans: orphans.length };
  }

  public reportUnreconciledReservations(scope: BookScope): {
    orphanReservationCount: number;
    orphanReservations: Array<{ reservationId: string; requestId: string; frozenTokens: number }>;
    awaitingProviderCount: number;
    invariantHolds: boolean;
  } {
    // P0-5 不变式巡检：无模型调用且无调和记录的预留（无主预留）必须为 0。
    assertBookScope(scope);
    const orphans = this.database.prepare(`
      SELECT reservation_id, request_id, frozen_tokens
      FROM budget_reservations
      WHERE owner_id = ? AND book_id = ? AND status = 'reserved'
        AND request_id NOT IN (SELECT request_id FROM model_calls WHERE owner_id = ? AND book_id = ?)
        AND request_id NOT IN (SELECT request_id FROM model_call_reconciliations WHERE owner_id = ? AND book_id = ?)
    `).all(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId, scope.ownerId, scope.bookId) as Array<{
      reservation_id: string; request_id: string; frozen_tokens: number;
    }>;
    const awaiting = this.database.prepare(`
      SELECT COUNT(*) AS count FROM model_call_reconciliations
      WHERE owner_id = ? AND book_id = ? AND state = 'awaiting_provider'
    `).get(scope.ownerId, scope.bookId) as { count: number };
    return {
      orphanReservationCount: orphans.length,
      orphanReservations: orphans.map((row) => ({
        reservationId: row.reservation_id, requestId: row.request_id, frozenTokens: row.frozen_tokens
      })),
      awaitingProviderCount: awaiting.count,
      invariantHolds: orphans.length === 0
    };
  }
}
