import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { ContextPackService } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { AuthorCollaborationService } from '../../../apps/api/src/application/planning/author-collaboration-service.js';
import {
  parseStoryEventModelOutput, STORY_EVENT_NARRATIVE_RULES, storyEventContextBudget,
  StoryEventGenerationPipelineService
} from '../../../apps/api/src/application/planning/story-event-generation-pipeline-service.js';
import { StoryEventGenerationService } from '../../../apps/api/src/application/planning/story-event-generation-service.js';
import { StoryEventService } from '../../../apps/api/src/application/planning/story-event-service.js';
import { VolumePlanService } from '../../../apps/api/src/application/planning/volume-plan-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { AuthorPlanningInputRepository } from '../../../apps/api/src/infrastructure/db/repositories/author-planning-input-repository.js';
import { StoryEventGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/story-event-generation-repository.js';
import { StoryEventRepository } from '../../../apps/api/src/infrastructure/db/repositories/story-event-repository.js';
import { VolumePlanGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-generation-repository.js';
import { VolumePlanRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-repository.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('事件双编剧团队生成',()=>{
  let context:TestContext|undefined;
  afterEach(()=>{context?.close();context=undefined;});

  it('冻结卷纲、事件种子和作者原话，两位编剧独立完成后主编才融合',async()=>{
    context=createTestContext('wenmi-event-generation-');
    const ids=new SequenceIds(),clock=new FixedClock(),uow=new UnitOfWork(context.database);
    const book=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'事件团队测试书'});
    const scope={ownerId:context.config.ownerId,bookId:book.bookId};
    prepare(context,scope,ids,clock);
    const volumes=new VolumePlanService(new VolumePlanRepository(context.database),uow,ids,clock);
    const plan=volumes.create(scope,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,planNumber:1,idempotencyKey:'event-team-volume'});
    const volumeVersion=volumes.addVersion(scope,plan.volumePlanId,{expectedPlanRevision:plan.revision,candidateKind:'candidate_a',
      template:noTemplate('volume'),content:volumeContent(),idempotencyKey:'event-team-volume-v1'});
    volumes.confirm(scope,plan.volumePlanId,{volumePlanVersionId:volumeVersion.volumePlanVersionId,
      expectedPlanRevision:plan.revision,expectedActiveVersionId:null,expectedWorkflowVersion:volumes.workflow(scope).planningVersion});
    const eventRepo=new StoryEventRepository(context.database);
    const events=new StoryEventService(eventRepo,uow,ids,clock);
    const sequence=events.initialize(scope,plan.volumePlanId,{expectedWorkflowVersion:volumes.workflow(scope).planningVersion,
      idempotencyKey:'event-team-sequence'});
    const event=sequence.events[0]!;
    const idea=new AuthorCollaborationService(new AuthorPlanningInputRepository(context.database),uow,ids,clock).create(scope,{
      surface:'event',subjectType:'story_event',subjectId:event.eventId,intentStrength:'preference',
      originalText:'希望主角不是硬碰硬，而是用之前掌握的信息诱使对手主动犯错。',
      attachmentRefs:[],mentionedAgentIds:[],scopeNotes:'只影响这个事件的破局方式',idempotencyKey:'event-team-idea'
    });
    const repo=new StoryEventGenerationRepository(context.database);
    const tasks=new TaskService(context.database,context.config.releaseId,clock);
    const budgets=new BudgetService(context.database,ids,clock);
    const generations=new StoryEventGenerationService(repo,eventRepo,new VolumePlanGenerationRepository(context.database),
      tasks,uow,ids,clock);
    const startInput={expectedEventRevision:event.revision,expectedActiveVersionId:event.activeVersionId,
      expectedWorkflowVersion:volumes.workflow(scope).planningVersion,template:noTemplate('event'),
      authorInputRefs:[idea.authorInputId],idempotencyKey:'event-team-generation'};
    const scheduled=generations.start(scope,event.eventId,startInput);
    expect(scheduled).toMatchObject({status:'queued',modelDiversityVerified:false});
    expect(generations.start(scope,event.eventId,startInput).taskId).toBe(scheduled.taskId);
    const claim=tasks.claimNext('worker-event-generation',120_000);
    expect(claim?.taskId).toBe(scheduled.taskId);
    const pipeline=new StoryEventGenerationPipelineService(repo,eventRepo,events,tasks,budgets,
      new ModelCallService(context.database,clock,budgets),new ContextPackService(context.database,ids,clock),
      ids,clock,new ModelAdapterFactory(context.config.modelRuntime));
    const result=await pipeline.executeClaimed(scope,scheduled.taskId,'worker-event-generation',{
      leaseToken:claim!.leaseToken!,attemptNo:claim!.currentAttemptNo
    });
    expect(result).toMatchObject({status:'succeeded'});
    const versions=events.listVersions(scope,event.eventId).filter(item=>item.sourceTaskId===scheduled.taskId);
    expect(versions.map(item=>item.candidateKind).sort()).toEqual(['candidate_a','candidate_b','fusion'].sort());
    expect(new Set(versions.map(item=>item.contentHash)).size).toBe(3);
    expect(events.getSequence(scope,plan.volumePlanId)?.events[0]?.activeVersionId).toBeNull();
    expect(generations.latest(scope,event.eventId)).toMatchObject({
      status:'succeeded',currentPhase:'fusion_complete',
      candidateVersionIds:{candidateA:result.candidateAId,candidateB:result.candidateBId,fusion:result.fusionId}
    });
    const calls=context.database.prepare(
      'SELECT phase_key,context_pack_id FROM model_calls WHERE owner_id=? AND book_id=? AND task_id=? AND state=\'succeeded\' ORDER BY phase_key'
    ).all(scope.ownerId,scope.bookId,scheduled.taskId) as unknown as Array<{phase_key:string;context_pack_id:string}>;
    expect(calls).toHaveLength(3);
    const manifests=new Map(calls.map(call=>{
      const row=context!.database.prepare(
        'SELECT source_manifest_json FROM context_packs WHERE owner_id=? AND book_id=? AND context_pack_id=?'
      ).get(scope.ownerId,scope.bookId,call.context_pack_id) as {source_manifest_json:string};
      return[call.phase_key,JSON.parse(row.source_manifest_json) as Array<{sourceType:string;content:string}>] as const;
    }));
    const independent=[...manifests.entries()].filter(([phase])=>phase.startsWith('candidate_a:')||phase.startsWith('candidate_b:'));
    expect(independent).toHaveLength(2);
    for(const[,manifest]of independent){
      expect(manifest.map(source=>source.sourceType)).not.toContain('planning:independent_event_candidates');
      expect(manifest.find(source=>source.sourceType==='owner:event_ideas')?.content).toContain('诱使对手主动犯错');
      expect(manifest.find(source=>source.sourceType==='owner:event_ideas')?.content).toContain('只影响这个事件');
    }
    const fusion=[...manifests.entries()].find(([phase])=>phase.startsWith('fusion:'))?.[1];
    const peers=fusion?.find(source=>source.sourceType==='planning:independent_event_candidates');
    expect(peers?.content).toContain(versions.find(item=>item.candidateKind==='candidate_a')!.content.title);
    expect(peers?.content).toContain(versions.find(item=>item.candidateKind==='candidate_b')!.content.title);
  });

  it('能从带说明的模型回复中提取完整事件JSON',()=>{
    const content=eventContent();
    expect(parseStoryEventModelOutput('候选如下：\n\`\`\`json\n'+JSON.stringify(content)+'\n\`\`\`')).toEqual(content);
    expect(STORY_EVENT_NARRATIVE_RULES.join(' ')).toContain('现在时和主动表达');
    expect(STORY_EVENT_NARRATIVE_RULES.join(' ')).toContain('不要强迫每个字段');
    expect(STORY_EVENT_NARRATIVE_RULES.join(' ')).toContain('不得补写资料中没有依据的核心事实');
  });

  it('主编融合资料包能同时容纳卷纲、上个事件结算和两份完整候选',()=>{
    expect(storyEventContextBudget('candidate_a')).toEqual({tokenBudget:18000,characterBudget:42000});
    expect(storyEventContextBudget('fusion')).toEqual({tokenBudget:32000,characterBudget:76000});
  });
});

function prepare(context:TestContext,scope:{ownerId:string;bookId:string},ids:SequenceIds,clock:FixedClock){
  context.database.prepare("INSERT INTO book_opening_blueprints (opening_blueprint_id,owner_id,book_id,version,taxonomy_version,channel,category_key,category_name,blueprint_json,content_hash,status,created_at) VALUES (?,?,?,1,'test','male','fantasy','玄幻','{}',?,'active',?)")
    .run(ids.next(),scope.ownerId,scope.bookId,'0'.repeat(64),clock.now().toISOString());
  const artifacts=new ArtifactService(context.database,ids,clock);
  const bible=artifacts.create(scope,'story_bible','设定大纲',{title:'设定',positioning:{},worldRules:['能力有来源并有代价'],characters:[],mainPlot:{}},'candidate');
  artifacts.select(scope,bible.artifactId,bible.artifactVersionId);
  context.database.prepare("UPDATE book_planning_states SET version=version+1,stage='setting_ready',setting_baseline_version_id=?,updated_at=? WHERE owner_id=? AND book_id=?")
    .run(bible.artifactVersionId,clock.now().toISOString(),scope.ownerId,scope.bookId);
}
function noTemplate(scope:'volume'|'event'){return{selectionMode:'none' as const,templateKey:null,templateVersion:null,templateHash:null,scope,beats:[],customDirection:null};}
function volumeContent(){return{title:'第一卷',openingState:'主角刚获得有限行动资格',coreGoal:'查清旧规则背后的操纵者',coreConflict:'主角目标与维护旧规则的人冲突',
  failureCost:'主角和盟友失去行动资格',characterChanges:['从证明自己转向承担后果'],eventSequence:[{
    eventId:'seed-1',order:1,title:'胜利留下的缺口',responsibility:'让局部胜利变成新的现实责任',entryState:'主角有线索但没有完整证据',
    trigger:'受害者因主角上次行动遭到反制',action:'主角验证线索并选择承担风险',result:'取得有限证据并暴露软肋',
    leadsToNext:null,estimatedChapterRange:{minimum:5,likely:8,maximum:12}}],
  informationPlan:['逐层确认利益关系'],escalationAndRecovery:['每次进展都引发更具体的反制'],endingState:'主角得到有限主动权',
  openThreads:['操纵者身份'],nextVolumeTrigger:'新的势力被局部胜利触发',boundaries:{mustAchieve:['行动产生可验证变化'],
  mustNotViolate:['不能靠临时能力解决'],creativeFreedom:['具体场景、对白和局部误判'],openQuestions:[]}};}
function eventContent(){return{title:'胜利留下的缺口',volumeResponsibility:'推动本卷核心矛盾',startingState:'主角取得有限进展',
  trigger:'上次行动造成新后果',participants:['主角','盟友'],characterGoals:['守住行动资格'],obstacles:['证据不足'],
  choicesAndCosts:['放弃短期收益换取可持续机会'],informationMoves:['确认危机并非偶然'],localProgression:['后果落地','方案受挫','承担选择'],
  requiredResult:'取得有限证据并暴露软肋',flexibleExecution:['具体场景和对白自由'],endingConditions:['状态发生可验证变化'],
  nextEventImpact:'对手针对暴露的软肋反制',characterArcImpact:'主角开始承担选择后果',volumeClimaxImpact:'积累卷末需要的证据与代价',
  estimatedChapterRange:{minimum:5,likely:8,maximum:12},uncertaintyNotes:[]};}
