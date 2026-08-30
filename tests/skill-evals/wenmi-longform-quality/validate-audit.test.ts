import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const script = resolve(root, '.agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs');
const fixtures = resolve(root, 'tests/skill-evals/wenmi-longform-quality/fixtures');

function validate(fixture: string) {
  return spawnSync(process.execPath, [script, resolve(fixtures, fixture)], {
    cwd: root,
    encoding: 'utf8'
  });
}

describe('wenmi-longform-quality审计格式门禁', () => {
  it('接受包含完整能力链、创造性保护和E0至E4证据的审计', () => {
    const result = validate('audit-complete.md');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS:');
    expect(result.stderr).toBe('');
  });

  it('拒绝没有反例的审计', () => {
    const result = validate('audit-missing-counterexample.md');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('缺少反例');
  });

  it('拒绝无证据的长篇质量越界声明', () => {
    const result = validate('audit-overclaim.md');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('存在越界声明');
  });

  it('拒绝缺少创造性与输出质量保护的审计', () => {
    const result = validate('audit-missing-creativity.md');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('缺少章节: 创造性与输出质量保护');
  });

  it('拒绝把所有创作机械锁死在章纲中的方案', () => {
    const result = validate('audit-overconstrained.md');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('存在压制创造性的绝对约束');
  });

  it('允许在反例章节引用过度约束主张，只审查最终设计是否采用', () => {
    const result = validate('audit-quotes-overconstraint.md');


    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS:');
  });

});
