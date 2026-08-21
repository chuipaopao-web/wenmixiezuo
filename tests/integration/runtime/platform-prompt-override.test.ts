import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import type { ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('平台提示词覆盖与调用快照', () => {
  it('只注入后续匹配调用，并保存最终任务提示词和资料补充快照', async () => {
    context = createTestContext('wenmi-platform-prompt-runtime-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const agent = initializeRuntimeBook(context, scope, ids, clock)[0]!;
    const snapshot = context.database.prepare('SELECT model_snapshot_id FROM agent_instances WHERE agent_id=?')
      .get(agent.agentId) as { model_snapshot_id: string };
    context.database.prepare(`INSERT INTO user_accounts (
      user_id,owner_id,email_normalized,display_name,password_salt,password_hash,role,status,created_at,updated_at
    ) VALUES ('admin-prompt','owner-one','prompt-admin@example.com','提示词管理员','salt','hash','admin','active',?,?)`)
      .run(clock.now().toISOString(), clock.now().toISOString());
    context.database.prepare(`INSERT INTO platform_prompt_overrides (
      prompt_override_id,trigger_key,role_key,phase_key,version,content,status,updated_by_user_id,created_at
    ) VALUES ('override-1','volume_plan_generation','*','*',1,'保留人物主动选择，不要用公式替代剧情。','active','admin-prompt',?)`)
      .run(clock.now().toISOString());
    context.database.prepare("UPDATE model_config_snapshots SET provider='capture-test',model_id='capture-v1' WHERE model_snapshot_id=?")
      .run(snapshot.model_snapshot_id);

    const budgets = new BudgetService(context.database, ids, clock);
    const budget = budgets.create(scope, 'standard', 1_000, 0);
    new TaskService(context.database, context.config.releaseId, clock).create(scope, {
      taskId: 'task-platform-prompt', taskType: 'volume_plan_generation', assignedAgentId: agent.agentId,
      idempotencyKey: 'platform-prompt', budgetId: budget.budgetId, initialPhase: 'draft', brief: { volumeNumber: 1 }
    });
    const reservationId = budgets.reserve(scope, budget.budgetId, 'request-platform-prompt', 200, 0);
    let receivedSupplement = '';
    const adapter: ModelAdapter = {
      provider: 'capture-test', modelId: 'capture-v1',
      generate: async (request) => {
        receivedSupplement = request.supplementalInstructions ?? '';
        return { provider: 'capture-test', modelId: 'capture-v1', output: '完成', inputTokens: 10,
          outputTokens: 2, cashCostCny: 0, state: 'succeeded' };
      }
    };
    const call = {
      requestId: 'request-platform-prompt', taskId: 'task-platform-prompt', phaseKey: 'draft', agentId: agent.agentId,
      modelSnapshotId: snapshot.model_snapshot_id, provider: 'capture-test', modelId: 'capture-v1', input: '设计第一卷',
      parameters: '{}', reservationId
    };
    await new ModelCallService(context.database, clock, budgets).execute(scope, call, adapter, {
      requestId: call.requestId, taskId: call.taskId, ownerId: scope.ownerId, bookId: scope.bookId,
      agentId: agent.agentId, prompt: '设计第一卷', supplementalInstructions: '遵守已确认设定。', maxOutputTokens: 100
    });

    expect(receivedSupplement).toBe('遵守已确认设定。\n\n保留人物主动选择，不要用公式替代剧情。');
    expect(context.database.prepare(`SELECT task_type,phase_key,task_prompt,supplemental_instructions,prompt_override_id
      FROM model_call_prompt_snapshots WHERE request_id='request-platform-prompt'`).get()).toEqual({
      task_type: 'volume_plan_generation', phase_key: 'draft', task_prompt: '设计第一卷',
      supplemental_instructions: receivedSupplement, prompt_override_id: 'override-1'
    });
  });
});
