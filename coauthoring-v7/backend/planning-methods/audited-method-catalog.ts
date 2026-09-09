import { V7_NARRATIVE_METHODS } from '../narrative-methods/narrative-method-library.js';
import { V7_PLOT_PATTERNS } from '../plot-patterns/plot-pattern-library.js';
import { V7_PLOT_RECIPES } from '../plot-patterns/plot-recipe-library.js';
import { AUDITED_NARRATIVE_RULES } from './audited-narrative-rules.js';
import { AUDITED_PATTERN_RULES } from './audited-pattern-rules.js';
import { AUDITED_METHOD_COPY, AUDITED_METHOD_TITLES } from './audited-method-copy.js';

export const AUDIT_TASKS = ['全书方向','粗分卷','卷设计','链设计','章设计'] as const;
export const AUDIT_SUPPLY = {c:'常规候选',o:'按需参考',i:'承接已选',r:'复核原则','-':'不自动提供'} as const;
export type AuditSupply = keyof typeof AUDIT_SUPPLY;
export const AUDIT_CATEGORIES: Record<string,string> = {
 story_form:'故事形态',macro_architecture:'宏观节奏',chronology:'时间组织',causal_dynamics:'因果推进',
 conflict_pressure:'冲突与压力',scene_structure:'场景结构',character_arc:'人物弧光',relationship_arc:'关系变化',
 information_design:'信息与悬念',emotional_rhythm:'情绪节奏',pacing_control:'叙事速度',serial_rhythm:'连载衔接',
 viewpoint_voice:'视角与声音',narrative_presentation:'叙述表现',theme_meaning:'立意与价值',closure_payoff:'收束与兑现',
 container:'故事容器',strategy:'行动策略',pressure:'压力条件',turn:'局势转折',payoff:'结果回报',bridge:'过渡衔接',recipe:'组合示例'
};
export interface AuditedMethod {
 key:string;title:string;family:string;category:string;intro:string;when:string;states:AuditSupply[];
 originalIntro:string;aliases:{key:string;title:string;category:string}[];
}
const rules=new Map<string,{states:AuditSupply[];when:string}>();
for(const line of `${AUDITED_NARRATIVE_RULES}\n${AUDITED_PATTERN_RULES}`.split('\n')){
 const [key,states,when]=line.trim().split('|');
 if(!key||rules.has(key)||!states||!/^[coir-]{5}$/.test(states)||!when)throw Error(`方法审阅规则不完整：${key}`);
 rules.set(key,{states:states.split('') as AuditSupply[],when});
}
const original=[
 ...V7_NARRATIVE_METHODS.map(m=>({key:m.key,title:m.professionalName,category:m.dimension,intro:m.publicExplanation,family:'叙事方法'})),
 ...V7_PLOT_PATTERNS.map(m=>({key:m.key,title:m.professionalName,category:m.category,intro:m.publicExplanation,family:'剧情素材'})),
 ...V7_PLOT_RECIPES.map(m=>({key:m.key,title:m.publicTitle,category:'recipe',intro:m.publicExplanation,family:'组合示例'}))
];
if(original.length!==rules.size||original.some(m=>!rules.has(m.key)))throw Error('方法原始来源与逐项审阅未一一对应');
export const AUDIT_MERGES = [
 {from:'motif-transformation',to:'symbolic-motif',reason:'都以反复意象随经历改变意义，保留主题与表现两个入口。'},
 {from:'deadline-pressure',to:'ticking-clock',reason:'都由可信期限迫使人物行动；保留剧情素材原名入口。'},
 {from:'resource-scarcity',to:'resource-squeeze',reason:'都以有限资源改变取舍；保留原名，避免重复注入。'},
 {from:'moral-dilemma',to:'true-dilemma',reason:'都组织不能兼得的重要价值选择；素材与方法共享定义。'},
 {from:'time-skip-transition',to:'time-ellipsis',reason:'都跳过稳定重复期；合并说明保留必要状态结算。'}
] as const;
export const AUDIT_RESTORED = [
 {key:'counterpoint-juxtaposition',other:'parallel-contrast-structure',reason:'具体表达的并置与长期平行故事组织不同。'},
 {key:'bittersweet-exchange',other:'bittersweet-ending',reason:'当前事件结果与全书结局方向不同，不能互相强制。'},
 {key:'clues-reframe-understanding',other:'layered-truth',reason:'小问题改变行动的组合与多层谜团的组织责任不同。'}
] as const;
const reviewed:AuditedMethod[]=original.map(m=>({
 ...m,title:AUDITED_METHOD_TITLES[m.key]??m.title,intro:AUDITED_METHOD_COPY[m.key]??m.intro,
 originalIntro:m.intro,...rules.get(m.key)!,aliases:[]
}));
for(const merge of AUDIT_MERGES){
 const from=reviewed.find(m=>m.key===merge.from)!,to=reviewed.find(m=>m.key===merge.to)!;
 to.aliases.push({key:from.key,title:from.title,category:from.category});
}
export const AUDITED_METHODS=reviewed.filter(m=>!AUDIT_MERGES.some(a=>a.from===m.key));
export const AUDIT_ORIGINAL_COUNT=original.length;
export const AUDIT_COPY_CHANGES=reviewed.filter(m=>m.intro!==m.originalIntro).length;
export function auditMethodName(key:string):string{return reviewed.find(m=>m.key===key)?.title??key;}
