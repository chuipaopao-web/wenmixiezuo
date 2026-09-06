// Explicit operator-run, synthetic-only benchmark. Never loaded by API/Worker.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const root=process.cwd();
const output=resolve(process.argv[2]??'artifacts/opening-model-benchmark.json');
assert(!existsSync(output),'Use a fresh evidence path; never overwrite a prior run');
const core=await import(root+'/coauthoring-v7/backend/dist/index.js');
const modelRoot=process.env.WENMI_BENCHMARK_MODEL_ROOT??root+'/apps/api/dist/infrastructure/models';
assert(modelRoot===root+'/apps/api/dist/infrastructure/models'||modelRoot===root+'/.local/r132-models');
const {ModelAdapterFactory}=await import(modelRoot+'/model-adapter-factory.js');
const {loadModelRuntimeConfig}=await import(root+'/apps/api/dist/infrastructure/models/model-runtime-config.js');
const {V7_OPENING_TAXONOMY_REFERENCE:taxonomy}=await import(root+'/apps/api/dist/application/books/v7-opening-package-contract.js');
const config=loadModelRuntimeConfig(process.env);
assert(config.activeMode==='subscription-plan'&&config.strictPlanOnly&&!config.cashFallbackAllowed,'Existing subscription only');
const factory=new ModelAdapterFactory(config);
// Reuse the checked-in synthetic fixture; no production database or author text is read.
const fixture=readFileSync(root+'/coauthoring-v7/backend/opening-agent/opening-agent-engine.test.ts','utf8');
const start=fixture.indexOf('const PACKAGE: OpeningPackage = '),end=fixture.indexOf('\nconst PASS_REVIEW',start);
assert(start>=0&&end>start);
const literal=fixture.slice(start+'const PACKAGE: OpeningPackage = '.length,end).trim().replace(/;$/,'');
const reviewPackage=JSON.parse(JSON.stringify(runInNewContext('('+literal+')',Object.create(null),{timeout:1000})));
const idea='张三穿越到三国乱世，从流民开始求生，想靠现代知识改变自己和百姓的命运。张三是唯一主角，没有系统或超能力，不会无代价掌握古代工艺，也不能准确记住所有历史细节。';
// Production validates taxonomy before review; keep this deterministic boundary
// separate from the semantic contradiction being tested by reviewers.
reviewPackage.positioning.category='历史古代';
reviewPackage.positioning.genres=['秦汉三国','历史古代','种田经营'];
reviewPackage.positioning.tags=['历史','古代','种田','成长'];
core.parseOpeningPackage(JSON.stringify(reviewPackage),taxonomy,'fanqie');
// The same unambiguous author-constraint contradiction for every reviewer.
reviewPackage.protagonists[0].goldenFinger='绑定签到系统，每天凭空获得无限粮食和现代武器，不需要学习或付出代价。';
const referencePack=core.buildOpeningReferencePack(idea);
const hash=value=>createHash('sha256').update(value).digest('hex');
const evidence={version:1,scope:'opening_design_and_review_synthetic',release:readFileSync(root+'/RELEASE_ID','utf8').trim(),startedAt:new Date().toISOString(),idea,fixtureHash:hash(JSON.stringify(reviewPackage)),timeoutMs:180000,maxConcurrency:2,automaticRetries:0,reviewExpected:'识别作者明确禁止系统与候选签到系统的矛盾，提出可执行修改，不要求补写本阶段延后字段',probes:[]};
const phase=process.argv[3];
assert(phase==='design'||phase==='review','Explicitly select design or review; stages are measured independently');
const jobs=core.V7_TEXT_MODEL_PROFILE_KEYS.filter(profile=>profile!=='glm-5.2').map(profile=>({profile,kind:phase}));
evidence.scope='opening_'+phase+'_independent';evidence.maxConcurrency=1;
writeFileSync(output,JSON.stringify(evidence,null,2));
let cursor=0;
async function worker(){while(cursor<jobs.length){
 const {profile,kind}=jobs[cursor++],design=kind==='design',binding=core.modelBindingForProfile(profile);
 const prompt=core.buildOpeningAgentPrompt({taskId:'synthetic-r132',nodeKey:design?'opening_package_design':'opening_package_review',roleKey:design?'screenwriter':'chief_editor',taskKind:design?'opening_design':'opening_review',workstationKey:'opening',operationMode:'fresh',operation:design?'v7_opening_package_design_v1':'v7_opening_package_review_v1',basedOnTaskId:null,authorIdea:idea,publishingPlatform:'fanqie',ideaVersion:1,referencePack,openingPackage:design?null:reviewPackage,review:null,taxonomy,validationRepair:null,memberInstruction:''});
 const began=Date.now();const record={profile,kind,modelId:binding.modelId,provider:binding.provider,purpose:'structured_planning',startedAt:new Date(began).toISOString(),promptCharacters:prompt.length,promptHash:hash(prompt),maxOutputTokens:design?6000:3000};
 try{
  const result=await factory.resolve(binding.provider,binding.modelId,'structured_planning').generate({requestId:'r132-'+randomUUID(),taskId:'synthetic-r132',ownerId:'synthetic-benchmark',bookId:'synthetic-only',agentId:profile,prompt,maxOutputTokens:record.maxOutputTokens,temperature:design?.72:.24},AbortSignal.timeout(180000));
  assert.equal(result.cashCostCny,0);
  Object.assign(record,{inputTokens:result.inputTokens,outputTokens:result.outputTokens,output:result.output});
  const parsed=design?core.parseOpeningPackage(result.output,taxonomy,'fanqie'):core.parseOpeningReview(result.output);
  Object.assign(record,{structurePassed:true,parsed});
 }catch(error){Object.assign(record,{structurePassed:false,errorClass:error.name,statusCode:error.statusCode??null,failureClass:error.failureClass??null,outcomeUnknown:error.outcomeUnknown??false});
  // Adapter errors may contain upstream details; preserve only structural parser text.
  record.failure=record.output?String(error.message).slice(0,250):'模型未正常交付，请结合错误类型与耗时核对';
 }
 record.milliseconds=Date.now()-began;evidence.probes.push(record);writeFileSync(output,JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({profile,kind,structurePassed:record.structurePassed,milliseconds:record.milliseconds,outputTokens:record.outputTokens??null,failure:record.failure??null}));
}}
await worker();
evidence.completedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(evidence,null,2));
console.log(JSON.stringify({complete:true,count:evidence.probes.length}));
