import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';

export type PlanningStage =
  | 'style_in_progress' | 'style_ready' | 'setting_in_progress' | 'setting_ready'
  | 'master_outline_in_progress' | 'master_outline_ready'
  | 'chapter_outline_ready' | 'writing_enabled';

export interface PlanningStateView {
  version: number;
  stage: PlanningStage;
  stageLabel: string;
  missing: string[];
  nextAction: string;
}

const labels: Record<PlanningStage, string> = {
  style_in_progress: '补充表达调色板',
  style_ready: '表达策略可用',
  setting_in_progress: '完善设定大纲',
  setting_ready: '设定大纲已确认',
  master_outline_in_progress: '讨论剧情总纲',
  master_outline_ready: '剧情总纲已确认',
  chapter_outline_ready: '近期章纲已确认',
  writing_enabled: '可以正式写作'
};

export class PlanningStateService {
  private readonly repository: PlanningWorkflowRepository;
  public constructor(database: DatabaseSync) {
    this.repository = new PlanningWorkflowRepository(database);
  }

  public get(scope: BookScope): PlanningStateView {
    assertBookScope(scope);
    const row = this.repository.planningState(scope);
    if (row === undefined) throw new Error('本书规划状态尚未建立');
    const stage = normalizeLegacyStage(row.stage, row.master_outline_version_id);
    const missing: string[] = [];
    if (row.active_style_version_id === null) missing.push('表达策略记录');
    if (row.setting_baseline_version_id === null && !['style_in_progress', 'style_ready'].includes(stage)) missing.push('设定基线');
    if (row.master_outline_version_id === null && ['master_outline_ready', 'chapter_outline_ready', 'writing_enabled'].includes(stage)) {
      missing.push('剧情总纲');
    }
    return {
      version: row.version,
      stage,
      stageLabel: labels[stage],
      missing,
      nextAction: nextAction(stage)
    };
  }
}

function nextAction(stage: PlanningStage): string {
  if (stage === 'style_in_progress') return '可以直接进入设定大纲；表达调色板可稍后补充';
  if (stage === 'style_ready' || stage === 'setting_in_progress') return '按顺序完善并确认设定大纲';
  if (stage === 'setting_ready' || stage === 'master_outline_in_progress') return '与主编讨论并确认剧情总纲';
  if (stage === 'master_outline_ready') return '继续讨论当前故事弧，只细化未来1—3章章纲';
  if (stage === 'chapter_outline_ready') return '确认下一章并启动正式写作';
  return '继续当前正式创作流程';
}

function normalizeLegacyStage(stage: string, masterOutlineVersionId: string | null): PlanningStage {
  if (stage === 'volume_outline_in_progress' || stage === 'volume_outline_ready') {
    return masterOutlineVersionId === null ? 'master_outline_in_progress' : 'master_outline_ready';
  }
  return stage as PlanningStage;
}
