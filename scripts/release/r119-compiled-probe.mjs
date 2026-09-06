import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerRequestPolicy} from '../../apps/api/dist/infrastructure/security/request-policy.js';

// Isolated hook/budget boundary probe. Real session verification is covered by
// request-policy.test.ts; this probe never opens production data or a network port.
const app=Fastify();
const origin='http://127.0.0.1:43110';
const config={apiHost:'127.0.0.1',apiPort:43111,webOrigin:origin,publicOrigin:origin,adminOrigin:null};
await registerRequestPolicy(app,config,{authenticate:cookie=>cookie==='synthetic-valid-session' ? {userId:'probe-user'} : null});
app.get('/api/v1/probe',async()=>({ok:true}));
app.post('/api/v1/probe',async()=>({ok:true}));
app.get('/public-probe',async()=>({ok:true}));
app.get('/health',async()=>({ok:true}));
const headers={host:'127.0.0.1:43111',cookie:'synthetic-valid-session'};
const request=options=>app.inject({url:'/api/v1/probe',headers,...options});
try {
 for(let i=0;i<599;i++)assert.equal((await request({})).statusCode,200);
 assert.equal((await request({method:'HEAD'})).statusCode,200);
 assert.equal((await request({})).statusCode,429);
 assert.equal((await request({headers:{...headers,'x-user-id':'different'}})).statusCode,429);
 assert.equal((await request({headers:{...headers,cookie:'invalid'}})).statusCode,401);
 const write={method:'POST',headers:{...headers,origin,'sec-fetch-site':'same-origin','content-type':'application/json'},payload:{}};
 for(let i=0;i<100;i++)assert.equal((await request(write)).statusCode,200);
 assert.equal((await request(write)).statusCode,429);
 for(let i=0;i<100;i++)assert.equal((await request({url:'/health'})).statusCode,200);
 assert.equal((await request({url:'/health'})).statusCode,429);
 for(let i=0;i<100;i++)assert.equal((await request({url:'/public-probe',headers:{host:headers.host,cookie:'invalid','x-user-id':'fake-'+i}})).statusCode,200);
 assert.equal((await request({url:'/public-probe'})).statusCode,429);
 console.log(JSON.stringify({compiledPolicy:true,readAndHead600:true,write100:true,health100:true,anonymous100:true,spoofedIdentityRejected:true}));
} finally {await app.close();}
