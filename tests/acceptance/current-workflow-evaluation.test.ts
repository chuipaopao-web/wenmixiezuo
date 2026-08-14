import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowScenarios } from '../../scripts/evaluation/current-workflow-scenarios.mjs';

describe('当前工作流验收脚本', () => {
  it('可配置章节与题材流程使用对象接口并明确区分确定性工程证据', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/evaluation/run-current-workflow-twenty-chapters-e2e.mjs'), 'utf8');
    expect(script).not.toContain('/messages');
    expect(script).toContain('/collaboration/start');
    expect(script).toContain('/collaboration/synthesize');
    expect(script).toContain('/setting-baseline/confirm');
    expect(script).toContain('/event-sequence/initialize');
    expect(script).toContain('/chapter-sequence/initialize');
    expect(script).toContain('/chapter-outlines/freeze');
    expect(script).toContain('const TOTAL_CHAPTERS = EVENT_COUNT * CHAPTERS_PER_EVENT');
    expect(script).toContain('evidenceLevel: `E2-current-workflow-${RELEASE_TARGET_CHAPTERS}-chapters-${SCENARIO.key}`');
    expect(script).toContain('scenarioName: SCENARIO.displayName');
    expect(script).toContain('[20, 50, 100, 200]');
    expect(script).toContain('TARGET_VOLUME_COUNT');
    expect(script).toContain('assertManuscriptIsNotTemplateCopies');
    expect(script).toContain('发布级文学质量仍需要人工通读确认');
    expect(script).toContain('WENMI_RELEASE_OWNER_AUTHORIZED_BOOK_ID');
    expect(script).toContain('ebc3b29e-c0d4-45e9-b839-bb0ee2999501');
    expect(script).toContain('bookId === OWNER_AUTHORIZED_BOOK_ID');
    expect(script).toContain('OWNER_AUTHORIZED_BATCH_CAP = 3');
    expect(script).toContain('batchStartupGate');
    expect(script).toContain('owner_authorized_batch_completed');
    expect(script).toContain('item.target_id === expectedVersionId');
    expect(script).not.toContain('item.task_id === taskId');
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

  it('发布级第二卷使用当前书专属方向而不是复用第一卷夹具', () => {
    const xianxia = workflowScenarios.release_xianxia!.volumeIdeaFor(2);
    expect(xianxia).toContain('第二卷');
    expect(xianxia).toContain('陆沉星');
    expect(xianxia).toContain('第一卷真实结算');
    expect(xianxia).not.toContain('沈砚');
    expect(xianxia).not.toContain('试剑台');

    const esports = workflowScenarios.release_esports!.volumeIdeaFor(2);
    expect(esports).toContain('第二卷');
    expect(esports).toContain('第一卷真实赛果');
    expect(esports).toContain('雨夜替补');
    expect(esports).not.toContain('顾野');
    expect(esports).not.toContain('公开试训逆选');
  });
});
