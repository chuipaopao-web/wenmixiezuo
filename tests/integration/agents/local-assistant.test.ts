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
  it('只学习工具、路由和故障恢复经验，且必须带反例', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new UtilityExperienceService(new LocalAssistantRepository(context.database), ids, clock);
    expect(() => service.propose(scope, { type: 'routing', rule: {}, evidence: ['e'], counterexamples: [], applicability: {}, rollbackCondition: '误路由' })).toThrow('反例');
    expect(service.propose(scope, { type: 'failure_recovery', rule: { retry: 1 }, evidence: ['一次成功'], counterexamples: ['结构错误不重试'], applicability: {}, rollbackCondition: '重复调用' })).toMatch(/^generated-/u);
  });
});
