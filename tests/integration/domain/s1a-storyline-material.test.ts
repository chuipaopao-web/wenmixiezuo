import {describe,it,expect,afterEach,vi} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {type StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
import {snapshotTimeMachine,manifestSourcesSignature} from '../../../apps/api/src/application/books/time-machine-sources.js';
import {TimeMachineStorylineMaterialService} from '../../../apps/api/src/application/books/time-machine-storyline-material-service.js';
import {SqlPlanRepository} from '@wenmi/time-machine-core';
import {createAppServer} from '../../../apps/api/src/http/app-server.js';
import {V7SettingEditorialService} from '../../../apps/api/src/application/books/v7-setting-editorial-service.js';
// S1-A阶段二（TIMEMACHINE_STORY_DESIGN第25节）：故事线资料正式版本、作者编辑与失效标记。
// 合同清单：确认建v1不重复建版/编辑后旧轮标记+采用409+旧结果可读/保存不触发推荐/下轮读新材料无标记/
// CAS409+新预览/幂等重复保存/草稿不失效/跨owner-book/事务回滚/预览卷链章"尚未创建"。
// 72c3a62f复核后追加：材料自含正文可编辑（稳定lineId/推荐原件不变）/版本权威expectedMaterialRevision/
// 预览签名事务内重算/planning-context失效门禁/工作投影真实成员。
const contexts:TestContext[]=[];
afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
function output(prompt:string):unknown{
 if(prompt.includes('核对短卡是否'))return {pass:true,issues:[]};
 if(prompt.includes('判断需要哪些方法'))return {action:'ready',selected:[]};
 if(prompt.includes('你是主编，推荐'))return {greeting:'老板，推荐如下',lines:[{id:'growth',role:'main',title:'成长线',description:'建立工坊',recommended:true},{id:'ally',role:'through',title:'伙伴线',description:'结识同伴',recommended:false}],structure:'single',reason:'聚焦成长'};
 if(prompt.includes('设计全书骨架。只设计')){const rival=prompt.includes('宿敌线');const lines:unknown[]=[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',process:'从修理到建坊',parentIds:[],covers:['成长线'],milestones:[]}];if(rival)lines.push({id:'rival',role:'through',title:'宿敌',goal:'对手登场',answer:'对决了结',process:'从对立到彼此成就',parentIds:[],covers:['宿敌线'],milestones:[]});return {structure:'四幕起承转合',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},lines,expectations:[{id:'promise',opening:'无灵根能否立足',change:'看到变化',answer:'以机甲立足',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};}
 if(prompt.includes('补全本卷卷卡')){const brief=JSON.parse(prompt.split('\n本卷概要：')[1]!.split('\n前卷交接：')[0].trim()) as {id:string};const id=String(brief.id);const duties:unknown[]=[{lineId:'main',action:'advance',result:'推进',anchorIds:['out'],strength:'flexible',reason:'本卷职责'}];if(prompt.includes('"rival"'))duties.push({lineId:'rival',action:'advance',result:'对手逼近',anchorIds:['out'],strength:'flexible',reason:'本卷职责'});return {volumes:[{id,title:'开张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'in',ownerEntityId:id,kind:'entry',summary:'危机成立',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'补开场',keywords:[],aliases:[]},{id:'out',ownerEntityId:id,kind:'exit',summary:'交付完成',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'补收束',keywords:[],aliases:[]}],duties}]};}
 if(prompt.includes('自检你刚完成')||prompt.includes('自检候选锚点'))return {pass:true,issues:[]};
 if(prompt.includes('核对候选锚点'))return {pass:true,issues:[],suggestions:[]};
 if(prompt.includes('核对候选骨架'))return {action:'verdict',pass:true,issues:[],suggestions:[]};
 return {fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}};
}
function makeGateway(c:TestContext){return new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));}
function setup(){
 const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'s1a-mat-book'};
 c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'S1A作者','2026-09-15','2026-09-15');
 new BookRepository(c.database).create(scope,'S1A资料书','2026-09-15','active');
 c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
 const service=new TimeMachineDesignService(c.database,makeGateway(c),64000);
 const versions={value:'pv-1'};
 (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:versions.value});
 const materials=new TimeMachineStorylineMaterialService(c.database);
 const facts=()=>({preparationVersion:versions.value,manifestSignature:manifestSourcesSignature(snapshotTimeMachine(c.database,scope,'',64000).manifest)});
 return {c,scope,service,versions,materials,facts};
}
type RecRun={id:string;recommendationHash?:string|null};
async function succeededRecommend(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string},key:string):Promise<RecRun>{
 const id=service.start(scope,'recommend','',key);await service.process(id);
 const run=service.state(scope).find(r=>r.id===id);
 expect(run?.state).toBe('succeeded');
 return {id:String(run!.id),recommendationHash:run!.recommendationHash ?? null};
}
function selectionFor(run:RecRun,preparationVersion:string,overrides:Partial<StorylineSelectionInput>={}):StorylineSelectionInput{
 return {recommendationRunId:run.id,recommendationHash:String(run.recommendationHash),preparationVersion,selectedLineIds:['growth'],addedLines:[],shape:'auto' as const,ensemble:true,authorNote:'',...overrides};
}
const materialCount=(c:TestContext,bookId:string)=>Number((c.database.prepare('SELECT COUNT(*) AS n FROM tm2_storyline_materials WHERE book=?').get(bookId) as {n:number}).n);
const staleCount=(c:TestContext,bookId:string)=>Number((c.database.prepare('SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=? AND needs_redesign=1').get(bookId) as {n:number}).n);
type Facts=()=>{preparationVersion:string;manifestSignature:string};
/** 保存前先取影响预览签名（72c3a62f复核第3项：保存事务内重算匹配才写）。 */
const sigOf=(materials:TimeMachineStorylineMaterialService,scope:{ownerId:string;bookId:string},content:StorylineSelectionInput,revision:number,facts:Facts):string=>
 materials.preview(scope,content,revision,facts().preparationVersion,facts().manifestSignature).signature;
describe('S1-A stage2 storyline material',()=>{
 it('确认选择建v1（selection-confirm）；同键回放与同内容确认不重复建版；材料存在后内容分歧的新确认拒绝（版本权威）',async()=>{
   const {c,scope,service,versions,materials}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-1');
   versions.value='pv-m1';
   const sel=selectionFor(rec,'pv-m1');
   const round1=service.startDesignRound(scope,sel,'mat-round-1');
   expect(materialCount(c,scope.bookId)).toBe(1);
   const v1=materials.current(scope)!;
   expect(v1.revision).toBe(1);expect(v1.createdBy).toBe('selection-confirm');
   expect(v1.content.selectedLineIds).toEqual(['growth']);
   expect(v1.content.selectedLines).toEqual([{id:'growth',role:'main',title:'成长线',description:'建立工坊'}]);
   // 同键回放：不新建版本
   service.startDesignRound(scope,sel,'mat-round-1');
   expect(materialCount(c,scope.bookId)).toBe(1);
   // 旧轮完结后再开新轮（同一书在途任务互斥是既有行为）
   for(const item of round1)await service.process(item.id);
   // 同内容新轮：带expectedMaterialRevision读取当前材料，不新建版本
   service.startDesignRound(scope,sel,'mat-round-2',1);
   expect(materialCount(c,scope.bookId)).toBe(1);
   // 不同内容的新确认（旧标签页旧选择+新key）：409且零材料写入/零新轮（72c3a62f复核第2项）
   expect(()=>service.startDesignRound(scope,selectionFor(rec,'pv-m1',{authorNote:'加点群像'}),'mat-round-3',1)).toThrow('内容已变化');
   expect(materialCount(c,scope.bookId)).toBe(1);
   expect(staleCount(c,scope.bookId)).toBe(0);
   expect(service.state(scope).filter(r=>r.kind==='design'&&r.roundKey==='mat-round-3').length).toBe(0);
 });
 it('作者编辑保存：旧轮needs_redesign=1且结果保留可读；保存不触发推荐任务；下轮读新材料且无标记',async()=>{
   const {c,scope,service,versions,materials,facts}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-2');
   versions.value='pv-m2';
   const sel=selectionFor(rec,'pv-m2');
   const round=service.startDesignRound(scope,sel,'mat-round-e1');
   for(const item of round)await service.process(item.id);
   const recommendRuns=Number((c.database.prepare("SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=? AND kind='recommend'").get(scope.bookId) as {n:number}).n);
   const edited={...sel,authorNote:'作者改成更多伙伴戏'};
   const result=materials.save(scope,edited,1,'mat-edit-1',sigOf(materials,scope,edited,1,facts),facts().preparationVersion,facts().manifestSignature);
   expect(result.projection.revision).toBe(2);
   expect(result.projection.createdBy).toBe('author-edit');
   expect(result.markedRuns).toBe(3);
   expect(staleCount(c,scope.bookId)).toBe(3);
   // 保存只建立版本与失效事实：不推荐、不重生成
   expect(Number((c.database.prepare("SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=? AND kind='recommend'").get(scope.bookId) as {n:number}).n)).toBe(recommendRuns);
   // 旧轮结果保留可读（state投影仍返回），但带失效标记
   const projected=service.state(scope).filter(r=>r.kind==='design');
   expect(projected.length).toBe(3);
   for(const run of projected)expect(run.needsRedesign).toBe(true);
   // 下轮读取新材料：内容哈希一致不新建版本，新轮无标记（版本权威：带当前revision）
   const round2=service.startDesignRound(scope,edited,'mat-round-e2',2);
   expect(round2.length).toBe(3);
   expect(materialCount(c,scope.bookId)).toBe(2);
   const newRuns=service.state(scope).filter(r=>r.kind==='design'&&r.roundKey==='mat-round-e2');
   expect(newRuns.length).toBe(3);
   for(const run of newRuns)expect(run.needsRedesign).toBe(false);
   expect(round[0]!.id).not.toBe(round2[0]!.id);
 });
 it('结果正文可编辑：材料自含勾选线正文；编辑保留稳定lineId与role、推荐原件逐字不变；新基线使用修改正文',async()=>{
   const {c,scope,service,versions,materials,facts}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-lines');
   versions.value='pv-ml';
   const sel=selectionFor(rec,'pv-ml',{selectedLineIds:['growth','ally']});
   const round=service.startDesignRound(scope,sel,'mat-round-l1');
   for(const item of round)await service.process(item.id);
   const v1=materials.current(scope)!;
   expect(v1.content.selectedLines).toEqual([
     {id:'growth',role:'main',title:'成长线',description:'建立工坊'},
     {id:'ally',role:'through',title:'伙伴线',description:'结识同伴'}
   ]);
   const recResultBefore=String((c.database.prepare('SELECT result_json FROM tm2_design_runs WHERE id=?').get(rec.id) as {result_json:string}).result_json);
   // 作者直接修改已确认故事线的标题/描述（保留稳定lineId与原推荐来源）
   const edited={...sel,selectedLines:[{id:'growth',title:'工坊崛起线',description:'从修理工到工坊之主'},{id:'ally',title:'伙伴线',description:'结识同伴'}]};
   const saved=materials.save(scope,edited,1,'mat-edit-line',sigOf(materials,scope,edited,1,facts),facts().preparationVersion,facts().manifestSignature);
   expect(saved.projection.revision).toBe(2);
   expect(saved.projection.content.selectedLines).toEqual([
     {id:'growth',role:'main',title:'工坊崛起线',description:'从修理工到工坊之主'},
     {id:'ally',role:'through',title:'伙伴线',description:'结识同伴'}
   ]);
   expect(saved.projection.content.recommendationRunId).toBe(rec.id);
   // 推荐原件逐字不变
   expect(String((c.database.prepare('SELECT result_json FROM tm2_design_runs WHERE id=?').get(rec.id) as {result_json:string}).result_json)).toBe(recResultBefore);
   // 材料投影自含正文：不依赖state最新12轮仍含原推荐（投影来自tm2_storyline_materials，以上断言不读runs列表）
   // 新基线（新设计轮）读取修改后的正文
   const round2=service.startDesignRound(scope,edited,'mat-round-l2',2);
   const snap=JSON.parse(String((c.database.prepare('SELECT snapshot_json FROM tm2_design_runs WHERE id=?').get(round2[0]!.id) as {snapshot_json:string}).snapshot_json)) as {intent:string;selection:{selectedLines:{id:string;title:string}[]}};
   expect(snap.intent).toContain('工坊崛起线');
   expect(snap.intent).toContain('从修理工到工坊之主');
   expect(snap.selection.selectedLines[0]).toMatchObject({id:'growth',title:'工坊崛起线'});
 });
 it('旧版本读取（迁移兼容）：无selectedLines的旧材料行从原推荐回填正文，不伪造',async()=>{
   const {c,scope,service,versions,materials}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-old');
   versions.value='pv-mo';
   service.startDesignRound(scope,selectionFor(rec,'pv-mo'),'mat-round-o1');
   c.database.prepare("UPDATE tm2_storyline_materials SET content_json=json_remove(content_json,'$.selectedLines') WHERE book=?").run(scope.bookId);
   const proj=materials.current(scope)!;
   expect(proj.content.selectedLines).toEqual([{id:'growth',role:'main',title:'成长线',description:'建立工坊'}]);
 });
 it('预览签名绑定：预览后下游采用变化（材料不变）→保存409带新预览且不写入；新签名匹配才保存',async()=>{
   const {c,scope,service,versions,materials,facts}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-sig');
   versions.value='pv-ms';
   const sel=selectionFor(rec,'pv-ms');
   const round=service.startDesignRound(scope,sel,'mat-round-s1');
   for(const item of round)await service.process(item.id);
   const edited={...sel,authorNote:'签名绑定测试修改'};
   const preview=materials.preview(scope,edited,1,facts().preparationVersion,facts().manifestSignature);
   expect(preview.signature).toBeTruthy();
   expect(preview.affectedBaseline).toBe(false);
   // 预览后下游变化：采用候选A（材料本身未变）
   const intent=String((JSON.parse(String((c.database.prepare('SELECT snapshot_json FROM tm2_design_runs WHERE id=?').get(round[0]!.id) as {snapshot_json:string}).snapshot_json)) as {intent:string}).intent);
   const plans=new SqlPlanRepository(c.database);
   plans.syncManifest(scope,snapshotTimeMachine(c.database,scope,intent,64000).manifest);
   plans.adopt(scope,round[0]!.id,1,0,'mat-adopt-sig');
   // 旧签名保存：409影响预览已变化，零写入
   try{materials.save(scope,edited,1,'mat-edit-sig',preview.signature,facts().preparationVersion,facts().manifestSignature);expect.unreachable();}
   catch(e){const err=e as {statusCode?:number;message:string;details?:{preview?:{signature:string;affectedBaseline:boolean;downstream:{volumeOutlines:number}}}};expect(err.statusCode).toBe(409);expect(err.message).toContain('影响预览已变化');expect(err.details?.preview?.signature).not.toBe(preview.signature);expect(err.details?.preview?.affectedBaseline).toBe(true);expect(err.details?.preview?.downstream.volumeOutlines).toBe(1);}
   expect(materialCount(c,scope.bookId)).toBe(1);
   expect(materials.current(scope)!.revision).toBe(1);
   // 新预览签名匹配才写
   const fresh=materials.preview(scope,edited,1,facts().preparationVersion,facts().manifestSignature);
   expect(fresh.affectedBaseline).toBe(true);
   const saved=materials.save(scope,edited,1,'mat-edit-sig',fresh.signature,facts().preparationVersion,facts().manifestSignature);
   expect(saved.projection.revision).toBe(2);
 });
 it('CAS：expectedRevision不符409并返回新预览；同幂等键重复保存返回原版本；同键不同内容409',async()=>{
   const {scope,service,versions,materials,facts}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-3');
   versions.value='pv-m3';
   const sel=selectionFor(rec,'pv-m3');
   service.startDesignRound(scope,sel,'mat-round-c1');
   const edited={...sel,authorNote:'第一次修改'};
   try{materials.save(scope,edited,0,'mat-edit-cas','any-signature',facts().preparationVersion,facts().manifestSignature);expect.unreachable();}
   catch(e){const err=e as {statusCode?:number;message:string;details?:{preview?:{currentRevision:number}}};expect(err.statusCode).toBe(409);expect(err.message).toContain('版本已变化');expect(err.details?.preview?.currentRevision).toBe(1);}
   const saved=materials.save(scope,edited,1,'mat-edit-cas',sigOf(materials,scope,edited,1,facts),facts().preparationVersion,facts().manifestSignature);
   expect(saved.projection.revision).toBe(2);
   // 同幂等键同内容：返回原版本，不新建（回放不重复校验签名）
   const replay=materials.save(scope,edited,1,'mat-edit-cas','any-signature',facts().preparationVersion,facts().manifestSignature);
   expect(replay.replayed).toBe(true);expect(replay.projection.revision).toBe(2);
   expect(materials.current(scope)!.versions.length).toBe(2);
   // 同幂等键不同内容：409
   expect(()=>materials.save(scope,{...edited,authorNote:'别的内容'},1,'mat-edit-cas','any-signature',facts().preparationVersion,facts().manifestSignature)).toThrow('同一操作编号');
 });
 it('草稿：覆盖式保存/恢复，不失效任何后续、不建版本',async()=>{
   const {c,scope,service,versions,materials}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-4');
   versions.value='pv-m4';
   const sel=selectionFor(rec,'pv-m4');
   service.startDesignRound(scope,sel,'mat-round-d1');
   materials.saveDraft(scope,{...sel,authorNote:'草稿里的想法'},1);
   const withDraft=materials.current(scope)!;
   expect(withDraft.revision).toBe(1);
   expect(withDraft.draft).not.toBeNull();
   expect((withDraft.draft!.content as {authorNote:string}).authorNote).toBe('草稿里的想法');
   expect(withDraft.draft!.baseRevision).toBe(1);
   expect(staleCount(c,scope.bookId)).toBe(0);
   expect(materialCount(c,scope.bookId)).toBe(1);
   // 覆盖式：再存即替换
   materials.saveDraft(scope,{...sel,authorNote:'改过的草稿'},1);
   expect((materials.current(scope)!.draft!.content as {authorNote:string}).authorNote).toBe('改过的草稿');
 });
 it('跨owner/book隔离：他人范围读不到本书材料，草稿互不影响',async()=>{
   const {c,scope,service,versions,materials}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-5');
   versions.value='pv-m5';
   const sel=selectionFor(rec,'pv-m5');
   service.startDesignRound(scope,sel,'mat-round-x1');
   const other={ownerId:'other-owner',bookId:scope.bookId};
   expect(materials.current(other)).toBeNull();
   materials.saveDraft(other,{...sel,authorNote:'他人草稿'},0);
   expect(materials.current(scope)!.draft).toBeNull();
   expect(materialCount(c,scope.bookId)).toBe(1);
 });
 it('事务原子性：建轮失败时同事务的材料版本一并回滚，无半版本',async()=>{
   const {c,scope,service,versions,materials}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-6');
   versions.value='pv-m6';
   // 预占B方案request_key制造唯一冲突→建轮失败→材料插入必须回滚
   c.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,created_at,updated_at) VALUES('mat-blocked-b',?,?,  'design',?,  'x','{}','failed',?,?)").run(scope.ownerId,scope.bookId,'mat-round-t1#B','2026-09-15','2026-09-15');
   expect(()=>service.startDesignRound(scope,selectionFor(rec,'pv-m6'),'mat-round-t1')).toThrow();
   expect(materialCount(c,scope.bookId)).toBe(0);
   expect(materials.current(scope)).toBeNull();
   c.database.prepare("DELETE FROM tm2_design_runs WHERE id='mat-blocked-b'").run();
   service.startDesignRound(scope,selectionFor(rec,'pv-m6'),'mat-round-t1');
   expect(materialCount(c,scope.bookId)).toBe(1);
 });
 it('预览：返回基线/各轮（含在途状态）真实清单；卷/链/章如实"尚未创建"；内容未变化时unchanged',async()=>{
   const {scope,service,versions,materials,facts}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-7');
   versions.value='pv-m7';
   const sel=selectionFor(rec,'pv-m7');
   service.startDesignRound(scope,sel,'mat-round-p1');
   const preview=materials.preview(scope,{...sel,authorNote:'预览修改'},1,facts().preparationVersion,facts().manifestSignature);
   expect(preview.revisionMatch).toBe(true);
   expect(preview.unchanged).toBe(false);
   expect(preview.currentRevision).toBe(1);
   expect(preview.affectedBaseline).toBe(false);
   expect(preview.affectedRuns.length).toBe(3);
   expect(preview.affectedRuns.every(r=>r.alreadyMarked===false)).toBe(true);
   expect(preview.downstream).toEqual({volumeOutlines:0,volumes:'not-created',chains:'not-created',chapters:'not-created'});
   // 内容未变化：unchanged，无影响清单
   const same=materials.preview(scope,sel,1,facts().preparationVersion,facts().manifestSignature);
   expect(same.unchanged).toBe(true);
   expect(same.affectedRuns.length).toBe(0);
 });
 it('编辑保存校验与确认选择同级：推荐过期/来源变化/超限分别拒绝；缺预览签名拒绝',async()=>{
   const {scope,service,versions,materials,facts}=setup();
   const rec=await succeededRecommend(service,scope,'mat-rec-8');
   versions.value='pv-m8';
   const sel=selectionFor(rec,'pv-m8');
   service.startDesignRound(scope,sel,'mat-round-v1');
   expect(()=>materials.save(scope,{...sel,recommendationHash:'bad'},1,'mat-edit-v1','sig',facts().preparationVersion,facts().manifestSignature)).toThrow('已更新');
   expect(()=>materials.save(scope,{...sel,preparationVersion:'pv-old'},1,'mat-edit-v2','sig',facts().preparationVersion,facts().manifestSignature)).toThrow('设定资料已变化');
   expect(()=>materials.save(scope,{...sel,authorNote:'n'.repeat(1001)},1,'mat-edit-v3','sig',facts().preparationVersion,facts().manifestSignature)).toThrow('1000');
   expect(()=>materials.save(scope,{...sel,selectedLineIds:['nope']},1,'mat-edit-v4','sig',facts().preparationVersion,facts().manifestSignature)).toThrow('不在本次推荐');
   expect(()=>materials.save(scope,{...sel,authorNote:'缺签名'},1,'mat-edit-v5',undefined,facts().preparationVersion,facts().manifestSignature)).toThrow('影响预览');
 });
 it('工作投影：审查相位member=实际reviewer、卷卡相位=writer；进行中统一"正在工作"，无真实分母不给百分比',async()=>{
   const {c,scope,service}=setup();
   const members={researcher:{memberKey:'r-key',displayName:'研究员'},chief:{memberKey:'c-key',displayName:'主编'},writer:{memberKey:'w-key',displayName:'编剧'},reviewer:{memberKey:'v-key',displayName:'审查'}};
   const insert=(id:string,phase:string,state:string)=>c.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,scheme,round_key,phase,created_at,updated_at) VALUES(?,?,?,'design',?,'x',?,?, 'A',?,?, '2026-09-15','2026-09-15')").run(id,scope.ownerId,scope.bookId,`key-${id}`,JSON.stringify({members,intent:''}),state,`rk-${id}`,phase);
   insert('w-run-review','review-anchors:0','working');
   insert('w-run-vol','volume-card:0','working');
   insert('w-run-skeleton','skeleton','working');
   insert('w-run-queued','','queued');
   const projected=service.state(scope);
   const byId=(id:string)=>projected.find(r=>r.id===id)!;
   expect(byId('w-run-review').member).toEqual({id:'v-key',name:'审查'});
   expect(byId('w-run-vol').member).toEqual({id:'w-key',name:'编剧'});
   expect(byId('w-run-skeleton').member).toEqual({id:'w-key',name:'编剧'});
   expect(byId('w-run-review').progress).toBe('正在工作');
   expect(byId('w-run-vol').progress).toBe('正在工作');
   expect(byId('w-run-queued').member).toBeNull();
   expect(byId('w-run-queued').progress).toBe('等待成员接手');
 });
 it('F-http：采用→编辑保存→基线与旧轮联动标记、采用/人工修订409、旧结果可读、不推荐；state投影storylineMaterial',async()=>{  const c=createTestContext();contexts.push(c);
  c.config.modelRuntime.endpoints.coding.apiKey='fixture-only-no-network';
  c.config.modelRuntime.endpoints.agent.apiKey='fixture-only-no-network';
  const app=await createAppServer(c.config,c.database,{timeMachineWindowTokens:64000,v7OpeningModelAdapters:{resolve:(provider:string,modelId:string)=>({provider,modelId,async generate(request:{prompt:string}){return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded' as const};}})}});
  try{
   const headers={host:'127.0.0.1:43111',origin:c.config.webOrigin,'sec-fetch-site':'same-origin','content-type':'application/json'};
   const register=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email:'mat-http@example.com',displayName:'测试',password:'Strong-test-pass-123!'}});
   expect(register.statusCode,register.body).toBe(200);
   const cookie=String(register.headers['set-cookie']).split(';')[0]!;
   const ownerId=String((c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('mat-http@example.com') as {owner_id:string}).owner_id);
   const scope={ownerId,bookId:'mat-http-book'};
   new BookRepository(c.database).create(scope,'资料链路书','2026-09-15','active');
   c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
   const spy=vi.spyOn(V7SettingEditorialService.prototype,'timeMachinePrerequisite').mockReturnValue({ready:true,message:'已确认',version:'v-mat-http'});
   type RunView={id:string;kind:string;state:string;roundKey:string|null;needsRedesign:boolean;recommendationHash?:string|null;preparationVersion?:string|null;result:{revision:number;review:{pass:boolean}}|null};
   type StateView={runs:RunView[];adopted:{needsRedesign:boolean}|null;storylineMaterial:{revision:number;createdBy:string;content:{authorNote:string};draft:unknown}|null};
   const getState=async()=>(await app.inject({url:'/api/time-machine/books/mat-http-book/state',headers:{...headers,cookie}})).json().data as StateView;
   const waitFor=async(check:()=>Promise<boolean>|boolean,what:string)=>{const start=Date.now();while(Date.now()-start<100000){if(await check())return;await new Promise(r=>setTimeout(r,250));}const rows=c.database.prepare("SELECT id,scheme,state,error_code,error_message,phase FROM tm2_design_runs WHERE book_id='mat-http-book'").all();throw Error(`等待超时：${what}；runs=${JSON.stringify(rows)}`);};
   const recStart=await app.inject({method:'POST',url:'/api/time-machine/books/mat-http-book/recommendation-runs',headers:{...headers,cookie},payload:{intent:'',idempotencyKey:'mat-http-rec'}});
   expect(recStart.statusCode,recStart.body).toBe(202);
   await waitFor(()=>getState().then(d=>d.runs.some(r=>r.kind==='recommend'&&r.state==='succeeded')),'推荐完成');
   const recRun=(await getState()).runs.find(r=>r.kind==='recommend'&&r.state==='succeeded')!;
   const selection={recommendationRunId:recRun.id,recommendationHash:String(recRun.recommendationHash),preparationVersion:String(recRun.preparationVersion),selectedLineIds:['growth'],addedLines:[{title:'宿敌线',description:'对手改变彼此'}],shape:'auto' as const,ensemble:true,authorNote:'想多写伙伴的成长'};
   const designStart=await app.inject({method:'POST',url:'/api/time-machine/books/mat-http-book/design-runs',headers:{...headers,cookie},payload:{idempotencyKey:'mat-http-round',selection}});
   expect(designStart.statusCode,designStart.body).toBe(202);
   const created=designStart.json().data.runs as {id:string;scheme:string}[];
   await waitFor(()=>getState().then(d=>created.every(item=>d.runs.find(r=>r.id===item.id)?.state==='succeeded')),'三方案完成');
   // 确认选择已建材料v1
   let state=await getState();
   expect(state.storylineMaterial?.revision).toBe(1);
   expect(state.storylineMaterial?.createdBy).toBe('selection-confirm');
   expect(state.storylineMaterial?.content.authorNote).toBe('想多写伙伴的成长');
   // 采用A方案作为基线
   const doneA=state.runs.find(r=>r.id===created[0]!.id)!;
   const adopt=await app.inject({method:'POST',url:'/api/time-machine/books/mat-http-book/adoptions',headers:{...headers,cookie},payload:{candidateId:created[0]!.id,revision:doneA.result!.revision,expectedRevision:0,idempotencyKey:'mat-http-adopt'}});
   expect(adopt.statusCode,adopt.body).toBe(200);
   state=await getState();
   expect(state.adopted).not.toBeNull();
   expect(state.adopted!.needsRedesign).toBe(false);
   // 72c3a62f复核第4项：基线有效时planning-context可用
   const ctxOk=await app.inject({url:'/api/time-machine/books/mat-http-book/volumes/v1/planning-context',headers:{...headers,cookie}});
   expect(ctxOk.statusCode,ctxOk.body).toBe(200);
   // 影响预览：基线+三轮受影响，卷/链/章尚未创建
   const editedContent={...selection,authorNote:'作者改为更聚焦宿敌对决'};
   const preview=await app.inject({method:'POST',url:'/api/time-machine/books/mat-http-book/storyline-material/preview',headers:{...headers,cookie},payload:{content:editedContent,expectedRevision:1}});
   expect(preview.statusCode,preview.body).toBe(200);
   const previewData=preview.json().data as {signature:string;affectedBaseline:boolean;affectedRuns:{id:string;state:string}[];downstream:{volumeOutlines:number;volumes:string};unchanged:boolean;revisionMatch:boolean};
   expect(previewData.affectedBaseline).toBe(true);
   expect(previewData.affectedRuns.length).toBe(3);
   expect(previewData.downstream.volumeOutlines).toBe(1);
   expect(previewData.downstream.volumes).toBe('not-created');
   expect(previewData.signature).toBeTruthy();
   // 确认保存（CAS+预览签名+幂等+同事务失效）
   const save=await app.inject({method:'POST',url:'/api/time-machine/books/mat-http-book/storyline-material',headers:{...headers,cookie},payload:{content:editedContent,expectedRevision:1,idempotencyKey:'mat-http-edit-1',previewSignature:previewData.signature}});
   expect(save.statusCode,save.body).toBe(200);
   expect(save.json().data.projection.revision).toBe(2);
   state=await getState();
   // 已采用基线经候选轮标记联动；旧轮全部标记但结果保留可读
   expect(state.adopted!.needsRedesign).toBe(true);
   expect(state.storylineMaterial?.revision).toBe(2);
   expect(state.storylineMaterial?.createdBy).toBe('author-edit');
   const designRuns=state.runs.filter(r=>r.kind==='design');
   for(const run of designRuns){expect(run.needsRedesign).toBe(true);expect(run.result).not.toBeNull();}
   // 采用旧候选409；候选人工修订409
   const adoptB=await app.inject({method:'POST',url:'/api/time-machine/books/mat-http-book/adoptions',headers:{...headers,cookie},payload:{candidateId:created[1]!.id,revision:1,expectedRevision:1,idempotencyKey:'mat-http-adopt-b'}});
   expect(adoptB.statusCode).toBe(409);
   expect(JSON.parse(adoptB.body).error.message).toContain('基于旧版故事线资料');
   const revise=await app.inject({method:'POST',url:`/api/time-machine/books/mat-http-book/candidates/${created[0]!.id}/revisions`,headers:{...headers,cookie},payload:{plan:{},expectedRevision:1}});
   expect(revise.statusCode).toBe(409);
   expect(JSON.parse(revise.body).error.message).toContain('基于旧版故事线资料');
   // 保存不触发推荐任务
   expect(Number((c.database.prepare("SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=? AND kind='recommend'").get(scope.bookId) as {n:number}).n)).toBe(1);
   // 72c3a62f复核第4项：失效基线不可作为新卷设计输入；新方案采用后恢复，旧结果保留可读
   const ctxStale=await app.inject({url:'/api/time-machine/books/mat-http-book/volumes/v1/planning-context',headers:{...headers,cookie}});
   expect(ctxStale.statusCode).toBe(409);
   expect(JSON.parse(ctxStale.body).error.message).toContain('基于旧版故事线资料');
   // 新版本材料开启新设计轮（版本权威：expectedMaterialRevision=2）
   const redesign=await app.inject({method:'POST',url:'/api/time-machine/books/mat-http-book/design-runs',headers:{...headers,cookie},payload:{idempotencyKey:'mat-http-round-2',selection:editedContent,expectedMaterialRevision:2}});
   expect(redesign.statusCode,redesign.body).toBe(202);
   const created2=redesign.json().data.runs as {id:string;scheme:string}[];
   await waitFor(()=>getState().then(d=>created2.every(item=>d.runs.find(r=>r.id===item.id)?.state==='succeeded')),'新轮三方案完成');
   state=await getState();
   const doneNew=state.runs.find(r=>r.id===created2[0]!.id)!;
   const adoptNew=await app.inject({method:'POST',url:'/api/time-machine/books/mat-http-book/adoptions',headers:{...headers,cookie},payload:{candidateId:created2[0]!.id,revision:doneNew.result!.revision,expectedRevision:1,idempotencyKey:'mat-http-adopt-2'}});
   expect(adoptNew.statusCode,adoptNew.body).toBe(200);
   state=await getState();
   expect(state.adopted!.needsRedesign).toBe(false);
   const ctxRecover=await app.inject({url:'/api/time-machine/books/mat-http-book/volumes/v1/planning-context',headers:{...headers,cookie}});
   expect(ctxRecover.statusCode,ctxRecover.body).toBe(200);
   // 旧轮结果保留可读（仍带失效标记）
   for(const run of state.runs.filter(r=>r.kind==='design'&&created.some(item=>item.id===r.id))){expect(run.needsRedesign).toBe(true);expect(run.result).not.toBeNull();}
   spy.mockRestore();
  }finally{vi.restoreAllMocks();await app.close();}
 },120000);

 it('422a48c7复核：旧版本设计请求真实HTTP 409且retryable=false、零新轮（确定性拒绝合同）',async()=>{  const c=createTestContext();contexts.push(c);
  c.config.modelRuntime.endpoints.coding.apiKey='fixture-only-no-network';
  c.config.modelRuntime.endpoints.agent.apiKey='fixture-only-no-network';
  const app=await createAppServer(c.config,c.database,{timeMachineWindowTokens:64000,v7OpeningModelAdapters:{resolve:(provider:string,modelId:string)=>({provider,modelId,async generate(request:{prompt:string}){return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded' as const};}})}});
  try{
   const headers={host:'127.0.0.1:43111',origin:c.config.webOrigin,'sec-fetch-site':'same-origin','content-type':'application/json'};
   const register=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email:'mat409@example.com',displayName:'测试',password:'Strong-test-pass-123!'}});
   expect(register.statusCode,register.body).toBe(200);
   const cookie=String(register.headers['set-cookie']).split(';')[0]!;
   const ownerId=String((c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('mat409@example.com') as {owner_id:string}).owner_id);
   const scope={ownerId,bookId:'mat409-book'};
   new BookRepository(c.database).create(scope,'旧版本拒绝书','2026-09-16','active');
   c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-16')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
   const spy=vi.spyOn(V7SettingEditorialService.prototype,'timeMachinePrerequisite').mockReturnValue({ready:true,message:'已确认',version:'v-mat409'});
   type RunView={id:string;kind:string;state:string;roundKey:string|null;recommendationHash?:string|null;preparationVersion?:string|null};
   const getState=async()=>(await app.inject({url:'/api/time-machine/books/mat409-book/state',headers:{...headers,cookie}})).json().data as {runs:RunView[];storylineMaterial:{revision:number}|null};
   const waitFor=async(check:()=>Promise<boolean>|boolean,what:string)=>{const start=Date.now();while(Date.now()-start<100000){if(await check())return;await new Promise(r=>setTimeout(r,250));}throw Error(`等待超时：${what}`);};
   // 推荐→确认建材料v1并开首轮三方案
   const recStart=await app.inject({method:'POST',url:'/api/time-machine/books/mat409-book/recommendation-runs',headers:{...headers,cookie},payload:{intent:'',idempotencyKey:'mat409-rec'}});
   expect(recStart.statusCode,recStart.body).toBe(202);
   await waitFor(()=>getState().then(d=>d.runs.some(r=>r.kind==='recommend'&&r.state==='succeeded')),'推荐完成');
   const recRun=(await getState()).runs.find(r=>r.kind==='recommend'&&r.state==='succeeded')!;
   const selection={recommendationRunId:recRun.id,recommendationHash:String(recRun.recommendationHash),preparationVersion:String(recRun.preparationVersion),selectedLineIds:['growth'],addedLines:[{title:'宿敌线',description:'对手改变彼此'}],shape:'auto' as const,ensemble:true,authorNote:'想多写伙伴的成长'};
   const designStart=await app.inject({method:'POST',url:'/api/time-machine/books/mat409-book/design-runs',headers:{...headers,cookie},payload:{idempotencyKey:'mat409-round-1',selection}});
   expect(designStart.statusCode,designStart.body).toBe(202);
   const created=designStart.json().data.runs as {id:string;scheme:string}[];
   await waitFor(()=>getState().then(d=>created.every(item=>d.runs.find(r=>r.id===item.id)?.state==='succeeded')),'首轮三方案完成');
   expect((await getState()).storylineMaterial?.revision).toBe(1);
   // 保存v2（作者另一标签页编辑生效）
   const editedContent={...selection,authorNote:'作者改为更聚焦宿敌对决'};
   const preview=await app.inject({method:'POST',url:'/api/time-machine/books/mat409-book/storyline-material/preview',headers:{...headers,cookie},payload:{content:editedContent,expectedRevision:1}});
   expect(preview.statusCode,preview.body).toBe(200);
   const save=await app.inject({method:'POST',url:'/api/time-machine/books/mat409-book/storyline-material',headers:{...headers,cookie},payload:{content:editedContent,expectedRevision:1,idempotencyKey:'mat409-edit-1',previewSignature:(preview.json().data as {signature:string}).signature}});
   expect(save.statusCode,save.body).toBe(200);
   expect((await getState()).storylineMaterial?.revision).toBe(2);
   // 旧标签页冻结v1的恢复请求（新幂等键）：HTTP409、error.retryable=false、零新轮
   const stale=await app.inject({method:'POST',url:'/api/time-machine/books/mat409-book/design-runs',headers:{...headers,cookie},payload:{idempotencyKey:'mat409-stale-retry',selection,expectedMaterialRevision:1}});
   expect(stale.statusCode,stale.body).toBe(409);
   const staleError=(JSON.parse(stale.body) as {error:{message:string;retryable:boolean;details:{currentRevision:number}}}).error;
   expect(staleError.retryable).toBe(false);
   expect(staleError.message).toContain('故事线资料版本已变化');
   expect(staleError.details.currentRevision).toBe(2);
   expect(Number((c.database.prepare("SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=? AND round_key='mat409-stale-retry'").get(scope.bookId) as {n:number}).n)).toBe(0);
   // 同键再次回放同一旧请求：仍是409确定性拒绝，不创建任何运行（幂等回放优先仅适用于已成功建轮的键）
   const replay=await app.inject({method:'POST',url:'/api/time-machine/books/mat409-book/design-runs',headers:{...headers,cookie},payload:{idempotencyKey:'mat409-stale-retry',selection,expectedMaterialRevision:1}});
   expect(replay.statusCode,replay.body).toBe(409);
   expect((JSON.parse(replay.body) as {error:{retryable:boolean}}).error.retryable).toBe(false);
   expect(Number((c.database.prepare("SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=? AND round_key='mat409-stale-retry'").get(scope.bookId) as {n:number}).n)).toBe(0);
   spy.mockRestore();
  }finally{vi.restoreAllMocks();await app.close();}
 },120000);
});
