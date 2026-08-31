import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildCharacterFallbackChain,
  characterContextSelectionPrompt,
  characterMaintenancePrompt,
  parseCharacterContextSelection,
  parseCharacterMaintenanceOutput,
  parseCharacterProfile,
  validateCharacterRoster,
  V7_CHARACTER_MEMBERS,
  type CharacterContextField,
  type CharacterProfileDocument,
  type V7CharacterMemberDefinition
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { CanonService } from '../knowledge/canon-service.js';
import {
  V7CharacterMemoryRepository,
  type V7CharacterContextPackRow,
  type V7CharacterMaintenanceRow,
  type V7CharacterModelCallRow,
  type V7CharacterProfileRow
} from '../../infrastructure/db/repositories/v7-character-memory-repository.js';
import {
  V7CharacterMemoryModelError,
  V7CharacterMemoryModelGateway,
  type V7CharacterMemoryModelAdapterResolver
} from '../../infrastructure/models/v7-character-memory-model-gateway.js';

type SourceKind = V7CharacterMaintenanceRow['source_kind'];
type CharacterMemberSource = readonly V7CharacterMemberDefinition[] | (() => readonly V7CharacterMemberDefinition[]);

interface CharacterContextTaskSnapshot {
  fallback: V7CharacterMemberDefinition[];
  maxTokens: number;
  relationshipDepth: 0 | 1;
  temperature: number;
  maxOutputTokens: number;
}

interface CharacterMaintenanceTaskSnapshot {
  fallback: V7CharacterMemberDefinition[];
  temperature: number;
  maxOutputTokens: number;
}

export class V7CharacterMemoryService {
  private readonly repository: V7CharacterMemoryRepository;
  private readonly canon: CanonService;
  private readonly models: V7CharacterMemoryModelGateway;
  private readonly activeContextPacks = new Set<string>();
  private readonly activeMaintenanceRuns = new Set<string>();

  public constructor(
    database: DatabaseSync,
    adapters: V7CharacterMemoryModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly memberSource: CharacterMemberSource = V7_CHARACTER_MEMBERS
  ) {
    this.repository = new V7CharacterMemoryRepository(database);
    this.canon = new CanonService(database, ids, clock);
    this.models = new V7CharacterMemoryModelGateway(database, adapters, clock);
    const errors = validateCharacterRoster(this.members());
    if (errors.length > 0) throw new Error(errors.join('；'));
  }

  /** 对齐人物身份与V7档案目录；只处理确定性身份，不用程序推断人物含义。 */
  public syncProfiles(ownerId: string, bookId: string): { created: number; linkedProtagonists: number; total: number } {
    this.requireBook(ownerId, bookId);
    let created = 0;
    let linkedProtagonists = 0;
    this.repository.runInTransaction(() => {
      for (const protagonist of this.repository.unlinkedProtagonists(ownerId, bookId)) {
        const matches = this.repository.characterEntityByName(ownerId, bookId, protagonist.display_name);
        if (matches.length > 1) throw conflict(`人物“${protagonist.display_name}”存在多个同名正史身份，请先合并身份。`);
        const entityId = matches[0]?.entity_id ?? this.canon.createEntity(
          { ownerId, bookId }, { entityType: 'character', canonicalName: protagonist.display_name }
        );
        this.repository.linkProtagonist(ownerId, bookId, protagonist.protagonist_profile_id, entityId, this.now());
        linkedProtagonists += 1;
      }
      const protagonists = new Map(this.repository.linkedProtagonists(ownerId, bookId).map((item) => [item.entity_id, item]));
      for (const entity of this.repository.allCharacterEntities(ownerId, bookId)) {
        if (this.repository.profileByEntity(ownerId, bookId, entity.entity_id) !== undefined) continue;
        const protagonist = protagonists.get(entity.entity_id);
        this.repository.insertProfile({
          profileId: this.ids.next(), ownerId, bookId, entityId: entity.entity_id,
          sourceProtagonistProfileId: protagonist?.protagonist_profile_id ?? null,
          displayName: entity.canonical_name,
          narrativeTier: protagonist === undefined ? 'unknown' : protagonist.is_primary === 1 ? 'core' : 'important',
          now: this.now()
        });
        created += 1;
      }
    });
    return { created, linkedProtagonists, total: this.repository.listProfiles(ownerId, bookId, true).length };
  }

  public listProfiles(ownerId: string, bookId: string, includeArchived = false): unknown[] {
    const book = this.requireBook(ownerId, bookId);
    this.syncProfiles(ownerId, bookId);
    return this.repository.listProfiles(ownerId, bookId, includeArchived).map((profile) => {
      const version = this.repository.activeProfileVersion(ownerId, bookId, profile.profile_id);
      return {
        profileId: profile.profile_id, entityId: profile.entity_id, displayName: profile.display_name,
        narrativeTier: profile.narrative_tier, status: profile.status,
        profile: version === undefined ? null : json(version.content_json),
        currentState: this.repository.currentState(ownerId, bookId, profile.entity_id, book.canon_revision),
        canonRevision: book.canon_revision, updatedAt: profile.updated_at
      };
    });
  }

  public getProfile(ownerId: string, bookId: string, profileId: string, includeHistory = false): unknown {
    const book = this.requireBook(ownerId, bookId);
    const profile = this.requireProfile(ownerId, bookId, profileId);
    const active = this.repository.activeProfileVersion(ownerId, bookId, profileId);
    return {
      profileId, entityId: profile.entity_id, displayName: profile.display_name,
      narrativeTier: profile.narrative_tier, status: profile.status,
      stableProfile: active === undefined ? null : json(active.content_json),
      stableProfileVersion: active === undefined ? null : {
        versionId: active.profile_version_id, revision: active.revision, authority: active.authority_layer,
        sourceKind: active.source_kind, sourceCanonRevision: active.source_canon_revision
      },
      currentActual: {
        canonRevision: book.canon_revision,
        state: this.repository.currentState(ownerId, bookId, profile.entity_id, book.canon_revision),
        relationships: parseRowJson(this.repository.relationships(ownerId, bookId, profile.entity_id, book.canon_revision)),
        knowledge: parseRowJson(this.repository.knowledge(ownerId, bookId, profile.entity_id))
      },
      openingReference: parseRowJson(this.repository.openingReference(ownerId, bookId, profile.source_protagonist_profile_id)),
      versionHistory: this.repository.profileVersionHistory(ownerId, bookId, profileId).map((row) => ({
        versionId: row.profile_version_id, revision: row.revision, lifecycle: row.lifecycle,
        authority: row.authority_layer, sourceKind: row.source_kind, createdAt: row.created_at
      })),
      actionHistory: this.repository.actionHistory(ownerId, bookId, profileId).map(authorActionView),
      factHistory: includeHistory ? parseRowJson(this.repository.factHistory(ownerId, bookId, profile.entity_id)) : undefined
    };
  }

  public createProfile(ownerId: string, bookId: string, input: {
    document?: unknown; narrativeTier?: unknown; idempotencyKey?: unknown;
  }): unknown {
    const document = parseCharacterProfile(input.document);
    const narrativeTier = tier(input.narrativeTier);
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({ document, narrativeTier }));
    const replay = this.repository.actionByKey(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) return this.replayAction(ownerId, bookId, replay, requestHash, 'create');
    this.requireBook(ownerId, bookId);
    let profileId = '';
    this.repository.runInTransaction(() => {
      if (this.repository.characterEntityByName(ownerId, bookId, document.displayName).length > 0) {
        throw conflict('本书已经存在同名人物，请在现有人物上新增版本。');
      }
      const entityId = this.canon.createEntity(
        { ownerId, bookId },
        { entityType: 'character', canonicalName: document.displayName, aliases: document.aliases }
      );
      profileId = this.ids.next();
      const versionId = this.ids.next();
      const now = this.now();
      this.repository.insertProfile({
        profileId, ownerId, bookId, entityId, sourceProtagonistProfileId: null,
        displayName: document.displayName, narrativeTier, now
      });
      this.insertProfileVersion(ownerId, bookId, profileId, versionId, document, {
        lifecycle: 'active', authorityLayer: 'confirmed_reference', sourceKind: 'owner', sourceId: null,
        basedOnVersionId: null, createdByType: 'owner', createdById: ownerId, now
      });
      this.repository.insertAction({
        actionId: this.ids.next(), ownerId, bookId, profileId, profileVersionId: versionId,
        actionKind: 'create', idempotencyKey, requestHash, actorType: 'owner', actorId: ownerId,
        detailJson: stableJson({ narrativeTier }), now
      });
    });
    return this.getProfile(ownerId, bookId, profileId);
  }

  public reviseProfile(ownerId: string, bookId: string, profileId: string, input: {
    document?: unknown; activate?: unknown; sourceKind?: unknown; sourceId?: unknown; idempotencyKey?: unknown;
  }): unknown {
    const profile = this.requireProfile(ownerId, bookId, profileId);
    const document = parseCharacterProfile(input.document);
    if (document.displayName !== profile.display_name) {
      throw new DomainError(errorCodes.validation, '人物改名需要走身份合并或改名流程，不能只改档案文字。');
    }
    const entity = this.repository.characterEntity(ownerId, bookId, profile.entity_id);
    if (entity === undefined) throw notFound('人物身份不存在。');
    if (stableJson(normalizedTexts(document.aliases)) !== stableJson(normalizedTexts(json(entity.aliases_json)))) {
      throw new DomainError(errorCodes.validation, '人物别名需要走别名管理入口，不能只改档案文字。');
    }
    const activate = input.activate === true;
    const sourceKind = input.sourceKind === 'agent' ? 'agent' : 'owner';
    const sourceId = optionalText(input.sourceId, '来源编号', 160);
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({ profileId, document, activate, sourceKind, sourceId }));
    const replay = this.repository.actionByKey(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) return this.replayAction(ownerId, bookId, replay, requestHash, 'revise');
    const active = this.repository.activeProfileVersion(ownerId, bookId, profileId);
    const versionId = this.ids.next();
    this.repository.runInTransaction(() => {
      const now = this.now();
      // 始终先建候选，再显式激活，避免同一人物短暂出现两个active版本。
      this.insertProfileVersion(ownerId, bookId, profileId, versionId, document, {
        lifecycle: 'candidate', authorityLayer: activate ? 'confirmed_reference' : 'candidate', sourceKind, sourceId,
        basedOnVersionId: active?.profile_version_id ?? null,
        createdByType: sourceKind === 'agent' ? 'agent' : 'owner',
        createdById: sourceKind === 'agent' ? sourceId ?? 'character-curator' : ownerId, now
      });
      if (activate) this.repository.activateProfileVersion(ownerId, bookId, profileId, versionId, now);
      this.repository.insertAction({
        actionId: this.ids.next(), ownerId, bookId, profileId, profileVersionId: versionId,
        actionKind: 'revise', idempotencyKey, requestHash,
        actorType: sourceKind === 'agent' ? 'agent' : 'owner',
        actorId: sourceKind === 'agent' ? sourceId ?? 'character-curator' : ownerId,
        detailJson: stableJson({ activate, sourceKind, sourceId }), now
      });
    });
    return this.getProfile(ownerId, bookId, profileId);
  }

  public updateAliases(ownerId: string, bookId: string, profileId: string, input: {
    aliases?: unknown; idempotencyKey?: unknown;
  }): unknown {
    const profile = this.requireProfile(ownerId, bookId, profileId);
    const aliases = normalizedTexts(input.aliases).filter((alias) => alias !== profile.display_name);
    if (aliases.length > 20 || aliases.some((alias) => Array.from(alias).length > 120)) {
      throw new DomainError(errorCodes.validation, '人物别名最多20个，每个不超过120字。');
    }
    const aliasSet = new Set(aliases);
    if (aliasSet.size !== aliases.length) throw new DomainError(errorCodes.validation, '人物别名不能重复。');
    for (const identity of this.repository.allCharacterIdentities(ownerId, bookId)) {
      if (identity.entity_id === profile.entity_id) continue;
      const occupied = new Set([identity.canonical_name, ...normalizedTexts(json(identity.aliases_json))]);
      if (aliases.some((alias) => occupied.has(alias))) {
        throw conflict('这个别名已经属于本书其他人物，请先核实人物身份。');
      }
    }
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({ profileId, aliases }));
    const replay = this.repository.actionByKey(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) return this.replayAction(ownerId, bookId, replay, requestHash, 'revise');
    const active = this.repository.activeProfileVersion(ownerId, bookId, profileId);
    let versionId: string | null = null;
    this.repository.runInTransaction(() => {
      const now = this.now();
      if (this.repository.updateCharacterAliases(ownerId, bookId, profile.entity_id, stableJson(aliases), now) !== 1) {
        throw notFound('人物身份不存在。');
      }
      if (active !== undefined) {
        versionId = this.ids.next();
        const document = parseCharacterProfile({ ...(json(active.content_json) as CharacterProfileDocument), aliases });
        this.insertProfileVersion(ownerId, bookId, profileId, versionId, document, {
          lifecycle: 'candidate', authorityLayer: 'confirmed_reference', sourceKind: 'owner', sourceId: null,
          basedOnVersionId: active.profile_version_id, createdByType: 'owner', createdById: ownerId, now
        });
        this.repository.activateProfileVersion(ownerId, bookId, profileId, versionId, now);
      }
      this.repository.insertAction({
        actionId: this.ids.next(), ownerId, bookId, profileId, profileVersionId: versionId,
        actionKind: 'revise', idempotencyKey, requestHash, actorType: 'owner', actorId: ownerId,
        detailJson: stableJson({ operation: 'aliases', aliases }), now
      });
    });
    return this.getProfile(ownerId, bookId, profileId);
  }

  public activateVersion(ownerId: string, bookId: string, profileId: string, versionId: string, input: { idempotencyKey?: unknown }): unknown {
    this.requireProfile(ownerId, bookId, profileId);
    const version = this.repository.profileVersion(ownerId, bookId, versionId);
    if (version === undefined || version.profile_id !== profileId) throw notFound('人物档案版本不存在。');
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({ profileId, versionId }));
    const replay = this.repository.actionByKey(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) return this.replayAction(ownerId, bookId, replay, requestHash, 'activate');
    this.repository.runInTransaction(() => {
      const now = this.now();
      this.repository.activateProfileVersion(ownerId, bookId, profileId, versionId, now);
      this.repository.insertAction({
        actionId: this.ids.next(), ownerId, bookId, profileId, profileVersionId: versionId,
        actionKind: 'activate', idempotencyKey, requestHash, actorType: 'owner', actorId: ownerId,
        detailJson: '{}', now
      });
    });
    return this.getProfile(ownerId, bookId, profileId);
  }

  public updateOrganization(ownerId: string, bookId: string, profileId: string, input: {
    narrativeTier?: unknown; idempotencyKey?: unknown;
  }): unknown {
    const profile = this.requireProfile(ownerId, bookId, profileId);
    const narrativeTier = requiredTier(input.narrativeTier);
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({ profileId, narrativeTier }));
    const replay = this.repository.actionByKey(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) return this.replayAction(ownerId, bookId, replay, requestHash, 'revise');
    this.repository.runInTransaction(() => {
      const now = this.now();
      this.repository.updateProfileOrganization({
        ownerId, bookId, profileId, displayName: profile.display_name, narrativeTier,
        status: profile.status, now
      });
      this.repository.insertAction({
        actionId: this.ids.next(), ownerId, bookId, profileId, profileVersionId: profile.active_version_id,
        actionKind: 'revise', idempotencyKey, requestHash, actorType: 'owner', actorId: ownerId,
        detailJson: stableJson({ operation: 'organize', narrativeTier }), now
      });
    });
    return this.getProfile(ownerId, bookId, profileId);
  }

  public setArchiveState(ownerId: string, bookId: string, profileId: string, archived: boolean, input: {
    idempotencyKey?: unknown;
  }): unknown {
    const profile = this.requireProfile(ownerId, bookId, profileId);
    const actionKind = archived ? 'archive' : 'restore';
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({ profileId, archived }));
    const replay = this.repository.actionByKey(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) return this.replayAction(ownerId, bookId, replay, requestHash, actionKind);
    this.repository.runInTransaction(() => {
      const now = this.now();
      this.repository.updateProfileOrganization({
        ownerId, bookId, profileId, displayName: profile.display_name, narrativeTier: profile.narrative_tier,
        status: archived ? 'archived' : 'active', now
      });
      this.repository.insertAction({
        actionId: this.ids.next(), ownerId, bookId, profileId, profileVersionId: profile.active_version_id,
        actionKind, idempotencyKey, requestHash, actorType: 'owner', actorId: ownerId,
        detailJson: stableJson({ archived }), now
      });
    });
    return this.getProfile(ownerId, bookId, profileId);
  }

  public createContextPack(ownerId: string, bookId: string, input: {
    taskKind?: unknown; taskId?: unknown; taskBrief?: unknown; candidateEntityIds?: unknown;
    relationshipDepth?: unknown; maxTokens?: unknown; selectedMemberKey?: unknown; idempotencyKey?: unknown;
  }): unknown {
    const book = this.requireBook(ownerId, bookId);
    this.syncProfiles(ownerId, bookId);
    const taskKind = text(input.taskKind, '任务类型', 1, 80);
    const taskId = text(input.taskId, '任务编号', 1, 160);
    const taskBrief = text(input.taskBrief, '任务说明', 2, 2_000);
    const candidateEntityIds = ids(input.candidateEntityIds, '候选人物', 1, 60);
    this.requireCharacterEntities(ownerId, bookId, candidateEntityIds);
    const relationshipDepth = integer(input.relationshipDepth, '关系读取深度', 0, 1, 1);
    const maxTokens = integer(input.maxTokens, '资料包预算', 800, 12_000, 4_000);
    const selectedMemberKey = optionalText(input.selectedMemberKey, '成员编号', 160) ?? undefined;
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({
      taskKind, taskId, taskBrief, candidateEntityIds, relationshipDepth, maxTokens, selectedMemberKey
    }));
    const existing = this.repository.contextPackByKey(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw conflict('同一操作编号不能用于不同的人物资料任务。');
      this.startContextPack(existing);
      return this.contextPackView(existing);
    }
    const fallback = buildCharacterFallbackChain(selectedMemberKey, this.members());
    const row = this.repository.createContextPack({
      packId: this.ids.next(), ownerId, bookId, taskKind, taskId, taskBrief,
      canonRevision: book.canon_revision, memberKey: fallback[0]!.memberKey,
      memberSnapshotJson: stableJson({
        fallback: fallback.map(memberSnapshot), maxTokens, relationshipDepth,
        temperature: 0.12, maxOutputTokens: 3_000
      }),
      candidateEntityIdsJson: stableJson(candidateEntityIds), idempotencyKey, requestHash, now: this.now()
    });
    this.startContextPack(row);
    return this.contextPackView(row);
  }

  public getContextPack(ownerId: string, bookId: string, packId: string): unknown {
    const row = this.requireContextPack(ownerId, bookId, packId);
    this.startContextPack(row);
    return this.contextPackView(this.requireContextPack(ownerId, bookId, packId));
  }

  public retryContextPack(ownerId: string, bookId: string, packId: string): unknown {
    const row = this.requireContextPack(ownerId, bookId, packId);
    if (row.status === 'unknown') throw conflict('上次结果还没确认，为避免重复扣量不能重试。');
    if (row.status === 'invalidated') throw conflict('人物实际状态已经更新，请新建资料任务。');
    if (row.status !== 'failed') throw conflict('只有明确失败的人物资料任务可以重试。');
    this.executableContextSnapshot(row.member_snapshot_json);
    if (this.repository.resetContextPackForRetry(ownerId, bookId, packId, this.now()) !== 1) {
      throw conflict('人物资料任务状态已经变化。');
    }
    const reset = this.requireContextPack(ownerId, bookId, packId);
    this.startContextPack(reset);
    return this.contextPackView(reset);
  }

  public listContextPacks(ownerId: string, bookId: string, input: {
    taskKind?: unknown; taskId?: unknown; limit?: unknown;
  }): unknown[] {
    this.requireBook(ownerId, bookId);
    const taskKind = optionalText(input.taskKind, '任务类型', 80);
    const taskId = optionalText(input.taskId, '任务编号', 160);
    const limit = integer(input.limit, '返回数量', 1, 100, 30);
    return this.repository.listContextPacks(ownerId, bookId, taskKind, taskId, limit).map((row) => this.contextPackView(row));
  }

  /** 仅由生效结算触发；结果只生成候选与问题，不直接修改正史。 */
  public triggerMaintenance(ownerId: string, bookId: string, input: {
    sourceKind?: unknown; sourceVersionId?: unknown; candidateEntityIds?: unknown;
  }): unknown {
    this.syncProfiles(ownerId, bookId);
    const sourceKind = settlementKind(input.sourceKind);
    const sourceVersionId = text(input.sourceVersionId, '结算版本', 1, 160);
    const verified = this.verifiedSettlement(ownerId, bookId, sourceKind, sourceVersionId);
    const existing = this.repository.maintenanceBySource(ownerId, bookId, sourceKind, sourceVersionId);
    if (existing !== undefined) {
      if (existing.source_hash !== verified.sourceHash) throw conflict('同一结算版本的正式内容已经变化，请先核查正史。');
      this.startMaintenance(existing);
      return this.maintenanceView(existing);
    }
    const explicit = input.candidateEntityIds === undefined ? undefined : ids(input.candidateEntityIds, '候选人物', 1, 100);
    const profiles = this.repository.listProfiles(ownerId, bookId, false);
    const inferred = exactSettlementProfileIds(verified.payload, profiles);
    const candidates = explicit ?? (inferred.length > 0
      ? inferred
      : profiles.filter((row) => row.narrative_tier === 'core').map((row) => row.entity_id));
    if (candidates.length > 100) throw conflict('本书人物较多，请由上游检索先提供本次结算涉及的人物候选。');
    this.requireCharacterEntities(ownerId, bookId, candidates);
    const availableMembers = this.members();
    const boundedDefault = availableMembers.find((member) => member.enabledByDefault && member.model.modelId === 'kimi-k3');
    const fallback = buildCharacterFallbackChain(boundedDefault?.memberKey, availableMembers);
    const run = this.repository.createMaintenance({
      runId: this.ids.next(), ownerId, bookId, sourceKind, sourceVersionId,
      sourceHash: verified.sourceHash, sourceCanonRevision: verified.canonRevision,
      sourceSnapshotJson: stableJson({ ...verified.payload, candidateEntityIds: candidates }),
      evidenceRefsJson: stableJson(verified.evidenceRefs), memberKey: fallback[0]!.memberKey,
      memberSnapshotJson: stableJson({
        fallback: fallback.map(memberSnapshot), temperature: 0.18, maxOutputTokens: 4_000
      }), now: this.now()
    });
    this.startMaintenance(run);
    return this.maintenanceView(run);
  }

  public getMaintenance(ownerId: string, bookId: string, runId: string): unknown {
    const row = this.requireMaintenance(ownerId, bookId, runId);
    this.startMaintenance(row);
    return this.maintenanceView(this.requireMaintenance(ownerId, bookId, runId));
  }

  public retryMaintenance(ownerId: string, bookId: string, runId: string): unknown {
    const row = this.requireMaintenance(ownerId, bookId, runId);
    if (row.status === 'unknown') throw conflict('上次结果还没确认，为避免重复扣量不能重试。');
    if (row.status !== 'failed') throw conflict('只有明确失败的人物维护任务可以重试。');
    const roster = this.executableMaintenanceSnapshot(row.member_snapshot_json);
    this.requireRecoveredMaintenanceBindings(row, roster.fallback);
    if (this.repository.resetMaintenanceForRetry(ownerId, bookId, runId, this.now()) !== 1) {
      throw conflict('人物维护任务状态已经变化。');
    }
    const reset = this.requireMaintenance(ownerId, bookId, runId);
    this.startMaintenance(reset);
    return this.maintenanceView(reset);
  }

  public pendingCandidates(ownerId: string, bookId: string): unknown[] {
    this.requireBook(ownerId, bookId);
    return parseRowJson(this.repository.pendingCandidates(ownerId, bookId));
  }

  public openIssues(ownerId: string, bookId: string): unknown[] {
    this.requireBook(ownerId, bookId);
    return parseRowJson(this.repository.openIssues(ownerId, bookId));
  }

  public decideCandidate(ownerId: string, bookId: string, candidateId: string, input: {
    decision?: unknown; idempotencyKey?: unknown;
  }): unknown {
    this.syncProfiles(ownerId, bookId);
    const candidate = this.repository.changeCandidate(ownerId, bookId, candidateId) as {
      candidate_id: string; entity_id: string; candidate_kind: 'profile_update' | 'canon_gap'; field_path: string;
      proposed_value_json: string; public_summary: string; reason: string; evidence_refs_json: string; state: string;
    } | undefined;
    if (candidate === undefined) throw notFound('人物变化建议不存在。');
    const profile = this.repository.profileByEntity(ownerId, bookId, candidate.entity_id);
    if (profile === undefined) throw notFound('人物档案不存在。');
    const decision = candidateDecision(input.decision);
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({ candidateId, decision }));
    const replay = this.repository.actionByKey(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.request_hash !== requestHash || replay.action_kind !== 'candidate_decision') {
        throw conflict('同一操作编号不能用于不同的人物建议处理。');
      }
      return this.candidateDecisionView(this.repository.changeCandidate(ownerId, bookId, candidateId)!);
    }
    if (candidate.state !== 'pending') throw conflict('这条人物建议已经处理过。');
    this.repository.runInTransaction(() => {
      const now = this.now();
      if (this.repository.decideCandidate({ ownerId, bookId, candidateId, state: decision, decidedBy: ownerId, now }) !== 1) {
        throw conflict('这条人物建议已经处理过。');
      }
      this.repository.insertAction({
        actionId: this.ids.next(), ownerId, bookId, profileId: profile.profile_id,
        profileVersionId: profile.active_version_id, actionKind: 'candidate_decision', idempotencyKey, requestHash,
        actorType: 'owner', actorId: ownerId, detailJson: stableJson({ candidateId, decision }), now
      });
    });
    return this.candidateDecisionView(this.repository.changeCandidate(ownerId, bookId, candidateId)!);
  }

  public decideIssue(ownerId: string, bookId: string, issueId: string, input: {
    decision?: unknown; idempotencyKey?: unknown;
  }): unknown {
    this.syncProfiles(ownerId, bookId);
    const issue = this.repository.reviewIssue(ownerId, bookId, issueId) as {
      issue_id: string; entity_id: string; issue_kind: string; severity: string; public_summary: string;
      suggested_action: string; evidence_refs_json: string; state: string;
    } | undefined;
    if (issue === undefined) throw notFound('人物审查问题不存在。');
    const profile = this.repository.profileByEntity(ownerId, bookId, issue.entity_id);
    if (profile === undefined) throw notFound('人物档案不存在。');
    const decision = issueDecision(input.decision);
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    const requestHash = sha256(stableJson({ issueId, decision }));
    const replay = this.repository.actionByKey(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.request_hash !== requestHash || replay.action_kind !== 'candidate_decision') {
        throw conflict('同一操作编号不能用于不同的人物问题处理。');
      }
      return this.issueDecisionView(this.repository.reviewIssue(ownerId, bookId, issueId)!);
    }
    if (issue.state !== 'open') throw conflict('这个人物问题已经处理过。');
    this.repository.runInTransaction(() => {
      const now = this.now();
      if (this.repository.decideIssue({ ownerId, bookId, issueId, state: decision, now }) !== 1) {
        throw conflict('这个人物问题已经处理过。');
      }
      this.repository.insertAction({
        actionId: this.ids.next(), ownerId, bookId, profileId: profile.profile_id,
        profileVersionId: profile.active_version_id, actionKind: 'candidate_decision', idempotencyKey, requestHash,
        actorType: 'owner', actorId: ownerId, detailJson: stableJson({ operation: 'issue_decision', issueId, decision }), now
      });
    });
    return this.issueDecisionView(this.repository.reviewIssue(ownerId, bookId, issueId)!);
  }

  public adminAudit(ownerId: string, bookId: string, runId: string): unknown {
    const context = this.repository.contextPack(ownerId, bookId, runId);
    if (context !== undefined) return { kind: 'context_pack', row: parseRow(context), calls: this.repository.modelCalls(ownerId, bookId, runId) };
    const maintenance = this.repository.maintenance(ownerId, bookId, runId);
    if (maintenance !== undefined) return { kind: 'maintenance', row: parseRow(maintenance), calls: this.repository.modelCalls(ownerId, bookId, runId) };
    throw notFound('人物资料任务不存在。');
  }

  private startContextPack(row: V7CharacterContextPackRow): void {
    if (!['queued', 'working'].includes(row.status) || this.activeContextPacks.has(row.context_pack_id)) return;
    this.activeContextPacks.add(row.context_pack_id);
    void this.executeContextPack(row).catch((error) => {
      this.repository.markContextPack({
        ownerId: row.owner_id, bookId: row.book_id, packId: row.context_pack_id,
        status: error instanceof V7CharacterMemoryModelError && error.outcomeUnknown ? 'unknown' : 'failed',
        errorMessage: publicFailure(error), now: this.now()
      });
    }).finally(() => this.activeContextPacks.delete(row.context_pack_id));
  }

  private async executeContextPack(row: V7CharacterContextPackRow): Promise<void> {
    const roster = this.executableContextSnapshot(row.member_snapshot_json);
    const book = this.requireBook(row.owner_id, row.book_id);
    if (book.canon_revision !== row.source_canon_revision) {
      this.repository.markContextPack({
        ownerId: row.owner_id, bookId: row.book_id, packId: row.context_pack_id,
        status: 'invalidated', errorMessage: '人物实际状态已经更新，请重新准备资料。', now: this.now()
      });
      return;
    }
    const candidateIds = json(row.candidate_entity_ids_json) as string[];
    const includeRelationships = roster.relationshipDepth > 0;
    const dossiers = candidateIds.map((entityId) => this.characterDossier(
      row.owner_id, row.book_id, entityId, false, includeRelationships
    ));
    const prompt = characterContextSelectionPrompt({ taskKind: row.task_kind, taskBrief: row.task_brief, candidates: dossiers, maxTokens: roster.maxTokens });
    let lastError: unknown;
    for (const [index, member] of roster.fallback.entries()) {
      const requestId = `${row.context_pack_id}:context:${row.retry_count}:${index + 1}`;
      this.repository.markContextPack({
        ownerId: row.owner_id, bookId: row.book_id, packId: row.context_pack_id,
        status: 'working', memberKey: member.memberKey, requestId, errorMessage: null, now: this.now()
      });
      try {
        const logicalTaskId = `${row.context_pack_id}:context:${index + 1}`;
        const result = await this.models.generate({
          requestId, logicalTaskId, technicalRetry: row.retry_count > 0,
          ownerId: row.owner_id, bookId: row.book_id, runId: row.context_pack_id,
          runKind: 'context_pack', member, prompt,
          maxOutputTokens: roster.maxOutputTokens, temperature: roster.temperature
        });
        const selection = parseCharacterContextSelection(result.output, candidateIds);
        const content = selection.selected.map((item) => {
          const fields = includeRelationships ? item.fields : item.fields.filter((field) => field !== 'relationships');
          return this.selectedDossier(
            this.characterDossier(row.owner_id, row.book_id, item.entityId, fields.includes('history'), includeRelationships), fields
          );
        });
        const contentJson = stableJson({
          schema: 'v7-character-task-context-v1', taskKind: row.task_kind, taskId: row.task_id,
          canonRevision: row.source_canon_revision, characters: content, openQuestions: selection.openQuestions
        });
        const estimatedTokens = estimateTokens(contentJson);
        if (estimatedTokens > roster.maxTokens) {
          throw new Error(`人物资料超过本次预算（约${estimatedTokens}，预算${roster.maxTokens}），请缩小候选人物范围。`);
        }
        this.repository.markContextPack({
          ownerId: row.owner_id, bookId: row.book_id, packId: row.context_pack_id, status: 'active',
          memberKey: member.memberKey, requestId,
          selectedEntityIdsJson: stableJson(selection.selected.map((item) => item.entityId)),
          selectedFieldsJson: stableJson(Object.fromEntries(selection.selected.map((item) => [item.entityId, item.fields]))),
          selectionReasonsJson: stableJson(Object.fromEntries(selection.selected.map((item) => [item.entityId, item.reason]))),
          openQuestionsJson: stableJson(selection.openQuestions), contentJson, estimatedTokens,
          contentHash: sha256(contentJson), errorMessage: null, now: this.now()
        });
        return;
      } catch (error) {
        if (error instanceof V7CharacterMemoryModelError && error.outcomeUnknown) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error('没有人物资料成员完成本次资料整理');
  }

  private startMaintenance(row: V7CharacterMaintenanceRow): void {
    if (!['queued', 'working'].includes(row.status) || this.activeMaintenanceRuns.has(row.maintenance_run_id)) return;
    this.activeMaintenanceRuns.add(row.maintenance_run_id);
    void this.executeMaintenance(row).catch((error) => {
      this.repository.markMaintenance({
        ownerId: row.owner_id, bookId: row.book_id, runId: row.maintenance_run_id,
        status: error instanceof V7CharacterMemoryModelError && error.outcomeUnknown ? 'unknown' : 'failed',
        errorMessage: publicFailure(error), now: this.now()
      });
    }).finally(() => this.activeMaintenanceRuns.delete(row.maintenance_run_id));
  }

  private async executeMaintenance(row: V7CharacterMaintenanceRow): Promise<void> {
    const roster = this.executableMaintenanceSnapshot(row.member_snapshot_json);
    this.requireRecoveredMaintenanceBindings(row, roster.fallback);
    const verified = this.verifiedSettlement(row.owner_id, row.book_id, row.source_kind, row.source_version_id);
    if (verified.sourceHash !== row.source_hash) throw conflict('正式结算内容已经变化，本次人物更新已停止。');
    const sourceSnapshot = json(row.source_snapshot_json) as Record<string, unknown> & { candidateEntityIds: string[] };
    const dossiers = sourceSnapshot.candidateEntityIds.map((entityId) => this.characterDossier(row.owner_id, row.book_id, entityId, false));
    const prompt = characterMaintenancePrompt({ settlement: verified.payload, characters: dossiers, evidenceRefs: verified.evidenceRefs });
    const persist = (output: ReturnType<typeof parseCharacterMaintenanceOutput>, memberKey: string, requestId: string): void => {
      const now = this.now();
      this.repository.replaceMaintenanceResult({
        ownerId: row.owner_id, bookId: row.book_id, runId: row.maintenance_run_id,
        changes: output.changes.map((change) => ({
          candidateId: this.ids.next(), entityId: change.entityId, kind: change.kind, fieldPath: change.fieldPath,
          proposedValueJson: stableJson(change.proposedValue), publicSummary: change.publicSummary,
          reason: change.reason, evidenceRefsJson: stableJson(change.evidenceRefs)
        })),
        issues: output.issues.map((issue) => ({
          issueId: this.ids.next(), entityId: issue.entityId, kind: issue.kind, severity: issue.severity,
          publicSummary: issue.publicSummary, evidenceRefsJson: stableJson(issue.evidenceRefs),
          suggestedAction: issue.suggestedAction
        })), now
      });
      this.repository.markMaintenance({
        ownerId: row.owner_id, bookId: row.book_id, runId: row.maintenance_run_id,
        status: output.changes.length > 0 || output.issues.length > 0 ? 'awaiting_review' : 'completed',
        memberKey, requestId, resultJson: stableJson(output), errorMessage: null, now
      });
    };
    for (const recovered of this.repository.succeededMaintenanceCalls(row.owner_id, row.book_id, row.maintenance_run_id)) {
      if (recovered.output_text === null) continue;
      try {
        persist(parseCharacterMaintenanceOutput(recovered.output_text, sourceSnapshot.candidateEntityIds, verified.evidenceRefs), recovered.member_key, recovered.request_id);
        return;
      } catch {
        // A prior result may use an older incompatible contract. Try the next saved result before making a new call.
      }
    }
    let lastError: unknown;
    for (const [index, member] of roster.fallback.entries()) {
      const requestId = `${row.maintenance_run_id}:maintenance:${row.retry_count}:${index + 1}`;
      this.repository.markMaintenance({
        ownerId: row.owner_id, bookId: row.book_id, runId: row.maintenance_run_id,
        status: 'working', memberKey: member.memberKey, requestId, errorMessage: null, now: this.now()
      });
      try {
        const logicalTaskId = `${row.maintenance_run_id}:maintenance:${index + 1}`;
        const result = await this.models.generate({
          requestId, logicalTaskId, technicalRetry: row.retry_count > 0,
          ownerId: row.owner_id, bookId: row.book_id, runId: row.maintenance_run_id,
          runKind: 'maintenance', member, prompt,
          maxOutputTokens: roster.maxOutputTokens, temperature: roster.temperature
        });
        const output = parseCharacterMaintenanceOutput(result.output, sourceSnapshot.candidateEntityIds, verified.evidenceRefs);
        persist(output, member.memberKey, requestId);
        return;
      } catch (error) {
        if (error instanceof V7CharacterMemoryModelError && error.outcomeUnknown) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error('没有人物资料成员完成本次维护');
  }

  private executableContextSnapshot(snapshotJson: string): CharacterContextTaskSnapshot {
    try {
      return characterTaskSnapshot(snapshotJson, this.members(), 'context_pack');
    } catch {
      throw historicalCharacterTaskConflict();
    }
  }

  private executableMaintenanceSnapshot(snapshotJson: string): CharacterMaintenanceTaskSnapshot {
    try {
      return characterTaskSnapshot(snapshotJson, this.members(), 'maintenance');
    } catch {
      throw historicalCharacterTaskConflict();
    }
  }

  private requireRecoveredMaintenanceBindings(
    row: V7CharacterMaintenanceRow,
    members: readonly V7CharacterMemberDefinition[]
  ): void {
    for (const recovered of this.repository.succeededMaintenanceCalls(
      row.owner_id, row.book_id, row.maintenance_run_id
    )) {
      if (!recoveredCallUsesFrozenBinding(recovered, members)) throw historicalCharacterTaskConflict();
    }
  }

  private characterDossier(
    ownerId: string,
    bookId: string,
    entityId: string,
    includeHistory: boolean,
    includeRelationships = true
  ): Record<string, unknown> {
    const book = this.requireBook(ownerId, bookId);
    const entity = this.repository.characterEntity(ownerId, bookId, entityId);
    if (entity === undefined) throw notFound('人物不存在或不属于本书。');
    const profile = this.repository.profileByEntity(ownerId, bookId, entityId);
    const active = profile === undefined ? undefined : this.repository.activeProfileVersion(ownerId, bookId, profile.profile_id);
    return {
      entityId, displayName: entity.canonical_name,
      profile: active === undefined ? null : json(active.content_json),
      state: this.repository.currentState(ownerId, bookId, entityId, book.canon_revision),
      relationships: includeRelationships
        ? parseRowJson(this.repository.relationships(ownerId, bookId, entityId, book.canon_revision))
        : undefined,
      knowledge: parseRowJson(this.repository.knowledge(ownerId, bookId, entityId)),
      history: includeHistory ? parseRowJson(this.repository.factHistory(ownerId, bookId, entityId, 50)) : undefined,
      openQuestions: active === undefined ? [] : (json(active.content_json) as CharacterProfileDocument).openQuestions
    };
  }

  private selectedDossier(dossier: Record<string, unknown>, fields: CharacterContextField[]): Record<string, unknown> {
    const selected: Record<string, unknown> = { entityId: dossier.entityId, displayName: dossier.displayName };
    for (const field of fields) selected[field] = dossier[field];
    return selected;
  }

  private verifiedSettlement(ownerId: string, bookId: string, sourceKind: SourceKind, sourceVersionId: string): {
    sourceHash: string; canonRevision: number; payload: Record<string, unknown>; evidenceRefs: string[];
  } {
    const stageType = sourceKind === 'chapter_settlement' ? 'chapter' : sourceKind === 'event_settlement' ? 'story_arc' : 'volume';
    const row = this.repository.activeSettlement(ownerId, bookId, sourceVersionId, stageType);
    if (row === undefined) throw notFound('正式结算不存在、尚未生效或不属于本书。');
    const sources = this.repository.settlementSources(ownerId, bookId, sourceVersionId);
    const payload = {
      settlementId: sourceVersionId, sourceKind, stageKey: row.stage_key, version: row.version,
      chapterRange: [row.chapter_start, row.chapter_end], canonRevision: row.canon_revision,
      irreversibleResults: parseMaybeJson(row.irreversible_results_json),
      entityStates: parseMaybeJson(row.entity_states_json),
      relationshipChanges: parseMaybeJson(row.relationship_changes_json),
      knowledgeChanges: parseMaybeJson(row.knowledge_changes_json),
      closedThreads: parseMaybeJson(row.closed_threads_json), openThreads: parseMaybeJson(row.open_threads_json),
      exclusions: parseMaybeJson(row.exclusions_json), evidence: parseRowJson(sources)
    };
    const directEvidenceRefs = sources.flatMap((source) => {
      const sourceId = String(source.source_id);
      const sourceHash = String(source.source_hash);
      return source.source_type === 'confirmed_v7_manuscript' && sourceHash.length > 0
        ? [`manuscript:${sourceId}:${sourceHash}`]
        : [];
    });
    return {
      sourceHash: sha256(stableJson(payload)), canonRevision: Number(row.canon_revision), payload,
      evidenceRefs: [...new Set([sourceVersionId, ...sources.map((source) => String(source.source_id)), ...directEvidenceRefs])]
    };
  }

  private insertProfileVersion(
    ownerId: string, bookId: string, profileId: string, versionId: string, document: CharacterProfileDocument,
    meta: {
      lifecycle: 'candidate' | 'active'; authorityLayer: 'candidate' | 'confirmed_reference';
      sourceKind: 'owner' | 'agent'; sourceId: string | null; basedOnVersionId: string | null;
      createdByType: 'owner' | 'agent'; createdById: string; now: string;
    }
  ): void {
    const book = this.requireBook(ownerId, bookId);
    const contentJson = stableJson(document);
    this.repository.insertProfileVersion({
      versionId, ownerId, bookId, profileId,
      revision: this.repository.nextProfileRevision(ownerId, bookId, profileId), lifecycle: meta.lifecycle,
      authorityLayer: meta.authorityLayer, contentJson, contentHash: sha256(contentJson),
      sourceKind: meta.sourceKind, sourceId: meta.sourceId, sourceCanonRevision: book.canon_revision,
      basedOnVersionId: meta.basedOnVersionId, createdByType: meta.createdByType,
      createdById: meta.createdById, now: meta.now
    });
  }

  private replayAction(
    ownerId: string, bookId: string,
    action: { profile_id: string; profile_version_id: string | null; request_hash: string; action_kind: string },
    requestHash: string, expectedKind: string
  ): unknown {
    if (action.request_hash !== requestHash || action.action_kind !== expectedKind) {
      throw conflict('同一操作编号不能用于不同的人物档案修改。');
    }
    return this.getProfile(ownerId, bookId, action.profile_id);
  }

  private requireBook(ownerId: string, bookId: string): { canon_revision: number } {
    const book = this.repository.book(ownerId, bookId);
    if (book === undefined) throw notFound('书籍不存在或不属于当前账号。');
    return book;
  }

  private members(): readonly V7CharacterMemberDefinition[] {
    const members = typeof this.memberSource === 'function' ? this.memberSource() : this.memberSource;
    const errors = validateCharacterRoster(members);
    if (errors.length > 0) throw new Error(errors.join('；'));
    return members;
  }

  private requireProfile(ownerId: string, bookId: string, profileId: string): V7CharacterProfileRow {
    const profile = this.repository.profile(ownerId, bookId, profileId);
    if (profile === undefined) throw notFound('人物档案不存在或不属于本书。');
    return profile;
  }

  private requireCharacterEntities(ownerId: string, bookId: string, entityIds: string[]): void {
    for (const entityId of entityIds) {
      if (this.repository.characterEntity(ownerId, bookId, entityId) === undefined) {
        throw new DomainError(errorCodes.bookScopeViolation, '候选人物不存在或不属于本书。', {}, false, 403);
      }
    }
  }

  private requireContextPack(ownerId: string, bookId: string, packId: string): V7CharacterContextPackRow {
    const row = this.repository.contextPack(ownerId, bookId, packId);
    if (row === undefined) throw notFound('人物资料包任务不存在。');
    return row;
  }

  private requireMaintenance(ownerId: string, bookId: string, runId: string): V7CharacterMaintenanceRow {
    const row = this.repository.maintenance(ownerId, bookId, runId);
    if (row === undefined) throw notFound('人物维护任务不存在。');
    return row;
  }

  private contextPackView(row: V7CharacterContextPackRow): unknown {
    const member = memberView(row.selection_member_key, this.members());
    return {
      contextPackId: row.context_pack_id, taskKind: row.task_kind, taskId: row.task_id,
      status: publicStatus(row.status), message: statusMessage(row.status, member.name, '人物资料'), member,
      selectedCharacterCount: row.selected_entity_ids_json === null ? 0 : (json(row.selected_entity_ids_json) as unknown[]).length,
      estimatedTokens: row.estimated_tokens, retryCount: row.retry_count,
      content: row.status === 'active' && row.content_json !== null ? json(row.content_json) : null,
      errorMessage: publicTaskError(row.status), canonRevision: row.source_canon_revision
    };
  }

  private maintenanceView(row: V7CharacterMaintenanceRow): unknown {
    const member = memberView(row.assigned_member_key, this.members());
    const result = row.result_json === null ? null : json(row.result_json) as { changes?: unknown[]; issues?: unknown[] };
    return {
      runId: row.maintenance_run_id, sourceKind: row.source_kind, sourceVersionId: row.source_version_id,
      status: publicStatus(row.status), message: statusMessage(row.status, member.name, '人物变化'), member,
      candidateCount: result?.changes?.length ?? 0, issueCount: result?.issues?.length ?? 0, retryCount: row.retry_count,
      errorMessage: publicTaskError(row.status), canonRevision: row.source_canon_revision
    };
  }

  private candidateDecisionView(row: Record<string, unknown>): unknown {
    const state = String(row.state ?? 'pending');
    const kind = String(row.candidate_kind ?? 'profile_update');
    return {
      candidateId: row.candidate_id, entityId: row.entity_id, kind,
      fieldPath: row.field_path, proposedValue: parseMaybeJson(row.proposed_value_json),
      publicSummary: row.public_summary, reason: row.reason,
      evidenceRefs: parseMaybeJson(row.evidence_refs_json), state,
      nextStep: state !== 'accepted' ? 'none'
        : kind === 'profile_update' ? 'create_profile_version' : 'submit_to_canon_review',
      message: state === 'accepted'
        ? '这条建议已保留，仍需进入对应档案版本或正史审核后才会生效。'
        : '这条建议已忽略，不会修改人物资料或正史。'
    };
  }

  private issueDecisionView(row: Record<string, unknown>): unknown {
    return {
      issueId: row.issue_id, entityId: row.entity_id, kind: row.issue_kind, severity: row.severity,
      publicSummary: row.public_summary, suggestedAction: row.suggested_action,
      evidenceRefs: parseMaybeJson(row.evidence_refs_json), state: row.state,
      message: row.state === 'resolved' ? '这个问题已标记为处理完成。' : '这个问题已忽略。'
    };
  }

  private now(): string { return this.clock.now().toISOString(); }
}

function memberSnapshot(member: V7CharacterMemberDefinition): V7CharacterMemberDefinition {
  return JSON.parse(JSON.stringify(member)) as V7CharacterMemberDefinition;
}

function characterTaskSnapshot(
  snapshotJson: string,
  currentMembers: readonly V7CharacterMemberDefinition[],
  kind: 'context_pack'
): CharacterContextTaskSnapshot;
function characterTaskSnapshot(
  snapshotJson: string,
  currentMembers: readonly V7CharacterMemberDefinition[],
  kind: 'maintenance'
): CharacterMaintenanceTaskSnapshot;
function characterTaskSnapshot(
  snapshotJson: string,
  currentMembers: readonly V7CharacterMemberDefinition[],
  kind: 'context_pack' | 'maintenance'
): CharacterContextTaskSnapshot | CharacterMaintenanceTaskSnapshot {
  const snapshot = JSON.parse(snapshotJson) as unknown;
  if (!isPlainRecord(snapshot) || !Array.isArray(snapshot.fallback) || snapshot.fallback.length === 0) {
    throw new Error('人物任务成员快照不完整');
  }
  const first = snapshot.fallback[0];
  if (!isPlainRecord(first) || typeof first.memberKey !== 'string') throw new Error('人物任务首位成员无效');
  const expectedFallback = buildCharacterFallbackChain(first.memberKey, currentMembers).map(memberSnapshot);
  if (stableJson(snapshot.fallback) !== stableJson(expectedFallback)) {
    throw new Error('人物任务冻结成员与当前批准名册不一致');
  }
  const fallback = snapshot.fallback.map((member) => memberSnapshot(member as V7CharacterMemberDefinition));
  if (kind === 'context_pack') {
    if (!Number.isInteger(snapshot.maxTokens) || Number(snapshot.maxTokens) < 800 || Number(snapshot.maxTokens) > 12_000) {
      throw new Error('人物资料包预算无效');
    }
    if (snapshot.relationshipDepth !== 0 && snapshot.relationshipDepth !== 1) {
      throw new Error('人物关系读取深度无效');
    }
    if (snapshot.temperature !== 0.12 || snapshot.maxOutputTokens !== 3_000) {
      throw new Error('人物资料任务执行参数已经退役');
    }
    return {
      fallback,
      maxTokens: Number(snapshot.maxTokens),
      relationshipDepth: snapshot.relationshipDepth,
      temperature: snapshot.temperature,
      maxOutputTokens: snapshot.maxOutputTokens
    };
  }
  if (snapshot.temperature !== 0.18 || snapshot.maxOutputTokens !== 4_000) {
    throw new Error('人物维护任务执行参数已经退役');
  }
  return {
    fallback,
    temperature: snapshot.temperature,
    maxOutputTokens: snapshot.maxOutputTokens
  };
}

function recoveredCallUsesFrozenBinding(
  call: V7CharacterModelCallRow,
  members: readonly V7CharacterMemberDefinition[]
): boolean {
  const member = members.find((candidate) => candidate.memberKey === call.member_key);
  return member !== undefined
    && member.model.provider === call.provider
    && member.model.modelId === call.model_id
    && member.model.plan === call.plan;
}

function historicalCharacterTaskConflict(): DomainError {
  return conflict('这是一轮历史人物任务，已保存的资料和结果仍会保留，但旧成员或旧模型不能继续执行。请重新创建当前人物任务。');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function authorActionView(row: Record<string, unknown>): Record<string, unknown> {
  const detail = parseMaybeJson(row.detail) as Record<string, unknown> | undefined;
  const actionKind = String(row.actionKind ?? '');
  const action = actionKind === 'create' ? '新建人物'
    : actionKind === 'activate' || actionKind === 'rollback' ? '切换档案版本'
      : actionKind === 'archive' ? '归档人物'
        : actionKind === 'restore' ? '恢复人物'
          : actionKind === 'candidate_decision' ? '处理人物建议'
            : detail?.operation === 'organize' ? '调整人物重要程度'
              : detail?.operation === 'aliases' ? '更新人物别名' : '新增档案版本';
  return {
    action,
    source: row.actorType === 'owner' ? '作者' : row.actorType === 'agent' ? '人物资料成员' : '系统',
    detail: detail?.operation === 'organize' ? { narrativeTier: detail.narrativeTier }
      : detail?.operation === 'aliases' ? { aliases: detail.aliases } : undefined,
    createdAt: row.createdAt
  };
}

function memberView(memberKey: string, members: readonly V7CharacterMemberDefinition[]): { memberKey: string; name: string } {
  const member = members.find((candidate) => candidate.memberKey === memberKey);
  return { memberKey, name: member?.displayName ?? '人物资料员' };
}

function publicStatus(status: string): 'waiting' | 'working' | 'completed' | 'needs_review' | 'failed' | 'result_unknown' | 'outdated' {
  if (status === 'queued') return 'waiting';
  if (status === 'working') return 'working';
  if (status === 'active' || status === 'completed') return 'completed';
  if (status === 'awaiting_review') return 'needs_review';
  if (status === 'unknown') return 'result_unknown';
  if (status === 'invalidated') return 'outdated';
  return 'failed';
}

function statusMessage(status: string, memberName: string, subject: string): string {
  if (status === 'queued') return `${memberName}已经接单，马上开始整理${subject}。`;
  if (status === 'working') return `${memberName}正在核对${subject}，请稍等。`;
  if (status === 'active' || status === 'completed') return `${subject}已经整理好了。`;
  if (status === 'awaiting_review') return `${subject}已经整理好，有几项需要您决定。`;
  if (status === 'unknown') return '抱歉，这次结果还没确认，为避免重复扣量已经停下，请稍后核查。';
  if (status === 'invalidated') return '人物实际状态已经更新，这份旧资料不再使用。';
  return `抱歉，这次${subject}没有完成，可以重新交接给其他成员。`;
}

function tier(value: unknown): V7CharacterProfileRow['narrative_tier'] {
  if (value === 'core' || value === 'important' || value === 'supporting' || value === 'cameo' || value === 'unknown') return value;
  return 'unknown';
}

function requiredTier(value: unknown): V7CharacterProfileRow['narrative_tier'] {
  if (value === 'core' || value === 'important' || value === 'supporting' || value === 'cameo' || value === 'unknown') return value;
  throw new DomainError(errorCodes.validation, '人物重要程度不正确。');
}

function candidateDecision(value: unknown): 'accepted' | 'dismissed' {
  if (value === 'accept') return 'accepted';
  if (value === 'dismiss') return 'dismissed';
  throw new DomainError(errorCodes.validation, '请选择采纳或忽略人物建议。');
}

function issueDecision(value: unknown): 'resolved' | 'dismissed' {
  if (value === 'resolve') return 'resolved';
  if (value === 'dismiss') return 'dismissed';
  throw new DomainError(errorCodes.validation, '请选择完成处理或忽略这个问题。');
}

function settlementKind(value: unknown): SourceKind {
  if (value === 'chapter_settlement' || value === 'event_settlement' || value === 'volume_settlement') return value;
  throw new DomainError(errorCodes.validation, '人物维护只能读取已经生效的章、单元链或卷结算。');
}

function exactSettlementProfileIds(
  settlement: Record<string, unknown>,
  profiles: ReadonlyArray<{ entity_id: string; display_name: string; narrative_tier: string }>
): string[] {
  const byName = new Map(profiles.map((profile) => [profile.display_name.trim(), profile.entity_id]));
  const knownIds = new Set(profiles.map((profile) => profile.entity_id));
  const selected = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== 'object' || value === null) return;
    const item = value as Record<string, unknown>;
    for (const key of ['entityId', 'fromEntityId', 'toEntityId']) {
      const entityId = item[key];
      if (typeof entityId === 'string' && knownIds.has(entityId)) selected.add(entityId);
    }
    for (const key of ['name', 'displayName', 'from', 'to', 'knower']) {
      const name = item[key];
      if (typeof name !== 'string') continue;
      const entityId = byName.get(name.trim());
      if (entityId !== undefined) selected.add(entityId);
    }
  };
  visit(settlement.entityStates);
  visit(settlement.relationshipChanges);
  visit(settlement.knowledgeChanges);
  return [...selected];
}

function ids(value: unknown, label: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value)) throw new DomainError(errorCodes.validation, `${label}格式不正确。`);
  const result = [...new Set(value.map((item) => text(item, label, 1, 160)))];
  if (result.length < minimum || result.length > maximum) throw new DomainError(errorCodes.validation, `${label}需要${minimum}至${maximum}项。`);
  return result;
}

function integer(value: unknown, label: string, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new DomainError(errorCodes.validation, `${label}需要在${minimum}至${maximum}之间。`);
  }
  return Number(value);
}

function text(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, `${label}格式不正确。`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new DomainError(errorCodes.validation, `${label}长度需要在${minimum}至${maximum}字之间。`);
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, label, 1, maximum);
}

function normalizedTexts(value: unknown): string[] {
  if (!Array.isArray(value)) throw new DomainError(errorCodes.validation, '人物别名格式不正确。');
  return value.map((item) => text(item, '人物别名', 1, 120)).toSorted((left, right) => left.localeCompare(right, 'zh-CN'));
}

function parseRow(value: object): Record<string, unknown> {
  return parseRowJson([value as Record<string, unknown>])[0]!;
}

function parseRowJson(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, parseMaybeJson(value)])));
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return value;
  try { return JSON.parse(trimmed) as unknown; } catch { return value; }
}

function json(value: string): unknown { return JSON.parse(value) as unknown; }
function estimateTokens(value: string): number { return Math.ceil(value.length / 2.2); }

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '这次没有完成';
  return message.replace(/\s+/g, ' ').slice(0, 500);
}
function publicTaskError(status: string): string | null {
  if (status === 'unknown') return '抱歉，这次结果还没确认。为避免重复扣量，已经暂停继续调用。';
  if (status === 'failed') return '对不起，这次没有完成，可以重新交接给其他成员。';
  if (status === 'invalidated') return '人物实际状态已经更新，请重新准备资料。';
  return null;
}
function conflict(message: string): DomainError { return new DomainError(errorCodes.validation, message, {}, false, 409); }
function notFound(message: string): DomainError { return new DomainError(errorCodes.bookNotFound, message, {}, false, 404); }
