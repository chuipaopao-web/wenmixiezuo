// Correct R200's interpretation: retire K3 seats, never disguise them as another model.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [root,database,mode]=process.argv.slice(2);
if(!root||!database||!['inspect','apply'].includes(mode))throw Error('root database inspect|apply required');
const {MEMBER_SLOTS}=await import(pathToFileURL(root+'/rebuild/packages/agent-catalog/index.js'));
const {V7AgentGovernanceService}=await import(pathToFileURL(root+'/apps/api/dist/application/agents/v7-agent-governance-service.js'));
const {V7AgentGovernanceRepository}=await import(pathToFileURL(root+'/apps/api/dist/infrastructure/db/repositories/v7-agent-governance-repository.js'));
const db=new DatabaseSync(database);db.exec('PRAGMA busy_timeout=5000');
try{
 const repo=new V7AgentGovernanceRepository(db);
 const service=new V7AgentGovernanceService(repo,{next:()=>randomUUID()},{now:()=>new Date()},
   {codingPlan:!!process.env.WENMI_ARK_CODING_PLAN_API_KEY,agentPlan:!!process.env.WENMI_ARK_AGENT_PLAN_API_KEY,image:false});
 const before=service.snapshot(),slots=repo.candidateSlots(),changes=[];
 for(const m of before.members){
   const identity=MEMBER_SLOTS.find(x=>x.memberKey===m.memberKey);
   if(identity?.initialModelProfileKey==='kimi-k3'&&m.fixedRoleKey!=='lead_writer')changes.push({key:m.memberKey,modelProfileKey:'kimi-k3',enabled:false});
   if(m.memberKey==='planner-doubao-turbo')changes.push({key:m.memberKey,modelProfileKey:'doubao-seed-2.1-turbo',enabled:true});
 }
 for(const s of slots){
   const identity=MEMBER_SLOTS.find(x=>x.memberKey===s.memberKey);
   if(identity?.initialModelProfileKey==='kimi-k2.7-code'&&s.modelProfileKey===null)changes.push({key:s.memberKey,modelProfileKey:'kimi-k2.7-code'});
   if(s.roleKey!=='lead_writer'&&s.modelProfileKey==='kimi-k3')changes.push({key:s.memberKey,modelProfileKey:null});
 }
 console.log(JSON.stringify({mode,revision:before.revision,changes}));
 if(mode==='apply'){
   if(!process.env.WENMI_ARK_CODING_PLAN_API_KEY)throw Error('Coding credentials unavailable');
   writeFileSync(root+'/r202-roster-before-'+before.revision+'.json',JSON.stringify({snapshot:before,slots},null,2),{flag:'wx',mode:0o600});
   for(const {key,...patch}of changes)service.updateMember('operator-r202',key,{...patch,expectedRevision:service.snapshot().revision,reason:'老板纠正R200：K3成员非主笔停岗，保留本人模型；其他成员以自己的身份接班，恢复Kimi2.7候选'});
   const blocked=new Set(MEMBER_SLOTS.filter(m=>m.initialModelProfileKey==='kimi-k3'&&m.roleKey!=='lead_writer').map(m=>m.memberKey));
   const connected=service.connectedMembers();
   if(connected.some(m=>m.enabled&&blocked.has(m.memberKey)))throw Error('Retired K3 seat is admitted');
   for(const m of service.snapshot().members.filter(m=>blocked.has(m.memberKey)))if(m.modelProfileKey!=='kimi-k3'||m.enabled)throw Error('K3 identity not restored');
   const opening=service.openingRoster(),setting=service.settingRoster();
   for(const roster of [opening,setting])if(roster.some(m=>blocked.has(m.memberKey)||m.model.modelId==='kimi-k3'))throw Error('K3 node remains');
   if(!service.members('planning_writer').some(m=>m.memberKey==='planner-doubao-turbo'))throw Error('Original Doubao planner missing');
   if(service.members().filter(m=>m.modelProfileKey==='glm-5.3').length!==6)throw Error('GLM roles incomplete');
   if(!service.members('lead_writer').some(m=>m.modelProfileKey==='kimi-k3'))throw Error('K3 writer missing');
   const display=m=>({id:m.memberKey,name:m.displayName,model:m.model?.modelId,role:m.roleKey??m.fixedRoleKey,avatar:MEMBER_SLOTS.find(x=>x.memberKey===m.memberKey)?.avatarPosition});
   console.log(JSON.stringify({verified:true,revision:service.snapshot().revision,opening:opening.map(display),setting:setting.map(display),active:service.members().map(display)}));
 }
}finally{db.close();}
