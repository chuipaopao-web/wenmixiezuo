import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';

export interface BookProfileView {
  title: string;
  channel: '男频' | '女频';
  category: string;
  subjects: string[];
  mainTags: string[];
  customTags: string[];
  protagonists: OpeningBlueprintInput['protagonists'];
  synopsis: string;
  storyDirection: string;
  openingStart: string;
  storyEnding: string;
  stylePrimary: string;
  styleSecondary: string;
  mustFollow: string[];
  style: {
    languageTones: string[];
    emotionalTones: string[];
    pacingAndPayoff: string[];
    atmospheres: string[];
    custom: string[];
  };
  source: string;
  version: number;
  openingBlueprint: OpeningBlueprintInput;
}

export class BookProfileViewService {
  private readonly repository: PlanningWorkflowRepository;
  public constructor(database: DatabaseSync) {
    this.repository = new PlanningWorkflowRepository(database);
  }

  public get(scope: BookScope): BookProfileView {
    const profile = this.find(scope);
    if (profile === null) throw new Error('本书尚无可读取的开书资料');
    return profile;
  }

  public find(scope: BookScope): BookProfileView | null {
    assertBookScope(scope);
    const row = this.repository.openingProfile(scope);
    if (row === undefined) return null;
    const storedBlueprint = JSON.parse(row.blueprint_json) as OpeningBlueprintInput;
    const openingStart = storedBlueprint.openingStart?.trim() ?? '';
    const storyEnding = storedBlueprint.storyEnding?.trim() ?? '';
    // 编辑弹窗直接回显这份 blueprint；storyDirection 必须保持存储原值，
    // 不得把开局/结局拼接进去，否则保存时会把它们写进"自定义补充"造成串字段。
    const blueprint: OpeningBlueprintInput = {
      ...storedBlueprint,
      creationMode: storedBlueprint.creationMode ?? 'new'
    };
    const style = blueprint.styleIntent ?? {
      languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: []
    };
    return {
      title: row.title,
      channel: row.channel === 'male' ? '男频' : '女频',
      category: row.category_name,
      subjects: blueprint.auxiliaryTags,
      mainTags: blueprint.mainTags,
      customTags: blueprint.customTags,
      protagonists: blueprint.protagonists,
      synopsis: storedBlueprint.fullBookOutline?.trim() ?? '',
      // 信息页展示字段：旧书没有独立故事方向时只读回退到历史全书简介；
      // blueprint.storyDirection 保持存储原值供编辑弹窗回显，不用回退值覆盖。
      storyDirection: (blueprint.storyDirection ?? '').trim().length > 0
        ? blueprint.storyDirection
        : (storedBlueprint.fullBookOutline?.trim() ?? ''),
      openingStart,
      storyEnding,
      stylePrimary: storedBlueprint.stylePrimary?.trim() ?? '',
      styleSecondary: storedBlueprint.styleSecondary?.trim() ?? '',
      mustFollow: blueprint.mustFollow,
      style,
      source: '老板确认的开书资料',
      version: row.version,
      openingBlueprint: blueprint
    };
  }
}
