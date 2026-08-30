export type V7OpeningRoleKey = 'chief_editor' | 'screenwriter';
export type V7ArkPlan = 'coding' | 'agent';

export interface V7OpeningRoleDefinition {
  roleKey: V7OpeningRoleKey;
  publicName: string;
  publicResponsibility: string;
  /** 后台可查看但不可覆盖的岗位级基础提示摘要。 */
  basePrompt: string;
}

export interface V7MemberModelBinding {
  provider: 'volcengine-ark-coding-plan' | 'volcengine-ark-agent-plan';
  modelId: string;
  plan: V7ArkPlan;
}

export interface V7OpeningMemberDefinition {
  memberKey: string;
  displayName: string;
  roleKey: V7OpeningRoleKey;
  enabledByDefault: boolean;
  defaultForRole: boolean;
  fallbackPriority: number;
  model: V7MemberModelBinding;
  /** 管理员可配置、任务创建时冻结的成员补充提示；不能覆盖作者来源与结构合同。 */
  promptInstruction: string;
}

export type V7MemberEnabledOverrides = Readonly<Record<string, boolean | undefined>>;

export const V7_OPENING_ROLES: readonly V7OpeningRoleDefinition[] = [
  {
    roleKey: 'chief_editor',
    publicName: '主编',
    publicResponsibility: '理解作者想法、建立任务书、审查资料包并把分歧交还作者决定。',
    basePrompt: '忠实提炼作者原话，冻结明确主角、时代、地点和目标；不得把遇到的名人替换为主角。按所选发布渠道给出具体、易懂、有核心看点的商业书名，并审查共享开书表单是否完整一致。'
  },
  {
    roleKey: 'screenwriter',
    publicName: '编剧',
    publicResponsibility: '根据冻结任务书设计完整、可修改且彼此一致的开书资料包。',
    basePrompt: '严格执行作者原话和主编任务书，完整填写当前共享开书表单；不擅自替换主角，不虚构作者没有要求的系统、后宫或金手指，不设计已明确延后的开局剧情。'
  }
] as const;

/**
 * V7成员登记公开身份、实际模型绑定和后台可见的补充提示。
 * 岗位基础能力仍由共享Role Skill和Node Skill决定；补充提示不能覆盖作者硬来源、安全与输出合同。
 */
export const V7_OPENING_MEMBERS: readonly V7OpeningMemberDefinition[] = [
  member('chief-deepseek-v4-pro', '貂蝉', 'chief_editor', true, true, 1,
    coding('deepseek-v4-pro')),
  member('chief-glm-5-3', '顾承砚', 'chief_editor', true, false, 2,
    coding('glm-5.3')),
  member('chief-kimi-k3', '沈知微', 'chief_editor', true, false, 3,
    agent('kimi-k3')),
  member('screenwriter-deepseek-v4-pro', '红玉', 'screenwriter', true, true, 1,
    coding('deepseek-v4-pro')),
  member('screenwriter-glm-5-3', '幼薇', 'screenwriter', true, false, 2,
    coding('glm-5.3')),
  member('screenwriter-kimi-k3', '苏映棠', 'screenwriter', true, false, 3,
    agent('kimi-k3'))
] as const;

export function validateOpeningAgentRoster(
  members: readonly V7OpeningMemberDefinition[] = V7_OPENING_MEMBERS
): string[] {
  return validateRoster(members, 3);
}

/**
 * 运行态成员表允许管理员把备用成员下岗，但每个岗位仍必须保留一个明确默认成员。
 * 模型、套餐和成员身份仍来自静态登记表；数据库只改变运营状态和顺序。
 */
export function validateEffectiveOpeningAgentRoster(
  members: readonly V7OpeningMemberDefinition[]
): string[] {
  return validateRoster(members, 1);
}

function validateRoster(
  members: readonly V7OpeningMemberDefinition[],
  minimumEnabledPerRole: number
): string[] {
  const errors: string[] = [];
  const roleKeys = new Set(V7_OPENING_ROLES.map((role) => role.roleKey));
  const memberKeys = new Set<string>();
  for (const memberDefinition of members) {
    if (memberKeys.has(memberDefinition.memberKey)) errors.push(`成员键重复：${memberDefinition.memberKey}`);
    memberKeys.add(memberDefinition.memberKey);
    if (!roleKeys.has(memberDefinition.roleKey)) errors.push(`成员岗位不存在：${memberDefinition.memberKey}`);
    if (!Number.isInteger(memberDefinition.fallbackPriority) || memberDefinition.fallbackPriority < 1) {
      errors.push(`备用优先级无效：${memberDefinition.memberKey}`);
    }
    errors.push(...validateMemberModelPolicy(memberDefinition));
  }
  for (const role of V7_OPENING_ROLES) {
    const roleMembers = members.filter((candidate) => candidate.roleKey === role.roleKey);
    const enabled = roleMembers.filter((candidate) => candidate.enabledByDefault);
    if (enabled.length < minimumEnabledPerRole) {
      errors.push(`${role.publicName}至少需要${minimumEnabledPerRole === 1 ? '一' : '三'}名启用成员`);
    }
    if (enabled.filter((candidate) => candidate.defaultForRole).length !== 1) {
      errors.push(`${role.publicName}必须且只能有一名默认成员`);
    }
    const priorities = enabled.map((candidate) => candidate.fallbackPriority);
    if (new Set(priorities).size !== priorities.length) errors.push(`${role.publicName}备用优先级不能重复`);
    const signatures = enabled.map(modelSignature);
    if (new Set(signatures).size !== signatures.length) errors.push(`${role.publicName}不能登记重复模型成员`);
  }
  return errors;
}

export function validateMemberModelPolicy(memberDefinition: V7OpeningMemberDefinition): string[] {
  const errors: string[] = [];
  const isKimiK3 = memberDefinition.model.modelId.toLowerCase() === 'kimi-k3';
  if (isKimiK3) {
    if (memberDefinition.model.plan !== 'agent' || memberDefinition.model.provider !== 'volcengine-ark-agent-plan') {
      errors.push(`${memberDefinition.memberKey}：Kimi K3必须使用火山方舟Agent Plan`);
    }
  } else if (
    memberDefinition.model.plan !== 'coding'
    || memberDefinition.model.provider !== 'volcengine-ark-coding-plan'
  ) {
    errors.push(`${memberDefinition.memberKey}：普通成员必须使用火山方舟Coding Plan`);
  }
  return errors;
}

export function listOpeningMembers(options: {
  roleKey?: V7OpeningRoleKey;
  enabledOverrides?: V7MemberEnabledOverrides;
  members?: readonly V7OpeningMemberDefinition[];
} = {}): V7OpeningMemberDefinition[] {
  return (options.members ?? V7_OPENING_MEMBERS).filter((candidate) => (
    (options.roleKey === undefined || candidate.roleKey === options.roleKey)
    && isMemberEnabled(candidate, options.enabledOverrides)
  )).map((candidate) => ({ ...candidate, model: { ...candidate.model } }));
}

export function buildOpeningFallbackChain(
  roleKey: V7OpeningRoleKey,
  options: {
    selectedMemberKey?: string;
    enabledOverrides?: V7MemberEnabledOverrides;
    members?: readonly V7OpeningMemberDefinition[];
  } = {}
): V7OpeningMemberDefinition[] {
  const enabled = listOpeningMembers({
    roleKey,
    ...(options.enabledOverrides === undefined ? {} : { enabledOverrides: options.enabledOverrides }),
    ...(options.members === undefined ? {} : { members: options.members })
  });
  const selected = options.selectedMemberKey === undefined
    ? undefined
    : enabled.find((candidate) => candidate.memberKey === options.selectedMemberKey);
  if (options.selectedMemberKey !== undefined && selected === undefined) {
    throw new Error(`选择的${roleKey}成员未上岗或不存在：${options.selectedMemberKey}`);
  }
  const defaultMember = enabled.find((candidate) => candidate.defaultForRole);
  if (defaultMember === undefined) throw new Error(`${roleKey}没有可用的默认成员`);
  const automaticFallbacks = enabled.toSorted((left, right) => {
    const leftStructuredRisk = left.model.modelId.toLowerCase() === 'glm-5.3' ? 1 : 0;
    const rightStructuredRisk = right.model.modelId.toLowerCase() === 'glm-5.3' ? 1 : 0;
    return leftStructuredRisk - rightStructuredRisk || left.fallbackPriority - right.fallbackPriority;
  });
  const ordered = [
    ...(selected === undefined ? [] : [selected]),
    defaultMember,
    ...automaticFallbacks
  ];
  const seenModels = new Set<string>();
  const seenMembers = new Set<string>();
  return ordered.filter((candidate) => {
    const signature = modelSignature(candidate);
    if (seenMembers.has(candidate.memberKey) || seenModels.has(signature)) return false;
    seenMembers.add(candidate.memberKey);
    seenModels.add(signature);
    return true;
  });
}

export function memberAvailability(
  memberDefinition: V7OpeningMemberDefinition,
  credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>
): Readonly<{ available: boolean; reason: string | null }> {
  const credentialAvailable = memberDefinition.model.plan === 'coding'
    ? credentials.codingPlan
    : credentials.agentPlan;
  return credentialAvailable
    ? { available: true, reason: null }
    : {
        available: false,
        reason: memberDefinition.model.plan === 'coding' ? 'Coding Plan凭证未配置' : 'Agent Plan凭证未配置'
      };
}

export function modelSignature(memberDefinition: V7OpeningMemberDefinition): string {
  return `${memberDefinition.model.provider}\n${memberDefinition.model.modelId}\n${memberDefinition.model.plan}`;
}

function isMemberEnabled(
  memberDefinition: V7OpeningMemberDefinition,
  enabledOverrides: V7MemberEnabledOverrides | undefined
): boolean {
  return enabledOverrides?.[memberDefinition.memberKey] ?? memberDefinition.enabledByDefault;
}

function member(
  memberKey: string,
  displayName: string,
  roleKey: V7OpeningRoleKey,
  enabledByDefault: boolean,
  defaultForRole: boolean,
  fallbackPriority: number,
  model: V7MemberModelBinding
): V7OpeningMemberDefinition {
  return {
    memberKey,
    displayName,
    roleKey,
    enabledByDefault,
    defaultForRole,
    fallbackPriority,
    model,
    promptInstruction: ''
  };
}

function coding(modelId: string): V7MemberModelBinding {
  return { provider: 'volcengine-ark-coding-plan', modelId, plan: 'coding' };
}

function agent(modelId: 'kimi-k3'): V7MemberModelBinding {
  return { provider: 'volcengine-ark-agent-plan', modelId, plan: 'agent' };
}
