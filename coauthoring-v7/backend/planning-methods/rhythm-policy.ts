import { V7_NARRATIVE_METHODS } from '../narrative-methods/narrative-method-library.js';
import { V7_PLOT_RECIPES } from '../plot-patterns/plot-recipe-library.js';
import { V7_PLOT_PATTERNS } from '../plot-patterns/plot-pattern-library.js';
import { COMPLETE_METHOD_CARDS, COMPLETE_METHOD_LAYERS } from './complete-method-catalog.js';
import type { PlanningLayerKey } from './method-asset-profiles.js';
import { AUDITED_RUNTIME_POLICY, methodNavigation } from './method-tools.js';

export const RHYTHM_CATEGORIES = {
  organization: '结构', progression: '推进', rhythm: '表现', event: '事件'
} as const;
export const RHYTHM_LAYERS: Record<PlanningLayerKey, { label: string; responsibility: string }> = {
  book_backbone: { label: '时光机', responsibility: '设计全书故事、主角经历和结局走向；阶段不等于卷数。' },
  volume_distribution: { label: '阶段与分卷', responsibility: '把阶段责任分配到卷，说明主角获得或失去什么、因果承接及字数；不机械等分。' },
  volume: { label: '卷', responsibility: '承接本卷起止状态和相关故事线，展开行动、转折、代价与兑现，不重写全书。' },
  chain: { label: '事件链', responsibility: '围绕本卷目标串联人物行动与后果，区分当前兑现和留待后续的问题。' },
  chapter_execution: { label: '章', responsibility: '完成当前行动、信息和情绪变化；可积累或舒缓，不必每章套完整宏观结构。' }
};
export interface RhythmCard {
  methodCategory?: string;
  aliasKeys?: string[];
  layerHints?: string[];
  assetType: 'narrative_method' | 'plot_recipe' | 'plot_pattern';
  key: string;
  category: keyof typeof RHYTHM_CATEGORIES;
  title: string;
  instruction: string;
  boundary: string;
}
export interface RhythmPolicy {
  format?: 'compact-v2' | 'complete-v3' | 'audited-v4';
  schema: 'wenmi-rhythm-policy-v1';
  cards: RhythmCard[];
  layers: Record<PlanningLayerKey, string[]>;
}
export interface RhythmPolicySnapshot { version: number; policy: RhythmPolicy }
export const RHYTHM_FRAGMENT_LIMIT = 30000;
const c = (key: string, category: RhythmCard['category'], title: string, instruction: string, boundary: string,
  assetType: RhythmCard['assetType'] = 'narrative_method'): RhythmCard => ({ key, category, title, instruction, boundary, assetType });
export const LEGACY_COMPACT_RHYTHM_POLICY: RhythmPolicy = {
  format: 'compact-v2',
  schema: 'wenmi-rhythm-policy-v1',
  cards: [
    c('three-act','organization','三幕式','建立目标—展开行动—解决主要问题。',''),
    c('four-act','organization','起承转合','起因—过程—转折—合拢。',''),
    c('five-act','organization','五阶段','开端—发展—高潮—变化落定—收束。',''),
    c('six-act','organization','六阶段','起点—进入局面—展开—关键转折—决战行动—收束。',''),
    c('story-circle','organization','故事圈','出发—进入陌生处境—适应与取得—返回并改变。',''),
    c('episodic-spine','organization','单元串联','单元故事各有结果，共同推进长期目标。',''),
    c('dual-lead-braid','organization','双主角交织','两位主角分别行动，通过关系或后果互相推动。',''),
    c('ensemble-network','organization','群像交织','不同人物追求交汇，共同改变局面。',''),
    c('steadfast-arc','progression','坚守与影响','主角坚持核心追求，行动逐渐改变周围的人与事。',''),
    c('escalation-ladder','progression','积累与扩展','成果带来新的能力、资源或舞台，不只提高敌人强度。',''),
    c('direct-opposition','progression','目标对冲','各方目标相互阻碍，行动推动局面变化。',''),
    c('consequence-reversal','progression','后果反转','已有行动产生意外后果，改变接下来的选择。',''),
    c('reaction-dilemma-decision','event','反应与决定','面对结果—权衡处境—作出下一步决定。',''),
    c('scene-goal-conflict-turn-result','event','场景推进','本场目标—遭遇阻碍—行动变化—形成结果。',''),
    c('in-medias-res','rhythm','从事件中切入','先让事情发生，再补理解当前情境所需的信息。',''),
    c('parallel-contrast-structure','rhythm','反差对照','并置不同人物或处境，放大差异与阅读趣味。',''),
    c('single-core-line', 'organization', '单主线推进', '一项长期目标贯穿全书，支线在关键处改变主线。', '支线不能只是填充，也不要求每章回到主线。'),
    c('multi-line-network', 'organization', '多线交汇', '各线独立推进，在共享人物、利益或后果处交汇。', '切线要有作用，不为凑数量增加支线。'),
    c('positive-growth-arc', 'progression', '阶段成长', '行动与选择改变能力、关系或认知，让变化支撑下一阶段。', '不强制每卷晋升；地位、名声、实力可不同步，成长也有代价。'),
    c('causal-chain', 'progression', '成果引出新局面', '前次行动的结果改变资源或关系，形成后续选择与矛盾。', '不凭空刷新强敌；解决问题也可以带来稳定和积累。'),
    c('promise-progress-payoff', 'rhythm', '承诺—进展—兑现', '提出值得期待的目标，持续出现有效进展，在合适位置兑现。', '不固定章数或比例，不把反复延迟当悬念。'),
    c('tension-relief', 'rhythm', '紧张与舒缓', '行动压力与获得、关系、日常交替，让情绪有变化。', '舒缓仍有内容，不能只用新危机维持强度。'),
    c('arc-close-next-open', 'rhythm', '阶段收束与新期待', '完成当前主要问题，让结果自然打开后续期待。', '先交付当前成果，不用断章代替收束。'),
    c('goal-action-consequence', 'event', '目标—行动—后果', '人物为具体目标采取行动，后果改变下一步选择。', '意外须符合处境，不机械要求每章反转。'),
    c('campaign-to-aftermath', 'event', '战役与余波', '目标与补给制约行动，胜负改变各方关系，接续治理后果。', '胜利不等于治理完成；只在需要战役故事时选用。', 'plot_recipe')
  ],
  layers: {
    book_backbone: ['three-act','four-act','five-act','six-act','single-core-line','multi-line-network','episodic-spine','positive-growth-arc','steadfast-arc','causal-chain','promise-progress-payoff'],
    volume_distribution: ['three-act','four-act','five-act','six-act','single-core-line','multi-line-network','episodic-spine','positive-growth-arc','steadfast-arc','causal-chain','promise-progress-payoff'],
    volume: ['three-act','four-act','five-act','six-act','dual-lead-braid','causal-chain','escalation-ladder','direct-opposition','promise-progress-payoff','tension-relief','arc-close-next-open'],
    chain: ['four-act','goal-action-consequence','direct-opposition','consequence-reversal','reaction-dilemma-decision','tension-relief','arc-close-next-open'],
    chapter_execution: ['four-act','scene-goal-conflict-turn-result','reaction-dilemma-decision','in-medias-res','parallel-contrast-structure','tension-relief']
  }
};

export const COMPLETE_V3_RHYTHM_POLICY: RhythmPolicy = {
  schema:'wenmi-rhythm-policy-v1',format:'complete-v3',
  cards:COMPLETE_METHOD_CARDS.map(({applicableLayers,aliases,...card})=>({...card})),
  layers:structuredClone(COMPLETE_METHOD_LAYERS)
};

export const DEFAULT_RHYTHM_POLICY: RhythmPolicy = AUDITED_RUNTIME_POLICY;

export function rhythmCardText(card: RhythmCard): string {
  return `${card.title} [${card.assetType}:${card.key}]：${card.instruction}`;
}
export function renderRhythmFragment(policy: RhythmPolicy, layer: PlanningLayerKey, version: number | string = '默认'): string {
  if(policy.format==='audited-v4')return methodNavigation(policy,layer,version);
  const cards = policy.layers[layer].map(key => policy.cards.find(card => card.key === key)!);
  return [`【${RHYTHM_LAYERS[layer].label}·节奏参考 v${version}】`, RHYTHM_LAYERS[layer].responsibility,
    '以下是候选，不必全用；按本书处境选择、组合或原创。承接上层责任，不逐层重复模板；重复方法须产生不同事件与结果。',
    ...(policy.format === 'complete-v3'
      ? ['完整本层目录，按需使用，不必全用。结构可用于大小故事；章节只展开本章责任，不强塞整本书。',
         ...(['narrative_method','plot_pattern','plot_recipe'] as const).flatMap(type=>[
           `【${{narrative_method:'叙事方法',plot_pattern:'剧情模式',plot_recipe:'组合配方'}[type]}】`,
           ...cards.filter(c=>c.assetType===type).map(c=>`${c.key}｜${c.title}：${c.instruction}`)])]
      : cards.map(card => `- ${rhythmCardText(card)}`))].join('\n');
}

export function validateRhythmPolicy(value: unknown): RhythmPolicy {
  if (value === null || typeof value !== 'object') throw new Error('节奏配置不能为空。');
  const policy = value as RhythmPolicy;
  if (policy.format !== undefined && !['compact-v2','complete-v3','audited-v4'].includes(policy.format)) throw new Error('方法版本格式未知，请刷新后台。');
  if (policy.schema !== 'wenmi-rhythm-policy-v1' || !Array.isArray(policy.cards) || policy.cards.length < 1 || policy.cards.length > 400
    || !policy.layers || typeof policy.layers !== 'object') throw new Error('节奏配置格式不完整。');
  const keys = new Set<string>();
  const text = (v: unknown, max: number): boolean => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  for (const card of policy.cards) {
    if (!card || !text(card.key, 100) || keys.has(card.key) || !Object.hasOwn(RHYTHM_CATEGORIES, card.category)
      || !text(card.title, 30) || !text(card.instruction, 120) || typeof card.boundary !== 'string' || card.boundary.length > (policy.format==='audited-v4'?512:100)) throw new Error('方法需有唯一编号、分类、名称和简短介绍。');
    const exists = card.assetType === 'narrative_method' ? V7_NARRATIVE_METHODS.some(m => m.key === card.key)
      : card.assetType === 'plot_recipe' ? V7_PLOT_RECIPES.some(r => r.key === card.key)
      : card.assetType === 'plot_pattern' && V7_PLOT_PATTERNS.some(p => p.key === card.key);
    if (!exists && !(policy.format==='audited-v4'&&AUDITED_RUNTIME_POLICY.cards.some(c=>c.key===card.key))) throw new Error(`找不到短卡对应的原始资产：${card.key}`);
    keys.add(card.key);
  }
  for (const layer of Object.keys(RHYTHM_LAYERS) as PlanningLayerKey[]) {
    const selected = policy.layers[layer];
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > 400 || new Set(selected).size !== selected.length
      || selected.some(key => !keys.has(key))) throw new Error(`${RHYTHM_LAYERS[layer].label}方法目录存在缺失或重复。`);
    if (renderRhythmFragment(policy, layer, 999999).length > RHYTHM_FRAGMENT_LIMIT) throw new Error(`${RHYTHM_LAYERS[layer].label}资产片段超过${RHYTHM_FRAGMENT_LIMIT}字符，请精简方法介绍；系统不会截断目录。`);
  }
  if (policy.format === 'complete-v3') {
    if (keys.size!==COMPLETE_METHOD_CARDS.length || COMPLETE_METHOD_CARDS.some(c=>!keys.has(c.key)))throw Error('完整库不能缩减为精选子集。');
    for(const layer of Object.keys(COMPLETE_METHOD_LAYERS) as PlanningLayerKey[]) {
      const expected=COMPLETE_METHOD_LAYERS[layer];
      if(policy.layers[layer].length!==expected.length || expected.some(key=>!policy.layers[layer].includes(key)))throw Error('各层自动包含全部适用方法，不能手动停用。');
    }
  }
  if (policy.format === 'compact-v2' && JSON.stringify(policy.layers.book_backbone) !== JSON.stringify(policy.layers.volume_distribution)) {
    throw new Error('时光机与其阶段分配共用同一方法页，请同步选择。');
  }
  if(policy.format==='audited-v4'){
    if(keys.size!==AUDITED_RUNTIME_POLICY.cards.length)throw Error('校正库必须保留完整来源');
    for(const expected of AUDITED_RUNTIME_POLICY.cards){const actual=policy.cards.find(c=>c.key===expected.key);
      if(!actual||actual.assetType!==expected.assetType||actual.methodCategory!==expected.methodCategory||JSON.stringify(actual.aliasKeys)!==JSON.stringify(expected.aliasKeys)||JSON.stringify(actual.layerHints)!==JSON.stringify(expected.layerHints))throw Error('方法编号、类型、别名和适用规则需与校正版本一致');}
    for(const layer of Object.keys(RHYTHM_LAYERS) as PlanningLayerKey[])if(policy.layers[layer].length!==keys.size)throw Error('可查询目录不能删减；不自动提供不等于禁用');
  }
  return JSON.parse(JSON.stringify(policy)) as RhythmPolicy;
}
