import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {emotionalAmendments,emotionalAdditions} from './emotional-methods.js';
import {reviewCorrections} from './review-corrections.js';
import {validatePayload} from '../../apps/api/src/application/creative-reference/validation.js';
const raw=readFileSync('scripts/creative-library/generated/refinement.json');
if(createHash('sha256').update(raw).digest('hex')!=='a94d63e2c86a6655a17873926921a2fc717d635f23efbe95b3f8506db5639c68')throw Error('C3冻结来源不符');
const base=JSON.parse(raw.toString());const all=[...base.entries.map((e:any)=>({...e,revision:e.expectedRevision+1})),...base.additions.map((e:any)=>({...e,revision:1}))];
const entries=Object.entries(emotionalAmendments).map(([name,a])=>{const old=all.find(e=>e.payload.name===name);if(!old)throw Error('缺少原方法'+name);const payload=structuredClone(old.payload);payload.method.instruction+=`\n具体用法：${a.use}\n正例：${a.example}\n反例：${a.counter}`;validatePayload(payload);return {identity:old.identity,expectedRevision:old.revision,expectedPayload:old.payload,payload};});
for(const [key,fix] of Object.entries(reviewCorrections)){
 const identity='r209-c1/method-'+key,old=all.find(e=>e.identity===identity);if(!old)throw Error('待修来源不存在'+identity);
 let edit=entries.find(e=>e.identity===identity);if(!edit){edit={identity,expectedRevision:old.revision,expectedPayload:old.payload,payload:structuredClone(old.payload)};entries.push(edit);}
 const m=edit.payload.method;if(fix.instruction){m.instruction=fix.instruction;edit.payload.summary=fix.instruction;}
 m.boundary=`使用条件：${fix.condition}\n误用边界：${fix.boundary}`;
 m.conditionalUses=(m.conditionalUses??[]).map((c:any)=>({...c,condition:fix.condition,use:fix.use}));validatePayload(edit.payload);
}
const additions=emotionalAdditions.map(a=>{const payload={assetKind:'method',schemaVersion:1,name:a.name,shortPhrase:a.name,summary:a.use,aliases:[],method:{title:a.name,instruction:`${a.use}\n正例：${a.example}\n反例：${a.counter}`,boundary:a.boundary,usageTree:a.purpose,applicableLayers:[...a.stages],relatedPurposes:[],conditionalUses:[],methodKind:'technique',aliases:[]}};validatePayload(payload as any);return {identity:`r209-c4/${a.key}`,payload};});
const plan={batch:'r209-c4',status:'draft',entries,additions};const output=JSON.stringify(plan,null,2)+'\n';writeFileSync('scripts/creative-library/generated/emotional.json',output);writeFileSync('scripts/creative-library/generated/emotional.sha256',createHash('sha256').update(output).digest('hex')+'\n');console.log(JSON.stringify({updated:entries.length,added:additions.length}));
