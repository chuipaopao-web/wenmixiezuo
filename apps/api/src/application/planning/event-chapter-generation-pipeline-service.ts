import { createHash } from 'node:crypto';
import { parseEventChapterChallengeContent,parseEventChapterSequenceContent,type EventChapterChallengeContent,type EventChapterSequenceContent } from '@wenmi/contracts';
import { parseChapterOutlineV2,type ChapterOutlineV2 } from '../../domain/artifact-schemas.js';
import { DomainError,errorCodes } from '../../domain/errors.js';
import { buildGenreBrief } from '../../domain/genre-brief.js';
import { AUTHOR_IDEA_POLICY_EXECUTION } from '../../domain/author-idea-policy.js';
import type { Clock,IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { EventChapterGenerationRepository } from '../../infrastructure/db/repositories/event-chapter-generation-repository.js';
import { EventChapterOutlineRepository } from '../../infrastructure/db/repositories/event-chapter-outline-repository.js';
import { LongformContinuityRepository,type SettlementContextRecord } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import { compactStageSettlementContext } from '../continuity/stage-settlement-presentation.js';
import type { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens,type ContextPackService,type ContextSource } from '../memory/context-pack-service.js';
import { TaskService,type TaskLeaseFence,type TaskRecord } from '../tasks/task-service.js';
import { EventChapterGenerationService,type EventChapterGenerationBrief } from './event-chapter-generation-service.js';
import { EventChapterOutlineService } from './event-chapter-outline-service.js';

export class EventChapterGenerationPipelineService {
  public constructor(private readonly repo:EventChapterGenerationRepository,private readonly outlineRepo:EventChapterOutlineRepository,
    private readonly continuity:LongformContinuityRepository,
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
      ...settlementSources(this.continuity.writerSettlementContext(scope,view.nextChapterNumber,5)),
      ...genreBriefSources(snapshot),
      {sourceType:'planning:volume_plan',sourceId:snapshot.volumePlanId,version:snapshot.volumeVersion,
        content:compactVolumeForEvent(snapshot.volumeContent,eventTitle(snapshot.eventContent)),
        reason:'活动卷纲中与当前事件直接相关的上层约束',priority:100},
      {sourceType:'planning:story_event',sourceId:snapshot.eventId,version:snapshot.eventVersion,
        content:snapshot.eventContent,reason:'已确认事件大纲；完整章节序列必须实现其结束条件',priority:100},
      {sourceType:'owner:chapter_sequence_ideas',sourceId:'ideas:'+brief.eventId,content:JSON.stringify(brief.authorIdeas),
        reason:'作者对当前事件章序列的原话；按指令执行（must必须100%遵守）',priority:100}
    ];
    const pack=this.packs.build(scope,{taskId:task.taskId,agentId:brief.member.agentId,
      canonRevision:this.continuity.latestCanonRevision(scope),positioningVersion:0,
      tokenBudget:16000,characterBudget:36000,policyVersion:'event-chapter-sequence-v1',hardSources:sources,optionalSources:[]});
    const sourcePayload=pack.sources.map(source=>({sourceType:source.sourceType,sourceId:source.sourceId,content:source.content}));
    const skeletonPrompt=JSON.stringify({operation:'event_chapter_sequence_generation_v1',generationPhase:'sequence_skeleton',language:'zh-CN',
      seat:{roleKey:brief.member.roleKey,displayName:brief.member.displayName},startChapterNumber:view.nextChapterNumber,
      instructions:['已结算章节资料是已经发生的正史；若旧规划与正史冲突，必须以最新结算为准，禁止把已经发生的发现、选择或代价再次写成新剧情。',AUTHOR_IDEA_POLICY_EXECUTION,'先为整个当前事件设计连续章节骨架，不在这一轮展开每章的场景细节。','章数按事件实际需要决定，不固定六章或十章。',
        '若卷纲带有firstVolumeLaunch：第1至3章必须分别承接对应黄金三章职责；第1章另须把前500有效字的读者问题、即时处境、情绪抓力和变化承诺写进章节职责；承担卷高潮的事件必须落实重大高潮的选择、代价和不可逆变化。',
        '相邻章必须严格承接：后一章openingState与前一章endingState逐字相同。','每项已确认事件结束条件都要原样复制，并标明在哪一章闭环。',
        '字段内容简洁，每项一到两句话；只输出JSON。'],sources:sourcePayload,
      outputContract:{eventTitle:'当前事件原名',startChapterNumber:view.nextChapterNumber,chapters:[{chapterNumber:1,title:'章名',
        eventResponsibility:'本章对事件的唯一作用',openingState:'开章状态',endingState:'章末状态',nextChapterInterface:'下一章接口'}],
        eventEndingConditions:['原样复制事件结束条件'],closureCoverage:[{endingCondition:'结束条件',evidenceChapterNumber:1}],
        flexibilityNotes:['可滚动调整的部分']}});
    const skeletonOutput=await this.call(scope,task,brief,skeletonPrompt,pack.contextPackId,'sequence-skeleton',5500);
    let skeleton:SequenceSkeleton;
    try{skeleton=parseSequenceSkeleton(skeletonOutput);}catch{
      const repairPrompt=JSON.stringify({operation:'event_chapter_sequence_generation_v1',generationPhase:'sequence_skeleton_repair',language:'zh-CN',
        instruction:'上一次返回接近完整，但至少缺少一个必填字段。只修复JSON结构，不改变故事内容；每章都必须有chapterNumber、title、eventResponsibility、openingState、endingState、nextChapterInterface，最后一章也不能省略nextChapterInterface。',
        invalidOutput:skeletonOutput,outputContract:{eventTitle:'当前事件原名',startChapterNumber:view.nextChapterNumber,
          chapters:[{chapterNumber:view.nextChapterNumber,title:'章名',eventResponsibility:'本章作用',openingState:'开章状态',endingState:'章末状态',
            nextChapterInterface:'下一章或下一事件承接'}],eventEndingConditions:['事件结束条件'],
          closureCoverage:[{endingCondition:'必须与结束条件逐字相同',evidenceChapterNumber:view.nextChapterNumber}],flexibilityNotes:['可自由发挥处']}});
      skeleton=parseSequenceSkeleton(await this.call(scope,task,brief,repairPrompt,pack.contextPackId,'sequence-skeleton-repair',6500));
    }
    skeleton=normalizeGeneratedSequenceSkeleton(skeleton,JSON.parse(snapshot.eventContent) as{title:string;endingConditions:string[]});
    const details:SequenceChapterDetail[]=[];
    for(let index=0;index<skeleton.chapters.length;index+=3){
      const targets=skeleton.chapters.slice(index,index+3),chapterNumbers=targets.map(chapter=>chapter.chapterNumber);
      const detailPrompt=JSON.stringify({operation:'event_chapter_sequence_generation_v1',generationPhase:'chapter_details',language:'zh-CN',
        seat:{roleKey:brief.member.roleKey,displayName:brief.member.displayName},eventTitle:skeleton.eventTitle,startChapterNumber:skeleton.startChapterNumber,
        targetChapterNumbers:chapterNumbers,sequenceSkeleton:skeleton,
        instructions:['只补全targetChapterNumbers指定的两至三章，不重复输出其他章节。',AUTHOR_IDEA_POLICY_EXECUTION,'每章的人物目标、冲突、选择与代价必须具体，并由人物处境自然推出。',
          '每章给出三至五个粗粒度剧情推进点，不写正文，不重复同义句。','软建议与自由创作区必须分开；自由创作区保持非空，让正文写手可以设计对话、动作、意象和局部调度。',
          '字段内容简洁，每项一到两句话；只输出JSON。'],sources:sourcePayload,
        outputContract:{chapters:targets.map(chapter=>({chapterNumber:chapter.chapterNumber,characterGoals:['人物当章目标'],conflicts:['具体阻力'],
          choicesAndCosts:['人物选择与相应代价'],informationChanges:['本章新增、纠正或隐藏的信息'],storyBeats:['三至五个粗粒度推进节点'],
          softSuggestions:['可不用的体验建议'],creativeFreedom:['对白、动作、意象和局部调度的自由空间']}))}});
      details.push(...parseSequenceDetails(await this.call(scope,task,brief,detailPrompt,pack.contextPackId,
        'sequence-details-'+(Math.floor(index/3)+1),5000),chapterNumbers));
    }
    const detailByChapter=new Map(details.map(detail=>[detail.chapterNumber,detail]));
    const content=parseEventChapterSequenceContent({...skeleton,chapters:skeleton.chapters.map(chapter=>{
      const detail=detailByChapter.get(chapter.chapterNumber);if(detail===undefined)throw new Error('章节骨架缺少对应的细节设计。');
      return{...chapter,...detail};
    })});
    const saved=this.plans.addSequenceVersion(scope,brief.eventId,{expectedSequenceRevision:brief.expectedSequenceRevision,
      parentVersionId:brief.expectedSequenceVersionId,authorInputRefs:brief.authorInputRefs,content,sourceTaskId:task.taskId,
      idempotencyKey:task.taskId+':sequence'});
    return{sequenceVersionId:saved.sequenceVersionId};
  }

  private async generateDetails(scope:BookScope,task:TaskRecord,brief:EventChapterGenerationBrief){
    const view=this.plans.get(scope,brief.eventId)!;const snapshot=this.outlineRepo.activeSnapshot(scope,brief.eventId)!;
    const targets=brief.outlineRefs.map(ref=>view.outlines.find(item=>item.outlineId===ref.outlineId)!);
    const activeSequence=view.activeVersion!.content,firstIndex=activeSequence.chapters.findIndex(chapter=>chapter.chapterNumber===targets[0]!.chapterNumber),
      lastIndex=activeSequence.chapters.findIndex(chapter=>chapter.chapterNumber===targets.at(-1)!.chapterNumber);
    const sequenceContext={eventTitle:activeSequence.eventTitle,startChapterNumber:activeSequence.startChapterNumber,
      targetChapterRange:{start:targets[0]!.chapterNumber,end:targets.at(-1)!.chapterNumber},
      previousChapter:firstIndex>0?compactSequenceNeighbor(activeSequence.chapters[firstIndex-1]!):null,
      targetChapters:activeSequence.chapters.slice(firstIndex,lastIndex+1),
      followingChapter:lastIndex>=0&&lastIndex<activeSequence.chapters.length-1
        ?compactSequenceNeighbor(activeSequence.chapters[lastIndex+1]!):null,
      eventEndingConditions:activeSequence.eventEndingConditions,closureCoverage:activeSequence.closureCoverage,
      flexibilityNotes:activeSequence.flexibilityNotes};
    const settlements=this.continuity.writerSettlementContext(scope,targets[0]!.chapterNumber,5);
    const sources:ContextSource[]=[
      ...settlementSources(settlements),
      ...genreBriefSources(snapshot),
      {sourceType:'planning:volume_plan',sourceId:snapshot.volumePlanId,version:snapshot.volumeVersion,
        content:compactVolumeForEvent(snapshot.volumeContent,activeSequence.eventTitle),reason:'活动卷纲中与当前事件相关的硬约束',priority:100},
      {sourceType:'planning:story_event',sourceId:snapshot.eventId,version:snapshot.eventVersion,
        content:snapshot.eventContent,reason:'活动事件硬约束',priority:100},
      {sourceType:'planning:event_chapter_sequence',sourceId:view.activeVersionId!,version:view.activeVersion!.version,
        content:JSON.stringify(sequenceContext),reason:'已确认章序列中本轮三章及其前后承接点',priority:100},
      {sourceType:'owner:chapter_outline_ideas',sourceId:'ideas:'+brief.eventId,content:JSON.stringify(brief.authorIdeas),
        reason:'作者对本轮章纲的原话；按指令执行（must必须100%遵守）',priority:100}
    ];
    const pack=this.packs.build(scope,{taskId:task.taskId,agentId:brief.member.agentId,
      canonRevision:this.continuity.latestCanonRevision(scope),positioningVersion:0,
      tokenBudget:22000,characterBudget:50000,policyVersion:'event-chapter-details-v1',hardSources:sources,optionalSources:[]});
    const sourcePayload=pack.sources.map(source=>({sourceType:source.sourceType,sourceId:source.sourceId,content:source.content}));
    const details:ChapterOutlineV2[]=[];
    const latestSettledChapter=this.continuity.latestSettledChapter(scope);
    const firstHasCanonPredecessor=latestSettledChapter===targets[0]!.chapterNumber-1;
    let previousGeneratedEndingState:string|null=null;
    for(const [index,target] of targets.entries()){
      const prompt=JSON.stringify({operation:'event_chapter_detail_generation_v1',generationPhase:'single_chapter',language:'zh-CN',
        seat:{roleKey:brief.member.roleKey,displayName:brief.member.displayName},chapterNumbers:[target.chapterNumber],
        previousGeneratedEndingState,
        instructions:['已结算章节资料是已经发生的正史；若事件章链的开场描述与最新正史冲突，必须以最新正史为准，禁止重复发现、重复选择或让已经付出的代价复原。',AUTHOR_IDEA_POLICY_EXECUTION,
          ...(previousGeneratedEndingState===null?[]:[`本章openingState必须逐字等于上一份详细章纲的requiredEndingState：${previousGeneratedEndingState}`]),
          ...(target.chapterNumber===1?[
            '这是全书第一章：mustImplement必须写入前500有效字内的读者问题、即时处境、情绪抓力和变化承诺，并承接卷纲goldenThree第1章职责；手段由人物和题材决定，不机械打脸。',
          ]:target.chapterNumber<=3?[
            `这是黄金三章中的第${target.chapterNumber}章：必须承接卷纲goldenThree中同章的职责、行动、压力、有效回报和下一章期待。`]:[]),
          '只细化给定的一章，不重复其他章节，也不提前锁死后续章节。','硬要求、软体验提示和自由创作区必须分开。',
          '保留非空自由创作区，正文不是逐字段扩写。','设计三至五个剧情节点，人物行为从目标、阻力、选择和代价推出。',
          '保持自然、具体、简洁，不写正文，不解释系统规则；只输出JSON。'],sources:sourcePayload,
        outputContract:{outlines:[detailContract(target.chapterNumber)]}});
      const [generated]=parseDetails(await this.call(scope,task,brief,prompt,pack.contextPackId,
        'details-chapter-'+target.chapterNumber),1);
      const normalized=normalizeGeneratedDetailContinuity({generated:generated!,plannedOpeningState:target.planned.openingState,
        previousGeneratedEndingState,hasCanonPredecessor:index===0&&firstHasCanonPredecessor});
      details.push(normalized);previousGeneratedEndingState=normalized.requiredEndingState;
    }
    const saved=targets.map((target,index)=>this.plans.addOutlineVersion(scope,target.outlineId,{
      expectedOutlineRevision:brief.outlineRefs[index]!.revision,parentVersionId:brief.outlineRefs[index]!.activeVersionId,
      authorInputRefs:brief.authorIdeas.filter(idea=>idea.subjectId===target.outlineId).map(idea=>idea.id),
      content:details[index] as unknown as Record<string,unknown>,sourceTaskId:task.taskId,
      contextOpeningState:details[index]!.openingState,
      idempotencyKey:task.taskId+':outline:'+target.outlineId}));
    return{outlineVersionIds:saved.map(item=>item.outlineVersionId)};
  }

  private async generateChallenge(scope:BookScope,task:TaskRecord,brief:EventChapterGenerationBrief){
    const target=brief.challengeTarget;if(target===null)throw new Error('章纲挑战任务缺少目标版本。');
    const view=this.plans.get(scope,brief.eventId)!;const snapshot=this.outlineRepo.activeSnapshot(scope,brief.eventId)!;
    const base:ContextSource[]=[
      ...genreBriefSources(snapshot),
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
        content:JSON.stringify(version.content),reason:'挑战编剧只查看这份精确章链候选',priority:100});
    }else{
      const outline=view.outlines.find(item=>item.outlineId===target.targetId),
        version=outline?.versions.find(item=>item.outlineVersionId===target.targetVersionId);
      if(outline===undefined||version===undefined)throw conflict('要查看的单章候选已经变化。');
      targetContent=version.content;
      base.push({sourceType:'planning:event_chapter_sequence',sourceId:view.activeVersionId!,version:view.activeVersion!.version,
        content:JSON.stringify(view.activeVersion!.content),reason:'单章挑战必须服从已确认章链',priority:100});
      base.push({sourceType:'planning:chapter_outline_candidate',sourceId:target.targetId,version:version.version,
        content:JSON.stringify(version.content),reason:'挑战编剧只查看这份精确单章候选',priority:100});
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

  private async call(scope:BookScope,task:TaskRecord,brief:EventChapterGenerationBrief,prompt:string,packId:string,
    phaseKey:string=brief.kind,maxOutputTokensOverride?:number){
    if(task.budgetId===null)throw new Error('章纲任务缺少预算。');
    const adapter=this.adapters.resolve(brief.member.provider,brief.member.modelId,'structured_planning',brief.member.roleKey as never);
    const inputHash=createHash('sha256').update(prompt).digest('hex'),stored=this.repo.succeeded(scope,{taskId:task.taskId,
      agentId:brief.member.agentId,modelSnapshotId:brief.member.modelSnapshotId,inputHash});
    if(stored!==undefined)return stored.output_text;
    const maxOutputTokens=maxOutputTokensOverride??eventChapterOutputTokenLimit(brief.kind),protocolOverhead=adapter.provider==='openai-codex-subscription'?24000:0;
    const estimatedInputCeiling=Math.max(Math.ceil(prompt.length/2),Math.ceil(estimateTokens(prompt)*1.35));
    const requestId=this.ids.next(),reservationId=this.budgets.reserve(scope,task.budgetId,requestId,
      Math.max(10000,estimatedInputCeiling+maxOutputTokens+protocolOverhead+thinkingTokenAllowance(brief.member.modelId)),0);
    const result=await this.calls.execute(scope,{requestId,taskId:task.taskId,phaseKey:phaseKey+':attempt-'+task.currentAttemptNo,
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
function compactVolumeForEvent(content:string,eventTitle:string){try{const plan=JSON.parse(content) as Record<string,unknown>;
  const events=Array.isArray(plan.eventSequence)?plan.eventSequence:[],currentEvent=events.find(item=>record(item)&&item.title===eventTitle);
  return JSON.stringify({title:plan.title,openingState:plan.openingState,coreGoal:plan.coreGoal,coreConflict:plan.coreConflict,
    failureCost:plan.failureCost,characterChanges:plan.characterChanges,currentEvent,informationPlan:plan.informationPlan,
    escalationAndRecovery:plan.escalationAndRecovery,endingState:plan.endingState,openThreads:plan.openThreads,
    nextVolumeTrigger:plan.nextVolumeTrigger,boundaries:plan.boundaries,routeCard:plan.routeCard,
    storySpine:plan.storySpine,firstVolumeLaunch:plan.firstVolumeLaunch});
}catch{return content;}}
function eventTitle(content:string){try{const value=JSON.parse(content) as Record<string,unknown>;
  return typeof value.title==='string'?value.title:'';}catch{return'';}}
function compactSequenceNeighbor(chapter:EventChapterSequenceContent['chapters'][number]){return{
  chapterNumber:chapter.chapterNumber,title:chapter.title,eventResponsibility:chapter.eventResponsibility,
  openingState:chapter.openingState,endingState:chapter.endingState,nextChapterInterface:chapter.nextChapterInterface
};}
export function normalizeGeneratedDetailContinuity(input:{generated:ChapterOutlineV2;plannedOpeningState:string;
  previousGeneratedEndingState:string|null;hasCanonPredecessor:boolean}):ChapterOutlineV2{
  const openingState=input.previousGeneratedEndingState??(input.hasCanonPredecessor
    ?input.generated.openingState:input.plannedOpeningState);
  return{...input.generated,openingState};
}
function settlementSources(records:SettlementContextRecord[]):ContextSource[]{if(records.length===0)return[];return[{
  sourceType:'canon:settlement_context',sourceId:records.map(record=>record.settlementId).join(':'),
  version:records.map(record=>record.version).join(':'),content:compactStageSettlementContext(records,1800),
  reason:'分层压缩后的最新已结算正史；旧规划与它冲突时以正史为准，需要细节再回查正式来源',priority:120
}];}
function genreBriefSources(snapshot:{openingContent:string|null}):ContextSource[]{
  const brief=buildGenreBrief(snapshot.openingContent);
  if(brief===null)return[];
  return[{sourceType:'planning:genre_brief',sourceId:'genre-brief:current-book',content:brief,
    reason:'本书题材简报；章纲设计与挑战必须贴合该题材定位与基调',priority:100}];
}
function parseSequence(output:string):EventChapterSequenceContent{for(const value of candidates(output))try{return parseEventChapterSequenceContent(value);}catch{}
  throw new Error('模型没有返回有效事件章纲序列JSON。');}
export interface SequenceSkeletonChapter{chapterNumber:number;title:string;eventResponsibility:string;openingState:string;endingState:string;
  nextChapterInterface:string;}
export interface SequenceSkeleton{eventTitle:string;startChapterNumber:number;chapters:SequenceSkeletonChapter[];eventEndingConditions:string[];
  closureCoverage:{endingCondition:string;evidenceChapterNumber:number}[];flexibilityNotes:string[];}
interface SequenceChapterDetail{chapterNumber:number;characterGoals:string[];conflicts:string[];choicesAndCosts:string[];
  informationChanges:string[];storyBeats:string[];softSuggestions:string[];creativeFreedom:string[];}
function parseSequenceSkeleton(output:string):SequenceSkeleton{for(const value of candidates(output)){if(!record(value))continue;try{
    const startChapterNumber=positive(value.startChapterNumber),rawChapters=Array.isArray(value.chapters)?value.chapters:[];
    if(rawChapters.length===0||rawChapters.length>50)continue;
    const chapters=rawChapters.map((item,index)=>{if(!record(item))throw new Error('invalid chapter');const chapterNumber=positive(item.chapterNumber);
      if(chapterNumber!==startChapterNumber+index)throw new Error('non-contiguous chapter');return{chapterNumber,title:textValue(item.title),
        eventResponsibility:textValue(item.eventResponsibility),openingState:textValue(item.openingState),endingState:textValue(item.endingState),
        nextChapterInterface:textValue(item.nextChapterInterface)};});
    const eventEndingConditions=textList(value.eventEndingConditions,true),closureCoverage=(Array.isArray(value.closureCoverage)?value.closureCoverage:[])
      .map(item=>{if(!record(item))throw new Error('invalid closure');return{endingCondition:textValue(item.endingCondition),
        evidenceChapterNumber:positive(item.evidenceChapterNumber)};});
    if(closureCoverage.length!==eventEndingConditions.length)continue;
    return{eventTitle:textValue(value.eventTitle),startChapterNumber,chapters,eventEndingConditions,closureCoverage,
      flexibilityNotes:textList(value.flexibilityNotes,false)};
  }catch{}}
  throw new Error('模型没有返回完整、连续的事件章节骨架JSON。');}
export function normalizeGeneratedSequenceSkeleton(skeleton:SequenceSkeleton,event:{title:string;endingConditions:string[]}):SequenceSkeleton{
  if(event.endingConditions.length!==skeleton.closureCoverage.length)
    throw new Error('模型返回的事件闭环数量与已确认事件不一致。');
  const coverageByCondition=new Map(skeleton.closureCoverage.map(item=>[item.endingCondition,item.evidenceChapterNumber]));
  return{...skeleton,eventTitle:event.title,eventEndingConditions:[...event.endingConditions],
    chapters:skeleton.chapters.map((chapter,index)=>index===0?chapter:{...chapter,openingState:skeleton.chapters[index-1]!.endingState}),
    closureCoverage:event.endingConditions.map((endingCondition,index)=>({endingCondition,
      evidenceChapterNumber:coverageByCondition.get(endingCondition)??skeleton.closureCoverage[index]!.evidenceChapterNumber}))};
}
function parseSequenceDetails(output:string,chapterNumbers:number[]):SequenceChapterDetail[]{for(const value of candidates(output)){if(!record(value)||!Array.isArray(value.chapters))continue;
  try{const parsed=value.chapters.map(item=>{if(!record(item))throw new Error('invalid detail');return{chapterNumber:positive(item.chapterNumber),
    characterGoals:textList(item.characterGoals,false),conflicts:textList(item.conflicts,false),choicesAndCosts:textList(item.choicesAndCosts,false),
    informationChanges:textList(item.informationChanges,false),storyBeats:textList(item.storyBeats,true),softSuggestions:textList(item.softSuggestions,false),
    creativeFreedom:textList(item.creativeFreedom,true)};});
    const byNumber=new Map(parsed.map(item=>[item.chapterNumber,item])),selected=chapterNumbers.map(number=>byNumber.get(number));
    if(selected.every((item):item is SequenceChapterDetail=>item!==undefined))return selected;
  }catch{}}
  throw new Error('模型没有返回指定章节的完整细节JSON。');}
function parseDetails(output:string,count:number):ChapterOutlineV2[]{for(const value of candidates(output)){if(!record(value)||!Array.isArray(value.outlines))continue;
  try{const parsed=value.outlines.map(item=>parseChapterOutlineV2(record(item)?item:{}));if(parsed.length===count)return parsed;}catch{}}
  throw new Error('模型没有返回完整的近期详细章纲JSON。');}
function parseChallenge(output:string):EventChapterChallengeContent{for(const value of candidates(output))try{return parseEventChapterChallengeContent(value);}catch{}
  throw new Error('挑战编剧没有返回有效的关键替代建议。');}
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
  experience:{primaryTone:'主情绪',emotionalCurve:['情绪变化，最多5项'],payoffPoints:['可选，最多2项'],pressurePoints:['可选，最多2项'],readerEffect:'读者感受'},
  descriptionFocus:{primary:['最多5项'],secondary:['最多5项'],compress:['最多5项']},
  informationControl:{reveals:['最多5项'],concealed:['最多5项'],gaps:['最多5项']},
  threadActions:[{action:'plant|advance|payoff，整章最多2项',summary:'伏笔动作说明'}],
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
export function eventChapterOutputTokenLimit(kind:EventChapterGenerationBrief['kind']){
  if(isChallenge(kind))return 6000;
  return kind==='sequence'?12000:9000;
}
function isTask(v:string){return['event_chapter_sequence_generation','event_chapter_detail_generation',
  'event_chapter_sequence_challenge','event_chapter_detail_challenge'].includes(v);}
function fingerprint(v:unknown){return createHash('sha256').update(stable(v)).digest('hex');}
function stable(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return'['+v.map(stable).join(',')+']';
  return'{'+Object.keys(v as Record<string,unknown>).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}';}
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function textValue(v:unknown){if(typeof v!=='string'||v.trim().length===0)throw new Error('text required');return v.trim();}
function positive(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1)throw new Error('positive integer required');return v;}
function textList(v:unknown,nonEmpty:boolean){if(!Array.isArray(v))throw new Error('text list required');const values=[...new Set(v.map(textValue))];
  if(nonEmpty&&values.length===0)throw new Error('non-empty text list required');return values;}
function conflict(m:string){return new DomainError(errorCodes.bookVersionConflict,m,{},false,409);}
