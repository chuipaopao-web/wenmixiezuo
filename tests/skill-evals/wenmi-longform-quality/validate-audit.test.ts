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
  it('接受包含完整能力链和E0至E4证据的审计', () => {
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
});
