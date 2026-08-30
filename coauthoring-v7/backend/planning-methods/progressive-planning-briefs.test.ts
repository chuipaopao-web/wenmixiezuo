import { describe, expect, it } from 'vitest';
import {
  materializePlanningRecipe,
  parseProgressivePlanningBrief,
  progressivePlanningBriefPrompt,
  validateProgressivePlanningBriefCandidates
} from './progressive-planning-briefs.js';
import { parsePlanningRouteFusion } from './planning-story-routes.js';
import type { V7PlanningMethodCandidate } from './planning-method-retrieval.js';
import type { V7PlanningStoryRoute } from './planning-story-routes.js';

describe('V7渐进式规划依据', () => {
  it('只给成员精简方法卡，并明确允许本书原创策略', () => {
    const prompt = progressivePlanningBriefPrompt({
      seatKey: 'chief_editor',
      sourceSnapshot: { formal: '张三必须是主角' },
      candidates: [candidate('causal-chain')]
    });
    expect(prompt).toContain('至少1项必须是agent_original');
    expect(prompt).toContain('不得为了用完资产');
    expect(prompt).toContain('"methodKey":"causal-chain"');
    expect(prompt).not.toContain('combinationGuidance');
    expect(prompt).not.toContain('fitSignals');
  });

  it('拒绝只有公共方法、没有作品原创策略的方案', () => {
    const value = brief();
    value.selectedStrategies = Array.from({ length: 4 }, (_, index) => ({
      source: 'library' as const,
      methodKey: 'causal-chain',
      title: `公共方法${index + 1}`,
      layer: 'book_backbone' as const,
      applicationNote: '用于当前书。',
      caution: '不要机械套用。'
    }));
    expect(() => parseProgressivePlanningBrief(JSON.stringify(value), 'chief_editor', ['causal-chain']))
      .toThrow('没有提出本书原创策略');
  });

  it('作者选中路线后才把精简依据编译成兼容执行合同，不提前展开链和章', () => {
    const parsed = parseProgressivePlanningBrief(JSON.stringify(brief()), 'chief_editor', ['causal-chain']);
    const recipe = materializePlanningRecipe({ brief: parsed, route: route(), recipeId: 'accepted-route', status: 'accepted' });
    expect(recipe.status).toBe('accepted');
    expect(recipe.root.children[0]?.children).toHaveLength(2);
    expect(recipe.root.children[0]?.children.every((volume) => volume.children.length === 0)).toBe(true);
    expect(recipe.root.methodGuidance).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'custom', customTitle: '张三选择的连锁后果' })
    ]));
  });

  it('公共方法不能被成员挪到不适用的规划层', () => {
    const parsed = parseProgressivePlanningBrief(JSON.stringify(brief()), 'chief_editor', ['causal-chain']);
    const wrongLayerCandidate = { ...candidate('causal-chain'), planningLayers: ['volume_distribution'] as const };
    expect(() => validateProgressivePlanningBriefCandidates(parsed, [wrongLayerCandidate]))
      .toThrow('不能用于全书主骨架层');
  });

  it('兼容主编把首卷重点写成分号分隔文本或漏写嵌套路由schema，不再整案换人重做', () => {
    const nestedRoute = { ...route(), firstVolumeFocus: '开篇刑场求生；雪灾中证明救援价值；卷末拿到第一条冤案实证' } as unknown as Record<string, unknown>;
    delete nestedRoute.schema;
    const parsed = parsePlanningRouteFusion(JSON.stringify({
      schema: 'v7-planning-route-fusion-v2',
      publicSummary: '保留原设计，只整理结构。',
      brief: brief(),
      route: nestedRoute,
      adoptedParts: [],
      discardedRisks: [],
      missingCriticalInputs: []
    }), [], ['causal-chain'], 'chief_editor');
    expect(parsed.route.schema).toBe('v7-planning-story-route-v1');
    expect(parsed.route.firstVolumeFocus).toEqual(['开篇刑场求生', '雪灾中证明救援价值', '卷末拿到第一条冤案实证']);
  });
});

function candidate(methodKey: string): V7PlanningMethodCandidate {
  return {
    methodKey,
    professionalName: '因果链',
    publicExplanation: '让下一步由上一步结果触发。',
    dimension: 'causal_dynamics',
    kind: 'foundation',
    recommendationTier: 'default',
    exclusiveGroup: null,
    planningLayers: ['book_backbone'],
    recommendedScale: ['全书'],
    fitSignals: ['因果'],
    cautionSignals: ['不要依赖巧合'],
    responsibilities: ['确保结果触发下一步'],
    combinationGuidance: '可与人物弧线组合。'
  };
}

function brief() {
  return {
    schema: 'v7-progressive-planning-brief-v2' as const,
    seatKey: 'chief_editor' as const,
    publicSummary: '张三从乱世底层逐卷建立新秩序。',
    centralPromise: '张三靠自己的选择改变时代。',
    causalSpine: '每次胜利扩大责任并触发下一阶段。',
    protagonistArc: '从求生者成长为建立者。',
    longFormCapacity: '个人、团队、地方和天下逐层扩大。',
    pressureRhythm: '压力逐层扩大，中段改变旧办法。',
    payoffCadence: '每卷兑现一次不可逆变化。',
    informationRhythm: '随主角视野逐步展开。',
    distinctiveness: '现代判断必须在历史条件下付出代价。',
    selectedStrategies: [
      { source: 'library' as const, methodKey: 'causal-chain', title: '因果链', layer: 'book_backbone' as const, applicationNote: '只组织长期因果。', caution: '不用巧合推进。' },
      { source: 'agent_original' as const, title: '张三选择的连锁后果', layer: 'book_backbone' as const, applicationNote: '每次扩张都来自张三的选择。', caution: '历史名人不能替主角决定。' },
      { source: 'agent_original' as const, title: '胜利改变问题性质', layer: 'volume_distribution' as const, applicationNote: '每卷解决一种问题并打开不同问题。', caution: '不能只换强敌。' },
      { source: 'agent_original' as const, title: '关系与权力同步变化', layer: 'volume_distribution' as const, applicationNote: '关系变化必须影响实际格局。', caution: '不能只做情感装饰。' }
    ],
    creativeOpenings: ['具体历史节点进入该卷时再定', '配角行动由卷内局势决定'],
    strengths: ['主角中心明确'],
    risks: ['避免中段重复扩张'],
    authorDecisions: []
  };
}

function route(): V7PlanningStoryRoute {
  return {
    schema: 'v7-planning-story-route-v1',
    routeTitle: '小卒到新秩序',
    oneLinePromise: '张三从小卒一步步改变北宋。',
    publicSummary: '两卷测试路线。',
    readingExperience: '逐卷扩大但每卷矛盾不同。',
    protagonistJourney: '张三从求生者成为建立者。',
    targetWords: 200_000,
    targetVolumes: 2,
    commercialAudience: '喜欢小人物逆袭和历史因果的连载读者。',
    retentionPositioning: '每卷兑现一次身份跃迁，同时打开更大的历史难题。',
    volumeRoadmap: [1, 2].map((order) => ({
      order,
      title: `第${order}卷`,
      direction: `完成第${order}阶段变化。`,
      protagonistChange: `张三承担第${order}层责任。`,
      mainPressure: `第${order}层压力。`,
      readerPayoff: `第${order}次明确回报。`,
      targetWords: 100_000,
      handoff: order === 1 ? '结果触发第二卷。' : '兑现全书方向。'
    })),
    firstVolumeFocus: ['开篇行动', '首次回报'],
    sellingPoints: ['人物主动选择', '历史因果'],
    risks: ['不让历史名人抢主角'],
    openQuestions: []
  };
}
