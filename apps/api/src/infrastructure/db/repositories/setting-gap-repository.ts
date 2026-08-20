import type {DatabaseSync} from 'node:sqlite';
import type {BookScope} from '../../../domain/scope.js';
export interface SettingGapRow{
  setting_gap_decision_id:string;discovered_scope_type:'volume'|'event'|'chapter';discovered_scope_id:string;
  question:string;why_needed:string;affected_objects_json:string;decision:'design_now'|'not_used_this_volume'|'keep_unknown';
  resolved_setting_version_id:string|null;decision_status:'pending'|'needs_setting'|'decided';applied_at:string|null;
  created_at:string;updated_at:string;
}
export class SettingGapRepository{
  public constructor(private readonly database:DatabaseSync){}
  public list(scope:BookScope):SettingGapRow[]{return this.database.prepare(`SELECT * FROM setting_gap_decisions
    WHERE owner_id=? AND book_id=? ORDER BY CASE decision_status WHEN 'pending' THEN 0 WHEN 'needs_setting' THEN 1 ELSE 2 END,
    updated_at DESC,setting_gap_decision_id`).all(scope.ownerId,scope.bookId) as unknown as SettingGapRow[];}
  public get(scope:BookScope,id:string):SettingGapRow|undefined{return this.database.prepare(`SELECT * FROM setting_gap_decisions
    WHERE owner_id=? AND book_id=? AND setting_gap_decision_id=?`).get(scope.ownerId,scope.bookId,id) as SettingGapRow|undefined;}
  public insert(scope:BookScope,input:{id:string;scopeType:string;scopeId:string;question:string;whyNeeded:string;
    affectedObjects:string[];now:string}):void{this.database.prepare(`INSERT INTO setting_gap_decisions(
      setting_gap_decision_id,owner_id,book_id,discovered_scope_type,discovered_scope_id,question,why_needed,
      affected_objects_json,decision,resolved_setting_version_id,decision_status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'keep_unknown',NULL,'pending',?,?)`).run(input.id,scope.ownerId,scope.bookId,input.scopeType,
        input.scopeId,input.question,input.whyNeeded,JSON.stringify(input.affectedObjects),input.now,input.now);}
  public decide(scope:BookScope,id:string,input:{decision:string;resolvedVersionId:string|null;status:string;now:string}):boolean{
    return this.database.prepare(`UPDATE setting_gap_decisions SET decision=?,resolved_setting_version_id=?,decision_status=?,
      applied_at=CASE WHEN ?='decided' THEN ? ELSE NULL END,updated_at=? WHERE owner_id=? AND book_id=?
      AND setting_gap_decision_id=? AND decision_status IN ('pending','needs_setting')`).run(input.decision,input.resolvedVersionId,
        input.status,input.status,input.now,input.now,scope.ownerId,scope.bookId,id).changes===1;}
  public insertClause(scope:BookScope,input:{id:string;kind:string;statement:string;strength:string;scopeType:string;scopeId:string;
    sourceVersionId:string;now:string}):void{this.database.prepare(`INSERT INTO setting_clauses(setting_clause_id,owner_id,book_id,
      kind,statement,strength,truth_status,scope_type,scope_id,source_version_id,dependency_version_ids_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'confirmed',?,?,?, '[]','active',?,?)`).run(input.id,scope.ownerId,scope.bookId,input.kind,input.statement,
        input.strength,input.scopeType,input.scopeId,input.sourceVersionId,input.now,input.now);}
}