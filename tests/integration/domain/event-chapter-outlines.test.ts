import { afterEach,describe,expect,it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { WritingReadinessService } from '../../../apps/api/src/application/creation/writing-readiness-service.js';
import { PlanningChainContextService } from '../../../apps/api/src/application/creation/planning-chain-context-service.js';
import { CreationWorkflowProgressService } from '../../../apps/api/src/application/creation/creation-workflow-progress-service.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { ContextPackService } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { EventChapterGenerationPipelineService } from '../../../apps/api/src/application/planning/event-chapter-generation-pipeline-service.js';
import { EventChapterGenerationService } from '../../../apps/api/src/application/planning/event-chapter-generation-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { EventChapterGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/event-chapter-generation-repository.js';
import { VolumePlanGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-generation-repository.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { EventChapterOutlineService } from '../../../apps/api/src/application/planning/event-chapter-outline-service.js';
import { StoryEventService } from '../../../apps/api/src/application/planning/story-event-service.js';
import { VolumePlanService } from '../../../apps/api/src/application/planning/volume-plan-service.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { EventChapterOutlineRepository } from '../../../apps/api/src/infrastructure/db/repositories/event-chapter-outline-repository.js';
import { StoryEventRepository } from '../../../apps/api/src/infrastructure/db/repositories/story-event-repository.js';
import { VolumePlanRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-repository.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext,FixedClock,SequenceIds,type TestContext } from '../../helpers/test-context.js';

describe('事件章纲序列与近期冻结',()=>{
  let context:TestContext|undefined;afterEach(()=>{context?.close();context=undefined;});
  it('先确认完整连续序列，再只冻结最近一至三章并桥接不可变章纲成果',()=>{
    context=createTestContext('wenmi-event-chapters-');const ids=new SequenceIds(),clock=new FixedClock(),uow=new UnitOfWork(context.database);
    const book=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'事件章纲测试书'});
    const other=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'隔离书'});
    const scope={ownerId:context.config.ownerId,bookId:book.bookId},otherScope={ownerId:context.config.ownerId,bookId:other.bookId};
    prepare(context,scope,ids,clock);
    const volumes=new VolumePlanService(new VolumePlanRepository(context.database),uow,ids,clock);
    const plan=volumes.create(scope,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,planNumber:1,idempotencyKey:'chapters-volume'});
    const volumeVersion=volumes.addVersion(scope,plan.volumePlanId,{expectedPlanRevision:plan.revision,candidateKind:'author_edit',
      template:noTemplate('volume'),content:volumeContent(),idempotencyKey:'chapters-volume-v1'});
    volumes.confirm(scope,plan.volumePlanId,{volumePlanVersionId:volumeVersion.volumePlanVersionId,expectedPlanRevision:plan.revision,
      expectedActiveVersionId:null,expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    const events=new StoryEventService(new StoryEventRepository(context.database),uow,ids,clock);
    const chain=events.initialize(scope,plan.volumePlanId,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,idempotencyKey:'chapters-events'});
    const event=chain.events[0]!;
    const eventVersion=events.addVersion(scope,event.eventId,{expectedEventRevision:event.revision,candidateKind:'author_edit',
      template:noTemplate('event'),content:eventContent(),idempotencyKey:'chapters-event-v1'});
    events.confirm(scope,event.eventId,{versionId:eventVersion.storyEventVersionId,expectedEventRevision:event.revision,
      expectedWorkflowVersion:volumes.workflow(scope).planningVersion});

    const service=new EventChapterOutlineService(new EventChapterOutlineRepository(context.database),uow,
      new ArtifactService(context.database,ids,clock),ids,clock);
    const initialized=service.initialize(scope,event.eventId,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,
      idempotencyKey:'chapter-sequence'});
    expect(service.get(otherScope,event.eventId)).toBeNull();
    const candidate=service.addSequenceVersion(scope,event.eventId,{expectedSequenceRevision:initialized.revision,
      content:sequenceContent(),idempotencyKey:'chapter-sequence-v1'});
    const confirmed=service.confirmSequence(scope,event.eventId,{sequenceVersionId:candidate.sequenceVersionId,
      expectedSequenceRevision:initialized.revision,expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    expect(confirmed.outlines.map(item=>item.chapterNumber)).toEqual([1,2,3]);
    expect(confirmed.outlines.map(item=>item.planned.openingState)).toEqual(['事件开始状态','第一章结束状态','第二章结束状态']);
    expect(confirmed.activeVersion?.content.closureCoverage).toEqual([
      {endingCondition:'主角取得能被下一事件承接的证据',evidenceChapterNumber:3}
    ]);

    const detailed=confirmed.outlines.map((outline,index)=>service.addOutlineVersion(scope,outline.outlineId,{
      expectedOutlineRevision:outline.revision,content:detailedContent(outline.chapterNumber,index===2),
      idempotencyKey:'detailed-'+outline.chapterNumber
    }));
    expect(()=>service.freezeRecent(scope,event.eventId,{items:[{
      outlineId:confirmed.outlines[1]!.outlineId,outlineVersionId:detailed[1]!.outlineVersionId,
      expectedOutlineRevision:confirmed.outlines[1]!.revision+1
    }],expectedWorkflowVersion:volumes.workflow(scope).planningVersion})).toThrow('最近未冻结');

    const latest=service.get(scope,event.eventId)!;
    const frozen=service.freezeRecent(scope,event.eventId,{items:latest.outlines.slice(0,2).map((outline,index)=>({
      outlineId:outline.outlineId,outlineVersionId:detailed[index]!.outlineVersionId,expectedOutlineRevision:outline.revision
    })),expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    expect(frozen.outlines.map(item=>item.status)).toEqual(['frozen','frozen','candidate']);
    expect(frozen.outlines.slice(0,2).every(item=>item.activeVersion?.artifactVersionId!==null)).toBe(true);
    expect(frozen.outlines[0]!.activeVersion!.content.creativeFreedom.length).toBeGreaterThan(0);
    const workflow=volumes.workflow(scope);
    expect(workflow).toMatchObject({stage:'next_chapters_ready'});
    expect(workflow.frozenChapterOutlineRefs).toHaveLength(2);
    const selected=context.database.prepare(`SELECT COUNT(*) AS count FROM artifact_versions v JOIN artifacts a ON a.artifact_id=v.artifact_id
      WHERE a.owner_id=? AND a.book_id=? AND a.artifact_type='chapter_outline' AND v.status='selected'`)
      .get(scope.ownerId,scope.bookId) as{count:number};
    expect(selected.count).toBe(2);
    expect(new WritingReadinessService(context.database).inspect(scope,2)).toMatchObject({ready:true,missing:[]});
    const firstFrozenArtifactVersionId=frozen.outlines[0]!.activeVersion!.artifactVersionId!;
    const secondFrozenArtifactVersionId=frozen.outlines[1]!.activeVersion!.artifactVersionId!;
    const planningContext=new PlanningChainContextService(context.database);
    expect(planningContext.factReviewSources(scope,firstFrozenArtifactVersionId).map(source=>source.sourceType)).toEqual([
      'planning:volume_boundary','planning:event_boundary','planning:event_chapter_chain'
    ]);
    const progress=new CreationWorkflowProgressService(context.database).markChapterSettled(scope,1);
    expect(progress).toMatchObject({managed:true,stage:'next_chapters_ready',eventId:event.eventId});
    expect(volumes.workflow(scope).frozenChapterOutlineRefs).toHaveLength(1);
    context.database.prepare("UPDATE event_chapter_sequences SET status='stale' WHERE owner_id=? AND book_id=? AND event_id=?")
      .run(scope.ownerId,scope.bookId,event.eventId);
    expect(service.get(scope,event.eventId)).toMatchObject({status:'stale',valid:false});
    expect(new WritingReadinessService(context.database).inspect(scope,2).missing).toContain('confirmed_outline:2');
    expect(()=>planningContext.validate(scope,secondFrozenArtifactVersionId)).toThrow();
  });

  it('通过真实任务保存完整章链候选，再只细化最近两章且不越权冻结',async()=>{
    context=createTestContext('wenmi-event-chapter-generation-');
    const ids=new SequenceIds(),clock=new FixedClock(),uow=new UnitOfWork(context.database);
    const book=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'章纲生成测试书'});
    const scope={ownerId:context.config.ownerId,bookId:book.bookId};
    prepare(context,scope,ids,clock);
    const volumes=new VolumePlanService(new VolumePlanRepository(context.database),uow,ids,clock);
    const plan=volumes.create(scope,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,planNumber:1,idempotencyKey:'ai-chapters-volume'});
    const volumeVersion=volumes.addVersion(scope,plan.volumePlanId,{expectedPlanRevision:plan.revision,candidateKind:'author_edit',
      template:noTemplate('volume'),content:volumeContent(),idempotencyKey:'ai-chapters-volume-v1'});
    volumes.confirm(scope,plan.volumePlanId,{volumePlanVersionId:volumeVersion.volumePlanVersionId,expectedPlanRevision:plan.revision,
      expectedActiveVersionId:null,expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    const storyRepo=new StoryEventRepository(context.database);
    const events=new StoryEventService(storyRepo,uow,ids,clock);
    const chain=events.initialize(scope,plan.volumePlanId,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,idempotencyKey:'ai-chapters-events'});
    const event=chain.events[0]!;
    const eventVersion=events.addVersion(scope,event.eventId,{expectedEventRevision:event.revision,candidateKind:'author_edit',
      template:noTemplate('event'),content:{...eventContent(),estimatedChapterRange:{minimum:10,likely:10,maximum:10}},idempotencyKey:'ai-chapters-event-v1'});
    events.confirm(scope,event.eventId,{versionId:eventVersion.storyEventVersionId,expectedEventRevision:event.revision,
      expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    const outlineRepo=new EventChapterOutlineRepository(context.database);
    const outlines=new EventChapterOutlineService(outlineRepo,uow,new ArtifactService(context.database,ids,clock),ids,clock);
    const initialized=outlines.initialize(scope,event.eventId,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,idempotencyKey:'ai-chapter-sequence'});
    const generationRepo=new EventChapterGenerationRepository(context.database);
    const tasks=new TaskService(context.database,context.config.releaseId,clock);
    const budgets=new BudgetService(context.database,ids,clock);
    const generations=new EventChapterGenerationService(generationRepo,outlines,new VolumePlanGenerationRepository(context.database),tasks,uow,ids,clock);
    const pipeline=new EventChapterGenerationPipelineService(generationRepo,outlineRepo,outlines,generations,tasks,budgets,
      new ModelCallService(context.database,clock,budgets),new ContextPackService(context.database,ids,clock),
      ids,clock,new ModelAdapterFactory(context.config.modelRuntime));
    const sequenceInput={expectedSequenceRevision:initialized.revision,expectedWorkflowVersion:volumes.workflow(scope).planningVersion,
      idempotencyKey:'ai-sequence-generate'};
    const sequenceTask=generations.startSequence(scope,event.eventId,sequenceInput);
    expect(generations.startSequence(scope,event.eventId,sequenceInput).taskId).toBe(sequenceTask.taskId);
    const sequenceClaim=tasks.claimNext('worker-event-chapters',120_000)!;
    const sequenceResult=await pipeline.executeClaimed(scope,sequenceTask.taskId,'worker-event-chapters',
      {leaseToken:sequenceClaim.leaseToken!,attemptNo:sequenceClaim.currentAttemptNo});
    expect(sequenceResult).toMatchObject({status:'succeeded'});
    if (!('sequenceVersionId' in sequenceResult)) throw new Error('事件章链任务没有返回版本');
    const current=outlines.get(scope,event.eventId)!;
    const candidate=current.versions.find(version=>version.sequenceVersionId===sequenceResult.sequenceVersionId)!;
    expect(candidate.content.chapters).toHaveLength(10);
    candidate.content.chapters.slice(1).forEach((chapter,index)=>expect(chapter.openingState).toBe(candidate.content.chapters[index]!.endingState));
    const sequenceVersionCount=current.versions.length;
    const sequenceChallengeTask=generations.startSequenceChallenge(scope,event.eventId,candidate.sequenceVersionId,{
      expectedSequenceRevision:current.revision,expectedWorkflowVersion:volumes.workflow(scope).planningVersion,
      idempotencyKey:'ai-sequence-challenge'});
    expect(sequenceChallengeTask.member.roleKey).toBe('second_screenwriter');
    expect(sequenceChallengeTask.member.agentId).not.toBe(sequenceTask.member.agentId);
    const sequenceChallengeClaim=tasks.claimNext('worker-event-chapters',120_000)!;
    const sequenceChallengeResult=await pipeline.executeClaimed(scope,sequenceChallengeTask.taskId,'worker-event-chapters',
      {leaseToken:sequenceChallengeClaim.leaseToken!,attemptNo:sequenceChallengeClaim.currentAttemptNo});
    expect(sequenceChallengeResult).toMatchObject({status:'succeeded'});
    if(!('challenge' in sequenceChallengeResult))throw new Error('章链挑战没有返回建议');
    expect(sequenceChallengeResult.challenge).toMatchObject({targetKind:'sequence',targetId:current.sequenceId,
      targetVersionId:candidate.sequenceVersionId});
    expect(sequenceChallengeResult.challenge.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(sequenceChallengeResult.challenge.suggestions.length).toBeLessThanOrEqual(3);
    expect(outlines.get(scope,event.eventId)!.versions).toHaveLength(sequenceVersionCount);
    const confirmed=outlines.confirmSequence(scope,event.eventId,{sequenceVersionId:candidate.sequenceVersionId,
      expectedSequenceRevision:current.revision,expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    const detailTask=generations.startDetails(scope,event.eventId,{count:3,expectedSequenceRevision:confirmed.revision,
      expectedWorkflowVersion:volumes.workflow(scope).planningVersion,idempotencyKey:'ai-details-generate'});
    const detailClaim=tasks.claimNext('worker-event-chapters',120_000)!;
    const detailResult=await pipeline.executeClaimed(scope,detailTask.taskId,'worker-event-chapters',
      {leaseToken:detailClaim.leaseToken!,attemptNo:detailClaim.currentAttemptNo});
    expect(detailResult).toMatchObject({status:'succeeded'});
    const after=outlines.get(scope,event.eventId)!;
    expect(after.outlines.slice(0,3).map(item=>item.status)).toEqual(['candidate','candidate','candidate']);
    expect(after.outlines.slice(3).every(item=>item.status==='planned')).toBe(true);
    expect(after.outlines.slice(0,3).every(item=>item.versions.length===1&&item.activeVersionId===null)).toBe(true);
    expect(after.outlines.slice(0,3).every(item=>item.versions[0]!.content.creativeFreedom.length>0)).toBe(true);
    const firstOutline=after.outlines[0]!,firstVersion=firstOutline.versions[0]!,outlineVersionCount=firstOutline.versions.length;
    const detailChallengeTask=generations.startDetailChallenge(scope,event.eventId,firstOutline.outlineId,firstVersion.outlineVersionId,{
      expectedSequenceRevision:after.revision,expectedWorkflowVersion:volumes.workflow(scope).planningVersion,
      idempotencyKey:'ai-detail-challenge'});
    expect(detailChallengeTask.member.roleKey).toBe('second_screenwriter');
    const detailChallengeClaim=tasks.claimNext('worker-event-chapters',120_000)!;
    const detailChallengeResult=await pipeline.executeClaimed(scope,detailChallengeTask.taskId,'worker-event-chapters',
      {leaseToken:detailChallengeClaim.leaseToken!,attemptNo:detailChallengeClaim.currentAttemptNo});
    expect(detailChallengeResult).toMatchObject({status:'succeeded'});
    if(!('challenge' in detailChallengeResult))throw new Error('单章挑战没有返回建议');
    expect(detailChallengeResult.challenge).toMatchObject({targetKind:'detail',targetId:firstOutline.outlineId,
      targetVersionId:firstVersion.outlineVersionId});
    expect(detailChallengeResult.challenge.suggestions.every(item=>item.alternative.length>0&&item.tradeoff.length>0
      &&item.downstreamImpact.length>0)).toBe(true);
    expect(outlines.get(scope,event.eventId)!.outlines[0]!.versions).toHaveLength(outlineVersionCount);
    const calls=context.database.prepare("SELECT task_id,context_pack_id FROM model_calls WHERE owner_id=? AND book_id=? AND task_id IN (?,?) AND state='succeeded'")
      .all(scope.ownerId,scope.bookId,sequenceTask.taskId,detailTask.taskId) as unknown as Array<{task_id:string;context_pack_id:string}>;
    expect(calls).toHaveLength(2);
    const detailPack=context.database.prepare('SELECT source_manifest_json FROM context_packs WHERE owner_id=? AND book_id=? AND context_pack_id=?')
      .get(scope.ownerId,scope.bookId,calls.find(call=>call.task_id===detailTask.taskId)!.context_pack_id) as {source_manifest_json:string};
    const types=(JSON.parse(detailPack.source_manifest_json) as Array<{sourceType:string}>).map(source=>source.sourceType);
    expect(types).toEqual(expect.arrayContaining(['planning:volume_plan','planning:story_event','planning:event_chapter_sequence',
      'planning:recent_chapter_slots','owner:chapter_outline_ideas']));
    const challengeCalls=context.database.prepare("SELECT task_id,context_pack_id FROM model_calls WHERE owner_id=? AND book_id=? AND task_id IN (?,?) AND state='succeeded'")
      .all(scope.ownerId,scope.bookId,sequenceChallengeTask.taskId,detailChallengeTask.taskId) as unknown as Array<{task_id:string;context_pack_id:string}>;
    expect(challengeCalls).toHaveLength(2);
    const challengePack=context.database.prepare('SELECT source_manifest_json FROM context_packs WHERE owner_id=? AND book_id=? AND context_pack_id=?')
      .get(scope.ownerId,scope.bookId,challengeCalls.find(call=>call.task_id===detailChallengeTask.taskId)!.context_pack_id) as {source_manifest_json:string};
    const challengeTypes=(JSON.parse(challengePack.source_manifest_json) as Array<{sourceType:string}>).map(source=>source.sourceType);
    expect(challengeTypes).toEqual(expect.arrayContaining(['planning:volume_plan','planning:story_event',
      'planning:event_chapter_sequence','planning:chapter_outline_candidate']));
    expect(challengeTypes).not.toContain('discussion');
    expect(volumes.workflow(scope).waitingTaskId).toBeNull();
  });
});

function prepare(context:TestContext,scope:{ownerId:string;bookId:string},ids:SequenceIds,clock:FixedClock){
  context.database.prepare("INSERT INTO book_opening_blueprints(opening_blueprint_id,owner_id,book_id,version,taxonomy_version,channel,category_key,category_name,blueprint_json,content_hash,status,created_at) VALUES(?,?,?,1,'test','male','fantasy','玄幻','{}',?,'active',?)")
    .run(ids.next(),scope.ownerId,scope.bookId,'0'.repeat(64),clock.now().toISOString());
  const artifacts=new ArtifactService(context.database,ids,clock),bible=artifacts.create(scope,'story_bible','设定大纲',
    {title:'设定',positioning:{},worldRules:['能力有来源和代价'],characters:[],mainPlot:{}},'candidate');
  artifacts.select(scope,bible.artifactId,bible.artifactVersionId);
  context.database.prepare("UPDATE book_planning_states SET version=version+1,stage='setting_ready',setting_baseline_version_id=?,updated_at=? WHERE owner_id=? AND book_id=?")
    .run(bible.artifactVersionId,clock.now().toISOString(),scope.ownerId,scope.bookId);
  const styleId=ids.next(),now=clock.now().toISOString();
  context.database.prepare("INSERT INTO book_style_versions(style_version_id,owner_id,book_id,version,content_json,source_kind,status,created_at) VALUES(?,?,?,1,'{}','owner','selected',?)")
    .run(styleId,scope.ownerId,scope.bookId,now);
  context.database.prepare("UPDATE book_planning_states SET active_style_version_id=? WHERE owner_id=? AND book_id=?")
    .run(styleId,scope.ownerId,scope.bookId);
  context.database.prepare("UPDATE book_expression_profiles SET status='confirmed',narrative_person='third',viewpoint_distance='close' WHERE owner_id=? AND book_id=?")
    .run(scope.ownerId,scope.bookId);
}
function noTemplate(scope:'volume'|'event'){return{selectionMode:'none',templateKey:null,templateVersion:null,templateHash:null,scope,beats:[],customDirection:null};}
function volumeContent(){return{title:'第一卷',openingState:'主角失去退路',coreGoal:'取得行动资格',coreConflict:'与旧规则冲突',
  failureCost:'盟友受损',characterChanges:['学会承担选择'],eventSequence:[{eventId:'seed-1',order:1,title:'公开选择',
    responsibility:'建立卷冲突',entryState:'只有线索',trigger:'同伴受损',action:'公开行动',result:'取得有限资格',
    leadsToNext:null,estimatedChapterRange:{minimum:3,likely:3,maximum:5}}],informationPlan:['揭示规则由人操纵'],
  escalationAndRecovery:['进展引发反制'],endingState:'站稳脚跟',openThreads:['幕后人'],nextVolumeTrigger:'幕后人出手',
  boundaries:{mustAchieve:['主角行动改变局面'],mustNotViolate:['不能无代价变强'],creativeFreedom:['对白与场景自由'],openQuestions:[]}};}
function eventContent(){return{title:'公开选择',volumeResponsibility:'把卷冲突变成现实问题',startingState:'事件开始状态',
  trigger:'同伴受损',participants:['主角','盟友'],characterGoals:['守住行动资格'],obstacles:['证据不足'],
  choicesAndCosts:['公开行动并承担身份暴露'],informationMoves:['确认规则由人操纵'],localProgression:['试探','受阻','选择'],
  requiredResult:'主角取得有限资格并留下可追查证据',flexibleExecution:['场景、对白和局部解法自由'],
  endingConditions:['主角取得能被下一事件承接的证据'],nextEventImpact:'对手开始追查主角',
  characterArcImpact:'主角开始承担后果',volumeClimaxImpact:'积累卷末证据',
  estimatedChapterRange:{minimum:3,likely:3,maximum:5},uncertaintyNotes:['幕后人的身份仍未知']};}
function sequenceContent(){return{eventTitle:'公开选择',startChapterNumber:1,eventEndingConditions:['主角取得能被下一事件承接的证据'],
  closureCoverage:[{endingCondition:'主角取得能被下一事件承接的证据',evidenceChapterNumber:3}],
  flexibilityNotes:['对白、场景、局部误判和描写重心可在详细章纲与正文阶段调整'],chapters:[
    coarse(1,'第一次违令','事件开始状态','第一章结束状态','主角被押去问责'),
    coarse(2,'问责中的证据','第一章结束状态','第二章结束状态','证据指向真正漏洞'),
    coarse(3,'承担公开代价','第二章结束状态','主角取得能被下一事件承接的证据','对手开始追查主角')
  ]};}
function coarse(chapterNumber:number,title:string,openingState:string,endingState:string,nextChapterInterface:string){return{
  chapterNumber,title,eventResponsibility:'推进公开选择事件并改变主角状态',openingState,characterGoals:['主角要保护证据'],
  conflicts:['规则与迫近危机同时施压'],choicesAndCosts:['坚持行动就会暴露身份'],informationChanges:['确认危机不是偶然'],
  storyBeats:['后果落地','尝试受阻','主角选择','状态改变'],endingState,nextChapterInterface,
  softSuggestions:['保持紧张但不机械堆冲突'],creativeFreedom:['对白、动作、意象和局部调度由主笔创造']};}
function detailedContent(chapterNumber:number,last:boolean){return{outlineSchema:'chapter_outline_v2',chapterNumber,title:'第'+chapterNumber+'章',
  sourceStage:{stageNumber:1,title:'会由服务端覆盖',chapterRange:{start:1,end:3}},chapterFunction:'会由序列绑定',
  openingState:'会由序列绑定',requiredEndingState:'会由序列绑定',cast:[{name:'主角',objective:'保护证据',
    knowledgeBoundary:'只知道危机不是偶然，不知道幕后人',chapterRole:'作出有代价的选择',stateChange:'更愿意承担后果'}],
  conflict:{surface:'规则阻止主角行动',failureCost:'证据丢失且盟友受损',successCost:'身份暴露'},
  plotBeats:[{order:1,trigger:'新后果出现',action:'主角核验证据',resistance:'规则阻拦',result:'确认问题真实'},
    {order:2,trigger:'盟友提出质疑',action:'主角改变方案',turn:'决定公开承担责任',result:'获得有限支持'},
    {order:3,trigger:'对手封锁证据',action:'主角付出代价保住线索',result:'局面发生改变'}],
  experience:{primaryTone:'紧张',emotionalCurve:['压迫','怀疑','决断'],payoffPoints:['选择产生效果'],pressurePoints:['关系受损'],readerEffect:'想看后果'},
  descriptionFocus:{primary:['人物选择'],secondary:['环境压力'],compress:['重复解释']},
  informationControl:{reveals:['危机有人推动'],concealed:['幕后人身份'],gaps:['主角与读者知道的信息不同']},
  threadActions:last?[{action:'advance',summary:'幕后人开始反制'}]:[],ending:{result:'状态改变',stateChanges:['主角承担代价'],
    hook:'新问题逼近',nextChapterInterface:'会由序列绑定'},mustImplement:['必须体现选择与代价'],
  mustNotViolate:['不能新增无来源能力'],allowedCandidates:['局部误判'],creativeFreedom:['对白、动作、意象和场景调度自由']};}
