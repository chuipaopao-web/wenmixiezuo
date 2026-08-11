import { createHash } from 'node:crypto';
import { parseEventChapterChallengeContent,parseEventChapterSequenceContent,type EventChapterChallengeContent,type EventChapterSequenceContent } from '@wenmi/contracts';
import { parseChapterOutlineV2,type ChapterOutlineV2 } from '../../domain/artifact-schemas.js';
import { DomainError,errorCodes } from '../../domain/errors.js';
import type { Clock,IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { EventChapterGenerationRepository } from '../../infrastructure/db/repositories/event-chapter-generation-repository.js';
import { EventChapterOutlineRepository } from '../../infrastructure/db/repositories/event-chapter-outline-repository.js';
import type { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens,type ContextPackService,type ContextSource } from '../memory/context-pack-service.js';
import { TaskService,type TaskLeaseFence,type TaskRecord } from '../tasks/task-service.js';
import { EventChapterGenerationService,type EventChapterGenerationBrief } from './event-chapter-generation-service.js';
import { EventChapterOutlineService } from './event-chapter-outline-service.js';

export class EventChapterGenerationPipelineService {
  public constructor(private readonly repo:EventChapterGenerationRepository,private readonly outlineRepo:EventChapterOutlineRepository,
    private readonly plans:EventChapterOutlineService,_generations:EventChapterGenerationService,
    private readonly tasks:TaskService,private readonly budgets:BudgetService,private readonly calls:ModelCallService,
    private readonly packs:ContextPackService,private readonly ids:IdGenerator,private readonly clock:Clock,
    private readonly adapters:ModelAdapterFactory){}

  public async executeClaimed(scope:BookScope,taskId:string,workerId:string,fence?:TaskLeaseFence){
    const task=this.tasks.require(scope,taskId);this.assertClaim(task,workerId,fence);
    const brief=parseBrief(task.brief);try{
      this.assertCurrent(scope,brief);
      const output=brief.kind==='sequence'?await this.generateSequence(scope,task,brief)
        :brief.kind==='details'?await this.generateDetails(scope,task,brief)
          :await this.generateChallenge(scope,task,brief);
      const phase=brief.kind==='sequence'?'sequence_candidate_saved':brief.kind==='details'?'detail_candidates_saved'
        :brief.kind==='sequence_challenge'?'sequence_challenge_saved':'detail_challenge_saved';
      this.tasks.checkpoint(scope,taskId,workerId,phase,output,fence);
      this.tasks.complete(scope,taskId,workerId,fence);this.repo.clear(scope,taskId,this.clock.now().toISOString());
      return{taskId,status:'succeeded',...output};
    }catch(error){
      const current=this.tasks.require(scope,taskId);
      if(current.cancelRequested){this.tasks.complete(scope,taskId,workerId,fence);this.repo.clear(scope,taskId,this.clock.now().toISOString());
        return{taskId,status:'cancelled'};}
      const unknown=this.repo.unresolved(scope,taskId);this.tasks.fail(scope,taskId,workerId,
        unknown?errorCodes.modelCallInterrupted:error instanceof DomainError?error.code:'EVENT_CHAPTER_GENERATION_FAILED',fence);
      this.repo.fail(scope,taskId,unknown?'模型结果暂时无法确认，已停止自动重试。':'章纲设计未完成，可从已保存任务重试。',
        this.clock.now().toISOString());throw error;
    }
  }

  private async generateSequence(scope:BookScope,task:TaskRecord,brief:EventChapterGenerationBrief){
    const view=this.plans.get(scope,brief.eventId)!;const snapshot=this.outlineRepo.activeSnapshot(scope,brief.eventId)!;
    const sources:ContextSource[]=[
      {sourceType:'planning:volume_plan',sourceId:snapshot.volumePlanId,version:snapshot.volumeVersion,
        content:snapshot.volumeContent,reason:'活动卷纲是当前事件章节序列的上层约束',priority:100},
      {sourceType:'planning:story_event',sourceId:snapshot.eventId,version:snapshot.eventVersion,
        content:snapshot.eventContent,reason:'已确认事件大纲；完整章节序列必须实现其结束条件',priority:100},
      {sourceType:'owner:chapter_sequence_ideas',sourceId:'ideas:'+brief.eventId,content:JSON.stringify(brief.authorIdeas),
        reason:'作者对当前事件章序列的原话',priority:100}
    ];
    const pack=this.packs.build(scope,{taskId:task.taskId,agentId:brief.member.agentId,canonRevision:0,positioningVersion:0,
      tokenBudget:16000,characterBudget:36000,policyVersion:'event-chapter-sequence-v1',hardSources:sources,optionalSources:[]});
    const prompt=JSON.stringify({operation:'event_chapter_sequence_generation_v1',language:'zh-CN',
      seat:{roleKey:brief.member.roleKey,displayName:brief.member.displayName},startChapterNumber:view.nextChapterNumber,
      instructions:['先设计覆盖整个当前事件的连续章节序列，再由后续任务细化最近一至三章。','章数按事件实际需要决定，不固定六章或十章。',
        '相邻章的开场状态必须等于上一章结束状态。','每项已确认事件结束条件都要标明在哪一章闭环。','只输出JSON。'],
      sources:pack.sources.map(source=>({sourceType:source.sourceType,sourceId:source.sourceId,content:source.content})),
      outputContract:{eventTitle:'当前事件原名',startChapterNumber:view.nextChapterNumber,chapters:[{chapterNumber:1,title:'章名',
        eventResponsibility:'本章对事件的唯一作用',openingState:'开章状态',characterGoals:['人物目标'],conflicts:['阻力'],
        choicesAndCosts:['选择与代价'],informationChanges:['信息变化'],storyBeats:['粗粒度推进节点'],endingState:'章末状态',
        nextChapterInterface:'下一章接口',softSuggestions:['软建议'],creativeFreedom:['自由区']}],
        eventEndingConditions:['原样复制事件结束条件'],closureCoverage:[{endingCondition:'结束条件',evidenceChapterNumber:1}],
        flexibilityNotes:['可滚动调整的部分']}});
    const content=parseSequence(await this.call(scope,task,brief,prompt,pack.contextPackId));
    const saved=this.plans.addSequenceVersion(scope,brief.eventId,{expectedSequenceRevision:brief.expectedSequenceRevision,
      parentVersionId:brief.expectedSequenceVersionId,authorInputRefs:brief.authorInputRefs,content,sourceTaskId:task.taskId,
      idempotencyKey:task.taskId+':sequence'});
    return{sequenceVersionId:saved.sequenceVersionId};
  }

  private async generateDetails(scope:BookScope,task:TaskRecord,brief:EventChapterGenerationBrief){
    const view=this.plans.get(scope,brief.eventId)!;const snapshot=this.outlineRepo.activeSnapshot(scope,brief.eventId)!;
    const targets=brief.outlineRefs.map(ref=>view.outlines.find(item=>item.outlineId===ref.outlineId)!);
    const sources:ContextSource[]=[
      {sourceType:'planning:volume_plan',sourceId:snapshot.volumePlanId,version:snapshot.volumeVersion,
        content:snapshot.volumeContent,reason:'活动卷纲硬约束',priority:100},
      {sourceType:'planning:story_event',sourceId:snapshot.eventId,version:snapshot.eventVersion,
        content:snapshot.eventContent,reason:'活动事件硬约束',priority:100},
      {sourceType:'planning:event_chapter_sequence',sourceId:view.activeVersionId!,version:view.activeVersion!.version,
        content:JSON.stringify(view.activeVersion!.content),reason:'已确认完整事件章纲序列',priority:100},
      {sourceType:'planning:recent_chapter_slots',sourceId:'recent:'+brief.eventId,content:JSON.stringify(targets.map(x=>x.planned)),
        reason:'本轮仅细化的最近一至三章',priority:100},
      {sourceType:'owner:chapter_outline_ideas',sourceId:'ideas:'+brief.eventId,content:JSON.stringify(brief.authorIdeas),
        reason:'作者对本轮章纲的原话',priority:100}
    ];
    const pack=this.packs.build(scope,{taskId:task.taskId,agentId:brief.member.agentId,canonRevision:0,positioningVersion:0,
      tokenBudget:22000,characterBudget:50000,policyVersion:'event-chapter-details-v1',hardSources:sources,optionalSources:[]});
    const prompt=JSON.stringify({operation:'event_chapter_detail_generation_v1',language:'zh-CN',
      seat:{roleKey:brief.member.roleKey,displayName:brief.member.displayName},chapterNumbers:targets.map(x=>x.chapterNumber),
      instructions:['只细化给定的最近一至三章，不提前锁死后续章节。','硬要求、软体验提示和自由创作区必须分开。',
        '每章保留非空自由创作区，正文不是逐字段扩写。','每章三至五个剧情节点，人物行为从目标、阻力、选择和代价推出。','只输出JSON。'],
      sources:pack.sources.map(source=>({sourceType:source.sourceType,sourceId:source.sourceId,content:source.content})),
      outputContract:{outlines:targets.map(target=>detailContract(target.chapterNumber))}});
    const details=parseDetails(await this.call(scope,task,brief,prompt,pack.contextPackId),targets.length);
    const saved=targets.map((target,index)=>this.plans.addOutlineVersion(scope,target.outlineId,{
      expectedOutlineRevision:brief.outlineRefs[index]!.revision,parentVersionId:brief.outlineRefs[index]!.activeVersionId,
      authorInputRefs:brief.authorIdeas.filter(idea=>idea.subjectId===target.outlineId).map(idea=>idea.id),
      content:details[index] as unknown as Record<string,unknown>,sourceTaskId:task.taskId,
      idempotencyKey:task.taskId+':outline:'+target.outlineId}));
    return{outlineVersionIds:saved.map(item=>item.outlineVersionId)};
  }

  private async generateChallenge(scope:BookScope,task:TaskRecord,brief:EventChapterGenerationBrief){
    const target=brief.challengeTarget;if(target===null)throw new Error('章纲挑战任务缺少目标版本。');
    const view=this.plans.get(scope,brief.eventId)!;const snapshot=this.outlineRepo.activeSnapshot(scope,brief.eventId)!;
    const base:ContextSource[]=[
      {sourceType:'planning:volume_plan',sourceId:snapshot.volumePlanId,version:snapshot.volumeVersion,
        content:snapshot.volumeContent,reason:'挑战仍须服从活动卷纲',priority:100},
      {sourceType:'planning:story_event',sourceId:snapshot.eventId,version:snapshot.eventVersion,
        content:snapshot.eventContent,reason:'挑战只优化当前事件内部关键节点',priority:100}
    ];
    let targetContent:unknown;
    if(target.targetKind==='sequence'){
      const version=view.versions.find(item=>item.sequenceVersionId===target.targetVersionId);
      if(version===undefined)throw conflict('要查看的章链候选已经变化。');
      targetContent=version.content;
      base.push({sourceType:'planning:chapter_sequence_candidate',sourceId:target.targetId,version:version.version,
        content:JSON.stringify(version.content),reason:'另一位编剧只挑战这份精确章链候选',priority:100});
    }else{
      const outline=view.outlines.find(item=>item.outlineId===target.targetId),
        version=outline?.versions.find(item=>item.outlineVersionId===target.targetVersionId);
      if(outline===undefined||version===undefined)throw conflict('要查看的单章候选已经变化。');
      targetContent=version.content;
      base.push({sourceType:'planning:event_chapter_sequence',sourceId:view.activeVersionId!,version:view.activeVersion!.version,
        content:JSON.stringify(view.activeVersion!.content),reason:'单章挑战必须服从已确认章链',priority:100});
      base.push({sourceType:'planning:chapter_outline_candidate',sourceId:target.targetId,version:version.version,
        content:JSON.stringify(version.content),reason:'另一位编剧只挑战这份精确单章候选',priority:100});
    }
    const sequenceTarget=target.targetKind==='sequence';
    const pack=this.packs.build(scope,{taskId:task.taskId,agentId:brief.member.agentId,canonRevision:0,positioningVersion:0,
      tokenBudget:sequenceTarget?12000:14000,characterBudget:sequenceTarget?28000:32000,
      policyVersion:sequenceTarget?'event-chapter-sequence-challenge-v1':'event-chapter-detail-challenge-v1',
      hardSources:base,optionalSources:[]});
    const prompt=JSON.stringify({operation:'event_chapter_challenge_v1',language:'zh-CN',
      seat:{roleKey:brief.member.roleKey,displayName:brief.member.displayName},targetKind:target.targetKind,targetId:target.targetId,
      targetVersionId:target.targetVersionId,targetContent,
      instructions:['你不是重写整套方案，只查看关键转折、冲突、人物选择、代价或结尾钩子是否有更好的走法。',
        '只给一至三条真正有价值的替代思路；每条说明可能收益、需要承担的代价和对后文的影响。',
        '不引入没有依据的核心能力、身份或道具，不套固定节拍公式，不声称建议已经被采纳。','使用作者能直接理解的自然语言，只输出JSON。'],
      sources:pack.sources.map(source=>({sourceType:source.sourceType,sourceId:source.sourceId,content:source.content})),
      outputContract:{targetKind:target.targetKind,targetId:target.targetId,targetVersionId:target.targetVersionId,
        summary:'一句话说明最值得重新考虑的地方',suggestions:[{focus:'turning_point',alternative:'另一种走法',
          benefit:'可能更好之处',tradeoff:'需要承担的代价',downstreamImpact:'会影响后面什么'}]}});
    const challenge=parseChallenge(await this.call(scope,task,brief,prompt,pack.contextPackId));
    if(challenge.targetKind!==target.targetKind||challenge.targetId!==target.targetId
      ||challenge.targetVersionId!==target.targetVersionId)throw new Error('挑战意见没有绑定当前候选版本。');
    return{challenge};
  }

  private async call(scope:BookScope,task:TaskRecord,brief:EventChapterGenerationBrief,prompt:string,packId:string){
    if(task.budgetId===null)throw new Error('章纲任务缺少预算。');
    const adapter=this.adapters.resolve(brief.member.provider,brief.member.modelId,'discussion',brief.member.roleKey as never);
    const inputHash=createHash('sha256').update(prompt).digest('hex'),stored=this.repo.succeeded(scope,{taskId:task.taskId,
      agentId:brief.member.agentId,modelSnapshotId:brief.member.modelSnapshotId,inputHash});
    if(stored!==undefined)return stored.output_text;
    const maxOutputTokens=isChallenge(brief.kind)?1800:6500,protocolOverhead=adapter.provider==='openai-codex-subscription'?24000:0;
    const estimatedInputCeiling=Math.max(Math.ceil(prompt.length/2),Math.ceil(estimateTokens(prompt)*1.35));
    const requestId=this.ids.next(),reservationId=this.budgets.reserve(scope,task.budgetId,requestId,
      Math.max(10000,estimatedInputCeiling+maxOutputTokens+protocolOverhead),0);
    const result=await this.calls.execute(scope,{requestId,taskId:task.taskId,phaseKey:brief.kind+':attempt-'+task.currentAttemptNo,
      agentId:brief.member.agentId,modelSnapshotId:brief.member.modelSnapshotId,provider:brief.member.provider,modelId:brief.member.modelId,
      input:prompt,parameters:JSON.stringify({maxOutputTokens,planOnly:!brief.member.provider.startsWith('local-deterministic'),
        cashFallbackAllowed:false}),reservationId,contextPackId:packId,leaseToken:task.leaseToken,attemptNo:task.currentAttemptNo},adapter,{
      requestId,taskId:task.taskId,ownerId:scope.ownerId,bookId:scope.bookId,agentId:brief.member.agentId,prompt,maxOutputTokens});
    return result.output;
  }

  private assertCurrent(scope:BookScope,brief:EventChapterGenerationBrief){
    const view=this.plans.get(scope,brief.eventId);if(view===null||view.revision!==brief.expectedSequenceRevision
      ||view.activeVersionId!==brief.expectedSequenceVersionId)throw conflict('事件章纲已经变化，请重新启动任务。');
    let current:string;
    if(brief.kind==='sequence')current=fingerprint(view);
    else if(brief.kind==='details')current=fingerprint({sequenceId:view.sequenceId,revision:view.revision,
      activeVersionId:view.activeVersionId,outlines:brief.outlineRefs.map(ref=>{const x=view.outlines.find(item=>item.outlineId===ref.outlineId);
        return x===undefined?null:{outlineId:x.outlineId,revision:x.revision,activeVersionId:x.activeVersionId};})});
    else{
      const target=brief.challengeTarget;if(target===null)throw conflict('章纲挑战目标已经失效。');
      if(target.targetKind==='sequence'){
        const version=view.versions.find(item=>item.sequenceVersionId===target.targetVersionId);
        current=fingerprint({sequenceId:view.sequenceId,revision:view.revision,activeVersionId:view.activeVersionId,
          target:version===undefined?null:{targetKind:'sequence',targetId:view.sequenceId,targetVersionId:version.sequenceVersionId,
            contentHash:version.contentHash}});
      }else{
        const outline=view.outlines.find(item=>item.outlineId===target.targetId),
          version=outline?.versions.find(item=>item.outlineVersionId===target.targetVersionId);
        current=fingerprint({sequenceId:view.sequenceId,revision:view.revision,activeVersionId:view.activeVersionId,
          outline:outline===undefined?null:{outlineId:outline.outlineId,revision:outline.revision,activeVersionId:outline.activeVersionId},
          target:version===undefined?null:{targetKind:'detail',targetId:outline!.outlineId,targetVersionId:version.outlineVersionId,
            contentHash:version.contentHash}});
      }
    }
    if(current!==brief.sourceFingerprint)throw conflict('事件章纲来源已经变化，请重新启动任务。');
  }
  private assertClaim(task:TaskRecord,workerId:string,fence?:TaskLeaseFence){if(!isTask(task.taskType)||task.status!=='working'
    ||task.leaseOwner!==workerId||(fence!==undefined&&(task.leaseToken!==fence.leaseToken||task.currentAttemptNo!==fence.attemptNo)))
    throw new Error('章纲任务未由指定Worker持有。');}
}
function parseSequence(output:string):EventChapterSequenceContent{for(const value of candidates(output))try{return parseEventChapterSequenceContent(value);}catch{}
  throw new Error('模型没有返回有效事件章纲序列JSON。');}
function parseDetails(output:string,count:number):ChapterOutlineV2[]{for(const value of candidates(output)){if(!record(value)||!Array.isArray(value.outlines))continue;
  try{const parsed=value.outlines.map(item=>parseChapterOutlineV2(record(item)?item:{}));if(parsed.length===count)return parsed;}catch{}}
  throw new Error('模型没有返回完整的近期详细章纲JSON。');}
function parseChallenge(output:string):EventChapterChallengeContent{for(const value of candidates(output))try{return parseEventChapterChallengeContent(value);}catch{}
  throw new Error('另一位编剧没有返回有效的关键替代建议。');}
function candidates(output:string){const values:unknown[]=[];try{values.push(JSON.parse(output) as unknown);}catch{}
  for(const part of jsonObjects(output))try{values.push(JSON.parse(part) as unknown);}catch{}return values;}
function jsonObjects(value:string){const out:string[]=[];for(let start=0;start<value.length;start++){if(value[start]!=='{')continue;let depth=0,str=false,esc=false;
  for(let i=start;i<value.length;i++){const ch=value[i]!;if(str){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')str=false;continue;}
    if(ch==='"')str=true;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0){out.push(value.slice(start,i+1));start=i;break;}}}return out;}
function detailContract(chapterNumber:number){return{outlineSchema:'chapter_outline_v2',chapterNumber,title:'章名',
  sourceStage:{stageNumber:1,title:'服务端会绑定',chapterRange:{start:chapterNumber,end:chapterNumber}},chapterFunction:'本章功能',
  openingState:'开章状态',requiredEndingState:'必须结束状态',cast:[{name:'人物',objective:'当下目标',knowledgeBoundary:'知情边界',
    chapterRole:'本章作用',stateChange:'可选变化'}],conflict:{surface:'表层冲突',underlying:'深层冲突',oppositionGoal:'对手目标',
    failureCost:'失败代价',successCost:'成功代价'},plotBeats:[{order:1,trigger:'触发',action:'行动',resistance:'阻力',turn:'可选转折',result:'节点结果'}],
  experience:{primaryTone:'主情绪',emotionalCurve:['变化'],payoffPoints:[],pressurePoints:[],readerEffect:'读者感受'},
  descriptionFocus:{primary:[],secondary:[],compress:[]},informationControl:{reveals:[],concealed:[],gaps:[]},threadActions:[],
  ending:{result:'结果',stateChanges:[],hook:'章末钩子',nextChapterInterface:'下一章接口'},mustImplement:['硬要求'],
  mustNotViolate:['不得违反'],allowedCandidates:[],creativeFreedom:['对白、动作、意象和局部调度自由']};}
function parseBrief(v:Record<string,unknown>):EventChapterGenerationBrief{
  const b=v as unknown as EventChapterGenerationBrief;
  if(b.schema==='event-chapter-generation-v2')return b;
  if((v as {schema?:string}).schema==='event-chapter-generation-v1')
    return{...(v as unknown as EventChapterGenerationBrief),schema:'event-chapter-generation-v2',challengeTarget:null};
  throw new Error('章纲任务资料无效。');
}
function isChallenge(v:EventChapterGenerationBrief['kind']){return v==='sequence_challenge'||v==='detail_challenge';}
function isTask(v:string){return['event_chapter_sequence_generation','event_chapter_detail_generation',
  'event_chapter_sequence_challenge','event_chapter_detail_challenge'].includes(v);}
function fingerprint(v:unknown){return createHash('sha256').update(stable(v)).digest('hex');}
function stable(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return'['+v.map(stable).join(',')+']';
  return'{'+Object.keys(v as Record<string,unknown>).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}';}
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function conflict(m:string){return new DomainError(errorCodes.bookVersionConflict,m,{},false,409);}
