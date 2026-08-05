import { afterEach, describe, expect, it } from 'vitest';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { LocalAssistantRepository } from '../../../apps/api/src/infrastructure/db/repositories/local-assistant-repository.js';
import { LocalAssistantService } from '../../../apps/api/src/application/local-assistant/local-assistant-service.js';
import { UtilityExperienceService } from '../../../apps/api/src/application/local-assistant/utility-experience-service.js';

describe('小文秘书', () => {
  let context: TestContext | undefined;
  afterEach(() => { context?.close(); context = undefined; });
  it('剧情讨论保留原话并交给主编和双编剧，不自行给结论', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new LocalAssistantService(new LocalAssistantRepository(context.database), ids, clock);
    expect(service.route(scope, { conversationId: 'conversation-1', messageId: 'message-1', original: '我们讨论一下张三向天安城宣战的剧情' }))
      .toMatchObject({ routeClass: 'plot_discussion', selectedRoles: ['chief_editor', 'lead_screenwriter', 'second_screenwriter'], excludedActions: expect.arrayContaining(['local_assistant_story_conclusion']) });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_instances WHERE display_name = '小文秘书'`).get()).toEqual({ count: 0 });
  });
  it('受保护操作停下，确定性命令不调用远程模型', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new LocalAssistantService(new LocalAssistantRepository(context.database), ids, clock);
    expect(service.route(scope, { conversationId: 'c', messageId: 'm1', original: '永久删除这本书' }).selectedAction).toBe('require_owner_confirmation');
    expect(service.route(scope, { conversationId: 'c', messageId: 'm2', original: '查看任务' }).excludedActions).toContain('remote_model_call');
  });
  it('问候和身份询问由小文秘书本地回应，不升级创作成员', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new LocalAssistantService(new LocalAssistantRepository(context.database), ids, clock);
    expect(service.route(scope, { conversationId: 'c', messageId: 'm1', original: '你好啊' })).toMatchObject({
      routeClass: 'local_assistant_conversation', selectedAction: 'reply_as_local_assistant',
      excludedActions: expect.arrayContaining(['remote_model_call', 'creative_conclusion'])
    });
    expect(service.route(scope, { conversationId: 'c', messageId: 'm2', original: '小文秘书，你是做什么的？' })).toMatchObject({
      routeClass: 'local_assistant_conversation', selectedAction: 'explain_local_assistant_role'
    });
  });
  it('资料包证据中的成员姓名不会被误判成老板点名', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new LocalAssistantService(new LocalAssistantRepository(context.database), ids, clock);
    expect(service.route(scope, {
      conversationId: 'c',
      messageId: 'm1',
      original: '讨论设定 【设定大纲成组讨论资料包】\n已经确认的设定JSON：[{"content":"婉儿和红玉上次提出了不同方案"}]'
    })).toMatchObject({
      routeClass: 'editor_handoff',
      selectedAction: 'preserve_structured_workflow_packet',
      excludedActions: expect.arrayContaining(['named_member_inference_from_evidence'])
    });
    expect(service.route(scope, {
      conversationId: 'c',
      messageId: 'm2',
      original: '婉儿，你单独说说这个冲突是否成立'
    })).toMatchObject({ routeClass: 'named_member', selectedRoles: ['婉儿'] });
    expect(service.route(scope, {
      conversationId: 'c',
      messageId: 'm3',
      original: '【已有正文设定整理资料包】\n已确认导入36章，请依据反向章纲整理设定。'
    })).toMatchObject({
      routeClass: 'editor_handoff',
      selectedAction: 'preserve_continuation_handoff_packet',
      selectedRoles: ['chief_editor', 'lead_screenwriter', 'second_screenwriter'],
      excludedActions: expect.arrayContaining(['automatic_writing', 'automatic_canon_promotion'])
    });
  });
  it('只学习工具、路由和故障恢复经验，且必须带反例', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new UtilityExperienceService(new LocalAssistantRepository(context.database), ids, clock);
    expect(() => service.propose(scope, { type: 'routing', rule: {}, evidence: ['e'], counterexamples: [], applicability: {}, rollbackCondition: '误路由' })).toThrow('反例');
    expect(service.propose(scope, { type: 'failure_recovery', rule: { retry: 1 }, evidence: ['一次成功'], counterexamples: ['结构错误不重试'], applicability: {}, rollbackCondition: '重复调用' })).toMatch(/^generated-/u);
  });
});
