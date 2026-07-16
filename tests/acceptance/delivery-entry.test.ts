import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('最终交付入口', () => {
  it('提供桌面启动/停止入口和不要求老板执行技术命令的说明', () => {
    const root = process.cwd();
    const start = readFileSync(resolve(root, '文脉写作-启动.cmd'), 'utf8');
    const stop = readFileSync(resolve(root, '文脉写作-停止.cmd'), 'utf8');
    const launcher = readFileSync(resolve(root, 'scripts/start-desktop.ps1'), 'utf8');
    const stopper = readFileSync(resolve(root, 'scripts/stop-desktop.ps1'), 'utf8');
    const guide = readFileSync(resolve(root, 'docs/USER_GUIDE.md'), 'utf8');
    expect(start).toContain('start-desktop.ps1');
    expect(stop).toContain('stop-desktop.ps1');
    expect(launcher).toContain("Start-Process 'http://127.0.0.1:43110'");
    expect(launcher).toContain('npm.cmd run migrate');
    expect(launcher).toContain('$health.data.releaseId -eq $expectedReleaseId');
    expect(launcher).toContain('*<div id="root"></div>*');
    expect(stopper).toContain("scripts/start.mjs");
    expect(stopper).toContain('Refusing to stop');
    expect(guide).toContain('双击项目根目录');
    expect(guide).toContain('确定性假模型');
    expect(guide).toContain('第二物理备份');
  });
});
