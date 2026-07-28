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
    if (row === undefined) throw new Error('缺少老板确认的作品风格基线');
    const style = JSON.parse(row.content_json) as StyleBaselineInput;
    const direction = [
      `语言气质：${style.languageTones.join('、')}`,
      `情绪基调：${style.emotionalTones.join('、')}`,
      `节奏与爽感：${style.pacingAndPayoff.join('、')}`,
      style.atmospheres.length > 0 ? `叙事氛围：${style.atmospheres.join('、')}` : ''
    ].filter(Boolean).join('；');
    const adaptive = style.adaptiveRules.length > 0
      ? style.adaptiveRules.join('；')
      : '按战斗、情感、悬疑和日常场景的功能调整表现强度，不按章机械打卡';
    const avoid = style.avoidPatterns.length > 0
      ? style.avoidPatterns.join('；')
      : '避免人物同声、段子硬插、无代价碾压和为追求爽点破坏因果';
    return {
      styleVersionId: row.style_version_id,
      capsule: `作品风格长期基线：${direction}。场景动态适配：${adaptive}。禁止退化：${avoid}。风格是软方向；人物声音、合理惊喜和本章场景功能优先，不得机械重复。`
    };
  }
}
