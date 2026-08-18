import { afterEach, describe, expect, it } from 'vitest';
import { AgentTeamService } from '../../../apps/api/src/application/agents/agent-team-service.js';
import { LegacyBookUpgradeService } from '../../../apps/api/src/application/agents/legacy-book-upgrade-service.js';
import { PromptCompiler } from '../../../apps/api/src/application/agents/prompt-compiler.js';
import { TeamTemplateService } from '../../../apps/api/src/application/agents/team-template-service.js';
import { creativeMemberContracts } from '../../../apps/api/src/contracts/agent-team-v2.js';
import { AgentGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/agent-governance-repository.js';
import { LegacyBookUpgradeRepository } from '../../../apps/api/src/infrastructure/db/repositories/legacy-book-upgrade-repository.js';
import { PromptTemplateRepository } from '../../../apps/api/src/infrastructure/db/repositories/prompt-template-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { RoleModelProfile } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { RoleKey } from '../../../apps/api/src/domain/roles.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('历史九人书终局升级', () => {
  it('幂等补齐十四人、治理绑定、最小资料和表达档案，同时保留但停用历史成员', () => {
    context = createTestContext('wenmi-legacy-upgrade-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-legacy', bookId: 'book-legacy-nine' };
    const legacy = initializeRuntimeBook(context, scope, ids, clock, '历史九人书');
    expect(legacy).toHaveLength(9);
    const unitOfWork = new UnitOfWork(context.database);
    const repository = new LegacyBookUpgradeRepository(context.database);
    const service = new LegacyBookUpgradeService(
      repository,
      new TeamTemplateService(new AgentGovernanceRepository(context.database), unitOfWork, ids, clock),
      new PromptCompiler(new PromptTemplateRepository(context.database), ids, clock),
      unitOfWork,
      ids,
      clock,
      loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'deterministic' }).roleProfiles
    );

    expect(service.upgradeAll()).toEqual({ booksVisited: 1, teamsCreated: 1, profilesCreated: 2, legacyAgentsRetired: 9, deferredBooks: 0, membersAdded: 0 });
    const current = new AgentTeamService(context.database, ids, clock).list(scope);
    expect(current).toHaveLength(14);
    expect(current.map((agent) => agent.displayName)).toEqual(creativeMemberContracts.map((member) => member.memberName));
    expect(new Set(current.map((agent) => `${agent.provider}/${agent.modelId}`)).size).toBe(14);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND role_template_version = 1 AND enabled = 0`).get(scope.ownerId, scope.bookId)).toEqual({ count: 9 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_model_bindings
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 14 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM prompt_template_snapshots WHERE status = 'active'`).get()).toEqual({ count: 14 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM book_onboarding_profiles
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
    expect(context.database.prepare(`SELECT narrative_person, viewpoint_distance, status FROM book_expression_profiles
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ narrative_person: null, viewpoint_distance: null, status: 'provisional' });
    const chief = current.find((agent) => agent.roleKey === 'chief_editor')!;
    expect(context.database.prepare(`SELECT active_editor_agent_id, editor_epoch FROM editor_leases
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ active_editor_agent_id: chief.agentId, editor_epoch: 1 });
    expect(context.database.prepare(`SELECT active_editor_agent_id, editor_epoch FROM books
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ active_editor_agent_id: chief.agentId, editor_epoch: 1 });

    expect(service.upgradeAll()).toEqual({ booksVisited: 1, teamsCreated: 0, profilesCreated: 0, legacyAgentsRetired: 0, deferredBooks: 0, membersAdded: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_instances WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 23 });
  });

  it('编制扩充前的十一人旧书启动时补齐编剧C、事实审查和体验·挑剔读者', () => {
    context = createTestContext('wenmi-team-topup-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-legacy', ids, clock, { title: '十一人旧书' });
    const scope = { ownerId: 'owner-legacy', bookId: book.bookId };
    const unitOfWork = new UnitOfWork(context.database);
    const repository = new LegacyBookUpgradeRepository(context.database);
    const service = new LegacyBookUpgradeService(
      repository,
      new TeamTemplateService(new AgentGovernanceRepository(context.database), unitOfWork, ids, clock),
      new PromptCompiler(new PromptTemplateRepository(context.database), ids, clock),
      unitOfWork,
      ids,
      clock,
      loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'deterministic' }).roleProfiles
    );
    // 模拟编制扩充前的旧书：移除三名新成员，回到 11 人
    context.database.prepare(`DELETE FROM agent_model_bindings WHERE owner_id = ? AND book_id = ?
      AND role_key IN ('third_screenwriter', 'fact_reviewer', 'experience_challenger')`).run(scope.ownerId, scope.bookId);
    context.database.prepare(`DELETE FROM agent_instances WHERE owner_id = ? AND book_id = ?
      AND role_template_id IN ('role-v2-third-screenwriter', 'role-v2-fact-reviewer', 'role-v2-experience-challenger')`).run(scope.ownerId, scope.bookId);
    expect(new AgentTeamService(context.database, ids, clock).list(scope)).toHaveLength(11);

    expect(service.upgradeAll()).toEqual({ booksVisited: 1, teamsCreated: 0, profilesCreated: 0, legacyAgentsRetired: 0, deferredBooks: 0, membersAdded: 3 });
    const toppedUp = new AgentTeamService(context.database, ids, clock).list(scope);
    expect(toppedUp).toHaveLength(14);
    expect(toppedUp.map((agent) => agent.roleKey)).toEqual(expect.arrayContaining(['third_screenwriter', 'fact_reviewer', 'experience_challenger']));
    expect(new Set(toppedUp.map((agent) => `${agent.provider}/${agent.modelId}`)).size).toBe(14);

    // 幂等：再次升级不重复添加
    expect(service.upgradeAll()).toEqual({ booksVisited: 1, teamsCreated: 0, profilesCreated: 0, legacyAgentsRetired: 0, deferredBooks: 0, membersAdded: 0 });
    expect(new AgentTeamService(context.database, ids, clock).list(scope)).toHaveLength(14);
  });

  it('历史书有未终态任务时只补最小档案并延后团队切换，避免偷换运行中岗位', () => {
    context = createTestContext('wenmi-legacy-upgrade-active-');
    const ids = new SequenceIds(); const clock = new FixedClock();
    const scope = { ownerId: 'owner-legacy', bookId: 'book-active-nine' };
    const legacy = initializeRuntimeBook(context, scope, ids, clock, '仍有任务的历史书');
    context.database.prepare(`INSERT INTO tasks (
      task_id, release_id, owner_id, book_id, task_type, task_brief_json, status, current_phase,
      idempotency_key, required_editor_epoch, checkpoint_json, created_at, updated_at
    ) VALUES ('legacy-running-task', ?, ?, ?, 'runtime_probe', '{}', 'queued', 'execute', 'legacy-running', 0, '{}', ?, ?)`)
      .run(context.config.releaseId, scope.ownerId, scope.bookId, clock.now().toISOString(), clock.now().toISOString());
    const unitOfWork = new UnitOfWork(context.database);
    const service = new LegacyBookUpgradeService(
      new LegacyBookUpgradeRepository(context.database),
      new TeamTemplateService(new AgentGovernanceRepository(context.database), unitOfWork, ids, clock),
      new PromptCompiler(new PromptTemplateRepository(context.database), ids, clock),
      unitOfWork, ids, clock, loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'deterministic' }).roleProfiles
    );
    expect(service.upgradeAll()).toEqual({ booksVisited: 1, teamsCreated: 0, profilesCreated: 2, legacyAgentsRetired: 0, deferredBooks: 1, membersAdded: 0 });
    expect(new AgentTeamService(context.database, ids, clock).list(scope)).toHaveLength(9);
    expect(legacy.every((agent) => agent.activationState !== 'disabled')).toBe(true);
  });

  it('补齐成员只要求编剧三角异模型，允许与主编等其他岗位共享模型', () => {
    context = createTestContext('wenmi-team-topup-shared-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-legacy', ids, clock, { title: '跨岗共享模型旧书' });
    const scope = { ownerId: 'owner-legacy', bookId: book.bookId };
    // 模拟编制扩充前的旧书：移除三名新成员，回到 11 人
    context.database.prepare(`DELETE FROM agent_model_bindings WHERE owner_id = ? AND book_id = ?
      AND role_key IN ('third_screenwriter', 'fact_reviewer', 'experience_challenger')`).run(scope.ownerId, scope.bookId);
    context.database.prepare(`DELETE FROM agent_instances WHERE owner_id = ? AND book_id = ?
      AND role_template_id IN ('role-v2-third-screenwriter', 'role-v2-fact-reviewer', 'role-v2-experience-challenger')`).run(scope.ownerId, scope.bookId);
    // 模拟生产真实套餐模型：主编与编剧C同为 K2.7、编剧B与事实审查同为 GLM，属于允许的设计
    context.database.prepare(`UPDATE model_config_snapshots
      SET parameters_json = json_set(parameters_json, '$.plan', 'agent')
      WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    const setModel = (roleKey: string, modelId: string): void => {
      context!.database.prepare(`UPDATE model_config_snapshots SET provider = 'volcengine-ark-agent-plan', model_id = ?
        WHERE owner_id = ? AND book_id = ? AND model_snapshot_id = (
          SELECT a.model_snapshot_id FROM agent_instances a JOIN role_templates r
            ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
          WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = ?)`)
        .run(modelId, scope.ownerId, scope.bookId, scope.ownerId, scope.bookId, roleKey);
    };
    setModel('chief_editor', 'kimi-k2.7-code');
    setModel('second_screenwriter', 'glm-5.2');
    setModel('lead_screenwriter', 'deepseek-v4-pro');
    const service = new TeamTemplateService(
      new AgentGovernanceRepository(context.database), new UnitOfWork(context.database), ids, clock
    );

    // 编剧C若与其他编剧撞模型仍然拒绝
    expect(() => service.addMissingMembers(scope, {
      profiles: { third_screenwriter: { provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro', plan: 'agent' } }
    })).toThrowError(/编剧三角/u);

    // 与主编（K2.7）或事实审查以外的岗位共享模型不再拒绝
    const toppedUp = service.addMissingMembers(scope);
    expect(toppedUp.added).toEqual(expect.arrayContaining(['third_screenwriter', 'fact_reviewer', 'experience_challenger']));
    expect(toppedUp.team).toHaveLength(14);
    const byRole = new Map(toppedUp.team.map((member) => [member.roleKey, `${member.provider}/${member.modelId}`]));
    expect(byRole.get('third_screenwriter')).toBe('volcengine-ark-agent-plan/kimi-k2.7-code');
    expect(byRole.get('fact_reviewer')).toBe('volcengine-ark-agent-plan/glm-5.2');
    expect(new AgentTeamService(context.database, ids, clock).list(scope)).toHaveLength(14);
  });

  it('存量书设定成员与编剧B撞模型时，启动升级自动把设定岗位修为独立模型', () => {
    context = createTestContext('wenmi-setting-seat-repair-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-legacy', ids, clock, { title: '设定撞模型旧书' });
    const scope = { ownerId: 'owner-legacy', bookId: book.bookId };
    // 模拟生产真实套餐：全员 agent 计划，设定（文姬）与编剧B（红玉）同为 GLM 5.2——批5前旧映射的遗留
    context.database.prepare(`UPDATE model_config_snapshots
      SET parameters_json = json_set(parameters_json, '$.plan', 'agent')
      WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    const setModel = (roleKey: string, modelId: string): void => {
      context!.database.prepare(`UPDATE model_config_snapshots SET provider = 'volcengine-ark-agent-plan', model_id = ?
        WHERE owner_id = ? AND book_id = ? AND model_snapshot_id = (
          SELECT a.model_snapshot_id FROM agent_instances a JOIN role_templates r
            ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
          WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = ?)`)
        .run(modelId, scope.ownerId, scope.bookId, scope.ownerId, scope.bookId, roleKey);
    };
    setModel('setting', 'glm-5.2');
    setModel('second_screenwriter', 'glm-5.2');
    const agent = (modelId: string): RoleModelProfile => ({ provider: 'volcengine-ark-agent-plan', modelId, plan: 'agent' });
    const roleProfiles: Record<RoleKey, RoleModelProfile> = {
      chief_editor: agent('kimi-k2.7-code'), plot_architect: agent('deepseek-v4-pro'), continuity: agent('glm-5.2'),
      writer: agent('deepseek-v4-pro'), reviewer: agent('minimax-m3'), reader_experience: agent('doubao-seed-2.1-turbo'),
      style_editor: agent('glm-5.2'), researcher: agent('deepseek-v4-flash'), copyright: agent('kimi-k2.7-code')
    };
    const unitOfWork = new UnitOfWork(context.database);
    const service = new LegacyBookUpgradeService(
      new LegacyBookUpgradeRepository(context.database),
      new TeamTemplateService(new AgentGovernanceRepository(context.database), unitOfWork, ids, clock),
      new PromptCompiler(new PromptTemplateRepository(context.database), ids, clock),
      unitOfWork, ids, clock, roleProfiles
    );

    service.upgradeAll();
    const team = new AgentTeamService(context.database, ids, clock).list(scope);
    const byRole = new Map(team.map((member) => [member.roleKey, `${member.provider}/${member.modelId}`]));
    expect(byRole.get('setting')).toBe('volcengine-ark-agent-plan/minimax-m3');
    expect(byRole.get('second_screenwriter')).toBe('volcengine-ark-agent-plan/glm-5.2');
    const repairRevision = context.database.prepare(`SELECT reason FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ? AND status = 'active'`).get(scope.ownerId, scope.bookId) as { reason: string };
    expect(repairRevision.reason).toBe('设定成员改用独立模型，恢复团队各自出方案');

    // 幂等：修复后再次升级不再产生新修订
    const revisionsBefore = (context.database.prepare(`SELECT COUNT(*) AS count FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId) as { count: number }).count;
    service.upgradeAll();
    const revisionsAfter = (context.database.prepare(`SELECT COUNT(*) AS count FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId) as { count: number }).count;
    expect(revisionsAfter).toBe(revisionsBefore);
  });
});
