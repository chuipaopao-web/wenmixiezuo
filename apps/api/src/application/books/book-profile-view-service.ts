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
  storyDirection: string;
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
    const blueprint = JSON.parse(row.blueprint_json) as OpeningBlueprintInput;
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
      storyDirection: blueprint.storyDirection?.trim() || blueprint.fullBookOutline?.trim() || '',
      mustFollow: blueprint.mustFollow,
      style,
      source: '老板确认的开书资料',
      version: row.version
    };
  }
}
