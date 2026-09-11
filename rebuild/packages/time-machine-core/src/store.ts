import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {parseCandidate,parseManifest,parseScope,type Candidate,type Scope,type Manifest} from './contracts.js';
import {volumeDisplayCode,lineDisplayCode} from './numbering.js';
/** Independent SQL adapter. Host owns connection, access checks and migration lifecycle. */
export const schema = `
CREATE TABLE tm2_books(owner TEXT NOT NULL,book TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,manifest TEXT NOT NULL,adoption TEXT,PRIMARY KEY(owner,book)) STRICT;
CREATE TABLE tm2_candidates(owner TEXT NOT NULL,book TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(owner,book,id,revision),FOREIGN KEY(owner,book) REFERENCES tm2_books(owner,book)) STRICT;
CREATE TABLE tm2_reviews(owner TEXT NOT NULL,book TEXT NOT NULL,candidate TEXT NOT NULL,revision INTEGER NOT NULL,reviewer TEXT NOT NULL,verdict TEXT NOT NULL CHECK(verdict IN ('pass','revise')),PRIMARY KEY(owner,book,candidate,revision),FOREIGN KEY(owner,book,candidate,revision) REFERENCES tm2_candidates(owner,book,id,revision)) STRICT;
CREATE TABLE tm2_numbers(owner TEXT NOT NULL,book TEXT NOT NULL,kind TEXT NOT NULL,stable_id TEXT NOT NULL,number INTEGER NOT NULL CHECK(number>0),PRIMARY KEY(owner,book,kind,stable_id),UNIQUE(owner,book,kind,number),FOREIGN KEY(owner,book) REFERENCES tm2_books(owner,book)) STRICT;
CREATE TABLE tm2_adoptions(owner TEXT NOT NULL,book TEXT NOT NULL,id TEXT NOT NULL,candidate TEXT NOT NULL,candidate_revision INTEGER NOT NULL,revision INTEGER NOT NULL,mapping TEXT NOT NULL,PRIMARY KEY(owner,book,id),UNIQUE(owner,book,revision),FOREIGN KEY(owner,book,candidate,candidate_revision) REFERENCES tm2_candidates(owner,book,id,revision)) STRICT;
CREATE TABLE tm2_operations(owner TEXT NOT NULL,book TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(owner,book,operation,key),FOREIGN KEY(owner,book) REFERENCES tm2_books(owner,book)) STRICT;
CREATE TABLE tm2_outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,book TEXT NOT NULL,id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,body TEXT NOT NULL,FOREIGN KEY(owner,book) REFERENCES tm2_books(owner,book)) STRICT;
CREATE TABLE tm2_consumptions(owner TEXT NOT NULL,book TEXT NOT NULL,event TEXT NOT NULL,consumer TEXT NOT NULL,PRIMARY KEY(owner,book,event,consumer),FOREIGN KEY(event) REFERENCES tm2_outbox(id)) STRICT;
`;
function canonical(v:unknown):string {
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v!==null&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';
  return JSON.stringify(v);
}
export const digest=(v:unknown):string=>createHash('sha256').update(canonical(v)).digest('hex');
function manifestDigest(m:Manifest):string {return digest({...m,sources:[...m.sources].sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id))});}
export class Conflict extends Error {readonly status=409;constructor(message:string){super(message);this.name='Conflict';}}
interface BookRow {revision:number;manifest:string;adoption:string|null}
export interface Adoption {id:string;revision:number;mapping:Record<string,{id:string;number:number}>}
export class SqlPlanRepository {
  constructor(private readonly db:DatabaseSync) {}
  private tx<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  private book(s:Scope):BookRow {parseScope(s);const b=this.db.prepare('SELECT revision,manifest,adoption FROM tm2_books WHERE owner=? AND book=?').get(s.ownerId,s.bookId) as unknown as BookRow|undefined;if(!b)throw new Error('书籍未初始化或无权访问');return b;}
  /** Internal source adapter only. Changes invalidate adoption eligibility, never delete candidates. */
  syncManifest(s:Scope,value:unknown):void {parseScope(s);const m=parseManifest(value);this.db.prepare('INSERT INTO tm2_books(owner,book,manifest) VALUES(?,?,?) ON CONFLICT(owner,book) DO UPDATE SET manifest=excluded.manifest').run(s.ownerId,s.bookId,JSON.stringify(m));}
  state(s:Scope):{revision:number;adoption:string|null} {const b=this.book(s);return {revision:b.revision,adoption:b.adoption};}
  activePlan(s:Scope):{adoption:Adoption;candidate:Candidate}|null {
    const book=this.book(s);if(!book.adoption)return null;
    const row=this.db.prepare('SELECT candidate,candidate_revision,revision,mapping FROM tm2_adoptions WHERE owner=? AND book=? AND id=?').get(s.ownerId,s.bookId,book.adoption) as {candidate:string;candidate_revision:number;revision:number;mapping:string}|undefined;
    if(!row)throw new Conflict('采用记录不完整');
    const candidate=this.readCandidate(s,row.candidate,row.candidate_revision);if(!candidate)throw new Conflict('采用方案不存在');
    if(manifestDigest(candidate.manifest)!==manifestDigest(parseManifest(JSON.parse(book.manifest))))throw new Conflict('上游资料已变化，需要核对采用方案');
    return {adoption:{id:book.adoption,revision:row.revision,mapping:JSON.parse(row.mapping)},candidate};
  }
  saveCandidate(s:Scope,id:string,expectedRevision:number,value:unknown):number {
    const candidate=parseCandidate(value);if(!/^[\w.:-]{1,160}$/u.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('候选修订参数错误');
    return this.tx(()=>{this.book(s);const row=this.db.prepare('SELECT MAX(revision) AS revision FROM tm2_candidates WHERE owner=? AND book=? AND id=?').get(s.ownerId,s.bookId,id) as {revision:number|null};if((row.revision??0)!==expectedRevision)throw new Conflict('候选已被修改');
      const next=expectedRevision+1;this.db.prepare('INSERT INTO tm2_candidates VALUES(?,?,?,?,?,?)').run(s.ownerId,s.bookId,id,next,JSON.stringify(candidate),digest(candidate));return next;});
  }
  readCandidate(s:Scope,id:string,revision:number):Candidate|null {this.book(s);const row=this.db.prepare('SELECT body FROM tm2_candidates WHERE owner=? AND book=? AND id=? AND revision=?').get(s.ownerId,s.bookId,id,revision) as {body:string}|undefined;return row?parseCandidate(JSON.parse(row.body)):null;}
  /** Trusted reviewer application port, never bound directly to an author endpoint. */
  review(s:Scope,id:string,revision:number,reviewer:string,verdict:'pass'|'revise'):void {
    if(!reviewer.trim()||!['pass','revise'].includes(verdict))throw new Error('审查参数错误');this.book(s);
    this.db.prepare('INSERT INTO tm2_reviews VALUES(?,?,?,?,?,?)').run(s.ownerId,s.bookId,id,revision,reviewer,verdict);
  }
  adopt(s:Scope,id:string,candidateRevision:number,expectedRevision:number,key:string):Adoption {
    if(!key.trim()||key.length>160||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('采用参数错误');
    const requestHash=digest({id,candidateRevision,expectedRevision});
    return this.tx(()=>{
      const book=this.book(s);
      const previous=this.db.prepare("SELECT request_hash,response FROM tm2_operations WHERE owner=? AND book=? AND operation='adopt' AND key=?").get(s.ownerId,s.bookId,key) as {request_hash:string;response:string}|undefined;
      if(previous){if(previous.request_hash!==requestHash)throw new Conflict('幂等键不能用于不同请求');return JSON.parse(previous.response) as Adoption;}
      if(book.revision!==expectedRevision)throw new Conflict('采用版本已变化');
      const candidate=this.readCandidate(s,id,candidateRevision);if(!candidate)throw new Error('候选不存在');
      const review=this.db.prepare('SELECT verdict FROM tm2_reviews WHERE owner=? AND book=? AND candidate=? AND revision=?').get(s.ownerId,s.bookId,id,candidateRevision) as {verdict:string}|undefined;
      if(review?.verdict!=='pass')throw new Conflict('候选尚未通过核查');
      if(manifestDigest(candidate.manifest)!==manifestDigest(parseManifest(JSON.parse(book.manifest))))throw new Conflict('来源已变化，需要核对后形成新修订');
      const mapping:Adoption['mapping']={};
      // Same candidate revisions preserve identity; another candidate owns a separate local namespace.
      // v1 keeps the shared integer line sequence readable; v2 allocates 卷/主线/支线 as独立书内序列（第23.2节）。
      const allocations:readonly [string,readonly {id:string}[]][]=candidate.schemaVersion===1
        ? [['line',candidate.plan.lines],['expectation',candidate.plan.expectations]]
        : [['volume',candidate.plan.volumes],['main-line',candidate.plan.lines.filter(l=>l.role==='main')],['branch-line',candidate.plan.lines.filter(l=>l.role!=='main')],['expectation',candidate.plan.expectations]];
      for(const [kind,items] of allocations)for(const item of items){
        const stableId=digest({owner:s.ownerId,book:s.bookId,candidate:id,kind,local:item.id});
        let number=(this.db.prepare('SELECT number FROM tm2_numbers WHERE owner=? AND book=? AND kind=? AND stable_id=?').get(s.ownerId,s.bookId,kind,stableId) as {number:number}|undefined)?.number;
        if(number===undefined){const max=this.db.prepare('SELECT COALESCE(MAX(number),0) AS n FROM tm2_numbers WHERE owner=? AND book=? AND kind=?').get(s.ownerId,s.bookId,kind) as {n:number};number=max.n+1;this.db.prepare('INSERT INTO tm2_numbers VALUES(?,?,?,?,?)').run(s.ownerId,s.bookId,kind,stableId,number);}
        mapping[`${kind}:${item.id}`]={id:stableId,number};
      }
      const result:Adoption={id:randomUUID(),revision:book.revision+1,mapping};
      const numbering=candidate.schemaVersion===2
        ? {volumeCodes:candidate.plan.volumes.map(v=>({localId:v.id,code:volumeDisplayCode(mapping[`volume:${v.id}`]!.number)})),mainLines:candidate.plan.lines.filter(l=>l.role==='main').map(l=>lineDisplayCode('main',mapping[`main-line:${l.id}`]!.number)),branchLines:candidate.plan.lines.filter(l=>l.role!=='main').map(l=>lineDisplayCode('branch',mapping[`branch-line:${l.id}`]!.number))}
        : null;
      this.db.prepare('INSERT INTO tm2_adoptions VALUES(?,?,?,?,?,?,?)').run(s.ownerId,s.bookId,result.id,id,candidateRevision,result.revision,JSON.stringify(mapping));
      this.db.prepare('UPDATE tm2_books SET revision=?,adoption=? WHERE owner=? AND book=?').run(result.revision,result.id,s.ownerId,s.bookId);
      this.db.prepare("INSERT INTO tm2_operations VALUES(?,?,'adopt',?,?,?)").run(s.ownerId,s.bookId,key,requestHash,JSON.stringify(result));
      this.db.prepare("INSERT INTO tm2_outbox(owner,book,id,kind,body) VALUES(?,?,?,'plan.adopted',?)").run(s.ownerId,s.bookId,randomUUID(),JSON.stringify({adoptionId:result.id,revision:result.revision,schemaVersion:candidate.schemaVersion,numbering}));return result;
    });
  }
  events(s:Scope,after=0):{sequence:number;id:string;kind:string;body:string}[] {this.book(s);if(!Number.isSafeInteger(after)||after<0)throw new Error('游标错误');return this.db.prepare('SELECT sequence,id,kind,body FROM tm2_outbox WHERE owner=? AND book=? AND sequence>? ORDER BY sequence LIMIT 100').all(s.ownerId,s.bookId,after) as unknown as {sequence:number;id:string;kind:string;body:string}[];}
  acknowledge(s:Scope,eventId:string,consumer:string):void {this.book(s);if(!consumer.trim())throw new Error('缺少消费者');const event=this.db.prepare('SELECT id FROM tm2_outbox WHERE owner=? AND book=? AND id=?').get(s.ownerId,s.bookId,eventId);if(!event)throw new Error('事件不属于当前书籍');this.db.prepare('INSERT OR IGNORE INTO tm2_consumptions VALUES(?,?,?,?)').run(s.ownerId,s.bookId,eventId,consumer);}
}
