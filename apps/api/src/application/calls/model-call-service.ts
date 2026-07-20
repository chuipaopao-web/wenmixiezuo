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
    const requestId = this.begin(scope, call);
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
      const result = await adapter.generate(request, controller.signal);
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
      this.database.prepare(`
        UPDATE model_calls SET state = ?, error_class = ?, completed_at = ? WHERE request_id = ? AND state IN ('pending', 'working')
      `).run(interrupted ? 'interrupted' : 'failed', fencedOut ? 'lease_or_epoch_lost'
        : providerOutcomeUnknown ? 'provider_result_unknown' : interrupted ? 'cancelled' : failureClass,
      this.clock.now().toISOString(), requestId);
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
}
