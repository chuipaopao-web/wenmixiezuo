/** Runtime contracts for the new engine. Inputs are data, never executable instructions. */
export interface Scope { ownerId: string; bookId: string }
export interface SourceRef { kind: 'opening'|'setting'|'intent'|'manuscript'|'asset'; id: string; revision: string; hash: string }
export interface Manifest { sources: SourceRef[]; templateRevision: string; redactionRevision: string }
export interface Member { id: string; name: string; model: string; routeRevision: string }
export interface Line { id: string; role: 'main'|'through'|'stage'; title: string; goal: string; answer: string; parentIds: string[] }
export interface Expectation { id: string; opening: string; answer: string; lineIds: string[] }
export interface Relation { from: string; to: string; kind: 'push'|'conflict'|'reveal'|'meet'; effect: string }
export interface Volume { id: string; title: string; start: string; goal: string; conflict: string; turningPoint: string; gain: string; loss: string; ending: string; handoff: string; duties: {lineId: string; action: 'start'|'advance'|'pause'|'close'; result: string}[] }
export interface Blueprint { baseline: string; ending: string; lines: Line[]; expectations: Expectation[]; relations: Relation[]; volumes: Volume[] }
export interface Candidate { schemaVersion: 1; manifest: Manifest; member: Member; plan: Blueprint }
export class ContractError extends Error { constructor(message: string) { super(message); this.name = 'ContractError'; } }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('对象格式错误');
  const o = value as Record<string, unknown>;
  if (Object.keys(o).some(k => !keys.includes(k)) || keys.some(k => !(k in o))) throw new ContractError('字段缺失或未知字段');
  return o;
}
function text(v: unknown, max = 2000): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new ContractError('文本为空或超过字段预算');
  return v;
}
function id(v: unknown): string { const s = text(v, 160); if (!/^[\w.:-]+$/u.test(s)) throw new ContractError('ID格式错误'); return s; }
function list<T>(v: unknown, parse: (x: unknown) => T, max = 500): T[] {
  if (!Array.isArray(v) || v.length > max) throw new ContractError('列表格式或大小错误');
  return v.map(parse);
}
function choice<T extends string>(v: unknown, values: readonly T[]): T { if (!values.includes(v as T)) throw new ContractError('未知枚举'); return v as T; }
function unique(values: string[]): void { if (new Set(values).size !== values.length) throw new ContractError('标识重复'); }
export function parseScope(v: unknown): Scope { const o = object(v, ['ownerId','bookId']); return {ownerId:id(o.ownerId),bookId:id(o.bookId)}; }
export function parseManifest(v: unknown): Manifest {
  const o = object(v, ['sources','templateRevision','redactionRevision']);
  const sources = list(o.sources, x => {
    const s = object(x, ['kind','id','revision','hash']);
    const hash = text(s.hash, 64); if (!/^[a-f0-9]{64}$/u.test(hash)) throw new ContractError('来源hash错误');
    return {kind:choice(s.kind,['opening','setting','intent','manuscript','asset']), id:id(s.id), revision:id(s.revision), hash};
  }, 2000);
  unique(sources.map(s => `${s.kind}:${s.id}`));
  if (!sources.some(s=>s.kind==='opening') || !sources.some(s=>s.kind==='intent')) throw new ContractError('缺少开书或作者意图来源');
  return {sources,templateRevision:id(o.templateRevision),redactionRevision:id(o.redactionRevision)};
}
export function parseCandidate(v: unknown): Candidate {
  const c = object(v, ['schemaVersion','manifest','member','plan']);
  if (c.schemaVersion !== 1) throw new ContractError('不支持的协议版本');
  const m = object(c.member, ['id','name','model','routeRevision']);
  const p = object(c.plan, ['baseline','ending','lines','expectations','relations','volumes']);
  const lines = list(p.lines, x => {const a=object(x,['id','role','title','goal','answer','parentIds']);return {id:id(a.id),role:choice(a.role,['main','through','stage']),title:text(a.title,120),goal:text(a.goal),answer:text(a.answer),parentIds:list(a.parentIds,id)};});
  unique(lines.map(l=>l.id));
  if (!lines.some(l=>l.role==='main')) throw new ContractError('缺少主线');
  const ids = new Set(lines.map(l=>l.id));
  const ref=(v:unknown) => {const key=id(v);if(!ids.has(key))throw new ContractError('故事线引用不存在');return key;};
  for (const l of lines) { unique(l.parentIds); l.parentIds.forEach(ref); }
  const done=new Set<string>(), visiting=new Set<string>();
  const visit=(key:string):void=> {if(visiting.has(key))throw new ContractError('包含关系循环');if(done.has(key))return;visiting.add(key);lines.find(l=>l.id===key)!.parentIds.forEach(visit);visiting.delete(key);done.add(key);};
  lines.forEach(l=>visit(l.id));
  const expectations=list(p.expectations,x=>{const a=object(x,['id','opening','answer','lineIds']);const lineIds=list(a.lineIds,ref);unique(lineIds);if(!lineIds.length)throw new ContractError('期待未关联故事线');return {id:id(a.id),opening:text(a.opening),answer:text(a.answer),lineIds};});
  unique(expectations.map(e=>e.id));
  const relations=list(p.relations,x=>{const a=object(x,['from','to','kind','effect']);const from=ref(a.from),to=ref(a.to);if(from===to)throw new ContractError('关系不能指向自身');return {from,to,kind:choice(a.kind,['push','conflict','reveal','meet']),effect:text(a.effect)};});
  const volumes=list(p.volumes,x=>{
    const a=object(x,['id','title','start','goal','conflict','turningPoint','gain','loss','ending','handoff','duties']);
    if(typeof a.handoff!=='string'||a.handoff.length>2000)throw new ContractError('交接字段错误');
    const duties=list(a.duties,d=>{const b=object(d,['lineId','action','result']);return {lineId:ref(b.lineId),action:choice(b.action,['start','advance','pause','close']),result:text(b.result)};});
    unique(duties.map(d=>d.lineId));
    return {id:id(a.id),title:text(a.title,120),start:text(a.start),goal:text(a.goal),conflict:text(a.conflict),turningPoint:text(a.turningPoint),gain:text(a.gain),loss:text(a.loss),ending:text(a.ending),handoff:a.handoff,duties};
  }, 100);
  unique(volumes.map(v=>v.id));
  if(!volumes.length||volumes.at(-1)!.handoff!=='')throw new ContractError('最终卷必须结束全书，不接下一卷');
  if(volumes.slice(0,-1).some(v=>!v.handoff.trim()))throw new ContractError('非终卷缺少后续交接');
  for(const l of lines)if(!volumes.some(v=>v.duties.some(d=>d.lineId===l.id)))throw new ContractError('故事线没有卷职责');
  return {schemaVersion:1,manifest:parseManifest(c.manifest),member:{id:id(m.id),name:text(m.name,120),model:id(m.model),routeRevision:id(m.routeRevision)},plan:{baseline:text(p.baseline),ending:text(p.ending),lines,expectations,relations,volumes}};
}
