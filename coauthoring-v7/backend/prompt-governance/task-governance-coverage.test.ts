import { describe, expect, it } from 'vitest';
import {
  V7_GLOBAL_MEMBERS,
  V7_ROLE_CONTRACTS,
  V7_TASK_TEMPERATURE_POLICIES
} from '../agent-governance/agent-governance-registry.js';
import type { V7AgentTaskKind } from '../agent-governance/agent-governance-contracts.js';
import type {
  V7RolePromptContent,
  V7SkillContent,
  V7WorkstationPromptContent
} from './prompt-governance-contracts.js';
import {
  V7_ROLE_PROMPT_ASSETS,
  V7_TASK_ALLOWED_WORKSTATIONS,
  V7_WORKSTATION_PROMPT_ASSETS,
  defaultSkillAssets
} from './prompt-source-registry.js';

const EXPECTED_TASK_KINDS = [
  'opening_design',
  'opening_review',
  'title_design',
  'setting_recommendation',
  'setting_design',
  'setting_review',
  'planning_context',
  'planning_recipe',
  'planning_tree',
  'planning_review',
  'planning_maintenance',
  'chapter_outline',
  'chapter_outline_review',
  'manuscript',
  'manuscript_review',
  'settlement',
  'character_context',
  'character_maintenance',
  'cover_brief',
  'cover_render'
] as const satisfies readonly V7AgentTaskKind[];

describe('V7 task governance coverage', () => {
  it.each(EXPECTED_TASK_KINDS)('%s has an executable fixed-role policy', (taskKind) => {
    const temperatures = V7_TASK_TEMPERATURE_POLICIES.filter((policy) => policy.taskKind === taskKind);
    expect(temperatures, `${taskKind}必须且只能有一份温度策略`).toHaveLength(1);
    expect(temperatures[0]!.minimumTemperature).toBeLessThanOrEqual(temperatures[0]!.defaultTemperature);
    expect(temperatures[0]!.defaultTemperature).toBeLessThanOrEqual(temperatures[0]!.maximumTemperature);
    expect(temperatures[0]!.rationale.trim()).not.toBe('');

    const roles = V7_ROLE_CONTRACTS.filter((role) => role.taskKinds.includes(taskKind));
    expect(roles.length, `${taskKind}至少需要一个合法固定岗位`).toBeGreaterThan(0);
    for (const role of roles) {
      expect(role.outputContract.trim(), `${taskKind}/${role.roleKey}缺少输出合同`).not.toBe('');
      expect(V7_GLOBAL_MEMBERS.some((member) =>
        member.fixedRoleKey === role.roleKey && member.enabledByDefault
      ), `${taskKind}/${role.roleKey}缺少可执行成员`).toBe(true);
      const prompt = V7_ROLE_PROMPT_ASSETS.find((asset) =>
        asset.status === 'published'
        && (asset.content as V7RolePromptContent).roleKey === role.roleKey
      );
      expect(prompt, `${taskKind}/${role.roleKey}缺少已发布岗位提示`).toBeDefined();
      expect((prompt!.content as V7RolePromptContent).boundaries.length,
        `${taskKind}/${role.roleKey}缺少输出边界`).toBeGreaterThan(0);
    }

    const workstationKeys = V7_TASK_ALLOWED_WORKSTATIONS[taskKind];
    expect(workstationKeys.length, `${taskKind}至少需要一个合法工位`).toBeGreaterThan(0);
    for (const workstationKey of workstationKeys) {
      const prompt = V7_WORKSTATION_PROMPT_ASSETS.find((asset) => {
        const content = asset.content as V7WorkstationPromptContent;
        return asset.status === 'published' && content.workstationKey === workstationKey;
      });
      expect(prompt, `${taskKind}/${workstationKey}缺少已发布工位提示`).toBeDefined();
      const content = prompt!.content as V7WorkstationPromptContent;
      expect(content.taskKinds, `${taskKind}/${workstationKey}没有声明任务资格`).toContain(taskKind);
      expect(content.qualityChecks.length, `${taskKind}/${workstationKey}缺少质量检查`).toBeGreaterThan(0);
      expect(content.stageBoundary.trim(), `${taskKind}/${workstationKey}缺少阶段边界`).not.toBe('');
    }

    const skills = defaultSkillAssets(taskKind);
    expect(skills.length, `${taskKind}至少需要一个默认Skill`).toBeGreaterThan(0);
    for (const skill of skills) {
      const content = skill.content as V7SkillContent;
      expect(skill.status, `${taskKind}/${skill.assetKey}必须使用已发布版本`).toBe('published');
      expect(content.triggerTaskKinds, `${taskKind}/${skill.assetKey}没有声明触发资格`).toContain(taskKind);
      expect(content.outputRequirements.length, `${taskKind}/${skill.assetKey}缺少输出要求`).toBeGreaterThan(0);
    }
  });

  it('does not silently add, remove or duplicate a governed task kind', () => {
    const registered = V7_TASK_TEMPERATURE_POLICIES.map((policy) => policy.taskKind).toSorted();
    expect(new Set(registered).size).toBe(EXPECTED_TASK_KINDS.length);
    expect(registered).toEqual([...EXPECTED_TASK_KINDS].toSorted());
  });
});
