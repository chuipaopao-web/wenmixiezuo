import { describe, expect, it } from 'vitest';
import {
  parsePlanningRouteFusion,
  planningDirectStoryRoutePrompt,
  planningDirectStoryRouteRepairPrompt,
  type V7PlanningMethodCandidate
} from '@wenmi/v7-backend';

describe('V7全书路线输出合同', () => {
  it('无损兼容漏写嵌套路由schema和分号文本，并给原成员提供定向修复合同', () => {
    const candidate = methodCandidate();
    const parsed = parsePlanningRouteFusion(JSON.stringify({
      schema: 'v7-planning-route-fusion-v2',
      publicSummary: '保留原设计，只整理结构。',
      brief: brief(),
      route: {
        routeTitle: '雪线求生', oneLinePromise: '死囚驿卒靠判断和组织救下一城。', publicSummary: '六卷递进。',
        readingExperience: '持续高压并逐卷兑现。', protagonistJourney: '从求生者成长为北境骨干。',
        targetWords: 120_000, targetVolumes: 2, commercialAudience: '番茄男频历史求生读者。',
        retentionPositioning: '每卷解决一层冤案并承担更大责任。',
        volumeRoadmap: [1, 2].map((order) => ({
          order, title: `第${order}卷`, direction: '推进求生与翻案。', protagonistChange: '承担更大责任。',
          mainPressure: '雪灾与粮道危机。', readerPayoff: '获得一次不可逆的新位置。', targetWords: 60_000,
          handoff: order === 1 ? '线索引出更深一层幕后。' : '兑现守城与翻案。'
        })),
        firstVolumeFocus: '开篇刑场求生；雪灾中证明救援价值；卷末拿到第一条冤案实证',
        sellingPoints: ['无系统求生', '规则内翻案'], risks: ['避免程序细节拖慢节奏'], openQuestions: []
      },
      adoptedParts: [], discardedRisks: [], missingCriticalInputs: []
    }), [], [candidate.methodKey], 'chief_editor');

    expect(parsed.route.schema).toBe('v7-planning-story-route-v1');
    expect(parsed.route.firstVolumeFocus).toEqual(['开篇刑场求生', '雪灾中证明救援价值', '卷末拿到第一条冤案实证']);
    expect(planningDirectStoryRoutePrompt({
      sourceSnapshot: {}, contextPlan: taskContextPlan(), seatKey: 'chief_editor', routeLabel: '全案一席', explorationOpening: '', candidates: [candidate]
    })).toContain('firstVolumeFocus必须是2—8条字符串组成的JSON数组');
    expect(planningDirectStoryRoutePrompt({
      sourceSnapshot: {}, contextPlan: taskContextPlan(), seatKey: 'chief_editor', routeLabel: '全案一席', explorationOpening: '', candidates: [candidate]
    })).toContain('完整JSON控制在6000个汉字以内');
    expect(planningDirectStoryRouteRepairPrompt({
      sourceSnapshot: {}, contextPlan: taskContextPlan(), seatKey: 'chief_editor', candidates: [candidate], invalidOutput: '{}', validationMessage: '首卷重点数量无效'
    })).toContain('不要改写方案方向');
  });

  it('只做格式归一即可接住真实模型把方向依据列表写成分隔文本的输出', () => {
    const candidate = methodCandidate();
    const parsed = parsePlanningRouteFusion(JSON.stringify({
      schema: 'v7-planning-route-fusion-v2', publicSummary: undefined,
      brief: {
        ...brief(),
        schema: undefined,
        seatKey: undefined,
        creativeOpenings: [
          '幕后身份留到卷内决定', '穿越缘由保持开放', '配角去留依据实际局势决定',
          '边城以外只保留必要接口', '终局职务到收束时确定'
        ],
        strengths: '主角中心明确；卷间因果连续；阶段回报清楚',
        risks: '避免中段重复；避免程序说明挤占行动',
        authorDecisions: '确认卷数；确认终局是否留在北境'
      },
      route: {
        routeTitle: '雪线求生', oneLinePromise: '死囚驿卒靠判断和组织救下一城。', publicSummary: '两卷递进。',
        readingExperience: '持续高压并逐卷兑现。', protagonistJourney: '从求生者成长为北境骨干。',
        targetWords: 120_000, targetVolumes: 2, commercialAudience: '番茄男频历史求生读者。',
        retentionPositioning: '每卷解决一层冤案并承担更大责任。',
        volumeRoadmap: [1, 2].map((order) => ({
          order, title: `第${order}卷`, direction: '推进求生与翻案。', protagonistChange: '承担更大责任。',
          mainPressure: '雪灾与粮道危机。', readerPayoff: '获得一次不可逆的新位置。', targetWords: 60_000,
          handoff: order === 1 ? '线索引出更深一层幕后。' : '兑现守城与翻案。'
        })),
        firstVolumeFocus: ['刑场求生', '雪灾立足'],
        sellingPoints: '无系统求生；规则内翻案', risks: '避免程序细节拖慢节奏；避免巧合解围', openQuestions: ''
      },
      adoptedParts: [], discardedRisks: [], missingCriticalInputs: []
    }), [], [candidate.methodKey], 'chief_editor');

    expect(parsed.brief.creativeOpenings).toHaveLength(5);
    expect(parsed.publicSummary).toBe(parsed.brief.publicSummary);
    expect(parsed.brief.schema).toBe('v7-progressive-planning-brief-v2');
    expect(parsed.brief.seatKey).toBe('chief_editor');
    expect(parsed.brief.strengths).toEqual(['主角中心明确', '卷间因果连续', '阶段回报清楚']);
    expect(parsed.brief.authorDecisions).toEqual(['确认卷数', '确认终局是否留在北境']);
    expect(parsed.route.sellingPoints).toEqual(['无系统求生', '规则内翻案']);
    expect(parsed.route.openQuestions).toEqual([]);
  });
});

function methodCandidate(): V7PlanningMethodCandidate {
  return {
    methodKey: 'causal-chain', professionalName: '因果链', publicExplanation: '让结果触发下一步。',
    dimension: 'causal_dynamics', kind: 'foundation', recommendationTier: 'default', exclusiveGroup: null,
    planningLayers: ['book_backbone'], recommendedScale: ['全书'], fitSignals: ['因果'], cautionSignals: ['不用巧合'],
    responsibilities: ['保持因果连续'], combinationGuidance: '可与人物弧线组合。'
  };
}

function taskContextPlan() {
  return {
    publicGoal: '为历史求生题材设计可持续的全书路线。',
    taskPersona: {
      publicLabel: '历史求生路线设计者',
      workingIdentity: '熟悉历史环境约束、连载推进和人物主动选择的全书设计者。',
      priorities: ['人物主动解决问题'],
      authenticityChecks: ['行动符合当前身份与资源'],
      avoidPatterns: ['用巧合替代因果']
    },
    taskResponsibilities: ['组织全书因果', '给每卷明确变化'],
    creativeSpace: ['可组合候选方法', '可按本书需要自主设计']
  };
}

function brief() {
  return {
    schema: 'v7-progressive-planning-brief-v2', seatKey: 'chief_editor', publicSummary: '以求生和翻案贯穿全书。',
    centralPromise: '死囚驿卒靠真实能力改变命运。', causalSpine: '每次救人都触发更深一层风险。',
    protagonistArc: '从求生者成为北境骨干。', longFormCapacity: '雪灾、粮道与冤案逐层升级。',
    pressureRhythm: '持续加压但改变冲突形态。', payoffCadence: '每卷兑现一次身份或真相变化。',
    informationRhythm: '线索随行动公平揭示。', distinctiveness: '把救援规程变成人物选择。',
    selectedStrategies: [
      { source: 'library', methodKey: 'causal-chain', title: '因果链', layer: 'book_backbone', applicationNote: '组织全书因果。', caution: '不用巧合。' },
      { source: 'agent_original', title: '救援选择留下证据', layer: 'book_backbone', applicationNote: '每次救援同时推进翻案。', caution: '不让专业知识碾压。' },
      { source: 'agent_original', title: '胜利扩大责任', layer: 'volume_distribution', applicationNote: '卷卷改变问题性质。', caution: '不只升级敌人。' },
      { source: 'agent_original', title: '代价跟随回报', layer: 'volume_distribution', applicationNote: '每次所得都带来新责任。', caution: '不写无代价胜利。' }
    ],
    creativeOpenings: ['具体幕后层级留到卷内决定', '配角选择根据实际局势展开'],
    strengths: ['主角中心明确'], risks: ['避免中段重复'], authorDecisions: []
  };
}
