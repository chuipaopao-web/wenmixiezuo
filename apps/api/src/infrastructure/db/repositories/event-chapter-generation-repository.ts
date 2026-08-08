import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope,type BookScope } from '../../../domain/scope.js';
import type { StoredModelResult } from './volume-plan-generation-repository.js';

export interface EventChapterGenerationTaskRow {task_id:string;status:string;current_phase:string;error_code:string|null;
  idempotency_key:string;task_brief_json:string;checkpoint_json:string;created_at:string;updated_at:string;}
export class EventChapterGenerationRepository {
  public constructor(private readonly db:DatabaseSync){}
  public authorInputs(scope:BookScope,input:{subjectType:string;subjectId:string;ids:string[]}){
    assertBookScope(scope);if(input.ids.length===0)return[];const q=input.ids.map(()=>'?').join(',');
    return this.db.prepare(`SELECT author_input_id,subject_id,intent_strength,original_text,scope_notes FROM author_planning_inputs
      WHERE owner_id=? AND book_id=? AND surface='chapter_outline' AND subject_type=? AND subject_id=?
      AND status NOT IN ('withdrawn','superseded') AND author_input_id IN (${q})`)
      .all(scope.ownerId,scope.bookId,input.subjectType,input.subjectId,...input.ids) as unknown as Array<{
        author_input_id:string;subject_id:string;intent_strength:string;original_text:string;scope_notes:string|null}>;
  }
  public latest(scope:BookScope,subjectId:string,taskType:'event_chapter_sequence_generation'|'event_chapter_detail_generation'){
    assertBookScope(scope);return this.db.prepare(`SELECT task_id,status,current_phase,error_code,idempotency_key,task_brief_json,
      checkpoint_json,created_at,updated_at FROM tasks WHERE owner_id=? AND book_id=? AND task_type=?
      AND json_extract(task_brief_json,'$.subjectId')=? ORDER BY created_at DESC,task_id DESC LIMIT 1`)
      .get(scope.ownerId,scope.bookId,taskType,subjectId) as EventChapterGenerationTaskRow|undefined;
  }
  public attach(scope:BookScope,input:{taskId:string;expectedPlanningVersion:number;allowedStages:string[];now:string}){
    const q=input.allowedStages.map(()=>'?').join(',');
    return this.db.prepare(`UPDATE creation_workflow_states SET waiting_task_id=?,blocking_reason=NULL,updated_at=?
      WHERE owner_id=? AND book_id=? AND planning_version=? AND stage IN (${q})
      AND (waiting_task_id IS NULL OR waiting_task_id=? OR EXISTS(SELECT 1 FROM tasks t WHERE t.owner_id=creation_workflow_states.owner_id
      AND t.book_id=creation_workflow_states.book_id AND t.task_id=creation_workflow_states.waiting_task_id
      AND t.status IN ('failed','cancelled','succeeded','interrupted','blocked')))`)
      .run(input.taskId,input.now,scope.ownerId,scope.bookId,input.expectedPlanningVersion,...input.allowedStages,input.taskId).changes===1;
  }
  public clear(scope:BookScope,taskId:string,now:string){this.db.prepare(
    "UPDATE creation_workflow_states SET waiting_task_id=NULL,blocking_reason=NULL,updated_at=? WHERE owner_id=? AND book_id=? AND waiting_task_id=?"
  ).run(now,scope.ownerId,scope.bookId,taskId);}
  public fail(scope:BookScope,taskId:string,reason:string,now:string){this.db.prepare(
    "UPDATE creation_workflow_states SET blocking_reason=?,updated_at=? WHERE owner_id=? AND book_id=? AND waiting_task_id=?"
  ).run(reason,now,scope.ownerId,scope.bookId,taskId);}
  public succeeded(scope:BookScope,input:{taskId:string;agentId:string;modelSnapshotId:string;inputHash:string}):StoredModelResult|undefined{
    return this.db.prepare(`SELECT r.output_text,r.input_tokens,r.output_tokens,r.cash_micros FROM model_calls m
      JOIN model_call_results r ON r.request_id=m.request_id WHERE m.owner_id=? AND m.book_id=? AND m.task_id=?
      AND m.agent_id=? AND m.model_snapshot_id=? AND m.input_hash=? AND m.state='succeeded' ORDER BY m.completed_at DESC LIMIT 1`)
      .get(scope.ownerId,scope.bookId,input.taskId,input.agentId,input.modelSnapshotId,input.inputHash) as StoredModelResult|undefined;
  }
  public unresolved(scope:BookScope,taskId:string){return this.db.prepare(`SELECT 1 FROM model_calls m JOIN model_call_reconciliations r
    ON r.request_id=m.request_id WHERE m.owner_id=? AND m.book_id=? AND m.task_id=? AND r.state='awaiting_provider' LIMIT 1`)
    .get(scope.ownerId,scope.bookId,taskId)!==undefined;}
}
