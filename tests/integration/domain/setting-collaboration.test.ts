import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import { SettingCollaborationService } from '../../../apps/api/src/application/knowledge/setting-collaboration-service.js';
import { SettingCollaborationCommandService } from '../../../apps/api/src/application/knowledge/setting-collaboration-command-service.js';
import { SettingOutlineWorkspaceService } from '../../../apps/api/src/application/knowledge/setting-outline-workspace-service.js';
import {
  SettingGuidanceService,
  selectRelevantConfirmedContext
} from '../../../apps/api/src/application/knowledge/setting-guidance-service.js';
import { EditorLeaseService } from '../../../apps/api/src/application/editors/editor-lease-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { SettingCollaborationRepository } from '../../../apps/api/src/infrastructure/db/repositories/setting-collaboration-repository.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { OPENING_TAXONOMY } from '../../../apps/api/src/contracts/opening-blueprint.js';

describe('设定页内协作读模型', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('后续设定只携带核心边界、显式依赖和最近接口，不回灌全部无关设定', () => {
    const confirmed = [
      'creative-concept', 'reader-promise', 'era', 'protagonist', 'motivation', 'must-follow',
      'game-entry', 'player-npc', 'game-panel', 'class-skill', 'loot', 'power-source', 'levels'
    ].map((itemKey) => ({ itemKey, label: itemKey, content: itemKey }));
    const selected = selectRelevantConfirmedContext(confirmed, 'costs');
    expect(selected.map((item) => item.itemKey)).toEqual([
      'creative-concept', 'reader-promise', 'protagonist', 'motivation', 'must-follow', 'power-source', 'levels'
    ]);
    expect(selected.map((item) => item.itemKey)).not.toContain('loot');
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
    expect(initialized?.itemKey).toBe('creative-concept');
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
    ).start(scope, 'creative-concept', { idempotencyKey: 'distinct-model-panel' });

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
    ).start(scope, 'creative-concept', { idempotencyKey: 'rebuild-completed-duplicate-model-panel' });
    expect(rebuilt).toMatchObject({ reused: false, status: 'queued' });
    expect(rebuilt.taskId).not.toBe(command.taskId);
    expect(rebuilt.discussionId).not.toBe(command.discussionId);
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
      revisionTask: { taskId, status: 'succeeded' }
    });
    service.inspect(scope, 'era');
    const after = context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { count: number };
    expect(after.count).toBe(before.count);
  });

  it('后续设定提案收到本书完整开书资料和全部已确认前置设定', () => {
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
        mainTags: ['仙侠', '悬疑'], auxiliaryTags: [], storyTraits: ['群像'], customTags: ['浮空城', '机关'],
        initialMap, mustFollow: ['普通人不能成为无代价耗材']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    guidance.ensureInitialized(scope);
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    const items = workspace.list(scope);
    const required = items.filter((item) => ['creative-concept', 'reader-promise', 'era', 'protagonist', 'motivation', 'must-follow'].includes(item.itemKey));
    expect(required).toHaveLength(6);
    for (const [index, item] of required.entries()) {
      workspace.save(scope, {
        itemKey: item.itemKey, groupTitle: item.groupTitle, label: item.label, prompt: item.prompt,
        sourceLabel: item.sourceLabel, sortOrder: item.sortOrder, status: '已确认',
        content: index === 0 ? `第一项完整设定：${'甲'.repeat(700)}：末尾锚点` : `已确认前置设定${index + 1}`
      });
    }

    const snapshot = guidance.current(scope);
    expect(snapshot).not.toBeNull();
    expect(JSON.parse(snapshot!.openingBookCore)).toMatchObject({ storyDirection, initialMap });
    expect(snapshot!.confirmedContext).toHaveLength(6);
    expect(snapshot!.confirmedContext[0]?.content).toContain('末尾锚点');

    const scheduled = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, snapshot!.itemKey, { idempotencyKey: 'complete-opening-pack' });
    const task = context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
      .get(scheduled.taskId) as { task_brief_json: string };
    const brief = JSON.parse(task.task_brief_json) as { scopeText: string };
    expect(brief.scopeText).toContain(storyDirection);
    expect(brief.scopeText).toContain(initialMap);
    expect(brief.scopeText).toContain('末尾锚点');
  });
});
