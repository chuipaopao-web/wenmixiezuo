import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../infrastructure/models/model-adapter.js';
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
      WHERE t.task_id = ? AND t.owner_id = ? AND t.book_id = ?
    `).get(call.agentId, call.modelSnapshotId, call.provider, call.modelId, call.reservationId, call.taskId, scope.ownerId, scope.bookId);
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
    if (requestId !== call.requestId) throw new Error('相同输入的模型调用已经存在，拒绝重复调用');
    const controller = new AbortController();
    activeModelCallControllers.set(requestId, controller);
    const startedAt = Date.now();
    this.database.prepare(`UPDATE model_calls SET state = 'working', started_at = ? WHERE request_id = ? AND state = 'pending'`)
      .run(this.clock.now().toISOString(), requestId);
    this.events?.append(scope, 'model_call.started', { requestId, taskId: call.taskId, provider: adapter.provider, modelId: adapter.modelId });
    try {
      const result = await adapter.generate(request, controller.signal);
      if (result.provider !== adapter.provider || result.modelId !== adapter.modelId) {
        throw new Error('模型返回来源与已验证适配器不一致');
      }
      const durationMs = Math.max(0, Date.now() - startedAt);
      this.database.prepare(`
        UPDATE model_calls SET input_tokens = ?, output_tokens = ?, cash_micros = ?,
          duration_ms = ?, result_reference = ?, completed_at = ?
        WHERE request_id = ? AND state = 'working'
      `).run(
        result.inputTokens, result.outputTokens, Math.round(result.cashCostCny * 1_000_000),
        durationMs, `inline-sha256:${createHash('sha256').update(result.output).digest('hex')}`,
        this.clock.now().toISOString(), requestId
      );
      this.budgets.settle(scope, call.reservationId, {
        taskId: call.taskId,
        provider: result.provider,
        modelId: result.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cashMicros: Math.round(result.cashCostCny * 1_000_000),
        durationMs
      });
      this.database.prepare(`UPDATE model_calls SET state = 'succeeded' WHERE request_id = ? AND state = 'working'`).run(requestId);
      return result;
    } catch (error) {
      const interrupted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
      this.database.prepare(`
        UPDATE model_calls SET state = ?, error_class = ?, completed_at = ? WHERE request_id = ? AND state IN ('pending', 'working')
      `).run(interrupted ? 'interrupted' : 'failed', interrupted ? 'cancelled' : 'technical_failure', this.clock.now().toISOString(), requestId);
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
}
