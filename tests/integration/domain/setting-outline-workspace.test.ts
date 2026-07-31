import { afterEach, describe, expect, it } from 'vitest';
import {
  parseSettingOutlineDeposit,
  SettingOutlineWorkspaceService
} from '../../../apps/api/src/application/knowledge/setting-outline-workspace-service.js';
import { SettingBaselineService } from '../../../apps/api/src/application/knowledge/setting-baseline-service.js';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import { BookOnboardingService } from '../../../apps/api/src/application/books/book-onboarding-service.js';
import { OPENING_TAXONOMY } from '../../../apps/api/src/contracts/opening-blueprint.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('设定大纲工作状态', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

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
          storyTraits: ['热血'],
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
});
