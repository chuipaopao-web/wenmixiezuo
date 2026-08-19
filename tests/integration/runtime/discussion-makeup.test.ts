import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import { DiscussionPipelineService } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { ModelBindingService } from '../../../apps/api/src/application/agents/model-binding-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import type { CodexProcessRunner } from '../../../apps/api/src/infrastructure/models/codex-subscription-model.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('讨论席位以目标为导向自动补全', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('一席调用中断时只给缺席席位补发资料，其余席位不陪跑，任务最终集齐三份方案', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '补全机制测试书', text: '雾城悬疑与读者钩子' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    }, { codexWorkingDirectory: `${context.dataDir}/codex-test` });
    new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks();

    const codexRunner: CodexProcessRunner = {
      async run() { throw new Error('本测试不应触发 Codex 运行器'); }
    };
    const discussionCalls: Array<{ model: string }> = [];
    let glmFailuresLeft = 1;
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      discussionCalls.push({ model: body.model });
      // 模拟 GLM 第一次调用网络中断（供应商结果未知），自动补全轮恢复
      if (body.model === 'glm-5.3' && glmFailuresLeft > 0) {
        glmFailuresLeft -= 1;
        throw new TypeError('fetch failed');
      }
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '从当前岗位角度，围绕开书信息和作者意见推演这一项，给出具体、可勾选、不跑题的设计方案。' }],
        usage: { input_tokens: 50, output_tokens: 35 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const adapters = new ModelAdapterFactory(runtime, fetchImpl, codexRunner);

    const members = context.database.prepare(`SELECT a.agent_id, r.role_key
      FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
        AND r.role_key IN ('lead_screenwriter', 'second_screenwriter', 'third_screenwriter')`)
      .all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; role_key: string }>;
    const editor = context.database.prepare(`SELECT a.agent_id
      FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND r.role_key = 'chief_editor'`)
      .get(scope.ownerId, scope.bookId) as { agent_id: string };
    const discussionHost = members.find((member) => member.role_key === 'lead_screenwriter')!;
    const discussion = new DiscussionService(context.database, ids, clock).create(scope, {
      type: 'collaborative', scopeText: '【设定项目三席独立提案】\n当前设定项编号：creative-concept',
      createdByAgentId: discussionHost.agent_id,
      participants: members.map((member) => ({ agentId: member.agent_id, reason: '独立提出设定方案' }))
    });
    const budget = context.database.prepare('SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? LIMIT 1')
      .get(scope.ownerId, scope.bookId) as { budget_id: string };
    const taskService = new TaskService(context.database, context.config.releaseId, clock);
    const createdTask = taskService.create(scope, {
      taskId: ids.next(), taskType: 'discussion', assignedAgentId: editor.agent_id,
      idempotencyKey: 'makeup-panel', budgetId: budget.budget_id, initialPhase: 'collecting',
      brief: { discussionId: discussion.discussionId, scopeText: discussion.scopeText, purpose: 'setting_proposal_panel', settingItemKey: 'creative-concept' }
    });
    taskService.queue(scope, createdTask.taskId);
    expect(taskService.claimNext('makeup-worker')?.taskId).toBe(createdTask.taskId);

    await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, adapters)
      .executeClaimed(scope, createdTask.taskId, 'makeup-worker');

    // 目标达成：任务成功，三份独立方案集齐
    expect(context.database.prepare(`SELECT status FROM tasks WHERE task_id = ?`)
      .get(createdTask.taskId)).toEqual({ status: 'succeeded' });
    const opinions = context.database.prepare(`SELECT DISTINCT agent_id FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ? AND phase = 'independent'`)
      .all(scope.ownerId, scope.bookId, discussion.discussionId) as unknown as Array<{ agent_id: string }>;
    expect(opinions).toHaveLength(3);
    // 缺席的 GLM 席位被补发资料重发了一次；其余两席各只调用一次，没有陪跑
    expect(discussionCalls.filter((call) => call.model === 'glm-5.3')).toHaveLength(2);
    expect(discussionCalls.filter((call) => call.model === 'deepseek-v4-pro')).toHaveLength(1);
    expect(discussionCalls.filter((call) => call.model === 'kimi-k2.7-code')).toHaveLength(1);
    // 中断的那次调用留有真实失败记录（后台可核查原因）
    const failedCall = context.database.prepare(`SELECT state, error_class FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state != 'succeeded'`)
      .get(scope.ownerId, scope.bookId, createdTask.taskId) as { state: string; error_class: string } | undefined;
    expect(failedCall?.error_class).toBe('provider_result_unknown');
  }, 40_000);
});
