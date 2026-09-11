import {afterEach,describe,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {parseCandidate,type CandidateV2} from '../../rebuild/packages/time-machine-core/src/contracts.js';
import {schema,SqlPlanRepository} from '../../rebuild/packages/time-machine-core/src/store.js';
import {volumeDisplayCode,lineDisplayCode,chainDisplayCode,chapterDisplayCode,volumeNumberFromDisplayCode} from '../../rebuild/packages/time-machine-core/src/numbering.js';
import {volumePlanningContext} from '../../rebuild/packages/time-machine-core/src/volume-context.js';
const scope={ownerId:'alice',bookId:'book'};
function sample():CandidateV2 {return {schemaVersion:2,manifest:{sources:[{kind:'opening',id:'opening',revision:'v1',hash:'a'.repeat(64)},{kind:'intent',id:'intent',revision:'v1',hash:'b'.repeat(64)}],templateRevision:'v1',redactionRevision:'v1'},member:{id:'writer',name:'编剧',model:'model',routeRevision:'route1'},plan:{baseline:'无灵根修理工争取立足',ending:'工坊建立',openingHooks:['危机开场即入戏','第一章结束时读者想知道订单能否完成','前三章建立无灵根者靠机甲立足的最大期待'],words:{target:200000,min:160000,max:240000,hard:false,policy:'chars-v1'},lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'能否建立工坊',process:'从接单修理到建立工坊',parentIds:[],milestones:[{id:'ms1',summary:'第一台自装机甲完成',suggestedVolumes:['v1'],importance:'flexible'}]},{id:'sub',role:'through',title:'伙伴',goal:'信任',answer:'互相信任',process:'从戒备到并肩',parentIds:[],milestones:[]}],expectations:[{id:'promise',opening:'没有灵根能否立足',change:'看到技术与伙伴替代灵根',answer:'以机甲建立工坊',lineIds:['main']}],relations:[],anchors:[{id:'v1-in',ownerEntityId:'v1',kind:'entry',summary:'店铺濒临倒闭',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成则本卷起点不成立，需要修订开场',keywords:['倒闭'],aliases:[]},{id:'v1-out',ownerEntityId:'v1',kind:'exit',summary:'订单交付并立足',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']},{summary:'工坊具备继续经营条件',subjectIds:[]}],logic:'all',importance:'required',fallback:'未达成由后卷承接并说明',keywords:[],aliases:['交付']},{id:'v2-in',ownerEntityId:'v2',kind:'entry',summary:'工坊扩张起点',span:'本卷开篇',conditions:[{summary:'承接上卷交付结果',subjectIds:['main']}],logic:'all',importance:'required',fallback:'缺前置则先补承接设计',keywords:[],aliases:[]},{id:'v2-out',ownerEntityId:'v2',kind:'exit',summary:'新市场立足',span:'本卷收束',conditions:[{summary:'新市场订单成立',subjectIds:['sub']}],logic:'all',importance:'required',fallback:'全书结束，未兑现伏笔单独跟踪',keywords:[],aliases:[]}],volumes:[{id:'v1',title:'开张',start:'店铺将倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'新机甲成功',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'订单交付',handoff:'引出扩张',words:{target:100000,min:80000,max:120000,hard:false,policy:'chars-v1'},duties:[{lineId:'main',action:'close',result:'工坊成立',anchorIds:['v1-out'],strength:'required',reason:'全书主线必须在此起步'}]},{id:'v2',title:'扩张',start:'工坊起步',goal:'打开新市场',conflict:'竞争',beat:'起',turningPoint:'联合取胜',gain:null,loss:null,arc:'主角从修理者转为组织者',payoff:'兑现没有灵根也能立足',hook:null,mood:null,ending:'新市场立足',handoff:'',words:{target:100000,min:80000,max:120000,hard:false,policy:'chars-v1'},duties:[{lineId:'sub',action:'advance',result:'信任加深',anchorIds:[],strength:'flexible',reason:'可在后卷补足，不阻塞本卷'}]}]}};}
const databases:DatabaseSync[]=[];
afterEach(()=>{databases.splice(0).forEach(d=>d.close());});
function setup(){const db=new DatabaseSync(':memory:');databases.push(db);db.exec('PRAGMA foreign_keys=ON');db.exec(schema);const repo=new SqlPlanRepository(db);repo.syncManifest(scope,sample().manifest);return {db,repo};}
describe('第23.2节编号显示',()=>{
 it('分配卷A…Z、AA大写字母并可与编号互解',()=>{
  expect(volumeDisplayCode(1)).toBe('A');expect(volumeDisplayCode(26)).toBe('Z');expect(volumeDisplayCode(27)).toBe('AA');expect(volumeDisplayCode(28)).toBe('AB');expect(volumeDisplayCode(52)).toBe('AZ');expect(volumeDisplayCode(53)).toBe('BA');
  for(const n of [1,26,27,28,100,703])expect(volumeNumberFromDisplayCode(volumeDisplayCode(n))).toBe(n);
  expect(()=>volumeDisplayCode(0)).toThrow();expect(()=>volumeDisplayCode(1.5)).toThrow();expect(()=>volumeNumberFromDisplayCode('a')).toThrow();expect(()=>volumeNumberFromDisplayCode('A1')).toThrow();
 });
 it('主线/支线独立序列，链章只定义未来显示合同',()=>{
  expect(lineDisplayCode('main',1)).toBe('主线1');expect(lineDisplayCode('branch',3)).toBe('支线3');expect(()=>lineDisplayCode('main',0)).toThrow();
  expect(chainDisplayCode('A',1)).toBe('链A1');expect(chainDisplayCode('AB',13)).toBe('链AB13');expect(()=>chainDisplayCode('a',1)).toThrow();
  expect(chapterDisplayCode(115)).toBe('章115');expect(chapterDisplayCode(1)).toBe('章1');expect(()=>chapterDisplayCode(0)).toThrow();
 });
});
describe('v2协议校验（第23.3—23.5节）',()=>{
 it('接受完整v2方案：字数范围、可空得失、锚点条件与关键落点',()=>{
  const parsed=parseCandidate(sample());
  expect(parsed.schemaVersion).toBe(2);
  if(parsed.schemaVersion!==2)throw Error('unreachable');
  expect(parsed.plan.volumes[0]!.loss).toBeNull();expect(parsed.plan.volumes[1]!.gain).toBeNull();expect(parsed.plan.volumes[1]!.arc).toBe('主角从修理者转为组织者');
  expect(parsed.plan.lines[0]!.milestones[0]!.suggestedVolumes).toEqual(['v1']);
  expect(parsed.plan.anchors[1]!.conditions).toHaveLength(2);
 });
 it('分卷字数合计必须与全书预算一致，不能靠系统凑数',()=>{
  const a=sample();a.plan.volumes[1]!.words.target=100001;expect(()=>parseCandidate(a)).toThrow('分卷字数合计');
  const b=sample();b.plan.words={target:300000,min:null,max:null,hard:true,policy:'chars-v1'};expect(()=>parseCandidate(b)).toThrow('分卷字数合计');
 });
 it('拒绝无效字数范围与未知字段',()=>{
  const a=sample();a.plan.words={target:200000,min:250000,max:null,hard:false,policy:'chars-v1'};expect(()=>parseCandidate(a)).toThrow('字数min');
  const b=sample();b.plan.volumes[0]!.words={target:100000,min:1,max:99999,hard:false,policy:'chars-v1'};expect(()=>parseCandidate(b)).toThrow('字数max');
  const c=sample();(c.plan as unknown as Record<string,unknown>).extra='x';expect(()=>parseCandidate(c)).toThrow('字段');
  const d=sample();d.schemaVersion=3 as never;expect(()=>parseCandidate(d)).toThrow('协议版本');
  const e=sample();e.plan.words={target:0,min:null,max:null,hard:false,policy:'chars-v1'};expect(()=>parseCandidate(e)).toThrow('target');
 });
 it('每卷必须恰好一个开场和一个收束锚点，归属与条件主体可核对',()=>{
  const a=structuredClone(sample());a.plan.anchors.splice(2,1);expect(()=>parseCandidate(a)).toThrow('开场锚点');
  const b=structuredClone(sample());b.plan.anchors.push({...b.plan.anchors[0]!,id:'v1-in-2'});expect(()=>parseCandidate(b)).toThrow('开场锚点');
  const c=structuredClone(sample());c.plan.anchors[0]!.ownerEntityId='ghost';expect(()=>parseCandidate(c)).toThrow('锚点归属');
  const d=structuredClone(sample());d.plan.anchors[0]!.conditions[0]!.subjectIds=['ghost'];expect(()=>parseCandidate(d)).toThrow('条件主体');
  const e=structuredClone(sample());e.plan.anchors[0]!.conditions=[];expect(()=>parseCandidate(e)).toThrow('锚点缺少');
  const f=structuredClone(sample());f.plan.volumes[0]!.duties[0]!.anchorIds=['ghost'];expect(()=>parseCandidate(f)).toThrow('关联锚点');
 });
 it('关键落点必须指向存在的建议卷',()=>{
  const a=structuredClone(sample());a.plan.lines[0]!.milestones[0]!.suggestedVolumes=['vx'];expect(()=>parseCandidate(a)).toThrow('建议卷');
  const b=structuredClone(sample());b.plan.lines[0]!.milestones[0]!.suggestedVolumes=[];expect(()=>parseCandidate(b)).toThrow('建议卷');
 });
 it('v1旧候选仍按旧版本完整读取，不补空字段冒充新设计',()=>{
  const legacy={schemaVersion:1,manifest:sample().manifest,member:sample().member,plan:{baseline:'基线',ending:'结局',lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'能否建立工坊',parentIds:[]}],expectations:[{id:'promise',opening:'开篇',answer:'回答',lineIds:['main']}],relations:[],volumes:[{id:'v1',title:'开张',start:'起点',goal:'目标',conflict:'阻碍',turningPoint:'转折',gain:'获得',loss:'失去',ending:'结束',handoff:'',duties:[{lineId:'main',action:'close',result:'工坊成立'}]}]}};
  const parsed=parseCandidate(legacy);
  expect(parsed.schemaVersion).toBe(1);
  if(parsed.schemaVersion!==1)throw Error('unreachable');
  expect(parsed.plan.volumes[0]!.gain).toBe('获得');
 });
});
describe('v2采用事务与编号分配（第23.2节）',()=>{
 function ready(repo:SqlPlanRepository){const revision=repo.saveCandidate(scope,'candidate',0,sample());repo.review(scope,'candidate',revision,'reviewer','pass');}
 it('采用v2时分配卷A/B、主线1与支线1独立序列并写入事件',()=>{
  const {db,repo}=setup();ready(repo);
  const adoption=repo.adopt(scope,'candidate',1,0,'one');
  expect(adoption.mapping['volume:v1']).toMatchObject({number:1});expect(adoption.mapping['volume:v2']).toMatchObject({number:2});
  expect(adoption.mapping['main-line:main']).toMatchObject({number:1});expect(adoption.mapping['branch-line:sub']).toMatchObject({number:1});
  expect(adoption.mapping['expectation:promise']).toMatchObject({number:1});
  expect(adoption.mapping['line:main']).toBeUndefined();
  const kinds=db.prepare('SELECT kind,COUNT(*) n FROM tm2_numbers GROUP BY kind ORDER BY kind').all();
  expect(kinds).toEqual([{kind:'branch-line',n:1},{kind:'expectation',n:1},{kind:'main-line',n:1},{kind:'volume',n:2}]);
  const event=JSON.parse(repo.events(scope)[0]!.body);
  expect(event.schemaVersion).toBe(2);expect(event.numbering.volumeCodes).toEqual([{localId:'v1',code:'A'},{localId:'v2',code:'B'}]);
  expect(event.numbering.mainLines).toEqual(['主线1']);expect(event.numbering.branchLines).toEqual(['支线1']);
  expect(repo.adopt(scope,'candidate',1,0,'one')).toEqual(adoption);
 });
 it('同候选新修订重用既有编号；跨书不可见',()=>{
  const {repo}=setup();ready(repo);
  const first=repo.adopt(scope,'candidate',1,0,'one');
  const second=repo.saveCandidate(scope,'candidate',1,sample());repo.review(scope,'candidate',second,'reviewer','pass');
  const again=repo.adopt(scope,'candidate',2,1,'second');
  expect(again.mapping).toEqual(first.mapping);
  const other={...scope,bookId:'other'};repo.syncManifest(other,sample().manifest);
  expect(repo.readCandidate(other,'candidate',1)).toBeNull();expect(()=>repo.adopt(other,'candidate',1,0,'x')).toThrow('不存在');
 });
});
describe('v2按卷供给（第23.12节阶段一第5条）',()=>{
 it('输出本卷显示号、字数、锚点、职责强度，并明确上卷实际结束卡未提供',()=>{
  const {repo}=setup();const revision=repo.saveCandidate(scope,'candidate',0,sample());repo.review(scope,'candidate',revision,'reviewer','pass');repo.adopt(scope,'candidate',revision,0,'adopt');
  const active=repo.activePlan(scope)!;
  const counter={id:'utf8',mode:'conservative' as const,count:(s:string)=>Buffer.byteLength(s)};
  const packet=volumePlanningContext(active.candidate,active.adoption,'v2',counter,30000);
  const body=JSON.parse(packet.input);
  expect(body.schemaVersion).toBe(2);
  expect(body.volume.displayCode).toBe('B');expect(body.volume.number).toBe(2);
  expect(body.volume.words).toMatchObject({target:100000,hard:false});
  expect(body.bookWords).toMatchObject({target:200000,policy:'chars-v1'});
  expect(body.volume.duties[0]).toMatchObject({lineDisplay:'支线1',strength:'flexible'});
  expect(body.anchors.map((a:{id:string})=>a.id)).toEqual(['v2-in','v2-out']);
  expect(body.milestones).toEqual([]);
  expect(body.previous).toMatchObject({displayCode:'A'});
  expect(body.previous.actualEndingCard).toContain('not_provided');
  expect(body.notice).toContain('不代表正文已经发生');
  expect(()=>volumePlanningContext(active.candidate,active.adoption,'missing',counter,30000)).toThrow('不属于');
  expect(()=>volumePlanningContext(active.candidate,active.adoption,'v2',counter,10)).toThrow('超预算');
 });
 it('首卷无上卷、主线关键落点随卷供给',()=>{
  const {repo}=setup();const revision=repo.saveCandidate(scope,'candidate',0,sample());repo.review(scope,'candidate',revision,'reviewer','pass');repo.adopt(scope,'candidate',revision,0,'adopt');
  const active=repo.activePlan(scope)!;
  const counter={id:'utf8',mode:'conservative' as const,count:(s:string)=>Buffer.byteLength(s)};
  const body=JSON.parse(volumePlanningContext(active.candidate,active.adoption,'v1',counter,30000).input);
  expect(body.volume.displayCode).toBe('A');expect(body.previous).toBeNull();expect(body.next).toMatchObject({displayCode:'B'});
  expect(body.milestones[0]).toMatchObject({lineId:'main',lineDisplay:'主线1',importance:'flexible'});
  expect(body.lines.find((l:{id:string})=>l.id==='main').displayCode).toBe('主线1');
 });
});
