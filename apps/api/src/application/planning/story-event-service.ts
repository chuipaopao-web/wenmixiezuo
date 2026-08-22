import {
  hashStableContractContent, parsePlanningTemplateInstance, parseStoryEventContent,
  parseVolumePlanContent, type EventChainNode, type EventSequenceItem, type PlanningTemplateInstance,
  type StoryEventContent, type VersionReference
} from '@wenmi/contracts';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import type { LayeredPlanningService } from './layered-planning-service.js';
import {
  StoryEventRepository, type EventSequenceOperationRow, type StoryEventCandidateKind,
  type StoryEventRow, type StoryEventVersionRow
} from '../../infrastructure/db/repositories/story-event-repository.js';

const KINDS = ['candidate_a','candidate_b','author_edit','fusion','volume_seed'] as const;
export interface StoryEventVersionView {
  storyEventVersionId:string; eventId:string; version:number; parentVersionId:string|null;
  status:StoryEventVersionRow['status']; candidateKind:StoryEventCandidateKind;
  volumePlanVersionId:string; previousSettlementId:string|null; dependencies:VersionReference[];
  template:PlanningTemplateInstance; authorInputRefs:string[]; content:StoryEventContent;
  contentHash:string; sourceTaskId:string|null; createdAt:string; confirmedAt:string|null;
}
export interface StoryEventView {
  eventId:string; volumePlanId:string; order:number; status:StoryEventRow['status']; revision:number;
  previousEventId:string|null; activeVersionId:string|null; activeVersion:StoryEventVersionView|null;
  latestVersion:StoryEventVersionView|null; downstreamDependencyCount:number; createdAt:string; updatedAt:string;
}
export type EventOperationProposal =
 | {operationKind:'reorder';eventIds:string[]}
 | {operationKind:'insert';afterEventId:string|null;content:StoryEventContent}
 | {operationKind:'split';eventId:string;first:StoryEventContent;second:StoryEventContent}
 | {operationKind:'merge';eventIds:[string,string];merged:StoryEventContent};
export interface EventOperationImpact {
  affectedEventIds:string[]; settledEventIds:string[]; activeEventIds:string[]; downstreamDependencyCount:number;
  resultingTitles:string[]; blocked:boolean; note:string;
}
export interface EventOperationView {
  operationId:string; operationKind:EventSequenceOperationRow['operation_kind'];
  expectedSequenceRevision:number; resultSequenceRevision:number|null; proposal:EventOperationProposal;
  impact:EventOperationImpact; status:EventSequenceOperationRow['status']; createdAt:string; appliedAt:string|null;
}
export interface EventSequenceView {
  volumePlanId:string; volumePlanVersionId:string; revision:number; events:StoryEventView[];
  operations:EventOperationView[]; updatedAt:string;
}

export class StoryEventService {
  public constructor(
    private readonly repo:StoryEventRepository, private readonly uow:UnitOfWork,
    private readonly ids:IdGenerator, private readonly clock:Clock,
    private readonly layered?:LayeredPlanningService
  ) {}

  public getSequence(scope:BookScope, volumeId:string):EventSequenceView|null {
    const row=this.repo.sequence(scope,req(volumeId,'卷规划标识'));
    return row===undefined?null:this.sequenceView(scope,row);
  }

  public initialize(scope:BookScope, volumeId:string, input:{expectedWorkflowVersion:number;idempotencyKey:string}):EventSequenceView {
    const expected=pos(input.expectedWorkflowVersion,'工作流版本'), key=req(input.idempotencyKey,'幂等键');
    const now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const replay=this.repo.sequence(scope,volumeId);
      if(replay!==undefined)return this.sequenceView(scope,replay);
      const volume=this.activeVolume(scope,volumeId), workflow=this.workflow(scope);
      if(workflow.planning_version!==expected||workflow.active_volume_plan_id!==volumeId
        ||workflow.active_volume_plan_version_id!==volume.active_version_id)throw conflict('当前卷或创作流程已经变化，请刷新后重试。');
      if(!['volume_plan_confirmed','event_sequence_in_progress'].includes(workflow.stage))throw conflict('请先确认分卷。');
      const activeChain=this.layered?.activeEventChain(scope,volumeId)??null;
      if(this.layered!==undefined&&activeChain===null)throw conflict('请先让团队设计并确认当前卷事件链。');
      const plan=activeChain===null?parseVolumePlanContent(JSON.parse(volume.content_json) as unknown):null;
      const seeds:Array<{order:number;source:unknown;content:StoryEventContent}>=activeChain!==null
        ?activeChain.content.events.map((node,index,nodes)=>{
          const assigned=this.layered?.eventRoleCharacters(scope,activeChain.id,node.nodeId)??[];
          const required=node.roleFunctions??[];
          const assignedKeys=new Set(assigned.map((item)=>item.roleFunctionKey));
          const missing=required.filter((item)=>!assignedKeys.has(item.roleFunctionKey));
          if(missing.length>0)throw conflict(`事件“${node.title}”仍有未绑定角色功能：${missing.map((item)=>item.roleFunctionLabel).join('、')}`);
          return {order:node.order,source:{node,assigned},content:chainNodeContent(node,
            index===0?'卷方向确认后的开场局面触发事件。':nodes[index-1]?.leadsToNext??'上一事件的实际结果形成新的进入状态。',
            assigned.map((item)=>item.characterName))};
        })
        :(plan?.eventSequence??[]).map(seed=>({order:seed.order,source:seed,content:seedContent(seed)}));
      if(seeds.length===0)throw conflict('当前卷还没有已确认的事件链。');
      this.repo.insertSequence(scope,{volumePlanId:volumeId,volumePlanVersionId:volume.active_version_id,now});
      let previous:string|null=null;
      for(const seed of seeds){
        const eventId=this.ids.next();
        this.repo.insertEvent(scope,{eventId,volumePlanId:volumeId,sequenceOrder:seed.order,previousEventId:previous,
          previousSettlementId:null,idempotencyKey:key+':event:'+seed.order,requestHash:hash(seed.source),now});
        const event=this.event(scope,eventId);
        this.store(scope,event,{candidateKind:'volume_seed',parentVersionId:null,sourceTaskId:null,authorInputRefs:[],
          template:noTemplate(),content:seed.content,idempotencyKey:key+':seed:'+seed.order,
          requestHash:hash({eventId,source:seed.source}),now,dependencies:[volumeRef(volume)]});
        previous=eventId;
      }
      if(!this.repo.updateWorkflowForSequence(scope,{volumePlanId:volumeId,volumePlanVersionId:volume.active_version_id,
        expectedPlanningVersion:expected,now}))throw conflict('创作流程已经变化，请刷新后重试。');
      return this.sequenceView(scope,this.sequence(scope,volumeId));
    });
  }

  public listVersions(scope:BookScope,eventId:string):StoryEventVersionView[]{
    this.event(scope,eventId);return this.repo.listVersions(scope,eventId).map(versionView);
  }

  public addVersion(scope:BookScope,eventId:string,input:{
    expectedEventRevision:number;candidateKind:StoryEventCandidateKind;parentVersionId?:string|null;
    sourceTaskId?:string|null;authorInputRefs?:string[];template:unknown;content:unknown;idempotencyKey:string;
  }):StoryEventVersionView{
    const expected=pos(input.expectedEventRevision,'事件修订号'),kind=candidate(input.candidateKind);
    const parent=opt(input.parentVersionId,'父版本标识'),task=opt(input.sourceTaskId,'来源任务标识');
    const refs=idList(input.authorInputRefs??[],'作者想法引用'),key=req(input.idempotencyKey,'幂等键');
    let template:PlanningTemplateInstance,content:StoryEventContent;
    try{template=parsePlanningTemplateInstance(input.template,'event');content=parseStoryEventContent(input.content);}
    catch(error){throw validation(error instanceof Error?error.message:'事件大纲格式无效。');}
    const requestHash=hash({eventId,expected,kind,parent,task,refs,template,content}),now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const replay=this.repo.versionByIdempotency(scope,key);
      if(replay!==undefined){same(replay.request_hash,requestHash);if(replay.event_id!==eventId)throw conflict('幂等键已用于其他事件。');return versionView(replay);}
      const event=this.event(scope,eventId);
      if(event.revision!==expected)throw conflict('事件已经变化，请刷新后保存。');
      if(['settled','archived'].includes(event.status))throw conflict('已结算或归档事件不能修改。');
      this.assertVolume(scope,event);
      if(parent!==null&&this.repo.version(scope,eventId,parent)===undefined)throw validation('父版本不属于当前事件。');
      if(task!==null&&!this.repo.taskExists(scope,task))throw validation('来源任务不属于当前书籍。');
      if(refs.length!==this.repo.authorInputCount(scope,eventId,refs))throw validation('作者想法引用必须来自当前事件。');
      return versionView(this.store(scope,event,{candidateKind:kind,parentVersionId:parent,sourceTaskId:task,
        authorInputRefs:refs,template,content,idempotencyKey:key,requestHash,now,dependencies:this.dependencies(scope,event)}));
    });
  }

  public impactPreview(scope:BookScope,eventId:string,versionId:string){
    const event=this.event(scope,eventId),next=this.version(scope,eventId,versionId);
    const active=event.active_version_id===null?undefined:this.repo.version(scope,eventId,event.active_version_id);
    const n=JSON.parse(next.content_json) as Record<string,unknown>;
    const a=active===undefined?undefined:JSON.parse(active.content_json) as Record<string,unknown>;
    const changedFields=a===undefined?Object.keys(n):Object.keys(n).filter(k=>hash(n[k])!==hash(a[k]));
    const count=this.repo.downstreamCount(scope,eventId);
    return{eventId,candidateVersionId:versionId,activeVersionId:event.active_version_id,changedFields,
      downstreamDependencyCount:count,requiresDownstreamReview:count>0,
      note:count>0?'已存在下游内容；确认后保留原内容并逐项复核。':'可以继续生成本事件章纲。'};
  }

  public confirm(scope:BookScope,eventId:string,input:{versionId:string;expectedEventRevision:number;expectedWorkflowVersion:number}):StoryEventView{
    const versionId=req(input.versionId,'事件候选版本'),eventRevision=pos(input.expectedEventRevision,'事件修订号');
    const workflowVersion=pos(input.expectedWorkflowVersion,'工作流版本'),now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const event=this.event(scope,eventId),workflow=this.workflow(scope);
      if(event.revision!==eventRevision||workflow.planning_version!==workflowVersion)throw conflict('事件或创作流程已经变化。');
      this.assertVolume(scope,event);const version=this.version(scope,eventId,versionId);this.assertDependencies(scope,event,version);
      if(!this.repo.activateVersion(scope,{eventId,versionId,expectedEventRevision:eventRevision,now}))throw conflict('事件已经变化。');
      if(!this.repo.activateWorkflowEvent(scope,{eventId,eventVersionId:versionId,expectedPlanningVersion:workflowVersion,now}))throw conflict('创作流程已经变化。');
      return this.eventView(scope,this.event(scope,eventId));
    });
  }

  public previewOperation(scope:BookScope,volumeId:string,input:{expectedSequenceRevision:number;proposal:unknown;idempotencyKey:string}):EventOperationView{
    const expected=pos(input.expectedSequenceRevision,'事件序列修订号'),proposal=parseOperation(input.proposal);
    const key=req(input.idempotencyKey,'幂等键'),requestHash=hash({volumeId,expected,proposal}),now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const replay=this.repo.operationByIdempotency(scope,key);
      if(replay!==undefined){same(replay.request_hash,requestHash);return operationView(replay);}
      if(this.sequence(scope,volumeId).revision!==expected)throw conflict('事件顺序已经变化，请重新预览。');
      const impact=this.operationImpact(scope,this.repo.listEvents(scope,volumeId),proposal),operationId=this.ids.next();
      this.repo.insertOperation(scope,{operationId,volumePlanId:volumeId,operationKind:proposal.operationKind,
        expectedRevision:expected,proposalJson:JSON.stringify(proposal),impactJson:JSON.stringify(impact),
        idempotencyKey:key,requestHash,now});
      return operationView(this.operation(scope,operationId));
    });
  }

  public applyOperation(scope:BookScope,volumeId:string,input:{operationId:string;expectedSequenceRevision:number}):EventSequenceView{
    const operationId=req(input.operationId,'操作预览标识'),expected=pos(input.expectedSequenceRevision,'事件序列修订号');
    const now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const row=this.operation(scope,operationId);
      if(row.status==='applied')return this.sequenceView(scope,this.sequence(scope,volumeId));
      if(row.expected_sequence_revision!==expected||this.sequence(scope,volumeId).revision!==expected)throw conflict('事件顺序已经变化，请重新预览。');
      const impact=JSON.parse(row.impact_json) as EventOperationImpact;if(impact.blocked)throw conflict(impact.note);
      this.apply(scope,volumeId,JSON.parse(row.proposal_json) as EventOperationProposal,operationId,now);
      const volume=this.activeVolume(scope,volumeId);
      if(!this.repo.updateSequenceCas(scope,{volumePlanId:volumeId,expectedRevision:expected,volumePlanVersionId:volume.active_version_id,now}))throw conflict('事件顺序已经变化。');
      if(!this.repo.markOperationApplied(scope,operationId,expected+1,now))throw conflict('操作状态已经变化。');
      return this.sequenceView(scope,this.sequence(scope,volumeId));
    });
  }

  private apply(scope:BookScope,volumeId:string,p:EventOperationProposal,opId:string,now:string){
    const current=this.repo.listEvents(scope,volumeId);let eventIds:string[];
    if(p.operationKind==='reorder'){
      eventIds=[...p.eventIds];
    }else if(p.operationKind==='insert'){
      const index=p.afterEventId===null?-1:current.findIndex(e=>e.event_id===p.afterEventId);
      const created=this.create(scope,volumeId,p.content,index+2,opId+':insert',now);
      eventIds=current.map(e=>e.event_id);eventIds.splice(index+1,0,created);
    }else if(p.operationKind==='split'){
      const old=this.event(scope,p.eventId);if(!this.repo.archiveEvent(scope,old.event_id,now))throw conflict('原事件已经变化。');
      const first=this.create(scope,volumeId,p.first,old.sequence_order,opId+':split-a',now);
      const second=this.create(scope,volumeId,p.second,old.sequence_order+1,opId+':split-b',now);
      eventIds=current.flatMap(e=>e.event_id===old.event_id?[first,second]:[e.event_id]);
    }else{
      const first=this.event(scope,p.eventIds[0]);for(const eventId of p.eventIds)if(!this.repo.archiveEvent(scope,eventId,now))throw conflict('原事件已经变化。');
      const merged=this.create(scope,volumeId,p.merged,first.sequence_order,opId+':merge',now);
      eventIds=current.flatMap(e=>e.event_id===p.eventIds[0]?[merged]:e.event_id===p.eventIds[1]?[]:[e.event_id]);
    }
    this.setOrder(scope,eventIds,now);
  }
  private create(scope:BookScope,volumeId:string,content:StoryEventContent,order:number,key:string,now:string):string{
    const eventId=this.ids.next();this.repo.insertEvent(scope,{eventId,volumePlanId:volumeId,sequenceOrder:order,
      previousEventId:null,previousSettlementId:null,idempotencyKey:key,requestHash:hash(content),now});
    this.store(scope,this.event(scope,eventId),{candidateKind:'author_edit',parentVersionId:null,sourceTaskId:null,
      authorInputRefs:[],template:noTemplate(),content,idempotencyKey:key+':version',requestHash:hash({eventId,content}),
      now,dependencies:[volumeRef(this.activeVolume(scope,volumeId))]});
    return eventId;
  }
  private setOrder(scope:BookScope,eventIds:string[],now:string){
    eventIds.forEach((eventId,i)=>this.repo.setEventPosition(scope,{
      eventId,sequenceOrder:i+1,previousEventId:i===0?null:eventIds[i-1]!,now}));
  }
  private operationImpact(scope:BookScope,events:StoryEventRow[],p:EventOperationProposal):EventOperationImpact{
    const all=new Set(events.map(e=>e.event_id));let affected:StoryEventRow[],titles:string[];
    if(p.operationKind==='reorder'){
      if(p.eventIds.length!==events.length||new Set(p.eventIds).size!==events.length||p.eventIds.some(x=>!all.has(x)))throw validation('重排必须包含当前全部事件。');
      affected=events.filter((e,i)=>p.eventIds[i]!==e.event_id||(i===0?null:p.eventIds[i-1])!==e.previous_event_id);
      titles=p.eventIds.map(x=>this.title(scope,this.event(scope,x)));
    }else if(p.operationKind==='insert'){
      if(p.afterEventId!==null&&!all.has(p.afterEventId))throw validation('插入位置无效。');
      const index=p.afterEventId===null?-1:events.findIndex(e=>e.event_id===p.afterEventId);
      affected=events[index+1]===undefined?[]:[events[index+1]!];titles=[p.content.title];
    }else if(p.operationKind==='split'){
      const target=this.event(scope,p.eventId),index=events.findIndex(e=>e.event_id===p.eventId);
      affected=[target,...(events[index+1]===undefined?[]:[events[index+1]!])];titles=[p.first.title,p.second.title];
    }else{
      const pair=p.eventIds.map(x=>this.event(scope,x));if(pair[1]!.sequence_order!==pair[0]!.sequence_order+1)throw validation('只能合并相邻事件。');
      const index=events.findIndex(e=>e.event_id===pair[1]!.event_id);
      affected=[...pair,...(events[index+1]===undefined?[]:[events[index+1]!])];titles=[p.merged.title];
    }
    affected=[...new Map(affected.map(e=>[e.event_id,e])).values()];
    if(affected.some(e=>e.volume_plan_id!==events[0]?.volume_plan_id))throw validation('事件不属于当前卷。');
    const settled=affected.filter(e=>e.status==='settled'||e.status==='archived').map(e=>e.event_id);
    const active=affected.filter(e=>e.active_version_id!==null).map(e=>e.event_id);
    const count=affected.reduce((n,e)=>n+this.repo.downstreamCount(scope,e.event_id),0);
    const blocked=settled.length>0||active.length>0||count>0;
    return{affectedEventIds:affected.map(e=>e.event_id),settledEventIds:settled,activeEventIds:active,
      downstreamDependencyCount:count,resultingTitles:titles,blocked,
      note:blocked?'变更会改动已确认、已结算或已有下游内容的因果接口，不能直接应用。':'应用后保留全部旧版本和操作记录。'};
  }

  private dependencies(scope:BookScope,event:StoryEventRow):VersionReference[]{
    const result=[volumeRef(this.activeVolume(scope,event.volume_plan_id))];
    if(event.previous_event_id!==null){const s=this.repo.activeEventSettlement(scope,event.previous_event_id);
      if(s===undefined)throw conflict('请先完成上一事件实际结算，再设计当前事件。');
      result.push({kind:'settlement',id:s.id,version:s.version,contentHash:hash(s.hash_source),required:true});}
    return result;
  }
  private assertDependencies(scope:BookScope,event:StoryEventRow,version:StoryEventVersionRow){
    const expected=JSON.parse(version.dependencies_json) as VersionReference[];
    if(hash(expected)!==hash(this.dependencies(scope,event)))throw conflict('事件依赖已变化，请重新生成。');
    const stored=this.repo.dependencySnapshots(scope,version.story_event_version_id,version.version);
    if(stored.length!==expected.length||stored.some(x=>x.status!=='active'))throw conflict('事件依赖已过期。');
  }
  private store(scope:BookScope,event:StoryEventRow,input:{
    candidateKind:StoryEventCandidateKind;parentVersionId:string|null;sourceTaskId:string|null;authorInputRefs:string[];
    template:PlanningTemplateInstance;content:StoryEventContent;idempotencyKey:string;requestHash:string;now:string;dependencies:VersionReference[];
  }):StoryEventVersionRow{
    const volume=this.activeVolume(scope,event.volume_plan_id),version=this.repo.nextVersion(scope,event.event_id),versionId=this.ids.next();
    this.repo.insertVersion(scope,{versionId,eventId:event.event_id,version,parentVersionId:input.parentVersionId,
      candidateKind:input.candidateKind,volumePlanVersionId:volume.active_version_id,
      previousSettlementId:input.dependencies.find(x=>x.kind==='settlement')?.id??null,
      dependenciesJson:JSON.stringify(input.dependencies),templateJson:JSON.stringify(input.template),
      authorInputRefsJson:JSON.stringify(input.authorInputRefs),contentJson:JSON.stringify(input.content),
      contentHash:hash(input.content),sourceTaskId:input.sourceTaskId,idempotencyKey:input.idempotencyKey,
      requestHash:input.requestHash,now:input.now});
    this.repo.insertDependencies(scope,{dependencyIds:input.dependencies.map(()=>this.ids.next()),downstreamId:versionId,
      downstreamVersion:version,dependencies:input.dependencies,now:input.now});
    return this.version(scope,event.event_id,versionId);
  }

  private sequenceView(scope:BookScope,row:{volume_plan_id:string;volume_plan_version_id:string;revision:number;updated_at:string}):EventSequenceView{
    return{volumePlanId:row.volume_plan_id,volumePlanVersionId:row.volume_plan_version_id,revision:row.revision,
      events:this.repo.listEvents(scope,row.volume_plan_id).map(e=>this.eventView(scope,e)),
      operations:this.repo.listOperations(scope,row.volume_plan_id).map(operationView),updatedAt:row.updated_at};
  }
  private eventView(scope:BookScope,e:StoryEventRow):StoryEventView{
    const versions=this.repo.listVersions(scope,e.event_id),active=versions.find(v=>v.story_event_version_id===e.active_version_id);
    return{eventId:e.event_id,volumePlanId:e.volume_plan_id,order:e.sequence_order,status:e.status,revision:e.revision,
      previousEventId:e.previous_event_id,activeVersionId:e.active_version_id,activeVersion:active===undefined?null:versionView(active),
      latestVersion:versions[0]===undefined?null:versionView(versions[0]),downstreamDependencyCount:this.repo.downstreamCount(scope,e.event_id),
      createdAt:e.created_at,updatedAt:e.updated_at};
  }
  private title(scope:BookScope,e:StoryEventRow){return this.eventView(scope,e).latestVersion?.content.title??'事件'+e.sequence_order;}
  private assertVolume(scope:BookScope,e:StoryEventRow){if(this.sequence(scope,e.volume_plan_id).volume_plan_version_id!==this.activeVolume(scope,e.volume_plan_id).active_version_id)throw conflict('分卷已经切换。');}
  private activeVolume(scope:BookScope,idValue:string){const row=this.repo.activeVolumePlan(scope,req(idValue,'卷规划标识'));if(row===undefined)throw conflict('只有当前已确认卷纲才能设计事件。');return row;}
  private sequence(scope:BookScope,idValue:string){const row=this.repo.sequence(scope,req(idValue,'卷规划标识'));if(row===undefined)throw notFound('当前卷还没有事件链。');return row;}
  private event(scope:BookScope,idValue:string){const row=this.repo.event(scope,req(idValue,'事件标识'));if(row===undefined)throw notFound('当前书籍中没有这个事件。');return row;}
  private version(scope:BookScope,eventId:string,versionId:string){const row=this.repo.version(scope,eventId,versionId);if(row===undefined)throw notFound('当前事件中没有这个版本。');return row;}
  private operation(scope:BookScope,idValue:string){const row=this.repo.operation(scope,req(idValue,'操作标识'));if(row===undefined)throw notFound('当前书籍中没有这份操作预览。');return row;}
  private workflow(scope:BookScope){const row=this.repo.workflow(scope);if(row===undefined)throw conflict('当前书籍还没有创作流程状态。');return row;}
}

function volumeRef(v:{volume_plan_id:string;version:number;content_hash:string}):VersionReference{return{kind:'volume_plan',id:v.volume_plan_id,version:v.version,contentHash:v.content_hash,required:true};}
function chainNodeContent(node:EventChainNode,trigger:string,participants:string[]):StoryEventContent{return{
  title:node.title,volumeResponsibility:node.volumeResponsibility,startingState:node.entryState,
  trigger,
  participants:[...new Set(participants)],characterGoals:[node.protagonistAction],obstacles:[node.oppositionEscalation],
  choicesAndCosts:[node.stagePayoffOrCost],informationMoves:[...node.plantThreadIds,...node.payoffThreadIds],
  localProgression:[node.protagonistAction,node.oppositionEscalation],requiredResult:node.exitState,
  flexibleExecution:['具体场景、对白、局部转折和意象由后续事件大纲与章纲自由设计。'],
  endingConditions:[node.exitState],nextEventImpact:node.leadsToNext??'完成本卷高潮责任并进入卷末新状态。',
  characterArcImpact:node.exitState,volumeClimaxImpact:node.volumeResponsibility,
  estimatedChapterRange:{minimum:null,likely:null,maximum:null},
  uncertaintyNotes:node.consequenceThreadIds.map(id=>'后续需要继续追踪：'+id),
  storylineResponsibilities:[
    ...(node.leadingStorylineId===null?[]:[`主导故事线：${node.volumeResponsibility}`]),
    ...(node.supportingStorylineIds.length===0?[]:[`辅助故事线交汇：${node.intersectionNote??node.volumeResponsibility}`])
  ]
};}
function seedContent(s:EventSequenceItem):StoryEventContent{return{title:s.title,volumeResponsibility:s.responsibility,
  startingState:s.entryState,trigger:s.trigger,participants:[],characterGoals:[],obstacles:[],choicesAndCosts:[],
  informationMoves:[],localProgression:[s.action],requiredResult:s.result,
  flexibleExecution:['具体场景、对白、局部转折和意象由后续创作自由发挥。'],endingConditions:[s.result],
  nextEventImpact:s.leadsToNext??'完成本卷收束。',characterArcImpact:'由规划补充人物行动后的可见变化。',
  volumeClimaxImpact:s.responsibility,estimatedChapterRange:s.estimatedChapterRange,uncertaintyNotes:[]};}
function noTemplate():PlanningTemplateInstance{return{selectionMode:'none',templateKey:null,templateVersion:null,templateHash:null,scope:'event',beats:[],customDirection:null};}
function versionView(r:StoryEventVersionRow):StoryEventVersionView{return{storyEventVersionId:r.story_event_version_id,eventId:r.event_id,
  version:r.version,parentVersionId:r.parent_version_id,status:r.status,candidateKind:r.candidate_kind,
  volumePlanVersionId:r.volume_plan_version_id,previousSettlementId:r.previous_settlement_id,
  dependencies:JSON.parse(r.dependencies_json) as VersionReference[],template:JSON.parse(r.template_json) as PlanningTemplateInstance,
  authorInputRefs:JSON.parse(r.author_input_refs_json) as string[],content:parseStoryEventContent(JSON.parse(r.content_json) as unknown),
  contentHash:r.content_hash,sourceTaskId:r.source_task_id,createdAt:r.created_at,confirmedAt:r.confirmed_at};}
function operationView(r:EventSequenceOperationRow):EventOperationView{return{operationId:r.event_sequence_operation_id,
  operationKind:r.operation_kind,expectedSequenceRevision:r.expected_sequence_revision,resultSequenceRevision:r.result_sequence_revision,
  proposal:JSON.parse(r.proposal_json) as EventOperationProposal,impact:JSON.parse(r.impact_json) as EventOperationImpact,
  status:r.status,createdAt:r.created_at,appliedAt:r.applied_at};}
function parseOperation(value:unknown):EventOperationProposal{
  if(!record(value)||typeof value.operationKind!=='string')throw validation('事件操作格式无效。');
  try{
    if(value.operationKind==='reorder')return{operationKind:'reorder',eventIds:idList(value.eventIds,'事件顺序')};
    if(value.operationKind==='insert')return{operationKind:'insert',afterEventId:opt(value.afterEventId,'插入位置'),content:parseStoryEventContent(value.content)};
    if(value.operationKind==='split')return{operationKind:'split',eventId:req(value.eventId,'待拆分事件'),first:parseStoryEventContent(value.first),second:parseStoryEventContent(value.second)};
    if(value.operationKind==='merge'){const pair=idList(value.eventIds,'待合并事件');if(pair.length!==2)throw validation('每次只能合并两个相邻事件。');return{operationKind:'merge',eventIds:[pair[0]!,pair[1]!],merged:parseStoryEventContent(value.merged)};}
  }catch(error){if(error instanceof DomainError)throw error;throw validation(error instanceof Error?error.message:'事件操作格式无效。');}
  throw validation('不支持的事件操作。');
}
function candidate(v:unknown):StoryEventCandidateKind{if(typeof v!=='string'||!(KINDS as readonly string[]).includes(v))throw validation('事件候选来源无效。');return v as StoryEventCandidateKind;}
function pos(v:unknown,f:string){if(!Number.isInteger(v)||Number(v)<1)throw validation(f+'必须是大于0的整数。');return Number(v);}
function req(v:unknown,f:string){if(typeof v!=='string'||v.trim().length===0)throw validation(f+'不能为空。');return v.trim();}
function opt(v:unknown,f:string){return v===null||v===undefined||v===''?null:req(v,f);}
function idList(v:unknown,f:string){if(!Array.isArray(v))throw validation(f+'必须是列表。');return[...new Set(v.map(x=>req(x,f)))];}
function hash(v:unknown){return hashStableContractContent(v).slice('sha256:'.length);}
function same(a:string,b:string){if(a!==b)throw conflict('同一个幂等键不能用于不同请求。');}
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function validation(m:string){return new DomainError(errorCodes.validation,m);}
function conflict(m:string,d:Record<string,unknown>={}){return new DomainError(errorCodes.bookVersionConflict,m,d,false,409);}
function notFound(m:string){return new DomainError(errorCodes.bookNotFound,m,{},false,404);}
