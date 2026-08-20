import type {DatabaseSync} from 'node:sqlite';
import type {BookScope} from '../../../domain/scope.js';

export interface StoryThreadRow{
  story_thread_record_id:string;thread_key:string|null;thread_type:string;title:string;scope_type:string;scope_id:string;
  status:'planned'|'planted'|'advanced'|'due'|'resolved'|'abandoned_by_author';planned_window_json:string|null;
  source_version_ids_json:string;actual_evidence_version_ids_json:string;abandonment_reason:string|null;
  revision:number;created_at:string;updated_at:string;
}
export interface SettledEventChainSourceRow{
  volumePlanId:string;eventOrder:number;chainVersionId:string;chainContent:string;
}
export class StoryThreadRepository{
  public constructor(private readonly database:DatabaseSync){}
  public byKey(scope:BookScope,key:string):StoryThreadRow|undefined{
    return this.database.prepare(`SELECT * FROM story_thread_records WHERE owner_id=? AND book_id=? AND thread_key=?`)
      .get(scope.ownerId,scope.bookId,key) as StoryThreadRow|undefined;
  }
  public list(scope:BookScope):StoryThreadRow[]{
    return this.database.prepare(`SELECT * FROM story_thread_records WHERE owner_id=? AND book_id=?
      ORDER BY CASE status WHEN 'due' THEN 0 WHEN 'advanced' THEN 1 WHEN 'planted' THEN 2 WHEN 'planned' THEN 3
        WHEN 'resolved' THEN 4 ELSE 5 END,updated_at DESC,story_thread_record_id`)
      .all(scope.ownerId,scope.bookId) as unknown as StoryThreadRow[];
  }
  public settledEventChainSource(scope:BookScope,eventId:string):SettledEventChainSourceRow|undefined{
    return this.database.prepare(`SELECT e.volume_plan_id AS volumePlanId,e.sequence_order AS eventOrder,
      ec.event_chain_version_id AS chainVersionId,ec.content_json AS chainContent
      FROM story_events e JOIN volume_direction_versions d ON d.owner_id=e.owner_id AND d.book_id=e.book_id
        AND d.volume_plan_id=e.volume_plan_id AND d.status='active'
      JOIN event_chain_versions ec ON ec.owner_id=e.owner_id AND ec.book_id=e.book_id
        AND ec.volume_plan_id=e.volume_plan_id AND ec.volume_direction_version_id=d.volume_direction_version_id AND ec.status='active'
      WHERE e.owner_id=? AND e.book_id=? AND e.event_id=? AND e.status='settled'`)
      .get(scope.ownerId,scope.bookId,eventId) as SettledEventChainSourceRow|undefined;
  }
  public insert(scope:BookScope,input:{id:string;key:string;type:string;title:string;scopeType:string;scopeId:string;
    plannedWindow:unknown;sourceVersionIds:string[];now:string}):void{
    this.database.prepare(`INSERT INTO story_thread_records(story_thread_record_id,owner_id,book_id,thread_key,
      thread_type,title,scope_type,scope_id,status,planned_window_json,source_version_ids_json,
      actual_evidence_version_ids_json,revision,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'planned',?,?, '[]',1,?,?)`)
      .run(input.id,scope.ownerId,scope.bookId,input.key,input.type,input.title,input.scopeType,input.scopeId,
        JSON.stringify(input.plannedWindow),JSON.stringify(input.sourceVersionIds),input.now,input.now);
  }
  public updatePlan(scope:BookScope,key:string,input:{plannedWindow:unknown;sourceVersionIds:string[];now:string}):void{
    this.database.prepare(`UPDATE story_thread_records SET planned_window_json=?,source_version_ids_json=?,
      revision=revision+1,updated_at=? WHERE owner_id=? AND book_id=? AND thread_key=?`)
      .run(JSON.stringify(input.plannedWindow),JSON.stringify(input.sourceVersionIds),input.now,scope.ownerId,scope.bookId,key);
  }
  public applyActual(scope:BookScope,key:string,input:{status:'planted'|'advanced'|'resolved';evidenceId:string;now:string}):boolean{
    const row=this.byKey(scope,key);if(row===undefined||row.status==='abandoned_by_author'||row.status==='resolved')return false;
    const rank={planned:0,planted:1,advanced:2,due:2,resolved:3,abandoned_by_author:-1} as const;
    const next=rank[input.status]>=rank[row.status]?input.status:row.status;
    const evidence=[...new Set([...(JSON.parse(row.actual_evidence_version_ids_json) as string[]),input.evidenceId])];
    return this.database.prepare(`UPDATE story_thread_records SET status=?,actual_evidence_version_ids_json=?,
      abandonment_reason=NULL,revision=revision+1,updated_at=? WHERE owner_id=? AND book_id=? AND thread_key=? AND revision=?`)
      .run(next,JSON.stringify(evidence),input.now,scope.ownerId,scope.bookId,key,row.revision).changes===1;
  }
  public markDue(scope:BookScope,key:string,now:string):void{
    this.database.prepare(`UPDATE story_thread_records SET status='due',revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND thread_key=? AND status IN ('planned','planted','advanced')`)
      .run(now,scope.ownerId,scope.bookId,key);
  }
  public abandon(scope:BookScope,id:string,reason:string,now:string):boolean{
    return this.database.prepare(`UPDATE story_thread_records SET status='abandoned_by_author',abandonment_reason=?,
      revision=revision+1,updated_at=? WHERE owner_id=? AND book_id=? AND story_thread_record_id=? AND status<>'resolved'`)
      .run(reason,now,scope.ownerId,scope.bookId,id).changes===1;
  }
}