import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import { SettingCollaborationService } from '../../../apps/api/src/application/knowledge/setting-collaboration-service.js';
import { SettingOutlineWorkspaceService } from '../../../apps/api/src/application/knowledge/setting-outline-workspace-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { SettingCollaborationRepository } from '../../../apps/api/src/infrastructure/db/repositories/setting-collaboration-repository.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('设定页内协作读模型', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('按当前设定项返回三份真实成员提案、任务状态和模型来源，且不跨书', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '协作书一' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '协作书二' });
    const firstScope = { ownerId: context.config.ownerId, bookId: first.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: second.bookId };
    const firstWorkspace = new SettingOutlineWorkspaceService(context.database, clock);
    const secondWorkspace = new SettingOutlineWorkspaceService(context.database, clock);
    const item = {
      itemKey: 'creative-concept', groupTitle: '作品策划', label: '核心看点',
      prompt: '这本书为什么值得持续写下去？', sourceLabel: '通用', sortOrder: 0
    };
    firstWorkspace.initialize(firstScope, [item]);
    secondWorkspace.initialize(secondScope, [item]);

    const members = context.database.prepare(`
      SELECT a.agent_id, a.display_name, a.model_snapshot_id,
        r.role_key, m.provider, m.model_id
      FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'lead_screenwriter', 'second_screenwriter')
      ORDER BY CASE r.role_key WHEN 'chief_editor' THEN 0 WHEN 'lead_screenwriter' THEN 1 ELSE 2 END
    `).all(firstScope.ownerId, firstScope.bookId) as unknown as Array<{
      agent_id: string; display_name: string; model_snapshot_id: string;
      role_key: string; provider: string; model_id: string;
    }>;
    expect(members).toHaveLength(3);
    const discussionService = new DiscussionService(context.database, ids, clock);
    const discussion = discussionService.create(firstScope, {
      type: 'collaborative',
      scopeText: '当前设定项编号：creative-concept',
      createdByAgentId: members[0]!.agent_id,
      participants: members.map((member) => ({ agentId: member.agent_id, reason: '独立提出设定方案' }))
    });
    const opinionIds = members.map((member, index) => discussionService.addOpinion(firstScope, discussion.discussionId, {
      agentId: member.agent_id,
      modelSnapshotId: member.model_snapshot_id,
      phase: 'independent',
      content: { recommendation: `独立方案${index + 1}：从不同的人物困境和读者体验建立长期看点。` },
      tokens: 20
    }));
    discussionService.setStage(firstScope, discussion.discussionId, 'collecting', 'synthesizing');
    const decisionId = discussionService.synthesize(firstScope, discussion.discussionId, {
      recommendation: { summary: '保留三份独立候选等待作者选择', evidence: opinionIds },
      alternatives: [], disagreements: [], impacts: []
    });
    const budget = context.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? LIMIT 1`)
      .get(firstScope.ownerId, firstScope.bookId) as { budget_id: string };
    const taskId = ids.next();
    new TaskService(context.database, context.config.releaseId, clock).create(firstScope, {
      taskId, taskType: 'discussion', assignedAgentId: members[0]!.agent_id,
      idempotencyKey: 'setting-panel:creative-concept', budgetId: budget.budget_id,
      initialPhase: 'collecting',
      brief: { purpose: 'setting_proposal_panel', settingItemKey: 'creative-concept', discussionId: discussion.discussionId }
    });
    context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'complete' WHERE task_id = ?`).run(taskId);
    const conversation = context.database.prepare(`SELECT conversation_id FROM conversations WHERE owner_id = ? AND book_id = ? LIMIT 1`)
      .get(firstScope.ownerId, firstScope.bookId) as { conversation_id: string };
    const insert = context.database.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type, sender_agent_id,
        role_key, model_provider, model_id, message_type, content, references_json, created_at
      ) VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?, 'setting_proposal', ?, ?, ?)
    `);
    members.forEach((member, index) => insert.run(
      ids.next(), conversation.conversation_id, firstScope.ownerId, firstScope.bookId,
      member.agent_id, member.role_key, member.provider, member.model_id,
      `方案${index + 1}｜${member.display_name}\n独立方案${index + 1}：从不同的人物困境和读者体验建立长期看点。`,
      JSON.stringify([{ discussionId: discussion.discussionId, decisionId, proposalKind: 'setting_item_independent', proposalNumber: index + 1 }]),
      clock.now().toISOString()
    ));

    const firstView = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database), firstWorkspace
    ).inspect(firstScope, 'creative-concept');
    expect(firstView.panel).toMatchObject({ taskId, taskStatus: 'succeeded' });
    expect(firstView.panel?.proposals).toHaveLength(3);
    expect(firstView.panel?.proposals.map((proposal) => proposal.memberName)).toEqual(members.map((member) => member.display_name));
    expect(firstView.panel?.proposals.every((proposal) => proposal.modelProvider !== null && proposal.modelId !== null)).toBe(true);
    expect(firstView.impact).toEqual({ changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' });

    const secondView = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database), secondWorkspace
    ).inspect(secondScope, 'creative-concept');
    expect(secondView.panel).toBeNull();
    expect(secondView.historyCount).toBe(0);
  });

  it('重复读取不创建新任务，并返回主编整理任务与当前候选', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '候选恢复书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    workspace.initialize(scope, [{
      itemKey: 'era', groupTitle: '世界与环境', label: '时代与世界类型',
      prompt: '故事发生在怎样的时代？', sourceLabel: '通用', sortOrder: 1
    }]);
    workspace.recordGuidanceCandidate(scope, 'era', '故事发生在近未来沿海城市，公共技术发达，但医疗资源仍高度不均衡。');
    const editor = context.database.prepare(`
      SELECT a.agent_id FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = 'chief_editor' LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { agent_id: string };
    const budget = context.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string };
    const taskId = ids.next();
    new TaskService(context.database, context.config.releaseId, clock).create(scope, {
      taskId, taskType: 'conversation_reply', assignedAgentId: editor.agent_id,
      idempotencyKey: 'setting-revision:era', budgetId: budget.budget_id,
      initialPhase: 'reply', brief: { settingGuidance: { itemKey: 'era' } }
    });
    context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'complete' WHERE task_id = ?`).run(taskId);
    const service = new SettingCollaborationService(new SettingCollaborationRepository(context.database), workspace);
    const before = context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { count: number };

    expect(service.inspect(scope, 'era')).toMatchObject({
      item: { status: '候选待确认', content: expect.stringContaining('近未来沿海城市') },
      revisionTask: { taskId, status: 'succeeded' }
    });
    service.inspect(scope, 'era');
    const after = context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { count: number };
    expect(after.count).toBe(before.count);
  });
});
