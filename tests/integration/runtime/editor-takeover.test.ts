import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { EditorLeaseService } from '../../../apps/api/src/application/editors/editor-lease-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('双主编租约与接管', () => {
  it('接管包包含任务/正史/预算且新epoch拒绝旧指令', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const editors = new EditorLeaseService(context.database, ids, clock);
    const initial = editors.create(scope, agents[0]!.agentId);
    const budgets = new BudgetService(context.database, ids, clock);
    const budget = budgets.create(scope, 'standard', 100, 0);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-handoff', taskType: 'runtime_probe', assignedAgentId: agents[0]!.agentId, idempotencyKey: 'handoff', budgetId: budget.budgetId, requiredEditorEpoch: initial.editorEpoch, initialPhase: 'execute', brief: {} });
    const prepared = editors.prepareTakeover(scope, agents[1]!.agentId);
    expect(prepared.package).toMatchObject({ bookId: scope.bookId, fromEpoch: 1, canonRevision: 0 });
    expect((prepared.package.tasks as unknown[]).length).toBe(1);
    expect((prepared.package.budgets as unknown[]).length).toBe(1);
    const completed = editors.completeTakeover(scope, prepared.takeoverId);
    expect(completed.editorEpoch).toBe(2);
    expect(completed.activeEditorAgentId).toBe(agents[1]!.agentId);
    expect(() => editors.assertEpoch(scope, agents[0]!.agentId, 1)).toThrow('旧指令被拒绝');
    expect(tasks.require(scope, 'task-handoff').requiredEditorEpoch).toBe(2);
  });
});

