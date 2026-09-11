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
export interface CandidateV1 { schemaVersion: 1; manifest: Manifest; member: Member; plan: Blueprint }
/** v2字数预算：target为计划值；min/max为可选范围；hard=作者明确硬要求（常规"约N万字"为软目标）；policy=与作者正文统计同一字数口径版本。 */
export interface WordBudget { target: number; min: number|null; max: number|null; hard: boolean; policy: string }
/** 锚点原子条件：自然语言条件由成员理解核对，subjectIds只引用候选内故事线，不写关键词正则充当结算。 */
export interface AnchorCondition { summary: string; subjectIds: string[] }
export interface Anchor { id: string; ownerEntityId: string; kind: 'entry'|'exit'|'milestone'; summary: string; span: string; conditions: AnchorCondition[]; logic: 'all'|'any'|'ordered'; importance: 'required'|'flexible'; fallback: string; keywords: string[]; aliases: string[] }
/** 主支线关键落点：suggestedVolumes引用候选内卷ID，表示建议卷或卷区间；只有作者明确要求等标required。 */
export interface LineMilestone { id: string; summary: string; suggestedVolumes: string[]; importance: 'required'|'flexible' }
export interface LineV2 { id: string; role: 'main'|'through'|'stage'; title: string; goal: string; answer: string; process: string; parentIds: string[]; milestones: LineMilestone[] }
export interface DutyV2 { lineId: string; action: 'start'|'advance'|'pause'|'close'; result: string; anchorIds: string[]; strength: 'required'|'flexible'; reason: string }
export interface VolumeV2 { id: string; title: string; beat: string; start: string; goal: string; conflict: string; turningPoint: string; gain: string|null; loss: string|null; arc: string|null; payoff: string|null; hook: string|null; mood: string|null; ending: string; handoff: string; words: WordBudget; duties: DutyV2[] }
export interface BlueprintV2 { baseline: string; ending: string; words: WordBudget; lines: LineV2[]; expectations: Expectation[]; relations: Relation[]; anchors: Anchor[]; volumes: VolumeV2[] }
export interface CandidateV2 { schemaVersion: 2; manifest: Manifest; member: Member; plan: BlueprintV2 }
export type Candidate = CandidateV1 | CandidateV2
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
function nullableText(v: unknown, max = 2000): string|null { return v === null ? null : text(v, max); }
function id(v: unknown): string { const s = text(v, 160); if (!/^[\w.:-]+$/u.test(s)) throw new ContractError('ID格式错误'); return s; }
function list<T>(v: unknown, parse: (x: unknown) => T, max = 500): T[] {
  if (!Array.isArray(v) || v.length > max) throw new ContractError('列表格式或大小错误');
  return v.map(parse);
}
function choice<T extends string>(v: unknown, values: readonly T[]): T { if (!values.includes(v as T)) throw new ContractError('未知枚举'); return v as T; }
function unique(values: string[]): void { if (new Set(values).size !== values.length) throw new ContractError('标识重复'); }
function words(v: unknown): WordBudget {
  const o = object(v, ['target','min','max','hard','policy']);
  const target = o.target, min = o.min, max = o.max;
  if (typeof target !== 'number' || !Number.isSafeInteger(target) || target < 1) throw new ContractError('字数target无效');
  if (min !== null && (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 1 || min > target)) throw new ContractError('字数min无效');
  if (max !== null && (typeof max !== 'number' || !Number.isSafeInteger(max) || max < target)) throw new ContractError('字数max无效');
  if (typeof o.hard !== 'boolean') throw new ContractError('字数硬性标记无效');
  return {target, min, max, hard: o.hard, policy: id(o.policy)};
}
function anchors(v: unknown, volumeIds: Set<string>, lineIds: Set<string>): Anchor[] {
  const parsed = list(v, x => {
    const a = object(x, ['id','ownerEntityId','kind','summary','span','conditions','logic','importance','fallback','keywords','aliases']);
    const owner = id(a.ownerEntityId);
    if (!volumeIds.has(owner) && !lineIds.has(owner)) throw new ContractError('锚点归属对象不存在');
    const conditions = list(a.conditions, c => {
      const b = object(c, ['summary','subjectIds']);
      const subjectIds = list(b.subjectIds, s => { const key = id(s); if (!lineIds.has(key)) throw new ContractError('锚点条件主体不存在'); return key; });
      return {summary: text(b.summary, 500), subjectIds};
    }, 12);
    if (!conditions.length) throw new ContractError('锚点缺少可核对条件');
    const terms = (t: unknown) => list(t, x => text(x, 40), 12);
    return {id: id(a.id), ownerEntityId: owner, kind: choice(a.kind, ['entry','exit','milestone']), summary: text(a.summary, 300), span: text(a.span, 120), conditions, logic: choice(a.logic, ['all','any','ordered']), importance: choice(a.importance, ['required','flexible']), fallback: text(a.fallback, 500), keywords: terms(a.keywords), aliases: terms(a.aliases)};
  }, 500);
  unique(parsed.map(a => a.id));
  return parsed;
}
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
function parseMember(v: unknown): Member { const m = object(v, ['id','name','model','routeRevision']); return {id:id(m.id),name:text(m.name,120),model:id(m.model),routeRevision:id(m.routeRevision)}; }
function parseExpectations(v: unknown, ref: (v:unknown)=>string): Expectation[] {
  const expectations = list(v, x => {const a=object(x,['id','opening','answer','lineIds']);const lineIds=list(a.lineIds,ref);unique(lineIds);if(!lineIds.length)throw new ContractError('期待未关联故事线');return {id:id(a.id),opening:text(a.opening),answer:text(a.answer),lineIds};});
  unique(expectations.map(e=>e.id));
  return expectations;
}
function parseRelations(v: unknown, ref: (v:unknown)=>string): Relation[] {
  return list(v, x=>{const a=object(x,['from','to','kind','effect']);const from=ref(a.from),to=ref(a.to);if(from===to)throw new ContractError('关系不能指向自身');return {from,to,kind:choice(a.kind,['push','conflict','reveal','meet']),effect:text(a.effect)};});
}
export function parseCandidate(v: unknown): Candidate {
  const c = object(v, ['schemaVersion','manifest','member','plan']);
  const member = parseMember(c.member);
  if (c.schemaVersion === 1) {
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
    const expectations=parseExpectations(p.expectations,ref);
    const relations=parseRelations(p.relations,ref);
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
    return {schemaVersion:1,manifest:parseManifest(c.manifest),member,plan:{baseline:text(p.baseline),ending:text(p.ending),lines,expectations,relations,volumes}};
  }
  if (c.schemaVersion === 2) {
    const p = object(c.plan, ['baseline','ending','words','lines','expectations','relations','anchors','volumes']);
    const bookWords = words(p.words);
    const volumes=list(p.volumes,x=>{
      const a=object(x,['id','title','beat','start','goal','conflict','turningPoint','gain','loss','arc','payoff','hook','mood','ending','handoff','words','duties']);
      if(typeof a.handoff!=='string'||a.handoff.length>2000)throw new ContractError('交接字段错误');
      const duties=list(a.duties,d=>{const b=object(d,['lineId','action','result','anchorIds','strength','reason']);return {lineId:String(b.lineId),action:choice(b.action,['start','advance','pause','close']),result:text(b.result),anchorIds:list(b.anchorIds,id),strength:choice(b.strength,['required','flexible']),reason:text(b.reason,500)};});
      unique(duties.map(d=>d.lineId));
      return {id:id(a.id),title:text(a.title,120),beat:text(a.beat,60),start:text(a.start),goal:text(a.goal),conflict:text(a.conflict),turningPoint:text(a.turningPoint),gain:nullableText(a.gain),loss:nullableText(a.loss),arc:nullableText(a.arc),payoff:nullableText(a.payoff),hook:nullableText(a.hook),mood:nullableText(a.mood),ending:text(a.ending),handoff:a.handoff,words:words(a.words),duties};
    }, 100);
    unique(volumes.map(v=>v.id));
    const volumeIds=new Set(volumes.map(v=>v.id));
    const lines=list(p.lines, x => {const a=object(x,['id','role','title','goal','answer','process','parentIds','milestones']);const milestones=list(a.milestones,m=>{const b=object(m,['id','summary','suggestedVolumes','importance']);const suggested=list(b.suggestedVolumes,s=>{const key=id(s);if(!volumeIds.has(key))throw new ContractError('关键落点建议卷不存在');return key;});if(!suggested.length)throw new ContractError('关键落点缺少建议卷');unique(suggested);return {id:id(b.id),summary:text(b.summary,300),suggestedVolumes:suggested,importance:choice(b.importance,['required','flexible'])};},20);unique(milestones.map(m=>m.id));return {id:id(a.id),role:choice(a.role,['main','through','stage']),title:text(a.title,120),goal:text(a.goal),answer:text(a.answer),process:text(a.process),parentIds:list(a.parentIds,id),milestones};});
    unique(lines.map(l=>l.id));
    if (!lines.some(l=>l.role==='main')) throw new ContractError('缺少主线');
    const ids = new Set(lines.map(l=>l.id));
    const ref=(v:unknown) => {const key=id(v);if(!ids.has(key))throw new ContractError('故事线引用不存在');return key;};
    for (const l of lines) { unique(l.parentIds); l.parentIds.forEach(ref); }
    const done=new Set<string>(), visiting=new Set<string>();
    const visit=(key:string):void=> {if(visiting.has(key))throw new ContractError('包含关系循环');if(done.has(key))return;visiting.add(key);lines.find(l=>l.id===key)!.parentIds.forEach(visit);visiting.delete(key);done.add(key);};
    lines.forEach(l=>visit(l.id));
    for(const volume of volumes)for(const duty of volume.duties)duty.lineId=ref(duty.lineId);
    const expectations=parseExpectations(p.expectations,ref);
    const relations=parseRelations(p.relations,ref);
    const anchorList=anchors(p.anchors,volumeIds,ids);
    const anchorIds=new Set(anchorList.map(a=>a.id));
    for(const volume of volumes)for(const duty of volume.duties){unique(duty.anchorIds);for(const anchorId of duty.anchorIds)if(!anchorIds.has(anchorId))throw new ContractError('卷职责关联锚点不存在');}
    if(!volumes.length||volumes.at(-1)!.handoff!=='')throw new ContractError('最终卷必须结束全书，不接下一卷');
    if(volumes.slice(0,-1).some(v=>!v.handoff.trim()))throw new ContractError('非终卷缺少后续交接');
    for(const l of lines)if(!volumes.some(v=>v.duties.some(d=>d.lineId===l.id)))throw new ContractError('故事线没有卷职责');
    for(const volume of volumes){
      const owned=anchorList.filter(a=>a.ownerEntityId===volume.id);
      if(owned.filter(a=>a.kind==='entry').length!==1||owned.filter(a=>a.kind==='exit').length!==1)throw new ContractError('每卷必须恰好一个开场锚点和一个收束锚点');
    }
    const total=volumes.reduce((sum,v)=>sum+v.words.target,0);
    if(total!==bookWords.target)throw new ContractError('分卷字数合计与全书预算不一致，需要成员重新分配或提出新预算版本');
    return {schemaVersion:2,manifest:parseManifest(c.manifest),member,plan:{baseline:text(p.baseline),ending:text(p.ending),words:bookWords,lines,expectations,relations,anchors:anchorList,volumes}};
  }
  throw new ContractError('不支持的协议版本');
}
