import type {DatabaseSync} from 'node:sqlite';
import {digest,type Scope,type Manifest} from '@wenmi/time-machine-core';
import {BookRepository} from '../../infrastructure/db/repositories/book-repository.js';
import {V7SettingEditorialRepository} from '../../infrastructure/db/repositories/v7-setting-editorial-repository.js';
import {V7AgentGovernanceRepository} from '../../infrastructure/db/repositories/v7-agent-governance-repository.js';
import type {V7EffectiveMember} from '@wenmi/v7-backend';
import {TIME_MACHINE_CARD_TEMPLATE_REVISION} from './time-machine-card-template.js';
import {SqliteCreativeReferenceRepository} from '../../infrastructure/db/repositories/creative-reference-repository.js';
import {CREATIVE_PROMPT_REVISION} from '../creative-reference/runtime.js';
export interface SourceDocument {key:string;text:string}
export interface MethodCard {id:string;name:string;category:string;intro:string;usage:string}
/** 字数口径：规划字数与作者正文统计使用同一以"字"为单位的字符计数口径；作者开书填写的总字数按软目标处理（第23.3节）。 */
export interface WordPolicy {policy:'chars-v1';unit:'字';hard:false}
/** S1-A：作者对故事线推荐的结构化确认，随设计轮快照保存（可选字段，旧快照无此字段仍可读）。 */
export interface StorylineSelectionSnapshot {
  recommendationRunId: string;
  recommendationHash: string;
  preparationVersion: string;
  selectedLineIds: string[];
  /** 勾选线正文快照（含作者编辑的标题/描述，role取服务端推荐）；旧快照缺省时由推荐回填。 */
  selectedLines?: { id: string; role: 'main' | 'through' | 'stage'; title: string; description: string }[];
  addedLines: { title: string; description: string }[];
  shape: 'auto' | 'single' | 'multiple';
  ensemble: boolean;
  authorNote: string;
  requestHash: string;
}
export interface TimeMachineSnapshot {creativeReleaseId?:string|null;manifest:Manifest;documents:SourceDocument[];methods:MethodCard[];members:{researcher:V7EffectiveMember;chief:V7EffectiveMember;writer:V7EffectiveMember;reviewer?:V7EffectiveMember};writers:V7EffectiveMember[];/** 与writers同序的独立审查成员（异底层模型）；旧快照无此字段时回退chief。 */reviewers?:V7EffectiveMember[];intent:string;targetWords:number|null;wordPolicy:WordPolicy|null;windowTokens:number;selection?:StorylineSelectionSnapshot;/** 卷卡生成策略版本：'per-volume-v1'=逐卷生成；旧快照缺省=每批两卷旧路径。 */volumeStrategy?:'per-volume-v1'}
/** 开书+已确认设定来源的稳定签名：路由与设计服务共用同一口径判断推荐是否仍与当前资料一致。 */
export function manifestSourcesSignature(manifest:{sources:{kind:string;id:string;revision:string;hash:string}[]}):string{
  const sources=manifest.sources.filter(x=>x.kind==='opening'||x.kind==='setting').sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  return digest(sources);
}
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
 const manifest:Manifest={sources:[{kind:'opening',id:'opening',revision:String(opening.version),hash:digest(JSON.parse(opening.blueprint_json))},{kind:'intent',id:'intent',revision:digest(intent),hash:digest(intent)}],templateRevision:TIME_MACHINE_CARD_TEMPLATE_REVISION,redactionRevision:'allowlist-1'};
 const documents:SourceDocument[]=[{key:`opening:opening:${opening.version}`,text:opening.blueprint_json},{key:`intent:intent:${digest(intent)}`,text:intent||'作者尚未追加故事线偏好'}];
 for(const setting of new V7SettingEditorialRepository(db).confirmedVersions(scope.ownerId,scope.bookId)){
  manifest.sources.push({kind:'setting',id:setting.item_key,revision:setting.version_id,hash:digest(JSON.parse(setting.content_json))});
  documents.push({key:`setting:${setting.item_key}:${setting.version_id}`,text:setting.content_json});
 }
 const creativeReleaseId=new SqliteCreativeReferenceRepository(db).getActiveRelease()?.releaseId??null;
 const methods:MethodCard[]=[];
 const registry=new V7AgentGovernanceRepository(db);registry.ensureSeeded(new Date().toISOString());const roster=registry.snapshot();
 // 老板既定范围：Kimi K3只保留主笔（novel_writer）。时光机的设计/推荐/资料/审查岗位
 // 一律排除kimi-k3成员，使用原本在岗的其他模型成员本人；不换标签冒充。
 const tmEligible=(m:V7EffectiveMember)=>m.enabled&&m.model.plan!=='image'&&m.model.modelId!=='kimi-k3';
 const member=(role:V7EffectiveMember['fixedRoleKey'])=>{const found=roster.members.filter(m=>tmEligible(m)&&m.fixedRoleKey===role).sort((a,b)=>Number(b.defaultForRole)-Number(a.defaultForRole)||a.fallbackPriority-b.fallbackPriority)[0];if(!found)throw Error(`成员岗位尚未配置：${role}`);return found;};
 // 三套方案优先使用不同模型的在岗编剧（第23.12节阶段二）；不足三位时按可用数量真实标注，不伪装独立。
 const eligible=roster.members.filter(m=>tmEligible(m)&&m.fixedRoleKey==='planning_writer').sort((a,b)=>Number(b.defaultForRole)-Number(a.defaultForRole)||a.fallbackPriority-b.fallbackPriority);
 if(!eligible.length)throw Error('成员岗位尚未配置：planning_writer');
 const writers:V7EffectiveMember[]=[];const usedModels=new Set<string>();
 for(const m of eligible){if(writers.length>=3)break;if(!usedModels.has(m.model.modelId)){writers.push(m);usedModels.add(m.model.modelId);}}
 for(const m of eligible){if(writers.length>=3)break;if(!writers.includes(m)){writers.push(m);usedModels.add(m.model.modelId);}}
 // 独立审查者不得与该方案编剧同底层模型（老板既定）；按编剧顺序从chief_editor岗选取异模型成员，
 // 人员不足则明确受阻，不用同模型或K3补位、不伪装独立复核。
 const chiefPool=roster.members.filter(m=>tmEligible(m)&&m.fixedRoleKey==='chief_editor').sort((a,b)=>Number(b.defaultForRole)-Number(a.defaultForRole)||a.fallbackPriority-b.fallbackPriority);
 const reviewers=writers.map(writer=>{const found=chiefPool.find(chief=>chief.model.modelId!==writer.model.modelId);if(!found)throw Error(`无与编剧${writer.displayName}异底层模型的合格审查成员，方案审查受阻`);return found;});
 const chief=member('chief_editor');
 manifest.sources.push({kind:'asset',id:'creative-library',revision:creativeReleaseId??'unpublished',hash:digest({creativeReleaseId,prompt:CREATIVE_PROMPT_REVISION})});
 return {creativeReleaseId,manifest,documents,methods,members:{researcher:member('deputy_editor'),chief,writer:writers[0]!,reviewer:reviewers[0]!},writers,reviewers,intent,targetWords,wordPolicy:targetWords===null?null:{policy:'chars-v1',unit:'字',hard:false},windowTokens,volumeStrategy:'per-volume-v1'};
}
