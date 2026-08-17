import { afterEach, describe, expect, it } from 'vitest';
import { ModelBindingV2Service } from '../../../apps/api/src/application/agents/model-binding-v2-service.js';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import type { CreativeRoleKey, TeamModelProfile } from '../../../apps/api/src/contracts/agent-team-v2.js';
import { AgentGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/agent-governance-repository.js';
import { ProductionWorkflowRepository } from '../../../apps/api/src/infrastructure/db/repositories/production-workflow-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('未来模型绑定与运行任务快照治理', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('激活新修订更新未来任务来源，但讨论和历史修订仍固定旧快照且可回滚为新修订', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '绑定冻结测试书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const repository = new AgentGovernanceRepository(context.database);
    const service = new ModelBindingV2Service(repository, new UnitOfWork(context.database), ids, clock);
    const original = repository.activeBindings(scope);
    const originalRevision = context.database.prepare(`SELECT agent_model_binding_revision_id AS id
      FROM agent_model_binding_revisions WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .get(scope.ownerId, scope.bookId) as { id: string };
    const editor = original.find((agent) => agent.roleKey === 'chief_editor')!;
    const screenwriter = original.find((agent) => agent.roleKey === 'lead_screenwriter')!;
    const discussion = new DiscussionService(context.database, ids, clock).create(scope, {
      type: 'quick', scopeText: '冻结这轮讨论的模型来源', createdByAgentId: editor.agentId,
      participants: [{ agentId: editor.agentId, reason: '主持' }, { agentId: screenwriter.agentId, reason: '独立方案' }]
    });
    const frozen = context.database.prepare(`SELECT model_snapshot_id FROM discussion_participants
      WHERE discussion_id = ? AND agent_id = ?`).get(discussion.discussionId, editor.agentId) as { model_snapshot_id: string };
    const profiles = Object.fromEntries(original.map((agent) => [agent.roleKey, {
      provider: agent.provider,
      modelId: `${agent.modelId}-next`,
      plan: agent.plan ?? 'deterministic'
    }])) as Record<CreativeRoleKey, TeamModelProfile>;

    expect(service.reviseFuture(scope, profiles, '测试未来任务切换')).toBe(2);
    const currentEditor = repository.activeBindings(scope).find((agent) => agent.roleKey === 'chief_editor')!;
    expect(currentEditor.modelSnapshotId).not.toBe(editor.modelSnapshotId);
    expect(context.database.prepare(`SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?`)
      .get(editor.agentId)).toEqual({ model_snapshot_id: currentEditor.modelSnapshotId });
    expect(context.database.prepare(`SELECT model_snapshot_id FROM discussion_participants
      WHERE discussion_id = ? AND agent_id = ?`).get(discussion.discussionId, editor.agentId)).toEqual(frozen);
    expect(new ProductionWorkflowRepository(context.database).currentTeam(scope, originalRevision.id)
      .find((agent) => agent.roleKey === 'chief_editor')?.modelSnapshotId).toBe(editor.modelSnapshotId);

    expect(service.restoreFuture(scope, originalRevision.id, '恢复旧配置为新修订')).toBe(3);
    expect(repository.activeBindings(scope).find((agent) => agent.roleKey === 'chief_editor')?.modelId).toBe(editor.modelId);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 3 });
  });

  it('主笔或副笔与三点评中的任意模型重复时预检拒绝激活', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '点评独立性测试书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const repository = new AgentGovernanceRepository(context.database);
    const service = new ModelBindingV2Service(repository, new UnitOfWork(context.database), ids, clock);
    const profiles = Object.fromEntries(repository.activeBindings(scope).map((agent) => [agent.roleKey, {
      provider: agent.provider, modelId: agent.modelId, plan: agent.plan ?? 'deterministic'
    }])) as Record<CreativeRoleKey, TeamModelProfile>;
    profiles.experience_reviewer = { ...profiles.literary_reviewer };
    expect(() => service.validate(profiles)).toThrow(/五个不同模型来源/u);
  });

  it('真实套餐模式拒绝把历史确定性绑定恢复成未来活动配置', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '假模型恢复门禁书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const repository = new AgentGovernanceRepository(context.database);
    const originalRevision = context.database.prepare(`SELECT agent_model_binding_revision_id AS id
      FROM agent_model_binding_revisions WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .get(scope.ownerId, scope.bookId) as { id: string };
    const service = new ModelBindingV2Service(
      repository, new UnitOfWork(context.database), ids, clock, 'subscription-plan'
    );

    expect(() => service.restoreFuture(scope, originalRevision.id, '不得恢复假模型')).toThrow('真实套餐模式不能激活确定性假模型绑定');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
  });
});
