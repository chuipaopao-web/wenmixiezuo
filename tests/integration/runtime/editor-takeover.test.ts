import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { EditorLeaseService } from '../../../apps/api/src/application/editors/editor-lease-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { ModelBindingService } from '../../../apps/api/src/application/agents/model-binding-service.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';

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
    const chapters = new ChapterCatalogService(context.database, ids, clock);
    const volumeId = chapters.createVolume(scope, 1, '第一卷');
    chapters.createChapter(scope, volumeId, 1, '接管章');
    context.database.prepare(`
      INSERT INTO confirmations (
        confirmation_id, owner_id, book_id, target_type, target_id,
        old_value_json, new_value_json, scope_json, impact_json,
        expected_canon_revision, status, created_at
      ) VALUES ('confirmation-handoff', ?, ?, 'chapter', 'chapter-handoff', '{}', '{}', '{}', '{}', 0, 'pending', ?)
    `).run(scope.ownerId, scope.bookId, clock.now().toISOString());
    const prepared = editors.prepareTakeover(scope, agents[1]!.agentId);
    expect(prepared.package).toMatchObject({ bookId: scope.bookId, fromEpoch: 1, canonRevision: 0 });
    expect((prepared.package.tasks as unknown[]).length).toBe(1);
    expect((prepared.package.budgets as unknown[]).length).toBe(1);
    expect((prepared.package.chapters as unknown[])).toHaveLength(1);
    expect((prepared.package.pendingDecisions as unknown[])).toHaveLength(1);
    expect(() => editors.prepareTakeover(scope, agents[1]!.agentId)).toThrow('主编接管状态已经变化');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM takeover_packages WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
    const completed = editors.completeTakeover(scope, prepared.takeoverId);
    expect(completed.editorEpoch).toBe(2);
    expect(completed.activeEditorAgentId).toBe(agents[1]!.agentId);
    expect(() => editors.assertEpoch(scope, agents[0]!.agentId, 1)).toThrow('旧指令被拒绝');
    expect(tasks.require(scope, 'task-handoff').requiredEditorEpoch).toBe(2);
  });

  it('候任副编没有近期成功调用证据时拒绝盲目接管', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '候任可用性测试书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks();
    const deputy = context.database.prepare(`SELECT a.agent_id FROM agent_instances a JOIN role_templates r
      ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = 'deputy_editor'`)
      .get(scope.ownerId, scope.bookId) as { agent_id: string };

    expect(() => new EditorLeaseService(context!.database, ids, clock).prepareTakeover(scope, deputy.agent_id))
      .toThrow('没有24小时内的成功调用证据');
    expect(context.database.prepare(`SELECT takeover_state FROM editor_leases WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ takeover_state: 'stable' });
  });
});
