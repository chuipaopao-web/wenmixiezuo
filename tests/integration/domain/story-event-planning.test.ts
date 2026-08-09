import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { StoryEventService } from '../../../apps/api/src/application/planning/story-event-service.js';
import { VolumePlanService } from '../../../apps/api/src/application/planning/volume-plan-service.js';
import { StoryEventRepository } from '../../../apps/api/src/infrastructure/db/repositories/story-event-repository.js';
import { VolumePlanRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('事件链与事件大纲',()=>{
  let context:TestContext|undefined;
  afterEach(()=>context?.close());

  it('从确认卷纲初始化稳定事件链，保存候选并阻止后续事件绕过上一事件结算',()=>{
    context=createTestContext('wenmi-story-event-');
    const ids=new SequenceIds(),clock=new FixedClock();
    const first=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'事件测试书'});
    const second=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'隔离书'});
    const scope={ownerId:context.config.ownerId,bookId:first.bookId};
    const other={ownerId:context.config.ownerId,bookId:second.bookId};
    prepare(context,scope,ids,clock);
    const volumes=new VolumePlanService(new VolumePlanRepository(context.database),new UnitOfWork(context.database),ids,clock);
    const plan=volumes.create(scope,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,planNumber:1,idempotencyKey:'event-volume'});
    const planVersion=volumes.addVersion(scope,plan.volumePlanId,{expectedPlanRevision:1,candidateKind:'candidate_a',
      template:noTemplate('volume'),content:volumeContent(),idempotencyKey:'event-volume-v1'});
    volumes.confirm(scope,plan.volumePlanId,{volumePlanVersionId:planVersion.volumePlanVersionId,expectedPlanRevision:1,
      expectedActiveVersionId:null,expectedWorkflowVersion:volumes.workflow(scope).planningVersion});

    const service=new StoryEventService(new StoryEventRepository(context.database),new UnitOfWork(context.database),ids,clock);
    const sequence=service.initialize(scope,plan.volumePlanId,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,idempotencyKey:'event-sequence'});
    expect(sequence.events).toHaveLength(2);
    expect(sequence.events.map(item=>item.order)).toEqual([1,2]);
    expect(service.initialize(scope,plan.volumePlanId,{expectedWorkflowVersion:1,idempotencyKey:'ignored-replay'}).revision).toBe(1);
    expect(service.getSequence(other,plan.volumePlanId)).toBeNull();

    const firstEvent=sequence.events[0]!,secondEvent=sequence.events[1]!;
    const candidate=service.addVersion(scope,firstEvent.eventId,{expectedEventRevision:firstEvent.revision,
      candidateKind:'candidate_a',template:noTemplate('event'),content:eventContent('公开选择','主角承担公开代价'),
      idempotencyKey:'event-one-candidate'});
    const confirmed=service.confirm(scope,firstEvent.eventId,{versionId:candidate.storyEventVersionId,
      expectedEventRevision:firstEvent.revision,expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    expect(confirmed.activeVersion?.content.requiredResult).toBe('主角承担公开代价');
    expect(volumes.workflow(scope).activeEventRef).toMatchObject({
      kind:'story_event',id:firstEvent.eventId,version:candidate.version,contentHash:candidate.contentHash,required:true
    });
    expect(()=>service.addVersion(scope,secondEvent.eventId,{expectedEventRevision:secondEvent.revision,
      candidateKind:'candidate_a',template:noTemplate('event'),content:eventContent('追查后果','主角找到下一层线索'),
      idempotencyKey:'event-two-too-early'})).toThrow('请先完成上一事件实际结算');
  });

  it('重排先给影响预览，以序列CAS原子应用并保留操作历史',()=>{
    context=createTestContext('wenmi-event-order-');
    const ids=new SequenceIds(),clock=new FixedClock();
    const book=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'重排测试书'});
    const scope={ownerId:context.config.ownerId,bookId:book.bookId};
    prepare(context,scope,ids,clock);
    const volumes=new VolumePlanService(new VolumePlanRepository(context.database),new UnitOfWork(context.database),ids,clock);
    const plan=volumes.create(scope,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,planNumber:1,idempotencyKey:'order-volume'});
    const version=volumes.addVersion(scope,plan.volumePlanId,{expectedPlanRevision:1,candidateKind:'candidate_a',
      template:noTemplate('volume'),content:volumeContent(),idempotencyKey:'order-volume-v1'});
    volumes.confirm(scope,plan.volumePlanId,{volumePlanVersionId:version.volumePlanVersionId,expectedPlanRevision:1,
      expectedActiveVersionId:null,expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    const service=new StoryEventService(new StoryEventRepository(context.database),new UnitOfWork(context.database),ids,clock);
    const sequence=service.initialize(scope,plan.volumePlanId,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,idempotencyKey:'order-events'});
    const reversed=[...sequence.events].reverse().map(item=>item.eventId);
    const preview=service.previewOperation(scope,plan.volumePlanId,{expectedSequenceRevision:sequence.revision,
      proposal:{operationKind:'reorder',eventIds:reversed},idempotencyKey:'order-preview'});
    expect(preview.impact).toMatchObject({blocked:false,downstreamDependencyCount:0});
    const applied=service.applyOperation(scope,plan.volumePlanId,{operationId:preview.operationId,expectedSequenceRevision:sequence.revision});
    expect(applied.revision).toBe(2);
    expect(applied.events.map(item=>item.eventId)).toEqual(reversed);
    expect(applied.operations[0]?.status).toBe('applied');
    expect(()=>service.applyOperation(scope,plan.volumePlanId,{operationId:preview.operationId,expectedSequenceRevision:1})).not.toThrow();
  });
});

function prepare(context:TestContext,scope:{ownerId:string;bookId:string},ids:SequenceIds,clock:FixedClock){
  context.database.prepare("INSERT INTO book_opening_blueprints (opening_blueprint_id,owner_id,book_id,version,taxonomy_version,channel,category_key,category_name,blueprint_json,content_hash,status,created_at) VALUES (?,?,?,1,'test','male','fantasy','玄幻','{}',?,'active',?)")
    .run(ids.next(),scope.ownerId,scope.bookId,'0'.repeat(64),clock.now().toISOString());
  const artifacts=new ArtifactService(context.database,ids,clock);
  const bible=artifacts.create(scope,'story_bible','设定大纲',{title:'设定',positioning:{},worldRules:['能力有代价'],characters:[],mainPlot:{}},'candidate');
  artifacts.select(scope,bible.artifactId,bible.artifactVersionId);
  context.database.prepare("UPDATE book_planning_states SET version=version+1,stage='setting_ready',setting_baseline_version_id=?,updated_at=? WHERE owner_id=? AND book_id=?")
    .run(bible.artifactVersionId,clock.now().toISOString(),scope.ownerId,scope.bookId);
}
function noTemplate(scope:'volume'|'event'){return{selectionMode:'none',templateKey:null,templateVersion:null,templateHash:null,scope,beats:[],customDirection:null};}
function volumeContent(){return{title:'第一卷',openingState:'主角失去退路',coreGoal:'取得行动资格',coreConflict:'与旧规则冲突',
  failureCost:'同伴失去退路',characterChanges:['从被动转为主动'],eventSequence:[
    {eventId:'seed-1',order:1,title:'公开选择',responsibility:'建立冲突',entryState:'只有线索',trigger:'同伴受损',
      action:'主角公开行动',result:'取得有限资格',leadsToNext:'反对者追查主角',estimatedChapterRange:{minimum:3,likely:5,maximum:7}},
    {eventId:'seed-2',order:2,title:'追查后果',responsibility:'升级阻力',entryState:'主角已被注意',trigger:'反对者追查',
      action:'主角保护证据',result:'发现幕后线索',leadsToNext:null,estimatedChapterRange:{minimum:3,likely:5,maximum:7}}],
  informationPlan:['逐步揭示幕后力量'],escalationAndRecovery:['胜利带来反制'],endingState:'主角站稳脚跟',
  openThreads:['幕后人是谁'],nextVolumeTrigger:'幕后人出手',boundaries:{mustAchieve:['主角行动改变局面'],
  mustNotViolate:['不能无代价变强'],creativeFreedom:['对白和场景自由'],openQuestions:[]}};}
function eventContent(title:string,result:string){return{title,volumeResponsibility:'推动本卷目标',startingState:'主角带着上一结果进入',
  trigger:'上一行动造成新的阻力',participants:['主角'],characterGoals:['保护证据'],obstacles:['公开规则阻拦'],
  choicesAndCosts:['公开行动并承担身份暴露'],informationMoves:['确认规则由人操纵'],localProgression:['试探','受阻','选择','承担后果'],
  requiredResult:result,flexibleExecution:['对白、场景和局部解法自由'],endingConditions:[result],
  nextEventImpact:'结果直接触发下一事件',characterArcImpact:'主角更愿意承担选择后果',volumeClimaxImpact:'为卷末对抗增加证据',
  estimatedChapterRange:{minimum:3,likely:5,maximum:7},uncertaintyNotes:[]};}
