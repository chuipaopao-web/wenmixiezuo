import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import {
  ProtagonistStateRepository,
  type ProtagonistProfileRow as ProfileRow,
  type ProtagonistStateRow as StateRow
} from '../../infrastructure/db/repositories/protagonist-state-repository.js';
import { TaxonomyRepository } from '../../infrastructure/db/repositories/taxonomy-repository.js';
import { TaxonomyService } from './taxonomy-service.js';

export type ProtagonistValueType = 'number' | 'text' | 'enum' | 'list' | 'resource' | 'derived';
export type ProtagonistStateStatus = 'active' | 'consumed' | 'lost' | 'dead' | 'retired' | 'archived';
export type ProtagonistAuthorityLayer = 'candidate' | 'canon' | 'derived';

export interface ProtagonistProfileRecord {
  profileId: string;
  entityId: string | null;
  displayName: string;
  isPrimary: boolean;
  status: 'active' | 'archived';
}

export interface ProtagonistStateRecord {
  entryId: string;
  profileId: string;
  category: string;
  logicalKey: string;
  label: string;
  valueType: ProtagonistValueType;
  value: unknown;
  unit: string | null;
  stateStatus: ProtagonistStateStatus;
  authorityLayer: ProtagonistAuthorityLayer;
  effectiveChapterNumber: number | null;
  storyTime: string | null;
  sourceKind: 'owner' | 'canon_fact' | 'formula' | 'import';
  sourceId: string | null;
  sourceFactId: string | null;
  sourceManuscriptVersionId: string | null;
  canonRevision: number;
  revision: number;
  previousEntryId: string | null;
  note: string | null;
  createdAt: string;
}

export class ProtagonistStateService {
  private readonly repository: ProtagonistStateRepository;
  private readonly taxonomyRepository: TaxonomyRepository;
  private readonly taxonomy: TaxonomyService;

  public constructor(database: DatabaseSync, private readonly ids: IdGenerator, private readonly clock: Clock) {
    this.repository = new ProtagonistStateRepository(database);
    this.taxonomyRepository = new TaxonomyRepository(database);
    this.taxonomy = new TaxonomyService(this.taxonomyRepository, ids, clock);
  }

  public saveProfile(scope: BookScope, input: { profileId?: string; displayName: string; entityId?: string | null; isPrimary?: boolean }): ProtagonistProfileRecord {
    assertBookScope(scope);
    const displayName = requiredText(input.displayName, '主角名称', 120);
    if (input.entityId !== undefined && input.entityId !== null) this.requireCharacter(scope, input.entityId);
    const now = this.clock.now().toISOString();
    const profileId = input.profileId ?? this.ids.next();
    const existing = input.profileId === undefined ? undefined : this.profileRow(scope, profileId);
    this.repository.runInTransaction(() => {
      if (input.isPrimary === true) {
        this.repository.clearPrimary(scope, now);
      }
      if (existing === undefined) {
        this.repository.insertProfile(scope, {
          profileId, entityId: input.entityId ?? null, displayName, isPrimary: input.isPrimary === true, now
        });
      } else {
        this.repository.updateProfile(scope, {
          profileId, entityId: input.entityId ?? existing.entity_id, displayName,
          isPrimary: input.isPrimary === true ? true : existing.is_primary === 1, now
        });
      }
    });
    return this.requireProfile(scope, profileId);
  }

  public archiveProfile(scope: BookScope, profileId: string): ProtagonistProfileRecord {
    this.requireProfile(scope, profileId);
    const changes = this.repository.archiveProfile(scope, profileId, this.clock.now().toISOString());
    if (changes !== 1) throw new DomainError(errorCodes.bookScopeViolation, '主角档案不存在或越权', {}, false, 404);
    return this.requireProfile(scope, profileId);
  }

  public listProfiles(scope: BookScope, includeArchived = false): ProtagonistProfileRecord[] {
    assertBookScope(scope);
    const rows = this.repository.listProfiles(scope, includeArchived);
    return rows.map(mapProfile);
  }

  public append(scope: BookScope, input: {
    profileId: string; category: string; logicalKey: string; label: string; valueType: ProtagonistValueType; value: unknown;
    unit?: string | null; stateStatus?: ProtagonistStateStatus; confirmed?: boolean; effectiveChapterNumber?: number | null;
    storyTime?: string | null; note?: string | null;
  }): ProtagonistStateRecord {
    const profile = this.requireProfile(scope, input.profileId);
    if (profile.status !== 'active') throw new DomainError(errorCodes.operationIncomplete, '已归档主角不能新增状态', {}, false, 409);
    const category = requiredText(input.category, '状态分类', 80);
    const logicalKey = normalizedKey(input.logicalKey, '状态键');
    const label = requiredText(input.label, '状态名称', 120);
    validateValue(input.valueType, input.value);
    const canonRevision = this.repository.canonRevision(scope);
    if (canonRevision === null) throw new DomainError(errorCodes.bookNotFound, '书籍不存在或越权', {}, false, 404);
    return this.insertRevision(scope, {
      profileId: input.profileId, category, logicalKey, label, valueType: input.valueType, value: input.value,
      unit: input.unit?.trim() || null, stateStatus: input.stateStatus ?? 'active',
      authorityLayer: input.confirmed === true ? 'canon' : 'candidate', effectiveChapterNumber: input.effectiveChapterNumber ?? null,
      storyTime: input.storyTime?.trim() || null, sourceKind: 'owner', sourceId: 'owner-confirmed-input', sourceFactId: null,
      sourceManuscriptVersionId: null, canonRevision, note: input.note?.trim() || null
    });
  }

  public archiveEntry(scope: BookScope, entryId: string, note: string | null = null): ProtagonistStateRecord {
    const current = this.requireEntry(scope, entryId);
    const latest = this.latest(scope, current.profileId, current.logicalKey);
    if (latest.entryId !== entryId) throw new DomainError(errorCodes.operationIncomplete, '只能归档当前状态版本', {}, false, 409);
    return this.insertRevision(scope, {
      profileId: current.profileId, category: current.category, logicalKey: current.logicalKey, label: current.label,
      valueType: current.valueType, value: current.value, unit: current.unit, stateStatus: 'archived',
      authorityLayer: current.authorityLayer, effectiveChapterNumber: current.effectiveChapterNumber,
      storyTime: current.storyTime, sourceKind: 'owner', sourceId: 'owner-archive', sourceFactId: null,
      sourceManuscriptVersionId: current.sourceManuscriptVersionId, canonRevision: current.canonRevision,
      note: note?.trim() || '作者从当前主角面板归档；历史仍保留'
    });
  }

  public classify(scope: BookScope, entryId: string, categoryInput: string): ProtagonistStateRecord {
    const current = this.requireEntry(scope, entryId);
    if (this.requireProfile(scope, current.profileId).status !== 'active' || current.stateStatus === 'archived') {
      throw new DomainError(errorCodes.operationIncomplete, '已归档的主角资料不能重新归类', {}, false, 409);
    }
    const latest = this.latest(scope, current.profileId, current.logicalKey);
    if (latest.entryId !== entryId) throw new DomainError(errorCodes.operationIncomplete, '只能归类当前状态版本', {}, false, 409);
    const category = requiredText(categoryInput, '状态分类', 80);
    if (isUnclassifiedCategory(category)) throw new DomainError(errorCodes.validation, '请填写明确的资料分类');
    return this.repository.runInTransaction(() => {
      const result = this.insertRevision(scope, {
        profileId: current.profileId, category, logicalKey: current.logicalKey, label: current.label,
        valueType: current.valueType, value: current.value, unit: current.unit, stateStatus: current.stateStatus,
        authorityLayer: current.authorityLayer, effectiveChapterNumber: current.effectiveChapterNumber,
        storyTime: current.storyTime, sourceKind: current.sourceKind, sourceId: current.sourceId,
        sourceFactId: current.sourceFactId, sourceManuscriptVersionId: current.sourceManuscriptVersionId,
        canonRevision: current.canonRevision,
        note: [current.note, `作者确认资料分类为“${category}”`].filter(Boolean).join('；')
      });
      this.taxonomyRepository.resolveGaps(scope, CLASSIFICATION_GAP_TARGET, classificationTarget(current.profileId, current.logicalKey), this.clock.now().toISOString());
      return result;
    });
  }

  public dashboard(scope: BookScope): { profiles: Array<ProtagonistProfileRecord & { current: ProtagonistStateRecord[]; pending: ProtagonistStateRecord[]; historyCount: number }> } {
    const profiles = this.listProfiles(scope);
    return { profiles: profiles.map((profile) => {
      const history = this.listHistory(scope, profile.profileId);
      const latest = latestByLogicalKey(history).filter((entry) => entry.stateStatus !== 'archived');
      return {
        ...profile,
        current: latest.filter((entry) => entry.authorityLayer !== 'candidate'),
        pending: latest.filter((entry) => entry.authorityLayer === 'candidate'),
        historyCount: history.length
      };
    }) };
  }

  public projectCanonFacts(scope: BookScope, chapterId: string): number {
    assertBookScope(scope);
    const facts = this.repository.structuredFacts(scope, chapterId);
    return this.repository.runInTransaction(() => {
      let projected = 0;
      for (const fact of facts) {
        if (this.repository.hasSourceFact(scope, fact.fact_id)) continue;
        let parsed: ReturnType<typeof parseStructuredRelation>;
        try {
          parsed = parseStructuredRelation(fact.relation_key, JSON.parse(fact.value_json) as unknown);
        } catch (error) {
          if (error instanceof DomainError) continue;
          throw error;
        }
        let profile = this.repository.activeProfileByEntity(scope, fact.subject_entity_id);
        if (profile === undefined) {
          if (this.repository.profileByEntityIncludingArchived(scope, fact.subject_entity_id)?.status === 'archived') continue;
          const displayName = this.repository.activeCharacterName(scope, fact.subject_entity_id);
          if (displayName === undefined) continue;
          const saved = this.saveProfile(scope, {
            displayName, entityId: fact.subject_entity_id, isPrimary: this.repository.listProfiles(scope, false).length === 0
          });
          profile = this.profileRow(scope, saved.profileId);
          if (profile === undefined) continue;
        }
        let nextValue: unknown;
        try {
          const previous = this.latestOrNull(scope, profile.protagonist_profile_id, parsed.logicalKey);
          nextValue = parsed.delta === null ? parsed.value : numericValue(previous) + parsed.delta;
        } catch (error) {
          if (error instanceof DomainError) continue;
          throw error;
        }
        if (profile.entity_id === null) {
          this.repository.linkProfileEntity(scope, profile.protagonist_profile_id, fact.subject_entity_id, this.clock.now().toISOString());
        }
        this.insertRevision(scope, {
          profileId: profile.protagonist_profile_id, category: parsed.category, logicalKey: parsed.logicalKey,
          label: parsed.label, valueType: parsed.valueType, value: nextValue, unit: parsed.unit,
          stateStatus: parsed.stateStatus, authorityLayer: 'canon', effectiveChapterNumber: fact.chapter_number,
          storyTime: null, sourceKind: 'canon_fact', sourceId: fact.fact_id, sourceFactId: fact.fact_id,
          sourceManuscriptVersionId: fact.source_manuscript_version_id, canonRevision: fact.canon_revision, note: '由已结算正史结构化事实更新'
        });
        if (isUnclassifiedCategory(parsed.category)) this.ensureClassificationGap(scope, profile.protagonist_profile_id, parsed);
        projected += 1;
      }
      return projected;
    });
  }

  private ensureClassificationGap(scope: BookScope, profileId: string, parsed: ReturnType<typeof parseStructuredRelation>): void {
    const targetId = classificationTarget(profileId, parsed.logicalKey);
    if (this.taxonomyRepository.hasOpenGap(scope, CLASSIFICATION_GAP_TARGET, targetId, 'classification')) return;
    this.taxonomy.reportGap(scope, {
      targetType: CLASSIFICATION_GAP_TARGET,
      targetId,
      gapType: 'classification',
      diagnosis: `“${parsed.label}”已从正史自动记录，但无法可靠判断资料分类。请作者确认分类；主编可以提供建议。`,
      severity: 'important'
    });
  }

  private listHistory(scope: BookScope, profileId: string): ProtagonistStateRecord[] {
    this.requireProfile(scope, profileId);
    const rows = this.repository.listHistory(scope, profileId);
    return rows.map(mapState);
  }

  private insertRevision(scope: BookScope, input: Omit<ProtagonistStateRecord, 'entryId' | 'revision' | 'previousEntryId' | 'createdAt'>): ProtagonistStateRecord {
    const previous = this.latestOrNull(scope, input.profileId, input.logicalKey);
    const entryId = this.ids.next();
    const revision = (previous?.revision ?? 0) + 1;
    this.repository.insertState(scope, {
      entryId, profileId: input.profileId, category: input.category, logicalKey: input.logicalKey,
      label: input.label, valueType: input.valueType, valueJson: JSON.stringify(input.value), unit: input.unit,
      stateStatus: input.stateStatus, authorityLayer: input.authorityLayer,
      effectiveChapterNumber: input.effectiveChapterNumber, storyTime: input.storyTime,
      sourceKind: input.sourceKind, sourceId: input.sourceId, sourceFactId: input.sourceFactId,
      sourceManuscriptVersionId: input.sourceManuscriptVersionId, canonRevision: input.canonRevision,
      revision, previousEntryId: previous?.entryId ?? null, note: input.note, now: this.clock.now().toISOString()
    });
    return this.requireEntry(scope, entryId);
  }

  private latest(scope: BookScope, profileId: string, logicalKey: string): ProtagonistStateRecord {
    const result = this.latestOrNull(scope, profileId, logicalKey);
    if (result === null) throw new DomainError(errorCodes.bookScopeViolation, '主角状态不存在或越权', {}, false, 404);
    return result;
  }

  private latestOrNull(scope: BookScope, profileId: string, logicalKey: string): ProtagonistStateRecord | null {
    const row = this.repository.latestState(scope, profileId, logicalKey);
    return row === undefined ? null : mapState(row);
  }

  private requireProfile(scope: BookScope, profileId: string): ProtagonistProfileRecord {
    const row = this.profileRow(scope, profileId);
    if (row === undefined) throw new DomainError(errorCodes.bookScopeViolation, '主角档案不存在或越权', {}, false, 404);
    return mapProfile(row);
  }

  private profileRow(scope: BookScope, profileId: string): ProfileRow | undefined {
    assertBookScope(scope);
    return this.repository.profile(scope, profileId);
  }

  private requireEntry(scope: BookScope, entryId: string): ProtagonistStateRecord {
    assertBookScope(scope);
    const row = this.repository.entry(scope, entryId);
    if (row === undefined) throw new DomainError(errorCodes.bookScopeViolation, '主角状态不存在或越权', {}, false, 404);
    return mapState(row);
  }

  private requireCharacter(scope: BookScope, entityId: string): void {
    if (!this.repository.isActiveCharacter(scope, entityId)) {
      throw new DomainError(errorCodes.bookScopeViolation, '主角实体不存在、不是角色或越权', {}, false, 404);
    }
  }
}

function parseStructuredRelation(relationKey: string, value: unknown): {
  category: string; logicalKey: string; label: string; valueType: ProtagonistValueType; value: unknown;
  delta: number | null; unit: string | null; stateStatus: ProtagonistStateStatus;
} {
  const parts = relationKey.split('.');
  if (parts.length !== 3) throw new DomainError(errorCodes.validation, '主角状态事实关系键必须包含分类和状态键');
  const record = isRecord(value) ? value : { value };
  const category = requiredText(parts[1]!, '状态分类', 80);
  const logicalKey = normalizedKey(parts[2]!, '状态键');
  const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : logicalKey;
  const delta = relationKey.startsWith('protagonist_delta.') ? Number(record.delta) : null;
  if (delta !== null && !Number.isFinite(delta)) throw new DomainError(errorCodes.validation, '主角状态增量必须是有限数字');
  const nextValue = delta === null ? record.value : 0;
  const valueType: ProtagonistValueType = delta !== null ? 'number' : inferValueType(nextValue);
  validateValue(valueType, nextValue);
  const status = typeof record.status === 'string' && ['active', 'consumed', 'lost', 'dead', 'retired'].includes(record.status)
    ? record.status as ProtagonistStateStatus : 'active';
  return { category, logicalKey, label, valueType, value: nextValue, delta, unit: typeof record.unit === 'string' ? record.unit : null, stateStatus: status };
}

function numericValue(previous: ProtagonistStateRecord | null): number {
  if (previous === null) return 0;
  if (previous.valueType !== 'number' && previous.valueType !== 'resource') throw new DomainError(errorCodes.validation, '非数值主角状态不能应用增量');
  const value = Number(previous.value);
  if (!Number.isFinite(value)) throw new DomainError(errorCodes.validation, '主角状态当前值不是有限数字');
  return value;
}

function inferValueType(value: unknown): ProtagonistValueType {
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  return 'text';
}

function validateValue(valueType: ProtagonistValueType, value: unknown): void {
  if ((valueType === 'number' || valueType === 'resource' || valueType === 'derived') && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new DomainError(errorCodes.validation, '数值、资源或派生状态必须是有限数字');
  }
  if (valueType === 'list' && !Array.isArray(value)) throw new DomainError(errorCodes.validation, '列表状态必须使用数组');
  if ((valueType === 'text' || valueType === 'enum') && typeof value !== 'string') throw new DomainError(errorCodes.validation, '文本或枚举状态必须使用字符串');
  if (JSON.stringify(value).length > 20_000) throw new DomainError(errorCodes.validation, '单项主角状态内容过长');
}

function latestByLogicalKey(records: ProtagonistStateRecord[]): ProtagonistStateRecord[] {
  const latest = new Map<string, ProtagonistStateRecord>();
  for (const record of records) {
    const current = latest.get(record.logicalKey);
    if (current === undefined || record.revision > current.revision) latest.set(record.logicalKey, record);
  }
  return [...latest.values()].sort((left, right) => left.category.localeCompare(right.category, 'zh-CN') || left.label.localeCompare(right.label, 'zh-CN'));
}

function mapProfile(row: ProfileRow): ProtagonistProfileRecord {
  return { profileId: row.protagonist_profile_id, entityId: row.entity_id, displayName: row.display_name, isPrimary: row.is_primary === 1, status: row.status };
}

function mapState(row: StateRow): ProtagonistStateRecord {
  return {
    entryId: row.protagonist_state_entry_id, profileId: row.protagonist_profile_id, category: row.category,
    logicalKey: row.logical_key, label: row.label, valueType: row.value_type, value: JSON.parse(row.value_json) as unknown,
    unit: row.unit, stateStatus: row.state_status, authorityLayer: row.authority_layer,
    effectiveChapterNumber: row.effective_chapter_number, storyTime: row.story_time, sourceKind: row.source_kind,
    sourceId: row.source_id, sourceFactId: row.source_fact_id, sourceManuscriptVersionId: row.source_manuscript_version_id,
    canonRevision: row.canon_revision, revision: row.revision, previousEntryId: row.previous_entry_id, note: row.note, createdAt: row.created_at
  };
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0 || normalized.length > maxLength) throw new DomainError(errorCodes.validation, `${label}长度必须为1至${maxLength}`);
  return normalized;
}

function normalizedKey(value: string, label: string): string {
  const key = requiredText(value, label, 80);
  if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(key)) throw new DomainError(errorCodes.validation, `${label}格式无效`);
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CLASSIFICATION_GAP_TARGET = 'protagonist_state_classification';

function isUnclassifiedCategory(category: string): boolean {
  const normalized = category.trim().toLocaleLowerCase('zh-CN');
  return normalized === 'unclassified' || normalized === '待归类';
}

function classificationTarget(profileId: string, logicalKey: string): string {
  return `${profileId}:${logicalKey}`;
}
