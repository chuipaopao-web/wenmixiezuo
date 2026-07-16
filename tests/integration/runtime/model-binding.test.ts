import { afterEach, describe, expect, it } from 'vitest';
import { ModelBindingService } from '../../../apps/api/src/application/agents/model-binding-service.js';
import { AgentTeamService } from '../../../apps/api/src/application/agents/agent-team-service.js';
import { WriterSelectionService } from '../../../apps/api/src/application/creation/writer-selection-service.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('现有书籍模型快照绑定', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('新增不可变快照并把九岗位切换到老板指定的订阅模型', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '模型绑定测试书', text: '一座会改写记忆的海港城' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const selection = new WriterSelectionService(context.database, ids, clock).select(scope);
    const oldSnapshot = context.database.prepare(`SELECT provider, model_id FROM model_config_snapshots WHERE model_snapshot_id = ?`)
      .get(selection.writerModelSnapshotId) as { provider: string; model_id: string };
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });

    const result = new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks();

    expect(result).toMatchObject({ booksVisited: 1, updatedAgents: 9, supersededWriterSelections: 1 });
    expect(context.database.prepare(`SELECT provider, model_id FROM model_config_snapshots WHERE model_snapshot_id = ?`)
      .get(selection.writerModelSnapshotId)).toEqual(oldSnapshot);
    expect(context.database.prepare(`SELECT status FROM writer_selections WHERE writer_selection_id = ?`)
      .get(selection.writerSelectionId)).toEqual({ status: 'superseded' });
    const team = new AgentTeamService(context.database, ids, clock).list(scope);
    expect(team.find((agent) => agent.roleKey === 'chief_editor')).toMatchObject({ provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol' });
    expect(team.find((agent) => agent.roleKey === 'writer')).toMatchObject({ provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol' });
    expect(team.find((agent) => agent.roleKey === 'plot_architect')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro' });
    expect(team.find((agent) => agent.roleKey === 'continuity')).toMatchObject({ provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2-260617' });
    expect(team.find((agent) => agent.roleKey === 'reviewer')).toMatchObject({ provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k2-6-modelhub' });
    expect(team.find((agent) => agent.roleKey === 'reader_experience')).toMatchObject({ modelId: 'doubao-seed-2-0-pro-260215' });

    const fallback = loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan' });
    const fallbackResult = new ModelBindingService(context.database, ids, clock, fallback.roleProfiles).bindAllBooks();
    expect(fallbackResult.updatedAgents).toBe(9);
    expect(new AgentTeamService(context.database, ids, clock).list(scope).every((agent) => agent.provider === 'local-deterministic')).toBe(true);
  });
});
