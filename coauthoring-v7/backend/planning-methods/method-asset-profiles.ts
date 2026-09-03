import {
  NARRATIVE_DIMENSIONS,
  V7_NARRATIVE_METHODS,
  V7_NARRATIVE_METHOD_LIBRARY_VERSION,
  type NarrativeMethodDefinition,
  type NarrativeScope
} from '../narrative-methods/narrative-method-library.js';

export const V7_LAYERED_PLANNING_VERSION = '1.1.0';

export type PlanningLayerKey =
  | 'book_backbone'
  | 'volume_distribution'
  | 'volume'
  | 'chain'
  | 'chapter_execution';

export interface PlanningLayerDefinition {
  key: PlanningLayerKey;
  publicName: string;
  shortName: string;
  responsibility: string;
  recommendedScale: string;
  requiredInputs: readonly string[];
  outputChecklist: readonly string[];
  defers: string;
}

export const PLANNING_LAYERS: readonly PlanningLayerDefinition[] = [
  {
    key: 'book_backbone',
    publicName: '全书顶层',
    shortName: '全书',
    responsibility: '确定整本书从什么状态出发，经过怎样的大变化，最终走到哪里。',
    recommendedScale: '整本长篇；通常覆盖数十万至数百万字。',
    requiredInputs: ['正式开书资料', '已确认设定', '作者硬要求与禁止项', '目标篇幅与发布方向'],
    outputChecklist: ['全书进入状态', '顶层发展阶段', '主角长期变化', '最终方向与收束边界'],
    defers: '不提前写出所有卷内情节、单元链和章节。'
  },
  {
    key: 'volume_distribution',
    publicName: '跨卷分配',
    shortName: '跨卷',
    responsibility: '把全书顶层阶段分配给各卷，说明每卷承担什么变化和怎样交接。',
    recommendedScale: '全书卷群；只给未来卷粗方向。',
    requiredInputs: ['已确认全书顶层', '预计卷数与总字数', '长期人物、势力和故事方向'],
    outputChecklist: ['卷序与篇幅建议', '每卷核心责任', '卷初与卷末状态', '相邻卷接口'],
    defers: '未来卷的内部方法和具体单元链进入该卷时再确定。'
  },
  {
    key: 'volume',
    publicName: '单卷规划',
    shortName: '单卷',
    responsibility: '完成上层交给当前卷的阶段责任，并形成可执行的单元链地图。',
    recommendedScale: '当前一卷；篇幅由本书实际规划决定。',
    requiredInputs: ['当前卷责任', '最新正式事实与人物状态', '上一卷实际结果', '作者本卷想法'],
    outputChecklist: ['卷初状态', '本卷目标与阻力', '主要变化', '单元链职责', '卷末兑现与下一卷接口'],
    defers: '只细化当前卷；未来卷仍保持粗规划。'
  },
  {
    key: 'chain',
    publicName: '单元链规划',
    shortName: '单链',
    responsibility: '用一组前后相接的章节完成一次明确推进、回报和状态变化。',
    recommendedScale: '通常约 4—8 章；特殊高潮链需要主编说明延长理由。',
    requiredInputs: ['当前卷目标', '当前链进入状态', '相关人物、故事线和伏笔', '最近正式正文结果'],
    outputChecklist: ['读者期待', '人物行动', '阻力与升级', '明确兑现', '不可逆状态变化', '下一链触发'],
    defers: '不重做全书和本卷方向，只执行当前链责任。'
  },
  {
    key: 'chapter_execution',
    publicName: '章节执行',
    shortName: '章节',
    responsibility: '把已确认单元链责任落实为本章行动、变化、回报和下一期待。',
    recommendedScale: '当前一章；只读取当前写作所需的最小资料。',
    requiredInputs: ['已确认章纲', '当前链目标', '最近正文', '本章相关正式事实与风格要求'],
    outputChecklist: ['本章即时目标', '场内行动与阻力', '本章实际变化', '必要回报', '自然的下一期待'],
    defers: '正文成员不读取整套方法库，也不自行修改上层路线。'
  }
];

export interface MethodExecutionProfile {
  methodKey: string;
  libraryVersion: string;
  professionalName: string;
  publicExplanation: string;
  planningLayers: readonly PlanningLayerKey[];
  recommendedScale: readonly string[];
  solves: string;
  requiredInputs: readonly string[];
  outputContract: readonly string[];
  combinationGuidance: string;
  creativityPolicy: readonly string[];
  risks: readonly string[];
  adminExample: string;
}

const ADMIN_EXAMPLES: Readonly<Record<string, string>> = Object.freeze({
  'four-act': '300 万字历史争霸文可以把“起、承、转、合”分配给多个大卷；它只规定全书责任，不规定每卷必须发生哪些具体事件。',
  'three-act': '可作为全书最粗的进入—对抗—解决，也可用于某一卷；是否采用由规划成员结合本书容量判断。',
  'five-act': '可用于一卷史诗起伏：上升到阶段高点后，让高点的代价继续改变后半卷，而不是机械分成五等份。',
  'eight-sequence': '第一卷可以拆成八个职责不同的推进区段，每段造成新状态；区段不是固定章数，也不要求未来卷继续使用。',
  'promise-progress-payoff': '一条单元链先建立读者期待，再连续给出有效进展，最后完成相称兑现；具体剧情由编剧自由创造。',
  'pressure-payoff-loop': '可用于“受压—准备—行动—结果”的链，但不能每次都写成同一种打脸或奖励。',
  'opening-promise': '第一卷开篇尽早让读者看见核心卖点和第一次有效结果，具体字数不由系统固定。',
  'multi-line-network': '全书可以让主角、朝堂和敌对势力多线并进，但每次切换都必须带来新信息或新后果。'
});

export const V7_METHOD_EXECUTION_PROFILES: readonly MethodExecutionProfile[] = Object.freeze(
  V7_NARRATIVE_METHODS.map(buildMethodExecutionProfile)
);

export function getMethodExecutionProfile(methodKey: string): MethodExecutionProfile | null {
  return V7_METHOD_EXECUTION_PROFILES.find((item) => item.methodKey === methodKey) ?? null;
}

export function listMethodExecutionProfiles(layer?: PlanningLayerKey): MethodExecutionProfile[] {
  return V7_METHOD_EXECUTION_PROFILES.filter((item) => layer === undefined || item.planningLayers.includes(layer));
}

export function validateMethodExecutionProfiles(): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const profile of V7_METHOD_EXECUTION_PROFILES) {
    if (keys.has(profile.methodKey)) errors.push(`方法执行档案键重复：${profile.methodKey}`);
    keys.add(profile.methodKey);
    if (profile.planningLayers.length === 0) errors.push(`${profile.methodKey} 没有可用规划层级`);
    if (profile.requiredInputs.length === 0) errors.push(`${profile.methodKey} 没有所需资料说明`);
    if (profile.outputContract.length === 0) errors.push(`${profile.methodKey} 没有标准产出`);
    if (profile.creativityPolicy.length === 0) errors.push(`${profile.methodKey} 没有创意许可`);
  }
  if (V7_METHOD_EXECUTION_PROFILES.length !== V7_NARRATIVE_METHODS.length) {
    errors.push('方法执行档案数量与叙事方法库不一致');
  }
  // 第86批：宏观节奏框架组必须在章层保持自相似覆盖，防止再次断链。
  const macroFrameworkAtChapter = V7_METHOD_EXECUTION_PROFILES.filter((profile) => {
    const method = V7_NARRATIVE_METHODS.find((item) => item.key === profile.methodKey);
    return method?.exclusiveGroup === 'macro-framework' && profile.planningLayers.includes('chapter_execution');
  });
  if (macroFrameworkAtChapter.length < 3) {
    errors.push(`宏观节奏框架组在章层覆盖不足（${macroFrameworkAtChapter.length} 条），自相似链条断裂`);
  }
  return errors;
}

function buildMethodExecutionProfile(method: NarrativeMethodDefinition): MethodExecutionProfile {
  const planningLayers = layersForScopes(method.applicableScopes);
  const definitions = planningLayers.map(requireLayer);
  const dimension = NARRATIVE_DIMENSIONS.find((item) => item.key === method.dimension);
  return Object.freeze({
    methodKey: method.key,
    libraryVersion: V7_NARRATIVE_METHOD_LIBRARY_VERSION,
    professionalName: method.professionalName,
    publicExplanation: method.publicExplanation,
    planningLayers,
    recommendedScale: unique(definitions.map((item) => item.recommendedScale)),
    solves: dimension?.responsibility ?? method.publicExplanation,
    requiredInputs: unique(definitions.flatMap((item) => item.requiredInputs)),
    outputContract: unique(method.responsibilities),
    combinationGuidance: combinationGuidance(method),
    creativityPolicy: [
      '这是软性创作参考，不是必须逐项打卡的固定模板。',
      '规划成员可以组合、移动、删减或改写对当前作品没有帮助的部分。',
      '现有资产不足时，可以提出只属于当前书的临时创新方法。',
      '偏离方法不等于失败；只有违反作者硬要求、正式事实或上层责任才需要重新确认。'
    ],
    risks: method.cautionSignals.length > 0
      ? [...method.cautionSignals]
      : ['为了结构整齐而压缩人物合理选择，容易产生模板感。'],
    adminExample: ADMIN_EXAMPLES[method.key]
      ?? `可在${definitions.map((item) => item.shortName).join('、')}层作为参考：${method.publicExplanation}`
  });
}

function layersForScopes(scopes: readonly NarrativeScope[]): PlanningLayerKey[] {
  const layers: PlanningLayerKey[] = [];
  if (scopes.includes('book')) layers.push('book_backbone', 'volume_distribution');
  if (scopes.includes('storyline') && !layers.includes('volume_distribution')) layers.push('volume_distribution');
  if (scopes.includes('volume')) layers.push('volume');
  if (scopes.includes('event')) layers.push('chain');
  if (scopes.includes('scene') || scopes.includes('chapter')) layers.push('chapter_execution');
  return unique(layers);
}

function combinationGuidance(method: NarrativeMethodDefinition): string {
  if (method.exclusiveGroup !== null) {
    return `同一规划节点通常只选一个“${method.exclusiveGroup}”主框架；其他方法只补充不同责任，不能把多套完整结构首尾拼接。`;
  }
  if (method.kind === 'foundation') return '可作为底层检查原则，与一个主要结构和少量增强方式同时使用。';
  if (method.kind === 'framework') return '适合作为当前节点的主要结构；辅助手法只解决它未覆盖的不同问题。';
  if (method.kind === 'modifier') return '只增强一个明确责任，不单独承担整层结构，也不应堆叠多个近义增强方式。';
  return '只在局部需要时调用，用完即退，不把技巧扩张成全书固定规则。';
}

function requireLayer(key: PlanningLayerKey): PlanningLayerDefinition {
  const value = PLANNING_LAYERS.find((item) => item.key === key);
  if (value === undefined) throw new Error(`规划层级不存在：${key}`);
  return value;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
