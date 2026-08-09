import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('当前工作流验收脚本', () => {
  it('二十章双事件流程使用对象接口并明确区分确定性工程证据', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/evaluation/run-current-workflow-twenty-chapters-e2e.mjs'), 'utf8');
    expect(script).not.toContain('/messages');
    expect(script).toContain('/collaboration/start');
    expect(script).toContain('/collaboration/synthesize');
    expect(script).toContain('/setting-baseline/confirm');
    expect(script).toContain('/event-sequence/initialize');
    expect(script).toContain('/chapter-sequence/initialize');
    expect(script).toContain('/chapter-outlines/freeze');
    expect(script).toContain("evidenceLevel: 'E2-current-workflow-twenty-chapters'");
    expect(script).toContain('不代表真实套餐模型文学质量');
  });

  it('数据审计逐层检查规划、正文绑定与数据库完整性', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/evaluation/full-flow-data-audit.mjs'), 'utf8');
    expect(script).toContain('current-workflow-data-audit-v2');
    expect(script).toContain('event_chapter_outline_versions');
    expect(script).toContain('chapter_pipeline_runs');
    expect(script).toContain('boundArtifactOutlineVersionId');
    expect(script).toContain('PRAGMA integrity_check');
    expect(script).toContain('PRAGMA foreign_key_check');
  });
});
