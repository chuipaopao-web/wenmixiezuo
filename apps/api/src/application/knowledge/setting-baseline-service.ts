import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { ArtifactService } from '../artifacts/artifact-service.js';
import { SettingOutlineWorkspaceService } from './setting-outline-workspace-service.js';

const terminalStatuses = new Set(['已确认', '稍后补充', '刻意留白', '不适用']);
const baseRequired = [
  'creative-concept', 'reader-promise', 'differentiator', 'era', 'geography',
  'governance', 'power-source', 'levels', 'costs', 'protagonist', 'motivation',
  'factions', 'production', 'must-follow'
];

export class SettingBaselineService {
  private readonly repository: PlanningWorkflowRepository;
  private readonly artifacts: ArtifactService;
  private readonly workspace: SettingOutlineWorkspaceService;

  public constructor(
    private readonly database: DatabaseSync,
    ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new PlanningWorkflowRepository(database);
    this.artifacts = new ArtifactService(database, ids, clock);
    this.workspace = new SettingOutlineWorkspaceService(database, clock);
  }

  public inspect(scope: BookScope): { ready: boolean; missing: string[]; unresolved: string[]; required: string[] } {
    assertBookScope(scope);
    const blueprint = this.opening(scope);
    const hints = [
      blueprint.categoryKey, ...blueprint.auxiliaryTags, ...blueprint.mainTags, ...blueprint.customTags
    ].join(' ');
    const required = [...baseRequired];
    if (/游戏|电竞|网游|系统/u.test(hints)) required.push('game-entry', 'player-npc', 'game-panel', 'class-skill', 'loot');
    if (/历史|古代|三国|架空/u.test(hints)) required.push('history-baseline', 'divergence', 'politics-military', 'technology-spread');
    if (/领主|种田|经营|基建/u.test(hints)) required.push('territory', 'population', 'army', 'yield');
    if (/玄幻|仙侠|修仙|奇幻|魔法/u.test(hints)) required.push('cultivation', 'bloodline', 'treasures');
    const rows = this.repository.settingStatuses(scope);
    const statuses = new Map(rows.map((row) => [row.item_key, row.item_status]));
    const missing = [...new Set(required)].filter((key) => statuses.get(key) !== '已确认');
    const unresolved = rows.filter((row) => !terminalStatuses.has(row.item_status)).map((row) => row.item_key);
    return { ready: missing.length === 0 && unresolved.length === 0, missing, unresolved, required: [...new Set(required)] };
  }

  public confirm(scope: BookScope, expectedPlanningVersion: number): { stage: string; version: number } {
    const readiness = this.inspect(scope);
    if (!readiness.ready) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '设定大纲尚未准备完成：题材必备项必须确认，其余可选择稍后补充、刻意留白或不适用',
        readiness,
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
          '规划状态已经变化，或表达策略记录尚未建立',
          {},
          true,
          409
        );
      }
      return { stage: 'setting_ready', version: expectedPlanningVersion + 1 };
    });
  }

  private opening(scope: BookScope): OpeningBlueprintInput {
    const blueprint = this.repository.openingBlueprint(scope);
    if (blueprint === undefined) throw new DomainError(errorCodes.operationIncomplete, '缺少开书资料', {}, false, 409);
    return JSON.parse(blueprint) as OpeningBlueprintInput;
  }
}
