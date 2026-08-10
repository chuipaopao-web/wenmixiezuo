import { afterEach, describe, expect, it } from 'vitest';
import { ModelBindingService } from '../../../apps/api/src/application/agents/model-binding-service.js';
import { ModelBindingV2Service } from '../../../apps/api/src/application/agents/model-binding-v2-service.js';
import { AgentTeamService } from '../../../apps/api/src/application/agents/agent-team-service.js';
import type { CreativeRoleKey, TeamModelProfile } from '../../../apps/api/src/contracts/agent-team-v2.js';
import { AgentGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/agent-governance-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
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

  it('把现有副编迁移到Agent Plan GLM并保留其他人工绑定和旧修订', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '副编模型迁移测试书'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    const binding = new ModelBindingService(context.database, ids, clock, runtime.roleProfiles);
    binding.bindAllBooks();

    const repository = new AgentGovernanceRepository(context.database);
    const profiles = Object.fromEntries(repository.listTeam(scope).map((agent) => [agent.roleKey, {
      provider: agent.provider,
      modelId: agent.modelId,
      plan: agent.plan ?? 'deterministic'
    }])) as Record<CreativeRoleKey, TeamModelProfile>;
    profiles.deputy_editor = {
      provider: 'volcengine-ark-coding-plan',
      modelId: 'deepseek-v4-pro',
      plan: 'coding'
    };
    profiles.researcher = { ...runtime.roleProfiles.researcher, modelId: 'glm-5-2-custom-research' };
    new ModelBindingV2Service(repository, new UnitOfWork(context.database), ids, clock)
      .reviseFuture(scope, profiles, '模拟Coding Plan DeepSeek副编与人工研究模型');
    const oldRevision = context.database.prepare(`
      SELECT agent_model_binding_revision_id AS id
      FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
    `).get(scope.ownerId, scope.bookId) as { id: string };

    const result = binding.bindAllBooks({
      preserveActiveRevision: true,
      migrateDeputyEditorToAgentPlan: true
    });

    expect(result).toMatchObject({
      booksVisited: 1,
      updatedAgents: 11,
      supersededWriterSelections: 0
    });
    const team = new AgentTeamService(context.database, ids, clock).list(scope);
    expect(team.find((agent) => agent.roleKey === 'deputy_editor')).toMatchObject({
      provider: 'volcengine-ark-agent-plan',
      modelId: 'glm-5.2'
    });
    expect(team.find((agent) => agent.roleKey === 'researcher')).toMatchObject({
      modelId: 'glm-5-2-custom-research'
    });
    expect(repository.revisionBindings(scope, oldRevision.id)
      .find((agent) => agent.roleKey === 'deputy_editor')).toMatchObject({
        provider: 'volcengine-ark-coding-plan',
        modelId: 'deepseek-v4-pro'
      });
  });

  it('把十一名成员的未来任务统一迁移到Agent Plan并保留旧修订快照', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '十一人模型迁移测试书'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    const binding = new ModelBindingService(context.database, ids, clock, runtime.roleProfiles);
    binding.bindAllBooks();

    const repository = new AgentGovernanceRepository(context.database);
    const previousProfiles = Object.fromEntries(repository.listTeam(scope).map((agent) => [agent.roleKey, {
      provider: agent.provider,
      modelId: `${agent.modelId}-previous`,
      plan: agent.plan ?? 'agent'
    }])) as Record<CreativeRoleKey, TeamModelProfile>;
    new ModelBindingV2Service(repository, new UnitOfWork(context.database), ids, clock)
      .reviseFuture(scope, previousProfiles, '构造迁移前模型修订');
    const previousRevision = context.database.prepare(`
      SELECT agent_model_binding_revision_id AS id
      FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
    `).get(scope.ownerId, scope.bookId) as { id: string };

    const result = binding.bindAllBooks({
      preserveActiveRevision: true,
      migrateAllMembersToAgentPlan: true
    });

    expect(result).toMatchObject({ booksVisited: 1, updatedAgents: 11 });
    expect(Object.fromEntries(new AgentTeamService(context.database, ids, clock).list(scope)
      .map((agent) => [agent.roleKey, `${agent.provider}/${agent.modelId}`]))).toEqual({
      chief_editor: 'volcengine-ark-agent-plan/kimi-k2.7-code',
      deputy_editor: 'volcengine-ark-agent-plan/glm-5.2',
      lead_screenwriter: 'volcengine-ark-agent-plan/deepseek-v4-pro',
      second_screenwriter: 'volcengine-ark-agent-plan/glm-5.2',
      setting: 'volcengine-ark-agent-plan/glm-5.2',
      lead_writer: 'volcengine-ark-agent-plan/deepseek-v4-pro',
      backup_writer: 'volcengine-ark-agent-plan/kimi-k2.7-code',
      literary_reviewer: 'volcengine-ark-agent-plan/minimax-m3',
      experience_reviewer: 'volcengine-ark-agent-plan/doubao-seed-2.1-turbo',
      researcher: 'volcengine-ark-agent-plan/deepseek-v4-flash',
      copyright: 'volcengine-ark-agent-plan/kimi-k2.7-code'
    });
    expect(repository.revisionBindings(scope, previousRevision.id)
      .every((agent) => agent.modelId.endsWith('-previous'))).toBe(true);
  });

  it('Agent Plan凭证缺失时不把现有真实绑定迁移为确定性假模型', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '凭证缺失保留绑定测试书'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const agentRuntime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    new ModelBindingService(context.database, ids, clock, agentRuntime.roleProfiles).bindAllBooks();
    const before = new AgentTeamService(context.database, ids, clock).list(scope)
      .map(({ roleKey, provider, modelId }) => ({ roleKey, provider, modelId }));

    const missingCredentialRuntime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan'
    });
    const result = new ModelBindingService(context.database, ids, clock, missingCredentialRuntime.roleProfiles)
      .bindAllBooks({ preserveActiveRevision: true, migrateAllMembersToAgentPlan: true });

    expect(result).toMatchObject({ booksVisited: 1, updatedAgents: 0 });
    expect(new AgentTeamService(context.database, ids, clock).list(scope)
      .map(({ roleKey, provider, modelId }) => ({ roleKey, provider, modelId }))).toEqual(before);
  });
});
