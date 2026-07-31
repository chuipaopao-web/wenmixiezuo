import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { EditorLeaseService } from '../../../apps/api/src/application/editors/editor-lease-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { FixedClock, MutableClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
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

  it('候任副编没有历史调用时允许一次受控冷启动接管', () => {
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
      .not.toThrow();
    expect(context.database.prepare(`SELECT takeover_state FROM editor_leases WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ takeover_state: 'ready' });
  });

  it('候任副编最近已有技术失败证据时拒绝重复接管', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '候任失败冷却测试书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks();
    const deputy = context.database.prepare(`SELECT a.agent_id, a.model_snapshot_id, m.provider, m.model_id
      FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = 'deputy_editor'`)
      .get(scope.ownerId, scope.bookId) as { agent_id: string; model_snapshot_id: string; provider: string; model_id: string };
    const budget = new BudgetService(context.database, ids, clock).create(scope, 'standard', 100, 0);
    new TaskService(context.database, context.config.releaseId, clock).create(scope, {
      taskId: 'task-deputy-failure', taskType: 'runtime_probe', assignedAgentId: deputy.agent_id,
      idempotencyKey: 'deputy-failure', budgetId: budget.budgetId, requiredEditorEpoch: 1,
      initialPhase: 'execute', brief: {}
    });
    context.database.prepare(`
      INSERT INTO budget_reservations (
        reservation_id, budget_id, owner_id, book_id, request_id,
        frozen_tokens, frozen_cash_micros, status, created_at
      ) VALUES ('reservation-deputy-failure', ?, ?, ?, 'request-deputy-failure', 10, 0, 'reserved', ?)
    `).run(budget.budgetId, scope.ownerId, scope.bookId, clock.now().toISOString());
    context.database.prepare(`
      INSERT INTO model_calls (
        request_id, owner_id, book_id, task_id, phase_key, agent_id, provider, model_id,
        model_snapshot_id, input_hash, parameters_hash, reservation_id, state, error_class,
        started_at, completed_at, created_at
      ) VALUES (
        'request-deputy-failure', ?, ?, 'task-deputy-failure', 'probe', ?, ?, ?, ?,
        ?, ?, 'reservation-deputy-failure', 'failed', 'technical_failure', ?, ?, ?
      )
    `).run(scope.ownerId, scope.bookId, deputy.agent_id, deputy.provider, deputy.model_id,
      deputy.model_snapshot_id, 'a'.repeat(64), 'b'.repeat(64),
      clock.now().toISOString(), clock.now().toISOString(), clock.now().toISOString());

    expect(() => new EditorLeaseService(context!.database, ids, clock).prepareTakeover(scope, deputy.agent_id))
      .toThrow('最近一次调用未成功');
    expect(context!.database.prepare(`SELECT takeover_state FROM editor_leases WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ takeover_state: 'stable' });
  });
});

describe('主编租约续期、过期与安全回切', () => {
  it('主编心跳续租延长租约过期时间，过期后describeLease显式标记expired而非静默stable', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-lease' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const editors = new EditorLeaseService(context.database, ids, clock);
    const created = editors.create(scope, agents[0]!.agentId, 60_000);
    expect(editors.isLeaseExpired(scope)).toBe(false);
    expect(editors.describeLease(scope).expired).toBe(false);
    // 推进 30s 仍未过期；主编心跳续租后再给 60s 窗口
    clock.advance(30_000);
    editors.heartbeatRenew(scope, agents[0]!.agentId, 60_000);
    const renewedExpiresAt = Date.parse(editors.require(scope).leaseExpiresAt);
    expect(renewedExpiresAt).toBeGreaterThan(Date.parse(created.leaseExpiresAt));
    // 续租后过期时间 = base+90s；推进 70s 到 base+100s，已过期
    clock.advance(70_000);
    expect(editors.isLeaseExpired(scope)).toBe(true);
    const status = editors.describeLease(scope);
    expect(status.expired).toBe(true);
    // DB 中 takeover_state 仍为 stable，但 expired 标志显式反映过期，上层不再静默当成稳定
    expect(status.takeoverState).toBe('stable');
  });

  it('租约过期且有working模型调用时不抢占、不安全回切', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-expiry' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const editors = new EditorLeaseService(context.database, ids, clock);
    editors.create(scope, agents[0]!.agentId, 60_000);
    // 副编接管上位（模拟西施替貂蝉）
    const prepared = editors.prepareTakeover(scope, agents[1]!.agentId);
    editors.completeTakeover(scope, prepared.takeoverId);
    expect(editors.require(scope).activeEditorAgentId).toBe(agents[1]!.agentId);
    // 推进使租约过期
    clock.advance(120_000);
    expect(editors.isLeaseExpired(scope)).toBe(true);
    // 造一条 working 模型调用（结果未知）
    const budgets = new BudgetService(context.database, ids, clock);
    const budget = budgets.create(scope, 'standard', 100, 0);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-working', taskType: 'runtime_probe', assignedAgentId: agents[1]!.agentId, idempotencyKey: 'working', budgetId: budget.budgetId, requiredEditorEpoch: 2, initialPhase: 'execute', brief: {} });
    const reservationId = 'reservation-working';
    context.database.prepare(`INSERT INTO budget_reservations (reservation_id, budget_id, owner_id, book_id, request_id, frozen_tokens, frozen_cash_micros, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?)`)
      .run(reservationId, budget.budgetId, scope.ownerId, scope.bookId, 'request-working', 10, 0, clock.now().toISOString());
    const modelSnapshotId = (context.database.prepare(`SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ? AND owner_id = ? AND book_id = ?`)
      .get(agents[1]!.agentId, scope.ownerId, scope.bookId) as { model_snapshot_id: string }).model_snapshot_id;
    context.database.prepare(`INSERT INTO model_calls (request_id, owner_id, book_id, task_id, phase_key, agent_id, provider, model_id, model_snapshot_id, input_hash, parameters_hash, reservation_id, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'working', ?, ?)`)
      .run('request-working', scope.ownerId, scope.bookId, 'task-working', 'phase:test', agents[1]!.agentId, agents[1]!.provider, agents[1]!.modelId, modelSnapshotId, 'a'.repeat(64), 'b'.repeat(64), reservationId, clock.now().toISOString(), clock.now().toISOString());
    // 过期但有 working 调用：不安全回切，避免丢失正在生成的结果
    const safety = editors.evaluateExpirySafety(scope);
    expect(safety.hasWorkingCalls).toBe(true);
    expect(safety.hasUnknownResultCalls).toBe(true);
    expect(safety.safeToRevert).toBe(false);
    const revert = editors.safeRevertToChief(scope, agents[0]!.agentId);
    expect(revert.reverted).toBe(false);
    expect(revert.reason).toContain('进行中或结果未知');
    expect(editors.require(scope).activeEditorAgentId).toBe(agents[1]!.agentId);
  });

  it('副编接管后原主编模型恢复且无进行中调用时安全回切', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-revert' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const editors = new EditorLeaseService(context.database, ids, clock);
    editors.create(scope, agents[0]!.agentId, 60_000);
    // 副编接管
    const prepared = editors.prepareTakeover(scope, agents[1]!.agentId);
    editors.completeTakeover(scope, prepared.takeoverId);
    expect(editors.require(scope).activeEditorAgentId).toBe(agents[1]!.agentId);
    expect(editors.require(scope).editorEpoch).toBe(2);
    // 无进行中调用，原主编模型可用（deterministic），安全回切
    const safety = editors.evaluateExpirySafety(scope);
    expect(safety.safeToRevert).toBe(true);
    const revert = editors.safeRevertToChief(scope, agents[0]!.agentId);
    expect(revert.reverted).toBe(true);
    expect(revert.activeEditorAgentId).toBe(agents[0]!.agentId);
    expect(revert.editorEpoch).toBe(3);
    expect(editors.require(scope).activeEditorAgentId).toBe(agents[0]!.agentId);
    expect(editors.require(scope).editorEpoch).toBe(3);
  });

  it('副编自动接管后再次故障不会自动切回刚失败的主编形成乒乓接管', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-no-ping-pong' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const editors = new EditorLeaseService(context.database, ids, clock);
    editors.create(scope, agents[0]!.agentId, 60_000);

    const prepared = editors.prepareTakeover(scope, agents[1]!.agentId);
    const first = editors.completeTakeover(scope, prepared.takeoverId);
    expect(first.activeEditorAgentId).toBe(agents[1]!.agentId);
    expect(first.editorEpoch).toBe(2);

    const second = editors.tryAutomaticTakeover(scope, agents[1]!.agentId);
    expect(second.takenOver).toBe(false);
    expect(second.activeEditorAgentId).toBe(agents[1]!.agentId);
    expect(second.editorEpoch).toBe(2);
    expect(second.reason).toContain('不会自动切回');
  });

  it('旧epoch晚到的续租与提交指令被拒绝，当前主编可正常续租', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-epoch' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const editors = new EditorLeaseService(context.database, ids, clock);
    editors.create(scope, agents[0]!.agentId, 60_000);
    const prepared = editors.prepareTakeover(scope, agents[1]!.agentId);
    editors.completeTakeover(scope, prepared.takeoverId); // epoch -> 2，活动主编变为 agents[1]
    // 旧主编用 epoch=1 续租/校验应被拒绝
    expect(() => editors.renew(scope, agents[0]!.agentId, 1)).toThrow('旧指令被拒绝');
    expect(() => editors.assertEpoch(scope, agents[0]!.agentId, 1)).toThrow('旧指令被拒绝');
    // 当前活动主编 epoch=2 可正常心跳续租
    expect(() => editors.heartbeatRenew(scope, agents[1]!.agentId)).not.toThrow();
  });
});
