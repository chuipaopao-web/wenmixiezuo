import type {DatabaseSync} from 'node:sqlite';
import {digest,parseScope,type Scope} from '@wenmi/time-machine-core';
import {assertMembershipAllowsGeneration} from '../security/membership-service.js';
import {ModelAdapterError,type ModelAdapter} from './model-adapter.js';
import {thinkingTokenAllowance} from './model-runtime-config.js';

export interface TimeMachineCall {
 scope:Scope; id:string; memberId:string; provider:string; modelId:string;
 prompt:string; maxOutputTokens:number; windowTokens:number; temperature:number;
 /** 节点预算策略显式推理余量（tm2-node-budget-v2）；预留与转发必须与适配器实际max_tokens一致。 */
 thinkingHeadroomTokens?: number;
}
/** 老板红线（2026-09-12）：设计成员单次收到的上下文（提示词）不得超过1.5万字；超限必须拆批或压缩，不得截断关键条件。 */
export const TIME_MACHINE_PROMPT_CHAR_LIMIT = 15_000;
export class TimeMachineCallError extends Error {
 constructor(public readonly kind:'unknown'|'authentication'|'temporary'|'budget'|'truncated'|'invalid',message:string,public readonly diagnosticCode?:string){super(message);}
}
interface CallRow {owner_id:string;book_id:string;request_hash:string;state:string;output_text:string|null;error_class:string|null}
/** Only transport and the authoritative account usage service are shared with the host. */
export class TimeMachineModelGateway {
 constructor(private readonly db:DatabaseSync,private readonly resolve:(provider:string,model:string)=>ModelAdapter){}
 saved(scope:Scope,id:string):string|null{const row=this.db.prepare("SELECT output_text FROM tm2_model_calls WHERE id=? AND owner_id=? AND book_id=? AND state='succeeded'").get(id,scope.ownerId,scope.bookId) as {output_text:string}|undefined;return row?.output_text??null;}
 async generate(request:TimeMachineCall):Promise<string>{
  parseScope(request.scope);
  if(!request.id.trim()||!request.memberId.trim()||!request.prompt.trim()||!Number.isSafeInteger(request.windowTokens)||request.windowTokens<=0||!Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<=0||!Number.isFinite(request.temperature)||request.temperature<0||request.temperature>2)throw new TimeMachineCallError('invalid','调用配置不完整');
  if(request.thinkingHeadroomTokens!==undefined&&(!Number.isSafeInteger(request.thinkingHeadroomTokens)||request.thinkingHeadroomTokens<0||request.thinkingHeadroomTokens>64000))throw new TimeMachineCallError('invalid','调用配置不完整');
  if(request.prompt.length>TIME_MACHINE_PROMPT_CHAR_LIMIT)throw new TimeMachineCallError('budget',`本次上下文${request.prompt.length}字符，超过1.5万字红线，需拆批或压缩后重试`);
  const accessible=this.db.prepare("SELECT 1 FROM books WHERE owner_id=? AND book_id=? AND status<>'archived'").get(request.scope.ownerId,request.scope.bookId);
  if(!accessible)throw new TimeMachineCallError('invalid','书籍不可访问');
  const hash=digest(request);
  const existing=this.db.prepare('SELECT owner_id,book_id,request_hash,state,output_text FROM tm2_model_calls WHERE id=?').get(request.id) as unknown as CallRow|undefined;
  if(existing){
   if(existing.owner_id!==request.scope.ownerId||existing.book_id!==request.scope.bookId||existing.request_hash!==hash)throw new TimeMachineCallError('invalid','调用编号已绑定其他请求');
   if(existing.state==='succeeded')return existing.output_text!;
   throw new TimeMachineCallError(existing.state==='failed'?'invalid':'unknown','调用已有记录，需要核对结果，未重复发送');
  }
  if(Buffer.byteLength(request.prompt,'utf8')+request.maxOutputTokens+2048>request.windowTokens)throw new TimeMachineCallError('budget','本次上下文超预算，尚未调用模型');
  let adapter:ModelAdapter;
  try{adapter=this.resolve(request.provider,request.modelId);}catch{throw new TimeMachineCallError('authentication','成员模型尚未准备好，未发送请求');}
  // Production adapter supplies the actual system/messages envelope; local test adapters have one user message.
  const input=adapter.inputContext?.({prompt:request.prompt})??JSON.stringify({messages:[{role:'user',content:request.prompt}]});
  if(input.length>TIME_MACHINE_PROMPT_CHAR_LIMIT)throw new TimeMachineCallError('budget',`完整输入${input.length}字符，超过15000字符上限；已包含系统提示及消息包装，未发送模型`);
  // Conservative UTF-8 bound is explicitly not a tokenizer. Include transport/reasoning allowance.
  // 显式推理余量（节点预算策略）与适配器max_tokens同源，预留不得按默认折算少算。
  const reasoning=request.thinkingHeadroomTokens??thinkingTokenAllowance(request.modelId,'structured_planning',request.maxOutputTokens,request.prompt.length);
  const reserved=Buffer.byteLength(input,'utf8')+request.maxOutputTokens+reasoning+2048;
  if(reserved>request.windowTokens)throw new TimeMachineCallError('budget','本次上下文超预算，尚未调用模型');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const old=this.db.prepare('SELECT owner_id,book_id,request_hash,state,output_text,error_class FROM tm2_model_calls WHERE id=?').get(request.id) as unknown as CallRow|undefined;
   if(old){
    if(old.owner_id!==request.scope.ownerId||old.book_id!==request.scope.bookId||old.request_hash!==hash)throw new TimeMachineCallError('invalid','调用编号已绑定其他请求');
    this.db.exec('COMMIT');
    if(old.state==='succeeded')return old.output_text!;
    throw new TimeMachineCallError(old.state==='failed'?'invalid':'unknown','调用已有记录，需要核对结果，未重复发送');
   }
   const book=this.db.prepare("SELECT 1 FROM books WHERE owner_id=? AND book_id=? AND status<>'archived'").get(request.scope.ownerId,request.scope.bookId);
   if(!book)throw new TimeMachineCallError('invalid','书籍不可访问');
   assertMembershipAllowsGeneration(this.db,request.scope.ownerId,new Date().toISOString(),reserved);
   this.db.prepare("INSERT INTO tm2_model_calls(id,owner_id,book_id,member_id,provider,model_id,request_hash,state,reserved_tokens,prompt_chars,started_at) VALUES(?,?,?,?,?,?,?,'working',?,?,?)").run(request.id,request.scope.ownerId,request.scope.bookId,request.memberId,request.provider,request.modelId,hash,reserved,input.length,new Date().toISOString());
   this.db.exec('COMMIT');
  }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
  let dispatched=false;
  try{
   dispatched=true;
   const result=await adapter.generate({requestId:request.id,taskId:request.id,ownerId:request.scope.ownerId,bookId:request.scope.bookId,agentId:request.memberId,prompt:request.prompt,maxOutputTokens:request.maxOutputTokens,...(request.thinkingHeadroomTokens!==undefined?{thinkingHeadroomTokens:request.thinkingHeadroomTokens}:{}),temperature:request.temperature});
   if(![result.inputTokens,result.outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(result.cashCostCny)||result.cashCostCny<0)throw new TimeMachineCallError('unknown','供应商用量需要核对');
   if(result.provider!==request.provider||result.modelId!==request.modelId)throw new TimeMachineCallError('unknown','实际路由与冻结成员不一致');
   this.db.prepare("UPDATE tm2_model_calls SET state='succeeded',input_tokens=?,output_tokens=?,cash_micros=?,output_text=?,completed_at=? WHERE id=? AND state='working'").run(result.inputTokens,result.outputTokens,Math.round(result.cashCostCny*1000000),result.output,new Date().toISOString(),request.id);
   return result.output;
  }catch(error){
   let kind:TimeMachineCallError['kind']='unknown';
   if(error instanceof TimeMachineCallError)kind=error.kind;
   else if(error instanceof ModelAdapterError){
    // 长度截断按机器可读causeCode分型（不解析message）：known-incomplete结果，
    // 恢复动作是拆分/续作而非用相同长请求盲重试；HTTP400等仍走原有failureClass分型。
    if(error.causeCode==='output_length_limit')kind='truncated';
    else kind=error.outcomeUnknown?'unknown':error.failureClass==='authentication_failure'?'authentication':error.retryable?'temporary':'invalid';
   }
   else if(!dispatched)kind='authentication';
   const usage=error instanceof ModelAdapterError?error.knownUsage:undefined;
   const known=usage&&[usage.inputTokens,usage.outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)&&Number.isFinite(usage.cashCostCny)&&usage.cashCostCny>=0?usage:null;
   this.db.prepare("UPDATE tm2_model_calls SET state=?,error_class=?,input_tokens=?,output_tokens=?,cash_micros=?,completed_at=? WHERE id=? AND state='working'").run(kind==='unknown'?'unknown':'failed',kind,known?.inputTokens??null,known?.outputTokens??null,known?Math.round(known.cashCostCny*1000000):null,new Date().toISOString(),request.id);
   // Do not echo provider errors, prompts, credentials or stack traces to the author.
   // 白名单机器token（供应商code/参数名/请求ID）可并入diagnosticCode供离线诊断；供应商自由文本永不进入。
   const vendor=error instanceof ModelAdapterError?error.vendorDiagnostic:undefined;
   const vendorPart=vendor?`${vendor.code?`/vendor-${vendor.code}`:''}${vendor.param?`/param-${vendor.param}`:''}${vendor.requestId?`/req-${vendor.requestId}`:''}`:'';
   const diagnostic=error instanceof ModelAdapterError?`${error.failureClass}/http-${error.statusCode??'none'}/usage-${known?'known':'unavailable'}${vendorPart}`:undefined;
   throw new TimeMachineCallError(kind,kind==='unknown'?'模型结果需要核对，已保留调用记录':'本次成员调用未完成，已保留进度',diagnostic);
  }
 }
}
