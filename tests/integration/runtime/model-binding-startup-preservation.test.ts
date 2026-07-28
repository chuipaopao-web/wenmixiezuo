import { afterEach, describe, expect, it } from 'vitest';
import { ModelBindingService } from '../../../apps/api/src/application/agents/model-binding-service.js';
import { AgentTeamService } from '../../../apps/api/src/application/agents/agent-team-service.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('启动时保留书籍模型方案', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('不会用环境默认值覆盖已经激活的人工模型方案', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '保留模型方案测试书'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const before = new AgentTeamService(context.database, ids, clock).list(scope)
      .map(({ roleKey, provider, modelId }) => ({ roleKey, provider, modelId }));
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });

    const result = new ModelBindingService(context.database, ids, clock, runtime.roleProfiles)
      .bindAllBooks({ preserveActiveRevision: true });

    expect(result).toMatchObject({
      booksVisited: 1,
      updatedAgents: 0,
      supersededWriterSelections: 0
    });
    expect(new AgentTeamService(context.database, ids, clock).list(scope)
      .map(({ roleKey, provider, modelId }) => ({ roleKey, provider, modelId }))).toEqual(before);
  });
});
