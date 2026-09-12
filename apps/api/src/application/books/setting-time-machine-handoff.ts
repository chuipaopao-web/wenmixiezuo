import type {DatabaseSync} from 'node:sqlite';
type Scope={ownerId:string;bookId:string};
export function enqueueSettingHandoff(db:DatabaseSync,scope:Scope,version:string,now:string):void{
 db.prepare("INSERT OR IGNORE INTO setting_time_machine_handoffs(owner_id,book_id,source_version,state,created_at,updated_at) VALUES(?,?,?,'pending',?,?)").run(scope.ownerId,scope.bookId,version,now,now);
}
/** No model calls here. Persisted runs are consumed by the normal executor. */
export function dispatchSettingHandoffs(db:DatabaseSync,prepared:(s:Scope)=>{ready:boolean;version:string|null},start:(s:Scope,key:string)=>string):void{
 const rows=db.prepare("SELECT h.* FROM setting_time_machine_handoffs h WHERE state='pending' ORDER BY created_at LIMIT 5").all();
 for(const row of rows){
  const scope={ownerId:String(row.owner_id),bookId:String(row.book_id)},version=String(row.source_version),now=new Date().toISOString();
  const finish=(state:string,id:string|null,error:string|null)=>db.prepare("UPDATE setting_time_machine_handoffs SET state=?,run_id=?,error_message=?,updated_at=? WHERE owner_id=? AND book_id=? AND source_version=? AND state='pending'").run(state,id,error,now,scope.ownerId,scope.bookId,version);
  try{
   const book=db.prepare('SELECT status FROM books WHERE owner_id=? AND book_id=?').get(scope.ownerId,scope.bookId);
   const current=book?.status==='active'?prepared(scope):null;
   if(!current?.ready||current.version!==version){finish('obsolete',null,null);continue;}
   const key=`recommend-initial:${scope.bookId}:${version}`;
   const existing=db.prepare("SELECT id FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND kind='recommend' AND request_key=?").get(scope.ownerId,scope.bookId,key);
   const id=existing?String(existing.id):start(scope,key);
   finish('dispatched',id,null);
  }catch{finish('failed',null,'资料整理尚未启动，请进入时光机重新发起。');}
 }
}
