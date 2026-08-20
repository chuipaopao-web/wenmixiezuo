import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowScenarios } from '../../scripts/evaluation/current-workflow-scenarios.mjs';

describe('当前工作流验收脚本', () => {
  it('当前分层规划使用管理员真实HTTP会话并覆盖事件链、黄金三章与第一章冻结', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/evaluation/run-layered-admin-planning-smoke.mjs'), 'utf8');
    expect(script).not.toContain('/messages');
    expect(script).toContain('/setting-outline-workspace');
    expect(script).toContain('/volume-plans');
    expect(script).toContain('/directions');
    expect(script).toContain('/route-selection');
    expect(script).toContain('/event-chains/generate');
    expect(script).toContain('/story-events/');
    expect(script).toContain('/chapter-sequence/generate');
    expect(script).toContain('/chapter-outlines/freeze');
    expect(script).toContain('firstChapterLaunch');
    expect(script).toContain("assert(!('taskId' in view)");
    expect(script).toContain("assert(!('currentPhase' in view)");
    expect(script).toContain('layered-admin-full-chain-smoke-v2');
    expect(script).toContain('/writing-runs');
    expect(script).toContain('/confirmations/');
    expect(script).toContain('/accept');
    expect(script).toContain('reviewReportCount');
  });

  it('旧长篇脚本只保留纵向资产与E2标签，不冒充分层流程或文学质量完成', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/evaluation/run-current-workflow-twenty-chapters-e2e.mjs'), 'utf8');
    const acceptance = readFileSync(resolve(process.cwd(), 'docs/LAYERED_CREATION_IMPLEMENTATION_AND_ACCEPTANCE.md'), 'utf8');
    expect(script).toContain('[20, 50, 100, 200]');
    expect(script).toContain('workspace.agents.length === 14');
    expect(script).toContain('setting_model_details_redacted');
    expect(script).toContain("verification: 'scoped-production-audit'");
    expect(script).toContain('/setting-baseline/quality-audit');
    expect(script).toContain('/setting-baseline/quality-report');
    expect(script).toContain('hardIssues.length === 0');
    expect(script).toContain('setting-quality-audit-attempt-');
    expect(script).toContain('auditAttempt <= 4');
    expect(script).toContain('SCENARIO.requiredSettingKeys ?? []');
    expect(script).toContain('setting-quality-audit-after-setting-remediation-1');
    expect(script).toContain("item.purpose === 'setting-quality-audit'");
    expect(script).toContain('startOrResumeAuthorGeneration');
    expect(script).toContain('task.idempotencyKey === idempotencyKey && task.taskType === taskType');
    expect(script).toContain('task.idempotencyKey.endsWith(`:${idempotencyKey}`)');
    expect(script).toContain('author_generation_task_retried');
    expect(script).toContain('/directions');
    expect(script).toContain('/route-selection');
    expect(script).toContain('item.sourceTaskId === generationTaskId');
    expect(script).toContain('currentLegacyVersionIds.has(item.legacyVolumePlanVersionId)');
    expect(script).toContain('volumeFusionTaskIds');
    expect(script).toContain('/event-chains/generate');
    expect(script).toContain('eventChainGenerationTaskIds');
    expect(script).not.toContain('forceExactEventPlan');
    expect(script).toContain('TARGET_EVENT_COUNT');
    expect(script).toContain('TARGET_COMPLETED_VOLUME_COUNT');
    expect(script).not.toContain('if (RELEASE_TARGET_CHAPTERS < TOTAL_CHAPTERS) process.exit(0);');
    expect(script).toContain('evidenceLevel: `E2-current-workflow-${RELEASE_TARGET_CHAPTERS}-chapters-${SCENARIO.key}`');
    expect(script).toContain('发布级文学质量仍需要人工通读确认');
    expect(acceptance).toContain('| E4长期验收 | 未开始 |');
  });

  it('仙侠验收把开书明确留待确认的境界体系作为正式补充设定', () => {
    const scenario = workflowScenarios.xianxia!;
    expect(scenario.requiredSettingKeys).toContain('levels');
    const answer = scenario.answerFor({ itemKey: 'levels', label: '等级、境界与晋升', prompt: '' });
    expect(answer).toContain('淬体、引气、凝脉、筑台、金丹、元婴、化神');
    expect(answer).toContain('阵痕');
    expect(answer).toContain('不能替代修为积累');
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
