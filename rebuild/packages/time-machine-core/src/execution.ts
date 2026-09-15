import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {parseScope,type Scope} from './contracts.js';
import {digest,Conflict} from './store.js';
export const executionSchema=`
CREATE TABLE tm2_steps(owner TEXT NOT NULL,book TEXT NOT NULL,id TEXT NOT NULL,input_hash TEXT NOT NULL,member TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('ready','running','unknown','failed','succeeded')),attempt TEXT,lease_until INTEGER,output TEXT,error_code TEXT,PRIMARY KEY(owner,book,id),FOREIGN KEY(owner,book) REFERENCES tm2_books(owner,book)) STRICT;
CREATE TABLE tm2_attempts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,book TEXT NOT NULL,step TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('running','unknown','failed','succeeded')),started_at INTEGER NOT NULL,finished_at INTEGER,FOREIGN KEY(owner,book,step) REFERENCES tm2_steps(owner,book,id)) STRICT;
`;
export type StepState='ready'|'running'|'unknown'|'failed'|'succeeded';
interface Step {input_hash:string;member:string;state:StepState;attempt:string|null;lease_until:number|null;output:string|null;error_code:string|null}
export type ClaimResult={kind:'claimed';attemptId:string}|{kind:'saved';output:unknown}|{kind:'wait';state:'running'|'unknown'|'failed'};
/** Attempts are durable before dispatch. Lease expiry is UNKNOWN, never permission to send again. */
export class StepRepository {
 constructor(private readonly db:DatabaseSync){}
 private tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const x=fn();this.db.exec('COMMIT');return x;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 private row(scope:Scope,id:string):Step{parseScope(scope);const x=this.db.prepare('SELECT input_hash,member,state,attempt,lease_until,output,error_code FROM tm2_steps WHERE owner=? AND book=? AND id=?').get(scope.ownerId,scope.bookId,id) as unknown as Step|undefined;if(!x)throw new Error('步骤不存在或不属于当前书籍');return x;}
 create(scope:Scope,id:string,input:unknown,member:string):void{parseScope(scope);if(!id.trim()||!member.trim())throw new Error('缺少步骤或成员');const hash=digest(input);this.tx(()=>{this.db.prepare("INSERT OR IGNORE INTO tm2_steps(owner,book,id,input_hash,member,state) VALUES(?,?,?,?,?,'ready')").run(scope.ownerId,scope.bookId,id,hash,member);const row=this.row(scope,id);if(row.input_hash!==hash||row.member!==member)throw new Conflict('接续不能改变输入或成员');});}
 claim(scope:Scope,id:string,now:number,leaseMs:number):ClaimResult{
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>3600000)throw new Error('租约参数错误');
  return this.tx(()=>{const row=this.row(scope,id);
   if(row.state==='succeeded')return {kind:'saved',output:JSON.parse(row.output!)};
   if(row.state==='running'&&row.lease_until!<=now){this.markUnknown(scope,id,row.attempt!,now);return {kind:'wait',state:'unknown'};}
   if(row.state!=='ready')return {kind:'wait',state:row.state};
   const attemptId=randomUUID();this.db.prepare("INSERT INTO tm2_attempts(id,owner,book,step,state,started_at) VALUES(?,?,?,?,'running',?)").run(attemptId,scope.ownerId,scope.bookId,id,now);
   this.db.prepare("UPDATE tm2_steps SET state='running',attempt=?,lease_until=?,error_code=NULL WHERE owner=? AND book=? AND id=?").run(attemptId,now+leaseMs,scope.ownerId,scope.bookId,id);return {kind:'claimed',attemptId};
  });
 }
 private markUnknown(scope:Scope,id:string,attempt:string,now:number):void{this.db.prepare("UPDATE tm2_steps SET state='unknown',error_code='outcome_unknown' WHERE owner=? AND book=? AND id=?").run(scope.ownerId,scope.bookId,id);this.db.prepare("UPDATE tm2_attempts SET state='unknown',finished_at=? WHERE id=?").run(now,attempt);}
 finish(scope:Scope,id:string,attempt:string,output:unknown,now:number):void{
  const serialized=JSON.stringify(output);if(serialized===undefined||serialized.length>1000000)throw new Error('产物格式或大小错误');
  this.tx(()=>{const row=this.row(scope,id);if(row.attempt!==attempt)throw new Conflict('旧attempt不得写入新步骤');
   if(row.state==='succeeded'){if(digest(JSON.parse(row.output!))!==digest(output))throw new Conflict('同一attempt结果不能变化');return;}
   if(!['running','unknown'].includes(row.state))throw new Conflict('步骤已停止');
   this.db.prepare("UPDATE tm2_steps SET state='succeeded',output=?,lease_until=NULL,error_code=NULL WHERE owner=? AND book=? AND id=?").run(serialized,scope.ownerId,scope.bookId,id);
   this.db.prepare("UPDATE tm2_attempts SET state='succeeded',finished_at=? WHERE id=?").run(now,attempt);
   this.db.prepare("INSERT INTO tm2_outbox(owner,book,id,kind,body) VALUES(?,?,?,'step.succeeded',?)").run(scope.ownerId,scope.bookId,randomUUID(),JSON.stringify({stepId:id,attemptId:attempt}));
  });
 }
 fail(scope:Scope,id:string,attempt:string,code:'temporary'|'authentication'|'budget'|'truncated'|'unknown',now:number):void{
  if(!['temporary','authentication','budget','truncated','unknown'].includes(code))throw new Error('错误分类无效');
  this.tx(()=>{const row=this.row(scope,id);if(row.attempt!==attempt||!['running','unknown'].includes(row.state))throw new Conflict('步骤已变化');
   if(code==='unknown'){this.markUnknown(scope,id,attempt,now);return;}
   this.db.prepare("UPDATE tm2_steps SET state='failed',error_code=?,lease_until=NULL WHERE owner=? AND book=? AND id=?").run(code,scope.ownerId,scope.bookId,id);
   this.db.prepare("UPDATE tm2_attempts SET state='failed',finished_at=? WHERE id=?").run(now,attempt);
  });
 }
 /** Only a known transient failure is automatically retried. Unknown calls need gateway reconciliation. */
 retryTemporary(scope:Scope,id:string,maxRetries=2):boolean{
  if(!Number.isSafeInteger(maxRetries)||maxRetries<0||maxRetries>10)throw new Error('重试预算错误');
  return this.tx(()=>{const row=this.row(scope,id);if(row.state!=='failed'||row.error_code!=='temporary')return false;const n=this.db.prepare('SELECT COUNT(*) n FROM tm2_attempts WHERE owner=? AND book=? AND step=?').get(scope.ownerId,scope.bookId,id) as {n:number};if(n.n>maxRetries)return false;this.db.prepare("UPDATE tm2_steps SET state='ready' WHERE owner=? AND book=? AND id=?").run(scope.ownerId,scope.bookId,id);return true;});
 }
 /** 30a6f053：同轮截断恢复——只重新武装指定run下已知可恢复错误码（truncated等）的失败步骤；
  * 已成功步骤保持缓存复用，unknown结果永不重发。 */
 retryRunFailed(scope:Scope,runId:string,code:'temporary'|'authentication'|'budget'|'truncated'):number{
  parseScope(scope);
  if(!runId.trim())throw new Error('缺少运行编号');
  return this.tx(()=>{const r=this.db.prepare("UPDATE tm2_steps SET state='ready' WHERE owner=? AND book=? AND id LIKE ? ESCAPE '\\' AND state='failed' AND error_code=?").run(scope.ownerId,scope.bookId,`${runId.replace(/[\\%_]/gu,ch=>'\\'+ch)}:%`,code);return Number(r.changes);});
 }
 state(scope:Scope,id:string):{state:StepState;error:string|null}{const row=this.row(scope,id);return {state:row.state,error:row.error_code};}
}
