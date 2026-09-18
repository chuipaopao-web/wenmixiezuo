import assert from 'node:assert/strict';
const src='/opt/wenmi-releases/wm-v7-20260918-161500-e1310473/source';
const {loadModelRuntimeConfig}=await import(src+'/apps/api/dist/infrastructure/models/model-runtime-config.js');
const {ModelAdapterFactory}=await import(src+'/apps/api/dist/infrastructure/models/model-adapter-factory.js');
const c=loadModelRuntimeConfig();assert.equal(c.activeMode,'subscription-plan');assert.deepEqual(c.missingCredentials,[]);
assert.ok(Object.values(c.roleProfiles).every(x=>x.plan==='agent'));
const a=new ModelAdapterFactory(c).resolve('volcengine-ark-agent-plan','deepseek-v4-flash','structured_planning');
const start=Date.now();
try{
 const r=await a.generate({requestId:'release-smoke-e1310473',taskId:'release-smoke',ownerId:'isolated-release',bookId:'synthetic',agentId:'release-check',prompt:'这是通道连通测试。只输出JSON：{"ok":true}',maxOutputTokens:256},AbortSignal.timeout(60000));
 assert.equal(JSON.parse(r.output).ok,true);
 console.log(JSON.stringify({provider:r.provider,model:r.modelId,state:r.state,inputTokens:r.inputTokens,outputTokens:r.outputTokens,ms:Date.now()-start,allRolesAgent:true}));
}catch(e){console.error(JSON.stringify({state:'failed',class:e.failureClass??e.name,status:e.statusCode??null,ms:Date.now()-start}));process.exitCode=1;}
