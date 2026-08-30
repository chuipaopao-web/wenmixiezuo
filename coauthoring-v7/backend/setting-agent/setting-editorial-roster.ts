import type { V7MemberModelBinding } from '../agents/agent-roster.js';
import type { V7SettingMemberDefinition } from './setting-agent-contracts.js';

const responsibility = {
  chief_editor: '审查全部设定，发现逻辑冲突并给出最终可用版本。',
  deputy_editor: '按需整理检索资料、标注不确定性，并把资料转译成编剧可执行边界。',
  screenwriter: '依据开书资料包与已确认设定，设计简洁、可检索、可继续创作的设定条目。'
} as const;

export const V7_SETTING_MEMBERS: readonly V7SettingMemberDefinition[] = [
  member('chief-deepseek-v4-pro', '貂蝉', 'chief_editor', 1, coding('deepseek-v4-pro')),
  member('chief-glm-5-3', '顾承砚', 'chief_editor', 2, coding('glm-5.3')),
  member('chief-kimi-k3', '沈知微', 'chief_editor', 3, agent('kimi-k3')),
  member('deputy-glm-5-3', '西施', 'deputy_editor', 1, coding('glm-5.3')),
  member('deputy-deepseek-v4-pro', '妙玉', 'deputy_editor', 2, coding('deepseek-v4-pro')),
  member('deputy-kimi-k3', '谢临川', 'deputy_editor', 3, agent('kimi-k3')),
  member('planner-deepseek-v4-pro', '红玉', 'screenwriter', 1, coding('deepseek-v4-pro')),
  member('planner-glm-5-3', '幼薇', 'screenwriter', 2, coding('glm-5.3')),
  member('planner-kimi-k3', '苏映棠', 'screenwriter', 3, agent('kimi-k3'))
] as const;

export function settingMembersForRole(roleKey: V7SettingMemberDefinition['roleKey']): V7SettingMemberDefinition[] {
  return V7_SETTING_MEMBERS.filter((memberDefinition) => memberDefinition.roleKey === roleKey)
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority);
}

export function validateSettingEditorialRoster(members = V7_SETTING_MEMBERS): string[] {
  const errors: string[] = [];
  if (members.filter((memberDefinition) => memberDefinition.roleKey === 'chief_editor').length !== 3) errors.push('设定编辑部必须登记三名强模型主编');
  if (members.filter((memberDefinition) => memberDefinition.roleKey === 'deputy_editor').length !== 3) errors.push('设定编辑部必须登记三名强模型副编');
  if (members.filter((memberDefinition) => memberDefinition.roleKey === 'screenwriter').length < 3) errors.push('设定编辑部至少登记三名可交接编剧');
  if (new Set(members.map((memberDefinition) => memberDefinition.memberKey)).size !== members.length) errors.push('成员编号不得重复');
  for (const memberDefinition of members) {
    if (memberDefinition.model.modelId === 'kimi-k3' && memberDefinition.model.plan !== 'agent') errors.push('Kimi K3必须使用Agent Plan');
    if (memberDefinition.model.modelId !== 'kimi-k3' && memberDefinition.model.plan !== 'coding') errors.push(`${memberDefinition.displayName}必须使用Coding Plan`);
  }
  return errors;
}

function member(
  memberKey: string,
  displayName: string,
  roleKey: V7SettingMemberDefinition['roleKey'],
  fallbackPriority: number,
  model: V7MemberModelBinding
): V7SettingMemberDefinition {
  return { memberKey, displayName, roleKey, fallbackPriority, model, enabledByDefault: true, publicResponsibility: responsibility[roleKey] };
}

function coding(modelId: string): V7MemberModelBinding {
  return { provider: 'volcengine-ark-coding-plan', modelId, plan: 'coding' };
}

function agent(modelId: string): V7MemberModelBinding {
  return { provider: 'volcengine-ark-agent-plan', modelId, plan: 'agent' };
}
