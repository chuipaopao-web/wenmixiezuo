import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../apps/api/src/application/calls/model-call-service.js';
import { TaskService } from '../../apps/api/src/application/tasks/task-service.js';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../apps/api/src/infrastructure/models/model-adapter.js';
import { TaskClaimer } from '../../apps/worker/src/scheduler/task-claimer.js';
import { MutableClock, SequenceIds, createTestContext, type TestContext } from '../helpers/test-context.js';
import { initializeRuntimeBook } from '../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function setup() {
  context = createTestContext('wenmi-runtime-fence-');
  const clock = new MutableClock();
  const ids = new SequenceIds();
  const scope = { ownerId: 'owner-fence', bookId: 'book-fence' };
  const agents = initializeRuntimeBook(context, scope, ids, clock, '租约栅栏测试书');
  const agent = agents[0]!;
  const model = context.database.prepare(`SELECT model_snapshot_id, provider, model_id FROM model_config_snapshots
    WHERE model_snapshot_id = (SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?)`)
    .get(agent.agentId) as { model_snapshot_id: string; provider: string; model_id: string };
  const budgets = new BudgetService(context.database, ids, clock);
  const budget = budgets.create(scope, 'standard', 10_000, 0);
  const tasks = new TaskService(context.database, context.config.releaseId, clock);
  tasks.create(scope, {
    taskId: 'task-fence', taskType: 'model_probe', assignedAgentId: agent.agentId,
    idempotencyKey: 'task-fence', budgetId: budget.budgetId, initialPhase: 'draft', brief: {}
  });
  tasks.queue(scope, 'task-fence');
  const claimer = new TaskClaimer(context.database, 'worker-fence', () => clock.now());
  const claimed = claimer.claimNext()!;
  return { clock, ids, scope, agent, model, budgets, budget, tasks, claimer, claimed };
}

describe('任务、模型结果和预算完整性栅栏', () => {
  it('过期attempt不能晚到完成，恢复后旧token也不能提交', () => {
    const fixture = setup();
    fixture.clock.advance(16_000);
    expect(() => fixture.claimer.complete(fixture.claimed, {})).toThrow('TASK_COMMIT_FENCE_REJECTED');
    expect(fixture.claimer.recoverExpired()).toBe(1);
    expect(fixture.tasks.require(fixture.scope, 'task-fence').status).toBe('queued');
    const second = fixture.claimer.claimNext()!;
    expect(second.attemptNo).toBe(2);
    expect(second.leaseToken).not.toBe(fixture.claimed.leaseToken);
    expect(() => fixture.claimer.complete(fixture.claimed, {})).toThrow('TASK_COMMIT_FENCE_REJECTED');
    fixture.claimer.complete(second, { acceptedAttempt: 2 });
    expect(fixture.tasks.require(fixture.scope, 'task-fence').status).toBe('succeeded');
  });

  it('已释放预算拒绝晚到结算且计数保持守恒', () => {
    const fixture = setup();
    const reservation = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, 'late-budget', 500, 0);
    fixture.budgets.release(fixture.scope, reservation);
    expect(() => fixture.budgets.settle(fixture.scope, reservation, {
      taskId: 'task-fence', provider: fixture.model.provider, modelId: fixture.model.model_id,
      inputTokens: 100, outputTokens: 100, cashMicros: 0, durationMs: 10
    })).toThrow('已经释放');
    const budget = fixture.budgets.require(fixture.scope, fixture.budget.budgetId);
    expect({ reserved: budget.reservedTokens, spent: budget.spentTokens }).toEqual({ reserved: 0, spent: 0 });
  });

  it('模型响应晚于租约时保存审计结果并结算真实用量，但阻止业务提交和自动重试', async () => {
    const fixture = setup();
    const requestId = 'late-model-result';
    const reservationId = fixture.budgets.reserve(fixture.scope, fixture.budget.budgetId, requestId, 500, 0);
    const adapter: ModelAdapter = {
      provider: fixture.model.provider,
      modelId: fixture.model.model_id,
      async generate(_request: ModelRequest): Promise<ModelResult> {
        fixture.clock.advance(16_000);
        return {
          provider: fixture.model.provider, modelId: fixture.model.model_id, output: '已经返回但租约失效的结果',
          inputTokens: 40, outputTokens: 20, cashCostCny: 0, state: 'succeeded'
        };
      }
    };
    const calls = new ModelCallService(context!.database, fixture.clock, fixture.budgets);
    await expect(calls.execute(fixture.scope, {
      requestId, taskId: 'task-fence', phaseKey: 'draft', agentId: fixture.agent.agentId,
      modelSnapshotId: fixture.model.model_snapshot_id, provider: fixture.model.provider,
      modelId: fixture.model.model_id, input: '写作输入', parameters: '{}', reservationId,
      leaseToken: fixture.claimed.leaseToken, attemptNo: fixture.claimed.attemptNo
    }, adapter, {
      requestId, taskId: 'task-fence', ownerId: fixture.scope.ownerId, bookId: fixture.scope.bookId,
      agentId: fixture.agent.agentId, prompt: '写作输入', maxOutputTokens: 100
    })).rejects.toThrow('MODEL_CALL_COMMIT_FENCE_REJECTED');
    expect(context!.database.prepare(`SELECT state, error_class FROM model_calls WHERE request_id = ?`).get(requestId))
      .toEqual({ state: 'interrupted', error_class: 'lease_or_epoch_lost' });
    expect(context!.database.prepare(`SELECT state FROM model_call_reconciliations WHERE request_id = ?`).get(requestId))
      .toEqual({ state: 'discarded' });
    expect(context!.database.prepare(`SELECT output_text FROM model_call_results WHERE request_id = ?`).get(requestId))
      .toEqual({ output_text: '已经返回但租约失效的结果' });
    expect(context!.database.prepare(`SELECT status FROM budget_reservations WHERE reservation_id = ?`).get(reservationId))
      .toEqual({ status: 'settled' });
    expect(fixture.claimer.recoverExpired()).toBe(1);
    expect(fixture.tasks.require(fixture.scope, 'task-fence').status).toBe('interrupted');
  });
});
