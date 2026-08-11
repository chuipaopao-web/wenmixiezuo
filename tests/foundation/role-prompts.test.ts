import { describe, expect, it } from 'vitest';
import { buildRoleSystemPrompt, rolePromptDefinitions } from '../../apps/api/src/domain/role-prompts.js';
import { buildRuntimeRoleSystemPrompt } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';

describe('九岗位定位提示词', () => {
  it('九个岗位都具备完整且互不混淆的运行约束', () => {
    expect(rolePromptDefinitions).toHaveLength(9);
    expect(new Set(rolePromptDefinitions.map((item) => item.roleKey)).size).toBe(9);
    for (const role of rolePromptDefinitions) {
      expect(role.identity.length).toBeGreaterThan(1);
      expect(role.positioning.length).toBeGreaterThan(10);
      expect(role.responsibilities.length).toBeGreaterThanOrEqual(3);
      expect(role.outputs.length).toBeGreaterThanOrEqual(2);
      expect(role.boundaries.length).toBeGreaterThanOrEqual(3);
      expect(role.memoryPolicy.length).toBeGreaterThan(10);
      expect(role.tools.length).toBeGreaterThanOrEqual(1);
      expect(role.stopConditions.length).toBeGreaterThanOrEqual(2);
      const systemPrompt = buildRoleSystemPrompt(role.roleKey, 'discussion');
      expect(systemPrompt).toContain(role.identity);
      expect(systemPrompt).toContain('模型本身不直接调用工具');
    }
  });

  it('主编、主笔、审校和研究岗位包含不可省略的硬门禁', () => {
    expect(buildRoleSystemPrompt('chief_editor', 'discussion')).toContain('老板是最终决策者');
    expect(buildRoleSystemPrompt('writer', 'novel_writer')).toContain('优先输出2700至3200');
    expect(buildRoleSystemPrompt('writer', 'novel_writer')).toContain('不得少于2350或超过3650');
    expect(buildRoleSystemPrompt('reviewer', 'novel_reviewer')).toContain('JSON');
    const synthesis = buildRoleSystemPrompt('chief_editor', 'review_synthesis');
    expect(synthesis).toContain('recommendedVerdict');
    expect(synthesis).toContain('priorityIssueIndexes');
    expect(synthesis).toContain('只综合三席');
    expect(buildRoleSystemPrompt('researcher', 'discussion')).toContain('来源');
    expect(buildRoleSystemPrompt('researcher', 'discussion')).toContain('当前模型调用不直接联网');
  });

  it('当前十一人团队使用各自真实身份而不是继承主岗位姓名', () => {
    const deputyEditor = buildRuntimeRoleSystemPrompt('deputy_editor', 'discussion');
    const secondScreenwriter = buildRuntimeRoleSystemPrompt('second_screenwriter', 'discussion');
    const backupWriter = buildRuntimeRoleSystemPrompt('backup_writer', 'novel_writer');

    expect(deputyEditor).toContain('西施（副编）');
    expect(deputyEditor).not.toContain('貂蝉（主编）');
    expect(secondScreenwriter).toContain('红玉（编剧）');
    expect(secondScreenwriter).not.toContain('婉儿（编剧）');
    expect(backupWriter).toContain('湘君（副笔）');
    expect(backupWriter).not.toContain('秋香（主笔）');
  });

  it('十一名成员都使用具体专业身份、核心专长和差异化方法', () => {
    const prompts = [
      ['chief_editor', '长篇网文主编', '只推进当前最需要确认的一步'],
      ['deputy_editor', '流程接管编辑', '未接管时只报告遗漏和风险'],
      ['lead_screenwriter', '长篇类型小说编剧', '不超过五十章的完整事件弧'],
      ['second_screenwriter', '结构挑战者', '不为猎奇强行反转'],
      ['setting', '连续性编辑', '明确事实、合理推断和未知'],
      ['lead_writer', '长篇类型小说作者', '人物通过选择、行动和后果推动场景'],
      ['backup_writer', '接替写手', '先核对活动写手、版本和接管原因'],
      ['literary_reviewer', '小说文学编辑', '避免把全文修成同一种安全腔'],
      ['experience_reviewer', '读者体验编辑', '区分有意留白与信息缺失'],
      ['researcher', '事实核查员', '区分事实、争议、推断与创作许可'],
      ['copyright', '原创性风险编辑', '不用换名改写规避']
    ] as const;
    for (const [roleKey, identity, method] of prompts) {
      const prompt = buildRuntimeRoleSystemPrompt(roleKey, 'discussion');
      expect(prompt).toContain('专业身份：');
      expect(prompt).toContain('核心专长：');
      expect(prompt).toContain('工作方法：');
      expect(prompt).toContain(identity);
      expect(prompt).toContain(method);
    }
  });

  it('岗位专业化不会把个人偏好固化为全书文风', () => {
    for (const roleKey of ['chief_editor', 'lead_screenwriter', 'setting', 'literary_reviewer'] as const) {
      const prompt = buildRuntimeRoleSystemPrompt(roleKey, 'discussion');
      expect(prompt).toContain('岗位个人偏好不是全书固定文风');
      expect(prompt).toContain('合理惊喜');
    }
    const writer = buildRuntimeRoleSystemPrompt('lead_writer', 'novel_writer');
    expect(writer).toContain('能随本书题材与当前剧情调整技法');
    expect(writer).not.toContain('大神作者');
  });

  it('所有面向作者的成员讨论都要求使用具体的大白话', () => {
    for (const roleKey of rolePromptDefinitions.map((role) => role.roleKey)) {
      const prompt = buildRoleSystemPrompt(roleKey, 'discussion');
      expect(prompt).toContain('作者平时会说的话');
      expect(prompt).toContain('人物姓名');
      expect(prompt).toContain('具体动作');
      expect(prompt).toContain('不要用“结构边界”');
    }
    expect(buildRoleSystemPrompt('writer', 'novel_writer')).not.toContain('不要用“结构边界”');
    expect(buildRoleSystemPrompt('reviewer', 'novel_reviewer')).not.toContain('作者平时会说的话');
  });

  it('主笔先消化章纲再写场景，并保留明确的自由创作区', () => {
    const prompt = buildRuntimeRoleSystemPrompt('lead_writer', 'novel_writer');
    expect(prompt).toContain('不要把章纲字段、设定标签或检查清单逐项翻译进正文');
    expect(prompt).toContain('人物因欲望、认知和代价作出选择');
    expect(prompt).toContain('属于自由创作区');
    expect(prompt).toContain('允许留白');
    expect(prompt).toContain('只输出正文');
    expect(prompt.length).toBeLessThan(2_500);
  });
});
