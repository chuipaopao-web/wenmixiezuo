import {ContractError,parseCandidate,type Candidate} from './contracts.js';
import type {Adoption} from './store.js';
import type {TokenCounter} from './context.js';

/** Planning input only. Actual manuscript facts must be supplied separately by the later workstation. */
export function volumePlanningContext(candidateValue:Candidate,adoption:Adoption,volumeId:string,counter:TokenCounter,inputLimit:number){
 const candidate=parseCandidate(candidateValue),plan=candidate.plan;
 if(!Number.isSafeInteger(inputLimit)||inputLimit<=0)throw new ContractError('卷资料预算无效');
 const index=plan.volumes.findIndex(v=>v.id===volumeId);if(index<0)throw new ContractError('卷不属于采用方案');
 const volume=plan.volumes[index]!;
 const direct=new Set(volume.duties.map(d=>d.lineId));
 const related=plan.relations.filter(r=>direct.has(r.from)||direct.has(r.to));
 const included=new Set([...direct,...related.flatMap(r=>[r.from,r.to])]);
 const addParents=(id:string):void=>{for(const parent of plan.lines.find(l=>l.id===id)!.parentIds)if(!included.has(parent)){included.add(parent);addParents(parent);}};
 [...included].forEach(addParents);
 const lines=plan.lines.filter(l=>included.has(l.id)).map(line=>{
  const identity=adoption.mapping[`line:${line.id}`];if(!identity)throw new ContractError('采用方案缺少故事线编号');
  return {...line,stableId:identity.id,number:identity.number,assignment:direct.has(line.id)?'本卷职责':'交织背景'};
 });
 const input=JSON.stringify({sourceRole:'adopted-plan-not-manuscript-fact',notice:'以下是作者采用的未来规划，不代表正文已经发生。仅本卷职责要求在本卷推进；其他线仅提供交织背景。',baseline:plan.baseline,bookEnding:plan.ending,volume,lines,relations:related,expectations:plan.expectations.filter(e=>e.lineIds.some(id=>direct.has(id))),previous:index?{ending:plan.volumes[index-1]!.ending,handoff:plan.volumes[index-1]!.handoff}:null,next:index+1<plan.volumes.length?{id:plan.volumes[index+1]!.id,goal:plan.volumes[index+1]!.goal}:null});
 const tokens=counter.count(input);if(!Number.isSafeInteger(tokens)||tokens<=0||tokens>inputLimit)throw new ContractError('本卷交接资料超预算，需要资料成员进一步整理，未发送模型');
 return {adoptionId:adoption.id,adoptionRevision:adoption.revision,manifest:candidate.manifest,volumeId,input,tokens,counter:counter.id};
}
