import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';

type ConfirmablePlanningType = 'master_outline' | 'volume_outline' | 'chapter_outline';

export class PlanningStageArtifactService {
  private readonly repository: PlanningWorkflowRepository;
  public constructor(database: DatabaseSync, private readonly clock: Clock) {
    this.repository = new PlanningWorkflowRepository(database);
  }

  public confirm(
    scope: BookScope,
    expectedPlanningVersion: number,
    artifactVersionId: string,
    artifactType: ConfirmablePlanningType
  ): { version: number; stage: string; artifactVersionId: string } {
    assertBookScope(scope);
    const artifact = this.repository.artifactVersion(scope, artifactVersionId);
    if (artifact === undefined || artifact.artifact_type !== artifactType || artifact.status !== 'selected') {
      throw new DomainError(errorCodes.validation, '规划版本不存在、越权或类型不匹配');
    }
    const policy = {
      master_outline: {
        allowed: ['setting_ready', 'master_outline_in_progress'],
        stage: 'master_outline_ready',
        column: 'master_outline_version_id'
      },
      volume_outline: {
        allowed: ['master_outline_ready', 'volume_outline_in_progress'],
        stage: 'volume_outline_ready',
        column: 'volume_outline_version_id'
      },
      chapter_outline: {
        allowed: ['volume_outline_ready', 'chapter_outline_ready', 'writing_enabled'],
        stage: 'chapter_outline_ready',
        column: null
      }
    } as const;
    const rule = policy[artifactType];
    const state = this.repository.planningState(scope);
    if (state === undefined || state.version !== expectedPlanningVersion || !rule.allowed.includes(state.stage as never)) {
      throw new DomainError(errorCodes.bookVersionConflict, '规划阶段已经变化或尚未完成上游确认', { current: state }, true, 409);
    }
    if (artifactType === 'master_outline' && state.setting_baseline_version_id === null) {
      throw new DomainError(errorCodes.operationIncomplete, '确认剧情总纲前必须先确认设定基线', {}, false, 409);
    }
    if (artifactType === 'volume_outline' && state.master_outline_version_id === null) {
      throw new DomainError(errorCodes.operationIncomplete, '确认卷纲前必须先确认剧情总纲', {}, false, 409);
    }
    if (artifactType === 'chapter_outline' && state.volume_outline_version_id === null) {
      throw new DomainError(errorCodes.operationIncomplete, '确认章纲前必须先确认当前卷纲', {}, false, 409);
    }
    const changed = this.repository.advanceArtifact(
      scope, expectedPlanningVersion, rule.stage, rule.column, artifactVersionId, this.clock.now().toISOString()
    );
    if (!changed) throw new DomainError(errorCodes.bookVersionConflict, '规划状态已经变化', {}, true, 409);
    return { version: expectedPlanningVersion + 1, stage: rule.stage, artifactVersionId };
  }
}
