import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createWriteStream,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root='/opt/wenmi-releases/wm-v7-20260918-161500-e1310473';
const email='release-'+Date.now()+'@example.invalid', password=randomBytes(24).toString('base64url');
for(const [name,src,port] of [['candidate',root+'/source',43198],['rollback',root+'/rollback/source',43197]]){
 const log=createWriteStream(root+'/'+name+'-boot.log');
 const env={...process.env,WENMI_PROJECT_ROOT:src,WENMI_DATA_DIR:root+'/preflight',WENMI_API_PORT:String(port),WENMI_API_HOST:'127.0.0.1',WENMI_WEB_ORIGIN:'http://127.0.0.1:43110',WENMI_PUBLIC_ORIGIN:'',WENMI_ADMIN_ORIGIN:'',WENMI_TIME_MACHINE_CONTEXT_WINDOW:'64000',WENMI_MODEL_MODE:'subscription-plan'};
 for(const k of Object.keys(env))if(/API_KEY|ACCESS_TOKEN/.test(k))delete env[k];
 const child=spawn(process.execPath,[src+'/apps/api/dist/main.js'],{cwd:src,env,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log);child.stderr.pipe(log);
 try{
  let health;
  for(let i=0;i<40;i++){try{health=await (await fetch(`http://127.0.0.1:${port}/health`)).json();if(health.data?.status==='ok')break;}catch{} await new Promise(r=>setTimeout(r,500));}
  assert.equal(health?.data?.releaseId,readFileSync(src+'/RELEASE_ID','utf8').trim());
  const headers={origin:env.WENMI_WEB_ORIGIN,'content-type':'application/json','sec-fetch-site':'same-origin'};
  if(name==='candidate'){
   const res=await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`,{method:'POST',headers,body:JSON.stringify({email,password,displayName:'隔离发布验证'})});assert.equal(res.status,200,await res.text());
  }
  const login=await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`,{method:'POST',headers,body:JSON.stringify({email,password})});assert.equal(login.status,200,await login.text());
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const unauth=await fetch(`http://127.0.0.1:${port}/api/time-machine/books/isolated/state`);assert.equal(unauth.status,401);
  const foreign=await fetch(`http://127.0.0.1:${port}/api/time-machine/books/isolated/state`,{headers:{...headers,cookie}});assert.equal(foreign.status,404);
  console.log(JSON.stringify({name,health:'ok',login:'ok',crossBook:'404',unauthenticated:'401',modelCalls:0}));
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));log.end();}
}
