import type { DatabaseSync } from 'node:sqlite';
import type { EventChainContent } from '@wenmi/contracts';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface WorkflowProgressRow {
  planningVersion: number;
  stage: string;
  activeEventId: string | null;
  frozenChapterOutlineRefsJson: string;
}

export interface FrozenChapterOutlineRow {
  outlineId: string;
  artifactId: string;
}

export interface FirstVolumeLaunchProgressRow {
  volumePlanId:string;volumeDirectionVersionId:string;totalEffectiveCharacters:number;
  latestSettledChapterNumber:number;climaxStatus:'planned'|'approaching'|'at_risk'|'completed'|'completed_late'|'overdue';
  climaxEventId:string|null;climaxCompletedAtEffectiveCharacters:number|null;
  predictionJson:string;actualEvidenceJson:string|null;updatedAt:string;
}
function launchCompletionStatus(actualJson:string|null):'completed'|'completed_late'{
  if(actualJson===null)return'completed';
  try{return (JSON.parse(actualJson) as {late?:unknown}).late===true?'completed_late':'completed';}catch{return'completed';}
}
export class CreationWorkflowProgressRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public runInTransaction<T>(work: () => T): T {
    if (this.database.isTransaction) return work();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public markManuscriptStarted(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE creation_workflow_states SET stage='manuscript_in_progress',
      waiting_task_id=?,blocking_reason=NULL,updated_at=datetime('now')
      WHERE owner_id=? AND book_id=? AND stage='next_chapters_ready'`)
      .run(taskId, scope.ownerId, scope.bookId);
  }

  public markWaitingForAuthor(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE creation_workflow_states SET stage='waiting_for_author',
      waiting_task_id=?,blocking_reason=NULL,updated_at=datetime('now')
      WHERE owner_id=? AND book_id=? AND stage IN ('manuscript_in_progress','waiting_for_author')`)
      .run(taskId, scope.ownerId, scope.bookId);
  }

  public markAuthorRejected(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE creation_workflow_states SET stage='manuscript_in_progress',
      waiting_task_id=?,blocking_reason='作者要求修改当前章',updated_at=datetime('now')
      WHERE owner_id=? AND book_id=? AND stage IN ('waiting_for_author','chapter_settlement_in_progress')`)
      .run(taskId, scope.ownerId, scope.bookId);
  }

  public markChapterSettlementStarted(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE creation_workflow_states SET stage='chapter_settlement_in_progress',
      waiting_task_id=?,blocking_reason=NULL,updated_at=datetime('now')
      WHERE owner_id=? AND book_id=? AND stage='waiting_for_author'`)
      .run(taskId, scope.ownerId, scope.bookId);
  }

  public workflow(scope: BookScope): WorkflowProgressRow | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT planning_version,stage,active_event_id,frozen_chapter_outline_refs_json
      FROM creation_workflow_states WHERE owner_id=? AND book_id=?`)
      .get(scope.ownerId, scope.bookId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      planningVersion: Number(row.planning_version),
      stage: String(row.stage),
      activeEventId: typeof row.active_event_id === 'string' ? row.active_event_id : null,
      frozenChapterOutlineRefsJson: String(row.frozen_chapter_outline_refs_json)
    };
  }

  public frozenOutlineForChapter(
    scope: BookScope,
    eventId: string,
    chapterNumber: number
  ): FrozenChapterOutlineRow | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT o.event_chapter_outline_id AS outline_id,a.artifact_id
      FROM event_chapter_outlines o
      JOIN event_chapter_outline_versions ov ON ov.event_chapter_outline_version_id=o.active_version_id
        AND ov.owner_id=o.owner_id AND ov.book_id=o.book_id
      JOIN artifact_versions av ON av.artifact_version_id=ov.artifact_version_id
        AND av.owner_id=ov.owner_id AND av.book_id=ov.book_id
      JOIN artifacts a ON a.artifact_id=av.artifact_id AND a.owner_id=av.owner_id AND a.book_id=av.book_id
      JOIN event_chapter_sequences seq ON seq.event_chapter_sequence_id=o.event_chapter_sequence_id
        AND seq.owner_id=o.owner_id AND seq.book_id=o.book_id AND seq.active_version_id=ov.sequence_version_id
      JOIN event_chapter_sequence_versions sv ON sv.event_chapter_sequence_version_id=ov.sequence_version_id
        AND sv.owner_id=ov.owner_id AND sv.book_id=ov.book_id
      JOIN story_event_versions ev ON ev.story_event_version_id=ov.event_version_id
        AND ev.owner_id=ov.owner_id AND ev.book_id=ov.book_id
      JOIN volume_plan_versions vv ON vv.volume_plan_version_id=ov.volume_plan_version_id
        AND vv.owner_id=ov.owner_id AND vv.book_id=ov.book_id
      JOIN creation_workflow_states w ON w.owner_id=ov.owner_id AND w.book_id=ov.book_id
        AND w.active_event_id=o.event_id AND w.active_event_version_id=ov.event_version_id
        AND w.active_volume_plan_version_id=ov.volume_plan_version_id
      WHERE o.owner_id=? AND o.book_id=? AND o.event_id=? AND o.chapter_number=?
        AND o.status='frozen' AND ov.status='frozen' AND a.artifact_type='chapter_outline'
        AND seq.status IN ('active','completed') AND sv.status='active' AND ev.status='active' AND vv.status='active'
      LIMIT 1`).get(scope.ownerId, scope.bookId, eventId, chapterNumber) as
        { outline_id: string; artifact_id: string } | undefined;
    return row === undefined ? undefined : { outlineId: row.outline_id, artifactId: row.artifact_id };
  }

  public settleOutline(scope: BookScope, outlineId: string, now: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`UPDATE event_chapter_outlines SET status='settled',revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND event_chapter_outline_id=? AND status='frozen'`)
      .run(now, scope.ownerId, scope.bookId, outlineId).changes === 1;
  }

  public remainingOutlineCount(scope: BookScope, eventId: string): number {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM event_chapter_outlines
      WHERE owner_id=? AND book_id=? AND event_id=? AND status IN ('planned','candidate','frozen')`)
      .get(scope.ownerId, scope.bookId, eventId) as { count: number };
    return row.count;
  }

  public refreshFirstVolumeLaunchProgress(scope:BookScope,now:string):FirstVolumeLaunchProgressRow|null{
    assertBookScope(scope);
    const source=this.database.prepare(`SELECT p.volume_plan_id AS volumePlanId,d.volume_direction_version_id AS directionVersionId,
      ec.content_json AS chainContent
      FROM volume_plans p JOIN volume_direction_versions d ON d.owner_id=p.owner_id AND d.book_id=p.book_id
        AND d.volume_plan_id=p.volume_plan_id AND d.status='active'
      LEFT JOIN event_chain_versions ec ON ec.owner_id=p.owner_id AND ec.book_id=p.book_id
        AND ec.volume_plan_id=p.volume_plan_id AND ec.volume_direction_version_id=d.volume_direction_version_id AND ec.status='active'
      WHERE p.owner_id=? AND p.book_id=? AND p.plan_number=1 AND p.status IN ('active','completed')`)
      .get(scope.ownerId,scope.bookId) as {volumePlanId:string;directionVersionId:string;chainContent:string|null}|undefined;
    if(source===undefined)return null;
    const stats=this.database.prepare(`SELECT COALESCE(SUM(m.word_count),0) AS total,COALESCE(MAX(c.chapter_number),0) AS latest,
      COUNT(*) AS chapterCount FROM chapters c JOIN volumes v ON v.volume_id=c.volume_id
      JOIN manuscript_versions m ON m.manuscript_version_id=c.canon_manuscript_version_id
        AND m.owner_id=c.owner_id AND m.book_id=c.book_id
      WHERE c.owner_id=? AND c.book_id=? AND v.volume_number=1 AND c.settlement_status='settled'`)
      .get(scope.ownerId,scope.bookId) as {total:number;latest:number;chapterCount:number};
    let climaxOrder:number|null=null,climaxNodeId:string|null=null;
    let setupResponsibilities:Array<{nodeId:string;order:number;responsibilities:string[]}>=[];
    if(source.chainContent!==null)try{
      const chain=JSON.parse(source.chainContent) as EventChainContent;
      const climax=chain.events.find(item=>item.firstVolumeResponsibilities.includes('major_climax_before_100k'));
      climaxOrder=climax?.order??null;climaxNodeId=climax?.nodeId??null;
      setupResponsibilities=chain.events.filter(item=>item.firstVolumeResponsibilities.length>0)
        .map(item=>({nodeId:item.nodeId,order:item.order,responsibilities:item.firstVolumeResponsibilities}));
    }catch{climaxOrder=null;climaxNodeId=null;setupResponsibilities=[];}
    const event=climaxOrder===null?undefined:this.database.prepare(`SELECT event_id,status FROM story_events
      WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND sequence_order=? AND status<>'archived'`)
      .get(scope.ownerId,scope.bookId,source.volumePlanId,climaxOrder) as {event_id:string;status:string}|undefined;
    const existing=this.database.prepare(`SELECT launch_plan_direction_version_id,climax_status,actual_fulfillment_json,
      climax_completed_at_effective_characters FROM first_volume_launch_progress
      WHERE owner_id=? AND book_id=? AND volume_plan_id=?`).get(scope.ownerId,scope.bookId,source.volumePlanId) as
      {launch_plan_direction_version_id:string;climax_status:string;actual_fulfillment_json:string|null;
        climax_completed_at_effective_characters:number|null}|undefined;
    const completed=existing?.launch_plan_direction_version_id===source.directionVersionId&&existing.climax_status==='completed';
    const average=stats.chapterCount===0?3000:Math.round(stats.total/stats.chapterCount);
    const settledEvents=(this.database.prepare(`SELECT COUNT(*) AS count FROM story_events WHERE owner_id=? AND book_id=?
      AND volume_plan_id=? AND status='settled'`).get(scope.ownerId,scope.bookId,source.volumePlanId) as {count:number}).count;
    const remainingEvents=climaxOrder===null?null:Math.max(0,climaxOrder-settledEvents);
    const projectedClimaxAt=remainingEvents===null?null:stats.total+remainingEvents*Math.max(12000,average*4);
    const publicStatus:FirstVolumeLaunchProgressRow['climaxStatus']=completed
      ? launchCompletionStatus(existing.actual_fulfillment_json)
      : stats.total>100000?'overdue':stats.total>=85000||(projectedClimaxAt!==null&&projectedClimaxAt>100000)
        ?'at_risk':stats.total>=70000?'approaching':'planned';
    const storedStatus=publicStatus==='completed'||publicStatus==='completed_late'?'completed':publicStatus==='overdue'?'missed':
      publicStatus==='at_risk'?'in_progress':publicStatus==='approaching'?'setup_started':'planned';
    const action=publicStatus==='overdue'?'高潮承载事件尚未实际结算；立即停止继续扩写铺垫，重新调整当前事件或章链。':
      publicStatus==='at_risk'?'按当前进度可能超过10万有效字；优先压缩重复铺垫，并把高潮责任前移到当前或下一个事件章链。':
        publicStatus==='approaching'?'已进入首卷高潮准备区；核对铺垫是否足够，并确认高潮承载事件已经开始。':null;
    const prediction={averageSettledChapterEffectiveCharacters:average,settledEventCount:settledEvents,
      climaxEventOrder:climaxOrder,climaxEventStarted:event!==undefined&&['active','settled'].includes(event.status),
      projectedClimaxAtEffectiveCharacters:projectedClimaxAt,noLaterThanEffectiveCharacters:100000,
      recommendedAction:action};
    this.database.prepare(`INSERT INTO first_volume_launch_progress(owner_id,book_id,volume_plan_id,
      launch_plan_direction_version_id,effective_character_count,climax_event_node_id,climax_status,
      setup_responsibilities_json,actual_fulfillment_json,forecast_effective_character_count,exceeds_limit_risk,
      latest_settled_chapter_number,climax_completed_at_effective_characters,prediction_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,book_id,volume_plan_id) DO UPDATE SET
      launch_plan_direction_version_id=excluded.launch_plan_direction_version_id,
      effective_character_count=excluded.effective_character_count,climax_event_node_id=excluded.climax_event_node_id,
      climax_status=excluded.climax_status,setup_responsibilities_json=excluded.setup_responsibilities_json,
      actual_fulfillment_json=excluded.actual_fulfillment_json,
      forecast_effective_character_count=excluded.forecast_effective_character_count,
      exceeds_limit_risk=excluded.exceeds_limit_risk,latest_settled_chapter_number=excluded.latest_settled_chapter_number,
      climax_completed_at_effective_characters=excluded.climax_completed_at_effective_characters,
      prediction_json=excluded.prediction_json,updated_at=excluded.updated_at`)
      .run(scope.ownerId,scope.bookId,source.volumePlanId,source.directionVersionId,stats.total,climaxNodeId,storedStatus,
        JSON.stringify(setupResponsibilities),completed?existing?.actual_fulfillment_json??null:null,projectedClimaxAt,
        ['at_risk','overdue','completed_late'].includes(publicStatus)?1:0,stats.latest,
        completed?existing?.climax_completed_at_effective_characters??stats.total:null,JSON.stringify(prediction),now);
    return this.firstVolumeLaunchProgress(scope);
  }

  public firstVolumeLaunchProgress(scope:BookScope):FirstVolumeLaunchProgressRow|null{
    assertBookScope(scope);
    const row=this.database.prepare(`SELECT volume_plan_id,launch_plan_direction_version_id,effective_character_count,
      latest_settled_chapter_number,climax_status,climax_completed_at_effective_characters,
      prediction_json,actual_fulfillment_json,updated_at FROM first_volume_launch_progress
      WHERE owner_id=? AND book_id=? ORDER BY updated_at DESC LIMIT 1`).get(scope.ownerId,scope.bookId) as Record<string,unknown>|undefined;
    if(row===undefined)return null;
    const actualJson=typeof row.actual_fulfillment_json==='string'?row.actual_fulfillment_json:null;
    let eventId:string|null=null;
    if(actualJson!==null)try{const actual=JSON.parse(actualJson) as Record<string,unknown>;
      eventId=typeof actual.eventId==='string'?actual.eventId:null;}catch{eventId=null;}
    const stored=String(row.climax_status);
    const climaxStatus:FirstVolumeLaunchProgressRow['climaxStatus']=stored==='completed'?launchCompletionStatus(actualJson):
      stored==='missed'?'overdue':stored==='in_progress'?'at_risk':stored==='setup_started'?'approaching':'planned';
    return{volumePlanId:String(row.volume_plan_id),volumeDirectionVersionId:String(row.launch_plan_direction_version_id),
      totalEffectiveCharacters:Number(row.effective_character_count),latestSettledChapterNumber:Number(row.latest_settled_chapter_number),
      climaxStatus,climaxEventId:eventId,
      climaxCompletedAtEffectiveCharacters:row.climax_completed_at_effective_characters===null?null:Number(row.climax_completed_at_effective_characters),
      predictionJson:String(row.prediction_json),actualEvidenceJson:actualJson,updatedAt:String(row.updated_at)};
  }
  public advanceAfterChapterSettlement(scope: BookScope, input: {
    expectedPlanningVersion: number;
    eventId: string;
    stage: string;
    refsJson: string;
    now: string;
  }): boolean {
    assertBookScope(scope);
    return this.database.prepare(`UPDATE creation_workflow_states SET planning_version=planning_version+1,stage=?,
      frozen_chapter_outline_refs_json=?,waiting_task_id=NULL,blocking_reason=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND planning_version=? AND active_event_id=?
        AND stage IN ('next_chapters_ready','manuscript_in_progress','waiting_for_author','chapter_settlement_in_progress')`)
      .run(input.stage, input.refsJson, input.now, scope.ownerId, scope.bookId,
        input.expectedPlanningVersion, input.eventId).changes === 1;
  }
}