import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionPipelineService } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import { SettingCollaborationService } from '../../../apps/api/src/application/knowledge/setting-collaboration-service.js';
import { SettingCollaborationCommandService } from '../../../apps/api/src/application/knowledge/setting-collaboration-command-service.js';
import { SettingOutlineWorkspaceService, type SettingOutlineWorkspaceItem } from '../../../apps/api/src/application/knowledge/setting-outline-workspace-service.js';
import {
  compileTemporarySettingContextPack,
  SettingGuidanceService
} from '../../../apps/api/src/application/knowledge/setting-guidance-service.js';
import { EditorLeaseService } from '../../../apps/api/src/application/editors/editor-lease-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { AuthorCollaborationService } from '../../../apps/api/src/application/planning/author-collaboration-service.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { AuthorPlanningInputRepository } from '../../../apps/api/src/infrastructure/db/repositories/author-planning-input-repository.js';
import { SettingCollaborationRepository } from '../../../apps/api/src/infrastructure/db/repositories/setting-collaboration-repository.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterError } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { OPENING_TAXONOMY } from '../../../apps/api/src/contracts/opening-blueprint.js';

describe('设定页内协作读模型', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('临时资料包包含全部已确认条目的短摘要并明确保持非正史', () => {
    const rows = [
      'world-stage', 'social-order', 'rules-costs', 'boundaries-blanks'
    ].map((itemKey, sortOrder): SettingOutlineWorkspaceItem => ({
      itemKey,
      groupTitle: '核心设定',
      label: itemKey,
      prompt: itemKey + '应该怎样设计？',
      sourceLabel: '通用',
      status: '已确认',
      custom: false,
      sortOrder,
      content: '第一句概述。' + '甲'.repeat(400) + '。必须保留这条边界。',
      sourceDiscussionId: null,
      sourceDecisionId: null,
      candidateAt: null,
      confirmedAt: '2026-08-21T08:00:00.000Z',
      pendingCandidate: null,
      pendingCandidateAt: null,
      updatedAt: '2026-08-21T08:00:00.000Z'
    }));
    const pack = compileTemporarySettingContextPack(rows, 'boundaries-blanks', 720);
    expect(pack.kind).toBe('temporary_non_canon');
    expect(pack.itemCount).toBe(3);
    expect(pack.items.map((item) => item.itemKey)).toEqual([
      'world-stage', 'social-order', 'rules-costs'
    ]);
    expect(pack.items.every((item) => item.summary.length <= 240)).toBe(true);
    expect(pack.items.every((item) => item.summary.includes('必须保留这条边界'))).toBe(true);
    expect(pack.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('副编临时接管导致与编剧重模时先安全回切原主编，再创建三模型独立方案', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '三模型接管门禁',
      openingBlueprint: {
        styleIntent: { languageTones: ['自然'], emotionalTones: ['热血'], pacingAndPayoff: ['紧凑'], atmospheres: ['仙侠'], custom: [] },
        taxonomyVersion: OPENING_TAXONOMY.version,
        channel: 'male', categoryKey: 'male-eastern-xianxia', targetAudience: '仙侠读者',
        protagonists: [{ role: 'male_lead', name: '陆沉星', age: '十八岁', background: '宗门杂役', personalities: ['冷静'] }],
        storyDirection: '陆沉星被迫登上照夜台生死战，从残阵破绽里活下来，并循着地火脉黑账查清父亲旧案。', worldBackground: '架空仙侠宗门。',
        openingBackground: '照夜台生死战。', stageOne: { start: '被迫登台', development: '借阵破局', end: '找到旧案线索' },
        fullBookOutline: '陆沉星逐层查明宗门阵脉黑账。', mainTags: ['仙侠', '修仙'], auxiliaryTags: [], storyTraits: ['智斗'],
        customTags: [], initialMap: '太衡宗', mustFollow: ['越级胜利必须有依据']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const initialized = new SettingGuidanceService(context.database, ids, clock).ensureInitialized(scope);
    expect(initialized?.itemKey).toBe('world-stage');
    const roles = context.database.prepare(`
      SELECT a.agent_id, r.role_key FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'deputy_editor')
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; role_key: string }>;
    const chief = roles.find((role) => role.role_key === 'chief_editor')!;
    const deputy = roles.find((role) => role.role_key === 'deputy_editor')!;
    const panelModels = context.database.prepare(`
      SELECT a.model_snapshot_id, r.role_key FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ?
        AND r.role_key IN ('chief_editor', 'deputy_editor', 'lead_screenwriter', 'second_screenwriter')
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ model_snapshot_id: string; role_key: string }>;
    const modelByRole = new Map(panelModels.map((item) => [item.role_key, item.model_snapshot_id]));
    const bindTestModel = (roleKey: string, modelId: string): void => {
      const snapshotId = modelByRole.get(roleKey);
      if (snapshotId === undefined) throw new Error(`missing model snapshot for ${roleKey}`);
      context!.database.prepare(`
        UPDATE model_config_snapshots SET provider = 'test-subscription', model_id = ?
        WHERE owner_id = ? AND book_id = ? AND model_snapshot_id = ?
      `).run(modelId, scope.ownerId, scope.bookId, snapshotId);
    };
    bindTestModel('chief_editor', 'chief-model');
    bindTestModel('lead_screenwriter', 'lead-model');
    bindTestModel('second_screenwriter', 'second-model');
    bindTestModel('deputy_editor', 'second-model');
    const editors = new EditorLeaseService(context.database, ids, clock);
    const takeover = editors.prepareTakeover(scope, deputy.agent_id);
    editors.completeTakeover(scope, takeover.takeoverId);
    expect(editors.require(scope).activeEditorAgentId).toBe(deputy.agent_id);

    const command = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, 'world-stage', { screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'], idempotencyKey: 'distinct-model-panel' });

    expect(command).toMatchObject({ reused: false, status: 'queued' });
    const activeRole = context.database.prepare(`
      SELECT r.role_key FROM editor_leases e JOIN agent_instances a
        ON a.owner_id = e.owner_id AND a.book_id = e.book_id AND a.agent_id = e.active_editor_agent_id
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE e.owner_id = ? AND e.book_id = ?
    `).get(scope.ownerId, scope.bookId) as { role_key: string };
    expect(activeRole.role_key).toBe('chief_editor');
    const signatures = context.database.prepare(`
      SELECT m.provider || '/' || m.model_id AS signature
      FROM discussion_participants p JOIN model_config_snapshots m ON m.model_snapshot_id = p.model_snapshot_id
      WHERE p.owner_id = ? AND p.book_id = ? AND p.discussion_id = ?
    `).all(scope.ownerId, scope.bookId, command.discussionId) as unknown as Array<{ signature: string }>;
    expect(signatures).toHaveLength(3);
    expect(new Set(signatures.map((item) => item.signature)).size).toBe(3);
    expect(command.reused).toBe(false);
    const participants = context.database.prepare(
      'SELECT agent_id, model_snapshot_id FROM discussion_participants WHERE owner_id = ? AND book_id = ? AND discussion_id = ? ORDER BY agent_id'
    ).all(scope.ownerId, scope.bookId, command.discussionId) as unknown as Array<{ agent_id: string; model_snapshot_id: string }>;
    const discussions = new DiscussionService(context.database, ids, clock);
    const completedOpinions = participants.map((participant, index) => discussions.addOpinion(scope, command.discussionId, {
      agentId: participant.agent_id,
      modelSnapshotId: participant.model_snapshot_id,
      phase: 'independent',
      content: { recommendation: 'historical proposal ' + String(index + 1) },
      tokens: 12
    }));
    context.database.prepare('UPDATE discussion_opinions SET model_snapshot_id = ? WHERE opinion_id = ?')
      .run(participants[0]!.model_snapshot_id, completedOpinions[2]!);
    context.database.prepare('UPDATE tasks SET status = ?, current_phase = ? WHERE task_id = ?')
      .run('succeeded', 'complete', command.taskId);
    const rebuilt = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, 'world-stage', { screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'], idempotencyKey: 'rebuild-completed-duplicate-model-panel' });
    expect(rebuilt).toMatchObject({ reused: false, status: 'queued' });
    expect(rebuilt.taskId).not.toBe(command.taskId);
    expect(rebuilt.discussionId).not.toBe(command.discussionId);
  });

  it('作者不满意可重新设计：不复用已完成讨论，新一轮成为最新面板，进行中拒绝重复发起', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '重新设计书',
      openingBlueprint: {
        styleIntent: { languageTones: ['自然'], emotionalTones: ['热血'], pacingAndPayoff: ['紧凑'], atmospheres: ['仙侠'], custom: [] },
        taxonomyVersion: OPENING_TAXONOMY.version,
        channel: 'male', categoryKey: 'male-eastern-xianxia', targetAudience: '仙侠读者',
        protagonists: [{ role: 'male_lead', name: '陆沉星', age: '十八岁', background: '宗门杂役', personalities: ['冷静'] }],
        storyDirection: '陆沉星被迫登上照夜台生死战，从残阵破绽里活下来，并循着地火脉黑账查清父亲旧案。', worldBackground: '架空仙侠宗门。',
        openingBackground: '照夜台生死战。', stageOne: { start: '被迫登台', development: '借阵破局', end: '找到旧案线索' },
        fullBookOutline: '陆沉星逐层查明宗门阵脉黑账。', mainTags: ['仙侠', '修仙'], auxiliaryTags: [], storyTraits: ['智斗'],
        customTags: [], initialMap: '太衡宗', mustFollow: ['越级胜利必须有依据']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    new SettingGuidanceService(context.database, ids, clock).ensureInitialized(scope);
    const commands = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    );
    const first = commands.start(scope, 'world-stage', { screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'], idempotencyKey: 'redesign-first-round' });
    expect(first).toMatchObject({ reused: false, status: 'queued' });
    // 补齐三份异模型提案并把任务标记完成，模拟一轮已出方案的讨论
    const participants = context.database.prepare(
      'SELECT agent_id, model_snapshot_id FROM discussion_participants WHERE owner_id = ? AND book_id = ? AND discussion_id = ? ORDER BY agent_id'
    ).all(scope.ownerId, scope.bookId, first.discussionId) as unknown as Array<{ agent_id: string; model_snapshot_id: string }>;
    const discussions = new DiscussionService(context.database, ids, clock);
    participants.forEach((participant, index) => discussions.addOpinion(scope, first.discussionId, {
      agentId: participant.agent_id,
      modelSnapshotId: participant.model_snapshot_id,
      phase: 'independent',
      content: { recommendation: '第一轮方案 ' + String(index + 1) },
      tokens: 12
    }));
    context.database.prepare('UPDATE tasks SET status = ?, current_phase = ? WHERE task_id = ?')
      .run('succeeded', 'complete', first.taskId);

    // 普通开始会复用旧讨论；重新设计必须全新一轮
    const reused = commands.start(scope, 'world-stage', { screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'], idempotencyKey: 'redesign-plain-start' });
    expect(reused).toMatchObject({ reused: true, discussionId: first.discussionId });

    // 单个编剧重做时，调用当下重新编译资料包，显式排除旧方案，同时其他编剧旧方案继续可见。
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    workspace.activateGuidanceItem(scope, 'social-order');
    workspace.recordGuidanceCandidate(scope, 'social-order', '社会秩序只约束群体分层与公共资源分配，不预设任何人物关系。');
    workspace.confirmGuidanceCandidate(scope, 'social-order');
    const collaborationRepository = new SettingCollaborationRepository(context.database);
    const priorLead = collaborationRepository.latestProposalsByRole(scope, 'world-stage')
      .find((proposal) => proposal.role_key === 'lead_screenwriter')!;
    const memberRedesign = commands.redesignMember(scope, 'world-stage', {
      roleKey: 'lead_screenwriter',
      proposalId: priorLead.proposal_id,
      idempotencyKey: 'lead-member-redesign'
    });
    expect(memberRedesign).toMatchObject({ reused: false, status: 'queued' });
    const memberScope = collaborationRepository.discussionScopeText(scope, memberRedesign.discussionId)!;
    expect(memberScope).toContain('社会秩序只约束群体分层与公共资源分配');
    expect(memberScope).toContain('上一方案摘要：' + priorLead.content);
    expect(memberScope).toContain('不能复述、换词改写或沿用上一方案');
    const redesignedRoles = context.database.prepare(
      'SELECT r.role_key FROM discussion_participants p '
      + 'JOIN agent_instances a ON a.agent_id = p.agent_id AND a.owner_id = p.owner_id AND a.book_id = p.book_id '
      + 'JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version '
      + 'WHERE p.owner_id = ? AND p.book_id = ? AND p.discussion_id = ?'
    ).all(scope.ownerId, scope.bookId, memberRedesign.discussionId) as unknown as Array<{ role_key: string }>;
    expect(redesignedRoles).toEqual([{ role_key: 'lead_screenwriter' }]);
    const whileRedesigning = new SettingCollaborationService(collaborationRepository, workspace).inspect(scope, 'world-stage');
    expect(whileRedesigning.panel?.proposals).toHaveLength(3);
    context.database.prepare('UPDATE tasks SET status = ?, current_phase = ? WHERE task_id = ?')
      .run('succeeded', 'complete', memberRedesign.taskId);

    const restarted = commands.restart(scope, 'world-stage', { screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'], idempotencyKey: 'redesign-round-two' });
    expect(restarted).toMatchObject({ reused: false, status: 'queued' });
    expect(restarted.discussionId).not.toBe(first.discussionId);

    // 新一轮进行中不得再发起重新设计
    expect(() => commands.restart(scope, 'world-stage', { screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'], idempotencyKey: 'redesign-round-three' }))
      .toThrowError('这一轮设计还在进行中');

    // 第二轮完成后，同幂等键重复点击不重复建任务，新键可以再开第三轮
    context.database.prepare('UPDATE tasks SET status = ?, current_phase = ? WHERE task_id = ?')
      .run('succeeded', 'complete', restarted.taskId);
    const deduped = commands.restart(scope, 'world-stage', { screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'], idempotencyKey: 'redesign-round-two' });
    expect(deduped).toMatchObject({ reused: true, taskId: restarted.taskId });
    const third = commands.restart(scope, 'world-stage', { screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'], idempotencyKey: 'redesign-round-four' });
    expect(third).toMatchObject({ reused: false, status: 'queued' });
    expect(third.discussionId).not.toBe(restarted.discussionId);
  });

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
    discussionService.synthesize(firstScope, discussion.discussionId, {
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
    const firstView = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database), firstWorkspace
    ).inspect(firstScope, 'creative-concept');
    expect(firstView.panel).toMatchObject({ recoveryKey: taskId, taskStatus: 'succeeded' });
    expect(firstView.panel?.proposals).toHaveLength(3);
    expect(firstView.panel?.proposals.map((proposal) => proposal.memberName)).toEqual(members.map((member) => member.display_name));
    expect(firstView.panel?.proposals.every((proposal) => !('modelProvider' in proposal) && !('modelId' in proposal))).toBe(true);
    expect(firstView.impact).toEqual({ changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' });

    const secondView = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database), secondWorkspace
    ).inspect(secondScope, 'creative-concept');
    expect(secondView.panel).toBeNull();
    expect(secondView.historyCount).toBe(0);
  });

  it('重复读取不创建新任务，并只读返回历史整理任务与当前候选', () => {
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
      taskId, taskType: 'discussion', assignedAgentId: editor.agent_id,
      idempotencyKey: 'setting-revision:era', budgetId: budget.budget_id,
      initialPhase: 'synthesizing', brief: { purpose: 'setting_synthesis', settingItemKey: 'era' }
    });
    context.database.prepare(`UPDATE tasks SET status = 'succeeded', current_phase = 'complete' WHERE task_id = ?`).run(taskId);
    const service = new SettingCollaborationService(new SettingCollaborationRepository(context.database), workspace);
    const before = context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { count: number };

    expect(service.inspect(scope, 'era')).toMatchObject({
      item: { status: '候选待确认', content: expect.stringContaining('近未来沿海城市') },
      revisionTask: { recoveryKey: taskId, status: 'succeeded' }
    });
    service.inspect(scope, 'era');
    const after = context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { count: number };
    expect(after.count).toBe(before.count);
  });

  it('后续设定提案只收到宏观开书资料和已确认宏观条目的非正史短摘要，修改与清空后不复用旧包', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const storyDirection = '主角循着失窃航图追查浮空城坠落真相，并保护仍在城中的普通居民。';
    const initialMap = '旧港、悬桥、浮空城外环、钟楼、北侧升降井。';
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '完整设定资料包',
      openingBlueprint: {
        styleIntent: { languageTones: ['自然'], emotionalTones: ['紧张'], pacingAndPayoff: ['递进'], atmospheres: ['悬空城'], custom: ['人物对白要有差异'] },
        taxonomyVersion: OPENING_TAXONOMY.version,
        channel: 'male', categoryKey: 'male-eastern-xianxia', targetAudience: '喜欢群像与悬案的读者',
        protagonists: [{ role: 'male_lead', name: '顾川', age: '十九岁', background: '旧港修械学徒', personalities: ['谨慎', '护短'] }],
        storyDirection, worldBackground: '群岛以浮空索道相连，坠城会切断贸易与救援。',
        openingBackground: '旧港钟楼坠下一块带血的航图。',
        stageOne: { start: '捡到航图', development: '结伴入城', end: '阻止第一次坠落' },
        fullBookOutline: '每卷解决一座浮空城危机并推进失窃航图主线。',
        mainTags: ['仙侠', '悬疑'], auxiliaryTags: [], storyTraits: ['智斗'], customTags: ['浮空城', '机关'],
        initialMap, mustFollow: ['普通人不能成为无代价耗材']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    guidance.ensureInitialized(scope);
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    const items = workspace.list(scope);
    const required = items.filter((item) => ['world-stage', 'social-order', 'rules-costs', 'boundaries-blanks'].includes(item.itemKey));
    expect(required).toHaveLength(4);
    for (const [index, item] of required.slice(0, -1).entries()) {
      workspace.save(scope, {
        itemKey: item.itemKey, groupTitle: item.groupTitle, label: item.label, prompt: item.prompt,
        sourceLabel: item.sourceLabel, sortOrder: item.sortOrder, status: '已确认',
        content: item.itemKey === 'social-order' ? `社会秩序完整设定：${'甲'.repeat(700)}。必须保留末尾锚点。` : `已确认前置设定${index + 1}`
      });
    }

    const snapshot = guidance.current(scope);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.itemKey).toBe('boundaries-blanks');
    const macroOpening = JSON.parse(snapshot!.openingBookCore) as Record<string, unknown>;
    expect(macroOpening).toMatchObject({ categoryKey: 'male-eastern-xianxia', worldBackground: '群岛以浮空索道相连，坠城会切断贸易与救援。', initialMap, mustFollow: ['普通人不能成为无代价耗材'] });
    expect(macroOpening).not.toHaveProperty('storyDirection');
    expect(macroOpening).toHaveProperty('initialMap', initialMap);
    expect(macroOpening).not.toHaveProperty('protagonists');
    expect(snapshot!.temporaryContextPack.kind).toBe('temporary_non_canon');
    expect(snapshot!.temporaryContextPack.items.map((item) => item.itemKey)).toEqual([
      'world-stage', 'social-order', 'rules-costs'
    ]);
    expect(snapshot!.temporaryContextPack.items[1]?.summary).toContain('末尾锚点');
    const firstPackHash = snapshot!.temporaryContextPack.contentHash;

    const scheduled = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, snapshot!.itemKey, { screenwriterRoleKeys: ['lead_screenwriter'], idempotencyKey: 'complete-opening-pack' });
    const task = context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
      .get(scheduled.taskId) as { task_brief_json: string };
    const brief = JSON.parse(task.task_brief_json) as { scopeText: string };
    expect(brief.scopeText).not.toContain(storyDirection);
    expect(brief.scopeText).toContain(initialMap);
    expect(brief.scopeText).toContain('普通人不能成为无代价耗材');
    expect(brief.scopeText).toContain('不得设计主角、配角、反派、人物关系');
    expect(brief.scopeText).toContain('尚未经过主编审查');
    expect(brief.scopeText).toContain('不属于正史');
    expect(brief.scopeText).toContain(firstPackHash);
    expect(brief.scopeText).toContain('末尾锚点');
    expect(brief.scopeText).not.toContain('甲'.repeat(500));

    const changed = workspace.list(scope).find((item) => item.itemKey === 'world-stage')!;
    workspace.save(scope, {
      itemKey: changed.itemKey, groupTitle: changed.groupTitle, label: changed.label, prompt: changed.prompt,
      sourceLabel: changed.sourceLabel, sortOrder: changed.sortOrder, status: '已确认',
      content: '世界舞台已经修改，新版临时资料必须使用这一句。'
    });
    const changedTask = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, snapshot!.itemKey, { screenwriterRoleKeys: ['lead_screenwriter'], idempotencyKey: 'changed-opening-pack' });
    expect(changedTask).toMatchObject({ reused: false });
    const changedBrief = JSON.parse((context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
      .get(changedTask.taskId) as { task_brief_json: string }).task_brief_json) as { scopeText: string };
    expect(changedBrief.scopeText).toContain('世界舞台已经修改');
    expect(changedBrief.scopeText).not.toContain(firstPackHash);

    workspace.clearAll(scope);
    const clearedTask = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, snapshot!.itemKey, { screenwriterRoleKeys: ['lead_screenwriter'], idempotencyKey: 'cleared-opening-pack' });
    expect(clearedTask).toMatchObject({ reused: false });
    const clearedBrief = JSON.parse((context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
      .get(clearedTask.taskId) as { task_brief_json: string }).task_brief_json) as { scopeText: string };
    expect(clearedBrief.scopeText).toContain('已确认条目数量：0');
    expect(clearedBrief.scopeText).not.toContain('世界舞台已经修改');
  });

  it('作者所选编剧独立产出可勾选方案，主编按选择融合编辑稿，全部完成后再整体审查', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '独立方案与全篇审查书',
      openingBlueprint: {
        styleIntent: { languageTones: ['自然'], emotionalTones: ['热血'], pacingAndPayoff: ['紧凑'], atmospheres: ['仙侠'], custom: [] },
        taxonomyVersion: OPENING_TAXONOMY.version,
        channel: 'male', categoryKey: 'male-eastern-xianxia', targetAudience: '仙侠读者',
        protagonists: [{ role: 'male_lead', name: '沈砚', age: '二十岁', background: '边城镖师', personalities: ['沉稳'] }],
        storyDirection: '沈砚护送一枚关乎边城存亡的旧印，沿途识破各方围截。', worldBackground: '架空王朝边塞。',
        openingBackground: '边城镖局深夜接下一单不能拒的镖。', stageOne: { start: '接镖', development: '连破埋伏', end: '发现印中密信' },
        fullBookOutline: '沈砚一路护送旧印入京，揭开朝堂旧案。', mainTags: ['仙侠', '权谋'], auxiliaryTags: [], storyTraits: ['智斗'],
        customTags: [], initialMap: '边城', mustFollow: ['胜利必须付出代价']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    guidance.ensureInitialized(scope);
    const itemKey = guidance.current(scope)!.itemKey;
    const commands = new SettingCollaborationCommandService(context.database, context.config.releaseId, ids, clock);
    const pipeline = new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock,
      new ModelAdapterFactory(loadModelRuntimeConfig({}))
    );
    const tasks = new TaskService(context.database, context.config.releaseId, clock);

    const scheduled = commands.start(scope, itemKey, {
      screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter', 'third_screenwriter'],
      idempotencyKey: 'independent-setting-panel'
    });
    expect(tasks.claimNext('worker-independent-setting')?.taskId).toBe(scheduled.taskId);
    await pipeline.executeClaimed(scope, scheduled.taskId, 'worker-independent-setting');

    const fragmentRows = context.database.prepare(`SELECT fragment_id, proposal_id
      FROM setting_proposal_fragments
      WHERE owner_id = ? AND book_id = ? AND item_key = ?
      ORDER BY proposal_id, fragment_no`)
      .all(scope.ownerId, scope.bookId, itemKey) as unknown as Array<{ fragment_id: string; proposal_id: string }>;
    expect(new Set(fragmentRows.map((row) => row.proposal_id)).size).toBe(3);
    expect(fragmentRows.length).toBeGreaterThanOrEqual(3);
    const view = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database),
      new SettingOutlineWorkspaceService(context.database, clock)
    ).inspect(scope, itemKey);
    expect(view.panel?.proposals.every((proposal) => proposal.fragments.length >= 1)).toBe(true);
    expect(view.revisionTask).toBeNull();
    expect(view.fusionDraft).toBeNull();
    const selectedProposal = view.panel?.proposals[0];
    if (selectedProposal === undefined) throw new Error('缺少可交给主编的编剧方案');
    const synthesis = commands.synthesize(scope, itemKey, {
      proposalIds: [selectedProposal.proposalId],
      wholeProposalIds: [selectedProposal.proposalId],
      fragmentIds: [],
      idempotencyKey: 'selected-setting-synthesis'
    });
    expect(tasks.claimNext('worker-selected-setting-synthesis')?.taskId).toBe(synthesis.taskId);
    await expect(pipeline.executeClaimed(scope, synthesis.taskId, 'worker-selected-setting-synthesis'))
      .resolves.toMatchObject({ opinionCount: 1 });
    const synthesized = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database),
      new SettingOutlineWorkspaceService(context.database, clock)
    ).inspect(scope, itemKey);
    expect(synthesized.revisionTask?.status).toBe('succeeded');
    expect(synthesized.item.status).toBe('候选待确认');
    expect(synthesized.item.content).toBeTruthy();
    const modifiedDraft = '作者删除了旧稿中的身份门槛，改为所有居民都能申诉，但必须在三日内提交证据。';
    const authorInput = new AuthorCollaborationService(
      new AuthorPlanningInputRepository(context.database), new UnitOfWork(context.database), ids, clock
    ).create(scope, {
      surface: 'setting', subjectType: 'setting_module', subjectId: itemKey, intentStrength: 'must',
      originalText: modifiedDraft, attachmentRefs: [], mentionedAgentIds: [],
      scopeNotes: '作者修改后的完整主编编辑稿', idempotencyKey: 'setting-author-modified-draft'
    });
    const revision = commands.revise(scope, itemKey, {
      authorInputId: authorInput.authorInputId, idempotencyKey: 'organize-author-modified-draft'
    });
    const revisionBrief = JSON.parse((context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
      .get(revision.taskId) as { task_brief_json: string }).task_brief_json) as { scopeText: string; authorInputIds: string[] };
    expect(revisionBrief.authorInputIds).toEqual([authorInput.authorInputId]);
    expect(revisionBrief.scopeText).toContain(modifiedDraft);
    expect(revisionBrief.scopeText).toContain('唯一底稿');
    expect(revisionBrief.scopeText).not.toContain(synthesized.item.content ?? '');
    expect(tasks.claimNext('worker-organize-setting-draft')?.taskId).toBe(revision.taskId);
    await expect(pipeline.executeClaimed(scope, revision.taskId, 'worker-organize-setting-draft'))
      .resolves.toMatchObject({ opinionCount: 1 });
    const auditWorkspace = new SettingOutlineWorkspaceService(context.database, clock);
    const auditItem = auditWorkspace.list(scope).find((candidate) => candidate.itemKey === itemKey);
    expect(auditItem).toBeDefined();
    if (auditItem === undefined) throw new Error('缺少待质检设定项');
    auditWorkspace.save(scope, {
      itemKey: auditItem.itemKey, groupTitle: auditItem.groupTitle, label: auditItem.label, prompt: auditItem.prompt,
      sourceLabel: auditItem.sourceLabel, sortOrder: auditItem.sortOrder, status: '已确认',
      content: '保持开书方向，明确规则代价，并为后续创作留出空间。'
    });
    const auditTask = commands.audit(scope, { idempotencyKey: 'whole-setting-quality-audit' });
    expect(tasks.claimNext('worker-whole-setting-audit')?.taskId).toBe(auditTask.taskId);
    await expect(pipeline.executeClaimed(scope, auditTask.taskId, 'worker-whole-setting-audit'))
      .resolves.toMatchObject({ opinionCount: 1 });
    const auditReport = context.database.prepare(`SELECT verdict, summary_text, issues_json
      FROM setting_quality_reports WHERE owner_id = ? AND book_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { verdict: string; summary_text: string; issues_json: string };
    expect(auditReport.verdict).toBe('pass');
    expect(auditReport.summary_text).toContain('创作空间');
    expect(JSON.parse(auditReport.issues_json)).toEqual([]);
  });
  it('非当前引导项的类目也可以直接请团队出主意', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '任意类目讨论书',
      openingBlueprint: {
        styleIntent: { languageTones: ['自然'], emotionalTones: ['热血'], pacingAndPayoff: ['紧凑'], atmospheres: ['仙侠'], custom: [] },
        taxonomyVersion: OPENING_TAXONOMY.version,
        channel: 'male', categoryKey: 'male-eastern-xianxia', targetAudience: '仙侠读者',
        protagonists: [{ role: 'male_lead', name: '沈砚', age: '二十岁', background: '边城镖师', personalities: ['沉稳'] }],
        storyDirection: '沈砚护送一枚关乎边城存亡的旧印。', worldBackground: '架空王朝边塞。',
        openingBackground: '边城镖局深夜接镖。', stageOne: { start: '接镖', development: '破局', end: '发现密信' },
        fullBookOutline: '护送旧印入京。', mainTags: ['仙侠'], auxiliaryTags: [], storyTraits: [],
        customTags: [], initialMap: '边城', mustFollow: ['胜利必须付出代价']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    guidance.ensureInitialized(scope);
    const currentKey = guidance.current(scope)!.itemKey;
    const otherKey = currentKey === 'world-stage' ? 'rules-costs' : 'world-stage';

    const collaboration = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database),
      new SettingOutlineWorkspaceService(context.database, clock)
    );
    const initialView = collaboration.inspect(scope, otherKey);
    expect(initialView.screenwriters).toHaveLength(4);
    expect(initialView.screenwriters.find((member) => member.roleKey === 'senior_screenwriter'))
      .toMatchObject({ memberName: '清照', highCompute: true, availability: 'available' });
    context.database.prepare(`UPDATE agent_instances SET activation_state = 'disabled'
      WHERE owner_id = ? AND book_id = ? AND role_template_id IN (
        SELECT role_template_id FROM role_templates WHERE role_key = 'senior_screenwriter'
      )`).run(scope.ownerId, scope.bookId);
    expect(collaboration.inspect(scope, otherKey).screenwriters.find((member) => member.roleKey === 'senior_screenwriter'))
      .toMatchObject({ highCompute: true, availability: 'unavailable' });
    const scheduled = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, otherKey, { screenwriterRoleKeys: ['lead_screenwriter'], idempotencyKey: 'free-item-panel' });

    expect(scheduled).toMatchObject({ reused: false, status: 'queued' });
    const brief = JSON.parse((context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
      .get(scheduled.taskId) as { task_brief_json: string }).task_brief_json) as { settingItemKey: string; scopeText: string };
    expect(brief.settingItemKey).toBe(otherKey);
    expect(brief.scopeText).toContain(otherKey);
    const participants = context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_participants
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?`)
      .get(scope.ownerId, scope.bookId, scheduled.discussionId) as { count: number };
    expect(participants.count).toBe(1);
    const itemRow = context.database.prepare(`SELECT item_status FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND item_key = ?`)
      .get(scope.ownerId, scope.bookId, otherKey) as { item_status: string };
    expect(itemRow.item_status).toBe('讨论中');
  });

  it('单个编剧失败时保留成功方案，并且只重试失败席位', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '单席失败兜底书',
      openingBlueprint: {
        styleIntent: { languageTones: ['自然'], emotionalTones: ['热血'], pacingAndPayoff: ['紧凑'], atmospheres: ['仙侠'], custom: [] },
        taxonomyVersion: OPENING_TAXONOMY.version,
        channel: 'male', categoryKey: 'male-eastern-xianxia', targetAudience: '仙侠读者',
        protagonists: [{ role: 'male_lead', name: '顾川', age: '十九岁', background: '边城学徒', personalities: ['冷静'] }],
        storyDirection: '顾川查清边城阵眼失控的真相。', worldBackground: '架空边城。',
        openingBackground: '阵眼突然熄灭。', stageOne: { start: '追查', development: '受阻', end: '找到内鬼线索' },
        fullBookOutline: '顾川逐层修复阵网并查出幕后人。', mainTags: ['仙侠'], auxiliaryTags: [], storyTraits: ['智斗'],
        customTags: [], initialMap: '边城', mustFollow: ['破局必须有依据']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    guidance.ensureInitialized(scope);
    const itemKey = guidance.current(scope)!.itemKey;
    const commands = new SettingCollaborationCommandService(context.database, context.config.releaseId, ids, clock);
    const factory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const originalResolve = factory.resolve.bind(factory);
    factory.resolve = (provider, modelId, purpose, roleKey) => {
      const adapter = originalResolve(provider, modelId, purpose, roleKey);
      if (roleKey !== 'second_screenwriter') return adapter;
      return {
        provider: adapter.provider,
        modelId: adapter.modelId,
        generate: async () => { throw new ModelAdapterError('该编剧模型暂时不可用', 'request_failure', false, 503); }
      };
    };
    const pipeline = new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, factory);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const scheduled = commands.start(scope, itemKey, {
      screenwriterRoleKeys: ['lead_screenwriter', 'second_screenwriter'], idempotencyKey: 'partial-failure-panel'
    });
    expect(tasks.claimNext('worker-partial')?.taskId).toBe(scheduled.taskId);
    await pipeline.executeClaimed(scope, scheduled.taskId, 'worker-partial');
    expect(tasks.require(scope, scheduled.taskId).status).toBe('succeeded');
    const collaboration = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database),
      new SettingOutlineWorkspaceService(context.database, clock)
    );
    let view = collaboration.inspect(scope, itemKey);
    expect(view.panel?.proposals).toHaveLength(1);
    const failed = view.panel?.members.find((member) => member.roleKey === 'second_screenwriter');
    expect(failed).toMatchObject({ status: 'unavailable', retryable: true });
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    const newlyConfirmed = workspace.list(scope).find((item) => item.itemKey !== itemKey)!;
    workspace.save(scope, {
      itemKey: newlyConfirmed.itemKey, groupTitle: newlyConfirmed.groupTitle, label: newlyConfirmed.label,
      prompt: newlyConfirmed.prompt, sourceLabel: newlyConfirmed.sourceLabel, sortOrder: newlyConfirmed.sortOrder,
      status: '已确认', content: '失败席位重试前刚确认的新设定。'
    });
    const retry = commands.retryMember(scope, itemKey, { roleKey: 'second_screenwriter', idempotencyKey: 'retry-second-only' });
    const retryBrief = JSON.parse((context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
      .get(retry.taskId) as { task_brief_json: string }).task_brief_json) as { scopeText: string };
    expect(retryBrief.scopeText).toContain('失败席位重试前刚确认的新设定');
    expect(tasks.claimNext('worker-retry-seat')?.taskId).toBe(retry.taskId);
    const normalPipeline = new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock, new ModelAdapterFactory(loadModelRuntimeConfig({}))
    );
    await normalPipeline.executeClaimed(scope, retry.taskId, 'worker-retry-seat');
    view = collaboration.inspect(scope, itemKey);
    expect(view.panel?.proposals).toHaveLength(2);
    expect(view.panel?.members.every((member) => member.status === 'completed')).toBe(true);
    const calls = context.database.prepare(`SELECT r.role_key, COUNT(*) AS count FROM model_calls c
      JOIN agent_instances a ON a.owner_id = c.owner_id AND a.book_id = c.book_id AND a.agent_id = c.agent_id
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE c.owner_id = ? AND c.book_id = ? AND r.role_key IN ('lead_screenwriter','second_screenwriter')
      GROUP BY r.role_key`).all(scope.ownerId, scope.bookId) as unknown as Array<{ role_key: string; count: number }>;
    expect(calls.find((row) => row.role_key === 'lead_screenwriter')?.count).toBe(1);
    expect(calls.find((row) => row.role_key === 'second_screenwriter')?.count).toBe(2);
});
  it('所有所选编剧都失败时后台保留诊断、作者视图脱敏，并允许逐席补写', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '全席失败兜底书',
      openingBlueprint: {
        styleIntent: { languageTones: ['自然'], emotionalTones: ['热血'], pacingAndPayoff: ['紧凑'], atmospheres: ['仙侠'], custom: [] },
        taxonomyVersion: OPENING_TAXONOMY.version,
        channel: 'male', categoryKey: 'male-eastern-xianxia', targetAudience: '仙侠读者',
        protagonists: [{ role: 'male_lead', name: '顾川', age: '十九岁', background: '边城学徒', personalities: ['冷静'] }],
        storyDirection: '顾川查清边城阵眼失控的真相。', worldBackground: '架空边城。',
        openingBackground: '阵眼突然熄灭。', stageOne: { start: '追查', development: '受阻', end: '找到内鬼线索' },
        fullBookOutline: '顾川逐层修复阵网并查出幕后人。', mainTags: ['仙侠'], auxiliaryTags: [], storyTraits: ['智斗'],
        customTags: [], initialMap: '边城', mustFollow: ['破局必须有依据']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    guidance.ensureInitialized(scope);
    const itemKey = guidance.current(scope)!.itemKey;
    const commands = new SettingCollaborationCommandService(context.database, context.config.releaseId, ids, clock);
    const factory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const originalResolve = factory.resolve.bind(factory);
    factory.resolve = (provider, modelId, purpose, roleKey) => {
      const adapter = originalResolve(provider, modelId, purpose, roleKey);
      if (roleKey !== 'lead_screenwriter') return adapter;
      return {
        provider: adapter.provider,
        modelId: adapter.modelId,
        generate: async () => { throw new ModelAdapterError('火山方舟Coding Plan已执行但没有形成可提交文字（停止原因=max_tokens，思考字符=29705，输出Token=11000）', 'technical_failure', true, 200); }
      };
    };
    const pipeline = new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, factory);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const scheduled = commands.start(scope, itemKey, {
      screenwriterRoleKeys: ['lead_screenwriter'], idempotencyKey: 'all-failure-panel'
    });
    expect(tasks.claimNext('worker-all-failed')?.taskId).toBe(scheduled.taskId);
    await expect(pipeline.executeClaimed(scope, scheduled.taskId, 'worker-all-failed'))
      .rejects.toThrow('都没有成功返回方案');
    expect(tasks.require(scope, scheduled.taskId).status).toBe('failed');
    const rawFailure = context.database.prepare(`SELECT run_status, error_summary FROM discussion_participants
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?`).get(
        scope.ownerId, scope.bookId, scheduled.discussionId
      ) as { run_status: string; error_summary: string };
    expect(rawFailure).toMatchObject({ run_status: 'failed' });
    expect(rawFailure.error_summary).toContain('停止原因=max_tokens');
    expect(rawFailure.error_summary).toContain('输出Token=11000');

    const collaboration = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database),
      new SettingOutlineWorkspaceService(context.database, clock)
    );
    let view = collaboration.inspect(scope, itemKey);
    expect(view.panel?.proposals).toHaveLength(0);
    expect(view.panel?.members).toEqual([
      expect.objectContaining({ roleKey: 'lead_screenwriter', status: 'failed', retryable: true, errorSummary: '这位成员本次没有形成可用方案，请只重试这位。' })
    ]);

    const retry = commands.retryMember(scope, itemKey, { roleKey: 'lead_screenwriter', idempotencyKey: 'recover-all-failed-seat' });
    expect(tasks.claimNext('worker-all-retry')?.taskId).toBe(retry.taskId);
    const normalPipeline = new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock, new ModelAdapterFactory(loadModelRuntimeConfig({}))
    );
    await normalPipeline.executeClaimed(scope, retry.taskId, 'worker-all-retry');
    view = collaboration.inspect(scope, itemKey);
    expect(view.panel?.proposals).toHaveLength(1);
    expect(view.panel?.members[0]).toMatchObject({ status: 'completed', retryable: false, errorSummary: null });
  });
});
