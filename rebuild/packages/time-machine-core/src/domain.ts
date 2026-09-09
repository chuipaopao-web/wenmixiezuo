/** New time-machine domain. No legacy planning, settlement, or UI imports. */
export interface Scope { ownerId:string; bookId:string }
export type StructurePreference='auto'|'single'|'multiple';
export interface AuthorIntent { version:string; structure:StructurePreference; ensemble:boolean; selectedTypes:string[]; custom:string }
export type LineRole='main'|'through'|'stage';
export interface StoryLine { id:string; number:number; role:LineRole; title:string; goal:string; parentIds:string[] }
export interface PromiseSeed { id:string; number:number; title:string; promise:string; lineIds:string[] }
export interface StoryPlan extends Scope { version:string; lines:StoryLine[]; seeds:PromiseSeed[] }
export interface FormalChapter extends Scope { version:string; chapter:number; text:string }
export interface Evidence { chapterVersion:string; start:number; end:number; quote:string }
export type LineState='not_started'|'active'|'paused'|'closed'|'stopped';
export type SeedState='planned'|'planted'|'developing'|'partial'|'answered'|'withdrawn';
export type Change=
 | {kind:'line';targetId:string;state:Exclude<LineState,'not_started'>;summary:string}
 | {kind:'seed';targetId:string;state:Exclude<SeedState,'planned'>;summary:string}
 | {kind:'intersection';lineIds:string[];summary:string};
export interface RecordedEvent extends Scope {
 id:string; chapterVersion:string; chapter:number; order:number; dependencies:string[];
 change:Change; evidence:Evidence[]; memberId:string; assessment:'supported'|'uncertain';
}
export interface LineProjection { line:StoryLine; state:LineState; needsReview:boolean; eventIds:string[] }
export interface SeedProjection { seed:PromiseSeed; state:SeedState; needsReview:boolean; eventIds:string[] }
export interface StoryProjection { lines:LineProjection[];seeds:SeedProjection[];events:RecordedEvent[];invalidEventIds:string[];uncertainEventIds:string[] }

export function assertScope(expected:Scope,actual:Scope):void {
 if(expected.ownerId!==actual.ownerId||expected.bookId!==actual.bookId)throw Error('资料不属于当前作者或书籍');
}
const nonempty=(s:string)=>typeof s==='string'&&s.trim().length>0;
function unique(values:readonly unknown[],label:string):void { if(new Set(values).size!==values.length)throw Error(`${label}重复`); }
export function validatePlan(plan:StoryPlan):void {
 if(!nonempty(plan.version)||!nonempty(plan.ownerId)||!nonempty(plan.bookId))throw Error('规划身份不完整');
 unique(plan.lines.map(x=>x.id),'故事线ID');unique(plan.lines.map(x=>x.number),'故事线编号');
 unique(plan.seeds.map(x=>x.id),'伏笔ID');unique(plan.seeds.map(x=>x.number),'伏笔编号');
 for(const line of plan.lines){
  if(!nonempty(line.id)||!nonempty(line.title)||!nonempty(line.goal)||!Number.isSafeInteger(line.number)||line.number<1)throw Error('故事线不完整');
  unique(line.parentIds,'故事线关联');
  if(line.parentIds.some(id=>id===line.id||!plan.lines.some(x=>x.id===id)))throw Error('故事线关联不存在或引用自己');
 }
 const visit=(id:string,path:Set<string>):void=>{if(path.has(id))throw Error('故事线归属形成循环');const next=new Set(path).add(id);for(const p of plan.lines.find(x=>x.id===id)!.parentIds)visit(p,next);};
 for(const line of plan.lines)visit(line.id,new Set());
 for(const seed of plan.seeds){
  if(!nonempty(seed.id)||!nonempty(seed.title)||!nonempty(seed.promise)||!Number.isSafeInteger(seed.number)||seed.number<1)throw Error('伏笔不完整');
  unique(seed.lineIds,'伏笔关联');if(seed.lineIds.some(id=>!plan.lines.some(x=>x.id===id)))throw Error('伏笔关联不存在');
 }
}

/** Platform verifies formal acceptance before providing these chapters. Exact excerpts are checked here. */
export function validateEvent(scope:Scope,plan:StoryPlan,event:RecordedEvent,source:FormalChapter):void {
 assertScope(scope,plan);assertScope(scope,event);assertScope(scope,source);
 if(!nonempty(event.id)||!nonempty(event.memberId)||!nonempty(event.change.summary)||!Number.isSafeInteger(event.order)||event.order<0)throw Error('记录不完整');
 if(event.chapter!==source.chapter||event.chapterVersion!==source.version)throw Error('正文版本不匹配');
 if(!Number.isSafeInteger(event.chapter)||event.chapter<1)throw Error('章节位置无效');
 unique(event.dependencies,'前置记录');if(event.dependencies.includes(event.id))throw Error('记录不能依赖自身');
 if(event.evidence.length===0)throw Error('记录缺少正文证据');
 for(const ref of event.evidence){
  if(ref.chapterVersion!==source.version||!Number.isSafeInteger(ref.start)||!Number.isSafeInteger(ref.end)||ref.start<0||ref.end<=ref.start||ref.end>source.text.length||source.text.slice(ref.start,ref.end)!==ref.quote)throw Error('正文证据位置或原文不一致');
 }
 const c=event.change;
 if(c.kind==='line'&&(!plan.lines.some(x=>x.id===c.targetId)||!['active','paused','closed','stopped'].includes(c.state)))throw Error('故事线记录对象或状态无效');
 if(c.kind==='seed'&&(!plan.seeds.some(x=>x.id===c.targetId)||!['planted','developing','partial','answered','withdrawn'].includes(c.state)))throw Error('伏笔记录对象或状态无效');
 if(c.kind==='intersection'){unique(c.lineIds,'交汇对象');if(c.lineIds.length<2||c.lineIds.some(id=>!plan.lines.some(x=>x.id===id)))throw Error('交汇对象不足或不存在');}
}

/** Pure rebuild from current formal versions; stale/uncertain evidence never grows fruit. */
export function projectStory(plan:StoryPlan,chapters:readonly FormalChapter[],input:readonly RecordedEvent[]):StoryProjection {
 validatePlan(plan);const sources=new Map<string,FormalChapter>(),byChapter=new Set<number>();
 for(const source of chapters){assertScope(plan,source);if(byChapter.has(source.chapter)||sources.has(source.version))throw Error('同一章节存在多个当前正式版本');byChapter.add(source.chapter);sources.set(source.version,source);}
 const events=[...input].sort((a,b)=>a.chapter-b.chapter||a.order-b.order||a.id.localeCompare(b.id));
 const seen=new Map<string,string>(),valid=new Set<string>(),invalid:string[]=[],uncertain:string[]=[],accepted:RecordedEvent[]=[];
 const lines=plan.lines.map(line=>({line,state:'not_started' as LineState,needsReview:false,eventIds:[] as string[]}));
 const seeds=plan.seeds.map(seed=>({seed,state:'planned' as SeedState,needsReview:false,eventIds:[] as string[]}));
 const flag=(c:Change)=>{if(c.kind==='line'){const x=lines.find(x=>x.line.id===c.targetId);if(x)x.needsReview=true;}else if(c.kind==='seed'){const x=seeds.find(x=>x.seed.id===c.targetId);if(x)x.needsReview=true;}else for(const id of c.lineIds){const x=lines.find(x=>x.line.id===id);if(x)x.needsReview=true;}};
 for(const event of events){
  assertScope(plan,event);const encoded=JSON.stringify(event),duplicate=seen.get(event.id);
  if(duplicate!==undefined){if(duplicate!==encoded)throw Error('相同事件ID内容发生变化');continue;}seen.set(event.id,encoded);
  const source=sources.get(event.chapterVersion);
  if(!source||event.dependencies.some(id=>!valid.has(id))){invalid.push(event.id);flag(event.change);continue;}
  validateEvent(plan,plan,event,source);
  if(event.assessment!=='supported'){uncertain.push(event.id);flag(event.change);continue;}
  valid.add(event.id);accepted.push(event);
  if(event.change.kind==='line'){const change=event.change,x=lines.find(x=>x.line.id===change.targetId)!;x.state=change.state;x.eventIds.push(event.id);}
  else if(event.change.kind==='seed'){const change=event.change,x=seeds.find(x=>x.seed.id===change.targetId)!;x.state=change.state;x.eventIds.push(event.id);}
  // Intersections remain events and do not overwrite line lifecycle.
 }
 return {lines,seeds,events:accepted,invalidEventIds:invalid,uncertainEventIds:uncertain};
}

export function markers(projection:StoryProjection,lineId:string):{fruit:boolean;leafIds:string[];needsReview:boolean} {
 const line=projection.lines.find(x=>x.line.id===lineId);if(!line)throw Error('故事线不存在');
 const seeds=projection.seeds.filter(x=>x.seed.lineIds.includes(lineId));
 return {fruit:line.state==='closed'&&!line.needsReview,
  leafIds:seeds.filter(x=>['planted','developing','partial'].includes(x.state)&&!x.needsReview).map(x=>x.seed.id),
  needsReview:line.needsReview||seeds.some(x=>x.needsReview)};
}

/** Number allocation occurs in a storage transaction; archived numbers are retained by the port. */
export function nextDisplayNumber(allAllocated:readonly number[]):number {
 if(allAllocated.some(x=>!Number.isSafeInteger(x)||x<1))throw Error('编号记录无效');
 const n=Math.max(0,...allAllocated)+1;if(!Number.isSafeInteger(n))throw Error('编号超过可用范围');return n;
}
