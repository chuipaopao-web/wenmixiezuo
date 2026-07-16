import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../apps/api/src/application/calls/model-call-service.js';
import { TaskService } from '../../apps/api/src/application/tasks/task-service.js';
import { MutableClock, SequenceIds, createTestContext, type TestContext } from '../helpers/test-context.js';
import { initializeRuntimeBook } from '../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('Worker失联与结果不明恢复', () => {
  it('存在working模型调用时标记interrupted且普通入队不能重试', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const agent = agents[0]!;
    const snapshot = context.database.prepare('SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?').get(agent.agentId) as { model_snapshot_id: string };
    const budgets = new BudgetService(context.database, ids, clock);
    const budget = budgets.create(scope, 'standard', 1_000, 0);
    const reservationId = budgets.reserve(scope, budget.budgetId, 'request-unknown', 100, 0);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-unknown', taskType: 'model_probe', assignedAgentId: agent.agentId, idempotencyKey: 'unknown', budgetId: budget.budgetId, initialPhase: 'draft', brief: {} });
    tasks.queue(scope, 'task-unknown');
    tasks.claimNext('worker-one', 1_000);
    const calls = new ModelCallService(context.database, clock, budgets);
    calls.begin(scope, { requestId: 'request-unknown', taskId: 'task-unknown', phaseKey: 'draft', agentId: agent.agentId, modelSnapshotId: snapshot.model_snapshot_id, provider: 'local-deterministic', modelId: 'wenmi-fixture-v1', input: '结果未知故障注入', parameters: '{}', reservationId });
    context.database.prepare("UPDATE model_calls SET state = 'working' WHERE request_id = 'request-unknown'").run();
    clock.advance(2_000);
    expect(tasks.recoverExpired()[0]?.status).toBe('interrupted');
    expect(() => tasks.queue(scope, 'task-unknown')).toThrow('不能入队');
    expect(context.database.prepare("SELECT state FROM model_calls WHERE request_id = 'request-unknown'").get()).toEqual({ state: 'interrupted' });
  });

  it('能够证明尚未开始调用时从检查点重新入队', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    initializeRuntimeBook(context, scope, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-safe', taskType: 'runtime_probe', idempotencyKey: 'safe', initialPhase: 'execute', brief: {} });
    tasks.queue(scope, 'task-safe');
    tasks.claimNext('worker-one', 1_000);
    clock.advance(2_000);
    expect(tasks.recoverExpired()[0]?.status).toBe('queued');
  });
});
