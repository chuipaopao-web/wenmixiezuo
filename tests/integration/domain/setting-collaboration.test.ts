import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionPipelineService } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
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
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
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
    expect(initialized?.itemKey).toBe('story-kernel');
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
    ).start(scope, 'story-kernel', { idempotencyKey: 'distinct-model-panel' });

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
    ).start(scope, 'story-kernel', { idempotencyKey: 'rebuild-completed-duplicate-model-panel' });
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
    const first = commands.start(scope, 'story-kernel', { idempotencyKey: 'redesign-first-round' });
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
    const reused = commands.start(scope, 'story-kernel', { idempotencyKey: 'redesign-plain-start' });
    expect(reused).toMatchObject({ reused: true, discussionId: first.discussionId });
    const restarted = commands.restart(scope, 'story-kernel', { idempotencyKey: 'redesign-round-two' });
    expect(restarted).toMatchObject({ reused: false, status: 'queued' });
    expect(restarted.discussionId).not.toBe(first.discussionId);

    // 新一轮进行中不得再发起重新设计
    expect(() => commands.restart(scope, 'story-kernel', { idempotencyKey: 'redesign-round-three' }))
      .toThrowError('这一轮设计还在进行中');

    // 第二轮完成后，同幂等键重复点击不重复建任务，新键可以再开第三轮
    context.database.prepare('UPDATE tasks SET status = ?, current_phase = ? WHERE task_id = ?')
      .run('succeeded', 'complete', restarted.taskId);
    const deduped = commands.restart(scope, 'story-kernel', { idempotencyKey: 'redesign-round-two' });
    expect(deduped).toMatchObject({ reused: true, taskId: restarted.taskId });
    const third = commands.restart(scope, 'story-kernel', { idempotencyKey: 'redesign-round-four' });
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
        mainTags: ['仙侠', '悬疑'], auxiliaryTags: [], storyTraits: ['智斗'], customTags: ['浮空城', '机关'],
        initialMap, mustFollow: ['普通人不能成为无代价耗材']
      }
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    guidance.ensureInitialized(scope);
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    const items = workspace.list(scope);
    const required = items.filter((item) => ['story-kernel', 'world-stage', 'protagonist-situation', 'opposition', 'rules-costs', 'boundaries-blanks'].includes(item.itemKey));
    expect(required).toHaveLength(6);
    for (const [index, item] of required.slice(0, -1).entries()) {
      workspace.save(scope, {
        itemKey: item.itemKey, groupTitle: item.groupTitle, label: item.label, prompt: item.prompt,
        sourceLabel: item.sourceLabel, sortOrder: item.sortOrder, status: '已确认',
        content: index === 0 ? `第一项完整设定：${'甲'.repeat(700)}：末尾锚点` : `已确认前置设定${index + 1}`
      });
    }

    const snapshot = guidance.current(scope);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.itemKey).toBe('boundaries-blanks');
    expect(JSON.parse(snapshot!.openingBookCore)).toMatchObject({ storyDirection, initialMap });
    expect(snapshot!.confirmedContext.map((item) => item.itemKey)).toEqual([
      'story-kernel', 'protagonist-situation', 'opposition', 'rules-costs'
    ]);
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

  it('提案三席产出可勾选碎片，主编按勾选碎片融合并保留段级来源', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '碎片融合书',
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
    const factory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const pipeline = new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, factory);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);

    const scheduled = commands.start(scope, itemKey, { idempotencyKey: 'fragment-panel' });
    expect(tasks.claimNext('worker-fragments')?.taskId).toBe(scheduled.taskId);
    await pipeline.executeClaimed(scope, scheduled.taskId, 'worker-fragments');

    const fragmentRows = context.database.prepare(`SELECT fragment_id, proposal_id, role_key, fragment_no, implicit
      FROM setting_proposal_fragments
      WHERE owner_id = ? AND book_id = ? AND item_key = ?
      ORDER BY proposal_id, fragment_no`)
      .all(scope.ownerId, scope.bookId, itemKey) as unknown as Array<{
        fragment_id: string; proposal_id: string; role_key: string; fragment_no: number; implicit: number;
      }>;
    const proposalIds = [...new Set(fragmentRows.map((row) => row.proposal_id))];
    expect(proposalIds).toHaveLength(3);
    expect(fragmentRows.length).toBeGreaterThanOrEqual(3);

    const picked = [
      fragmentRows[0]!,
      fragmentRows.find((row) => row.proposal_id !== fragmentRows[0]!.proposal_id)!
    ].map((row) => row.fragment_id);
    const synthesis = commands.synthesize(scope, itemKey, {
      proposalIds, fragmentIds: picked, idempotencyKey: 'fragment-synthesis'
    });
    expect(tasks.claimNext('worker-fragments')?.taskId).toBe(synthesis.taskId);
    await pipeline.executeClaimed(scope, synthesis.taskId, 'worker-fragments');

    const draft = context.database.prepare(`SELECT selected_fragment_ids_json, segments_json, content_text
      FROM setting_fusion_drafts WHERE owner_id = ? AND book_id = ? AND item_key = ?`)
      .get(scope.ownerId, scope.bookId, itemKey) as {
        selected_fragment_ids_json: string; segments_json: string; content_text: string;
      };
    expect(JSON.parse(draft.selected_fragment_ids_json)).toEqual(picked);
    const segments = JSON.parse(draft.segments_json) as Array<{ source: string; fragmentId: string | null }>;
    expect(segments.filter((segment) => segment.source === 'fragment')
      .map((segment) => segment.fragmentId).sort()).toEqual([...picked].sort());
    expect(segments.some((segment) => segment.source === 'stitch')).toBe(true);

    const view = new SettingCollaborationService(
      new SettingCollaborationRepository(context.database),
      new SettingOutlineWorkspaceService(context.database, clock)
    ).inspect(scope, itemKey);
    expect(view.fusionDraft?.segments).toHaveLength(segments.length);
    expect(view.panel?.proposals.every((proposal) => proposal.fragments.length >= 1)).toBe(true);

    expect(() => commands.synthesize(scope, itemKey, {
      proposalIds, fragmentIds: ['missing-fragment'], idempotencyKey: 'fragment-synthesis-bad'
    })).toThrowError(/勾选的碎片/u);
  });

  it('旧版本留下的坏融合稿回复不得在重试时复用，必须让主编重新生成', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '坏融合稿重试书',
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
    const itemKey = guidance.current(scope)!.itemKey;
    const commands = new SettingCollaborationCommandService(context.database, context.config.releaseId, ids, clock);
    const factory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const pipeline = new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, factory);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);

    const scheduled = commands.start(scope, itemKey, { idempotencyKey: 'poison-panel' });
    expect(tasks.claimNext('worker-poison')?.taskId).toBe(scheduled.taskId);
    await pipeline.executeClaimed(scope, scheduled.taskId, 'worker-poison');

    const fragmentRows = context.database.prepare(`SELECT fragment_id, proposal_id FROM setting_proposal_fragments
      WHERE owner_id = ? AND book_id = ? AND item_key = ? ORDER BY proposal_id, fragment_no`)
      .all(scope.ownerId, scope.bookId, itemKey) as unknown as Array<{ fragment_id: string; proposal_id: string }>;
    const proposalIds = [...new Set(fragmentRows.map((row) => row.proposal_id))];
    const picked = [fragmentRows[0]!, fragmentRows.find((row) => row.proposal_id !== fragmentRows[0]!.proposal_id)!]
      .map((row) => row.fragment_id);
    const synthesis = commands.synthesize(scope, itemKey, {
      proposalIds, fragmentIds: picked, idempotencyKey: 'poison-synthesis'
    });

    // 模拟旧版本崩溃窗口留下的"已通过落库校验、但整体 JSON 残缺、没有有效
    // fusionSegments"的主编意见：它能通过设定落库的宽容提取，却不能作为融合稿。
    const editor = context.database.prepare(`SELECT a.agent_id, a.model_snapshot_id
      FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = 'chief_editor'`)
      .get(scope.ownerId, scope.bookId) as { agent_id: string; model_snapshot_id: string };
    const poisonedOutput = [
      `设定落库 ${JSON.stringify({ items: [{ itemKey, content: '现代地球开局，万界母校录取通知把主角拉进超凡体系，学籍是长期约束。' }] })}`,
      '{"version":1,"format":"json_object","fields":{"answer":"这份回复少了收尾引号'
    ].join('\n');
    new DiscussionService(context.database, ids, clock).addOpinion(scope, synthesis.discussionId, {
      agentId: editor.agent_id, modelSnapshotId: editor.model_snapshot_id, phase: 'independent',
      content: { role: 'chief_editor', recommendation: poisonedOutput, basis: '旧版本崩溃窗口遗留' },
      tokens: 100
    });

    expect(tasks.claimNext('worker-poison')?.taskId).toBe(synthesis.taskId);
    const result = await pipeline.executeClaimed(scope, synthesis.taskId, 'worker-poison');
    expect(result.discussionId).toBe(synthesis.discussionId);
    expect(tasks.require(scope, synthesis.taskId).status).toBe('succeeded');

    // 主编必须真实重新生成：融合稿来自确定性夹具的衔接段，而不是坏输出。
    const draft = context.database.prepare(`SELECT segments_json FROM setting_fusion_drafts
      WHERE owner_id = ? AND book_id = ? AND item_key = ?`)
      .get(scope.ownerId, scope.bookId, itemKey) as { segments_json: string };
    const segments = JSON.parse(draft.segments_json) as Array<{ source: string; text: string }>;
    expect(segments.some((segment) => segment.source === 'stitch'
      && segment.text.includes('以上按作者勾选的碎片融合为一项设定'))).toBe(true);
    const editorOpinions = context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ? AND agent_id = ? AND phase = 'independent'`)
      .get(scope.ownerId, scope.bookId, synthesis.discussionId, editor.agent_id) as { count: number };
    expect(editorOpinions.count).toBe(2);
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
    const otherKey = currentKey === 'opposition' ? 'rules-costs' : 'opposition';

    const scheduled = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, otherKey, { idempotencyKey: 'free-item-panel' });

    expect(scheduled).toMatchObject({ reused: false, status: 'queued' });
    const brief = JSON.parse((context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
      .get(scheduled.taskId) as { task_brief_json: string }).task_brief_json) as { settingItemKey: string; scopeText: string };
    expect(brief.settingItemKey).toBe(otherKey);
    expect(brief.scopeText).toContain(otherKey);
    const participants = context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_participants
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?`)
      .get(scope.ownerId, scope.bookId, scheduled.discussionId) as { count: number };
    expect(participants.count).toBe(3);
    const itemRow = context.database.prepare(`SELECT item_status FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND item_key = ?`)
      .get(scope.ownerId, scope.bookId, otherKey) as { item_status: string };
    expect(itemRow.item_status).toBe('讨论中');
  });
});
