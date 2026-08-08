import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope,type BookScope } from '../../../domain/scope.js';
import type { StoredModelResult,VolumePlanGenerationSeat } from './volume-plan-generation-repository.js';

export interface StoryEventGenerationSnapshot {
  eventId:string;eventRevision:number;eventStatus:string;activeVersionId:string|null;order:number;
  volumePlanId:string;volumePlanVersionId:string;volumeVersion:number;volumeHash:string;volumeContent:string;
  bookTitle:string;canonRevision:number;positioningVersion:number;
  opening:{id:string;version:number;hash:string;content:string};
  setting:{id:string;version:number;hash:string;content:string};
  seed:{id:string;version:number;hash:string;content:string};
  previousSettlement:null|{id:string;version:number;content:string};
}
export interface StoryEventGenerationTaskRow {
  task_id:string;status:string;current_phase:string;error_code:string|null;idempotency_key:string;
  task_brief_json:string;checkpoint_json:string;created_at:string;updated_at:string;
}
export class StoryEventGenerationRepository {
  public constructor(private readonly db:DatabaseSync){}

  public snapshot(scope:BookScope,eventId:string):StoryEventGenerationSnapshot|undefined{
    assertBookScope(scope);
    const row=this.db.prepare(
      "SELECT e.event_id,e.revision AS event_revision,e.status AS event_status,e.active_version_id,e.sequence_order,"+
      "e.volume_plan_id,s.volume_plan_version_id,v.version AS volume_version,v.content_hash AS volume_hash,"+
      "v.content_json AS volume_content,b.title AS book_title,b.canon_revision,b.positioning_version,"+
      "o.opening_blueprint_id,o.version AS opening_version,o.content_hash AS opening_hash,o.blueprint_json AS opening_content,"+
      "sv.artifact_version_id AS setting_id,sv.version AS setting_version,sv.content_hash AS setting_hash,sv.content_json AS setting_content "+
      "FROM story_events e JOIN event_sequences s ON s.owner_id=e.owner_id AND s.book_id=e.book_id AND s.volume_plan_id=e.volume_plan_id "+
      "JOIN volume_plans p ON p.owner_id=e.owner_id AND p.book_id=e.book_id AND p.volume_plan_id=e.volume_plan_id "+
      "AND p.active_version_id=s.volume_plan_version_id AND p.status='active' "+
      "JOIN volume_plan_versions v ON v.owner_id=e.owner_id AND v.book_id=e.book_id AND v.volume_plan_id=e.volume_plan_id "+
      "AND v.volume_plan_version_id=s.volume_plan_version_id AND v.status='active' "+
      "JOIN books b ON b.owner_id=e.owner_id AND b.book_id=e.book_id "+
      "JOIN book_opening_blueprints o ON o.owner_id=e.owner_id AND o.book_id=e.book_id AND o.status='active' "+
      "JOIN book_planning_states ps ON ps.owner_id=e.owner_id AND ps.book_id=e.book_id "+
      "JOIN artifact_versions sv ON sv.owner_id=ps.owner_id AND sv.book_id=ps.book_id "+
      "AND sv.artifact_version_id=ps.setting_baseline_version_id AND sv.status='selected' "+
      "WHERE e.owner_id=? AND e.book_id=? AND e.event_id=? AND e.status IN ('planning','active') LIMIT 1"
    ).get(scope.ownerId,scope.bookId,eventId) as {
      event_id:string;event_revision:number;event_status:string;active_version_id:string|null;sequence_order:number;
      volume_plan_id:string;volume_plan_version_id:string;volume_version:number;volume_hash:string;volume_content:string;
      book_title:string;canon_revision:number;positioning_version:number;opening_blueprint_id:string;opening_version:number;
      opening_hash:string;opening_content:string;setting_id:string;setting_version:number;setting_hash:string;setting_content:string;
    }|undefined;
    if(row===undefined)return undefined;
    const seed=this.db.prepare(
      "SELECT story_event_version_id AS id,version,content_hash AS hash,content_json AS content "+
      "FROM story_event_versions WHERE owner_id=? AND book_id=? AND event_id=? "+
      "ORDER BY CASE candidate_kind WHEN 'volume_seed' THEN 0 ELSE 1 END,version LIMIT 1"
    ).get(scope.ownerId,scope.bookId,eventId) as {id:string;version:number;hash:string;content:string}|undefined;
    if(seed===undefined)return undefined;
    const previous=this.db.prepare("SELECT previous_event_id FROM story_events WHERE owner_id=? AND book_id=? AND event_id=?")
      .get(scope.ownerId,scope.bookId,eventId) as {previous_event_id:string|null};
    const settlement=previous.previous_event_id===null?undefined:this.db.prepare(
      "SELECT stage_settlement_id AS id,version,json_object("+
      "'irreversibleResults',json(irreversible_results_json),'entityStates',json(entity_states_json),"+
      "'closedThreads',json(closed_threads_json),'openThreads',json(open_threads_json),"+
      "'relationshipChanges',json(relationship_changes_json),'knowledgeChanges',json(knowledge_changes_json),"+
      "'resourceChanges',json(resource_changes_json),'ruleChanges',json(rule_changes_json),'exclusions',json(exclusions_json)) AS content "+
      "FROM stage_settlements WHERE owner_id=? AND book_id=? AND stage_type='event' AND stage_key=? AND status='active'"
    ).get(scope.ownerId,scope.bookId,previous.previous_event_id) as {id:string;version:number;content:string}|undefined;
    if(previous.previous_event_id!==null&&settlement===undefined)return undefined;
    return{eventId:row.event_id,eventRevision:row.event_revision,eventStatus:row.event_status,
      activeVersionId:row.active_version_id,order:row.sequence_order,volumePlanId:row.volume_plan_id,
      volumePlanVersionId:row.volume_plan_version_id,volumeVersion:row.volume_version,volumeHash:row.volume_hash,
      volumeContent:row.volume_content,bookTitle:row.book_title,canonRevision:row.canon_revision,
      positioningVersion:row.positioning_version,
      opening:{id:row.opening_blueprint_id,version:row.opening_version,hash:row.opening_hash,content:row.opening_content},
      setting:{id:row.setting_id,version:row.setting_version,hash:row.setting_hash,content:row.setting_content},
      seed,previousSettlement:settlement??null};
  }

  public authorInputs(scope:BookScope,eventId:string,ids:string[]){
    assertBookScope(scope);if(ids.length===0)return[];
    const marks=ids.map(()=>'?').join(',');
    const rows=this.db.prepare(
      "SELECT author_input_id,intent_strength,original_text,scope_notes FROM author_planning_inputs "+
      "WHERE owner_id=? AND book_id=? AND surface='event' AND subject_type='story_event' AND subject_id=? "+
      "AND status NOT IN ('withdrawn','superseded') AND author_input_id IN ("+marks+")"
    ).all(scope.ownerId,scope.bookId,eventId,...ids) as unknown as Array<{
      author_input_id:string;intent_strength:string;original_text:string;scope_notes:string|null;
    }>;
    return rows.map(r=>({id:r.author_input_id,intentStrength:r.intent_strength,originalText:r.original_text,scopeNotes:r.scope_notes}));
  }

  public latestTask(scope:BookScope,eventId:string):StoryEventGenerationTaskRow|undefined{
    assertBookScope(scope);return this.db.prepare(
      "SELECT task_id,status,current_phase,error_code,idempotency_key,task_brief_json,checkpoint_json,created_at,updated_at "+
      "FROM tasks WHERE owner_id=? AND book_id=? AND task_type='story_event_generation' "+
      "AND json_extract(task_brief_json,'$.eventId')=? ORDER BY created_at DESC,task_id DESC LIMIT 1"
    ).get(scope.ownerId,scope.bookId,eventId) as StoryEventGenerationTaskRow|undefined;
  }
  public candidate(scope:BookScope,eventId:string,taskId:string,kind:'candidate_a'|'candidate_b'|'fusion'){
    assertBookScope(scope);return this.db.prepare(
      "SELECT story_event_version_id,content_json FROM story_event_versions "+
      "WHERE owner_id=? AND book_id=? AND event_id=? AND source_task_id=? AND candidate_kind=? ORDER BY version DESC LIMIT 1"
    ).get(scope.ownerId,scope.bookId,eventId,taskId,kind) as {story_event_version_id:string;content_json:string}|undefined;
  }
  public attachTask(scope:BookScope,input:{eventId:string;taskId:string;expectedWorkflowVersion:number;expectedEventRevision:number;expectedActiveVersionId:string|null;now:string}){
    assertBookScope(scope);return this.db.prepare(
      "UPDATE creation_workflow_states SET stage='event_in_progress',waiting_task_id=?,blocking_reason=NULL,updated_at=? "+
      "WHERE owner_id=? AND book_id=? AND planning_version=? AND stage IN ('event_sequence_in_progress','event_in_progress','event_confirmed') "+
      "AND (waiting_task_id IS NULL OR waiting_task_id=? OR EXISTS(SELECT 1 FROM tasks t "+
      "WHERE t.owner_id=creation_workflow_states.owner_id AND t.book_id=creation_workflow_states.book_id "+
      "AND t.task_id=creation_workflow_states.waiting_task_id AND t.status IN ('failed','cancelled','succeeded','interrupted','blocked'))) "+
      "AND EXISTS(SELECT 1 FROM story_events e WHERE e.owner_id=creation_workflow_states.owner_id "+
      "AND e.book_id=creation_workflow_states.book_id AND e.event_id=? AND e.revision=? AND e.active_version_id IS ?)"
    ).run(input.taskId,input.now,scope.ownerId,scope.bookId,input.expectedWorkflowVersion,input.taskId,
      input.eventId,input.expectedEventRevision,input.expectedActiveVersionId).changes===1;
  }
  public clearTask(scope:BookScope,taskId:string,now:string){
    this.db.prepare("UPDATE creation_workflow_states SET waiting_task_id=NULL,blocking_reason=NULL,updated_at=? WHERE owner_id=? AND book_id=? AND waiting_task_id=?")
      .run(now,scope.ownerId,scope.bookId,taskId);
  }
  public failTask(scope:BookScope,taskId:string,reason:string,now:string){
    this.db.prepare("UPDATE creation_workflow_states SET blocking_reason=?,updated_at=? WHERE owner_id=? AND book_id=? AND waiting_task_id=?")
      .run(reason,now,scope.ownerId,scope.bookId,taskId);
  }
  public succeededResult(scope:BookScope,input:{taskId:string;agentId:string;modelSnapshotId:string;inputHash:string}):StoredModelResult|undefined{
    return this.db.prepare(
      "SELECT r.output_text,r.input_tokens,r.output_tokens,r.cash_micros FROM model_calls m "+
      "JOIN model_call_results r ON r.request_id=m.request_id WHERE m.owner_id=? AND m.book_id=? AND m.task_id=? "+
      "AND m.agent_id=? AND m.model_snapshot_id=? AND m.input_hash=? AND m.state='succeeded' ORDER BY m.completed_at DESC LIMIT 1"
    ).get(scope.ownerId,scope.bookId,input.taskId,input.agentId,input.modelSnapshotId,input.inputHash) as StoredModelResult|undefined;
  }
  public hasUnresolved(scope:BookScope,taskId:string){
    return this.db.prepare("SELECT 1 FROM model_calls m JOIN model_call_reconciliations r ON r.request_id=m.request_id "+
      "WHERE m.owner_id=? AND m.book_id=? AND m.task_id=? AND r.state='awaiting_provider' LIMIT 1")
      .get(scope.ownerId,scope.bookId,taskId)!==undefined;
  }
}
export type {VolumePlanGenerationSeat};
