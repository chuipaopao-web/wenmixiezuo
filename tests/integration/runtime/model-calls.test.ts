import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { DeterministicModelAdapter } from '../../../apps/api/src/infrastructure/models/deterministic-model.js';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
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
  it('调用前冻结预算，成功后结算且相同输入不能重复调用', async () => {
    const fixture = setup();
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'request-model', 200, 0);
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    const call = {
      requestId: 'request-model', taskId: 'task-model', phaseKey: 'draft', agentId: fixture.agent.agentId,
      modelSnapshotId: fixture.snapshotId, provider: 'local-deterministic', modelId: 'wenmai-fixture-v1',
      input: '相同输入', parameters: '{}', reservationId
    };
    const request: ModelRequest = { requestId: call.requestId, taskId: call.taskId, ownerId: fixture.scope.ownerId, bookId: fixture.scope.bookId, agentId: fixture.agent.agentId, prompt: call.input, maxOutputTokens: 100 };
    const result = await calls.execute(fixture.scope, call, new DeterministicModelAdapter(), request);
    expect(result.cashCostCny).toBe(0);
    expect(context!.database.prepare('SELECT state FROM model_calls WHERE request_id = ?').get(call.requestId)).toEqual({ state: 'succeeded' });
    expect(context!.database.prepare('SELECT COUNT(*) AS count FROM usage_ledger').get()).toEqual({ count: 1 });
    await expect(calls.execute(fixture.scope, { ...call, requestId: 'request-duplicate' }, new DeterministicModelAdapter(), { ...request, requestId: 'request-duplicate' }))
      .rejects.toThrow('拒绝重复调用');
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
});
