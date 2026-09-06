import { V7_NARRATIVE_METHODS } from '../narrative-methods/narrative-method-library.js';
import { V7_PLOT_RECIPES } from '../plot-patterns/plot-recipe-library.js';
import type { PlanningLayerKey } from './method-asset-profiles.js';

export const RHYTHM_CATEGORIES = {
  organization: '全书组织', progression: '阶段推进', rhythm: '节奏模式', event: '事件配方'
} as const;
export const RHYTHM_LAYERS: Record<PlanningLayerKey, { label: string; responsibility: string }> = {
  book_backbone: { label: '全书方向', responsibility: '连接开局与终局，安排阶段变化和主要兑现；阶段不等于卷数。' },
  volume_distribution: { label: '阶段与分卷', responsibility: '把阶段责任分配到卷，说明主角获得或失去什么、因果承接及字数；不机械等分。' },
  volume: { label: '卷', responsibility: '承接本卷起止状态和相关故事线，展开行动、转折、代价与兑现，不重写全书。' },
  chain: { label: '事件链', responsibility: '围绕本卷目标串联人物行动与后果，区分当前兑现和留待后续的问题。' },
  chapter_execution: { label: '章', responsibility: '完成当前行动、信息和情绪变化；可积累或舒缓，不必每章套完整宏观结构。' }
};
export interface RhythmCard {
  assetType: 'narrative_method' | 'plot_recipe';
  key: string;
  category: keyof typeof RHYTHM_CATEGORIES;
  title: string;
  instruction: string;
  boundary: string;
}
export interface RhythmPolicy {
  schema: 'wenmi-rhythm-policy-v1';
  cards: RhythmCard[];
  layers: Record<PlanningLayerKey, string[]>;
}
export interface RhythmPolicySnapshot { version: number; policy: RhythmPolicy }
export const RHYTHM_FRAGMENT_LIMIT = 1400;
const c = (key: string, category: RhythmCard['category'], title: string, instruction: string, boundary: string,
  assetType: RhythmCard['assetType'] = 'narrative_method'): RhythmCard => ({ key, category, title, instruction, boundary, assetType });
export const DEFAULT_RHYTHM_POLICY: RhythmPolicy = {
  schema: 'wenmi-rhythm-policy-v1',
  cards: [
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
    book_backbone: ['single-core-line', 'multi-line-network', 'positive-growth-arc', 'causal-chain', 'promise-progress-payoff'],
    volume_distribution: ['positive-growth-arc', 'causal-chain', 'promise-progress-payoff', 'tension-relief'],
    volume: ['causal-chain', 'promise-progress-payoff', 'tension-relief', 'arc-close-next-open'],
    chain: ['goal-action-consequence', 'tension-relief', 'arc-close-next-open'],
    chapter_execution: ['goal-action-consequence', 'tension-relief', 'arc-close-next-open']
  }
};

export function rhythmCardText(card: RhythmCard): string {
  return `${card.title} [${card.assetType}:${card.key}]：${card.instruction} 边界：${card.boundary}`;
}
export function renderRhythmFragment(policy: RhythmPolicy, layer: PlanningLayerKey, version: number | string = '默认'): string {
  const cards = policy.layers[layer].map(key => policy.cards.find(card => card.key === key)!);
  return [`【${RHYTHM_LAYERS[layer].label}·节奏参考 v${version}】`, RHYTHM_LAYERS[layer].responsibility,
    '以下是候选，不必全用；按本书处境选择、组合或原创。承接上层责任，不逐层重复模板；重复方法须产生不同事件与结果。',
    ...cards.map(card => `- ${rhythmCardText(card)}`)].join('\n');
}

export function validateRhythmPolicy(value: unknown): RhythmPolicy {
  if (value === null || typeof value !== 'object') throw new Error('节奏配置不能为空。');
  const policy = value as RhythmPolicy;
  if (policy.schema !== 'wenmi-rhythm-policy-v1' || !Array.isArray(policy.cards) || policy.cards.length < 1 || policy.cards.length > 80
    || !policy.layers || typeof policy.layers !== 'object') throw new Error('节奏配置格式不完整。');
  const keys = new Set<string>();
  const text = (v: unknown, max: number): boolean => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  for (const card of policy.cards) {
    if (!card || !text(card.key, 100) || keys.has(card.key) || !Object.hasOwn(RHYTHM_CATEGORIES, card.category)
      || !text(card.title, 30) || !text(card.instruction, 120) || !text(card.boundary, 100)) throw new Error('短卡需有唯一编号、分类、名称、指令和边界；请缩短过长内容。');
    const exists = card.assetType === 'narrative_method' ? V7_NARRATIVE_METHODS.some(m => m.key === card.key)
      : card.assetType === 'plot_recipe' && V7_PLOT_RECIPES.some(r => r.key === card.key);
    if (!exists) throw new Error(`找不到短卡对应的原始资产：${card.key}`);
    keys.add(card.key);
  }
  for (const layer of Object.keys(RHYTHM_LAYERS) as PlanningLayerKey[]) {
    const selected = policy.layers[layer];
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > 6 || new Set(selected).size !== selected.length
      || selected.some(key => !keys.has(key))) throw new Error(`${RHYTHM_LAYERS[layer].label}请选择1～6张不同短卡。`);
    if (layer !== 'book_backbone' && layer !== 'volume_distribution'
      && selected.some(key => policy.cards.find(c => c.key === key)?.category === 'organization')) throw new Error('全书组织卡只提供给全书方向和分卷任务。');
    if (renderRhythmFragment(policy, layer, 999999).length > RHYTHM_FRAGMENT_LIMIT) throw new Error(`${RHYTHM_LAYERS[layer].label}资产片段超过${RHYTHM_FRAGMENT_LIMIT}字符，请精简短卡或减少候选。`);
  }
  return JSON.parse(JSON.stringify(policy)) as RhythmPolicy;
}
