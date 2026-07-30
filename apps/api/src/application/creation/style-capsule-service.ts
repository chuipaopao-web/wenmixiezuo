import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { StyleBaselineInput } from '../../contracts/style-baseline.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';

export class StyleCapsuleService {
  private readonly repository: PlanningWorkflowRepository;
  public constructor(database: DatabaseSync) {
    this.repository = new PlanningWorkflowRepository(database);
  }

  public active(scope: BookScope): { styleVersionId: string; capsule: string } {
    assertBookScope(scope);
    const row = this.repository.selectedStyle(scope);
    if (row === undefined) throw new Error('缺少可追溯的表达策略记录');
    const style = JSON.parse(row.content_json) as StyleBaselineInput;
    const direction = [
      style.languageTones.length > 0 ? `可用语言气质：${style.languageTones.join('、')}` : '',
      style.emotionalTones.length > 0 ? `可用情绪色彩：${style.emotionalTones.join('、')}` : '',
      style.pacingAndPayoff.length > 0 ? `可用节奏策略：${style.pacingAndPayoff.join('、')}` : '',
      style.atmospheres.length > 0 ? `叙事氛围：${style.atmospheres.join('、')}` : ''
    ].filter(Boolean).join('；') || '未预设固定表达调色板';
    const adaptive = style.adaptiveRules.length > 0
      ? style.adaptiveRules.join('；')
      : '按战斗、情感、悬疑和日常场景的功能调整表现强度，不按章机械打卡';
    const avoid = style.avoidPatterns.length > 0
      ? style.avoidPatterns.join('；')
      : '避免人物同声、段子硬插、无代价碾压和为追求爽点破坏因果';
    return {
      styleVersionId: row.style_version_id,
      capsule: `表达调色板：${direction}。本章按场景目标确定主情绪、必要的情绪转折、相配的语言气质和节奏，不得把调色板全部同时执行。动态规则：${adaptive}。禁止退化：${avoid}。人物声音、因果、合理惊喜和本章功能优先。`
    };
  }
}
