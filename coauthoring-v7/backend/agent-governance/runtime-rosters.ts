import type { V7OpeningMemberDefinition, V7MemberModelBinding } from '../agents/agent-roster.js';
import type { V7SettingMemberDefinition } from '../setting-agent/setting-agent-contracts.js';
import type { V7PlanningMemberDefinition, V7PlanningRoleKey } from '../planning-methods/planning-editorial-runtime.js';
import type { V7CreationMemberDefinition } from '../creation-runtime/creation-runtime-contracts.js';
import type { V7CharacterMemberDefinition } from '../character-memory/character-memory-contracts.js';
import type { V7EffectiveMember, V7FixedRoleKey, V7GlobalMemberDefinition } from './agent-governance-contracts.js';
import { V7_GLOBAL_MEMBERS } from './agent-governance-registry.js';
import type { V7VisualMemberDefinition } from '../agents/visual-agent-roster.js';

type V7RosterSourceMember = V7EffectiveMember | V7GlobalMemberDefinition;

/**
 * New V7 tasks always derive their node-specific roster from the canonical
 * seven-role registry. Passing an effective snapshot preserves admin changes;
 * omitting it uses the canonical strong-node roster defaults. Historical frozen opening
 * tasks are restored separately by the opening service and never come through
 * this default path.
 */
export function openingRosterFromGlobal(
  members: readonly V7RosterSourceMember[] = V7_GLOBAL_MEMBERS
): V7OpeningMemberDefinition[] {
  return [
    ...structuredOutputMembers(textMembers(members, 'chief_editor'))
      .map((member, index) => opening(member, 'chief_editor', index + 1)),
    ...structuredOutputMembers(strongMembers(textMembers(members, 'planning_writer')))
      .map((member, index) => opening(member, 'screenwriter', index + 1))
  ];
}

export function settingRosterFromGlobal(
  members: readonly V7RosterSourceMember[] = V7_GLOBAL_MEMBERS
): V7SettingMemberDefinition[] {
  const chiefs = structuredOutputMembers(strongMembers(textMembers(members, 'chief_editor')));
  const deputies = structuredOutputMembers(strongMembers(textMembers(members, 'deputy_editor')));
  if (chiefs.length < 2 || deputies.length === 0) throw new Error('设定编辑部至少需要两名强模型主编和一名强模型副编');
  return [
    ...chiefs.map((member, index) => setting(
      member, 'chief_editor', index + 1, '审查设定，发现逻辑冲突并给出最终可用版本。'
    )),
    ...deputies.map((member, index) => setting(
      member, 'deputy_editor', index + 1, '只在作者明确要求核实资料时整理依据和不确定处，不参与重复设计。'
    )),
    ...structuredOutputMembers(strongMembers(textMembers(members, 'planning_writer'))).map((member, index) => setting(
      member, 'screenwriter', index + 1, '依据开书资料和已确认设定，设计简洁、可检索、可继续创作的设定条目。'
    ))
  ];
}

export function planningRosterFromGlobal(
  members: readonly V7RosterSourceMember[] = V7_GLOBAL_MEMBERS
): V7PlanningMemberDefinition[] {
  const chiefs = textMembers(members, 'chief_editor');
  const planners = strongMembers(textMembers(members, 'planning_writer'));
  // Planning maintenance is an unattended JSON contract.  Keep the configured
  // three-person handoff pool, but place models proven to return visible
  // structured output before GLM 5.3.  GLM remains selectable and the final
  // fallback instead of consuming a full failed call on every chapter.
  const maintainers = structuredOutputMembers(textMembers(members, 'continuity_editor'));
  if (chiefs.length < 3) throw new Error('全书规划至少需要三名在岗主编');
  return [
    ...chiefs.map((member, index) => planning(member, 'chief_editor', index + 1, index === 0)),
    ...planners.map((member, index) => planning(member, 'planning_writer', index + 1, index === 0)),
    ...maintainers.map((member, index) => planning(member, 'continuity_editor', index + 1, index === 0))
  ];
}

export function creationRosterFromGlobal(
  members: readonly V7RosterSourceMember[] = V7_GLOBAL_MEMBERS
): V7CreationMemberDefinition[] {
  const deputies = structuredOutputMembers(strongMembers(textMembers(members, 'deputy_editor')));
  const chiefs = structuredOutputMembers(textMembers(members, 'chief_editor'));
  const planners = structuredOutputMembers(strongMembers(textMembers(members, 'planning_writer')));
  const writers = textMembers(members, 'lead_writer');
  const reviewers = reviewOutputMembers(strongMembers(textMembers(members, 'independent_reviewer')));
  const continuity = structuredOutputMembers(strongMembers(textMembers(members, 'continuity_editor')));
  return [
    ...mapCreation(deputies, 'context_editor'),
    ...mapCreation(chiefs, 'chief_editor'),
    ...mapCreation(planners, 'planning_writer'),
    ...mapCreation(writers, 'lead_writer'),
    ...mapCreation(reviewers, 'independent_reviewer'),
    ...mapCreation(continuity, 'settlement_editor')
  ];
}

export function characterRosterFromGlobal(
  members: readonly V7RosterSourceMember[] = V7_GLOBAL_MEMBERS
): V7CharacterMemberDefinition[] {
  return textMembers(members, 'continuity_editor').map((member, index) => ({
    memberKey: member.memberKey,
    displayName: member.displayName,
    roleKey: 'character_curator',
    enabledByDefault: memberEnabled(member),
    defaultForRole: member.defaultForRole,
    fallbackPriority: index + 1,
    model: textModel(member),
    // 成员不再永久携带题材或阶段偏好；运行时由岗位、工位、题材档案和任务合同编译。
    promptInstruction: ''
  }));
}

export function visualRosterFromGlobal(
  members: readonly V7RosterSourceMember[] = V7_GLOBAL_MEMBERS
): V7VisualMemberDefinition[] {
  return members.filter((member) => memberEnabled(member) && member.fixedRoleKey === 'visual_renderer')
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority)
    .map((member) => ({
      memberKey: member.memberKey,
      displayName: member.displayName,
      roleKey: member.fixedRoleKey,
      publicRoleName: '封面画师',
      publicResponsibility: '执行主编整理好的制作单，交付可保存、可下载的封面。',
      avatarPath: '/avatars/team-collage-source.jpg',
      provider: member.model.provider,
      defaultModelId: member.model.modelId,
      plan: member.model.plan,
      enabledByDefault: memberEnabled(member)
    } as V7VisualMemberDefinition));
}

function mapCreation(members: readonly V7RosterSourceMember[], roleKey: V7CreationMemberDefinition['roleKey']): V7CreationMemberDefinition[] {
  return members.map((member, index) => ({
    memberKey: member.memberKey,
    displayName: member.displayName,
    roleKey,
    fallbackPriority: index + 1,
    defaultForRole: index === 0,
    enabledByDefault: memberEnabled(member),
    model: textModel(member),
    promptInstruction: ''
  }));
}

function opening(
  member: V7RosterSourceMember,
  roleKey: V7OpeningMemberDefinition['roleKey'],
  fallbackPriority: number
): V7OpeningMemberDefinition {
  return {
    memberKey: member.memberKey,
    displayName: member.displayName,
    roleKey,
    enabledByDefault: memberEnabled(member),
    defaultForRole: member.defaultForRole,
    // 管理后台的交接序号允许因成员下岗形成空档；节点任务冻结的是
    // 当前在岗队列，所以必须重新编号，避免历史配置空档或重复阻断新任务。
    fallbackPriority,
    model: textModel(member),
    promptInstruction: ''
  };
}

function setting(member: V7RosterSourceMember, roleKey: V7SettingMemberDefinition['roleKey'], fallbackPriority: number, publicResponsibility: string): V7SettingMemberDefinition {
  return {
    memberKey: member.memberKey,
    displayName: member.displayName,
    roleKey,
    publicResponsibility,
    enabledByDefault: memberEnabled(member),
    fallbackPriority,
    model: textModel(member)
  };
}

function planning(member: V7RosterSourceMember, roleKey: V7PlanningRoleKey, fallbackPriority: number, defaultForRole: boolean): V7PlanningMemberDefinition {
  return {
    memberKey: member.memberKey,
    displayName: member.displayName,
    roleKey,
    enabledByDefault: memberEnabled(member),
    defaultForRole,
    fallbackPriority,
    model: textModel(member),
    promptInstruction: ''
  };
}

function textMembers(members: readonly V7RosterSourceMember[], roleKey: V7FixedRoleKey): V7RosterSourceMember[] {
  return members.filter((member) => member.fixedRoleKey === roleKey && memberEnabled(member) && member.model.plan !== 'image')
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
}

function strongMembers(members: readonly V7RosterSourceMember[]): V7RosterSourceMember[] {
  const approved = new Set(['kimi-k3', 'deepseek-v4-pro', 'glm-5.3']);
  return members.filter((member) => approved.has(member.model.modelId));
}

/**
 * GLM 5.3 remains an author-selectable strong member.  Real local runs on
 * 2026-08-29 showed that its current subscription
 * endpoint can consume a bounded structured-output allowance in an internal
 * thinking block and return no visible JSON.  Stable direct-output models must
 * therefore be attempted first for unattended structured nodes; this does not
 * disable GLM or change any frozen historical task.
 */
function structuredOutputMembers(members: readonly V7RosterSourceMember[]): V7RosterSourceMember[] {
  return [
    ...members.filter((member) => !member.model.modelId.startsWith('glm-5.3')),
    ...members.filter((member) => member.model.modelId.startsWith('glm-5.3'))
  ];
}

/**
 * Preserve the administrator's reviewer priority. The default registry and
 * migration put Kimi K3 first because the bounded review route disables its
 * hidden thinking: the real chapter-8 run returned a valid evidence review in
 * 17.8 seconds, while GLM 5.3 consumed 18,400 output tokens and returned no
 * report.  An administrator can still change this order in the governance
 * console; runtime code must not silently replace that decision.
 */
function reviewOutputMembers(members: readonly V7RosterSourceMember[]): V7RosterSourceMember[] {
  return [...members].sort((left, right) => left.fallbackPriority - right.fallbackPriority);
}

function textModel(member: V7RosterSourceMember): V7MemberModelBinding {
  if (member.model.plan === 'image') throw new Error(`${member.displayName}不是文本成员`);
  return member.model;
}

function memberEnabled(member: V7RosterSourceMember): boolean {
  return 'enabled' in member ? member.enabled : member.enabledByDefault;
}
