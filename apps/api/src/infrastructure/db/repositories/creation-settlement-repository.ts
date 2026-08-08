import type {DatabaseSync} from 'node:sqlite';
import {assertBookScope,type BookScope} from '../../../domain/scope.js';

export interface SettlementWorkflowRow{
  planningVersion:number;stage:string;activeVolumePlanId:string|null;activeVolumePlanVersionId:string|null;
  activeEventId:string|null;activeEventVersionId:string|null;
}
export interface EventSettlementPlanRow{
  eventId:string;volumePlanId:string;sequenceOrder:number;eventVersionId:string;volumePlanVersionId:string;
  eventContentJson:string;eventContentHash:string;eventStatus:string;
}
export interface EventOutlineCoverage{chapterStart:number;chapterEnd:number;total:number;settled:number;}
export interface VolumeSettlementPlanRow{
  volumePlanId:string;volumePlanVersionId:string;planNumber:number;volumeContentJson:string;volumeContentHash:string;status:string;
}
export interface VolumeEventSettlementRow{
  eventId:string;sequenceOrder:number;status:string;settlementId:string|null;settlementVersion:number|null;
  chapterStart:number|null;chapterEnd:number|null;
}
export interface PlanningSettlementView{
  settlementId:string;stageKind:'event'|'volume';stageObjectId:string;planVersionId:string;version:number;
  chapterStart:number;chapterEnd:number;canonRevision:number;planned:unknown;actual:unknown;deviation:unknown;
  createdAt:string;
}
export interface StageSettlementRow{
  stage_settlement_id:string;version:number;chapter_start:number;chapter_end:number;canon_revision:number;
  irreversible_results_json:string;entity_states_json:string;closed_threads_json:string;open_threads_json:string;
  relationship_changes_json:string;knowledge_changes_json:string;resource_changes_json:string;rule_changes_json:string;
}
export class CreationSettlementRepository{
  public constructor(private readonly database:DatabaseSync){}

  public workflow(scope:BookScope):SettlementWorkflowRow{
    assertBookScope(scope);
    const row=this.database.prepare(`SELECT planning_version,stage,active_volume_plan_id,active_volume_plan_version_id,
      active_event_id,active_event_version_id FROM creation_workflow_states WHERE owner_id=? AND book_id=?`)
      .get(scope.ownerId,scope.bookId) as Record<string,unknown>|undefined;
    if(row===undefined)throw new Error('书籍创作进度不存在或越权');
    return{planningVersion:Number(row.planning_version),stage:String(row.stage),
      activeVolumePlanId:nullable(row.active_volume_plan_id),activeVolumePlanVersionId:nullable(row.active_volume_plan_version_id),
      activeEventId:nullable(row.active_event_id),activeEventVersionId:nullable(row.active_event_version_id)};
  }

  public eventPlan(scope:BookScope,eventId:string):EventSettlementPlanRow|undefined{
    assertBookScope(scope);
    return this.database.prepare(`SELECT e.event_id AS eventId,e.volume_plan_id AS volumePlanId,e.sequence_order AS sequenceOrder,
      e.active_version_id AS eventVersionId,ev.volume_plan_version_id AS volumePlanVersionId,
      ev.content_json AS eventContentJson,ev.content_hash AS eventContentHash,e.status AS eventStatus
      FROM story_events e JOIN story_event_versions ev ON ev.story_event_version_id=e.active_version_id
        AND ev.owner_id=e.owner_id AND ev.book_id=e.book_id
      WHERE e.owner_id=? AND e.book_id=? AND e.event_id=? AND e.status IN ('active','settled') AND ev.status='active'`)
      .get(scope.ownerId,scope.bookId,eventId) as EventSettlementPlanRow|undefined;
  }

  public eventCoverage(scope:BookScope,eventId:string):EventOutlineCoverage{
    assertBookScope(scope);
    const row=this.database.prepare(`SELECT COALESCE(MIN(chapter_number),0) AS chapterStart,
      COALESCE(MAX(chapter_number),0) AS chapterEnd,COUNT(*) AS total,
      SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) AS settled
      FROM event_chapter_outlines WHERE owner_id=? AND book_id=? AND event_id=? AND status<>'archived'`)
      .get(scope.ownerId,scope.bookId,eventId) as unknown as EventOutlineCoverage;
    return row;
  }

  public volumePlan(scope:BookScope,volumePlanId:string):VolumeSettlementPlanRow|undefined{
    assertBookScope(scope);
    return this.database.prepare(`SELECT p.volume_plan_id AS volumePlanId,p.active_version_id AS volumePlanVersionId,
      p.plan_number AS planNumber,v.content_json AS volumeContentJson,v.content_hash AS volumeContentHash,p.status
      FROM volume_plans p JOIN volume_plan_versions v ON v.volume_plan_version_id=p.active_version_id
        AND v.owner_id=p.owner_id AND v.book_id=p.book_id
      WHERE p.owner_id=? AND p.book_id=? AND p.volume_plan_id=? AND p.status IN ('active','completed') AND v.status='active'`)
      .get(scope.ownerId,scope.bookId,volumePlanId) as VolumeSettlementPlanRow|undefined;
  }

  public volumeEvents(scope:BookScope,volumePlanId:string):VolumeEventSettlementRow[]{
    assertBookScope(scope);
    return this.database.prepare(`SELECT e.event_id AS eventId,e.sequence_order AS sequenceOrder,e.status,
      s.stage_settlement_id AS settlementId,s.version AS settlementVersion,s.chapter_start AS chapterStart,s.chapter_end AS chapterEnd
      FROM story_events e LEFT JOIN stage_settlements s ON s.owner_id=e.owner_id AND s.book_id=e.book_id
        AND s.stage_type='story_arc' AND s.stage_key=e.event_id AND s.status='active'
      WHERE e.owner_id=? AND e.book_id=? AND e.volume_plan_id=? AND e.status<>'archived'
      ORDER BY e.sequence_order,e.event_id`)
      .all(scope.ownerId,scope.bookId,volumePlanId) as unknown as VolumeEventSettlementRow[];
  }

  public stageSettlement(scope:BookScope,stageType:'story_arc'|'volume',stageKey:string):StageSettlementRow|undefined{
    assertBookScope(scope);
    return this.database.prepare(`SELECT stage_settlement_id,version,chapter_start,chapter_end,canon_revision,
      irreversible_results_json,entity_states_json,closed_threads_json,open_threads_json,relationship_changes_json,
      knowledge_changes_json,resource_changes_json,rule_changes_json
      FROM stage_settlements WHERE owner_id=? AND book_id=? AND stage_type=? AND stage_key=? AND status='active'`)
      .get(scope.ownerId,scope.bookId,stageType,stageKey) as StageSettlementRow|undefined;
  }

  public settlementActual(row:StageSettlementRow):Record<string,unknown>{
    return{irreversibleResults:JSON.parse(row.irreversible_results_json) as unknown,
      entityStates:JSON.parse(row.entity_states_json) as unknown,closedThreads:JSON.parse(row.closed_threads_json) as unknown,
      openThreads:JSON.parse(row.open_threads_json) as unknown,relationshipChanges:JSON.parse(row.relationship_changes_json) as unknown,
      knowledgeChanges:JSON.parse(row.knowledge_changes_json) as unknown,resourceChanges:JSON.parse(row.resource_changes_json) as unknown,
      ruleChanges:JSON.parse(row.rule_changes_json) as unknown};
  }

  public assessment(scope:BookScope,stageKind:'event'|'volume',stageObjectId:string):PlanningSettlementView|null{
    assertBookScope(scope);
    const row=this.database.prepare(`SELECT a.stage_settlement_id,a.stage_kind,a.stage_object_id,a.plan_version_id,
      a.planned_json,a.actual_json,a.deviation_json,a.source_canon_revision,a.created_at,
      s.version,s.chapter_start,s.chapter_end
      FROM planning_settlement_assessments a JOIN stage_settlements s ON s.stage_settlement_id=a.stage_settlement_id
        AND s.owner_id=a.owner_id AND s.book_id=a.book_id AND s.status='active'
      WHERE a.owner_id=? AND a.book_id=? AND a.stage_kind=? AND a.stage_object_id=?
      ORDER BY a.created_at DESC LIMIT 1`).get(scope.ownerId,scope.bookId,stageKind,stageObjectId) as Record<string,unknown>|undefined;
    if(row===undefined)return null;
    return{settlementId:String(row.stage_settlement_id),stageKind:row.stage_kind as 'event'|'volume',
      stageObjectId:String(row.stage_object_id),planVersionId:String(row.plan_version_id),version:Number(row.version),
      chapterStart:Number(row.chapter_start),chapterEnd:Number(row.chapter_end),canonRevision:Number(row.source_canon_revision),
      planned:JSON.parse(String(row.planned_json)) as unknown,actual:JSON.parse(String(row.actual_json)) as unknown,
      deviation:JSON.parse(String(row.deviation_json)) as unknown,createdAt:String(row.created_at)};
  }

  public insertAssessment(scope:BookScope,input:{id:string;stageKind:'event'|'volume';stageObjectId:string;settlementId:string;
    planVersionId:string;planned:unknown;actual:unknown;deviation:unknown;canonRevision:number;now:string}):void{
    assertBookScope(scope);
    this.database.prepare(`INSERT OR IGNORE INTO planning_settlement_assessments(
      planning_settlement_assessment_id,owner_id,book_id,stage_kind,stage_object_id,stage_settlement_id,plan_version_id,
      planned_json,actual_json,deviation_json,source_canon_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(input.id,scope.ownerId,scope.bookId,input.stageKind,input.stageObjectId,input.settlementId,input.planVersionId,
        JSON.stringify(input.planned),JSON.stringify(input.actual),JSON.stringify(input.deviation),input.canonRevision,input.now);
  }

  public completeEvent(scope:BookScope,input:{eventId:string;settlementId:string;expectedPlanningVersion:number;now:string}):boolean{
    assertBookScope(scope);
    this.database.prepare(`UPDATE story_events SET status='settled',revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND event_id=? AND status IN ('active','settled')`)
      .run(input.now,scope.ownerId,scope.bookId,input.eventId);
    this.database.prepare(`UPDATE event_chapter_sequences SET status='completed',updated_at=?
      WHERE owner_id=? AND book_id=? AND event_id=? AND status IN ('active','completed')`)
      .run(input.now,scope.ownerId,scope.bookId,input.eventId);
    this.database.prepare(`UPDATE story_events SET previous_settlement_id=COALESCE(previous_settlement_id,?),updated_at=?
      WHERE owner_id=? AND book_id=? AND previous_event_id=? AND status='planning'`)
      .run(input.settlementId,input.now,scope.ownerId,scope.bookId,input.eventId);
    const event=this.database.prepare(`SELECT volume_plan_id FROM story_events WHERE owner_id=? AND book_id=? AND event_id=?`)
      .get(scope.ownerId,scope.bookId,input.eventId) as{volume_plan_id:string};
    const remaining=this.database.prepare(`SELECT COUNT(*) AS count FROM story_events
      WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND status IN ('planning','active')`)
      .get(scope.ownerId,scope.bookId,event.volume_plan_id) as{count:number};
    const stage=remaining.count===0?'volume_settlement_in_progress':'event_sequence_in_progress';
    return this.database.prepare(`UPDATE creation_workflow_states SET planning_version=planning_version+1,stage=?,
      active_event_id=NULL,active_event_version_id=NULL,frozen_chapter_outline_refs_json='[]',
      waiting_task_id=NULL,blocking_reason=NULL,updated_at=? WHERE owner_id=? AND book_id=? AND planning_version=?
      AND active_event_id=? AND stage='event_settlement_in_progress'`)
      .run(stage,input.now,scope.ownerId,scope.bookId,input.expectedPlanningVersion,input.eventId).changes===1;
  }

  public completeVolume(scope:BookScope,input:{volumePlanId:string;expectedPlanningVersion:number;now:string}):boolean{
    assertBookScope(scope);
    this.database.prepare(`UPDATE volume_plans SET status='completed',revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND status IN ('active','completed')`)
      .run(input.now,scope.ownerId,scope.bookId,input.volumePlanId);
    return this.database.prepare(`UPDATE creation_workflow_states SET planning_version=planning_version+1,
      stage='ready_for_next_volume',active_event_id=NULL,active_event_version_id=NULL,
      frozen_chapter_outline_refs_json='[]',waiting_task_id=NULL,blocking_reason=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND planning_version=? AND active_volume_plan_id=?
        AND stage='volume_settlement_in_progress'`)
      .run(input.now,scope.ownerId,scope.bookId,input.expectedPlanningVersion,input.volumePlanId).changes===1;
  }
}
function nullable(value:unknown):string|null{return typeof value==='string'?value:null;}
