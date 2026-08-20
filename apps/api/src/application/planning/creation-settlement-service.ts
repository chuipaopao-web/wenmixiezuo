import type {Clock,IdGenerator} from '../../domain/ids.js';
import {DomainError,errorCodes} from '../../domain/errors.js';
import {assertBookScope,type BookScope} from '../../domain/scope.js';
import type {CreationSettlementRepository,PlanningSettlementView,StageSettlementRow} from '../../infrastructure/db/repositories/creation-settlement-repository.js';
import type {LongformContinuityRepository,SettlementContextRecord} from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import type {StageSettlementService} from '../continuity/stage-settlement-service.js';
import type {StoryThreadService} from './story-thread-service.js';

export class CreationSettlementService{
  public constructor(private readonly repository:CreationSettlementRepository,
    private readonly continuity:LongformContinuityRepository,private readonly settlements:StageSettlementService,
    private readonly ids:IdGenerator,private readonly clock:Clock,private readonly storyThreads?:StoryThreadService){}

  public getEvent(scope:BookScope,eventId:string):PlanningSettlementView|null{
    assertBookScope(scope);return this.repository.assessment(scope,'event',eventId);
  }

  public settleEvent(scope:BookScope,eventId:string,expectedPlanningVersion:number):PlanningSettlementView{
    assertBookScope(scope);
    const plan=this.repository.eventPlan(scope,eventId);
    if(plan===undefined)throw missing('当前事件不存在、未确认或不属于本书。');
    const workflow=this.repository.workflow(scope);
    const already=this.repository.assessment(scope,'event',eventId);
    if(already!==null&&workflow.stage!=='event_settlement_in_progress')return already;
    if(workflow.stage!=='event_settlement_in_progress'||workflow.activeEventId!==eventId
      ||workflow.activeEventVersionId!==plan.eventVersionId||workflow.planningVersion!==expectedPlanningVersion){
      throw conflict('当前事件或创作进度已经变化，请刷新后再结算。');
    }
    const coverage=this.repository.eventCoverage(scope,eventId);
    if(coverage.total===0||coverage.total!==coverage.settled||coverage.chapterStart<1){
      throw conflict('当前事件还有章节没有经过作者确认和正史结算。');
    }
    const chapters=this.continuity.activeChapterSettlements(scope,coverage.chapterStart,coverage.chapterEnd);
    if(chapters.length!==coverage.total||chapters.some((item,index)=>item.chapterStart!==coverage.chapterStart+index)){
      throw conflict('事件范围内缺少连续的章节结算来源，不能用摘要补齐。');
    }
    let settlement=this.repository.stageSettlement(scope,'story_arc',eventId);
    if(settlement===undefined){
      const payload=aggregate(chapters);
      const built=this.settlements.build(scope,{stageType:'story_arc',stageKey:eventId,
        chapterStart:coverage.chapterStart,chapterEnd:coverage.chapterEnd,
        canonRevision:this.continuity.latestCanonRevision(scope),payload,
        sources:chapters.map(chapter=>({sourceType:'chapter_settlement',sourceId:chapter.settlementId,
          sourceHash:this.continuity.settlementSourceHash(chapter),locator:{chapterStart:chapter.chapterStart,
            chapterEnd:chapter.chapterEnd,version:chapter.version}})),
        probes:[
          {type:'source',expected:coverage.total,actual:chapters.length,passed:chapters.length===coverage.total},
          {type:'causality',expected:[coverage.chapterStart,coverage.chapterEnd],
            actual:[chapters[0]!.chapterStart,chapters.at(-1)!.chapterEnd],passed:true},
          {type:'state',expected:this.continuity.latestCanonRevision(scope),
            actual:Math.max(...chapters.map(item=>item.canonRevision)),
            passed:chapters.every(item=>item.canonRevision<=this.continuity.latestCanonRevision(scope))}
        ]});
      if(!built.activated)throw conflict('事件结算的来源探针未通过，现有正史没有变化。');
      settlement=this.repository.stageSettlement(scope,'story_arc',eventId);
    }
    if(settlement===undefined)throw new Error('事件结算建立后无法读取');
    const actual=this.repository.settlementActual(settlement);
    const planned=eventPlanProjection(JSON.parse(plan.eventContentJson) as Record<string,unknown>);
    this.repository.insertAssessment(scope,{id:this.ids.next(),stageKind:'event',stageObjectId:eventId,
      settlementId:settlement.stage_settlement_id,planVersionId:plan.eventVersionId,planned,actual,
      deviation:comparison(planned,actual,'事件'),canonRevision:settlement.canon_revision,now:this.clock.now().toISOString()});
    if(!this.repository.completeEvent(scope,{eventId,settlementId:settlement.stage_settlement_id,
      expectedPlanningVersion,now:this.clock.now().toISOString()})){
      const latest=this.repository.workflow(scope);
      if(latest.activeEventId===eventId&&latest.stage==='event_settlement_in_progress')
        throw conflict('事件结算完成时创作进度发生冲突，请刷新后重试。');
    }
    this.repository.recordFirstVolumeClimaxCompletion(scope,{eventId,settlementId:settlement.stage_settlement_id,
      chapterStart:settlement.chapter_start,chapterEnd:settlement.chapter_end,actual,now:this.clock.now().toISOString()});
    this.storyThreads?.applyEventSettlement(scope,eventId,settlement.stage_settlement_id);
    return this.repository.assessment(scope,'event',eventId)!;
  }

  public getVolume(scope:BookScope,volumePlanId:string):PlanningSettlementView|null{
    assertBookScope(scope);return this.repository.assessment(scope,'volume',volumePlanId);
  }

  public settleVolume(scope:BookScope,volumePlanId:string,expectedPlanningVersion:number):PlanningSettlementView{
    assertBookScope(scope);
    const plan=this.repository.volumePlan(scope,volumePlanId);
    if(plan===undefined)throw missing('当前卷不存在、未确认或不属于本书。');
    const workflow=this.repository.workflow(scope);
    const already=this.repository.assessment(scope,'volume',volumePlanId);
    if(already!==null&&workflow.stage!=='volume_settlement_in_progress')return already;
    if(workflow.stage!=='volume_settlement_in_progress'||workflow.activeVolumePlanId!==volumePlanId
      ||workflow.activeVolumePlanVersionId!==plan.volumePlanVersionId||workflow.planningVersion!==expectedPlanningVersion){
      throw conflict('当前卷或创作进度已经变化，请刷新后再结算。');
    }
    const events=this.repository.volumeEvents(scope,volumePlanId);
    if(events.length===0||events.some(event=>event.status!=='settled'||event.settlementId===null)){
      throw conflict('当前卷还有事件没有完成结算。');
    }
    const sources=events.map(event=>{
      const row=this.repository.stageSettlement(scope,'story_arc',event.eventId);
      if(row===undefined)throw conflict('当前卷缺少事件结算来源，不能自动补写。');
      return{event,row,record:this.record(row,'story_arc',event.eventId)};
    });
    const chapterStart=Math.min(...sources.map(item=>item.record.chapterStart));
    const chapterEnd=Math.max(...sources.map(item=>item.record.chapterEnd));
    let settlement=this.repository.stageSettlement(scope,'volume',volumePlanId);
    if(settlement===undefined){
      const payload=aggregate(sources.map(item=>item.record));
      const canonRevision=this.continuity.latestCanonRevision(scope);
      const built=this.settlements.build(scope,{stageType:'volume',stageKey:volumePlanId,chapterStart,chapterEnd,
        canonRevision,payload,sources:sources.map(({event,record})=>({sourceType:'event_settlement',
          sourceId:record.settlementId,sourceHash:this.continuity.settlementSourceHash(record),
          locator:{eventId:event.eventId,sequenceOrder:event.sequenceOrder,version:record.version}})),
        probes:[
          {type:'source',expected:events.length,actual:sources.length,passed:events.length===sources.length},
          {type:'causality',expected:[chapterStart,chapterEnd],actual:[sources[0]!.record.chapterStart,sources.at(-1)!.record.chapterEnd],
            passed:sources.every((item,index)=>index===0||item.record.chapterStart===sources[index-1]!.record.chapterEnd+1)},
          {type:'state',expected:canonRevision,actual:Math.max(...sources.map(item=>item.record.canonRevision)),
            passed:sources.every(item=>item.record.canonRevision<=canonRevision)}
        ]});
      if(!built.activated)throw conflict('卷结算的来源探针未通过，现有正史没有变化。');
      settlement=this.repository.stageSettlement(scope,'volume',volumePlanId);
    }
    if(settlement===undefined)throw new Error('卷结算建立后无法读取');
    const actual=this.repository.settlementActual(settlement);
    const planned=volumePlanProjection(JSON.parse(plan.volumeContentJson) as Record<string,unknown>);
    this.repository.insertAssessment(scope,{id:this.ids.next(),stageKind:'volume',stageObjectId:volumePlanId,
      settlementId:settlement.stage_settlement_id,planVersionId:plan.volumePlanVersionId,planned,actual,
      deviation:comparison(planned,actual,'当前卷'),canonRevision:settlement.canon_revision,now:this.clock.now().toISOString()});
    if(!this.repository.completeVolume(scope,{volumePlanId,expectedPlanningVersion,now:this.clock.now().toISOString()})){
      const latest=this.repository.workflow(scope);
      if(latest.activeVolumePlanId===volumePlanId&&latest.stage==='volume_settlement_in_progress')
        throw conflict('卷结算完成时创作进度发生冲突，请刷新后重试。');
    }
    return this.repository.assessment(scope,'volume',volumePlanId)!;
  }

  private record(row:StageSettlementRow,stageType:'story_arc'|'volume',stageKey:string):SettlementContextRecord{
    return{settlementId:row.stage_settlement_id,stageType,stageKey,version:row.version,chapterStart:row.chapter_start,
      chapterEnd:row.chapter_end,canonRevision:row.canon_revision,payload:this.repository.settlementActual(row)};
  }
}
function aggregate(records:SettlementContextRecord[]):Record<string,unknown>{
  const last=records.at(-1)!;
  return{irreversibleResults:unique(records.flatMap(item=>array(item.payload.irreversibleResults))),
    entityStates:last.payload.entityStates??{},closedThreads:unique(records.flatMap(item=>array(item.payload.closedThreads))),
    openThreads:last.payload.openThreads??[],relationshipChanges:unique(records.flatMap(item=>array(item.payload.relationshipChanges))),
    knowledgeChanges:unique(records.flatMap(item=>array(item.payload.knowledgeChanges))),
    resourceChanges:unique(records.flatMap(item=>array(item.payload.resourceChanges))),
    ruleChanges:unique(records.flatMap(item=>array(item.payload.ruleChanges))),
    exclusions:['未定稿正文','未确认规划','旧计划预测','模型未核实推断']};
}
function eventPlanProjection(value:Record<string,unknown>){return pick(value,['title','volumeResponsibility','startingState','requiredResult',
  'endingConditions','nextEventImpact','characterArcImpact','volumeClimaxImpact','uncertaintyNotes']);}
function volumePlanProjection(value:Record<string,unknown>){return pick(value,['title','openingState','coreGoal','coreConflict','failureCost',
  'endingState','openThreads','nextVolumeTrigger','boundaries']);}
function comparison(planned:Record<string,unknown>,actual:Record<string,unknown>,label:string){
  return{label,assessmentKind:'derived_plan_actual_review',authority:'non_canon',
    plannedTargets:planned,actualEvidence:actual,automaticVerdict:null,
    reviewNotes:['计划只用于对照，不覆盖正式正文与正史','系统不以关键词匹配冒充剧情目标已经完成','作者可依据实际后果调整下一事件或下一卷']};
}
function pick(value:Record<string,unknown>,keys:string[]){return Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));}
function array(value:unknown):unknown[]{return Array.isArray(value)?value:value===undefined||value===null?[]:[value];}
function unique(values:unknown[]):unknown[]{const seen=new Set<string>();return values.filter(value=>{const key=JSON.stringify(value);if(seen.has(key))return false;seen.add(key);return true;});}
function conflict(message:string){return new DomainError(errorCodes.bookVersionConflict,message,{},false,409);}
function missing(message:string){return new DomainError(errorCodes.bookNotFound,message,{},false,404);}
