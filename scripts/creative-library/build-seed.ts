import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { V7_NARRATIVE_METHODS } from '../../coauthoring-v7/backend/narrative-methods/narrative-method-library.js';
import { V7_PLOT_PATTERNS } from '../../coauthoring-v7/backend/plot-patterns/plot-pattern-library.js';
import { V7_PLOT_RECIPES } from '../../coauthoring-v7/backend/plot-patterns/plot-recipe-library.js';
import { AUDITED_METHODS, AUDIT_MERGES } from '../../coauthoring-v7/backend/planning-methods/audited-method-catalog.js';
import { METHOD_MERGES } from '../../coauthoring-v7/backend/planning-methods/complete-method-catalog.js';
import { ADDITIONAL_METHODS } from '../../coauthoring-v7/backend/planning-methods/additional-methods.js';
import { CREATIVE_ASSETS } from '../../rebuild/packages/agent-catalog/creative-assets.js';
import { validatePayload } from '../../apps/api/src/application/creative-reference/validation.js';
import { editorialSeeds, genreRows, type SeedEntry } from './editorial-seeds.js';

// 分类只作为待审列表入口，绝不沿用旧c/o/r等供应规则作新库的自动供应结论。
const categories:Record<string,string>={story_form:'阶段结构',macro_architecture:'宏观节奏',chronology:'时间组织',causal_dynamics:'事件发展',conflict_pressure:'阻力选择',scene_structure:'场景结构',character_arc:'人物变化',relationship_arc:'亲密关系',information_design:'悬念伏笔',emotional_rhythm:'情绪节奏',pacing_control:'叙述速度',serial_rhythm:'承接转场',viewpoint_voice:'视角声音',narrative_presentation:'叙述表现',theme_meaning:'欲望动机',closure_payoff:'长期兑现',container:'阶段结构',strategy:'目标行动',pressure:'阻力选择',turn:'事件发展',payoff:'阶段回报',bridge:'承接转场',recipe:'故事交织'};
const originals=[
 ...V7_NARRATIVE_METHODS.map(m=>({key:m.key,name:m.professionalName,summary:m.publicExplanation,category:m.dimension,source:'narrative-method-library',original:m})),
 ...V7_PLOT_PATTERNS.map(m=>({key:m.key,name:m.professionalName,summary:m.publicExplanation,category:m.category,source:'plot-pattern-library',original:m})),
 ...V7_PLOT_RECIPES.map(m=>({key:m.key,name:m.publicTitle,summary:m.publicExplanation,category:'recipe',source:'plot-recipe-library',original:m})),
 ...ADDITIONAL_METHODS.map(m=>({key:m.key,name:m.title,summary:m.intro,category:m.category,source:'additional-methods',original:m}))
];
const legacyMethods:SeedEntry[]=originals.map(m=>({key:`method-${m.key}`,source:`${m.source}:${m.key}`,review:'legacy-unreviewed',payload:{assetKind:'method',name:m.name,shortPhrase:m.name,summary:m.summary,aliases:[m.key],method:{title:m.name,instruction:m.summary,boundary:'历史内容待逐条复核；当前分类仅供整理，尚未确定本层适用条件，不自动供给AI。',usageTree:categories[m.category]??'审查与修订',applicableLayers:[],aliases:[m.key]}}}));
const creative:SeedEntry[]=CREATIVE_ASSETS.map(m=>({key:`creative-${m.id}`,source:`creative-166-1:${m.id}`,review:'legacy-unreviewed',payload:{assetKind:'reference',name:m.name,shortPhrase:m.name,summary:m.summary,aliases:[m.id],reference:{kind:'mechanism',facets:{genres:[],mechanisms:[m.name],experiences:[],purposes:['横向机制']},stages:[],useWhen:['历史创意候选，适用情境待复核。'],questions:[],possibilities:[m.summary],imbalanceChecks:['不得因为卡片存在就把该机制加入作者书籍；须先核对作者方向。'],examples:[],relatedCards:[],methodRefs:[],evidence:{kind:'editorial_heuristic',refs:[],limitations:`原分类：${m.category}；旧资产迁入待审，不代表已复核或实测。`}}}}));
export const seed={schemaVersion:1,batch:'r209-c1',entries:[...legacyMethods,...creative,...editorialSeeds]};
for(const e of seed.entries)validatePayload(e.payload);
if(new Set(seed.entries.map(e=>e.key)).size!==seed.entries.length)throw Error('重复种子身份');
const out=resolve(process.argv[2]??'.local/r209-c1');mkdirSync(out,{recursive:true});
const json=JSON.stringify(seed,null,2)+'\n';
writeFileSync(resolve(out,'seed.json'),json);
writeFileSync(resolve(out,'seed.sha256'),createHash('sha256').update(json).digest('hex')+'\n');
const audit={batch:seed.batch,counts:{methods:legacyMethods.length,legacyCreative:creative.length,genres:genreRows.length,editorial:editorialSeeds.length,total:seed.entries.length},status:'全部草稿；C2独立内容复核与正式发布未完成',genreCoverage:genreRows.map(r=>r[1]),originalMethods:originals.map(m=>({seedKey:`method-${m.key}`,source:m.source,original:m.original,priorAudit:AUDITED_METHODS.find(a=>a.key===m.key)??null})),originalCreative:CREATIVE_ASSETS,mergeCandidates:{complete:METHOD_MERGES,audited:AUDIT_MERGES},limitations:['未执行任何语义合并；两套旧合并判断仅供复核，不作为事实。','未构成全题材子方向穷尽，跨机制组合与引用边尚待C2。','此数据不来源于作者书籍，不访问或回填旧书。']};
writeFileSync(resolve(out,'content-audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({out,counts:audit.counts,sha256:createHash('sha256').update(json).digest('hex')}));
