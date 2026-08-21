import { describe, expect, it } from 'vitest';
import { getPublicNarrativeTemplateCatalog } from '../../apps/contracts/src/narrative-templates.js';
import { parseVolumePlanContent } from '../../apps/contracts/src/workflow.js';
import { HIDDEN_NARRATIVE_METHOD_COUNT, selectHiddenVolumeRouteRecipes } from '../../apps/api/src/application/planning/hidden-narrative-methods.js';
import { compileWriterSettingContext } from '../../apps/api/src/application/creation/writer-setting-context.js';
import { eventEmotionGuide } from '../../apps/web/src/features/planning/EventPlanningPanel.js';

function baseVolume() {
  return {
    title: '第一卷', openingState: '主角被迫离开旧生活', coreGoal: '取得进入核心冲突的资格',
    coreConflict: '个人选择与旧规则正面冲突', failureCost: '失去唯一盟友', characterChanges: ['从逃避到主动承担'],
    eventSequence: [{ eventId: 'event-1', order: 1, title: '第一次选择', responsibility: '让主角主动入局',
      entryState: '仍可退回原处', trigger: '盟友因旧规则受损', action: '主角公开挑战规则', result: '取得有限资格并暴露自己',
      leadsToNext: null, estimatedChapterRange: { minimum: 3, likely: 5, maximum: 8 } }],
    informationPlan: ['先展示规则后果，再揭示操纵者'], escalationAndRecovery: ['每次进展都带来新代价'],
    endingState: '主角站稳但无法回头', openThreads: ['操纵者身份'], nextVolumeTrigger: '更高层规则开始反制',
    boundaries: { mustAchieve: ['主角主动选择'], mustNotViolate: ['胜利不能无代价'], creativeFreedom: ['场景和对白'], openQuestions: [] },
    routeCard: { protagonistStart: '被旧规则压住', drivingMotivation: '保护盟友并证明判断', escalationPath: ['先验证规则', '公开行动', '承担反制'],
      keyChoiceAndCost: '公开身份并失去退路', climaxResolution: '用前置证据迫使规则执行者让步', endingChange: '从局外人变成被针对的参与者',
      benefits: ['主动性清楚'], risks: ['证据必须提前出现'] },
    storySpine: { longTermPromise: '看主角逐层改变不公规则', protagonistLongArc: '从自保到承担公共责任', centralQuestion: '人能否改变塑造自己的规则',
      escalationLadder: ['个人困境', '组织规则', '社会秩序'], endingDirection: null, protectedOpenSpace: ['幕后者真实动机'] },
    firstVolumeLaunch: {
      first500: { readerQuestion: '他为什么知道规则会杀人', immediateSituation: '审判正在倒计时', emotionalGrip: '他必须在恐惧中救下盟友', changePromise: '旧生活将在这次选择后结束' },
      goldenThree: [1, 2, 3].map((chapterNumber) => ({ chapterNumber, responsibility: `第${chapterNumber}章职责`, action: '主动行动', pressure: '时间与规则双重压力', payoff: '获得可见结果', nextExpectation: '结果引出下一步' })),
      majorClimax: { latestEffectiveCharacters: 100000, setup: '证据和关系逐步积累', choice: '公开站到规则对面', cost: '失去安全身份', irreversibleChange: '成为被追捕者', nextStage: '进入更大范围对抗' },
      immersionPriorities: ['贴着主角当下选择写恐惧与决心']
    }
  };
}

describe('分层叙事设计门禁', () => {
  it('内部方法库覆盖22种常用方法，但交给作者和模型的路线骨架不泄露专业名', () => {
    expect(HIDDEN_NARRATIVE_METHOD_COUNT).toBe(22);
    const [first, second] = selectHiddenVolumeRouteRecipes('仙侠 悬疑 快节奏 第一卷', true);
    expect(first.recipeKey).not.toBe(second.recipeKey);
    expect(first.methodKeys[0]).not.toBe(second.methodKeys[0]);
    const visibleScaffold = JSON.stringify([...first.scaffold, ...second.scaffold]);
    expect(visibleScaffold).not.toMatch(/三幕式|五幕式|拯救猫咪|英雄之旅|故事圈|特鲁比|麦基|悉德|弗赖塔格/iu);
    expect(first.scaffold.join('')).toContain('不得把多套完整节拍首尾拼接');
  });
  it('八种事件方法在作者界面转换为八种不重名的阅读感受', () => {
    const templates = getPublicNarrativeTemplateCatalog('event').templates;
    const labels = templates.map((template) => eventEmotionGuide(template).label);
    expect(templates).toHaveLength(8);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.join(' ')).not.toMatch(/三幕式|五幕式|拯救猫咪|英雄之旅|七点式|故事圈/iu);
  });

  it('第一卷合同强制黄金三章和十万有效字内重大高潮，同时兼容旧卷数据', () => {
    const parsed = parseVolumePlanContent(baseVolume());
    expect(parsed.firstVolumeLaunch?.goldenThree.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3]);
    expect(parsed.firstVolumeLaunch?.majorClimax.latestEffectiveCharacters).toBe(100000);
    expect(() => parseVolumePlanContent({ ...baseVolume(), firstVolumeLaunch: {
      ...baseVolume().firstVolumeLaunch,
      majorClimax: { ...baseVolume().firstVolumeLaunch.majorClimax, latestEffectiveCharacters: 100001 }
    } })).toThrow(/不得晚于累计10万有效字/u);
    const legacy = { ...baseVolume() } as Record<string, unknown>;
    delete legacy.routeCard; delete legacy.storySpine; delete legacy.firstVolumeLaunch;
    expect(parseVolumePlanContent(legacy).routeCard).toBeUndefined();
  });

  it('正文设定包始终保留四项宏观骨架，旧人物设定不再注入，只按相关性加入扩展项', () => {
    const marker = '内容末尾不可丢';
    const items = [
      ['world-stage', '世界舞台', `群岛城市。${marker}`],
      ['social-order', '社会运行与秩序', '群岛议会按维修工时分配通行权。'],
      ['protagonist-situation', '旧主角底板', '顾川是旧港修械学徒。'],
      ['rules-costs', '规则与代价', '使用浮空索会消耗寿命。'],
      ['boundaries-blanks', '边界与留白', '幕后者动机暂不确定。'],
      ['case-rules', '案件规则', '雾中凶案证据链必须可回查。'],
      ['currency', '货币规则', '港币只在三座主城通行。']
    ].map(([itemKey, label, content]) => ({ itemKey: itemKey!, label: label!, content: content! }));
    const compiled = compileWriterSettingContext(items, '本章调查雾中凶案证据链，并核对现场证据。');
    expect(compiled.hardItems.map((item) => item.itemKey)).toEqual(expect.arrayContaining([
      'world-stage', 'social-order', 'rules-costs', 'boundaries-blanks', 'case-rules'
    ]));
    expect(compiled.hardItems.find((item) => item.itemKey === 'world-stage')?.content.endsWith(marker)).toBe(true);
    expect(compiled.deferredCatalog).toContainEqual({ itemKey: 'currency', label: '货币规则' });
    expect([...compiled.hardItems, ...compiled.deferredCatalog].map((item) => item.itemKey))
      .not.toContain('protagonist-situation');
  });
});
