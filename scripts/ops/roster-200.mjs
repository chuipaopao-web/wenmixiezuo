// Explicit operator action; no author records or frozen task snapshots are changed.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [root, database, mode] = process.argv.slice(2);
if (!root || !database || !['inspect','apply'].includes(mode)) throw Error('root database inspect|apply required');
const { V7AgentGovernanceService } = await import(pathToFileURL(root+'/apps/api/dist/application/agents/v7-agent-governance-service.js'));
const { V7AgentGovernanceRepository } = await import(pathToFileURL(root+'/apps/api/dist/infrastructure/db/repositories/v7-agent-governance-repository.js'));
const db=new DatabaseSync(database);db.exec('PRAGMA busy_timeout=5000');
try {
 const repo=new V7AgentGovernanceRepository(db);
 const service=new V7AgentGovernanceService(repo,{next:()=>randomUUID()},{now:()=>new Date()},
   {codingPlan:!!process.env.WENMI_ARK_CODING_PLAN_API_KEY,agentPlan:!!process.env.WENMI_ARK_AGENT_PLAN_API_KEY,image:false});
 const before=service.snapshot();
 const changes=[];
 for(const m of before.members){
   if(m.memberKey.endsWith('glm-5-3'))changes.push({key:m.memberKey,modelProfileKey:'glm-5.3',enabled:true});
   else if(m.fixedRoleKey!=='lead_writer'&&m.modelProfileKey.startsWith('kimi-'))changes.push({key:m.memberKey,modelProfileKey:'doubao-seed-2.1-turbo',enabled:true});
   else if(m.memberKey==='writer-kimi-k3')changes.push({key:m.memberKey,enabled:true});
 }
 for(const m of repo.candidateSlots())if(m.roleKey!=='lead_writer'&&m.modelProfileKey?.startsWith('kimi-'))changes.push({key:m.memberKey,modelProfileKey:null});
 console.log(JSON.stringify({mode,revision:before.revision,changes}));
 if(mode==='apply'){
   if(!process.env.WENMI_ARK_CODING_PLAN_API_KEY)throw Error('Coding credentials unavailable');
   writeFileSync(root+'/r200-roster-before-'+before.revision+'.json',JSON.stringify({snapshot:before,slots:repo.candidateSlots()},null,2),{flag:'wx',mode:0o600});
   for(const {key,...patch} of changes)service.updateMember('operator-r200',key,{...patch,expectedRevision:service.snapshot().revision,reason:'老板授权R200：GLM全文字岗位启用，Kimi只保留主笔，豆包接替其他岗位'});
   const members=service.members(),opening=service.openingRoster(),setting=service.settingRoster();
   if(members.filter(m=>m.modelProfileKey==='glm-5.3').length!==6)throw Error('GLM roles incomplete');
   if(service.connectedMembers().some(m=>m.enabled&&m.fixedRoleKey!=='lead_writer'&&m.modelProfileKey.startsWith('kimi-')))throw Error('Kimi non-writer still admitted');
   if(!members.some(m=>m.fixedRoleKey==='lead_writer'&&m.modelProfileKey==='kimi-k3'))throw Error('Kimi writer missing');
   for(const roster of [opening,setting]){
     if(roster.some(m=>m.model.modelId.startsWith('kimi-')))throw Error('Kimi node admission remains');
     for(const role of ['chief_editor','screenwriter'])if(!roster.some(m=>m.roleKey===role&&m.model.modelId==='glm-5.3'))throw Error('GLM node missing');
   }
   console.log(JSON.stringify({verified:true,revision:service.snapshot().revision,members:members.map(m=>({name:m.displayName,role:m.fixedRoleKey,model:m.modelProfileKey})),opening:opening.map(m=>m.model.modelId),setting:setting.map(m=>m.model.modelId)}));
 }
}finally{db.close();}
