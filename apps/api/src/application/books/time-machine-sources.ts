import type {DatabaseSync} from 'node:sqlite';
import {digest,type Scope,type Manifest} from '@wenmi/time-machine-core';
import {BookRepository} from '../../infrastructure/db/repositories/book-repository.js';
import {V7SettingEditorialRepository} from '../../infrastructure/db/repositories/v7-setting-editorial-repository.js';
import {V7AgentGovernanceRepository} from '../../infrastructure/db/repositories/v7-agent-governance-repository.js';
import type {V7EffectiveMember} from '@wenmi/v7-backend';
export interface SourceDocument {key:string;text:string}
export interface MethodCard {id:string;name:string;category:string;intro:string;usage:string}
export interface TimeMachineSnapshot {manifest:Manifest;documents:SourceDocument[];methods:MethodCard[];members:{researcher:V7EffectiveMember;chief:V7EffectiveMember;writer:V7EffectiveMember};intent:string;targetWords:number|null;windowTokens:number}
/** Reads upstream formal records only; it does not invoke old planning or context compilation. */
export function snapshotTimeMachine(db:DatabaseSync,scope:Scope,intent:string,windowTokens:number):TimeMachineSnapshot {
 const book=new BookRepository(db).require(scope);if(book.status==='archived')throw Error('书籍已归档');
 if(typeof intent!=='string'||intent.length>4000)throw Error('故事线选择过长');
 if(!Number.isSafeInteger(windowTokens)||windowTokens<16000)throw Error('新时光机路由预算尚未配置');
 const opening=db.prepare("SELECT version,blueprint_json FROM book_opening_blueprints WHERE owner_id=? AND book_id=? AND status='active' ORDER BY version DESC LIMIT 1").get(scope.ownerId,scope.bookId) as {version:number;blueprint_json:string}|undefined;
 if(!opening)throw Error('请先确认开书资料');
 const openingData=JSON.parse(opening.blueprint_json) as {positioning?:{expectedTotalWords?:unknown};expectedTotalWords?:unknown};
 const words=openingData.positioning?.expectedTotalWords??openingData.expectedTotalWords;
 const targetWords=typeof words==='number'&&Number.isSafeInteger(words)&&words>0?words:null;
 const manifest:Manifest={sources:[{kind:'opening',id:'opening',revision:String(opening.version),hash:digest(JSON.parse(opening.blueprint_json))},{kind:'intent',id:'intent',revision:digest(intent),hash:digest(intent)}],templateRevision:'tm2-card-1',redactionRevision:'allowlist-1'};
 const documents:SourceDocument[]=[{key:`opening:opening:${opening.version}`,text:opening.blueprint_json},{key:`intent:intent:${digest(intent)}`,text:intent||'作者尚未追加故事线偏好'}];
 for(const setting of new V7SettingEditorialRepository(db).confirmedVersions(scope.ownerId,scope.bookId)){
  manifest.sources.push({kind:'setting',id:setting.item_key,revision:setting.version_id,hash:digest(JSON.parse(setting.content_json))});
  documents.push({key:`setting:${setting.item_key}:${setting.version_id}`,text:setting.content_json});
 }
 const asset=db.prepare('SELECT version,policy_json FROM v7_rhythm_policy_versions ORDER BY version DESC LIMIT 1').get() as {version:number;policy_json:string}|undefined;
 const methods:MethodCard[]=[];
 if(asset){const policy=JSON.parse(asset.policy_json) as {cards?:unknown[]};if(!Array.isArray(policy.cards))throw Error('方法库格式无效');for(const value of policy.cards){const c=value as Record<string,unknown>;if(!['key','title','instruction','boundary'].every(k=>typeof c[k]==='string'))throw Error('方法卡格式无效');methods.push({id:String(c.key),name:String(c.title),category:String(c.methodCategory??c.category),intro:String(c.instruction),usage:String(c.boundary)});}manifest.sources.push({kind:'asset',id:'methods',revision:String(asset.version),hash:digest(methods)});}
 const registry=new V7AgentGovernanceRepository(db);registry.ensureSeeded(new Date().toISOString());const roster=registry.snapshot();
 const member=(role:V7EffectiveMember['fixedRoleKey'])=>{const found=roster.members.filter(m=>m.enabled&&m.fixedRoleKey===role&&m.model.plan!=='image').sort((a,b)=>Number(b.defaultForRole)-Number(a.defaultForRole)||a.fallbackPriority-b.fallbackPriority)[0];if(!found)throw Error(`成员岗位尚未配置：${role}`);return found;};
 return {manifest,documents,methods,members:{researcher:member('deputy_editor'),chief:member('chief_editor'),writer:member('planning_writer')},intent,targetWords,windowTokens};
}
