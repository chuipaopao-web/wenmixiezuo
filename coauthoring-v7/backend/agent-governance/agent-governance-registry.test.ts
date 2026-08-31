import { describe, expect, it } from 'vitest';
import {
  V7_GLOBAL_MEMBERS,
  V7_ROLE_CONTRACTS,
  V7_TASK_TEMPERATURE_POLICIES,
  effectiveTemperature,
  independentReviewers,
  membersForFixedRole,
  validateGlobalAgentRegistry
} from './agent-governance-registry.js';
import {
  creationRosterFromGlobal,
  openingRosterFromGlobal,
  planningRosterFromGlobal,
  settingRosterFromGlobal
} from './runtime-rosters.js';
import { buildPlanningFallbackChain } from '../planning-methods/planning-editorial-runtime.js';

describe('V7统一成员与模型治理', () => {
  it('全局成员一人一岗且岗位数量完整', () => {
    expect(validateGlobalAgentRegistry()).toEqual([]);
    expect(V7_GLOBAL_MEMBERS).toHaveLength(22);
    expect(new Set(V7_GLOBAL_MEMBERS.map((member) => member.displayName)).size).toBe(22);
    expect(membersForFixedRole('planning_writer').map((member) => member.modelProfileKey)).toEqual([
      'deepseek-v4-pro', 'glm-5.3', 'kimi-k3'
    ]);
    expect(membersForFixedRole('lead_writer')).toHaveLength(6);
    expect(membersForFixedRole('independent_reviewer')).toHaveLength(3);
    expect(V7_GLOBAL_MEMBERS.filter((member) => member.modelProfileKey === 'doubao-seed-2.1-turbo')
      .every((member) => member.fixedRoleKey === 'lead_writer')).toBe(true);
    expect(V7_GLOBAL_MEMBERS.some((member) => member.modelProfileKey === 'minimax-m3')).toBe(false);
  });

  it('六名主笔分别绑定老板指定的六种模型', () => {
    expect(membersForFixedRole('lead_writer').map((member) => member.modelProfileKey).toSorted()).toEqual([
      'deepseek-v4-flash', 'deepseek-v4-pro', 'doubao-seed-2.1-turbo', 'glm-5.3', 'kimi-k2.7-code', 'kimi-k3'
    ].toSorted());
  });

  it('规划运行名册只保留固定岗位，三个方案槽轮换三名不同主编', () => {
    const effective = effectiveGlobalMembers();
    const roster = planningRosterFromGlobal(effective);
    expect(new Set(roster.map((member) => member.memberKey)).size).toBe(roster.length);
    expect(roster.some((member) => (member.roleKey as string) === 'structure_deputy'
      || (member.roleKey as string) === 'commercial_deputy')).toBe(false);
    expect(roster.some((member) => (member.roleKey as string) === 'planning_maintainer')).toBe(false);
    expect(roster.filter((member) => member.roleKey === 'continuity_editor')).toHaveLength(3);
    const primaries = (['chief_editor', 'structure_deputy', 'commercial_deputy'] as const)
      .map((seat) => buildPlanningFallbackChain(seat, { members: roster })[0]?.memberKey);
    expect(new Set(primaries).size).toBe(3);
    expect((['chief_editor', 'structure_deputy', 'commercial_deputy'] as const).every((seat) =>
      buildPlanningFallbackChain(seat, { members: roster })[0]?.roleKey === 'chief_editor'
    )).toBe(true);
  });

  it('各运行时名册只引用全局成员身份，同一节点岗位不会重复登记', () => {
    const effective = effectiveGlobalMembers();
    const globalKeys = new Set(V7_GLOBAL_MEMBERS.map((member) => member.memberKey));
    const rosters = [
      openingRosterFromGlobal(effective),
      settingRosterFromGlobal(effective),
      planningRosterFromGlobal(effective),
      creationRosterFromGlobal(effective)
    ];
    for (const roster of rosters) {
      expect(roster.every((member) => globalKeys.has(member.memberKey))).toBe(true);
      const assignments = roster.map((member) => `${member.roleKey}:${member.memberKey}`);
      expect(new Set(assignments).size).toBe(assignments.length);
    }
    expect(creationRosterFromGlobal(effective).some((member) => (member.roleKey as string) === 'outline_writer')).toBe(false);
  });

  it('新任务省略治理快照时仍只使用七岗位全局成员，不回退旧编剧编号', () => {
    const opening = openingRosterFromGlobal();
    const setting = settingRosterFromGlobal();
    const globalKeys = new Set(V7_GLOBAL_MEMBERS.map((member) => member.memberKey));
    expect(opening.every((member) => globalKeys.has(member.memberKey))).toBe(true);
    expect(setting.every((member) => globalKeys.has(member.memberKey))).toBe(true);
    expect(opening.some((member) => member.memberKey === 'planner-deepseek-v4-pro')).toBe(true);
    expect([...opening, ...setting].some((member) => (
      member.memberKey.startsWith('screenwriter-') || member.memberKey.startsWith('setting-writer-')
    ))).toBe(false);
  });

  it('开书任务会把当前在岗成员重新编号，不受后台交接序号空档或重复影响', () => {
    const effective = effectiveGlobalMembers().map((member) => ({ ...member }));
    const disabled = effective.find((member) => member.memberKey === 'planner-kimi-k3');
    const duplicated = effective.find((member) => member.memberKey === 'planner-glm-5-3');
    expect(disabled).toBeDefined();
    expect(duplicated).toBeDefined();
    disabled!.enabled = false;
    duplicated!.fallbackPriority = 5;
    const opening = openingRosterFromGlobal(effective);
    for (const roleKey of ['chief_editor', 'screenwriter'] as const) {
      const priorities = opening.filter((member) => member.roleKey === roleKey)
        .map((member) => member.fallbackPriority);
      expect(priorities).toEqual(priorities.map((_, index) => index + 1));
      expect(new Set(priorities).size).toBe(priorities.length);
    }
  });

  it('无人值守的结构化节点优先使用能稳定直出结果的强模型，GLM仍保留为可选兜底', () => {
    const effective = effectiveGlobalMembers();
    const opening = openingRosterFromGlobal(effective);
    expect(opening.filter((member) => member.roleKey === 'chief_editor').map((member) => member.model.modelId))
      .toEqual(['deepseek-v4-pro', 'kimi-k3', 'glm-5.3']);
    expect(opening.filter((member) => member.roleKey === 'screenwriter').map((member) => member.model.modelId))
      .toEqual(['deepseek-v4-pro', 'kimi-k3', 'glm-5.3']);

    const creation = creationRosterFromGlobal(effective);
    expect(creation.filter((member) => member.roleKey === 'independent_reviewer').map((member) => member.model.modelId))
      .toEqual(['kimi-k3', 'glm-5.3', 'deepseek-v4-pro']);
    expect(creation.filter((member) => member.roleKey === 'settlement_editor').map((member) => member.model.modelId))
      .toEqual(['deepseek-v4-pro', 'kimi-k3', 'glm-5.3']);

    const planning = planningRosterFromGlobal(effective);
    expect(planning.filter((member) => member.roleKey === 'continuity_editor').map((member) => member.model.modelId))
      .toEqual(['deepseek-v4-pro', 'kimi-k3', 'glm-5.3']);
    expect(buildPlanningFallbackChain('continuity_editor', { members: planning })[0]?.model.modelId)
      .toBe('deepseek-v4-pro');
  });

  it('独立审查排除与主笔相同的模型', () => {
    const writer = membersForFixedRole('lead_writer').find((member) => member.modelProfileKey === 'glm-5.3');
    expect(writer).toBeDefined();
    const reviewers = independentReviewers(writer!);
    expect(reviewers).toHaveLength(2);
    expect(reviewers.some((reviewer) => reviewer.modelProfileKey === 'glm-5.3')).toBe(false);
  });

  it('温度只能在任务策略安全区间内调整', () => {
    expect(effectiveTemperature('manuscript', .5)).toBe(.84);
    expect(effectiveTemperature('settlement', -.5)).toBe(.06);
    expect(V7_TASK_TEMPERATURE_POLICIES).toHaveLength(20);
    expect(V7_ROLE_CONTRACTS.every((role) => role.capabilities.length > 0 && role.tools.length > 0)).toBe(true);
  });

  it('每种任务都有明确岗位承担，记录编辑覆盖资料整理与规划回填', () => {
    const covered = new Set(V7_ROLE_CONTRACTS.flatMap((role) => role.taskKinds));
    expect(V7_TASK_TEMPERATURE_POLICIES.map((policy) => policy.taskKind)
      .filter((taskKind) => !covered.has(taskKind))).toEqual([]);
    const continuity = V7_ROLE_CONTRACTS.find((role) => role.roleKey === 'continuity_editor');
    expect(continuity?.taskKinds).toEqual(expect.arrayContaining([
      'character_context', 'character_maintenance', 'planning_maintenance', 'settlement'
    ]));
  });
});

function effectiveGlobalMembers() {
  return V7_GLOBAL_MEMBERS.map((member) => ({
    ...member, enabled: member.enabledByDefault, temperatureAdjustment: 0, governanceRevision: 1
  }));
}
