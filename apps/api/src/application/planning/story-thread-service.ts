import type {EventChainContent,StoryThreadStatus,StoryThreadType} from '@wenmi/contracts';
import type {DatabaseSync} from 'node:sqlite';
import {DomainError,errorCodes} from '../../domain/errors.js';
import type {Clock,IdGenerator} from '../../domain/ids.js';
import {assertBookScope,type BookScope} from '../../domain/scope.js';
import {StoryThreadRepository,type StoryThreadRow} from '../../infrastructure/db/repositories/story-thread-repository.js';
import {UnitOfWork} from '../../infrastructure/db/unit-of-work.js';

export interface StoryThreadView{
  threadId:string;threadKey:string;title:string;type:StoryThreadType;scopeType:'book'|'volume'|'event';scopeId:string;
  status:StoryThreadStatus;plannedWindow:Record<string,unknown>|null;actualEvidenceCount:number;
  abandonmentReason:string|null;revision:number;updatedAt:string;
}
export class StoryThreadService{
  private readonly repository:StoryThreadRepository;
  public constructor(private readonly database:DatabaseSync,private readonly unitOfWork:UnitOfWork,
    private readonly ids:IdGenerator,private readonly clock:Clock){this.repository=new StoryThreadRepository(database);}

  public registerPlan(scope:BookScope,volumePlanId:string,chainVersionId:string,content:EventChainContent):void{
    assertBookScope(scope);const now=this.clock.now().toISOString();
    const descriptors=new Map<string,{plants:Array<{nodeId:string;order:number}>;payoffs:Array<{nodeId:string;order:number}>;
      consequences:Array<{nodeId:string;order:number}>}>();
    const descriptor=(key:string)=>{const existing=descriptors.get(key)??{plants:[],payoffs:[],consequences:[]};descriptors.set(key,existing);return existing;};
    for(const node of content.events){
      for(const key of node.plantThreadIds)descriptor(key).plants.push({nodeId:node.nodeId,order:node.order});
      for(const key of node.payoffThreadIds)descriptor(key).payoffs.push({nodeId:node.nodeId,order:node.order});
      for(const key of node.consequenceThreadIds)descriptor(key).consequences.push({nodeId:node.nodeId,order:node.order});
    }
    this.unitOfWork.run(()=>{for(const[key,value]of descriptors){
      const from=value.plants[0]??value.consequences[0]??null,due=value.payoffs[0]??null;
      const plannedWindow={volumePlanId,fromEventId:from?.nodeId??null,fromEventOrder:from?.order??null,
        dueAtEventNodeId:due?.nodeId??null,dueAtEventOrder:due?.order??null};
      const existing=this.repository.byKey(scope,key);
      if(existing===undefined)this.repository.insert(scope,{id:this.ids.next(),key,type:threadType(value),title:threadTitle(key),
        scopeType:'volume',scopeId:volumePlanId,plannedWindow,sourceVersionIds:[chainVersionId],now});
      else if(!['resolved','abandoned_by_author'].includes(existing.status))this.repository.updatePlan(scope,key,{plannedWindow,
        sourceVersionIds:[...new Set([...(JSON.parse(existing.source_version_ids_json) as string[]),chainVersionId])],now});
    }});
  }

  public applyEventSettlement(scope:BookScope,eventId:string,settlementId:string):void{
    assertBookScope(scope);if(settlementId.trim().length===0)return;
    const source=this.repository.settledEventChainSource(scope,eventId);
    if(source===undefined)return;
    const chain=JSON.parse(source.chainContent) as EventChainContent,node=chain.events.find(item=>item.order===source.eventOrder);
    if(node===undefined)return;
    this.registerPlan(scope,source.volumePlanId,source.chainVersionId,chain);
    const now=this.clock.now().toISOString();
    this.unitOfWork.run(()=>{
      for(const key of node.plantThreadIds)this.repository.applyActual(scope,key,{status:'planted',evidenceId:settlementId,now});
      for(const key of node.consequenceThreadIds)this.repository.applyActual(scope,key,{status:'advanced',evidenceId:settlementId,now});
      for(const key of node.payoffThreadIds)this.repository.applyActual(scope,key,{status:'resolved',evidenceId:settlementId,now});
      for(const row of this.repository.list(scope)){
        if(['resolved','abandoned_by_author'].includes(row.status)||row.planned_window_json===null)continue;
        const window=JSON.parse(row.planned_window_json) as Record<string,unknown>;
        if(window.volumePlanId===source.volumePlanId&&typeof window.dueAtEventOrder==='number'
          && window.dueAtEventOrder<=source.eventOrder)this.repository.markDue(scope,row.thread_key!,now);
      }
    });
  }

  public list(scope:BookScope):StoryThreadView[]{assertBookScope(scope);return this.repository.list(scope).map(view);}
  public abandon(scope:BookScope,threadId:string,reason:string):StoryThreadView{
    assertBookScope(scope);const text=reason.trim();if(text.length<2)throw validation('请说明为什么不再继续这条伏笔或承诺。');
    if(!this.repository.abandon(scope,threadId,text,this.clock.now().toISOString()))
      throw new DomainError(errorCodes.bookVersionConflict,'这条线索已经解决、放弃或发生变化，请刷新后再试。',{},false,409);
    return view(this.repository.list(scope).find(row=>row.story_thread_record_id===threadId)!);
  }
}
function threadType(value:{plants:unknown[];payoffs:unknown[];consequences:unknown[]}):StoryThreadType{
  if(value.plants.length>0)return'foreshadowing';if(value.consequences.length>0)return'conflict';return'promise';
}
function threadTitle(key:string):string{return key.replace(/[_:-]+/gu,' ').trim()||'未命名故事线';}
function view(row:StoryThreadRow):StoryThreadView{return{threadId:row.story_thread_record_id,threadKey:row.thread_key??row.story_thread_record_id,
  title:row.title,type:row.thread_type as StoryThreadType,scopeType:row.scope_type as StoryThreadView['scopeType'],scopeId:row.scope_id,
  status:row.status,plannedWindow:row.planned_window_json===null?null:JSON.parse(row.planned_window_json) as Record<string,unknown>,
  actualEvidenceCount:(JSON.parse(row.actual_evidence_version_ids_json) as unknown[]).length,
  abandonmentReason:row.abandonment_reason,revision:row.revision,updatedAt:row.updated_at};}
function validation(message:string){return new DomainError(errorCodes.validation,message);}