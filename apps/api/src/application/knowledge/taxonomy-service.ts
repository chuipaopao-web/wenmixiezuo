import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { TaxonomyRepository } from '../../infrastructure/db/repositories/taxonomy-repository.js';

export class TaxonomyService {
  public constructor(
    private readonly repository: TaxonomyRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public createTag(scope: BookScope, input: {
    namespace: string; name: string; description?: string; appliesTo: string[];
    color?: string | null; icon?: string | null; createdSource: 'system' | 'chief_editor' | 'boss';
    changesStoryFact?: boolean;
  }): { tagId: string; status: 'proposed' | 'active' } {
    const namespace = input.namespace.trim();
    const name = input.name.trim();
    const appliesTo = [...new Set(input.appliesTo.map((value) => value.trim()).filter(Boolean))];
    if (namespace.length === 0 || name.length === 0) throw new Error('标签命名空间和名称不能为空');
    if (appliesTo.length === 0) throw new Error('标签至少需要一个适用对象');
    const tagId = this.ids.next();
    const status = input.changesStoryFact === true && input.createdSource !== 'boss' ? 'proposed' : 'active';
    this.repository.createTag(scope, {
      tagId,
      namespace,
      name,
      description: input.description?.trim() ?? '',
      appliesToJson: JSON.stringify(appliesTo),
      color: input.color ?? null,
      icon: input.icon ?? null,
      createdSource: input.createdSource,
      status,
      now: this.clock.now().toISOString()
    });
    return { tagId, status };
  }

  public createEntitySchema(scope: BookScope, input: {
    entityTypeKey: string; displayName: string; fields: Array<Record<string, unknown>>;
    applicability?: Record<string, unknown>; createdSource: 'system' | 'chief_editor' | 'boss';
    changesExistingMeaning?: boolean;
  }): { schemaId: string; version: number; status: 'proposed' | 'active' } {
    const entityTypeKey = input.entityTypeKey.trim();
    const displayName = input.displayName.trim();
    if (entityTypeKey.length === 0 || displayName.length === 0) throw new Error('实体类型和显示名称不能为空');
    if (input.fields.length === 0) throw new Error('实体Schema至少需要一个字段');
    const schemaId = this.ids.next();
    const version = this.repository.nextEntitySchemaVersion(scope, entityTypeKey);
    const status = input.changesExistingMeaning === true && input.createdSource !== 'boss' ? 'proposed' : 'active';
    this.repository.createEntitySchema(scope, {
      schemaId,
      entityTypeKey,
      displayName,
      version,
      fieldsJson: JSON.stringify(input.fields),
      applicabilityJson: JSON.stringify(input.applicability ?? {}),
      createdSource: input.createdSource,
      status,
      now: this.clock.now().toISOString()
    });
    return { schemaId, version, status };
  }

  public addAlias(scope: BookScope, tagId: string, alias: string, aliasType: 'synonym' | 'abbreviation' | 'historical'): string {
    if (alias.trim().length === 0) throw new Error('标签别名不能为空');
    const aliasId = this.ids.next();
    this.repository.addAlias(scope, { aliasId, tagId, alias: alias.trim(), aliasType, now: this.clock.now().toISOString() });
    return aliasId;
  }

  public assign(scope: BookScope, input: {
    tagId: string; targetType: string; targetId: string;
    authorityLayer: 'temporary' | 'candidate' | 'canon' | 'derived'; sourceType: string; sourceId: string;
  }): string {
    if (input.targetType.trim().length === 0 || input.targetId.trim().length === 0) throw new Error('标签对象不能为空');
    if (input.authorityLayer === 'canon' && !['boss_confirmation', 'canon_revision'].includes(input.sourceType)) {
      throw new Error('只有老板确认或正史版本可以创建正史标签赋值');
    }
    const assignmentId = this.ids.next();
    this.repository.assign(scope, { assignmentId, ...input, now: this.clock.now().toISOString() });
    return assignmentId;
  }

  public annotate(scope: BookScope, input: {
    targetType: string; targetId: string; annotationType: string; value: unknown;
    confidence?: number | null; authorityLayer: 'temporary' | 'candidate' | 'canon' | 'derived';
    sourceType: string; sourceId: string;
  }): string {
    if (input.annotationType.trim().length === 0) throw new Error('语义标注类型不能为空');
    if (input.confidence !== undefined && input.confidence !== null && (input.confidence < 0 || input.confidence > 1)) {
      throw new Error('语义标注置信度必须在0至1之间');
    }
    if (input.authorityLayer === 'canon' && !['boss_confirmation', 'canon_revision'].includes(input.sourceType)) {
      throw new Error('候选语义标注不能冒充正史');
    }
    const annotationId = this.ids.next();
    this.repository.annotate(scope, {
      annotationId,
      targetType: input.targetType,
      targetId: input.targetId,
      annotationType: input.annotationType,
      valueJson: JSON.stringify(input.value),
      confidence: input.confidence ?? null,
      authorityLayer: input.authorityLayer,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: input.authorityLayer === 'candidate' ? 'candidate' : 'active',
      now: this.clock.now().toISOString()
    });
    return annotationId;
  }

  public reportGap(scope: BookScope, input: {
    targetType: string; targetId?: string | null; narrativeGoal?: string | null;
    gapType: string; diagnosis: string; severity: 'blocking' | 'important' | 'optional' | 'observation';
    intentionalUnknown?: boolean; sourceTaskId?: string | null;
  }): string {
    if (input.targetType.trim().length === 0 || input.gapType.trim().length === 0 || input.diagnosis.trim().length === 0) {
      throw new Error('资料缺口必须包含对象、类型和诊断');
    }
    const gapId = this.ids.next();
    this.repository.createGap(scope, {
      gapId,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      narrativeGoal: input.narrativeGoal ?? null,
      gapType: input.gapType,
      diagnosis: input.diagnosis,
      severity: input.severity,
      intentionalUnknown: input.intentionalUnknown ?? false,
      sourceTaskId: input.sourceTaskId ?? null,
      status: input.intentionalUnknown === true ? 'accepted_unknown' : 'open',
      now: this.clock.now().toISOString()
    });
    return gapId;
  }
}
