import {ContractError,parseCandidate,type Candidate} from './contracts.js';
import type {Adoption} from './store.js';
import {volumeDisplayCode,lineDisplayCode} from './numbering.js';
import type {TokenCounter} from './context.js';

/** Planning input only. Actual manuscript facts must be supplied separately by the later workstation. */
export function volumePlanningContext(candidateValue:Candidate,adoption:Adoption,volumeId:string,counter:TokenCounter,inputLimit:number){
 const candidate=parseCandidate(candidateValue);
 if(!Number.isSafeInteger(inputLimit)||inputLimit<=0)throw new ContractError('卷资料预算无效');
 const plan=candidate.plan;
 const index=plan.volumes.findIndex(v=>v.id===volumeId);if(index<0)throw new ContractError('卷不属于采用方案');
 const unionVolume=plan.volumes[index]!;
 const direct=new Set(unionVolume.duties.map(d=>d.lineId));
 const related=plan.relations.filter(r=>direct.has(r.from)||direct.has(r.to));
 const included=new Set([...direct,...related.flatMap(r=>[r.from,r.to])]);
 const addParents=(id:string):void=>{for(const parent of plan.lines.find(l=>l.id===id)!.parentIds)if(!included.has(parent)){included.add(parent);addParents(parent);}};
 [...included].forEach(addParents);
 const emit=(input:string)=>{
  const tokens=counter.count(input);if(!Number.isSafeInteger(tokens)||tokens<=0||tokens>inputLimit)throw new ContractError('本卷交接资料超预算，需要资料成员进一步整理，未发送模型');
  return {adoptionId:adoption.id,adoptionRevision:adoption.revision,manifest:candidate.manifest,volumeId,input,tokens,counter:counter.id};
 };
 if(candidate.schemaVersion===1){
  const v1=candidate.plan;
  const lines=v1.lines.filter(l=>included.has(l.id)).map(line=>{
   const identity=adoption.mapping[`line:${line.id}`];if(!identity)throw new ContractError('采用方案缺少故事线编号');
   return {...line,stableId:identity.id,number:identity.number,assignment:direct.has(line.id)?'本卷职责':'交织背景'};
  });
  return emit(JSON.stringify({sourceRole:'adopted-plan-not-manuscript-fact',notice:'以下是作者采用的未来规划，不代表正文已经发生。仅本卷职责要求在本卷推进；其他线仅提供交织背景。',baseline:v1.baseline,bookEnding:v1.ending,volume:unionVolume,lines,relations:related,expectations:v1.expectations.filter(e=>e.lineIds.some(id=>direct.has(id))),previous:index?{ending:v1.volumes[index-1]!.ending,handoff:v1.volumes[index-1]!.handoff}:null,next:index+1<v1.volumes.length?{id:v1.volumes[index+1]!.id,goal:v1.volumes[index+1]!.goal}:null}));
 }
 // v2：本卷稳定身份（卷A）、全书与本卷字数预算、开场/收束锚点与相关线关键落点、职责约束强度；上卷实际结束卡明确未提供，不以规划冒充正文事实。
 const v2=candidate.plan;
 const volume=v2.volumes[index]!;
 const volumeIdentity=adoption.mapping[`volume:${volume.id}`];if(!volumeIdentity)throw new ContractError('采用方案缺少本卷编号');
 const lineIdentity=(id:string,role:'main'|'through'|'stage')=>{const identity=adoption.mapping[role==='main'?`main-line:${id}`:`branch-line:${id}`];if(!identity)throw new ContractError('采用方案缺少故事线编号');return identity;};
 const lines=v2.lines.filter(l=>included.has(l.id)).map(line=>{
  const identity=lineIdentity(line.id,line.role);
  return {...line,stableId:identity.id,number:identity.number,displayCode:lineDisplayCode(line.role==='main'?'main':'branch',identity.number),assignment:direct.has(line.id)?'本卷职责':'交织背景'};
 });
 const anchorIds=new Set(volume.duties.flatMap(d=>d.anchorIds));
 const anchorList=v2.anchors.filter(a=>a.ownerEntityId===volume.id||anchorIds.has(a.id)||direct.has(a.ownerEntityId));
 const milestones=v2.lines.filter(l=>direct.has(l.id)).flatMap(l=>l.milestones.map(m=>({lineId:l.id,lineDisplay:lineDisplayCode(l.role==='main'?'main':'branch',lineIdentity(l.id,l.role).number),...m})));
 const duties=volume.duties.map(d=>{const line=v2.lines.find(l=>l.id===d.lineId)!;const identity=lineIdentity(d.lineId,line.role);return {lineId:d.lineId,lineDisplay:lineDisplayCode(line.role==='main'?'main':'branch',identity.number),action:d.action,result:d.result,anchorIds:d.anchorIds,strength:d.strength,reason:d.reason};});
 const previousVolume=index?v2.volumes[index-1]!:null;
 const previousIdentity=previousVolume?adoption.mapping[`volume:${previousVolume.id}`]:undefined;if(previousVolume&&!previousIdentity)throw new ContractError('采用方案缺少上卷编号');
 const nextVolume=index+1<v2.volumes.length?v2.volumes[index+1]!:null;
 const nextIdentity=nextVolume?adoption.mapping[`volume:${nextVolume.id}`]:undefined;if(nextVolume&&!nextIdentity)throw new ContractError('采用方案缺少后卷编号');
 return emit(JSON.stringify({sourceRole:'adopted-plan-not-manuscript-fact',schemaVersion:2,notice:'以下是作者采用的未来规划，不代表正文已经发生。仅本卷职责要求在本卷推进；其他线仅提供交织背景。正文实际前情接口尚未提供，previous.actualEndingCard 为未提供，不得把规划交接当正文事实。',volume:{...volume,duties,displayCode:volumeDisplayCode(volumeIdentity.number),stableId:volumeIdentity.id,number:volumeIdentity.number},bookWords:v2.words,lines,relations:related,expectations:v2.expectations.filter(e=>e.lineIds.some(id=>direct.has(id))),anchors:anchorList,milestones,previous:previousVolume?{volumeId:previousVolume.id,displayCode:volumeDisplayCode(previousIdentity!.number),plannedEnding:previousVolume.ending,plannedHandoff:previousVolume.handoff,actualEndingCard:'not_provided：上卷实际结束卡由正文结算在后续批次提供，本包不含正文事实'}:null,next:nextVolume?{id:nextVolume.id,displayCode:volumeDisplayCode(nextIdentity!.number),goal:nextVolume.goal}:null}));
}
