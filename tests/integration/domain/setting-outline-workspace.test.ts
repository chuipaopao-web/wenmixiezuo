import { afterEach, describe, expect, it } from 'vitest';
import {
  parseSettingOutlineDeposit,
  SettingOutlineWorkspaceService
} from '../../../apps/api/src/application/knowledge/setting-outline-workspace-service.js';
import { SettingBaselineService } from '../../../apps/api/src/application/knowledge/setting-baseline-service.js';
import { resolveSettingOutlineProfile } from '../../../apps/api/src/application/knowledge/setting-outline-profile.js';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import { BookOnboardingService } from '../../../apps/api/src/application/books/book-onboarding-service.js';
import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../../../apps/api/src/contracts/opening-blueprint.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

function blueprint(overrides: Partial<OpeningBlueprintInput>): OpeningBlueprintInput {
  return {
    taxonomyVersion: OPENING_TAXONOMY.version,
    channel: 'female',
    categoryKey: 'female-modern-brain',
    targetAudience: '',
    protagonists: [{
      role: 'female_lead', name: '林夏', age: '二十六岁', background: '都市医生。', personalities: ['理性']
    }],
    storyDirection: '林夏在一次医疗纠纷中重逢旧友，两人必须在职业压力与误解中重新建立信任。',
    worldBackground: '',
    openingBackground: '',
    stageOne: { start: '', development: '', end: '' },
    fullBookOutline: '',
    mainTags: ['都市', '言情'],
    auxiliaryTags: ['职场'],
    storyTraits: ['情感细腻'],
    customTags: [],
    initialMap: '',
    mustFollow: ['不写多角恋'],
    ...overrides
  };
}

describe('设定大纲工作状态', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('都市言情只激活关系和现实生活设定，核心六问始终必备', () => {
    const profile = resolveSettingOutlineProfile(blueprint({}));

    expect(profile.profileKey).toContain('romance');
    expect(profile.profileKey).toContain('urban');
    expect(profile.required).toEqual([
      'story-kernel', 'world-stage', 'protagonist-situation', 'opposition', 'rules-costs', 'boundaries-blanks'
    ]);
    expect(profile.recommended).toEqual(expect.arrayContaining([
      'theme-intent', 'differentiator', 'geography',
      'relationship-premise', 'relationship-obstacle',
      'relationship-growth', 'emotional-boundaries', 'life-circle'
    ]));
    expect(profile.recommended).not.toEqual(expect.arrayContaining([
      'power-source', 'levels', 'production', 'army', 'game-panel', 'ranking'
    ]));
  });

  it('商业经营和梗概中的普通经营词不会误激活领主领地模板', () => {
    const profile = resolveSettingOutlineProfile(blueprint({
      categoryKey: 'female-modern-brain',
      mainTags: ['情感', '经营', '推理'],
      auxiliaryTags: ['现代言情', '商业经营', '悬疑恋爱'],
      storyDirection: '女主经营一家诊所，并调查一宗旧案，在现实压力下重新建立信任。'
    }));

    expect(profile.profileKey).toContain('business');
    expect(profile.profileKey).toContain('mystery');
    expect(profile.profileKey).not.toContain('lord');
    expect(profile.required).not.toEqual(expect.arrayContaining(['territory', 'population', 'yield']));
    expect(profile.recommended).toEqual(expect.arrayContaining(['production', 'currency']));
  });

  it('故事方向里的孤立类型词不会绕过作者分类和题材选择', () => {
    const profile = resolveSettingOutlineProfile(blueprint({
      mainTags: ['都市', '言情'],
      auxiliaryTags: ['现代言情'],
      storyDirection: '人物随口谈到游戏、领地、修仙和星际电影，但本书仍是现代关系故事。'
    }));

    expect(profile.profileKey).toBe('romance+urban');
    expect(profile.required).not.toEqual(expect.arrayContaining([
      'game-panel', 'territory', 'power-source', 'technology-boundary'
    ]));
  });

  it('融合题材合并类型依赖，只有历史脑洞才把偏离点列为必须', () => {
    const profile = resolveSettingOutlineProfile(blueprint({
      channel: 'male',
      categoryKey: 'male-game-sports',
      mainTags: ['游戏', '竞技'],
      auxiliaryTags: ['游戏异界', '历史脑洞'],
      storyDirection: '主角进入历史游戏世界，以竞技战队身份影响既有历史。'
    }));

    expect(profile.profileKey).toContain('game');
    expect(profile.profileKey).toContain('history');
    expect(profile.required).toEqual([
      'story-kernel', 'world-stage', 'protagonist-situation', 'opposition', 'rules-costs', 'boundaries-blanks'
    ]);
    expect(profile.recommended).toEqual(expect.arrayContaining([
      'game-entry', 'game-panel', 'history-baseline', 'divergence'
    ]));
    expect(profile.required).not.toContain('politics-military');
    expect(profile.recommended).toContain('politics-military');
  });

  it.each([
    ['玄幻修真', 'male-fantasy-brain', ['玄幻'], '少年发现灵脉复苏并踏上修炼之路。', ['power-source', 'levels', 'costs'], ['game-panel', 'territory']],
    ['领主经营', 'male-urban-farming', ['领主', '基建'], '主角经营边境领地，在资源约束下建设城镇。', ['territory', 'population', 'yield'], ['game-panel', 'case-rules']],
    ['悬疑调查', 'male-suspense-brain', ['悬疑', '推理'], '刑警调查一宗密室案件并逐层验证证据。', ['case-rules', 'evidence-chain', 'truth-layers'], ['levels', 'territory']],
    ['科幻未来', 'male-scifi-apocalypse', ['科幻', '末世'], '幸存者依靠受限能源科技穿越灾变后的城市。', ['technology-boundary', 'science-cost'], ['relationship-premise', 'army']]
  ] as const)('%s分类只启用自己的关键设定', (_label, categoryKey, mainTags, storyDirection, expected, excluded) => {
    const profile = resolveSettingOutlineProfile(blueprint({
      channel: 'male',
      categoryKey,
      mainTags: [...mainTags],
      auxiliaryTags: [],
      storyTraits: [],
      storyDirection
    }));

    expect(profile.required).toEqual([
      'story-kernel', 'world-stage', 'protagonist-situation', 'opposition', 'rules-costs', 'boundaries-blanks'
    ]);
    expect(profile.recommended).toEqual(expect.arrayContaining([...expected]));
    expect(profile.recommended).not.toEqual(expect.arrayContaining([...excluded]));
  });

  it('拒绝把成员争论和待老板裁定文本伪装成可确认设定', () => {
    expect(parseSettingOutlineDeposit(
      '设定大纲落库 {"items":[{"itemKey":"geography","content":"待老板裁定：婉儿与红玉仍有分歧"}]}'
    )).toEqual([]);
  });

  it('接受单一结构化回复对象内的设定落库产物', () => {
    expect(parseSettingOutlineDeposit(JSON.stringify({
      answer: '本批设定可以确认。',
      keyPoints: [],
      alternatives: [],
      risks: [],
      questions: [],
      nextStep: null,
      details: null,
      workflowArtifact: {
        type: 'setting_outline',
        payload: {
          items: [{ itemKey: 'world-entry', content: '玩家通过官方终端进入竞技世界，退出不会丢失已结算收入。' }]
        }
      }
    }))).toEqual([
      { itemKey: 'world-entry', content: '玩家通过官方终端进入竞技世界，退出不会丢失已结算收入。' }
    ]);
  });

  it('作者可见文案引号未转义时仍只恢复严格校验的设定工作流产物', () => {
    const malformedEnvelope = '{"answer":"这个设定符合已确认的"公平线索"原则",'
      + '"workflowArtifact":{"type":"setting_outline","payload":{"items":['
      + '{"itemKey":"era","content":"故事发生在当代架空沿海城市雾江，现实程序与城市治理规则保持可核验。"}'
      + ']}}}';

    expect(parseSettingOutlineDeposit(malformedEnvelope)).toEqual([
      { itemKey: 'era', content: '故事发生在当代架空沿海城市雾江，现实程序与城市治理规则保持可核验。' }
    ]);
  });

  it('设定候选内容自身含未转义中文引号时仍恢复严格工作流产物', () => {
    const malformedArtifact = '{"answer":"候选可确认",'
      + '"workflowArtifact":{"type":"setting_outline","payload":{"items":['
      + '{"itemKey":"relationship-premise","content":"两人都重视事实，但对"公开真相的时机"看法不同；吸引力来自能力互补。"}'
      + ']}}}';

    expect(parseSettingOutlineDeposit(malformedArtifact)).toEqual([
      { itemKey: 'relationship-premise', content: '两人都重视事实，但对"公开真相的时机"看法不同；吸引力来自能力互补。' }
    ]);
  });

  it('持久化模板状态与作者自定义项，并按书隔离', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '第一本书', text: '游戏异界' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '第二本书', text: '历史脑洞' });
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    const firstScope = { ownerId: context.config.ownerId, bookId: first.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: second.bookId };

    service.save(firstScope, {
      itemKey: 'world-entry',
      groupTitle: '游戏与领主扩展',
      label: '游戏世界接入方式',
      prompt: '确定接入方式、边界与代价。',
      sourceLabel: '游戏题材扩展',
      status: '讨论中',
      sortOrder: 12
    });
    service.save(firstScope, {
      itemKey: 'custom-dream-tax',
      groupTitle: '本书扩展',
      label: '梦境税',
      prompt: '定义征收主体、代价和冲突。',
      sourceLabel: '作者自定义',
      status: '待讨论',
      custom: true,
      sortOrder: 99
    });

    expect(service.list(firstScope)).toMatchObject([
      { itemKey: 'world-entry', status: '讨论中', custom: false },
      { itemKey: 'custom-dream-tax', status: '待讨论', custom: true }
    ]);
    expect(service.list(secondScope)).toEqual([]);
  });

  it('拒绝非法状态且不留下半条记录', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '校验书', text: '玄幻' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);

    expect(() => service.save(scope, {
      itemKey: 'world',
      groupTitle: '世界与环境',
      label: '世界规则',
      prompt: '确定世界规则。',
      sourceLabel: '通用模板',
      status: '已自动写入正史'
    })).toThrow('设定项状态无效');
    expect(service.list(scope)).toEqual([]);
  });

  it('把设定专项讨论结论保存为候选，并只在老板确认后标记为已确认', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '讨论落库', text: '游戏异界' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    service.save(scope, {
      itemKey: 'era',
      groupTitle: '世界与环境',
      label: '时代与世界类型',
      prompt: '确定现实、架空或多世界如何并存。',
      sourceLabel: '通用',
      status: '讨论中',
      sortOrder: 1
    });

    const candidate = service.recordDiscussionCandidate(scope, {
      discussionId: 'discussion-1',
      decisionId: 'decision-1',
      scopeText: [
        '【设定专项讨论资料包】',
        '当前板块：世界与环境',
        '当前设定项：时代与世界类型',
        '设定项编号：era'
      ].join('\n'),
      content: '采用近未来现实为锚、游戏异界为主要舞台；游戏收益可兑换现实货币，但跨界存在明确代价。'
    });
    expect(candidate).toMatchObject({
      itemKey: 'era',
      status: '候选待确认',
      content: expect.stringContaining('近未来现实'),
      sourceDiscussionId: 'discussion-1',
      sourceDecisionId: 'decision-1'
    });

    const confirmed = service.confirmDiscussionCandidate(scope, 'discussion-1', 'decision-1');
    expect(confirmed).toMatchObject({
      itemKey: 'era',
      status: '已确认',
      confirmedAt: expect.any(String)
    });
  });

  it('把一次成组讨论的结构化结论分别写回多项设定，并一次确认整组', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '成组设定', text: '游戏经营' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    service.initialize(scope, [
      {
        itemKey: 'power-source',
        groupTitle: '力量与成长',
        label: '力量来源',
        prompt: '力量从哪里来？',
        sourceLabel: '通用',
        sortOrder: 1
      },
      {
        itemKey: 'levels',
        groupTitle: '力量与成长',
        label: '等级与晋升',
        prompt: '怎样升级？',
        sourceLabel: '通用',
        sortOrder: 2
      }
    ]);

    const candidates = service.recordDiscussionCandidates(scope, {
      discussionId: 'discussion-batch',
      decisionId: 'decision-batch',
      scopeText: [
        '【设定大纲成组讨论资料包】',
        '本批设定项JSON：[{"itemKey":"power-source"},{"itemKey":"levels"}]'
      ].join('\n'),
      content: [
        '{"answer":"采用比赛结算成长。","keyPoints":[],"alternatives":[],"risks":[],"questions":[],"nextStep":null,"details":null}',
        '设定大纲落库 {"items":[{"itemKey":"power-source","content":"力量来自官方竞技结算形成的数据权限，不能私下复制。"},{"itemKey":"levels","content":"等级由比赛积分和公开晋级赛共同决定，失败会掉段但不会清空技能。"}]}'
      ].join('\n')
    });

    expect(candidates).toMatchObject([
      { itemKey: 'power-source', status: '候选待确认', content: expect.stringContaining('竞技结算') },
      { itemKey: 'levels', status: '候选待确认', content: expect.stringContaining('公开晋级赛') }
    ]);
    expect(service.confirmDiscussionCandidates(scope, 'discussion-batch', 'decision-batch')).toMatchObject([
      { itemKey: 'power-source', status: '已确认' },
      { itemKey: 'levels', status: '已确认' }
    ]);
  });

  it('初始化模板不覆盖已经讨论或确认的设定状态', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '幂等模板', text: '游戏' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    service.initialize(scope, [{
      itemKey: 'era', groupTitle: '世界', label: '时代', prompt: '时代是什么？',
      sourceLabel: '通用', sortOrder: 1
    }]);
    service.save(scope, {
      itemKey: 'era', groupTitle: '世界', label: '时代', prompt: '时代是什么？',
      sourceLabel: '通用', status: '已确认', sortOrder: 1, content: '近未来现实与游戏异界并存。'
    });

    service.initialize(scope, [{
      itemKey: 'era', groupTitle: '被错误覆盖', label: '错误名称', prompt: '错误提示',
      sourceLabel: '错误来源', sortOrder: 99
    }]);

    expect(service.list(scope)).toMatchObject([{
      itemKey: 'era',
      groupTitle: '世界',
      label: '时代',
      status: '已确认',
      content: '近未来现实与游戏异界并存。'
    }]);
  });

  it('确认设定基线时创建包含已确认设定内容的新故事圣经版本', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const draft = new PositioningService(context.database, ids, clock).createDraft(
      { ownerId: context.config.ownerId },
      {
        title: '设定基线书',
        text: '游戏异界里的热血成长故事',
        openingBlueprint: {
          taxonomyVersion: OPENING_TAXONOMY.version,
          channel: 'male',
          categoryKey: 'male-game-sports',
          targetAudience: '',
          protagonists: [{
            role: 'male_lead',
            name: '夏炎',
            age: '二十二岁',
            background: '大学毕业生。',
            personalities: ['幽默', '重情重义']
          }],
          storyDirection: '夏炎进入游戏异界后，从一场资源危机起步，带领同伴建立领地并查清世界规则背后的真相。',
          worldBackground: '',
          openingBackground: '',
          stageOne: { start: '', development: '', end: '' },
          fullBookOutline: '',
          mainTags: ['游戏', '竞技', '成长'],
          auxiliaryTags: ['游戏异界'],
          storyTraits: ['打脸'],
          customTags: [],
          initialMap: '',
          mustFollow: ['不写多角恋']
        }
      }
    );
    const book = new BookOnboardingService(context.database, ids, clock).confirmDraft(
      { ownerId: context.config.ownerId },
      draft.draftId,
      draft.version
    );
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    const baselines = new SettingBaselineService(context.database, ids, clock);
    const required = baselines.inspect(scope).required;

    required.forEach((itemKey, index) => {
      workspace.save(scope, {
        itemKey,
        groupTitle: '设定基线',
        label: `设定项${index + 1}`,
        prompt: `确认${itemKey}。`,
        sourceLabel: '测试模板',
        status: '已确认',
        sortOrder: index,
        content: `${itemKey}的老板确认内容`
      });
    });

    const planning = context.database.prepare(`
      SELECT version FROM book_planning_states WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { version: number };
    baselines.confirm(scope, planning.version);

    const state = context.database.prepare(`
      SELECT stage, setting_baseline_version_id FROM book_planning_states
      WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { stage: string; setting_baseline_version_id: string };
    expect(state.stage).toBe('setting_ready');
    const selected = new ArtifactService(context.database, ids, clock)
      .requireVersion(scope, state.setting_baseline_version_id);
    expect(selected.status).toBe('selected');
    expect(selected.content.settingOutline).toMatchObject({
      schemaVersion: 1,
      items: expect.arrayContaining([
        expect.objectContaining({
          itemKey: required[0],
          content: `${required[0]}的老板确认内容`
        })
      ])
    });

    const item = workspace.list(scope).find((candidate) => candidate.itemKey === required[0])!;
    workspace.save(scope, {
      itemKey: item.itemKey,
      groupTitle: item.groupTitle,
      label: item.label,
      prompt: item.prompt,
      sourceLabel: item.sourceLabel,
      status: '已确认',
      sortOrder: item.sortOrder,
      content: `${required[0]}的修订确认内容`
    });
    const beforeReconfirm = context.database.prepare(`
      SELECT version FROM book_planning_states WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { version: number };
    const reconfirmed = baselines.confirm(scope, beforeReconfirm.version);
    expect(reconfirmed).toMatchObject({
      stage: 'setting_ready',
      version: beforeReconfirm.version + 1
    });
    const revisedState = context.database.prepare(`
      SELECT setting_baseline_version_id FROM book_planning_states
      WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { setting_baseline_version_id: string };
    const revised = new ArtifactService(context.database, ids, clock)
      .requireVersion(scope, revisedState.setting_baseline_version_id);
    expect(revised.content.settingOutline).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          itemKey: required[0],
          content: `${required[0]}的修订确认内容`
        })
      ])
    });
  });

  it('核心六问初始化时从旧设定预填内容，重复初始化与作者改写均不被覆盖', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '旧书预填', text: '都市言情' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    service.save(scope, {
      itemKey: 'creative-concept',
      groupTitle: '作品策划',
      label: '策划理念',
      prompt: '核心机制？',
      sourceLabel: '通用',
      status: '已确认',
      sortOrder: 10,
      content: '医疗纠纷中重建信任的职业剧。'
    });
    service.save(scope, {
      itemKey: 'must-follow',
      groupTitle: '约束、留白与未知',
      label: '必须遵守',
      prompt: '禁区？',
      sourceLabel: '通用',
      status: '候选待确认',
      sortOrder: 60,
      content: '不写多角恋。'
    });

    const coreTemplate = [
      { itemKey: 'story-kernel', groupTitle: '核心设定', label: '故事内核', prompt: '看点？', sourceLabel: '通用', sortOrder: 0 },
      { itemKey: 'opposition', groupTitle: '核心设定', label: '对立面', prompt: '对立？', sourceLabel: '通用', sortOrder: 3 },
      { itemKey: 'boundaries-blanks', groupTitle: '核心设定', label: '边界与留白', prompt: '边界？', sourceLabel: '通用', sortOrder: 5 }
    ];
    service.initialize(scope, coreTemplate);

    const kernel = service.list(scope).find((item) => item.itemKey === 'story-kernel')!;
    expect(kernel.status).toBe('待讨论');
    expect(kernel.content).toContain('预填稿');
    expect(kernel.content).toContain('原“策划理念”');
    expect(kernel.content).toContain('医疗纠纷中重建信任的职业剧。');
    expect(service.list(scope).find((item) => item.itemKey === 'opposition')!.content).toBeNull();
    expect(service.list(scope).find((item) => item.itemKey === 'boundaries-blanks')!.content).toContain('不写多角恋。');

    service.save(scope, {
      itemKey: 'story-kernel',
      groupTitle: kernel.groupTitle,
      label: kernel.label,
      prompt: kernel.prompt,
      sourceLabel: kernel.sourceLabel,
      status: '待讨论',
      sortOrder: 0,
      content: '作者自己改写的故事内核。'
    });
    service.initialize(scope, coreTemplate);
    expect(service.list(scope).find((item) => item.itemKey === 'story-kernel')!.content).toBe('作者自己改写的故事内核。');
  });

  it('每次确认都生成不可变版本，版本链按项回查且不受后续修改影响', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '版本链', text: '玄幻' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    const base = {
      groupTitle: '核心设定',
      label: '故事内核',
      prompt: '看点？',
      sourceLabel: '通用',
      sortOrder: 0
    };

    service.save(scope, { ...base, itemKey: 'story-kernel', status: '已确认', content: '第一版内核。' });
    service.save(scope, { ...base, itemKey: 'story-kernel', status: '已确认', content: '第二版内核。' });
    expect(service.listVersions(scope, 'story-kernel').map((version) => [
      version.versionNo, version.content, version.sourceKind
    ])).toEqual([
      [2, '第二版内核。', 'manual'],
      [1, '第一版内核。', 'manual']
    ]);

    service.save(scope, {
      itemKey: 'era',
      groupTitle: '世界与环境',
      label: '时代与世界类型',
      prompt: '时代？',
      sourceLabel: '通用',
      status: '讨论中',
      sortOrder: 10
    });
    service.recordDiscussionCandidate(scope, {
      discussionId: 'd-1',
      decisionId: 'dec-1',
      scopeText: ['【设定专项讨论资料包】', '当前板块：世界与环境', '当前设定项：时代与世界类型', '设定项编号：era'].join('\n'),
      content: '近未来沿海城市，现实治理规则可核验。'
    });
    service.confirmDiscussionCandidate(scope, 'd-1', 'dec-1');
    expect(service.listVersions(scope, 'era')).toMatchObject([{
      versionNo: 1,
      sourceKind: 'discussion',
      sourceDiscussionId: 'd-1',
      sourceDecisionId: 'dec-1',
      content: '近未来沿海城市，现实治理规则可核验。'
    }]);

    service.save(scope, {
      itemKey: 'world-stage',
      groupTitle: '核心设定',
      label: '世界舞台',
      prompt: '舞台？',
      sourceLabel: '通用',
      status: '讨论中',
      sortOrder: 1
    });
    service.recordGuidanceCandidate(scope, 'world-stage', '都市与近海科技带并存的世界。');
    service.confirmGuidanceCandidate(scope, 'world-stage');
    expect(service.listVersions(scope, 'world-stage')).toMatchObject([{
      versionNo: 1,
      sourceKind: 'guidance',
      content: '都市与近海科技带并存的世界。'
    }]);

    expect(service.listVersions(scope, 'story-kernel')).toHaveLength(2);
    expect(service.listVersions(scope, 'opposition')).toEqual([]);
  });
});
