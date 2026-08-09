import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';

const script = resolve(process.cwd(), 'scripts', 'release-ledger.mjs');
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'wenmi-ledger-'));
  directories.push(directory);
  writeFileSync(resolve(directory, 'RELEASE_ID'), 'wm-longform-test\n', 'utf8');
  return directory;
}

function run(cwd: string, ...args: string[]): Record<string, unknown> {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || `release ledger exited ${result.status}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe('长篇 release 机器账本', () => {
  it('幂等初始化当前九段合同并返回版本化 release 状态', () => {
    const cwd = fixture();
    run(cwd, 'init');
    run(cwd, 'init');
    const status = run(cwd, 'status');
    expect(status.release).toMatchObject({ release_id: 'wm-longform-test', status: 'active', definition_version: 'object-workflow-v3' });
    expect(status.stages).toHaveLength(9);
    expect((status.stages as Array<{ stage: number; status: string }>).map((row) => row.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect((status.stages as Array<{ goal: string }>)[3]?.goal).toContain('混合检索');
  });

  it('所有阶段 passed 前拒绝把 release 标为 complete', () => {
    const cwd = fixture();
    run(cwd, 'init');
    expect(() => run(cwd, 'release', 'complete')).toThrow(/RELEASE_STAGES_NOT_PASSED/u);
    for (let stage = 0; stage <= 8; stage += 1) run(cwd, 'stage', String(stage), 'passed');
    expect(run(cwd, 'release', 'complete')).toMatchObject({ releaseId: 'wm-longform-test', status: 'complete' });
  });

  it('证据只追加并在状态中公开计数', () => {
    const cwd = fixture();
    run(cwd, 'init');
    run(cwd, 'evidence', '0', 'baseline', 'npm test', 'passed', 'abc123');
    run(cwd, 'evidence', '0', 'baseline', 'npm test', 'passed-again', 'def456');
    expect(run(cwd, 'status').evidenceCount).toBe(2);
    expect(readFileSync(resolve(cwd, 'RELEASE_ID'), 'utf8').trim()).toBe('wm-longform-test');
  });
});
