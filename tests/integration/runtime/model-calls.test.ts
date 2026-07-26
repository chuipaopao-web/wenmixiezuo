import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { AgentPromptPreferenceService } from '../../../apps/api/src/application/agents/agent-prompt-preference-service.js';
import { AgentPromptPreferenceRepository } from '../../../apps/api/src/infrastructure/db/repositories/agent-prompt-preference-repository.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { DeterministicModelAdapter } from '../../../apps/api/src/infrastructure/models/deterministic-model.js';
import { ModelAdapterError, type ModelAdapter, type ModelRequest, type ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { FixedClock, MutableClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function setup(clock: FixedClock | MutableClock = new FixedClock()) {
  context = createTestContext();
  const ids = new SequenceIds();
  const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
  const agents = initializeRuntimeBook(context, scope, ids, clock);
  const agent = agents[0]!;
  const snapshot = context.database.prepare('SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?').get(agent.agentId) as { model_snapshot_id: string };
  const budgets = new BudgetService(context.database, ids, clock);
  const budget = budgets.create(scope, 'standard', 1_000, 0);
  const tasks = new TaskService(context.database, context.config.releaseId, clock);
  tasks.create(scope, { taskId: 'task-model', taskType: 'model_probe', assignedAgentId: agent.agentId, idempotencyKey: 'model-probe', budgetId: budget.budgetId, initialPhase: 'draft', brief: {} });
  return { ids, scope, agent, snapshotId: snapshot.model_snapshot_id, budgets, budget, tasks, clock };
}

describe('模型调用账本、幂等与真实取消', () => {
  it('把书籍级岗位补充要求注入真实适配器并记录使用版本', async () => {
    const fixture = setup();
    const preferences = new AgentPromptPreferenceService(
      new AgentPromptPreferenceRepository(context!.database), fixture.ids, fixture.clock
    );
    const saved = preferences.revise(fixture.scope, fixture.agent.agentId, 0, '本书中避免机械总结，优先保留人物潜台词。');
    context!.database.prepare(`UPDATE model_config_snapshots SET provider = 'capture-test', model_id = 'capture-v1' WHERE model_snapshot_id = ?`)
      .run(fixture.snapshotId);
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-preference', 200, 0);
    let receivedSupplement: string | undefined;
    const adapter: ModelAdapter = {
      provider: 'capture-test',
      modelId: 'capture-v1',
      generate: async (request) => {
        receivedSupplement = request.supplementalInstructions;
        return {
          provider: 'capture-test', modelId: 'capture-v1', output: '完成',
          inputTokens: 10, outputTokens: 2, cashCostCny: 0, state: 'succeeded'
        };
      }
    };
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const call = {
      requestId: 'request-preference', taskId: 'task-model', phaseKey: 'preference',
      agentId: fixture.agent.agentId, modelSnapshotId: fixture.snapshotId,
      provider: 'capture-test', modelId: 'capture-v1', input: '写作请求',
      parameters: '{}', reservationId
    };
    await calls.execute(fixture.scope, call, adapter, {
      requestId: call.requestId, taskId: call.taskId, ownerId: fixture.scope.ownerId,
      bookId: fixture.scope.bookId, agentId: fixture.agent.agentId,
      prompt: call.input, maxOutputTokens: 100
    });
    expect(receivedSupplement).toBe('本书中避免机械总结，优先保留人物潜台词。');
    expect(context!.database.prepare('SELECT prompt_preference_id FROM model_calls WHERE request_id = ?').get(call.requestId))
      .toEqual({ prompt_preference_id: saved.promptPreferenceId });
  });

  it('调用前冻结预算，成功后结算且相同输入不能重复调用', async () => {
    const fixture = setup();
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-model', 200, 0);
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const call = {
      requestId: 'request-model', taskId: 'task-model', phaseKey: 'draft', agentId: fixture.agent.agentId,
      modelSnapshotId: fixture.snapshotId, provider: 'local-deterministic', modelId: 'wenmi-fixture-v1',
      input: '相同输入', parameters: '{}', reservationId
    };
    const request: ModelRequest = { requestId: call.requestId, taskId: call.taskId, ownerId: fixture.scope.ownerId, bookId: fixture.scope.bookId, agentId: fixture.agent.agentId, prompt: call.input, maxOutputTokens: 100 };
    const result = await calls.execute(fixture.scope, call, new DeterministicModelAdapter(), request);
    expect(result.cashCostCny).toBe(0);
    expect(context!.database.prepare('SELECT state FROM model_calls WHERE request_id = ?').get(call.requestId)).toEqual({ state: 'succeeded' });
    expect(context!.database.prepare('SELECT COUNT(*) AS count FROM usage_ledger').get()).toEqual({ count: 1 });
    const duplicateReservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-duplicate', 200, 0);
    const replay = await calls.execute(fixture.scope, {
      ...call, requestId: 'request-duplicate', reservationId: duplicateReservationId
    }, new DeterministicModelAdapter(), { ...request, requestId: 'request-duplicate' });
    expect(replay.output).toBe(result.output);
    expect(context!.database.prepare('SELECT COUNT(*) AS count FROM usage_ledger').get()).toEqual({ count: 1 });
    expect(context!.database.prepare('SELECT COUNT(*) AS count FROM model_call_results').get()).toEqual({ count: 1 });
    expect(context!.database.prepare('SELECT status FROM budget_reservations WHERE reservation_id = ?').get(duplicateReservationId))
      .toEqual({ status: 'released' });
  });

  it('取消信号真实传到底层适配器并保留interrupted不自动重试', async () => {
    const fixture = setup();
    context!.database.prepare(`UPDATE model_config_snapshots SET provider = 'slow-test', model_id = 'slow-v1' WHERE model_snapshot_id = ?`)
      .run(fixture.snapshotId);
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-slow', 200, 0);
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const slowAdapter: ModelAdapter = {
      provider: 'slow-test',
      modelId: 'slow-v1',
      generate: async (_request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    };
    const call = {
      requestId: 'request-slow', taskId: 'task-model', phaseKey: 'slow', agentId: fixture.agent.agentId,
      modelSnapshotId: fixture.snapshotId, provider: 'slow-test', modelId: 'slow-v1', input: '等待取消', parameters: '{}', reservationId
    };
    const promise = calls.execute(fixture.scope, call, slowAdapter, { requestId: call.requestId, taskId: call.taskId, ownerId: fixture.scope.ownerId, bookId: fixture.scope.bookId, agentId: fixture.agent.agentId, prompt: call.input, maxOutputTokens: 100 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.cancel(call.requestId)).toBe(true);
    await expect(promise).rejects.toThrow('模型调用已取消');
    expect(context!.database.prepare('SELECT state FROM model_calls WHERE request_id = ?').get(call.requestId)).toEqual({ state: 'interrupted' });
    expect(context!.database.prepare('SELECT status FROM budget_reservations WHERE reservation_id = ?').get(reservationId)).toEqual({ status: 'reserved' });
  });

  it('供应商结果未知时冻结调用和预算并登记待调和状态', async () => {
    const fixture = setup();
    context!.database.prepare(`UPDATE model_config_snapshots SET provider = 'remote-test', model_id = 'remote-v1' WHERE model_snapshot_id = ?`)
      .run(fixture.snapshotId);
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-unknown', 200, 0);
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const adapter: ModelAdapter = {
      provider: 'remote-test', modelId: 'remote-v1',
      generate: async () => { throw new ModelAdapterError('provider timeout', 'technical_failure', false, undefined, true); }
    };
    const call = {
      requestId: 'request-unknown', taskId: 'task-model', phaseKey: 'unknown', agentId: fixture.agent.agentId,
      modelSnapshotId: fixture.snapshotId, provider: 'remote-test', modelId: 'remote-v1', input: '不可重复', parameters: '{}', reservationId
    };
    await expect(calls.execute(fixture.scope, call, adapter, {
      requestId: call.requestId, taskId: call.taskId, ownerId: fixture.scope.ownerId, bookId: fixture.scope.bookId,
      agentId: fixture.agent.agentId, prompt: call.input, maxOutputTokens: 100
    })).rejects.toThrow('provider timeout');
    expect(context!.database.prepare(`SELECT state, error_class FROM model_calls WHERE request_id = ?`).get(call.requestId))
      .toEqual({ state: 'interrupted', error_class: 'provider_result_unknown' });
    expect(context!.database.prepare(`SELECT state, reason_code FROM model_call_reconciliations WHERE request_id = ?`).get(call.requestId))
      .toEqual({ state: 'awaiting_provider', reason_code: 'PROVIDER_RESULT_UNKNOWN' });
    expect(context!.database.prepare('SELECT status FROM budget_reservations WHERE reservation_id = ?').get(reservationId))
      .toEqual({ status: 'reserved' });
  });
});

function insertInterruptedCall(fixture: ReturnType<typeof setup>, requestId: string, reservationId: string, provider: string, modelId: string, started: boolean): void {
  context!.database.prepare(`INSERT INTO model_calls (request_id, owner_id, book_id, task_id, phase_key, agent_id, provider, model_id, model_snapshot_id, input_hash, parameters_hash, reservation_id, state, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'interrupted', ?, ?, ?)`)
    .run(requestId, fixture.scope.ownerId, fixture.scope.bookId, 'task-model', 'phase:recon', fixture.agent.agentId, provider, modelId, fixture.snapshotId, 'a'.repeat(64), 'b'.repeat(64), reservationId, started ? fixture.clock.now().toISOString() : null, fixture.clock.now().toISOString(), fixture.clock.now().toISOString());
}

describe('中断调用主动调和与无主预留巡检', () => {
  it('中断调用找到已完成结果时调和为reusable并按真实用量结算，预算守恒', () => {
    const fixture = setup();
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-recon', 200, 0);
    insertInterruptedCall(fixture, 'request-recon', reservationId, 'ark-volc', 'doubao-v1', true);
    context!.database.prepare(`INSERT INTO model_call_results (model_call_result_id, request_id, owner_id, book_id, output_text, output_hash, input_tokens, output_tokens, cash_micros, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('result-recon', 'request-recon', fixture.scope.ownerId, fixture.scope.bookId, '已完成结果', 'h'.repeat(64), 50, 80, 0, 100, fixture.clock.now().toISOString());
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const outcome = calls.reconcileInterruptedCall(fixture.scope, 'request-recon');
    expect(outcome.finalState).toBe('reusable');
    expect(outcome.settled).toBe(true);
    expect(context!.database.prepare(`SELECT state FROM model_calls WHERE request_id = ?`).get('request-recon')).toEqual({ state: 'succeeded' });
    expect(context!.database.prepare(`SELECT status FROM budget_reservations WHERE reservation_id = ?`).get(reservationId)).toEqual({ status: 'settled' });
    const budget = context!.database.prepare(`SELECT reserved_tokens, spent_tokens FROM budgets WHERE budget_id = ?`).get(fixture.budget.budgetId) as { reserved_tokens: number; spent_tokens: number };
    expect(budget.reserved_tokens).toBe(0);
    expect(budget.spent_tokens).toBe(130);
  });

  it('远程中断无结果且无法查询时保持awaiting_provider，不静默释放预留', () => {
    const fixture = setup();
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-ark', 200, 0);
    insertInterruptedCall(fixture, 'request-ark', reservationId, 'ark-volc', 'doubao-v1', true);
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const outcome = calls.reconcileInterruptedCall(fixture.scope, 'request-ark');
    expect(outcome.finalState).toBe('awaiting_provider');
    expect(outcome.settled).toBe(false);
    expect(outcome.reason).toContain('供应商结果未知');
    expect(context!.database.prepare(`SELECT status FROM budget_reservations WHERE reservation_id = ?`).get(reservationId)).toEqual({ status: 'reserved' });
    expect(context!.database.prepare(`SELECT state FROM model_call_reconciliations WHERE request_id = ?`).get('request-ark')).toEqual({ state: 'awaiting_provider' });
  });

  it('可证明未执行的中断调用调和为retry_safe并释放预留', () => {
    const fixture = setup();
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-local', 200, 0);
    insertInterruptedCall(fixture, 'request-local', reservationId, 'local-deterministic', 'wenmi-fixture-v1', false);
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const outcome = calls.reconcileInterruptedCall(fixture.scope, 'request-local');
    expect(outcome.finalState).toBe('retry_safe');
    expect(outcome.settled).toBe(false);
    expect(context!.database.prepare(`SELECT status FROM budget_reservations WHERE reservation_id = ?`).get(reservationId)).toEqual({ status: 'released' });
    expect(context!.database.prepare(`SELECT state FROM model_call_reconciliations WHERE request_id = ?`).get('request-local')).toEqual({ state: 'retry_safe' });
    const budget = context!.database.prepare(`SELECT reserved_tokens, spent_tokens FROM budgets WHERE budget_id = ?`).get(fixture.budget.budgetId) as { reserved_tokens: number; spent_tokens: number };
    expect(budget.reserved_tokens).toBe(0);
    expect(budget.spent_tokens).toBe(0);
  });

  it('重复调和幂等，巡检报告无模型调用且无调和记录的孤儿预留', () => {
    const fixture = setup();
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-ark2', 200, 0);
    insertInterruptedCall(fixture, 'request-ark2', reservationId, 'ark-volc', 'doubao-v1', true);
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const first = calls.reconcileInterruptedCall(fixture.scope, 'request-ark2');
    const second = calls.reconcileInterruptedCall(fixture.scope, 'request-ark2');
    expect(first.finalState).toBe('awaiting_provider');
    expect(second.finalState).toBe('awaiting_provider');
    const recon = context!.database.prepare(`SELECT COUNT(*) AS count, details_json FROM model_call_reconciliations WHERE request_id = ?`).get('request-ark2') as { count: number; details_json: string };
    expect(recon.count).toBe(1);
    expect((JSON.parse(recon.details_json) as { attemptCount: number }).attemptCount).toBe(2);
    const report = calls.reportUnreconciledReservations(fixture.scope);
    expect(report.invariantHolds).toBe(true);
    expect(report.orphanReservationCount).toBe(0);
    expect(report.awaitingProviderCount).toBe(1);
    fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-orphan', 100, 0);
    const report2 = calls.reportUnreconciledReservations(fixture.scope);
    expect(report2.invariantHolds).toBe(false);
    expect(report2.orphanReservationCount).toBe(1);
    expect(report2.orphanReservations[0]!.requestId).toBe('request-orphan');
  });
});
