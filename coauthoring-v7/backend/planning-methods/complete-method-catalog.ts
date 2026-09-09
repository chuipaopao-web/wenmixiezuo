import { V7_NARRATIVE_METHODS } from '../narrative-methods/narrative-method-library.js';
import { V7_PLOT_PATTERNS } from '../plot-patterns/plot-pattern-library.js';
import { V7_PLOT_RECIPES } from '../plot-patterns/plot-recipe-library.js';
import type { PlanningLayerKey } from './method-asset-profiles.js';
import type { RhythmCard } from './rhythm-policy.js';

const ALL: PlanningLayerKey[] = ['book_backbone','volume_distribution','volume','chain','chapter_execution'];
// Semantic audit: only equivalent mechanisms merge. Combinations and narrower use cases remain distinct.
export const METHOD_MERGES = [
  {from:'motif-transformation',to:'symbolic-motif',reason:'均为重复意象随人物经历改变意义，合并层级适用范围。'},
  {from:'counterpoint-juxtaposition',to:'parallel-contrast-structure',reason:'均通过并置不同场面或人物形成对照，保留大结构与小场景两种尺度。'},
  {from:'deadline-pressure',to:'ticking-clock',reason:'均由明确期限迫使行动和取舍。'},
  {from:'resource-scarcity',to:'resource-squeeze',reason:'均用有限资源迫使排序和取舍。'},
  {from:'moral-dilemma',to:'true-dilemma',reason:'均要求在不能兼得的重要价值间承担选择损失。'},
  {from:'time-skip-transition',to:'time-ellipsis',reason:'均跳过稳定重复过程，保留影响后续的变化。'},
  {from:'bittersweet-exchange',to:'bittersweet-ending',reason:'均获得重要目标同时永久失去另一项珍贵之物。'},
  {from:'clues-reframe-understanding',to:'layered-truth',reason:'均由证据、判断、重释、回答构成解谜进程，原区别主要在规模。'}
] as const;
const scopeLayers = (scopes: readonly string[]): PlanningLayerKey[] => ALL.filter(layer =>
  layer === 'book_backbone' || layer === 'volume_distribution' ? scopes.includes('book') || scopes.includes('storyline')
    : layer === 'volume' ? scopes.includes('volume')
    : layer === 'chain' ? scopes.includes('event') || scopes.includes('scene')
    : scopes.includes('chapter') || scopes.includes('scene'));
const macroText: Record<string,string> = {
  'story-completeness':'建立局面—发生变化—给出阶段结果。',
  'three-act':'建立目标—展开行动—解决主要问题。',
  'four-act':'起因—过程—转折—合拢。',
  'five-act':'开端—发展—高潮—变化落定—收束。',
  'six-act':'进入—转向—升级—危机—重整—解决。',
  'hero-journey':'离开熟悉处境，经受考验，带着收获或认知变化返回。',
  'eight-sequence':'把故事分成八个各有责任、互相承接的推进区段。',
  'seven-point':'起点—转向—施压—中点变化—再施压—主动突破—结果。',
  'story-circle':'需要—出发—适应—取得—付出—返回—改变。',
  'save-the-cat':'展示卖点，让转折改变胜负意义，经危机和新选择完成高潮。',
  'truby-22':'围绕欲望、弱点、对手、计划和关键选择展开长期变化。',
  'field-paradigm':'建立目标，用两次关键转折进入行动并集中解决。',
  'fichtean-curve':'迅速进入冲突，连续危机逼近高潮，随后结算。',
  'kishotenketsu':'建立日常—展开—意外视角—重新连接，不必依赖对抗。'
};
export interface CompleteMethodCard extends RhythmCard { applicableLayers: PlanningLayerKey[]; aliases: {key:string;title:string;assetType:RhythmCard['assetType']}[]; }
const raw: CompleteMethodCard[] = [
  ...V7_NARRATIVE_METHODS.map(m => ({key:m.key,assetType:'narrative_method' as const,
    title:({'three-act':'三幕式','four-act':'起承转合','five-act':'五阶段','six-act':'六阶段'} as Record<string,string>)[m.key] ?? m.professionalName,
    category: (['story_form','macro_architecture','chronology'].includes(m.dimension)?'organization':
      ['scene_structure','conflict_pressure'].includes(m.dimension)?'event':
      ['character_arc','relationship_arc','causal_dynamics','theme_meaning'].includes(m.dimension)?'progression':'rhythm') as RhythmCard['category'],
    instruction:macroText[m.key] ?? m.publicExplanation,boundary:'',
    // Structure describes responsibilities, not a mandatory book length. It also works for complete small stories.
    applicableLayers:['story_form','macro_architecture','chronology','causal_dynamics','conflict_pressure','character_arc','relationship_arc','information_design','emotional_rhythm','theme_meaning','closure_payoff'].includes(m.dimension)?[...ALL]:scopeLayers(m.applicableScopes),aliases:[] })),
  ...V7_PLOT_PATTERNS.map(p=>({key:p.key,assetType:'plot_pattern' as const,title:p.professionalName,
    category:(p.category==='container'?'organization':p.category==='bridge'?'rhythm':'event') as RhythmCard['category'],
    instruction:p.publicExplanation,boundary:'',applicableLayers:[...ALL],aliases:[]})),
  ...V7_PLOT_RECIPES.map(r=>({key:r.key,assetType:'plot_recipe' as const,title:r.publicTitle,
    category:'progression' as const,instruction:r.publicExplanation,boundary:'',applicableLayers:[...ALL],aliases:[]}))
];
if(new Set(raw.map(c=>c.key)).size!==raw.length)throw Error('原资产存在重复编号，需要显式消歧。');
for(const merge of METHOD_MERGES){
  const from=raw.find(c=>c.key===merge.from)!,to=raw.find(c=>c.key===merge.to)!;
  if(!from||!to)throw Error('方法合并来源缺失');
  to.aliases.push({key:from.key,title:from.title,assetType:from.assetType});
  to.applicableLayers=ALL.filter(layer=>to.applicableLayers.includes(layer)||from.applicableLayers.includes(layer));
}
export const COMPLETE_METHOD_CARDS: readonly CompleteMethodCard[] = raw.filter(c=>!METHOD_MERGES.some(m=>m.from===c.key));
export const COMPLETE_METHOD_LAYERS = Object.fromEntries(ALL.map(layer=>[layer,COMPLETE_METHOD_CARDS.filter(c=>c.applicableLayers.includes(layer)).map(c=>c.key)])) as Record<PlanningLayerKey,string[]>;
export const ORIGINAL_METHOD_COUNTS = {methods:V7_NARRATIVE_METHODS.length,patterns:V7_PLOT_PATTERNS.length,recipes:V7_PLOT_RECIPES.length};
