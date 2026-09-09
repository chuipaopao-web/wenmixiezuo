import { AUDITED_METHODS, AUDIT_CATEGORIES, AUDIT_TASKS } from './audited-method-catalog.js';
import type { PlanningLayerKey } from './method-asset-profiles.js';
import type { RhythmCard, RhythmPolicy, RhythmPolicySnapshot } from './rhythm-policy.js';
import { ADDITIONAL_METHODS } from './additional-methods.js';

export const METHOD_LAYERS: PlanningLayerKey[]=['book_backbone','volume_distribution','volume','chain','chapter_execution'];
export const AUDITED_RUNTIME_CARDS: RhythmCard[]=[...AUDITED_METHODS,...ADDITIONAL_METHODS].map(m=>({
 key:m.key,title:m.title,instruction:m.intro,boundary:m.when,
 assetType:m.family==='叙事方法'?'narrative_method':m.family==='剧情素材'?'plot_pattern':'plot_recipe',
 category:['story_form','macro_architecture','chronology','container'].includes(m.category)?'organization':
 ['character_arc','relationship_arc','causal_dynamics','theme_meaning'].includes(m.category)?'progression':m.family==='剧情素材'?'event':'rhythm',
 methodCategory:m.category,aliasKeys:m.aliases.map(a=>a.key),layerHints:[...m.states]
}));
export const AUDITED_RUNTIME_POLICY:RhythmPolicy={schema:'wenmi-rhythm-policy-v1',format:'audited-v4',cards:AUDITED_RUNTIME_CARDS,
 layers:Object.fromEntries(METHOD_LAYERS.map(l=>[l,AUDITED_RUNTIME_CARDS.map(c=>c.key)])) as Record<PlanningLayerKey,string[]>};
export function methodNavigation(policy:RhythmPolicy,layer:PlanningLayerKey,version:number|string):string {
 const groups=Object.entries(AUDIT_CATEGORIES).map(([key,title])=>({key,title,count:policy.cards.filter(c=>c.methodCategory===key).length})).filter(g=>g.count);
 return [`[method-agent:v${version}:${layer}]`,`【方法查询导航 v${version}】`,`方法按需查询，本层为${AUDIT_TASKS[METHOD_LAYERS.indexOf(layer)]}。已有上游用法足够可直接设计；可不用方法、跨层查找或原创。`,
 ...groups.map(g=>`${g.key}：${g.title}（${g.count}）`),'名称和分类只是检索入口，成员判断具体适用性；不要浏览整个库。'].join('\n');
}
export interface MethodToolCall {name:'list_method_categories'|'search_methods'|'read_methods';arguments:Record<string,unknown>}
export function executeMethodTool(snapshot:RhythmPolicySnapshot,layer:PlanningLayerKey,call:MethodToolCall):unknown {
 const {policy,version}=snapshot;const a=call.arguments;
 if(!a||typeof a!=='object'||Array.isArray(a))throw Error('工具参数必须是对象');
 const allowed=call.name==='list_method_categories'?[]:call.name==='search_methods'?['query','category','cursor']:call.name==='read_methods'?['ids']:null;
 if(!allowed||Object.keys(a).some(k=>!allowed.includes(k)))throw Error('工具名称或参数不允许');
 if(call.name==='list_method_categories')return {version,categories:Object.entries(AUDIT_CATEGORIES).map(([key,title])=>({key,title,count:policy.cards.filter(c=>c.methodCategory===key).length})).filter(g=>g.count)};
 if(call.name==='read_methods'){
  if(!Array.isArray(a.ids)||a.ids.length<1||a.ids.length>8||a.ids.some(id=>typeof id!=='string'||id.length>100))throw Error('每次读取1至8个方法ID');
  return {version,cards:a.ids.map(id=>{const card=policy.cards.find(c=>c.key===id||c.aliasKeys?.includes(id as string));
   return card?{requestedId:id,id:card.key,title:card.title,intro:card.instruction,usage:card.boundary,layerHint:card.layerHints?.[METHOD_LAYERS.indexOf(layer)]??'o'}:{requestedId:id,error:'方法不存在'};})};
 }
 const query=a.query??'',category=a.category??'',cursor=a.cursor??0;
 if(typeof query!=='string'||query.length>200||typeof category!=='string'||(category&&!Object.hasOwn(AUDIT_CATEGORIES,category))||!Number.isSafeInteger(cursor)||Number(cursor)<0)throw Error('查询参数无效');
 const terms=query.toLowerCase().split(/\s+/u).filter(Boolean);
 const cards=policy.cards.filter(c=>!category||c.methodCategory===category).filter(c=>!terms.length||terms.some(t=>[c.key,c.title,c.instruction,c.boundary,...c.aliasKeys??[]].join(' ').toLowerCase().includes(t)));
 const ordered=cards.map((c,i)=>({c,i,rank:c.layerHints?.[METHOD_LAYERS.indexOf(layer)]==='c'?0:1})).sort((a,b)=>a.rank-b.rank||a.i-b.i).map(x=>x.c);
 const page=ordered.slice(Number(cursor),Number(cursor)+20);
 return {version,total:cards.length,cursor,nextCursor:Number(cursor)+20<cards.length?Number(cursor)+20:null,
  note:'文本匹配仅帮助发现；没找到可换分类、不填关键词浏览该类，或原创。层级不是禁用规则。',
  cards:page.map(c=>({id:c.key,title:c.title,intro:c.instruction,layerHint:c.layerHints?.[METHOD_LAYERS.indexOf(layer)]??'o'}))};
}
