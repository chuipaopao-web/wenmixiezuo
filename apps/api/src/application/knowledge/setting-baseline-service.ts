import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';
import { ContinuationImportRepository } from '../../infrastructure/db/repositories/continuation-import-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { ArtifactService } from '../artifacts/artifact-service.js';
import { SettingOutlineWorkspaceService } from './setting-outline-workspace-service.js';
import {
  resolveContinuationSettingOutlineProfile,
  resolveSettingOutlineProfile,
  type SettingOutlineProfile
} from './setting-outline-profile.js';

export interface SettingBaselineReadiness extends SettingOutlineProfile {
  ready: boolean;
  missing: string[];
  unresolved: string[];
}

export class SettingBaselineService {
  private readonly repository: PlanningWorkflowRepository;
  private readonly continuations: ContinuationImportRepository;
  private readonly artifacts: ArtifactService;
  private readonly workspace: SettingOutlineWorkspaceService;

  public constructor(
    private readonly database: DatabaseSync,
    ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new PlanningWorkflowRepository(database);
    this.continuations = new ContinuationImportRepository(database);
    this.artifacts = new ArtifactService(database, ids, clock);
    this.workspace = new SettingOutlineWorkspaceService(database, clock);
  }

  public inspect(scope: BookScope): SettingBaselineReadiness {
    assertBookScope(scope);
    const profile = this.profile(scope);
    const rows = this.repository.settingStatuses(scope);
    const statuses = new Map(rows.map((row) => [row.item_key, row.item_status]));
    const unresolved = profile.required.filter((key) => {
      const status = statuses.get(key);
      return status === '讨论中' || status === '候选待确认';
    });
    const unresolvedSet = new Set(unresolved);
    const missing = profile.required.filter((key) => statuses.get(key) !== '已确认' && !unresolvedSet.has(key));
    return { ...profile, ready: missing.length === 0 && unresolved.length === 0, missing, unresolved };
  }

  public confirm(scope: BookScope, expectedPlanningVersion: number): { stage: string; version: number } {
    const readiness = this.inspect(scope);
    if (!readiness.ready) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '设定尚未准备完成：题材必备项必须确认，其余可选择稍后补充、刻意留白或不适用',
        { ...readiness },
        false,
        409
      );
    }
    const activeStoryBibleId = this.repository.activeArtifactVersion(scope, 'story_bible');
    if (activeStoryBibleId === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '缺少设定资料版本', {}, false, 409);
    }
    const now = this.clock.now().toISOString();
    return new UnitOfWork(this.database).run(() => {
      const activeStoryBible = this.artifacts.requireVersion(scope, activeStoryBibleId);
      const confirmedItems = this.workspace.list(scope)
        .filter((item) => item.status === '已确认' && item.content !== null)
        .map((item) => ({
          itemKey: item.itemKey,
          groupTitle: item.groupTitle,
          label: item.label,
          content: item.content,
          sourceDiscussionId: item.sourceDiscussionId,
          sourceDecisionId: item.sourceDecisionId,
          confirmedAt: item.confirmedAt
        }));
      const nextStoryBible = this.artifacts.addVersion(scope, activeStoryBible.artifactId, {
        ...activeStoryBible.content,
        settingOutline: {
          schemaVersion: 1,
          confirmedAt: now,
          items: confirmedItems
        }
      }, activeStoryBible.artifactVersionId);
      this.artifacts.select(scope, activeStoryBible.artifactId, nextStoryBible.artifactVersionId);
      this.repository.synchronizeCreationWorkflowAfterSetting(scope, now);
      const synchronized = this.repository.planningState(scope);
      if (
        synchronized?.version === expectedPlanningVersion + 1
        && synchronized.stage === 'setting_ready'
        && synchronized.setting_baseline_version_id === nextStoryBible.artifactVersionId
      ) {
        return { stage: 'setting_ready', version: synchronized.version };
      }
      const changed = this.repository.advanceSetting(
        scope, expectedPlanningVersion, nextStoryBible.artifactVersionId, now
      );
      if (!changed) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '规划状态已经变化，请刷新后重试',
          {},
          true,
          409
        );
      }
      return { stage: 'setting_ready', version: expectedPlanningVersion + 1 };
    });
  }

  private profile(scope: BookScope): SettingOutlineProfile {
    const blueprint = this.repository.openingBlueprint(scope);
    if (blueprint !== undefined) {
      const parsed = JSON.parse(blueprint) as Record<string, unknown>;
      if (Object.keys(parsed).length > 0) {
        return resolveSettingOutlineProfile(parsed as unknown as OpeningBlueprintInput);
      }
    }
    if (this.continuations.latestReadyBaseline(scope) !== undefined) {
      return resolveContinuationSettingOutlineProfile();
    }
    throw new DomainError(errorCodes.operationIncomplete, '缺少开书资料或可用的已有正文分析', {}, false, 409);
  }
}
