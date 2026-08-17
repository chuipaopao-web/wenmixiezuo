import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope,type BookScope } from '../../../domain/scope.js';

export interface EventChapterSequenceRow {
  event_chapter_sequence_id:string;event_id:string;event_version_id:string;volume_plan_version_id:string;
  revision:number;status:'planning'|'active'|'completed'|'stale'|'archived';active_version_id:string|null;
  generation_task_id:string|null;create_idempotency_key:string;request_hash:string;created_at:string;updated_at:string;
}
export interface EventChapterSequenceVersionRow {
  event_chapter_sequence_version_id:string;event_chapter_sequence_id:string;version:number;parent_version_id:string|null;
  status:'candidate'|'active'|'superseded'|'stale'|'archived';event_version_id:string;volume_plan_version_id:string;
  dependencies_json:string;author_input_refs_json:string;content_json:string;content_hash:string;source_task_id:string|null;
  idempotency_key:string;request_hash:string;created_at:string;confirmed_at:string|null;
}
export interface EventChapterOutlineRow {
  event_chapter_outline_id:string;event_chapter_sequence_id:string;event_id:string;chapter_number:number;sequence_order:number;
  revision:number;status:'planned'|'candidate'|'frozen'|'settled'|'stale'|'archived';active_version_id:string|null;
  planned_content_json:string;created_at:string;updated_at:string;
}
export interface EventChapterOutlineVersionRow {
  event_chapter_outline_version_id:string;event_chapter_outline_id:string;version:number;parent_version_id:string|null;
  status:'candidate'|'frozen'|'superseded'|'stale'|'archived';sequence_version_id:string;event_version_id:string;
  volume_plan_version_id:string;dependencies_json:string;author_input_refs_json:string;content_json:string;content_hash:string;
  artifact_version_id:string|null;source_task_id:string|null;idempotency_key:string;request_hash:string;created_at:string;frozen_at:string|null;
}
export interface ActiveEventChapterSnapshot {
  eventId:string;eventOrder:number;eventRevision:number;eventVersionId:string;eventVersion:number;eventHash:string;eventContent:string;
  volumePlanId:string;volumePlanVersionId:string;volumeVersion:number;volumeHash:string;volumeContent:string;
  openingContent:string|null;
}

export class EventChapterOutlineRepository {
  public constructor(public readonly db:DatabaseSync){}

  public workflow(scope:BookScope){
    assertBookScope(scope);return this.db.prepare(`SELECT planning_version,stage,active_volume_plan_id,active_volume_plan_version_id,
      active_event_id,active_event_version_id,frozen_chapter_outline_refs_json,waiting_task_id
      FROM creation_workflow_states WHERE owner_id=? AND book_id=?`).get(scope.ownerId,scope.bookId) as {
        planning_version:number;stage:string;active_volume_plan_id:string|null;active_volume_plan_version_id:string|null;
        active_event_id:string|null;active_event_version_id:string|null;frozen_chapter_outline_refs_json:string;waiting_task_id:string|null;
      }|undefined;
  }
  public activeSnapshot(scope:BookScope,eventId:string):ActiveEventChapterSnapshot|undefined{
    assertBookScope(scope);return this.db.prepare(`SELECT e.event_id AS eventId,e.sequence_order AS eventOrder,e.revision AS eventRevision,
      ev.story_event_version_id AS eventVersionId,ev.version AS eventVersion,ev.content_hash AS eventHash,ev.content_json AS eventContent,
      e.volume_plan_id AS volumePlanId,v.volume_plan_version_id AS volumePlanVersionId,v.version AS volumeVersion,v.content_hash AS volumeHash,v.content_json AS volumeContent,
      o.blueprint_json AS openingContent
      FROM story_events e JOIN story_event_versions ev ON ev.owner_id=e.owner_id AND ev.book_id=e.book_id
        AND ev.story_event_version_id=e.active_version_id AND ev.status='active'
      JOIN volume_plans p ON p.owner_id=e.owner_id AND p.book_id=e.book_id AND p.volume_plan_id=e.volume_plan_id AND p.status='active'
      JOIN volume_plan_versions v ON v.owner_id=p.owner_id AND v.book_id=p.book_id AND v.volume_plan_version_id=p.active_version_id AND v.status='active'
      LEFT JOIN book_opening_blueprints o ON o.owner_id=e.owner_id AND o.book_id=e.book_id AND o.status='active'
      WHERE e.owner_id=? AND e.book_id=? AND e.event_id=? AND e.status='active'`).get(scope.ownerId,scope.bookId,eventId) as ActiveEventChapterSnapshot|undefined;
  }
  public referencedSnapshot(scope:BookScope,eventId:string,eventVersionId:string,volumePlanVersionId:string):ActiveEventChapterSnapshot|undefined{
    assertBookScope(scope);return this.db.prepare(`SELECT e.event_id AS eventId,e.sequence_order AS eventOrder,e.revision AS eventRevision,
      ev.story_event_version_id AS eventVersionId,ev.version AS eventVersion,ev.content_hash AS eventHash,ev.content_json AS eventContent,
      e.volume_plan_id AS volumePlanId,v.volume_plan_version_id AS volumePlanVersionId,v.version AS volumeVersion,v.content_hash AS volumeHash,v.content_json AS volumeContent,
      o.blueprint_json AS openingContent
      FROM story_events e JOIN story_event_versions ev ON ev.owner_id=e.owner_id AND ev.book_id=e.book_id
        AND ev.event_id=e.event_id AND ev.story_event_version_id=?
      JOIN volume_plans p ON p.owner_id=e.owner_id AND p.book_id=e.book_id AND p.volume_plan_id=e.volume_plan_id
      JOIN volume_plan_versions v ON v.owner_id=p.owner_id AND v.book_id=p.book_id
        AND v.volume_plan_id=p.volume_plan_id AND v.volume_plan_version_id=?
      LEFT JOIN book_opening_blueprints o ON o.owner_id=e.owner_id AND o.book_id=e.book_id AND o.status='active'
      WHERE e.owner_id=? AND e.book_id=? AND e.event_id=?`).get(eventVersionId,volumePlanVersionId,scope.ownerId,scope.bookId,eventId) as ActiveEventChapterSnapshot|undefined;
  }
  public nextChapterNumber(scope:BookScope){
    assertBookScope(scope);return(this.db.prepare(`SELECT MAX(value) AS maximum FROM (
      SELECT chapter_number AS value FROM chapters WHERE owner_id=? AND book_id=?
      UNION ALL SELECT chapter_number AS value FROM event_chapter_outlines WHERE owner_id=? AND book_id=? AND status<>'archived'
    )`).get(scope.ownerId,scope.bookId,scope.ownerId,scope.bookId) as{maximum:number|null}).maximum??0;
  }
  public sequence(scope:BookScope,eventId:string){
    assertBookScope(scope);return this.db.prepare(`SELECT event_chapter_sequence_id,event_id,event_version_id,volume_plan_version_id,revision,status,
      active_version_id,generation_task_id,create_idempotency_key,request_hash,created_at,updated_at
      FROM event_chapter_sequences WHERE owner_id=? AND book_id=? AND event_id=?`).get(scope.ownerId,scope.bookId,eventId) as EventChapterSequenceRow|undefined;
  }
  public sequenceById(scope:BookScope,id:string){
    assertBookScope(scope);return this.db.prepare(`SELECT event_chapter_sequence_id,event_id,event_version_id,volume_plan_version_id,revision,status,
      active_version_id,generation_task_id,create_idempotency_key,request_hash,created_at,updated_at
      FROM event_chapter_sequences WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=?`).get(scope.ownerId,scope.bookId,id) as EventChapterSequenceRow|undefined;
  }
  public insertSequence(scope:BookScope,input:{id:string;eventId:string;eventVersionId:string;volumePlanVersionId:string;key:string;hash:string;now:string}){
    assertBookScope(scope);this.db.prepare(`INSERT INTO event_chapter_sequences(event_chapter_sequence_id,owner_id,book_id,event_id,event_version_id,
      volume_plan_version_id,revision,status,active_version_id,generation_task_id,create_idempotency_key,request_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,1,'planning',NULL,NULL,?,?,?,?)`).run(input.id,scope.ownerId,scope.bookId,input.eventId,input.eventVersionId,
      input.volumePlanVersionId,input.key,input.hash,input.now,input.now);
  }
  public rebaseEmptySequence(scope:BookScope,input:{sequenceId:string;expectedRevision:number;eventVersionId:string;
    volumePlanVersionId:string;key:string;hash:string;now:string}){
    assertBookScope(scope);
    const outlineCount=(this.db.prepare(`SELECT COUNT(*) AS count FROM event_chapter_outlines
      WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND status<>'archived'`)
      .get(scope.ownerId,scope.bookId,input.sequenceId) as{count:number}).count;
    const versionCount=(this.db.prepare(`SELECT COUNT(*) AS count FROM event_chapter_sequence_versions
      WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=?`)
      .get(scope.ownerId,scope.bookId,input.sequenceId) as{count:number}).count;
    if(outlineCount!==0||versionCount!==0)return false;
    return this.db.prepare(`UPDATE event_chapter_sequences SET event_version_id=?,volume_plan_version_id=?,revision=revision+1,
      status='planning',active_version_id=NULL,generation_task_id=NULL,create_idempotency_key=?,request_hash=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND revision=? AND active_version_id IS NULL`)
      .run(input.eventVersionId,input.volumePlanVersionId,input.key,input.hash,input.now,scope.ownerId,scope.bookId,
        input.sequenceId,input.expectedRevision).changes===1;
  }
  public listSequenceVersions(scope:BookScope,sequenceId:string){
    return this.db.prepare(`SELECT event_chapter_sequence_version_id,event_chapter_sequence_id,version,parent_version_id,status,event_version_id,
      volume_plan_version_id,dependencies_json,author_input_refs_json,content_json,content_hash,source_task_id,idempotency_key,request_hash,
      created_at,confirmed_at FROM event_chapter_sequence_versions WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? ORDER BY version DESC`)
      .all(scope.ownerId,scope.bookId,sequenceId) as unknown as EventChapterSequenceVersionRow[];
  }
  public sequenceVersion(scope:BookScope,sequenceId:string,versionId:string){
    return this.db.prepare(`SELECT event_chapter_sequence_version_id,event_chapter_sequence_id,version,parent_version_id,status,event_version_id,
      volume_plan_version_id,dependencies_json,author_input_refs_json,content_json,content_hash,source_task_id,idempotency_key,request_hash,
      created_at,confirmed_at FROM event_chapter_sequence_versions WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND event_chapter_sequence_version_id=?`)
      .get(scope.ownerId,scope.bookId,sequenceId,versionId) as EventChapterSequenceVersionRow|undefined;
  }
  public sequenceVersionByKey(scope:BookScope,key:string){
    return this.db.prepare(`SELECT event_chapter_sequence_version_id,event_chapter_sequence_id,version,parent_version_id,status,event_version_id,
      volume_plan_version_id,dependencies_json,author_input_refs_json,content_json,content_hash,source_task_id,idempotency_key,request_hash,
      created_at,confirmed_at FROM event_chapter_sequence_versions WHERE owner_id=? AND book_id=? AND idempotency_key=?`)
      .get(scope.ownerId,scope.bookId,key) as EventChapterSequenceVersionRow|undefined;
  }
  public insertSequenceVersion(scope:BookScope,input:{id:string;sequenceId:string;version:number;parent:string|null;eventVersionId:string;
    volumePlanVersionId:string;dependencies:string;authorRefs:string;content:string;hash:string;task:string|null;key:string;requestHash:string;now:string}){
    this.db.prepare(`INSERT INTO event_chapter_sequence_versions(event_chapter_sequence_version_id,owner_id,book_id,event_chapter_sequence_id,
      version,parent_version_id,status,event_version_id,volume_plan_version_id,dependencies_json,author_input_refs_json,content_json,content_hash,
      source_task_id,idempotency_key,request_hash,created_at,confirmed_at) VALUES(?,?,?,?,?,?,'candidate',?,?,?,?,?,?,?,?,?,?,NULL)`)
      .run(input.id,scope.ownerId,scope.bookId,input.sequenceId,input.version,input.parent,input.eventVersionId,input.volumePlanVersionId,
        input.dependencies,input.authorRefs,input.content,input.hash,input.task,input.key,input.requestHash,input.now);
  }
  public activateSequence(scope:BookScope,input:{sequenceId:string;versionId:string;expectedRevision:number;now:string}){
    const current=this.sequenceById(scope,input.sequenceId);if(current===undefined||current.revision!==input.expectedRevision)return false;
    if(current.active_version_id!==null&&current.active_version_id!==input.versionId)this.db.prepare(
      "UPDATE event_chapter_sequence_versions SET status='superseded' WHERE owner_id=? AND book_id=? AND event_chapter_sequence_version_id=? AND status='active'"
    ).run(scope.ownerId,scope.bookId,current.active_version_id);
    if(this.db.prepare("UPDATE event_chapter_sequence_versions SET status='active',confirmed_at=COALESCE(confirmed_at,?) WHERE owner_id=? AND book_id=? AND event_chapter_sequence_version_id=? AND status IN ('candidate','superseded','active')")
      .run(input.now,scope.ownerId,scope.bookId,input.versionId).changes!==1)return false;
    return this.db.prepare("UPDATE event_chapter_sequences SET active_version_id=?,status='active',revision=revision+1,updated_at=? WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND revision=?")
      .run(input.versionId,input.now,scope.ownerId,scope.bookId,input.sequenceId,input.expectedRevision).changes===1;
  }
  public replacePlannedOutlines(scope:BookScope,input:{sequenceId:string;eventId:string;items:Array<{id:string;chapterNumber:number;order:number;content:string}>;now:string}){
    const current=this.listOutlines(scope,input.sequenceId);
    const settledByOrder=new Map(current.filter(item=>item.status==='settled')
      .map(item=>[item.sequence_order,item]));
    for(const [order,protectedOutline] of settledByOrder){
      const next=input.items.find(item=>item.order===order);
      if(next===undefined||next.chapterNumber!==protectedOutline.chapter_number||
        next.content!==protectedOutline.planned_content_json)throw new Error('已结算章纲与修订后的事件章序列不一致。');
    }
    const protectedCount=(this.db.prepare(`SELECT COUNT(*) AS count FROM event_chapter_outlines
      WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND status='settled'`)
      .get(scope.ownerId,scope.bookId,input.sequenceId) as{count:number}).count;
    if(protectedCount!==settledByOrder.size)throw new Error('已结算章纲状态无法核对。');
    this.db.prepare(`UPDATE event_chapter_outline_versions SET status='archived'
      WHERE owner_id=? AND book_id=? AND event_chapter_outline_id IN (
        SELECT event_chapter_outline_id FROM event_chapter_outlines
        WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND status='candidate'
      ) AND status='candidate'`).run(scope.ownerId,scope.bookId,scope.ownerId,scope.bookId,input.sequenceId);
    this.db.prepare(`UPDATE event_chapter_outline_versions SET status='superseded'
      WHERE owner_id=? AND book_id=? AND event_chapter_outline_id IN (
        SELECT event_chapter_outline_id FROM event_chapter_outlines
        WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND status='frozen'
      ) AND status='frozen'`).run(scope.ownerId,scope.bookId,scope.ownerId,scope.bookId,input.sequenceId);
    const updateExisting=this.db.prepare(`UPDATE event_chapter_outlines SET event_id=?,chapter_number=?,revision=revision+1,status='planned',
      active_version_id=NULL,planned_content_json=?,updated_at=?
      WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND sequence_order=? AND status IN ('planned','candidate','frozen')`);
    const insertMissing=this.db.prepare(`INSERT INTO event_chapter_outlines(event_chapter_outline_id,owner_id,book_id,event_chapter_sequence_id,event_id,
      chapter_number,sequence_order,revision,status,active_version_id,planned_content_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,1,'planned',NULL,?,?,?)`);
    input.items.forEach(item=>{
      const updated=updateExisting.run(input.eventId,item.chapterNumber,item.content,input.now,scope.ownerId,scope.bookId,input.sequenceId,item.order);
      if(updated.changes===0&&!settledByOrder.has(item.order))insertMissing.run(item.id,scope.ownerId,scope.bookId,input.sequenceId,input.eventId,item.chapterNumber,item.order,item.content,input.now,input.now);
    });
    return;
    this.db.prepare("UPDATE event_chapter_outlines SET status='archived',revision=revision+1,updated_at=? WHERE owner_id=? AND book_id=? AND event_chapter_sequence_id=? AND status='planned'")
      .run(input.now,scope.ownerId,scope.bookId,input.sequenceId);
    const insert=this.db.prepare(`INSERT INTO event_chapter_outlines(event_chapter_outline_id,owner_id,book_id,event_chapter_sequence_id,event_id,
      chapter_number,sequence_order,revision,status,active_version_id,planned_content_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,1,'planned',NULL,?,?,?)`);
    input.items.forEach(item=>insert.run(item.id,scope.ownerId,scope.bookId,input.sequenceId,input.eventId,item.chapterNumber,item.order,item.content,input.now,input.now));
  }
  public listOutlines(scope:BookScope,sequenceId:string,includeArchived=false){
    return this.db.prepare(`SELECT event_chapter_outline_id,event_chapter_sequence_id,event_id,chapter_number,sequence_order,revision,status,
      active_version_id,planned_content_json,created_at,updated_at FROM event_chapter_outlines WHERE owner_id=? AND book_id=?
      AND event_chapter_sequence_id=? AND (?=1 OR status<>'archived') ORDER BY sequence_order`)
      .all(scope.ownerId,scope.bookId,sequenceId,includeArchived?1:0) as unknown as EventChapterOutlineRow[];
  }
  public outline(scope:BookScope,id:string){
    return this.db.prepare(`SELECT event_chapter_outline_id,event_chapter_sequence_id,event_id,chapter_number,sequence_order,revision,status,
      active_version_id,planned_content_json,created_at,updated_at FROM event_chapter_outlines WHERE owner_id=? AND book_id=? AND event_chapter_outline_id=?`)
      .get(scope.ownerId,scope.bookId,id) as EventChapterOutlineRow|undefined;
  }
  public listOutlineVersions(scope:BookScope,outlineId:string){
    return this.db.prepare(`SELECT event_chapter_outline_version_id,event_chapter_outline_id,version,parent_version_id,status,sequence_version_id,
      event_version_id,volume_plan_version_id,dependencies_json,author_input_refs_json,content_json,content_hash,artifact_version_id,source_task_id,
      idempotency_key,request_hash,created_at,frozen_at FROM event_chapter_outline_versions WHERE owner_id=? AND book_id=? AND event_chapter_outline_id=? ORDER BY version DESC`)
      .all(scope.ownerId,scope.bookId,outlineId) as unknown as EventChapterOutlineVersionRow[];
  }
  public outlineVersion(scope:BookScope,outlineId:string,versionId:string){
    return this.db.prepare(`SELECT event_chapter_outline_version_id,event_chapter_outline_id,version,parent_version_id,status,sequence_version_id,
      event_version_id,volume_plan_version_id,dependencies_json,author_input_refs_json,content_json,content_hash,artifact_version_id,source_task_id,
      idempotency_key,request_hash,created_at,frozen_at FROM event_chapter_outline_versions WHERE owner_id=? AND book_id=? AND event_chapter_outline_id=? AND event_chapter_outline_version_id=?`)
      .get(scope.ownerId,scope.bookId,outlineId,versionId) as EventChapterOutlineVersionRow|undefined;
  }
  public outlineVersionByKey(scope:BookScope,key:string){
    return this.db.prepare(`SELECT event_chapter_outline_version_id,event_chapter_outline_id,version,parent_version_id,status,sequence_version_id,
      event_version_id,volume_plan_version_id,dependencies_json,author_input_refs_json,content_json,content_hash,artifact_version_id,source_task_id,
      idempotency_key,request_hash,created_at,frozen_at FROM event_chapter_outline_versions WHERE owner_id=? AND book_id=? AND idempotency_key=?`)
      .get(scope.ownerId,scope.bookId,key) as EventChapterOutlineVersionRow|undefined;
  }
  public insertOutlineVersion(scope:BookScope,input:{id:string;outlineId:string;version:number;parent:string|null;sequenceVersionId:string;
    eventVersionId:string;volumePlanVersionId:string;dependencies:string;authorRefs:string;content:string;hash:string;task:string|null;
    key:string;requestHash:string;now:string}){
    this.db.prepare(`INSERT INTO event_chapter_outline_versions(event_chapter_outline_version_id,owner_id,book_id,event_chapter_outline_id,
      version,parent_version_id,status,sequence_version_id,event_version_id,volume_plan_version_id,dependencies_json,author_input_refs_json,
      content_json,content_hash,artifact_version_id,source_task_id,idempotency_key,request_hash,created_at,frozen_at)
      VALUES(?,?,?,?,?,?,'candidate',?,?,?,?,?,?,?,NULL,?,?,?,?,NULL)`).run(input.id,scope.ownerId,scope.bookId,input.outlineId,input.version,
        input.parent,input.sequenceVersionId,input.eventVersionId,input.volumePlanVersionId,input.dependencies,input.authorRefs,input.content,input.hash,
        input.task,input.key,input.requestHash,input.now);
    this.db.prepare("UPDATE event_chapter_outlines SET status='candidate',revision=revision+1,updated_at=? WHERE owner_id=? AND book_id=? AND event_chapter_outline_id=? AND status='planned'")
      .run(input.now,scope.ownerId,scope.bookId,input.outlineId);
  }
  public freezeOutline(scope:BookScope,input:{outlineId:string;versionId:string;artifactVersionId:string;expectedRevision:number;now:string}){
    const outline=this.outline(scope,input.outlineId);if(outline===undefined||outline.revision!==input.expectedRevision)return false;
    if(outline.active_version_id!==null&&outline.active_version_id!==input.versionId)this.db.prepare(
      "UPDATE event_chapter_outline_versions SET status='superseded' WHERE owner_id=? AND book_id=? AND event_chapter_outline_version_id=? AND status='frozen'"
    ).run(scope.ownerId,scope.bookId,outline.active_version_id);
    if(this.db.prepare("UPDATE event_chapter_outline_versions SET status='frozen',artifact_version_id=?,frozen_at=COALESCE(frozen_at,?) WHERE owner_id=? AND book_id=? AND event_chapter_outline_version_id=? AND status IN ('candidate','superseded','frozen')")
      .run(input.artifactVersionId,input.now,scope.ownerId,scope.bookId,input.versionId).changes!==1)return false;
    return this.db.prepare("UPDATE event_chapter_outlines SET active_version_id=?,status='frozen',revision=revision+1,updated_at=? WHERE owner_id=? AND book_id=? AND event_chapter_outline_id=? AND revision=?")
      .run(input.versionId,input.now,scope.ownerId,scope.bookId,input.outlineId,input.expectedRevision).changes===1;
  }
  public advanceForSequence(scope:BookScope,input:{eventId:string;eventVersionId:string;expectedPlanningVersion:number;now:string}){
    return this.db.prepare(`UPDATE creation_workflow_states SET planning_version=planning_version+1,
      stage='chapter_outlines_in_progress',
      frozen_chapter_outline_refs_json='[]',
      waiting_task_id=NULL,blocking_reason=NULL,updated_at=? WHERE owner_id=? AND book_id=? AND planning_version=?
      AND active_event_id=? AND active_event_version_id=? AND stage IN ('event_confirmed','chapter_outlines_in_progress','next_chapters_ready')`)
      .run(input.now,scope.ownerId,scope.bookId,input.expectedPlanningVersion,input.eventId,input.eventVersionId).changes===1;
  }
  public freezeWorkflow(scope:BookScope,input:{expectedPlanningVersion:number;refs:string;now:string}){
    return this.db.prepare(`UPDATE creation_workflow_states SET planning_version=planning_version+1,stage='next_chapters_ready',
      frozen_chapter_outline_refs_json=?,waiting_task_id=NULL,blocking_reason=NULL,updated_at=? WHERE owner_id=? AND book_id=? AND planning_version=?
      AND stage IN ('chapter_outlines_in_progress','next_chapters_ready')`).run(input.refs,input.now,scope.ownerId,scope.bookId,input.expectedPlanningVersion).changes===1;
  }
  public artifactByTitle(scope:BookScope,title:string){
    return this.db.prepare("SELECT artifact_id,active_version_id FROM artifacts WHERE owner_id=? AND book_id=? AND artifact_type='chapter_outline' AND title=?")
      .get(scope.ownerId,scope.bookId,title) as{artifact_id:string;active_version_id:string|null}|undefined;
  }
  public taskExists(scope:BookScope,id:string){return this.db.prepare("SELECT 1 FROM tasks WHERE owner_id=? AND book_id=? AND task_id=?").get(scope.ownerId,scope.bookId,id)!==undefined;}
  public authorInputCount(scope:BookScope,outlineId:string,ids:string[]){if(ids.length===0)return 0;const q=ids.map(()=>'?').join(',');
    return(this.db.prepare(`SELECT COUNT(*) AS count FROM author_planning_inputs WHERE owner_id=? AND book_id=? AND surface='chapter_outline'
      AND subject_type='event_chapter_outline' AND subject_id=? AND status NOT IN ('withdrawn','superseded') AND author_input_id IN (${q})`)
      .get(scope.ownerId,scope.bookId,outlineId,...ids) as{count:number}).count;}
  public insertDependencies(scope:BookScope,input:{kind:string;downstreamId:string;downstreamVersion:number;dependencies:Array<{kind:string;id:string;version:number;contentHash:string;required:boolean}>;ids:string[];now:string}){
    const s=this.db.prepare(`INSERT INTO planning_dependencies(planning_dependency_id,owner_id,book_id,upstream_kind,upstream_id,upstream_version,
      upstream_hash,downstream_kind,downstream_id,downstream_version,required,status,reason,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',NULL,?,?)`);
    input.dependencies.forEach((d,i)=>s.run(input.ids[i]!,scope.ownerId,scope.bookId,d.kind,d.id,d.version,d.contentHash,input.kind,input.downstreamId,input.downstreamVersion,d.required?1:0,input.now,input.now));
  }
}
