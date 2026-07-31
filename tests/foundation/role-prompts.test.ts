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
    expect(buildRoleSystemPrompt('writer', 'novel_writer')).toContain('2500至3500');
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
