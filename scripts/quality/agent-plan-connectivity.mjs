// Synthetic connectivity only. Credentials are read from environment or a private stdin line,
// never written to files or echoed. No author data and no pay-as-you-go fallback.
import {createInterface} from 'node:readline';
if (!process.env.WENMI_ARK_AGENT_PLAN_API_KEY && process.argv.includes('--stdin-key')) {
 const lines=createInterface({input:process.stdin,terminal:false});
 process.env.WENMI_ARK_AGENT_PLAN_API_KEY=await new Promise(resolve=>lines.once('line',line=>{lines.close();resolve(line.trim());}));
}
if(!process.env.WENMI_ARK_AGENT_PLAN_API_KEY)throw Error('Agent Plan credential missing');
const models=process.argv.filter(value=>value.startsWith('--model=')).map(value=>value.slice(8));
if(!models.length)throw Error('Specify explicit --model=; no automatic model sweep');
for(const model of models){
 try{
  const response=await fetch('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions',{
   method:'POST',headers:{Authorization:`Bearer ${process.env.WENMI_ARK_AGENT_PLAN_API_KEY}`,'Content-Type':'application/json'},
   body:JSON.stringify({model,messages:[{role:'user',content:'Reply OK only.'}],max_tokens:128,...(['glm-5.3','glm-5.3-flash','kimi-k2.7-code','kimi-k3','minimax-m3'].includes(model)?{thinking:{type:'enabled'},reasoning_effort:'low'}:{thinking:{type:'disabled'}})}),signal:AbortSignal.timeout(45000)
  });
  const data=await response.json();
  const code=typeof data.error?.code==='string'?data.error.code.replace(/[^A-Za-z0-9_.-]/g,''):null;
  const message=typeof data.error?.message==='string'?data.error.message.replaceAll(process.env.WENMI_ARK_AGENT_PLAN_API_KEY,'[redacted]').replace(/ark-[A-Za-z0-9-]+/g,'[redacted]').slice(0,240):null;
  console.log(JSON.stringify({model,status:response.status,code,message,returnedModel:data.model??null,finish:data.choices?.[0]?.finish_reason??null,usage:data.usage??null}));
  if(!response.ok){process.exitCode=1;break;}
 }catch(error){console.log(JSON.stringify({model,error:'connectivity_unconfirmed',cause:typeof error?.cause?.code==='string'?error.cause.code:null}));process.exitCode=1;break;}
}
delete process.env.WENMI_ARK_AGENT_PLAN_API_KEY;
process.stdin.destroy();
