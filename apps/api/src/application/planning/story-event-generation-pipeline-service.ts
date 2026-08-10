import { createHash } from 'node:crypto';
import { parseStoryEventContent,type StoryEventContent } from '@wenmi/contracts';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { DomainError,errorCodes } from '../../domain/errors.js';
import type { Clock,IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { StoryEventRepository } from '../../infrastructure/db/repositories/story-event-repository.js';
import {
  StoryEventGenerationRepository,type StoryEventGenerationSnapshot
} from '../../infrastructure/db/repositories/story-event-generation-repository.js';
import type { VolumePlanGenerationSeat } from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import type { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens,type ContextPackService,type ContextSource } from '../memory/context-pack-service.js';
import type { RetrievalContextSourceService } from '../memory/retrieval-context-source-service.js';
import { TaskService,type TaskLeaseFence,type TaskRecord } from '../tasks/task-service.js';
import {
  storyEventFingerprint,type StoryEventGenerationBrief
} from './story-event-generation-service.js';
import { StoryEventService } from './story-event-service.js';

type Kind='candidate_a'|'candidate_b'|'fusion';
export class StoryEventGenerationPipelineService {
  public constructor(
    private readonly repo:StoryEventGenerationRepository,private readonly eventRepo:StoryEventRepository,
    private readonly events:StoryEventService,private readonly tasks:TaskService,private readonly budgets:BudgetService,
    private readonly calls:ModelCallService,private readonly packs:ContextPackService,private readonly ids:IdGenerator,
    private readonly clock:Clock,private readonly adapters:ModelAdapterFactory,private readonly retrieval?:RetrievalContextSourceService
  ){}

  public async executeClaimed(scope:BookScope,taskId:string,workerId:string,fence?:TaskLeaseFence){
    const task=this.tasks.require(scope,taskId);this.assertClaim(task,workerId,fence);
    const brief=parseBrief(task.brief),snapshot=this.current(scope,brief);
    const lead=seat(brief.seats,'lead_screenwriter'),second=seat(brief.seats,'second_screenwriter');
    const editor=brief.seats.find(s=>s.editor);if(editor===undefined)throw new Error('事件任务缺少主编席。');
    try{
      this.cancelled(scope,taskId);
      const results=await Promise.allSettled([
        this.generate(scope,task,brief,snapshot,lead,'candidate_a',[]),
        this.generate(scope,task,brief,snapshot,second,'candidate_b',[])
      ]);
      const a=results[0].status==='fulfilled'?results[0].value:null,b=results[1].status==='fulfilled'?results[1].value:null;
      this.tasks.checkpoint(scope,taskId,workerId,'screenwriter_candidates',{
        candidateAId:a?.id??null,candidateBId:b?.id??null,independent:true,crossReviewUsed:false
      },fence);
      const rejected=results.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(rejected!==undefined)throw rejected.reason;
      this.cancelled(scope,taskId);
      const fusion=await this.generate(scope,task,brief,snapshot,editor,'fusion',[a!.content,b!.content]);
      this.tasks.checkpoint(scope,taskId,workerId,'fusion_complete',{
        candidateAId:a!.id,candidateBId:b!.id,fusionId:fusion.id,awaitingAuthorChoice:true
      },fence);
      this.tasks.complete(scope,taskId,workerId,fence);this.repo.clearTask(scope,taskId,this.clock.now().toISOString());
      return{taskId,status:'succeeded',candidateAId:a!.id,candidateBId:b!.id,fusionId:fusion.id};
    }catch(error){
      const current=this.tasks.require(scope,taskId);
      if(current.cancelRequested){this.tasks.complete(scope,taskId,workerId,fence);this.repo.clearTask(scope,taskId,this.clock.now().toISOString());
        return{taskId,status:'cancelled',...this.stored(scope,brief.eventId,taskId)};}
      const unknown=this.repo.hasUnresolved(scope,taskId);
      this.tasks.fail(scope,taskId,workerId,unknown?errorCodes.modelCallInterrupted:
        error instanceof DomainError?error.code:'STORY_EVENT_GENERATION_FAILED',fence);
      this.repo.failTask(scope,taskId,unknown?'模型结果暂时无法确认，已停止自动重试。':'规划未完成，可从已保存候选重试。',
        this.clock.now().toISOString());throw error;
    }
  }

  private async generate(scope:BookScope,task:TaskRecord,brief:StoryEventGenerationBrief,
    snapshot:StoryEventGenerationSnapshot,member:VolumePlanGenerationSeat,kind:Kind,peers:StoryEventContent[]){
    const stored=this.repo.candidate(scope,brief.eventId,task.taskId,kind);
    if(stored!==undefined)return{id:stored.story_event_version_id,content:parseStoryEventContent(JSON.parse(stored.content_json) as unknown)};
    const retrieved=this.retrieval===undefined?{hardSources:[],optionalSources:[]}:await this.retrieval.collect(scope,{
      query:[snapshot.bookTitle,'第'+snapshot.order+'个事件',...brief.authorIdeas.map(x=>x.originalText)].join(' '),
      roleKey:member.roleKey as CreativeRoleKey,mode:'creative_exploration',canonRevision:snapshot.canonRevision,
      taskId:task.taskId,sourceTypes:['fact','manuscript','outline','setting','wiki','voice'],limit:kind==='fusion'?10:7
    });
    const pack=this.packs.build(scope,{taskId:task.taskId,agentId:member.agentId,canonRevision:snapshot.canonRevision,
      positioningVersion:snapshot.positioningVersion,tokenBudget:kind==='fusion'?24000:18000,
      characterBudget:kind==='fusion'?56000:42000,policyVersion:'story-event-context-v1',
      hardSources:[...hardSources(snapshot,brief,peers),...retrieved.hardSources],optionalSources:retrieved.optionalSources});
    const prompt=promptFor(member,kind,snapshot,brief,pack.sources.map(s=>({
      sourceType:s.sourceType,sourceId:s.sourceId,reason:s.reason,content:s.content
    })));
    const content=await this.call(scope,task,member,kind,prompt,pack.contextPackId);
    const version=this.events.addVersion(scope,brief.eventId,{expectedEventRevision:brief.expectedEventRevision,
      candidateKind:kind,parentVersionId:brief.expectedActiveVersionId,sourceTaskId:task.taskId,
      authorInputRefs:brief.authorInputRefs,template:brief.template,content,idempotencyKey:task.taskId+':'+kind});
    return{id:version.storyEventVersionId,content:version.content};
  }

  private async call(scope:BookScope,task:TaskRecord,member:VolumePlanGenerationSeat,kind:Kind,base:string,packId:string){
    if(task.budgetId===null)throw new Error('事件任务缺少预算。');
    const adapter=this.adapters.resolve(member.provider,member.modelId,'discussion',member.roleKey as CreativeRoleKey);
    let issue:string|null=null,last:unknown;
    for(let attempt=1;attempt<=2;attempt++){
      const input=issue===null?base:base+'\n上一份输出未通过校验：'+issue+'\n请重新输出完整JSON。';
      const inputHash=createHash('sha256').update(input).digest('hex');
      const saved=this.repo.succeededResult(scope,{taskId:task.taskId,agentId:member.agentId,
        modelSnapshotId:member.modelSnapshotId,inputHash});
      if(saved!==undefined){try{return parseOutput(saved.output_text);}catch(error){issue=message(error);last=error;continue;}}
      const maxOutputTokens=4500;
      // A following event carries the previous event settlement, so its prompt can be
      // materially larger than the first event. Freeze against the actual request
      // instead of a fixed first-event allowance. The two estimators cover both the
      // deterministic fixture and real tokenizers; subscription protocol overhead is
      // kept separate from the content allowance.
      const protocolOverhead=adapter.provider==='openai-codex-subscription'?24000:0;
      const estimatedInputCeiling=Math.max(
        Math.ceil(input.length/2),Math.ceil(estimateTokens(input)*1.35)
      );
      const reservedTokens=Math.max(9000,estimatedInputCeiling+maxOutputTokens+protocolOverhead);
      const requestId=this.ids.next(),reservationId=this.budgets.reserve(
        scope,task.budgetId,requestId,reservedTokens,0
      );
      try{
        const result=await this.calls.execute(scope,{requestId,taskId:task.taskId,
          phaseKey:kind+':attempt-'+task.currentAttemptNo+':try-'+attempt,agentId:member.agentId,
          modelSnapshotId:member.modelSnapshotId,provider:member.provider,modelId:member.modelId,input,
          parameters:JSON.stringify({maxOutputTokens,planOnly:!member.provider.startsWith('local-deterministic'),cashFallbackAllowed:false}),
          reservationId,contextPackId:packId,leaseToken:task.leaseToken,attemptNo:task.currentAttemptNo},adapter,{
          requestId,taskId:task.taskId,ownerId:scope.ownerId,bookId:scope.bookId,agentId:member.agentId,prompt:input,maxOutputTokens
        });
        try{return parseOutput(result.output);}catch(error){issue=message(error);last=error;}
      }catch(error){last=error;if(this.repo.hasUnresolved(scope,task.taskId))throw error;}
    }
    throw last instanceof Error?last:new Error('模型没有返回有效事件大纲。');
  }

  private current(scope:BookScope,brief:StoryEventGenerationBrief){
    const snapshot=this.repo.snapshot(scope,brief.eventId),workflow=this.eventRepo.workflow(scope);
    if(snapshot===undefined||snapshot.eventRevision!==brief.expectedEventRevision
      ||snapshot.activeVersionId!==brief.expectedActiveVersionId||storyEventFingerprint(snapshot)!==brief.sourceFingerprint)
      throw conflict('卷纲、设定、事件或上一事件结算已经变化，请重新生成。');
    if(workflow===undefined||workflow.planning_version!==brief.expectedWorkflowVersion)throw conflict('创作流程已经变化。');
    return snapshot;
  }
  private assertClaim(task:TaskRecord,workerId:string,fence?:TaskLeaseFence){
    if(task.taskType!=='story_event_generation'||task.status!=='working'||task.leaseOwner!==workerId
      ||(fence!==undefined&&(task.leaseToken!==fence.leaseToken||task.currentAttemptNo!==fence.attemptNo)))
      throw new Error('事件任务未由指定Worker持有。');
  }
  private cancelled(scope:BookScope,taskId:string){if(this.tasks.require(scope,taskId).cancelRequested)throw new DOMException('已取消','AbortError');}
  private stored(scope:BookScope,eventId:string,taskId:string){return{
    candidateAId:this.repo.candidate(scope,eventId,taskId,'candidate_a')?.story_event_version_id??null,
    candidateBId:this.repo.candidate(scope,eventId,taskId,'candidate_b')?.story_event_version_id??null,
    fusionId:this.repo.candidate(scope,eventId,taskId,'fusion')?.story_event_version_id??null};}
}

export function parseStoryEventModelOutput(output:string):StoryEventContent{
  const values:unknown[]=[];try{values.push(JSON.parse(output) as unknown);}catch{}
  for(const object of jsonObjects(output))try{values.push(JSON.parse(object) as unknown);}catch{}
  for(const value of values){const candidates=record(value)?[value,value.content,value.storyEvent,value.payload]:[value];
    for(const candidate of candidates)try{return parseStoryEventContent(candidate);}catch{}}
  throw new Error('输出缺少合法事件大纲JSON。');
}
function parseOutput(output:string){return parseStoryEventModelOutput(output);}
function hardSources(s:StoryEventGenerationSnapshot,b:StoryEventGenerationBrief,peers:StoryEventContent[]):ContextSource[]{
  const result:ContextSource[]=[
    {sourceType:'planning:volume_plan',sourceId:s.volumePlanId,version:s.volumeVersion,content:bounded(s.volumeContent,18000),reason:'当前确认卷纲；事件必须服务卷目标',priority:100},
    {sourceType:'planning:event_seed',sourceId:s.seed.id,version:s.seed.version,content:bounded(s.seed.content,9000),reason:'卷纲分配给本事件的任务和接口',priority:100},
    {sourceType:'planning:setting_baseline',sourceId:s.setting.id,version:s.setting.version,content:bounded(s.setting.content,16000),reason:'已确认设定事实边界',priority:100},
    {sourceType:'owner:event_ideas',sourceId:'ideas:'+s.eventId,content:JSON.stringify(b.authorIdeas),reason:'作者原话；必须与偏好按强度处理',priority:100},
    {sourceType:'planning:event_template',sourceId:'template:'+s.eventId,content:JSON.stringify(b.template),reason:'可调整推进参考，不是公式',priority:100}
  ];
  if(s.previousSettlement!==null)result.push({sourceType:'planning:previous_event_settlement',sourceId:s.previousSettlement.id,
    version:s.previousSettlement.version,content:bounded(s.previousSettlement.content,12000),reason:'上一事件实际结果；不是上一事件计划',priority:100});
  if(peers.length>0)result.push({sourceType:'planning:independent_event_candidates',sourceId:'peers:'+s.eventId,
    content:JSON.stringify(peers),reason:'两位编剧独立候选，供主编取舍融合',priority:100});
  return result;
}
function promptFor(member:VolumePlanGenerationSeat,kind:Kind,s:StoryEventGenerationSnapshot,_b:StoryEventGenerationBrief,sources:unknown[]){
  const fusion=kind==='fusion';return JSON.stringify({operation:'story_event_generation_v1',language:'zh-CN',
    seat:{roleKey:member.roleKey,displayName:member.displayName,mode:fusion?'chief_editor_fusion':'independent_screenwriter'},
    book:{title:s.bookTitle,eventOrder:s.order},instructions:fusion?[
      '比较两份独立候选，选择因果更强、人物更鲜活的路径，不要平均拼接。','事件必须在卷纲约束内改变状态并自然引出下一事件。',
      '保留具体场景、对白、意象和局部解法的自由。','只输出JSON。'
    ]:['独立提出完整小事件，不能看到另一位编剧答案。','从欲望、阻力、选择、代价、结果推演，不套爽点清单。',
      '模板只是可调整参考；保留场景、对白和局部反转自由。','只输出JSON。'],
    sourcePolicy:{confirmedSettingIsFact:true,previousSettlementIsFact:true,volumePlanIsConstraint:true,
      unsupportedCoreSetting:'put into uncertaintyNotes'},sources,outputContract:{
      title:'事件名',volumeResponsibility:'服务本卷什么目标',startingState:'进入状态',trigger:'因果触发',
      participants:['参与人物'],characterGoals:['人物目标'],obstacles:['阻力'],choicesAndCosts:['选择与代价'],
      informationMoves:['信息变化'],localProgression:['内部推进节点'],requiredResult:'必须得到的结果',
      flexibleExecution:['留给章纲和主笔的自由'],endingConditions:['结束条件'],nextEventImpact:'下一事件接口',
      characterArcImpact:'人物弧作用',volumeClimaxImpact:'卷高潮作用',
      estimatedChapterRange:{minimum:null,likely:null,maximum:null},uncertaintyNotes:['未知或需确认']}});}
function jsonObjects(value:string){const out:string[]=[];for(let start=0;start<value.length;start++){if(value[start]!=='{')continue;
  let depth=0,str=false,escape=false;for(let i=start;i<value.length;i++){const ch=value[i]!;
    if(str){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')str=false;continue;}
    if(ch==='"')str=true;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0){out.push(value.slice(start,i+1));start=i;break;}}}return out;}
function bounded(v:string,n:number){return v.length<=n?v:v.slice(0,Math.floor(n/2))+'\n【中间内容按需回查】\n'+v.slice(-Math.floor(n/2));}
function parseBrief(v:Record<string,unknown>){const b=v as unknown as StoryEventGenerationBrief;
  if(b.schema!=='story-event-generation-v1'||typeof b.eventId!=='string'||!Array.isArray(b.seats))throw new Error('事件任务资料格式无效。');return b;}
function seat(seats:VolumePlanGenerationSeat[],role:string){const value=seats.find(s=>s.roleKey===role);if(value===undefined)throw new Error('事件任务缺少岗位：'+role);return value;}
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function message(e:unknown){return e instanceof Error?e.message:'事件JSON无效';}
function conflict(m:string){return new DomainError(errorCodes.bookVersionConflict,m,{},false,409);}
