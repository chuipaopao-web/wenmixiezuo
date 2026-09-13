// Public fictional fixtures only. Records actual calls and usage; never reads author books.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [root,dbPath,out,model='glm-5.3']=process.argv.slice(2);if(existsSync(out))throw Error('探针已有记录，不自动重复消费');
const load=p=>import(pathToFileURL(root+'/'+p).href);
const {CreativeReferenceRuntime,creativeSupplement}=await load('apps/api/dist/application/creative-reference/runtime.js');
const {ModelAdapterFactory}=await load('apps/api/dist/infrastructure/models/model-adapter-factory.js');
const {loadModelRuntimeConfig}=await load('apps/api/dist/infrastructure/models/model-runtime-config.js');
const config=loadModelRuntimeConfig(process.env);if(config.activeMode!=='subscription-plan'||!config.strictPlanOnly||config.cashFallbackAllowed)throw Error('仅用已配置套餐');
const binding=[...config.publicProfiles,...Object.values(config.roleProfiles)].find(p=>p.modelId===model);if(!binding)throw Error('未配置测试模型');
const adapter=new ModelAdapterFactory(config).resolve(binding.provider,binding.modelId,'structured_planning');
const db=new DatabaseSync(dbPath);if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='creative_reference_sessions'").get())db.exec(readFileSync(root+'/apps/api/src/infrastructure/db/migrations/0124_creative_reference_sessions.sql','utf8'));
const fixtures=[
 {id:'three-kingdoms',stage:'opening',source:'作者想写轻松热血的《三国送外卖：曹操催单了》。主角陈默是现代外卖员，穿越到三国，配送能力能在乱世解决特殊需求。开局跑单是入口，作者希望看到与名将相识、卷入战争、个人影响力扩大，不要求后宫或争霸。需要方法帮助判断核心吸引力与持续情绪回报，别把职业限制当成全书边界。'},
 {id:'aftermath',stage:'book',source:'玄幻修理工林舟刚用机甲救下被宗门抛弃的工匠群体，大家终于承认无灵根者的价值。但同伴为救人失去一只手，胜利不能抹掉损失。作者希望热血又温暖，有真实人物选择；不要立刻用更大灾难冲淡本次胜利，也不要连写几页哭泣感谢。需要方法设计兑现后的情绪释放与余韵，再自然接入合作建工坊。'}
];
const report={model:binding.modelId,fixtures:[],calls:[]};const save=()=>writeFileSync(out,JSON.stringify(report,null,2));
async function call(caseId,step,prompt,maxOutputTokens){const input=adapter.inputContext?.({prompt})??prompt;if(input.length>15000)throw Error('实际上下文超限');const row={requestId:'c4-probe-'+randomUUID(),caseId,step,inputChars:input.length,state:'unknown'};report.calls.push(row);save();const r=await adapter.generate({requestId:row.requestId,taskId:'public-creative-probe',ownerId:'operator-public-probe',bookId:caseId,agentId:binding.modelId,prompt,maxOutputTokens,temperature:.4},AbortSignal.timeout(180000));Object.assign(row,{state:'succeeded',model:r.modelId,inputTokens:r.inputTokens,outputTokens:r.outputTokens});save();return r.output;}
try{for(const f of fixtures){const sessionId=randomUUID();const selection=await new CreativeReferenceRuntime(db).select({ownerId:'operator-public-probe',bookId:f.id,sessionId,stage:f.stage,source:f.source},(step,p)=>call(f.id,step,p,1600));
 const prompt='你是小说策划，只按本次阶段设计。返回JSON：{"设计要点":[],"具体事件":"一个具体的方向示例","人物选择":"选择及理由","情绪余韵":"按本次阶段给出处理方式","方法应用":[{"编号":"确实选用的编号","如何体现":"具体使用位置"}],"自查":[]}。不输出思维链，不把方法当本书事实，没使用的方法不写编号。\n'+f.source+creativeSupplement(selection);
 const output=await call(f.id,'design',prompt,2200);report.fixtures.push({...f,selection,output});save();console.log(JSON.stringify({case:f.id,selected:selection.selected.map(x=>x.id),calls:report.calls.filter(x=>x.caseId===f.id).length}));
}}finally{db.close();}
