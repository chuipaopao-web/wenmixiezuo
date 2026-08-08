import { hashStableContractContent,parsePlanningTemplateInstance,type PlanningTemplateInstance } from '@wenmi/contracts';
import { DomainError,errorCodes } from '../../domain/errors.js';
import type { Clock,IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { StoryEventRepository } from '../../infrastructure/db/repositories/story-event-repository.js';
import {
  StoryEventGenerationRepository,type StoryEventGenerationSnapshot
} from '../../infrastructure/db/repositories/story-event-generation-repository.js';
import {
  VolumePlanGenerationRepository,type VolumePlanGenerationSeat
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import { TaskService,type TaskRecord } from '../tasks/task-service.js';

export interface StoryEventGenerationBrief {
  schema:'story-event-generation-v1';eventId:string;expectedEventRevision:number;expectedActiveVersionId:string|null;
  expectedWorkflowVersion:number;sourceFingerprint:string;template:PlanningTemplateInstance;authorInputRefs:string[];
  authorIdeas:Array<{id:string;intentStrength:string;originalText:string;scopeNotes:string|null}>;
  seats:VolumePlanGenerationSeat[];modelDiversityVerified:boolean;requestHash:string;
}
export interface StoryEventGenerationView {
  taskId:string;status:string;currentPhase:string;errorCode:string|null;checkpoint:Record<string,unknown>;
  modelDiversityVerified:boolean;members:Array<{roleKey:string;agentId:string;displayName:string;provider:string;modelId:string}>;
  candidateVersionIds:{candidateA:string|null;candidateB:string|null;fusion:string|null};createdAt:string;updatedAt:string;
}

export class StoryEventGenerationService {
  public constructor(
    private readonly repo:StoryEventGenerationRepository,private readonly events:StoryEventRepository,
    private readonly teamRepo:VolumePlanGenerationRepository,private readonly tasks:TaskService,
    private readonly uow:UnitOfWork,private readonly ids:IdGenerator,private readonly clock:Clock
  ){}

  public start(scope:BookScope,eventId:string,input:{
    expectedEventRevision:number;expectedActiveVersionId?:string|null;expectedWorkflowVersion:number;
    template:unknown;authorInputRefs?:string[];idempotencyKey:string;
  }):StoryEventGenerationView{
    const expectedEventRevision=positive(input.expectedEventRevision,'事件修订号');
    const expectedWorkflowVersion=positive(input.expectedWorkflowVersion,'工作流版本');
    const expectedActiveVersionId=optional(input.expectedActiveVersionId,'当前确认版');
    const authorInputRefs=unique(input.authorInputRefs??[],'作者想法引用'),key=required(input.idempotencyKey,'幂等键');
    let template:PlanningTemplateInstance;
    try{template=parsePlanningTemplateInstance(input.template,'event');}
    catch(error){throw validation(error instanceof Error?error.message:'事件推进参考无效。');}
    const snapshot=this.repo.snapshot(scope,eventId);
    if(snapshot===undefined)throw incomplete('卷纲、设定或上一事件结算不完整，无法准备事件资料。');
    if(snapshot.eventRevision!==expectedEventRevision||snapshot.activeVersionId!==expectedActiveVersionId)
      throw conflict('事件已经变化，请刷新后再让团队设计。');
    const workflow=this.events.workflow(scope);
    if(workflow===undefined||workflow.planning_version!==expectedWorkflowVersion)
      throw conflict('创作流程已经变化，请刷新后再让团队设计。');
    const ideas=this.repo.authorInputs(scope,eventId,authorInputRefs);
    if(ideas.length!==authorInputRefs.length)throw validation('作者想法引用必须来自当前事件。');
    const ordered=authorInputRefs.map(id=>ideas.find(item=>item.id===id)!);
    const team=this.teamRepo.generationSeats(scope),editor=team.seats.find(s=>s.editor);
    const lead=team.seats.find(s=>s.roleKey==='lead_screenwriter');
    const second=team.seats.find(s=>s.roleKey==='second_screenwriter');
    if(editor===undefined||lead===undefined||second===undefined)throw incomplete('事件设计需要当前主编和两位编剧都可用。');
    const fixture=[lead,second].every(s=>s.provider.startsWith('local-deterministic'));
    const distinct=lead.provider!==second.provider||lead.modelId!==second.modelId;
    if(!distinct&&!fixture)throw incomplete('两位编剧绑定同一模型，不能冒充独立方案。');
    const budgetId=this.teamRepo.activeBudgetId(scope);if(budgetId===undefined)throw incomplete('当前书籍没有可用预算。');
    const sourceFingerprint=storyEventFingerprint(snapshot),requestHash=digest({
      eventId,expectedEventRevision,expectedActiveVersionId,expectedWorkflowVersion,sourceFingerprint,
      template,authorInputRefs,ordered,seats:team.seats
    });
    const taskKey='story-event-generation:'+eventId+':'+key,latest=this.repo.latestTask(scope,eventId);
    if(latest?.idempotency_key===taskKey){
      const existing=this.tasks.require(scope,latest.task_id);
      if(existing.brief.requestHash!==requestHash)throw conflict('同一个幂等键不能用于不同请求。');
      return this.view(scope,existing);
    }
    if(latest!==undefined&&!['failed','cancelled','succeeded','interrupted','blocked'].includes(latest.status))
      throw conflict('当前事件已有团队设计正在进行。',{taskId:latest.task_id});
    const taskId=this.ids.next(),brief:StoryEventGenerationBrief={
      schema:'story-event-generation-v1',eventId,expectedEventRevision,expectedActiveVersionId,
      expectedWorkflowVersion,sourceFingerprint,template,authorInputRefs,authorIdeas:ordered,
      seats:[lead,second,editor],modelDiversityVerified:!fixture&&distinct,requestHash
    };
    const task=this.uow.run(()=>{
      let created=this.tasks.create(scope,{taskId,taskType:'story_event_generation',assignedAgentId:editor.agentId,
        idempotencyKey:taskKey,budgetId,requiredEditorEpoch:team.editorEpoch,initialPhase:'preparing_context',
        brief:brief as unknown as Record<string,unknown>});
      if(created.brief.requestHash!==requestHash)throw conflict('同一个幂等键不能用于不同请求。');
      if(created.taskId!==taskId)return created;
      if(!this.repo.attachTask(scope,{eventId,taskId,expectedWorkflowVersion,expectedEventRevision,
        expectedActiveVersionId,now:this.clock.now().toISOString()}))throw conflict('事件或创作流程已经变化。');
      if(created.status==='pending')created=this.tasks.queue(scope,created.taskId);return created;
    });
    return this.view(scope,task);
  }

  public latest(scope:BookScope,eventId:string):StoryEventGenerationView|null{
    const row=this.repo.latestTask(scope,eventId);return row===undefined?null:this.view(scope,this.tasks.require(scope,row.task_id));
  }
  public reconcileTerminal(scope:BookScope,task:TaskRecord){
    if(task.taskType==='story_event_generation'&&['cancelled','succeeded'].includes(task.status))
      this.repo.clearTask(scope,task.taskId,this.clock.now().toISOString());
  }
  private view(scope:BookScope,task:TaskRecord):StoryEventGenerationView{
    const brief=task.brief as unknown as StoryEventGenerationBrief,row=this.repo.latestTask(scope,brief.eventId);
    return{taskId:task.taskId,status:task.status,currentPhase:task.currentPhase,errorCode:task.errorCode,
      checkpoint:task.checkpoint,modelDiversityVerified:brief.modelDiversityVerified,
      members:brief.seats.map(s=>({roleKey:s.roleKey,agentId:s.agentId,displayName:s.displayName,provider:s.provider,modelId:s.modelId})),
      candidateVersionIds:{
        candidateA:this.repo.candidate(scope,brief.eventId,task.taskId,'candidate_a')?.story_event_version_id??null,
        candidateB:this.repo.candidate(scope,brief.eventId,task.taskId,'candidate_b')?.story_event_version_id??null,
        fusion:this.repo.candidate(scope,brief.eventId,task.taskId,'fusion')?.story_event_version_id??null},
      createdAt:row?.created_at??'',updatedAt:row?.updated_at??''};
  }
}
export function storyEventFingerprint(s:StoryEventGenerationSnapshot){
  return digest({eventId:s.eventId,eventRevision:s.eventRevision,activeVersionId:s.activeVersionId,
    volume:{id:s.volumePlanId,versionId:s.volumePlanVersionId,version:s.volumeVersion,hash:s.volumeHash},
    opening:{id:s.opening.id,version:s.opening.version,hash:s.opening.hash},
    setting:{id:s.setting.id,version:s.setting.version,hash:s.setting.hash},
    seed:{id:s.seed.id,version:s.seed.version,hash:s.seed.hash},
    previousSettlement:s.previousSettlement===null?null:{id:s.previousSettlement.id,version:s.previousSettlement.version,hash:digest(s.previousSettlement.content)}});
}
function digest(v:unknown){return hashStableContractContent(v).slice('sha256:'.length);}
function positive(v:unknown,f:string){if(!Number.isInteger(v)||Number(v)<1)throw validation(f+'必须是大于0的整数。');return Number(v);}
function required(v:unknown,f:string){if(typeof v!=='string'||v.trim().length===0)throw validation(f+'不能为空。');return v.trim();}
function optional(v:unknown,f:string){return v===null||v===undefined||v===''?null:required(v,f);}
function unique(v:unknown,f:string){if(!Array.isArray(v))throw validation(f+'必须是列表。');return[...new Set(v.map(x=>required(x,f)))];}
function validation(m:string){return new DomainError(errorCodes.validation,m);}
function conflict(m:string,d:Record<string,unknown>={}){return new DomainError(errorCodes.bookVersionConflict,m,d,false,409);}
function incomplete(m:string){return new DomainError(errorCodes.operationIncomplete,m,{},false,409);}
