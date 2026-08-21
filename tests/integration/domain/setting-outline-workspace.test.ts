import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { SettingQualityReportRepository } from '../../../apps/api/src/infrastructure/db/repositories/setting-quality-report-repository.js';
import { hashConfirmedSettings, hashSettingItemContent } from '../../../apps/api/src/application/knowledge/setting-quality-shared.js';
import {
  parseSettingOutlineDeposit,
  SettingOutlineWorkspaceService
} from '../../../apps/api/src/application/knowledge/setting-outline-workspace-service.js';
import { SettingBaselineService } from '../../../apps/api/src/application/knowledge/setting-baseline-service.js';
import { isMacroSettingItem, resolveSettingOutlineProfile } from '../../../apps/api/src/application/knowledge/setting-outline-profile.js';
import { compileTemporarySettingContextPack } from '../../../apps/api/src/application/knowledge/setting-guidance-service.js';
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

/** 直接落一份覆盖当前已确认内容的质检报告，供定稿门禁测试使用。 */
let seedQualityReportSeq = 0;
function seedFreshQualityReport(
  context: TestContext,
  scope: { ownerId: string; bookId: string },
  clock: FixedClock,
  issues: Array<{ id: string; severity: 'hard' | 'soft'; itemKey: string; problem: string; suggestion: string }>
): void {
  const workspace = new SettingOutlineWorkspaceService(context.database, clock);
  const confirmed = workspace.list(scope).filter((item) => isMacroSettingItem(item) && item.status === '已确认' && item.content !== null);
  seedQualityReportSeq += 1;
  new SettingQualityReportRepository(context.database).save(scope, {
    reportId: `report-${String(seedQualityReportSeq).padStart(6, '0')}`,
    taskId: null,
    contentHash: hashConfirmedSettings(confirmed),
    verdict: issues.some((issue) => issue.severity === 'hard') ? 'fail' : 'pass',
    summary: '测试质检报告',
    issues: issues.map((issue) => ({ ...issue, replacement: '', baseContentHash: '' })),
    now: clock.now().toISOString()
  });
}

describe('设定大纲工作状态', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('都市言情只激活婚恋制度和现实生活规则，四项宏观书籍骨架始终必备', () => {
    const profile = resolveSettingOutlineProfile(blueprint({}));

    expect(profile.profileKey).toContain('romance');
    expect(profile.profileKey).toContain('urban');
    expect(profile.required).toEqual([
      'world-stage', 'social-order', 'rules-costs', 'boundaries-blanks'
    ]);
    expect(profile.recommended).toEqual(expect.arrayContaining([
      'geography', 'governance', 'information',
      'intimacy-norms', 'family-structure', 'privacy-reputation', 'urban-life-system'
    ]));
    expect(profile.recommended).not.toEqual(expect.arrayContaining([
      'theme-intent', 'differentiator', 'tone-boundary', 'open', 'intentional-unknown',
      'power-source', 'levels', 'production', 'army', 'game-panel', 'ranking',
      'strength-flaw', 'supporting', 'relations', 'relationship-premise'
    ]));
  });

  it('推荐条目按主题材优先、副题材靠后排序', () => {
    // 主分类历史脑洞，副题材带游戏：历史包的条目必须排在游戏包条目之前。
    // 题材包只由分类和副题材决定；主标签是风格词，选了"悬疑"风格也不激活悬疑包。
    const profile = resolveSettingOutlineProfile(blueprint({
      channel: 'male',
      categoryKey: 'male-history-brain',
      mainTags: ['历史', '游戏', '悬疑', '推理'],
      auxiliaryTags: ['游戏异界'],
      storyTraits: [],
      storyDirection: '主角带着游戏面板穿越南宋，改写历史。'
    }));
    expect(profile.profileKey).toContain('history');
    expect(profile.profileKey).toContain('game');
    expect(profile.profileKey).not.toContain('mystery');
    const historyIndex = profile.recommended.indexOf('history-baseline');
    const gameIndex = profile.recommended.indexOf('game-entry');
    expect(historyIndex).toBeGreaterThanOrEqual(0);
    expect(gameIndex).toBeGreaterThanOrEqual(0);
    expect(historyIndex).toBeLessThan(gameIndex);
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
      'world-stage', 'social-order', 'rules-costs', 'boundaries-blanks'
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
    ['悬疑调查', 'male-suspense-brain', ['悬疑', '推理'], '刑警调查一宗密室案件并逐层验证证据。', ['case-rules', 'evidence-chain'], ['levels', 'territory']],
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
      'world-stage', 'social-order', 'rules-costs', 'boundaries-blanks'
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
      + '{"itemKey":"evidence-chain","content":"档案中对"原件"的定义必须唯一，复制件只能作为待验证线索。"}'
      + ']}}}';

    expect(parseSettingOutlineDeposit(malformedArtifact)).toEqual([
      { itemKey: 'evidence-chain', content: '档案中对"原件"的定义必须唯一，复制件只能作为待验证线索。' }
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
    seedFreshQualityReport(context, scope, clock, []);
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
    seedFreshQualityReport(context, scope, clock, []);
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

  it('宏观核心项初始化时只从旧世界规则预填，重复初始化与作者改写均不被覆盖', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '旧书预填', text: '都市言情' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    service.save(scope, {
      itemKey: 'era',
      groupTitle: '世界与环境',
      label: '时代背景',
      prompt: '什么时代？',
      sourceLabel: '通用',
      status: '已确认',
      sortOrder: 10,
      content: '近未来沿海城市，公共交通依赖潮汐能源。'
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

    service.save(scope, {
      itemKey: 'governance', groupTitle: '社会与秩序', label: '政权、法律与治理', prompt: '怎样治理？',
      sourceLabel: '通用', status: '已确认', sortOrder: 20, content: '城市议会公开预算，行业协会负责执业准入。'
    });

    const coreTemplate = [
      { itemKey: 'world-stage', groupTitle: '核心设定', label: '世界舞台', prompt: '世界？', sourceLabel: '通用', sortOrder: 0 },
      { itemKey: 'social-order', groupTitle: '核心设定', label: '社会运行与秩序', prompt: '社会怎样运行？', sourceLabel: '通用', sortOrder: 1 },
      { itemKey: 'boundaries-blanks', groupTitle: '核心设定', label: '边界与留白', prompt: '边界？', sourceLabel: '通用', sortOrder: 3 }
    ];
    service.initialize(scope, coreTemplate);

    const world = service.list(scope).find((item) => item.itemKey === 'world-stage')!;
    expect(world.status).toBe('待讨论');
    expect(world.content).toContain('预填稿');
    expect(world.content).toContain('原“时代背景”');
    expect(world.content).toContain('近未来沿海城市，公共交通依赖潮汐能源。');
    expect(service.list(scope).find((item) => item.itemKey === 'social-order')!.content)
      .toContain('城市议会公开预算，行业协会负责执业准入。');
    expect(service.list(scope).find((item) => item.itemKey === 'boundaries-blanks')!.content).toContain('不写多角恋。');

    service.save(scope, {
      itemKey: 'world-stage',
      groupTitle: world.groupTitle,
      label: world.label,
      prompt: world.prompt,
      sourceLabel: world.sourceLabel,
      status: '待讨论',
      sortOrder: 0,
      content: '作者自己改写的世界舞台。'
    });
    service.initialize(scope, coreTemplate);
    expect(service.list(scope).find((item) => item.itemKey === 'world-stage')!.content).toBe('作者自己改写的世界舞台。');
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

  it('已确认设定重新设计：旧定稿继续有效，作者确认新候选后才替换', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '反悔的书', text: '历史脑洞' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    service.save(scope, {
      itemKey: 'story-kernel',
      groupTitle: '核心设定',
      label: '故事内核',
      prompt: '这个故事在讲什么',
      sourceLabel: '核心模板',
      status: '已确认',
      content: '旧定稿内核。'
    });

    // 重新设计出的候选只挂在待定区：状态仍是已确认，正式内容不变，下游继续读旧定稿。
    const withPending = service.recordGuidanceCandidate(scope, 'story-kernel', '新候选内核。');
    expect(withPending.status).toBe('已确认');
    expect(withPending.content).toBe('旧定稿内核。');
    expect(withPending.pendingCandidate).toBe('新候选内核。');

    // 作者确认后新候选才替换正式内容，旧稿留在版本历史里。
    const confirmed = service.confirmGuidanceCandidate(scope, 'story-kernel');
    expect(confirmed.status).toBe('已确认');
    expect(confirmed.content).toBe('新候选内核。');
    expect(confirmed.pendingCandidate).toBeNull();
    expect(service.listVersions(scope, 'story-kernel').map((version) => version.content))
      .toEqual(['新候选内核。', '旧定稿内核。']);

    // 再挂一轮候选后作者手动确认其他内容：待定候选作废。
    service.recordGuidanceCandidate(scope, 'story-kernel', '第二轮候选。');
    const saved = service.save(scope, {
      itemKey: 'story-kernel',
      groupTitle: '核心设定',
      label: '故事内核',
      prompt: '这个故事在讲什么',
      sourceLabel: '核心模板',
      status: '已确认',
      content: '作者手写定稿。'
    });
    expect(saved.pendingCandidate).toBeNull();
    expect(saved.content).toBe('作者手写定稿。');
  });

  it('确认四项核心后投影事实、方向、边界和留白片段，重设计确认前旧片段继续有效',()=>{
    context=createTestContext();const ids=new SequenceIds(),clock=new FixedClock();
    const book=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'设定片段书',text:'天空城冒险'});
    const scope={ownerId:context.config.ownerId,bookId:book.bookId};
    const service=new SettingOutlineWorkspaceService(context.database,clock);
    const save=(itemKey:string,label:string,content:string)=>service.save(scope,{itemKey,groupTitle:'核心设定',label,
      prompt:'确认本项书籍骨架',sourceLabel:'四项核心',status:'已确认',content});
    save('world-stage','世界舞台','人类生活在风暴带上方的天空城。');
    save('social-order','社会运行与秩序','天空城按维修工时分配居住层级，议事会负责公开裁决争议。');
    save('rules-costs','规矩与代价','每次驱动古代引擎必须失去一段近期记忆。');
    save('boundaries-blanks','边界与留白','禁止用复活抹去死亡后果。神墓真相暂不解释，作为留白。');
    const rows=context.database.prepare(`SELECT kind,strength,truth_status,scope_type,scope_id,statement,
      source_version_id,status FROM setting_clauses WHERE owner_id=? AND book_id=? ORDER BY setting_clause_id`)
      .all(scope.ownerId,scope.bookId) as unknown as Array<Record<string,unknown>>;
    expect(new Set(rows.map(row=>row.kind))).toEqual(new Set(['fact','boundary','blank']));
    expect(rows.every(row=>row.truth_status==='confirmed'&&row.scope_type==='book'&&row.scope_id===book.bookId)).toBe(true);
    expect(rows.find(row=>String(row.statement).includes('暂不解释'))).toMatchObject({kind:'blank',strength:'open_space'});
    expect(rows.find(row=>String(row.statement).includes('必须失去'))).toMatchObject({kind:'boundary',strength:'hard_fact'});
    service.recordGuidanceCandidate(scope,'world-stage','地表仍有少数移动城邦，但天空城居民不知道。');
    expect(context.database.prepare(`SELECT statement FROM setting_clauses WHERE owner_id=? AND book_id=?
      AND status='active' AND source_version_id LIKE 'setting-item:world-stage:%'`).all(scope.ownerId,scope.bookId))
      .toEqual([{statement:'人类生活在风暴带上方的天空城。'}]);
    service.confirmGuidanceCandidate(scope,'world-stage');
    expect(context.database.prepare(`SELECT statement,status FROM setting_clauses WHERE owner_id=? AND book_id=?
      AND source_version_id LIKE 'setting-item:world-stage:%' ORDER BY source_version_id`).all(scope.ownerId,scope.bookId))
      .toEqual([{statement:'人类生活在风暴带上方的天空城。',status:'superseded'},
        {statement:'地表仍有少数移动城邦，但天空城居民不知道。',status:'active'}]);
  });
  it('单项移除只清除活动内容和检索片段，历史版本与其他书保持不变', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '移除旧设定', text: '都市' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '另一书', text: '历史' });
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    const firstScope = { ownerId: context.config.ownerId, bookId: first.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: second.bookId };
    const input = {
      itemKey: 'opposition', groupTitle: '早期条目', label: '对立面', prompt: '旧版内容',
      sourceLabel: '旧版', status: '已确认' as const, content: '旧版对立方向。'
    };
    service.save(firstScope, input);
    service.save(secondScope, { ...input, content: '另一书的旧版对立方向。' });
    service.recordGuidanceCandidate(firstScope, 'opposition', '尚未确认的新候选。');

    const beforePack = compileTemporarySettingContextPack(service.list(firstScope), 'rules-costs');
    expect(beforePack.items.map((item) => item.itemKey)).not.toContain('opposition');
    const versionsBefore = service.listVersions(firstScope, 'opposition');

    const removed = service.removeCurrent(firstScope, 'opposition');
    expect(removed).toMatchObject({ status: '待讨论', content: null, pendingCandidate: null, confirmedAt: null });
    expect(service.listVersions(firstScope, 'opposition')).toEqual(versionsBefore);
    expect(service.list(secondScope).find((item) => item.itemKey === 'opposition')?.content)
      .toBe('另一书的旧版对立方向。');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM setting_clauses
      WHERE owner_id = ? AND book_id = ? AND source_version_id LIKE 'setting-item:opposition:%' AND status = 'active'`)
      .get(firstScope.ownerId, firstScope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM setting_clauses
      WHERE owner_id = ? AND book_id = ? AND source_version_id LIKE 'setting-item:opposition:%' AND status = 'archived'`)
      .get(firstScope.ownerId, firstScope.bookId)).toEqual({ count: 1 });
  });

  it('单项移除接口使当前设定基线重新待审，不存在条目返回404', async () => {
    context = createTestContext();
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '接口移除书', text: '都市' });
      const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
      const service = new SettingOutlineWorkspaceService(context.database, clock);
      service.save(scope, {
        itemKey: 'opposition', groupTitle: '早期条目', label: '对立面', prompt: '旧版内容',
        sourceLabel: '旧版', status: '已确认', content: '需要移除的旧内容。'
      });
      context.database.prepare(`UPDATE book_planning_states
        SET stage = 'setting_ready', setting_baseline_version_id = 'old-baseline'
        WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/books/${book.bookId}/setting-outline-workspace/opposition/current`
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().data).toMatchObject({ itemKey: 'opposition', status: '待讨论', content: null });
      expect(context.database.prepare(`SELECT stage, setting_baseline_version_id FROM book_planning_states
        WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId))
        .toEqual({ stage: 'setting_in_progress', setting_baseline_version_id: null });
      expect(service.listVersions(scope, 'opposition')).toHaveLength(1);

      const missing = await app.inject({
        method: 'DELETE',
        url: `/api/v1/books/${book.bookId}/setting-outline-workspace/missing-item/current`
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('清空全部设定：内容归零、基线作废、版本历史保留', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '清空的书', text: '历史脑洞' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    service.save(scope, {
      itemKey: 'story-kernel', groupTitle: '核心设定', label: '故事内核',
      prompt: '这个故事在讲什么', sourceLabel: '核心模板', status: '已确认', content: '旧定稿内核。'
    });
    service.recordGuidanceCandidate(scope, 'story-kernel', '待定候选。');
    // 模拟这本书已确认过设定基线。
    context.database.prepare(`UPDATE book_planning_states SET stage = 'setting_ready', setting_baseline_version_id = 'fake-baseline'
      WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);

    const result = new SettingBaselineService(context.database, ids, clock).clear(scope);
    expect(result.clearedItems).toBeGreaterThan(0);
    expect(result.hasCanonChapters).toBe(false);
    const item = service.list(scope).find((row) => row.itemKey === 'story-kernel')!;
    expect(item).toMatchObject({ status: '待讨论', content: null, pendingCandidate: null, confirmedAt: null });
    expect(service.listVersions(scope, 'story-kernel').map((version) => version.content)).toContain('旧定稿内核。');
    expect(context.database.prepare(`SELECT stage, setting_baseline_version_id FROM book_planning_states
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId))
      .toEqual({ stage: 'setting_in_progress', setting_baseline_version_id: null });
  });

  it('清空接口必须输入 YES，否则拒绝', async () => {
    context = createTestContext();
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), { title: '清空门禁书', text: '都市' });
      const url = `/api/v1/books/${book.bookId}/setting-outline-workspace/clear`;
      const refused = await app.inject({ method: 'POST', url, payload: { confirmText: '确定' } });
      expect(refused.statusCode).toBe(409);
      const accepted = await app.inject({ method: 'POST', url, payload: { confirmText: 'YES' } });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().data).toMatchObject({ hasCanonChapters: false });
    } finally {
      await app.close();
    }
  });

  it('定稿门禁：无质检报告、报告过期或硬伤未确认时拒绝确认整份设定', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const draft = new PositioningService(context.database, ids, clock).createDraft(
      { ownerId: context.config.ownerId },
      { title: '门禁书', text: '都市', openingBlueprint: blueprint({ auxiliaryTags: [], storyTraits: [] }) }
    );
    const book = new BookOnboardingService(context.database, ids, clock).confirmDraft(
      { ownerId: context.config.ownerId }, draft.draftId, draft.version
    );
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    const baselines = new SettingBaselineService(context.database, ids, clock);
    const required = baselines.inspect(scope).required;
    required.forEach((itemKey, index) => {
      workspace.save(scope, {
        itemKey, groupTitle: '设定基线', label: `设定项${index + 1}`, prompt: '确认。',
        sourceLabel: '测试模板', status: '已确认', sortOrder: index, content: `${itemKey}的内容`
      });
    });
    const planningVersion = (): number => (context!.database.prepare(`
      SELECT version FROM book_planning_states WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { version: number }).version;

    // 没有质检报告：拒绝。
    expect(() => baselines.confirm(scope, planningVersion()))
      .toThrowError(expect.objectContaining({ code: 'SETTING_QUALITY_AUDIT_REQUIRED' }) as unknown as Error);

    // 质检后又改了内容：指纹不匹配，旧报告作废。
    seedFreshQualityReport(context, scope, clock, []);
    workspace.save(scope, {
      itemKey: required[0]!, groupTitle: '设定基线', label: '设定项1', prompt: '确认。',
      sourceLabel: '测试模板', status: '已确认', content: '质检后又改过的内容'
    });
    expect(() => baselines.confirm(scope, planningVersion()))
      .toThrowError(expect.objectContaining({ code: 'SETTING_QUALITY_AUDIT_REQUIRED' }) as unknown as Error);

    // 有硬伤但未逐项确认“仍要保留”：拒绝。
    seedFreshQualityReport(context, scope, clock, [
      { id: 'h1', severity: 'hard', itemKey: 'whole', problem: '设定整体跑题', suggestion: '回到开书方向重做' }
    ]);
    expect(() => baselines.confirm(scope, planningVersion()))
      .toThrowError(expect.objectContaining({ code: 'SETTING_QUALITY_ISSUES_UNACKNOWLEDGED' }) as unknown as Error);

    // 逐项确认后放行。
    const confirmed = baselines.confirm(scope, planningVersion(), ['h1']);
    expect(confirmed.stage).toBe('setting_ready');
  });

  it('采纳主编修改会创建新版本，保留原文并拒绝重复套用旧建议', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const draft = new PositioningService(context.database, ids, clock).createDraft(
      { ownerId: context.config.ownerId },
      { title: '主编修改版本书', text: '都市', openingBlueprint: blueprint({ auxiliaryTags: [], storyTraits: [] }) }
    );
    const book = new BookOnboardingService(context.database, ids, clock).confirmDraft(
      { ownerId: context.config.ownerId }, draft.draftId, draft.version
    );
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const workspace = new SettingOutlineWorkspaceService(context.database, clock);
    const baselines = new SettingBaselineService(context.database, ids, clock);
    const itemKey = baselines.inspect(scope).required[0]!;
    const current = workspace.list(scope).find((item) => item.itemKey === itemKey)!;
    workspace.save(scope, {
      itemKey, groupTitle: current.groupTitle, label: current.label, prompt: current.prompt,
      sourceLabel: current.sourceLabel, status: '已确认', sortOrder: current.sortOrder, content: '作者确认的原始设定。'
    });
    const original = workspace.list(scope).find((item) => item.itemKey === itemKey)!;
    const replacement = '主编修订后的完整设定，补齐了边界、代价和可执行规则。';
    new SettingQualityReportRepository(context.database).save(scope, {
      reportId: 'chief-revision-report',
      taskId: null,
      contentHash: hashConfirmedSettings(workspace.list(scope).filter((item) => item.status === '已确认' && item.content !== null)),
      verdict: 'warn',
      summary: '需要补齐一项',
      issues: [{ id: 'revise-one', severity: 'soft', itemKey, problem: '原设定过于空泛', suggestion: '补齐边界与代价', replacement, baseContentHash: hashSettingItemContent(original.content!) }],
      now: clock.now().toISOString()
    });
    const beforeVersions = workspace.listVersions(scope, itemKey);
    expect(baselines.qualityReport(scope).report?.issues[0]?.applicable).toBe(true);
    const applied = baselines.applyQualitySuggestion(scope, 'chief-revision-report', 'revise-one');
    expect(applied.content).toBe(replacement);
    const versions = workspace.listVersions(scope, itemKey);
    expect(versions.map((version) => version.content)).toEqual(expect.arrayContaining(['作者确认的原始设定。', replacement]));
    expect(versions).toHaveLength(beforeVersions.length + 1);
    const afterReport = baselines.qualityReport(scope);
    expect(afterReport.fresh).toBe(false);
    expect(afterReport.report?.issues[0]?.applicable).toBe(false);
    expect(() => baselines.applyQualitySuggestion(scope, 'chief-revision-report', 'revise-one'))
      .toThrowError(expect.objectContaining({ code: 'BOOK_VERSION_CONFLICT' }) as unknown as Error);
});
});
