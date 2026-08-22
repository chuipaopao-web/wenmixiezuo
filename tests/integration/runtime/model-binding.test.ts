import { afterEach, describe, expect, it } from 'vitest';
import { ModelBindingService } from '../../../apps/api/src/application/agents/model-binding-service.js';
import { AgentTeamService } from '../../../apps/api/src/application/agents/agent-team-service.js';
import { WriterSelectionService } from '../../../apps/api/src/application/creation/writer-selection-service.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';

describe('现有书籍模型快照绑定', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('新增不可变快照并把十五岗位切换到老板指定的订阅模型', () => {
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

    expect(result).toMatchObject({ booksVisited: 1, updatedAgents: 15, supersededWriterSelections: 1 });
    expect(context.database.prepare(`SELECT provider, model_id FROM model_config_snapshots WHERE model_snapshot_id = ?`)
      .get(selection.writerModelSnapshotId)).toEqual(oldSnapshot);
    expect(context.database.prepare(`SELECT status FROM writer_selections WHERE writer_selection_id = ?`)
      .get(selection.writerSelectionId)).toEqual({ status: 'superseded' });
    const team = new AgentTeamService(context.database, ids, clock).list(scope);
    expect(team.find((agent) => agent.roleKey === 'chief_editor')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro' });
    expect(team.find((agent) => agent.roleKey as string === 'lead_writer')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro' });
    expect(team.find((agent) => agent.roleKey as string === 'lead_screenwriter')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro' });
    expect(team.find((agent) => agent.roleKey as string === 'deputy_editor')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-flash' });
    expect(team.find((agent) => agent.roleKey as string === 'second_screenwriter')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'doubao-seed-2.1-turbo' });
    expect(team.find((agent) => agent.roleKey as string === 'senior_screenwriter')).toMatchObject({ provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k3' });
    expect(new Set(['lead_screenwriter', 'second_screenwriter', 'third_screenwriter', 'senior_screenwriter'].map((roleKey) => {
      const agent = team.find((member) => member.roleKey as string === roleKey);
      return `${agent?.provider}/${agent?.modelId}`;
    })).size).toBe(4);
    expect(team.find((agent) => agent.roleKey as string === 'setting')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-flash' });
    expect(team.find((agent) => agent.roleKey as string === 'fact_reviewer')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'minimax-m2.7' });
    expect(team.find((agent) => agent.roleKey as string === 'literary_reviewer')).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-flash' });
    expect(team.find((agent) => agent.roleKey as string === 'experience_reviewer')).toMatchObject({ modelId: 'doubao-seed-2.1-turbo' });

    const fallback = loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan' });
    const fallbackResult = new ModelBindingService(context.database, ids, clock, fallback.roleProfiles).bindAllBooks();
    expect(fallbackResult.updatedAgents).toBe(15);
    expect(new AgentTeamService(context.database, ids, clock).list(scope).every((agent) => agent.provider === 'local-deterministic')).toBe(true);
  });

  it('同一生产库中的历史九人书和新十五人书都能安全绑定', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '新团队书' });
    const legacyScope = { ownerId: context.config.ownerId, bookId: 'legacy-nine-book' };
    new BookRepository(context.database).create(legacyScope, '历史九人书', clock.now().toISOString(), 'active');
    expect(new AgentTeamService(context.database, ids, clock).createTeam(legacyScope)).toHaveLength(9);
    const runtime = loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan', WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key', WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key' });
    expect(new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks()).toMatchObject({ booksVisited: 2, updatedAgents: 24 });
  });

  it('不会给已经停用的历史九人审计实例重新绑定模型', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '当前十五人书' });
    const legacyScope = { ownerId: context.config.ownerId, bookId: 'retired-nine-book' };
    new BookRepository(context.database).create(legacyScope, '停用历史团队', clock.now().toISOString(), 'active');
    new AgentTeamService(context.database, ids, clock).createTeam(legacyScope);
    const before = context.database.prepare(`
      SELECT agent_id, model_snapshot_id FROM agent_instances
      WHERE owner_id = ? AND book_id = ? ORDER BY agent_id
    `).all(legacyScope.ownerId, legacyScope.bookId);
    context.database.prepare(`UPDATE agent_instances SET enabled = 0 WHERE owner_id = ? AND book_id = ?`)
      .run(legacyScope.ownerId, legacyScope.bookId);
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });

    expect(new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks())
      .toMatchObject({ booksVisited: 1, updatedAgents: 15 });
    expect(context.database.prepare(`
      SELECT agent_id, model_snapshot_id FROM agent_instances
      WHERE owner_id = ? AND book_id = ? ORDER BY agent_id
    `).all(legacyScope.ownerId, legacyScope.bookId)).toEqual(before);
  });
});
