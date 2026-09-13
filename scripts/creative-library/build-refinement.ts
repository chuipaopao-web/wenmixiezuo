import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {scopes,purposeLinks,primary,additions} from './refine-methods.js';
import {validatePayload} from '../../apps/api/src/application/creative-reference/validation.js';
const raw=readFileSync('scripts/creative-library/generated/method-review.json');
if(createHash('sha256').update(raw).digest('hex')!=='650ec27ec71d6b60d7cc350316b7356be7b697c1189fd88bedd372d7d9180f5c')throw Error('C2来源变化');
const old=JSON.parse(raw.toString());
const stages:Record<string,string>={开:'opening',设:'setting',时:'book',卷:'volume',链:'chain',章:'chapter',文:'prose'};
const by=new Map<number,typeof scopes[number]>();
function nums(s:string){return s.split(' ').flatMap(v=>{const [a,b]=v.split('-').map(Number);return Array.from({length:(b??a!)-a!+1},(_,i)=>a!+i);});}
for(const s of scopes)for(const n of nums(s[0])){if(by.has(n))throw Error('重复判定'+n);by.set(n,s);}
const source=[...old.entries.map((x:any,i:number)=>({...x,number:i+1,identity:'r209-c1/'+x.seedKey,expectedRevision:2})).filter((x:any)=>x.decision!=='merge'),...old.additions.map((x:any,i:number)=>({...x,number:i+347,identity:'r209-c2/'+x.key,expectedRevision:1}))];
const entries=source.map((e:any)=>{
 const n=e.number,s=by.get(n);if(!s)throw Error('遗漏判定'+n);
 const payload=structuredClone(e.payload),m=payload.method;
 m.relatedPurposes=Object.entries(purposeLinks).filter(([,v])=>v.includes(n)).map(([k])=>k);
 const previous=m.usageTree;m.usageTree=primary[n]??previous;if(m.usageTree!==previous)m.relatedPurposes.push(previous);
 m.relatedPurposes=[...new Set(m.relatedPurposes)].filter(x=>x!==m.usageTree);
 m.applicableLayers=[...s[1]].map(k=>stages[k]);
 m.conditionalUses=[...s[2]].map(k=>({stage:stages[k],condition:s[3],use:s[4]}));
 m.methodKind=n>=147&&n<=194?'story_container':n>=195&&n<=218?'action_strategy':n>=221&&n<=302?'story_beat':n>=303&&n<=338?'combination':n>=353?'checklist':'technique';
 m.boundary=m.boundary.split('\n').filter((x:string)=>x.startsWith('使用条件：')||x.startsWith('误用边界：')).join('\n');
 if(n===353)m.boundary+='\n执行位置：作为任务审查准则按需调用，不和叙事技法一同强制注入。';
 validatePayload(payload);
 return {identity:e.identity,number:n,expectedRevision:e.expectedRevision,expectedPayload:e.payload,payload};
});
if(entries.length!==349)throw Error('来源数量错误');
const added=additions.map(([key,name,usage,scope,condition,instruction,boundary],i)=>({identity:'r209-c3/'+key,number:355+i,payload:{assetKind:'method',name,shortPhrase:name,summary:instruction,aliases:[],method:{title:name,instruction,boundary:`使用条件：${condition}\n误用边界：${boundary}`,usageTree:usage,relatedPurposes:[],applicableLayers:[...scope].map(k=>stages[k]),conditionalUses:[],methodKind:['事实连续','文学修订','结构检查'].includes(usage)?'checklist':'technique',aliases:[]}}}));
added.forEach(x=>validatePayload(x.payload as any));
const all=[...entries,...added];const coverage:Record<string,number>={};for(const e of all)for(const p of [e.payload.method.usageTree,...e.payload.method.relatedPurposes])coverage[p]=(coverage[p]??0)+1;
const codeSources=[...old.entries.map((e:any,i:number)=>({identity:'r209-c1/'+e.seedKey,number:i+1})),...old.additions.map((e:any,i:number)=>({identity:'r209-c2/'+e.key,number:i+347}))];
const result={batch:'r209-c3',reviewer:'Codex',status:'editorial-draft',codeSources,entries,additions:added,coverage};
const data=JSON.stringify(result,null,2)+'\n';writeFileSync('scripts/creative-library/generated/refinement.json',data);writeFileSync('scripts/creative-library/generated/refinement.sha256',createHash('sha256').update(data).digest('hex')+'\n');
console.log(JSON.stringify({reviewed:entries.length,added:added.length,total:all.length,coverage,primaryStageCounts:all.reduce((a:any,e:any)=>{const n=e.payload.method.applicableLayers.length;a[n]=(a[n]??0)+1;return a;},{})}));
