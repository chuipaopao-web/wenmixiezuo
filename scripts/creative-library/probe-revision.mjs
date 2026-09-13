// Reuses successful public retrieval; checks repairs against original source, not author data.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [root,priorPath,out]=process.argv.slice(2);if(existsSync(out))throw Error('已有调用记录，不自动重试');
const load=p=>import(pathToFileURL(root+'/'+p).href);
const {creativeSupplement}=await load('apps/api/dist/application/creative-reference/runtime.js');
const {ModelAdapterFactory}=await load('apps/api/dist/infrastructure/models/model-adapter-factory.js');
const {loadModelRuntimeConfig}=await load('apps/api/dist/infrastructure/models/model-runtime-config.js');
const config=loadModelRuntimeConfig(process.env);if(config.activeMode!=='subscription-plan'||!config.strictPlanOnly||config.cashFallbackAllowed)throw Error('仅使用现有套餐');
const prior=JSON.parse(readFileSync(priorPath,'utf8')),binding=[...config.publicProfiles,...Object.values(config.roleProfiles)].find(p=>p.modelId===prior.model);if(!binding)throw Error('无模型绑定');
const adapter=new ModelAdapterFactory(config).resolve(binding.provider,binding.modelId,'structured_planning'),report={model:binding.modelId,priorPath,fixtures:[]};
for(const f of prior.fixtures){
 const finding=f.id==='three-kingdoms'?'独立审查：原作者说不要求后宫或争霸，这是可选，不是禁止。前版自查声称作者禁止，是事实错误。':'独立审查：前版把失去手的影响一句带过，并在自查中把新设计的群体性格冒充既有设定。受伤者应有自己的诉求，长期影响需在生活、分工或关系中体现。';
 const prompt='返回JSON：设计要点、具体事件、人物选择、情绪余韵、方法应用、自查。对照原始资料修正，保持本阶段的简洁程度，不输出思维链。\n原始资料：'+f.source+'\n上版：'+f.output+'\n'+finding+creativeSupplement(f.selection);
 const input=adapter.inputContext?.({prompt})??prompt;if(input.length>15000)throw Error('超预算');
 const row={id:f.id,source:f.source,finding,requestId:'c4-revision-'+randomUUID(),inputChars:input.length,state:'unknown'};report.fixtures.push(row);writeFileSync(out,JSON.stringify(report,null,2));
 const r=await adapter.generate({requestId:row.requestId,taskId:'public-creative-revision',ownerId:'operator-public-probe',bookId:f.id,agentId:binding.modelId,prompt,maxOutputTokens:2200,temperature:.3},AbortSignal.timeout(180000));
 Object.assign(row,{state:'succeeded',output:r.output,inputTokens:r.inputTokens,outputTokens:r.outputTokens});writeFileSync(out,JSON.stringify(report,null,2));console.log(f.id+' completed');
}
