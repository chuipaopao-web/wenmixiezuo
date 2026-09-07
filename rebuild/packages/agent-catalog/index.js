// Public identities and supported channel names only; no credentials, user data or task state.
export { OPENING_EVALUATION_REPORT } from './opening-evaluations.js';
import { OPENING_EVALUATION_REPORT } from './opening-evaluations.js';
export { SETTING_EVALUATION_REPORT } from './setting-evaluations.js';
import { SETTING_EVALUATION_REPORT } from './setting-evaluations.js';
export const SETTING_DESIGN_PRIORITY = Object.freeze(['deepseek-v4-pro','deepseek-v4-flash','kimi-k2.7-code']);
export function settingReviewRanking(report=SETTING_EVALUATION_REPORT){return openingRanking('review',report);}
export function openingRanking(node, report=OPENING_EVALUATION_REPORT){
 return report.rows.filter(row=>row.node===node && row.profileKey!=='glm-5.2' && row.structurePassed && row.quality==='passed' && Number.isFinite(row.milliseconds) && row.milliseconds>0)
  .toSorted((a,b)=>a.milliseconds-b.milliseconds || a.profileKey.localeCompare(b.profileKey));
}
export const TEXT_MODELS = Object.freeze([
  ['deepseek-v4-pro', 'DeepSeek V4 Pro'], ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
  ['glm-5.2', 'GLM 5.2（已停用）'], ['glm-5.3', 'GLM 5.3'], ['kimi-k2.7-code', 'Kimi 2.7'],
  ['kimi-k3', 'Kimi K3'], ['doubao-seed-2.1-turbo', '豆包 Seed 2.1 Turbo'], ['glm-5.3-flash','GLM 5.3 Flash']
].map(([profileKey, publicName]) => Object.freeze({profileKey, publicName, kind: 'text'})));
export const IMAGE_MODELS = Object.freeze([Object.freeze({profileKey:'doubao-seedream',publicName:'Seedream',kind:'image'})]);
export const ROLES = Object.freeze([
  ['chief_editor','主编室','主编','理解作者目标、比较方案并处理重大创作冲突；普通任务由执行器调度。','text',9],
  ['deputy_editor','资料编辑组','资料编辑','检索并回查原文，整理本次任务需要的证据，标注来源和不确定处。','text',9],
  ['planning_writer','策划编剧组','策划编剧','设计开书、人物世界、全书方向、卷链章纲与书名，产出可修改的候选方案。','text',9],
  ['lead_writer','主笔组','主笔','创作正文、场景、对白与改稿，遵循已确认事实并保留合理发挥空间。','text',9],
  ['independent_reviewer','审查编辑组','审查编辑','核查方案和正文的事实、连续性与阅读质量；独立复核使用不同模型。','text',9],
  ['continuity_editor','记录编辑组','记录编辑','从已接受内容维护人物、关系、伏笔与故事进度，冲突留待处理，不把候选当事实。','text',9],
  ['visual_renderer','封面画师组','封面画师','按照视觉要求生成和校验封面成品。','image',2]
].map(([roleKey,departmentName,publicName,publicResponsibility,kind,capacity]) => Object.freeze({roleKey,departmentName,publicName,publicResponsibility,kind,capacity})));

const original = [
  ['chief-deepseek-v4-pro','貂蝉','chief_editor','deepseek-v4-pro'], ['chief-glm-5-3','顾婉仪','chief_editor','glm-5.3'], ['chief-kimi-k3','沈知微','chief_editor','kimi-k3'],
  ['deputy-glm-5-3','西施','deputy_editor','glm-5.3'], ['deputy-deepseek-v4-pro','妙玉','deputy_editor','deepseek-v4-pro'], ['deputy-kimi-k3','谢听澜','deputy_editor','kimi-k3'],
  ['planner-deepseek-v4-pro','红玉','planning_writer','deepseek-v4-pro'], ['planner-glm-5-3','幼薇','planning_writer','glm-5.3'], ['planner-kimi-k3','苏映棠','planning_writer','kimi-k3'], ['planner-doubao-turbo','陆青禾','planning_writer','doubao-seed-2.1-turbo'],
  ['writer-deepseek-v4-pro','卓文君','lead_writer','deepseek-v4-pro'], ['writer-kimi-k3','清照','lead_writer','kimi-k3'], ['writer-deepseek-v4-flash','谢道韫','lead_writer','deepseek-v4-flash'], ['writer-glm-5-3','林黛玉','lead_writer','glm-5.3'], ['writer-kimi-2-7','柳如是','lead_writer','kimi-k2.7-code'], ['writer-doubao','叶纨纨','lead_writer','doubao-seed-2.1-turbo'],
  ['review-kimi-k3','周清妍','independent_reviewer','kimi-k3'], ['review-glm-5-3','顾清辞','independent_reviewer','glm-5.3'], ['review-deepseek-v4-pro','陆婉宁','independent_reviewer','deepseek-v4-pro'],
  ['continuity-deepseek-v4-pro','裴文心','continuity_editor','deepseek-v4-pro'], ['continuity-glm-5-3','宋知遥','continuity_editor','glm-5.3'], ['continuity-kimi-k3','沈墨瑶','continuity_editor','kimi-k3'], ['visual-seedream','绘真','visual_renderer','doubao-seedream']
];
const extraNames=['温若兰','许南絮','姜月宁','白芷柔','云舒窈','秦晚晴','洛清漪','许映雪','楚知夏','顾念初','苏锦棠','叶听雨','宁云汐','花映璃','温予安','江晚吟','林栖月','沈若溪','宋婉清','顾疏桐','白梦蘅','许静姝','叶知秋','江清芷','温照影','楚云裳','宁初雪','秦芷烟','云若棠','苏语棠','姜映荷','白听溪','画卿'];
export const V7_MEMBER_AVATAR_SPRITE='/avatars/editorial-women-v130.png';
export const V7_MEMBER_AVATAR_SIZE='600% 400%';
const positions=(index,rows)=>`${index%6*20}% ${Math.floor(index/6)*100/(rows-1)}%`;
const members=original.map(([memberKey,displayName,roleKey,initialModelProfileKey],index)=>({memberKey,displayName,roleKey,initialModelProfileKey,legacy:true,avatarPath:V7_MEMBER_AVATAR_SPRITE,avatarSize:V7_MEMBER_AVATAR_SIZE,avatarPosition:positions(index,4)}));
let index=0;
for(const role of ROLES){
 const existing=members.filter(m=>m.roleKey===role.roleKey);
 const models=(role.kind==='image'?IMAGE_MODELS:TEXT_MODELS).filter(p=>!existing.some(m=>m.initialModelProfileKey===p.profileKey));
 for(let number=existing.length+1;number<=role.capacity;number++){
  const extra=index++;
  const initial=models.shift()?.profileKey??null;
  members.push({memberKey:`member-${role.roleKey}-${number}`,displayName:extraNames[extra],roleKey:role.roleKey,initialModelProfileKey:initial==='glm-5.2'?null:initial,legacy:false,avatarPath:'/avatars/editorial-women-v131.png',avatarSize:'600% 600%',avatarPosition:positions(extra,6)});
 }
}
export const MEMBER_SLOTS=Object.freeze(members.map(Object.freeze));
export const V7_MEMBER_IDENTITIES=Object.freeze(MEMBER_SLOTS.map(m=>Object.freeze([m.memberKey,m.displayName])));
export function publicMemberIdentity(memberKey){return MEMBER_SLOTS.find(m=>m.memberKey===memberKey);}
export function candidateModels(roleKey){const role=ROLES.find(r=>r.roleKey===roleKey);return role?(role.kind==='image'?IMAGE_MODELS:TEXT_MODELS.filter(model=>model.profileKey!=='glm-5.2')):[];}
