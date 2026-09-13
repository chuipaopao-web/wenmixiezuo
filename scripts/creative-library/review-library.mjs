// Operator-only independent review of public editorial assets. Never reads books or credentials into outputs.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [root,dbPath,planPath,out,priorPath]=process.argv.slice(2);
const load=p=>import(pathToFileURL(root+'/'+p).href);
const {ModelAdapterFactory}=await load('apps/api/dist/infrastructure/models/model-adapter-factory.js');
const {loadModelRuntimeConfig}=await load('apps/api/dist/infrastructure/models/model-runtime-config.js');
const config=loadModelRuntimeConfig(process.env);if(config.activeMode!=='subscription-plan'||!config.strictPlanOnly||config.cashFallbackAllowed)throw Error('仅允许既有套餐');
const binding=[...config.publicProfiles,...Object.values(config.roleProfiles)].find(p=>p.modelId==='glm-5.3');if(!binding)throw Error('缺少已配置审核模型');
const factory=new ModelAdapterFactory(config),adapter=factory.resolve(binding.provider,binding.modelId,'novel_reviewer');
const db=new DatabaseSync(dbPath,{readOnly:true});
const cards=db.prepare("SELECT c.idempotency_key identity,r.payload_json,r.revision,c.display_code FROM creative_reference_cards c JOIN creative_reference_revisions r ON r.internal_id=c.internal_id AND r.revision=c.current_revision WHERE c.status<>'retired' ORDER BY c.asset_kind,c.display_code").all();db.close();
const plan=JSON.parse(readFileSync(planPath,'utf8'));
const items=cards.map(c=>{const edit=plan.entries.find(e=>e.identity===c.identity);return {identity:c.identity,code:c.display_code,revision:c.revision+(edit?1:0),payload:edit?.payload??JSON.parse(c.payload_json)};});
items.push(...plan.additions.map((e,i)=>({identity:e.identity,code:'新增候选'+(i+1),revision:1,payload:e.payload})));
const sha=s=>createHash('sha256').update(s).digest('hex');items.forEach(i=>i.hash=sha(JSON.stringify(i.payload)));
const sourceHash=sha(JSON.stringify(items));const prior=priorPath?JSON.parse(readFileSync(priorPath,'utf8')):null;
const reusable=[...(prior?.reused??[]),...(prior?.batches.flatMap(b=>b.items??[])??[])].filter(v=>v.pass&&items.some(i=>i.identity===v.identity&&i.hash===v.payloadHash));
const pending=items.filter(i=>!reusable.some(v=>v.identity===i.identity));
const report=existsSync(out)?JSON.parse(readFileSync(out,'utf8')):{sourceHash,model:binding.modelId,provider:binding.provider,reused:reusable,priorSourceHash:prior?.sourceHash??null,batches:[]};if(report.sourceHash!==sourceHash)throw Error('审核来源变化，不能复用');
const batches=[];let batch=[];for(const item of pending){if(batch.length&&JSON.stringify([...batch,item]).length>10500){batches.push(batch);batch=[];}batch.push(item);}if(batch.length)batches.push(batch);
const save=()=>writeFileSync(out,JSON.stringify(report,null,2));let cursor=0;
async function worker(){while(cursor<batches.length){const n=cursor++,content=batches[n];if(report.batches[n]?.state==='done')continue;if(report.batches[n]?.state==='unknown')throw Error('已有结果未知调用，不自动重复');
 const prompt=`你是独立创作方法审核者。审核以下公共方法/题材参考，不设计小说，不输出思维链。核查：方法含义与具体做法是否相符，是否误导或强制模板，主用途和重点阶段是否适合；例反例与边界是否自洽，是否把题材偏好说成所有读者事实。允许跨阶段条件使用，不要求每卡覆盖全题材。只报告明确错误，开放的文学选择不是错误。逐项返回JSON {"items":[{"identity":"原identity","pass":true或false,"issues":["具体错误及修改建议"]}]}，不得遗漏、增加或合并项目。pass=true须issues为空。\n${JSON.stringify(content)}`;
 if((adapter.inputContext?.({prompt})??prompt).length>15000)throw Error('审核包超限');
 const requestId='c4-review-'+randomUUID();report.batches[n]={state:'unknown',requestId,hash:sha(JSON.stringify(content))};save();
 try{const r=await adapter.generate({requestId,taskId:'c4-public-library-review',ownerId:'operator-public-review',bookId:'public-library-only',agentId:'independent-'+binding.modelId,prompt,maxOutputTokens:3000,temperature:.15},AbortSignal.timeout(180000));
 const parsed=JSON.parse(r.output.trim().replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''));if(!Array.isArray(parsed.items)||parsed.items.length!==content.length)throw Error('审核结果条目数量不符');
 const unique=new Set();for(const verdict of parsed.items){if(!content.some(i=>i.identity===verdict.identity)||unique.has(verdict.identity)||typeof verdict.pass!=='boolean'||!Array.isArray(verdict.issues)||verdict.issues.some(x=>typeof x!=='string')||(verdict.pass&&verdict.issues.length))throw Error('审核结果格式错误');unique.add(verdict.identity);}
 report.batches[n]={state:'done',requestId,model:r.modelId,hash:sha(JSON.stringify(content)),items:parsed.items.map(v=>({...v,payloadHash:content.find(i=>i.identity===v.identity).hash})),inputTokens:r.inputTokens,outputTokens:r.outputTokens};save();console.log(JSON.stringify({batch:n+1,total:batches.length,issues:parsed.items.filter(i=>!i.pass).length}));
 }catch(e){report.batches[n]={...report.batches[n],error:'审核调用未完成，保留未知状态，不自动重发'};save();throw e;}
}}
await Promise.all([worker(),worker()]);console.log(JSON.stringify({total:items.length,passed:reusable.length+report.batches.flatMap(b=>b.items).filter(i=>i.pass).length}));
