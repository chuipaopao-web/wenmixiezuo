import { describe, expect, it } from 'vitest';
import { buildRoleSystemPrompt, rolePromptDefinitions } from '../../apps/api/src/domain/role-prompts.js';

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
    expect(buildRoleSystemPrompt('researcher', 'discussion')).toContain('来源');
    expect(buildRoleSystemPrompt('researcher', 'discussion')).toContain('当前模型调用不直接联网');
  });
});
