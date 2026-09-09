import type { DatabaseSync } from 'node:sqlite';
import { validateRhythmPolicy, type RhythmPolicySnapshot, type PlanningLayerKey } from '@wenmi/v7-backend';
export interface MethodAgentRequest {requestId:string;ownerId:string;bookId:string;runId:string;memberKey:string;prompt:string;kind:'recipe'|'tree'|'creation';nodeKey?:string;acknowledgedUnknownRequestId?:string|null}
export class MethodAgentRepository {
 constructor(private readonly db:DatabaseSync){}
 binding(r:MethodAgentRequest):{snapshot:RhythmPolicySnapshot;layer:PlanningLayerKey}|null{
  const match=r.prompt.match(/\[method-agent:v(\d+):(book_backbone|volume_distribution|volume|chain|chapter_execution)\]/u);if(!match)return null;
  const prefix=`creation:${r.ownerId}:${r.bookId}:${r.runId}:`;
  const row=this.db.prepare(`SELECT p.version,p.policy_json FROM v7_rhythm_task_policies t JOIN v7_rhythm_policy_versions p ON p.version=t.version
   WHERE p.version=? AND (t.task_key=? OR t.task_key=? OR substr(t.task_key,1,?)=?) LIMIT 1`).get(Number(match[1]),`route:${r.ownerId}:${r.bookId}:${r.runId}`,`tree:${r.ownerId}:${r.bookId}:${r.runId}`,prefix.length,prefix) as {version:number;policy_json:string}|undefined;
  if(!row)return null;const policy=validateRhythmPolicy(JSON.parse(row.policy_json));if(policy.format!=='audited-v4')return null;
  return {snapshot:{version:row.version,policy},layer:match[2] as PlanningLayerKey};
 }
 protected active(r:MethodAgentRequest):void{
  const [table,id]=r.kind==='recipe'?['v7_planning_recipe_runs','run_id']:r.kind==='tree'?['v7_planning_generation_runs','generation_run_id']:['v7_creation_workflows','workflow_id'];
  const row=this.db.prepare(`SELECT status FROM ${table} WHERE owner_id=? AND book_id=? AND ${id}=?`).get(r.ownerId,r.bookId,r.runId) as {status:string}|undefined;
  if(!row||!['queued','working'].includes(row.status))throw Error('任务已停止，未继续派发方法查询或设计。');
  if(r.nodeKey){
   const table=r.kind==='creation'?'v7_creation_model_calls':'v7_planning_model_calls',id=r.kind==='creation'?'workflow_id':'run_id';const prefix=`${r.nodeKey}:methods:`;
   const unknown=this.db.prepare(`SELECT request_id FROM ${table} WHERE owner_id=? AND book_id=? AND ${id}=? AND state IN ('working','unknown') AND (node_key=? OR substr(node_key,1,?)=?) AND request_id<>? LIMIT 1`).get(r.ownerId,r.bookId,r.runId,r.nodeKey,prefix.length,prefix,r.acknowledgedUnknownRequestId??'');
   if(unknown)throw Error('上一次成员调用结果尚未确认，已停止继续派发；请从任务恢复入口核查。');
  }
 }
 protected save(r:MethodAgentRequest,layer:PlanningLayerKey,version:number,step:number,event:unknown):void{
  this.db.prepare(`INSERT INTO v7_method_agent_events(owner_id,book_id,session_id,step,run_id,member_key,layer,policy_version,event_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(owner_id,book_id,session_id,step) DO UPDATE SET event_json=excluded.event_json`).run(r.ownerId,r.bookId,r.requestId,step,r.runId,r.memberKey,layer,version,JSON.stringify(event),new Date().toISOString());
 }
}
