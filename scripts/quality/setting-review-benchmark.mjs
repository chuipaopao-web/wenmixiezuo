// Operator-run synthetic setting review only. No production database or author content.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(), output=resolve(process.argv[2]);
assert(!existsSync(output),'Preserve earlier evidence');mkdirSync(dirname(output),{recursive:true});
const {ModelAdapterFactory}=await import(root+'/apps/api/dist/infrastructure/models/model-adapter-factory.js');
const {loadModelRuntimeConfig}=await import(root+'/apps/api/dist/infrastructure/models/model-runtime-config.js');
const core=await import(root+'/coauthoring-v7/backend/dist/index.js');
const config=loadModelRuntimeConfig(process.env);assert(config.activeMode==='subscription-plan'&&config.strictPlanOnly&&!config.cashFallbackAllowed);
const factory=new ModelAdapterFactory(config);
const items=[
 ['hero','主角','人物','林舟，二十岁，普通驿卒。靠跑驿道的经验辨认道路；没有系统、超能力或预知能力。'],
 ['world','背景','世界','架空古代临川郡，交通靠步行、马匹与舟船。没有现代通信或现代武器。'],
 ['gift','特殊能力','人物','林舟拥有每日签到系统，每天凭空领取无限粮食与现代枪械，无需付出代价。'],
 ['office','官府','秩序','本郡郡守名为陆衡。郡守签发跨县调粮文书，县吏只能核验，不能代签。'],
 ['dispatch','调粮流程','秩序','所有跨县调粮文书均由郡守陆珩签发；这里的陆珩指office条目中的同一位现任郡守。'],
 ['road','山路','地理','临川城至北仓山路通常步行两天，雨天可能因塌方延误。'],
 ['trip','行程','地理','林舟在普通晴天清晨从临川城徒步出发，两小时后抵达北仓；没有换交通工具、捷径或时间跳跃。'],
 ['money','钱币','经济','一贯铜钱按一千文记账。铜钱购买米粮，白银用于大额交易，兑换价随行情变化。'],
 ['inn','驿站','机构','驿站为公差提供换马与食宿，民间商旅需付费。换马记录保存在纸册。'],
 ['ally','同伴','人物','沈棠是熟悉河道的船工，水上经验强于林舟；愿意合作但要求事先谈妥报酬。'],
 ['rumor','消息','社会','官府通告张贴在城门。市井传言可能失真，听来的消息不能自动视为事实。'],
 ['goal','开局目标','人物','林舟希望按时送达文书并证明自己能担任驿长，不以统一全国为当前目标。'],
 ['weather','天气','世界','故事开始时是初秋，白日炎热，夜里转凉。暴雨影响渡河和山路安全。'],
 ['end','结局方向','人物','作者希望林舟最终负责一郡驿运，以改进运输解决地方困局，保留普通人的能力边界。']
].map(([itemKey,label,groupTitle,finalContent])=>({itemKey,label,groupTitle,revision:1,finalContent}));
const prompt=JSON.stringify({operation:'v7_setting_batch_final_review_v1',responsibility:'跨条目核对明确矛盾，只返回必要修改，保留没有冲突的设定；不得把开放空间或文学偏好当错误。',confirmedOpeningProfile:{protagonist:'林舟',constraint:'架空古代普通人成长，没有系统、超能力、现代枪械。'},currentSettingCandidates:items,delivery:'只返回JSON：verdict(pass或needs_author)、summary(120字以内)、unifiedDecisions数组、conflicts数组、patches数组。冲突必须引用itemKeys和原文证据，并给出可执行修改。不要重新抄写全部设定，不输出思考过程、事实总账或分组索引。',outputSchema:{verdict:'needs_author',summary:'简短结论',unifiedDecisions:[{topic:'主题',decision:'统一表达',reason:'依据'}],conflicts:[{itemKeys:['条目键'],problem:'冲突与原文证据',decision:'修正动作',impact:'影响'}],patches:[{itemKey:'有必要修改的条目',finalContent:'完整简洁修订正文',summary:'修改说明',contextSummary:'短摘要',factEntries:['已明确事实'],issues:[],suggestions:[]}]}});
const hash=x=>createHash('sha256').update(x).digest('hex');
const evidence={version:1,scope:'setting_review_synthetic_only',startedAt:new Date().toISOString(),release:readFileSync(root+'/RELEASE_ID','utf8').trim(),purpose:'novel_reviewer',timeoutMs:180000,maxConcurrency:2,automaticRetries:0,prompt,promptHash:hash(prompt),expected:['禁止系统与签到能力矛盾','同一郡守陆衡/陆珩姓名冲突','两天步行与两小时同路行程冲突'],probes:[]};
const profiles=core.V7_TEXT_MODEL_PROFILE_KEYS.filter(x=>x!=='glm-5.2');
writeFileSync(output,JSON.stringify(evidence,null,2));let cursor=0;
async function worker(){while(cursor<profiles.length){
 const profile=profiles[cursor++],binding=core.modelBindingForProfile(profile),began=Date.now();
 const row={profileKey:profile,modelId:binding.modelId,provider:binding.provider,startedAt:new Date(began).toISOString(),maxOutputTokens:3000,promptCharacters:prompt.length,promptHash:hash(prompt),purpose:'novel_reviewer'};
 try{
  const result=await factory.resolve(binding.provider,binding.modelId,'novel_reviewer').generate({requestId:'r147-'+randomUUID(),taskId:'synthetic-r147',ownerId:'synthetic-benchmark',bookId:'synthetic-only',agentId:profile,prompt,maxOutputTokens:3000,temperature:.22},AbortSignal.timeout(180000));
  assert.equal(result.cashCostCny,0);Object.assign(row,{inputTokens:result.inputTokens,outputTokens:result.outputTokens,output:result.output});
  const clean=result.output.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');const parsed=JSON.parse(clean);
  assert(['pass','needs_author'].includes(parsed.verdict));assert(typeof parsed.summary==='string'&&parsed.summary.trim());
  for(const key of ['conflicts','patches','unifiedDecisions'])assert(Array.isArray(parsed[key]));
  const keys=new Set(items.map(x=>x.itemKey));for(const p of parsed.patches){assert(keys.has(p.itemKey)&&typeof p.finalContent==='string');assert(Array.isArray(p.issues)&&p.issues.every(x=>x&&typeof x.problem==='string'&&typeof x.impact==='string'&&typeof x.suggestion==='string'));}
  for(const c of parsed.conflicts)assert(Array.isArray(c.itemKeys)&&c.itemKeys.every(x=>keys.has(x))&&typeof c.problem==='string');
  Object.assign(row,{structurePassed:true,parsed,quality:'unverified'});
 }catch(error){Object.assign(row,{structurePassed:false,quality:'unverified',errorClass:error.name,failureClass:error.failureClass??null,outcomeUnknown:error.outcomeUnknown??false,failure:row.output?String(error.message).slice(0,200):'未在测试期限内正常交付；请结合错误类型核对'});}
 row.milliseconds=Date.now()-began;evidence.probes.push(row);writeFileSync(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify({profileKey:profile,milliseconds:row.milliseconds,structurePassed:row.structurePassed,outputTokens:row.outputTokens??null}));
}}
await Promise.all([worker(),worker()]);evidence.completedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(evidence,null,2));console.log('SETTING_REVIEW_BENCHMARK_COMPLETE');
