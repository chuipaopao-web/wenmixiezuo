import { hashStableContractContent } from '@wenmi/contracts';
import { DomainError,errorCodes } from '../../domain/errors.js';
import type { Clock,IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { EventChapterGenerationRepository } from '../../infrastructure/db/repositories/event-chapter-generation-repository.js';
import { VolumePlanGenerationRepository,type VolumePlanGenerationSeat } from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import { TaskService,type TaskRecord } from '../tasks/task-service.js';
import { EventChapterOutlineService } from './event-chapter-outline-service.js';

export type EventChapterGenerationKind='sequence'|'details';
export interface EventChapterGenerationBrief {
  schema:'event-chapter-generation-v1';kind:EventChapterGenerationKind;subjectId:string;eventId:string;
  expectedWorkflowVersion:number;expectedSequenceRevision:number;expectedSequenceVersionId:string|null;
  outlineRefs:Array<{outlineId:string;revision:number;activeVersionId:string|null}>;
  authorInputRefs:string[];authorIdeas:Array<{id:string;subjectId:string;intentStrength:string;originalText:string;scopeNotes:string|null}>;
  member:VolumePlanGenerationSeat;sourceFingerprint:string;requestHash:string;
}
export interface EventChapterGenerationView {
  taskId:string;kind:EventChapterGenerationKind;status:string;currentPhase:string;errorCode:string|null;
  checkpoint:Record<string,unknown>;member:{roleKey:string;agentId:string;displayName:string;provider:string;modelId:string};
  createdAt:string;updatedAt:string;
}
export class EventChapterGenerationService {
  public constructor(private readonly repo:EventChapterGenerationRepository,private readonly plans:EventChapterOutlineService,
    private readonly teams:VolumePlanGenerationRepository,private readonly tasks:TaskService,private readonly uow:UnitOfWork,
    private readonly ids:IdGenerator,private readonly clock:Clock){}

  public startSequence(scope:BookScope,eventId:string,input:{expectedSequenceRevision:number;expectedWorkflowVersion:number;
    authorInputRefs?:string[];idempotencyKey:string}):EventChapterGenerationView{
    const sequence=this.plans.get(scope,eventId);if(sequence===null)throw incomplete('请先建立当前事件章纲序列。');
    const expectedSequenceRevision=positive(input.expectedSequenceRevision,'序列修订号'),
      expectedWorkflowVersion=positive(input.expectedWorkflowVersion,'工作流版本'),refs=unique(input.authorInputRefs??[],'作者想法引用');
    if(sequence.revision!==expectedSequenceRevision)throw conflict('事件章纲序列已经变化。');
    const ideas=this.repo.authorInputs(scope,{subjectType:'event_chapter_sequence',subjectId:eventId,ids:refs});
    if(ideas.length!==refs.length)throw validation('作者想法引用必须来自当前事件章纲序列。');
    const team=this.teams.generationSeats(scope),member=team.seats.find(s=>s.roleKey==='lead_screenwriter');
    if(member===undefined)throw incomplete('当前书籍缺少可用编剧。');
    return this.start(scope,{schema:'event-chapter-generation-v1',kind:'sequence',subjectId:eventId,eventId,expectedWorkflowVersion,expectedSequenceRevision,
      expectedSequenceVersionId:sequence.activeVersionId,outlineRefs:[],authorInputRefs:refs,authorIdeas:mapIdeas(refs,ideas),member,
      sourceFingerprint:fingerprint(sequence),requestHash:''},required(input.idempotencyKey,'幂等键'),team.editorEpoch,
      ['event_confirmed','chapter_outlines_in_progress']);
  }
  public startDetails(scope:BookScope,eventId:string,input:{count:number;expectedSequenceRevision:number;expectedWorkflowVersion:number;
    authorInputRefs?:string[];idempotencyKey:string}):EventChapterGenerationView{
    const count=positive(input.count,'近期章数');if(count>3)throw validation('每次只详细设计最近一至三章。');
    const sequence=this.plans.get(scope,eventId);if(sequence===null||sequence.activeVersionId===null)throw incomplete('请先确认完整事件章纲序列。');
    const expectedSequenceRevision=positive(input.expectedSequenceRevision,'序列修订号'),
      expectedWorkflowVersion=positive(input.expectedWorkflowVersion,'工作流版本');
    if(sequence.revision!==expectedSequenceRevision||!sequence.valid)throw conflict('事件章纲序列已经变化。');
    const targets=sequence.outlines.filter(item=>!['frozen','settled'].includes(item.status)).slice(0,count);
    if(targets.length!==count)throw incomplete('没有足够的未冻结章纲可供本轮设计。');
    const refs=unique(input.authorInputRefs??[],'作者想法引用'),allIdeas=targets.flatMap(target=>this.repo.authorInputs(scope,{
      subjectType:'event_chapter_outline',subjectId:target.outlineId,ids:refs}));
    const ideas=[...new Map(allIdeas.map(item=>[item.author_input_id,item])).values()];
    if(ideas.length!==refs.length)throw validation('作者想法引用必须来自本轮近期章纲。');
    const team=this.teams.generationSeats(scope),member=team.seats.find(s=>s.editor);
    if(member===undefined)throw incomplete('当前书籍缺少可用主编。');
    const outlineRefs=targets.map(item=>({outlineId:item.outlineId,revision:item.revision,activeVersionId:item.activeVersionId}));
    return this.start(scope,{schema:'event-chapter-generation-v1',kind:'details',subjectId:eventId,eventId,expectedWorkflowVersion,expectedSequenceRevision,
      expectedSequenceVersionId:sequence.activeVersionId,outlineRefs,authorInputRefs:refs,authorIdeas:mapIdeas(refs,ideas),member,
      sourceFingerprint:fingerprint({sequenceId:sequence.sequenceId,revision:sequence.revision,activeVersionId:sequence.activeVersionId,
        outlines:outlineRefs}),requestHash:''},required(input.idempotencyKey,'幂等键'),team.editorEpoch,
      ['chapter_outlines_in_progress','next_chapters_ready']);
  }
  public latest(scope:BookScope,eventId:string,kind:EventChapterGenerationKind):EventChapterGenerationView|null{
    const row=this.repo.latest(scope,eventId,taskType(kind));return row===undefined?null:this.view(scope,this.tasks.require(scope,row.task_id));
  }
  public reconcileTerminal(scope:BookScope,task:TaskRecord){if(isTask(task.taskType)&&['cancelled','succeeded'].includes(task.status))
    this.repo.clear(scope,task.taskId,this.clock.now().toISOString());}
  private start(scope:BookScope,brief:EventChapterGenerationBrief,key:string,editorEpoch:number,stages:string[]){
    const budgetId=this.teams.activeBudgetId(scope);if(budgetId===undefined)throw incomplete('当前书籍没有可用预算。');
    brief.requestHash=fingerprint({...brief,requestHash:undefined});
    const idempotencyKey='event-chapter-'+brief.kind+':'+brief.subjectId+':'+key;
    const latest=this.repo.latest(scope,brief.subjectId,taskType(brief.kind));
    if(latest?.idempotency_key===idempotencyKey){const task=this.tasks.require(scope,latest.task_id);
      if(task.brief.requestHash!==brief.requestHash)throw conflict('同一个幂等键不能用于不同请求。');return this.view(scope,task);}
    if(latest!==undefined&&!['failed','cancelled','succeeded','interrupted','blocked'].includes(latest.status))
      throw conflict('当前章纲已有团队任务正在进行。');
    const taskId=this.ids.next();
    const task=this.uow.run(()=>{
      let created=this.tasks.create(scope,{taskId,taskType:taskType(brief.kind),assignedAgentId:brief.member.agentId,
        idempotencyKey,budgetId,requiredEditorEpoch:editorEpoch,initialPhase:'preparing_context',
        brief:brief as unknown as Record<string,unknown>});
      if(created.taskId!==taskId)return created;
      if(!this.repo.attach(scope,{taskId,expectedPlanningVersion:brief.expectedWorkflowVersion,allowedStages:stages,
        now:this.clock.now().toISOString()}))throw conflict('章纲或创作流程已经变化。');
      if(created.status==='pending')created=this.tasks.queue(scope,created.taskId);return created;
    });return this.view(scope,task);
  }
  private view(scope:BookScope,task:TaskRecord):EventChapterGenerationView{const brief=task.brief as unknown as EventChapterGenerationBrief;
    const row=this.repo.latest(scope,brief.subjectId,taskType(brief.kind));
    return{taskId:task.taskId,kind:brief.kind,status:task.status,currentPhase:task.currentPhase,errorCode:task.errorCode,
      checkpoint:task.checkpoint,member:{roleKey:brief.member.roleKey,agentId:brief.member.agentId,displayName:brief.member.displayName,
        provider:brief.member.provider,modelId:brief.member.modelId},createdAt:row?.created_at??'',updatedAt:row?.updated_at??''};}
}
function mapIdeas(refs:string[],ideas:Array<{author_input_id:string;subject_id:string;intent_strength:string;original_text:string;scope_notes:string|null}>){
  return refs.map(id=>{const x=ideas.find(item=>item.author_input_id===id)!;return{id,subjectId:x.subject_id,intentStrength:x.intent_strength,
    originalText:x.original_text,scopeNotes:x.scope_notes};});}
function taskType(kind:EventChapterGenerationKind){return kind==='sequence'?'event_chapter_sequence_generation' as const:'event_chapter_detail_generation' as const;}
function isTask(v:string){return v==='event_chapter_sequence_generation'||v==='event_chapter_detail_generation';}
function fingerprint(v:unknown){return hashStableContractContent(v).slice('sha256:'.length);}
function required(v:unknown,f:string){if(typeof v!=='string'||v.trim().length===0)throw validation(f+'不能为空。');return v.trim();}
function positive(v:unknown,f:string){if(!Number.isInteger(v)||Number(v)<1)throw validation(f+'必须是大于0的整数。');return Number(v);}
function unique(v:unknown,f:string){if(!Array.isArray(v))throw validation(f+'必须是列表。');return[...new Set(v.map(x=>required(x,f)))];}
function validation(m:string){return new DomainError(errorCodes.validation,m);}
function conflict(m:string){return new DomainError(errorCodes.bookVersionConflict,m,{},false,409);}
function incomplete(m:string){return new DomainError(errorCodes.operationIncomplete,m,{},false,409);}
