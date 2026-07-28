import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';

const terminalStatuses = new Set(['已确认', '稍后补充', '刻意留白', '不适用']);
const baseRequired = [
  'creative-concept', 'reader-promise', 'differentiator', 'era', 'geography',
  'governance', 'power-source', 'levels', 'costs', 'protagonist', 'motivation',
  'factions', 'production', 'must-follow'
];

export class SettingBaselineService {
  private readonly repository: PlanningWorkflowRepository;
  public constructor(database: DatabaseSync, private readonly clock: Clock) {
    this.repository = new PlanningWorkflowRepository(database);
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
    const storyBible = this.repository.activeArtifactVersion(scope, 'story_bible');
    if (storyBible === undefined) throw new DomainError(errorCodes.operationIncomplete, '缺少设定资料版本', {}, false, 409);
    const changed = this.repository.advanceSetting(
      scope, expectedPlanningVersion, storyBible, this.clock.now().toISOString()
    );
    if (!changed) throw new DomainError(errorCodes.bookVersionConflict, '规划状态已经变化，或作品风格尚未确认', {}, true, 409);
    return { stage: 'setting_ready', version: expectedPlanningVersion + 1 };
  }

  private opening(scope: BookScope): OpeningBlueprintInput {
    const blueprint = this.repository.openingBlueprint(scope);
    if (blueprint === undefined) throw new DomainError(errorCodes.operationIncomplete, '缺少开书资料', {}, false, 409);
    return JSON.parse(blueprint) as OpeningBlueprintInput;
  }
}
