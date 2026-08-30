import { getNarrativeMethod } from '../narrative-methods/narrative-method-library.js';
import {
  PLANNING_LAYERS,
  V7_LAYERED_PLANNING_VERSION,
  getMethodExecutionProfile,
  type PlanningLayerKey
} from './method-asset-profiles.js';

export type RecipeStatus = 'example' | 'candidate' | 'accepted' | 'superseded';
export type RecipeNodeStatus = 'outline' | 'ready' | 'accepted' | 'completed';

export interface PlanningBudget {
  wordTarget?: number;
  volumeRange?: readonly [number, number];
  chapterRange?: readonly [number, number];
  note?: string;
}

export interface LayeredMethodGuidance {
  source: 'library' | 'custom';
  methodKey?: string;
  customTitle?: string;
  role: 'primary' | 'support';
  strength: 'soft';
  adaptationNote: string;
}

export interface ReaderExperienceTarget {
  publicSummary: string;
  pressureRhythm: string;
  payoffCadence: string;
  informationRhythm: string;
  contrastWithPrevious: string;
  designReason: string;
}

export interface LayeredRecipeNode {
  nodeId: string;
  layer: PlanningLayerKey;
  title: string;
  responsibility: string;
  status: RecipeNodeStatus;
  budget?: PlanningBudget;
  hardRequirements: readonly string[];
  methodGuidance: readonly LayeredMethodGuidance[];
  readerExperience: ReaderExperienceTarget;
  creativeSpace: readonly string[];
  expectedChanges: readonly string[];
  children: readonly LayeredRecipeNode[];
}

export interface LayeredPlanningRecipe {
  recipeId: string;
  version: number;
  engineVersion: string;
  status: RecipeStatus;
  title: string;
  sourceSnapshotLabel: string;
  root: LayeredRecipeNode;
}

export type PlanningSourceKind = 'formal' | 'goal' | 'open';

export interface PlanningSourceItem {
  sourceId: string;
  kind: PlanningSourceKind;
  label: string;
  content: string;
  version: string;
}

export interface CompiledLayeredPlanningTask {
  schema: 'v7-layered-planning-task-v1';
  mode: 'admin_example' | 'runtime';
  recipeId: string;
  recipeVersion: number;
  nodeId: string;
  layer: PlanningLayerKey;
  layerName: string;
  sourceRefs: Array<{ sourceId: string; version: string; kind: PlanningSourceKind }>;
  mustHold: string[];
  currentObjectives: string[];
  methodHints: Array<{ title: string; explanation: string; adaptationNote: string }>;
  experienceTargets: Array<{
    layer: PlanningLayerKey;
    layerName: string;
    title: string;
    publicSummary: string;
    pressureRhythm: string;
    payoffCadence: string;
    informationRhythm: string;
  }>;
  creativeSpace: string[];
  expectedOutput: string[];
  deviationPolicy: string[];
}

export interface PlanningEditorialSeat {
  seatKey: 'chief_editor' | 'structure_deputy' | 'commercial_deputy';
  publicName: string;
  responsibility: string;
  independentFocus: readonly string[];
  outputContract: readonly string[];
  cannotDo: readonly string[];
}

export const PLANNING_EDITORIAL_SEATS: readonly PlanningEditorialSeat[] = [
  {
    seatKey: 'chief_editor',
    publicName: '全案主编一席',
    responsibility: '完整理解作者意图，兼顾人物、因果、长篇容量、商业追读和作品辨识度，独立提出一套全书方案。',
    independentFocus: ['作者原意与主角是否准确', '长篇容量与因果是否成立', '阶段回报是否清楚', '人物选择是否可信', '创意是否有辨识度'],
    outputContract: ['完整分层配方树', '方法选择与创新项', '主要风险', '需要作者决定的问题'],
    cannotDo: ['提前查看其他主编初稿后伪装独立意见', '隐藏其他方案', '替作者自动确认最终方案']
  },
  {
    seatKey: 'structure_deputy',
    publicName: '全案主编二席',
    responsibility: '完整理解作者意图，兼顾人物、因果、长篇容量、商业追读和作品辨识度，独立提出一套全书方案。',
    independentFocus: ['作者原意与主角是否准确', '长篇容量与因果是否成立', '阶段回报是否清楚', '人物选择是否可信', '创意是否有辨识度'],
    outputContract: ['完整分层配方树', '方法选择与创新项', '主要风险', '需要作者决定的问题'],
    cannotDo: ['读取其他主编初稿后伪装独立意见', '用固定篇幅公式代替语义判断', '为了结构整齐压缩人物合理选择']
  },
  {
    seatKey: 'commercial_deputy',
    publicName: '全案主编三席',
    responsibility: '完整理解作者意图，兼顾人物、因果、长篇容量、商业追读和作品辨识度，独立提出一套全书方案。',
    independentFocus: ['作者原意与主角是否准确', '长篇容量与因果是否成立', '阶段回报是否清楚', '人物选择是否可信', '创意是否有辨识度'],
    outputContract: ['完整分层配方树', '方法选择与创新项', '主要风险', '需要作者决定的问题'],
    cannotDo: ['读取其他主编初稿后伪装独立意见', '把所有题材都改成同一种爽文', '只看短期刺激而破坏长期因果']
  }
];

export const PLANNING_COLLABORATION_STEPS: readonly string[] = [
  '系统装配同一份带来源和版本的正式资料快照，只做身份、版本、格式和层级校验。',
  '三名全案主编分别独立理解作品，兼顾结构、商业、人物与创意，只提出本席需要检索的创作责任，不读取全部方法库。',
  '系统按三席检索请求召回少量候选，只做候选检索；最终相关性仍由对应成员判断。',
  '三席从各自候选中独立形成三种分层方法组合，系统只校验引用、层级和篇幅。',
  '三名规划编剧分别拿到一套方法组合，独立设计三条真实故事路线，不互相抄写。',
  '主编逐一比较首卷吸引力、长期容量、因果续航、重复拖沓和创意空间，只给建议不代替作者确认。',
  '作者采用、调整或融合后，同时冻结故事路线与对应方法组合；随后才能生成正式全书树。'
];

export const PLANNING_AUDIT_FIELDS: readonly string[] = [
  '书籍与作者身份范围',
  '正式资料来源和版本',
  '方法库及配方版本',
  '每席成员、供应商、模型与参数快照',
  '独立提案、采用和拒绝理由',
  '自定义临时方法及其适用范围',
  '作者选择与最终确认版本',
  '偏离上层责任的调整记录',
  '失败、换成员、重试和恢复结果',
  '后续采纳、返工、漂移和兑现效果'
];

export interface LayeredPlanningDemo {
  label: string;
  notice: string;
  sources: readonly PlanningSourceItem[];
  recipe: LayeredPlanningRecipe;
  currentTask: CompiledLayeredPlanningTask;
}

export interface CrossVolumeExperiencePoint {
  volumeNodeId: string;
  sequence: number;
  title: string;
  publicSummary: string;
  pressureRhythm: string;
  payoffCadence: string;
  informationRhythm: string;
  contrastWithPrevious: string;
  designReason: string;
}

export function validateLayeredPlanningRecipe(recipe: LayeredPlanningRecipe): string[] {
  const errors: string[] = [];
  if (recipe.version < 1) errors.push('配方版本必须大于零');
  if (recipe.root.layer !== 'book_backbone') errors.push('分层配方根节点必须是全书顶层');
  const ids = new Set<string>();
  visit(recipe.root, undefined, (node, parent) => {
    if (ids.has(node.nodeId)) errors.push(`规划节点标识重复：${node.nodeId}`);
    ids.add(node.nodeId);
    if (node.title.trim().length === 0 || node.responsibility.trim().length === 0) {
      errors.push(`${node.nodeId} 缺少标题或责任`);
    }
    for (const [field, value] of Object.entries(node.readerExperience)) {
      if (value.trim().length === 0) errors.push(`${node.nodeId} 的读者体验字段 ${field} 为空`);
    }
    if (parent !== undefined && !allowedChildren(parent.layer).includes(node.layer)) {
      errors.push(`${parent.layer} 不能直接包含 ${node.layer}`);
    }
    const primaryCount = node.methodGuidance.filter((item) => item.role === 'primary').length;
    if (primaryCount > 1) errors.push(`${node.nodeId} 同时包含多个主要方法`);
    for (const guidance of node.methodGuidance) {
      if (guidance.strength !== 'soft') errors.push(`${node.nodeId} 的方法不是软参考`);
      if (guidance.source === 'library') {
        if (guidance.methodKey === undefined || getNarrativeMethod(guidance.methodKey) === null) {
          errors.push(`${node.nodeId} 引用了不存在的方法：${guidance.methodKey ?? '空'}`);
        } else if (getMethodExecutionProfile(guidance.methodKey)?.planningLayers.includes(node.layer) !== true) {
          errors.push(`${guidance.methodKey} 不适用于 ${node.layer}`);
        }
      }
      if (guidance.source === 'custom' && (guidance.customTitle?.trim().length ?? 0) === 0) {
        errors.push(`${node.nodeId} 的临时创新方法缺少名称`);
      }
    }
  });
  const volumeDistribution = recipe.root.children.find((node) => node.layer === 'volume_distribution');
  if (volumeDistribution !== undefined && recipe.root.budget?.wordTarget !== undefined) {
    const childTargets = volumeDistribution.children.map((node) => node.budget?.wordTarget);
    if (childTargets.length > 0 && childTargets.every((value) => value !== undefined)) {
      const total = childTargets.reduce((sum, value) => sum + (value ?? 0), 0);
      if (total !== recipe.root.budget.wordTarget) errors.push(`各卷字数合计 ${total} 与全书目标 ${recipe.root.budget.wordTarget} 不一致`);
    }
  }
  return errors;
}

export function buildCrossVolumeExperienceCurve(recipe: LayeredPlanningRecipe): CrossVolumeExperiencePoint[] {
  const distribution = recipe.root.children.find((node) => node.layer === 'volume_distribution');
  if (distribution === undefined) return [];
  return distribution.children.filter((node) => node.layer === 'volume').map((node, index) => ({
    volumeNodeId: node.nodeId,
    sequence: index + 1,
    title: node.title,
    publicSummary: node.readerExperience.publicSummary,
    pressureRhythm: node.readerExperience.pressureRhythm,
    payoffCadence: node.readerExperience.payoffCadence,
    informationRhythm: node.readerExperience.informationRhythm,
    contrastWithPrevious: node.readerExperience.contrastWithPrevious,
    designReason: node.readerExperience.designReason
  }));
}

export function compileLayeredPlanningTask(input: {
  recipe: LayeredPlanningRecipe;
  nodeId: string;
  sources: readonly PlanningSourceItem[];
  mode?: 'admin_example' | 'runtime';
}): CompiledLayeredPlanningTask {
  const errors = validateLayeredPlanningRecipe(input.recipe);
  if (errors.length > 0) throw new Error(`分层配方无效：${errors.join('；')}`);
  const path = findNodePath(input.recipe.root, input.nodeId);
  if (path === null) throw new Error(`规划节点不存在：${input.nodeId}`);
  const node = path[path.length - 1];
  if (node === undefined) throw new Error('规划节点路径为空');
  const layer = PLANNING_LAYERS.find((item) => item.key === node.layer);
  if (layer === undefined) throw new Error(`规划层级不存在：${node.layer}`);
  const formalSources = input.sources.filter((item) => item.kind === 'formal');
  const goalSources = input.sources.filter((item) => item.kind === 'goal');
  const openSources = input.sources.filter((item) => item.kind === 'open');
  const methodHints = node.methodGuidance.map((guidance) => {
    if (guidance.source === 'custom') {
      return {
        title: guidance.customTitle ?? '本书临时创新方法',
        explanation: '这是规划成员为当前作品提出的临时参考，不会自动进入公共方法库。',
        adaptationNote: guidance.adaptationNote
      };
    }
    const method = guidance.methodKey === undefined ? null : getNarrativeMethod(guidance.methodKey);
    if (method === null) throw new Error(`方法不存在：${guidance.methodKey ?? '空'}`);
    return { title: method.professionalName, explanation: method.publicExplanation, adaptationNote: guidance.adaptationNote };
  });
  return {
    schema: 'v7-layered-planning-task-v1',
    mode: input.mode ?? 'runtime',
    recipeId: input.recipe.recipeId,
    recipeVersion: input.recipe.version,
    nodeId: node.nodeId,
    layer: node.layer,
    layerName: layer.publicName,
    sourceRefs: input.sources.map((item) => ({ sourceId: item.sourceId, version: item.version, kind: item.kind })),
    mustHold: unique([
      ...formalSources.map((item) => `${item.label}：${item.content}`),
      ...path.flatMap((item) => item.hardRequirements)
    ]),
    currentObjectives: unique([
      ...goalSources.map((item) => `${item.label}：${item.content}`),
      ...path.map((item) => item.responsibility),
      ...node.expectedChanges.map((item) => `完成后变化：${item}`)
    ]),
    methodHints,
    experienceTargets: path.map((item) => ({
      layer: item.layer,
      layerName: PLANNING_LAYERS.find((definition) => definition.key === item.layer)?.publicName ?? item.layer,
      title: item.title,
      publicSummary: item.readerExperience.publicSummary,
      pressureRhythm: item.readerExperience.pressureRhythm,
      payoffCadence: item.readerExperience.payoffCadence,
      informationRhythm: item.readerExperience.informationRhythm
    })),
    creativeSpace: unique([
      ...openSources.map((item) => `${item.label}：${item.content}`),
      ...path.flatMap((item) => item.creativeSpace)
    ]),
    expectedOutput: unique([
      ...layer.outputChecklist,
      ...node.methodGuidance.flatMap((guidance) => guidance.methodKey === undefined
        ? []
        : getNarrativeMethod(guidance.methodKey)?.responsibilities ?? [])
    ]),
    deviationPolicy: [
      '可以自由改变具体人物行动、阻力、关系和实现方式，只要仍完成当前层责任。',
      '现有方法不适合时可以删减、组合或提出本书临时创新方法，并说明它解决什么问题。',
      '如果新创意会改变父层方向，必须产生调整建议，不能静默改写已确认路线。',
      '已完成正文和实际状态不能被未来规划覆盖。'
    ]
  };
}

export function buildHistoricalHegemonyPlanningDemo(): LayeredPlanningDemo {
  const sources: readonly PlanningSourceItem[] = [
    { sourceId: 'opening-v3', kind: 'formal', label: '开书资料', content: '张三穿越到北宋乱世，主角必须是张三；岳飞是重要历史人物，但不能替代主角。', version: '3' },
    { sourceId: 'setting-v2', kind: 'formal', label: '已确认设定', content: '尊重历史基础，不使用系统和超凡力量；允许合理架空。', version: '2' },
    { sourceId: 'author-goal-v1', kind: 'goal', label: '作者目标', content: '约 300 万字，主线从乱世求生推进到建立新秩序。', version: '1' },
    { sourceId: 'author-open-v1', kind: 'open', label: '开放创意', content: '如何与岳飞相遇、合作或分歧，以及各卷具体敌手，由规划成员自由设计。', version: '1' }
  ];
  const recipe: LayeredPlanningRecipe = {
    recipeId: 'demo-history-hegemony-300w',
    version: 1,
    engineVersion: V7_LAYERED_PLANNING_VERSION,
    status: 'example',
    title: '300 万字历史争霸分层配方示范',
    sourceSnapshotLabel: '示范资料快照：开书 v3＋设定 v2＋作者目标 v1',
    root: {
      nodeId: 'book',
      layer: 'book_backbone',
      title: '张三从乱世求生到建立新秩序',
      responsibility: '以起、承、转、合组织全书长期变化，保持张三始终是行动和选择的中心。',
      status: 'ready',
      budget: { wordTarget: 3_000_000, volumeRange: [8, 8], note: '目标值可随实际写作调整，不是正文硬上限。' },
      hardRequirements: ['主角必须是张三', '不使用系统和超凡力量', '岳飞不能替代主角完成核心选择'],
      methodGuidance: [
        libraryGuidance('four-act', 'primary', '把起承转合分配给多个大卷，不机械分成四等份。'),
        libraryGuidance('multi-line-network', 'support', '允许主角、朝堂和战争线并进，但主角线保持中心。')
      ],
      readerExperience: experience(
        '见证张三从乱世求生者一步步成为能够建立新秩序的人，成长越来越有分量。',
        '前期以生存压力入局，中期让势力与责任同步扩大，后期打破旧路、付出代价后完成重建与决断。',
        '每一卷至少兑现一次不可逆的身份、关系或格局变化，终局兑现全书的新秩序承诺。',
        '先跟随张三的有限视角理解乱世，再逐步扩展到军队、朝堂和天下，不提前讲透未来。',
        '这是全书体验起点，后续所有卷的变化都要能回到这条长期成长线上。',
        '让三百万字长篇既有统一方向，又能通过逐卷升级避免中段重复和失速。'
      ),
      creativeSpace: ['允许人物关系和历史节点形成意外但合理的变化', '允许主编提出比现有方法更适合本书的临时组合'],
      expectedChanges: ['张三的身份、能力、关系和责任发生长期变化', '乱世权力格局最终形成新的平衡'],
      children: [{
        nodeId: 'distribution',
        layer: 'volume_distribution',
        title: '八卷递进分配',
        responsibility: '将“起—承—转—合”分配给八卷，每卷完成一次不可逆的身份、势力或认知变化。',
        status: 'ready',
        budget: { wordTarget: 3_000_000, volumeRange: [8, 8] },
        hardRequirements: ['八卷合计承担完整全书方向，不能让中间卷重复扩张而不改变局势'],
        methodGuidance: [customGuidance('多卷递进分配', '按照本书容量自由分配起承转合，不把现有单卷结构硬拉成全书模板。')],
        readerExperience: experience(
          '八卷各有清楚的阶段体验，合在一起仍能读出张三由小到大的完整变化。',
          '压力从个人生存逐步抬高到团队、势力和天下，阶段高点后安排一次真正破局的重大损失。',
          '每卷都有卷末大回报或大改变，相邻卷用新的问题承接，不靠重复升级拖长篇幅。',
          '信息范围随张三地位扩大；每卷只揭开当前行动需要的世界，不一次讲完天下格局。',
          '把全书总体体验拆成八次可感知的阶段变化，并负责相邻卷之间的对比与交接。',
          '跨卷层只安排体验曲线和卷责任，不提前锁死每卷内部剧情。'
        ),
        creativeSpace: ['卷数和篇幅可以在作者确认前调整', '各卷内部结构进入该卷时再选择'],
        expectedChanges: ['形成八个职责不同、前后相接的大卷'],
        children: buildDemoVolumes()
      }]
    }
  };
  return {
    label: '300 万字历史争霸示范',
    notice: '这是由后端领域函数编译的管理示范，未调用模型、未创建真实书籍任务，也不会进入正史。',
    sources,
    recipe,
    currentTask: compileLayeredPlanningTask({ recipe, nodeId: 'chain-1', sources, mode: 'admin_example' })
  };
}

function buildDemoVolumes(): LayeredRecipeNode[] {
  const volumes: Array<readonly [string, string, string, number, string[]]> = [
    ['volume-1', '第一卷·乱世入局', '完成“起”：张三活下来、被看见并建立第一批可信关系。', 300_000, ['身份从无名流民变为有明确位置的人', '建立第一项长期承诺']],
    ['volume-2', '第二卷·站稳脚跟', '完成“承”的第一步：把个人生存能力变成可持续的小团队能力。', 350_000, ['形成稳定班底与行动方法']],
    ['volume-3', '第三卷·势力扩张', '继续“承”：获得地盘、资源或政治位置，并承担扩张代价。', 400_000, ['个人胜负升级为势力胜负']],
    ['volume-4', '第四卷·合纵博弈', '继续“承”：进入更大联盟和权力博弈，旧关系开始承压。', 400_000, ['盟友、对手和利益边界重组']],
    ['volume-5', '第五卷·天下争雄', '完成“承”的高点：张三成为不可忽视的一方力量。', 350_000, ['达到阶段高点并埋下崩塌原因']],
    ['volume-6', '第六卷·基本盘崩塌', '进入“转”：旧办法失效，势力和关系遭遇不可逆损失。', 400_000, ['原有优势被打破，必须改变路线']],
    ['volume-7', '第七卷·代价重建', '完成“转”：张三以新认知和新关系重建力量。', 400_000, ['新的价值选择和势力结构成立']],
    ['volume-8', '第八卷·定鼎与归宿', '完成“合”：解决全书核心竞争，交代新秩序与人物归宿。', 400_000, ['主要承诺得到兑现，开放项有明确状态']]
  ];
  return volumes.map(([nodeId, title, responsibility, wordTarget, expectedChanges], index) => ({
    nodeId,
    layer: 'volume',
    title,
    responsibility,
    status: index === 0 ? 'ready' : 'outline',
    budget: { wordTarget, note: index === 0 ? '当前卷可展开' : '未来卷只有方向责任，进入该卷时再编译。' },
    hardRequirements: index === 0 ? ['开篇必须围绕张三行动，不能让历史名人替他完成关键选择'] : [],
    methodGuidance: index === 0
      ? [
          libraryGuidance('eight-sequence', 'primary', '第一卷较长，使用职责区段保证连续变化，但不固定每段章数。'),
          libraryGuidance('opening-promise', 'support', '尽早让读者看见穿越乱世、求生和第一次有效结果。')
        ]
      : [],
    readerExperience: demoVolumeExperience(index),
    creativeSpace: index === 0 ? ['相遇人物、第一次立功方式和具体敌手由编剧自由设计'] : ['进入该卷时结合实际正文重新选择方法'],
    expectedChanges,
    children: index === 0 ? [buildDemoChain()] : []
  }));
}

function buildDemoChain(): LayeredRecipeNode {
  return {
    nodeId: 'chain-1',
    layer: 'chain',
    title: '第一链·活下来并第一次被看见',
    responsibility: '让张三在真实危险中主动行动，获得第一次可信结果，并打开更大的生存问题。',
    status: 'ready',
    budget: { wordTarget: 18_000, chapterRange: [5, 7], note: '章节范围是本链建议，可由编剧根据内容调整。' },
    hardRequirements: ['张三是本链关键行动者', '不使用系统或超凡力量解决问题'],
    methodGuidance: [
      libraryGuidance('promise-progress-payoff', 'primary', '先建立张三能否活下来的期待，持续给有效进展，再完成第一次可信兑现。'),
      libraryGuidance('pressure-payoff-loop', 'support', '压力必须作用于生存和信任，回报要改变身份、关系或资源。')
    ],
    readerExperience: experience(
      '读者跟着张三从“可能马上死去”走到“第一次有人愿意记住并相信他”。',
      '生存危险持续逼近，张三的第一次办法不能直接成功，必须通过判断和行动争出机会。',
      '在五至七章内完成一次明确结果，回报必须改变张三的身份、关系或资源。',
      '只给张三当前能够发现的信息，让队友可信度和危险来源随行动逐步显露。',
      '把第一卷的大目标收紧为一次短而完整的求生兑现，让开篇快速产生真实进展。',
      '第一条链必须证明本书核心卖点能够落到具体行动，而不是只靠设定介绍。'
    ),
    creativeSpace: ['可以让计划失败后改用新办法', '可以加入历史人物，但不能抢走主角选择', '允许合理意外改变后续链入口'],
    expectedChanges: ['张三从完全无依靠变成有人记住或愿意信任的人', '形成下一链必须处理的新责任'],
    children: [{
      nodeId: 'chapter-policy-1',
      layer: 'chapter_execution',
      title: '第一链章节执行规则',
      responsibility: '每章完成一项实质变化，章末期待来自结果后果，不靠无关突发硬卡断。',
      status: 'outline',
      budget: { chapterRange: [5, 7], note: '进入章纲时逐章实例化。' },
      hardRequirements: ['正文只能依据已确认章纲和正式事实'],
      methodGuidance: [],
      readerExperience: experience(
        '每一章都让读者看到张三采取行动并造成一项真实变化。',
        '章内压力围绕当前目标自然增加，紧张章节之后允许短暂喘息，但不能停住故事。',
        '一章至少给出一个小进展或小回报，整条链结束时再完成阶段兑现。',
        '本章只揭示推动当下行动所需的信息，章末的新期待必须来自本章结果。',
        '把单元链的整体期待拆成连续章节体验，不另起与当前链无关的新方向。',
        '避免只有悬念没有进展，也避免每章使用同一种强行反转。'
      ),
      creativeSpace: ['具体场景、对话、动作和情绪由章纲与正文成员发挥'],
      expectedChanges: ['各章结果共同完成当前链的明确兑现'],
      children: []
    }]
  };
}

function demoVolumeExperience(index: number): ReaderExperienceTarget {
  const values: ReaderExperienceTarget[] = [
    experience('从无名小卒求生到第一次拥有位置和同伴，读者快速看见主角能改变命运。', '危险近、节奏快，先压住生存空间，再通过连续小胜建立信心。', '开篇尽早给第一次有效结果，卷内多次小兑现，卷末完成身份跃迁。', '跟随张三的有限认知认识军营和乱世，不用大段背景一次讲完。', '作为全书第一卷，以直接、清楚和高反馈建立追读承诺。', '先证明主角、卖点和世界能够持续产生故事，再进入更大格局。'),
    experience('看张三把个人本事变成一支真正能互相信任的小团队。', '从个人危机转为团队磨合和共同承担，压力更持久但不再只有求生。', '每次协作都带来关系或能力回报，卷末兑现稳定班底。', '通过不同成员掌握的信息展示世界，让读者开始看见多方立场。', '相比第一卷的孤身求生，本卷增加关系温度和团队成就感。', '用关系成长换一种满足感，避免连续两卷只写个人立功。'),
    experience('看小团队获得地盘与资源，第一次真正影响一方局势。', '外部对手和内部治理同时加压，胜利越大，责任与代价越重。', '资源、地盘和声望逐层兑现，卷末让个人胜负升级为势力胜负。', '逐步揭示地方利益网络，读者和主角一起理解占领不等于治理。', '从团队成长转向经营与扩张，获得更大的掌控感。', '扩大故事容量，同时让每次升级都带来新的问题。'),
    experience('进入盟友与敌人都不能简单判断的权力棋局，享受选择和博弈。', '直接战斗减少，关系和信息压力增加；每次结盟都附带新的风险。', '用识破、取舍和关系重组兑现，不只依靠战斗胜利。', '让不同阵营掌握不同真相，通过信息差逐步揭开真实目的。', '相比第三卷的扩张爽感，本卷强调不确定和智力参与。', '改变冲突形态，让长篇中段保持新鲜并为后续崩塌积累原因。'),
    experience('看张三站上阶段高点，拥有改变天下局势的力量。', '多条压力汇合，胜利接连到来，但每次成功都暴露更大的结构性隐患。', '集中兑现前四卷积累的班底、地盘和声望，卷末达到阶段巅峰。', '读者比主角更早看见部分危险，让高光中始终带着不安。', '从复杂博弈转为阶段性扬眉吐气，同时把下一卷的坠落准备充分。', '必须让长期积累得到足够回报，重大失败才会真正有分量。'),
    experience('经历一次真正失去，让读者感到旧办法已经无法继续。', '压力快速失控，熟悉优势依次失效；低谷不是拖延，而是逼出新的选择。', '减少表面奖励，改用真相揭晓、关系取舍和关键幸存作为回报。', '揭开此前埋藏的误判与代价，让旧情节获得新的解释。', '与第五卷高点形成强烈落差，提供全书最大的痛感和转折。', '打破重复扩张，迫使人物和全书方向进入新的阶段。'),
    experience('看张三用新的价值选择重建力量，获得比原来更可靠的支持。', '前半承受失败余波，后半由新的关系和办法逐步夺回主动权。', '每次重建都修复一项旧缺陷，卷末兑现新的势力结构与人物认知。', '信息由反思旧错转向发现新机会，避免用突然奇遇抹平代价。', '从失控转向有代价的恢复，给读者希望但不取消上一卷损失。', '让转折真正改变人物与做事方式，而不是换个敌人继续原路线。'),
    experience('把全书积累的选择、关系和矛盾集中兑现，看到新秩序真正成立。', '多线压力在终局汇合，紧张持续抬升；决断后给足结果和人物余韵。', '兑现主要长期承诺、核心关系和天下格局，开放项也要有明确状态。', '最后的真相只解释已有因果，不凭空增加更大的幕后敌人。', '从重建后的希望进入最终决断与完整释放，形成结束感。', '终局既要有大结果，也要证明张三一路变化最终影响了他的选择。')
  ];
  const value = values[index];
  if (value === undefined) throw new Error(`示范卷体验不存在：${index}`);
  return value;
}

function experience(
  publicSummary: string,
  pressureRhythm: string,
  payoffCadence: string,
  informationRhythm: string,
  contrastWithPrevious: string,
  designReason: string
): ReaderExperienceTarget {
  return { publicSummary, pressureRhythm, payoffCadence, informationRhythm, contrastWithPrevious, designReason };
}

function libraryGuidance(methodKey: string, role: 'primary' | 'support', adaptationNote: string): LayeredMethodGuidance {
  return { source: 'library', methodKey, role, strength: 'soft', adaptationNote };
}

function customGuidance(customTitle: string, adaptationNote: string): LayeredMethodGuidance {
  return { source: 'custom', customTitle, role: 'primary', strength: 'soft', adaptationNote };
}

function allowedChildren(layer: PlanningLayerKey): readonly PlanningLayerKey[] {
  return ({
    book_backbone: ['volume_distribution'],
    volume_distribution: ['volume'],
    volume: ['chain'],
    chain: ['chapter_execution'],
    chapter_execution: []
  } as const)[layer];
}

function visit(
  node: LayeredRecipeNode,
  parent: LayeredRecipeNode | undefined,
  callback: (node: LayeredRecipeNode, parent: LayeredRecipeNode | undefined) => void
): void {
  callback(node, parent);
  for (const child of node.children) visit(child, node, callback);
}

function findNodePath(root: LayeredRecipeNode, nodeId: string): LayeredRecipeNode[] | null {
  if (root.nodeId === nodeId) return [root];
  for (const child of root.children) {
    const path = findNodePath(child, nodeId);
    if (path !== null) return [root, ...path];
  }
  return null;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
