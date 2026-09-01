import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  modelProfileKeyForBinding,
  parseStructuredObject,
  settingRosterFromGlobal,
  sha256,
  stableStringify,
  validateBookGenreProfile,
  type V7BookGenreProfile,
  type V7ContextSourceTrace,
  type V7GenrePersonaContent,
  type V7PromptAssetVersion,
  type V7SettingMemberDefinition,
  type V7TaskContract
} from '@wenmi/v7-backend';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError } from '../../domain/errors.js';
import { V7AgentGovernanceRepository } from '../../infrastructure/db/repositories/v7-agent-governance-repository.js';
import {
  V7SettingEditorialRepository,
  type V7GenreProfileBatchStateRow,
  type V7SettingBatchRow
} from '../../infrastructure/db/repositories/v7-setting-editorial-repository.js';
import {
  V7PromptGovernanceRepository,
  type V7StoredPromptAssetVersion
} from '../../infrastructure/db/repositories/v7-prompt-governance-repository.js';
import type { V7OpeningModelAdapterResolver } from '../../infrastructure/models/v7-opening-agent-model-gateway.js';
import { ModelAdapterError } from '../../infrastructure/models/model-adapter.js';
import { assertMembershipAllowsGeneration } from '../../infrastructure/security/membership-service.js';
import { BookProfileViewService, type BookProfileView } from '../books/book-profile-view-service.js';
import { resolveV7TaskPolicy } from './v7-agent-runtime-policy.js';
import { compileV7RuntimePrompt } from './v7-runtime-prompt-compiler.js';

const GENRE_PROFILE_CONTRACT_VERSION = 2;
const GENRE_PROFILE_LEASE_MS = 15 * 60_000;
const GENRE_PROFILE_WAIT_MS = 5 * 60_000;
const GENRE_PROFILE_POLL_MS = 200;
const GENRE_PROFILE_ITEM_KEY = '__genre_profile__';
const GENRE_PROFILE_NODE_KEY = 'genre_profile';

const pendingByDatabase = new WeakMap<DatabaseSync, Map<string, Promise<V7BookGenreProfile>>>();

type GenreProfileSources = Readonly<{
  profile: BookProfileView;
  genreAssets: V7StoredPromptAssetVersion[];
  active: V7BookGenreProfile | null;
  fingerprint: string;
  openingHash: string;
}>;

export class V7BookGenreProfileEnsureError extends Error {
  public constructor(
    message: string,
    public readonly outcomeUnknown = false,
    public readonly domainCode: string | null = null
  ) {
    super(message);
    this.name = 'V7BookGenreProfileEnsureError';
  }
}

export class V7BookGenreProfileEnsureInProgressError extends V7BookGenreProfileEnsureError {
  public constructor() {
    super('本书题材档案已经由另一服务实例接手。');
  }
}

/**
 * Ensures one immutable, book-scoped genre profile before downstream creative work.
 * The service calls the configured deputy model directly, so invoking it from a
 * planning/creation/character gateway cannot recursively enter those gateways.
 */
export class V7BookGenreProfileEnsureService {
  private readonly repository: V7SettingEditorialRepository;
  private readonly promptGovernance: V7PromptGovernanceRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly adapters: V7OpeningModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new V7SettingEditorialRepository(database);
    this.promptGovernance = new V7PromptGovernanceRepository(database);
  }

  public async ensure(
    ownerId: string,
    bookId: string,
    options: { failFastOnActiveLease?: boolean } = {}
  ): Promise<V7BookGenreProfile> {
    try {
      const initial = this.sources(ownerId, bookId);
      if (genreProfileIsCurrent(initial.active, initial.profile, initial.genreAssets)) return initial.active!;
      let pending = pendingByDatabase.get(this.database);
      if (pending === undefined) {
        pending = new Map();
        pendingByDatabase.set(this.database, pending);
      }
      const key = `${ownerId}\u0000${bookId}`;
      const existing = pending.get(key);
      if (existing !== undefined) return await existing;
      const created = this.ensureInternal(ownerId, bookId, options.failFastOnActiveLease === true).finally(() => {
        if (pending?.get(key) === created) pending.delete(key);
      });
      pending.set(key, created);
      return await created;
    } catch (error) {
      throw ensureError(error);
    }
  }

  private async ensureInternal(
    ownerId: string,
    bookId: string,
    failFastOnActiveLease: boolean
  ): Promise<V7BookGenreProfile> {
    const waitDeadline = Date.now() + GENRE_PROFILE_WAIT_MS;
    for (;;) {
      const sources = this.sources(ownerId, bookId);
      if (genreProfileIsCurrent(sources.active, sources.profile, sources.genreAssets)) return sources.active!;
      const deputy = this.deputy(this.clock.now().toISOString());
      const logicalTaskId = `genre-profile-${sources.fingerprint}`;
      const idempotencyKey = `genre-profile-${sources.fingerprint.slice(0, 48)}`;
      const queued = genreProfileBatchState(logicalTaskId, sources.fingerprint, 'queued', deputy);
      let batch = this.repository.ensureGenreProfileBatch({
        batchId: this.ids.next(),
        ownerId,
        bookId,
        idempotencyKey,
        sourceFingerprint: sources.fingerprint,
        openingVersion: sources.profile.version,
        openingHash: sources.openingHash,
        rosterJson: JSON.stringify([deputy]),
        stateJson: JSON.stringify(queued),
        now: this.clock.now().toISOString()
      });

      const attempt = this.repository.genreProfileModelAttempt(
        ownerId, bookId, batch.batch_id, logicalTaskId
      );
      if (batch.status === 'partially_failed') {
        if (attempt?.state === 'unknown' || attempt?.state === 'working') {
          throw new V7BookGenreProfileEnsureError(
            attempt.failure_message ?? '上次题材档案结果还不能确认，已停止自动重试。',
            true
          );
        }
        const reset = this.repository.resetKnownFailedGenreProfileBatch({
          ownerId,
          bookId,
          batchId: batch.batch_id,
          stateJson: JSON.stringify(queued),
          now: this.clock.now().toISOString()
        });
        if (reset) batch = this.repository.genreProfileBatch(ownerId, bookId, idempotencyKey) ?? batch;
      }
      if (batch.status === 'completed') {
        const current = this.sources(ownerId, bookId);
        if (genreProfileIsCurrent(current.active, current.profile, current.genreAssets)) return current.active!;
        throw new V7BookGenreProfileEnsureError('题材档案任务已完成，但活动档案与当前开书资料不一致。');
      }

      const token = randomUUID();
      const claimedAt = this.clock.now();
      const wasReclaimed = batch.status === 'working';
      const working = genreProfileBatchState(logicalTaskId, sources.fingerprint, 'working', deputy);
      const claimed = this.repository.claimGenreProfileBatch({
        ownerId,
        bookId,
        batchId: batch.batch_id,
        token,
        leaseExpiresAt: new Date(claimedAt.getTime() + GENRE_PROFILE_LEASE_MS).toISOString(),
        now: claimedAt.toISOString(),
        stateJson: JSON.stringify(working)
      });
      if (!claimed) {
        const current = this.repository.genreProfileBatch(ownerId, bookId, idempotencyKey);
        const currentAttempt = current === undefined
          ? undefined
          : this.repository.genreProfileModelAttempt(ownerId, bookId, current.batch_id, logicalTaskId);
        if (currentAttempt?.state === 'unknown') {
          throw new V7BookGenreProfileEnsureError(
            currentAttempt.failure_message ?? '上次题材档案结果还不能确认，已停止自动重试。',
            true
          );
        }
        const leaseExpiresAt = current?.lease_expires_at === null || current?.lease_expires_at === undefined
          ? Number.NaN
          : Date.parse(current.lease_expires_at);
        if (failFastOnActiveLease
          && current?.status === 'working'
          && current.lease_token !== null
          && Number.isFinite(leaseExpiresAt)
          && leaseExpiresAt > this.clock.now().getTime()) {
          throw new V7BookGenreProfileEnsureInProgressError();
        }
        if (Date.now() >= waitDeadline) {
          throw new V7BookGenreProfileEnsureError('题材档案仍在生成，请稍后重新进入当前任务。', true);
        }
        await delay(GENRE_PROFILE_POLL_MS);
        continue;
      }
      return await this.runClaimed(ownerId, bookId, batch, token, sources, deputy, logicalTaskId, wasReclaimed);
    }
  }

  private async runClaimed(
    ownerId: string,
    bookId: string,
    batch: V7SettingBatchRow,
    token: string,
    sources: GenreProfileSources,
    deputy: V7SettingMemberDefinition,
    logicalTaskId: string,
    wasReclaimed: boolean
  ): Promise<V7BookGenreProfile> {
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      try {
        const renewedAt = this.clock.now();
        if (!this.repository.renewGenreProfileLease({
          ownerId,
          bookId,
          batchId: batch.batch_id,
          token,
          leaseExpiresAt: new Date(renewedAt.getTime() + GENRE_PROFILE_LEASE_MS).toISOString(),
          now: renewedAt.toISOString()
        })) leaseLost = true;
      } catch {
        leaseLost = true;
      }
    }, Math.floor(GENRE_PROFILE_LEASE_MS / 3));
    heartbeat.unref();
    try {
      if (wasReclaimed) {
        const unknownCalls = this.repository.markReclaimedGenreProfileCallsUnknown(
          ownerId, bookId, batch.batch_id, this.clock.now().toISOString()
        );
        if (unknownCalls > 0) {
          throw new V7BookGenreProfileEnsureError(
            '上次服务中断后无法确认题材档案结果，已停止自动重试。',
            true
          );
        }
      }
      this.assertSourcesCurrent(ownerId, bookId, sources);
      const previous = this.repository.genreProfileModelAttempt(ownerId, bookId, batch.batch_id, logicalTaskId);
      if (previous?.state === 'working' || previous?.state === 'unknown') {
        throw new V7BookGenreProfileEnsureError(
          previous.failure_message ?? '上次题材档案结果还不能确认，已停止自动重试。',
          true
        );
      }

      let candidate: V7BookGenreProfile;
      if (previous?.state === 'succeeded' && previous.output_text !== null) {
        candidate = this.profileCandidate(ownerId, bookId, logicalTaskId, sources, previous.output_text);
      } else {
        candidate = await this.generate(ownerId, bookId, batch.batch_id, token, logicalTaskId, deputy, sources,
          previous?.state === 'failed');
      }
      const verifiedAt = this.clock.now();
      const stillOwnsLease = !leaseLost && this.repository.renewGenreProfileLease({
        ownerId,
        bookId,
        batchId: batch.batch_id,
        token,
        leaseExpiresAt: new Date(verifiedAt.getTime() + GENRE_PROFILE_LEASE_MS).toISOString(),
        now: verifiedAt.toISOString()
      });
      if (!stillOwnsLease) {
        throw new V7BookGenreProfileEnsureError(
          '题材档案生成期间任务租约已经变化，已停止自动落档，请刷新核对结果。',
          true
        );
      }
      this.assertSourcesCurrent(ownerId, bookId, sources);
      const recorded = this.recordCandidate(candidate, sources, deputy.memberKey);
      const complete = genreProfileBatchState(logicalTaskId, sources.fingerprint, 'completed', deputy);
      if (!this.repository.completeGenreProfileBatch({
        ownerId,
        bookId,
        batchId: batch.batch_id,
        token,
        profileId: recorded.profileId,
        stateJson: JSON.stringify(complete),
        now: this.clock.now().toISOString()
      })) {
        throw new V7BookGenreProfileEnsureError('题材档案已经生成，但任务租约已变化，请刷新核对结果。', true);
      }
      return recorded;
    } catch (error) {
      const failure = ensureError(error);
      const state = genreProfileBatchState(
        logicalTaskId,
        sources.fingerprint,
        failure.outcomeUnknown ? 'unknown' : 'failed',
        deputy,
        failure.outcomeUnknown
          ? '对不起，上次题材档案结果还不能确认。资料没有丢失，请稍后核对。'
          : '对不起，这次没有完成题材档案。资料没有丢失，可以重新尝试。'
      );
      this.repository.failGenreProfileBatch({
        ownerId,
        bookId,
        batchId: batch.batch_id,
        token,
        stateJson: JSON.stringify(state),
        message: failure.message.slice(0, 1_000),
        now: this.clock.now().toISOString()
      });
      throw failure;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async generate(
    ownerId: string,
    bookId: string,
    batchId: string,
    leaseToken: string,
    logicalTaskId: string,
    deputy: V7SettingMemberDefinition,
    sources: GenreProfileSources,
    technicalRetry: boolean
  ): Promise<V7BookGenreProfile> {
    const now = this.clock.now().toISOString();
    const contract = genreProfileTaskContract(ownerId, bookId, logicalTaskId, sources.active, now);
    const suggestions = genreSuggestions(sources.profile, sources.genreAssets);
    const prompt = compileGenreProfileResolutionPrompt({
      taskContract: contract,
      confirmedBookBrief: confirmedBookBrief(sources.profile),
      genreAssets: sources.genreAssets,
      suggestedPrimaryKey: suggestions.primaryKey,
      suggestedSupportingKeys: suggestions.supporting.map(genreKey)
    });
    const retrySnapshot = technicalRetry
      ? this.promptGovernance.runtimeBundleByTaskScope({ ownerId, bookId, taskId: logicalTaskId })
      : null;
    if (technicalRetry && retrySnapshot === null) {
      throw new V7BookGenreProfileEnsureError('首次题材档案调用的冻结资料不存在，不能盲目重试。');
    }
    const runtimePolicy = technicalRetry ? null : resolveV7TaskPolicy(this.database, deputy.memberKey, 'planning_context');
    const sourcePrompt = retrySnapshot === null ? prompt : runtimeSourcePrompt(retrySnapshot.contextPack.content);
    const compiled = compileV7RuntimePrompt({
      requestId: logicalTaskId,
      ownerId,
      bookId,
      taskId: logicalTaskId,
      memberKey: deputy.memberKey,
      runtimeRoleKey: deputy.roleKey,
      modelProfileKey: modelProfileKeyForBinding(deputy.model),
      taskKind: 'planning_context',
      workstationKey: 'setting',
      operationMode: technicalRetry ? 'retry' : contract.operationMode,
      authorInstructionVersion: null,
      basedOnTaskId: contract.basedOnTaskId,
      sourceTraces: [openingProfileSourceTrace(ownerId, bookId, sources.profile),
        ...genreAssetSourceTraces(ownerId, bookId, sources.genreAssets)],
      sourcePrompt,
      promptAssets: this.promptGovernance.publishedAssets(),
      genreProfile: sources.active,
      governanceRevision: retrySnapshot?.manifest.governanceRevision ?? this.promptGovernance.summary().revision,
      temperature: retrySnapshot?.manifest.temperature ?? runtimePolicy?.temperature ?? 0.25,
      maxOutputTokens: retrySnapshot?.manifest.maxOutputTokens ?? 2_200,
      createdAt: now,
      ...(retrySnapshot === null ? {} : { retrySnapshot })
    });
    this.promptGovernance.saveRuntimeBundle(compiled);
    const executionRequestId = `${logicalTaskId}:execution:${this.ids.next()}`;
    const reservedTokens = Math.max(
      8_000,
      compiled.manifest.compiledPrompt.length + compiled.manifest.maxOutputTokens + 2_000
    );
    assertMembershipAllowsGeneration(this.database, ownerId, now, reservedTokens);
    this.repository.startModelCall({
      requestId: executionRequestId,
      ownerId,
      bookId,
      batchId,
      itemKey: GENRE_PROFILE_ITEM_KEY,
      nodeKey: GENRE_PROFILE_NODE_KEY,
      memberKey: deputy.memberKey,
      provider: compiled.manifest.provider,
      modelId: compiled.manifest.modelId,
      plan: compiled.manifest.plan,
      promptHash: compiled.manifest.compiledPromptHash,
      reservedTokens,
      governanceRevision: compiled.manifest.governanceRevision,
      temperature: compiled.manifest.temperature,
      now
    });
    try {
      const adapter = this.adapters.resolve(
        compiled.manifest.provider,
        compiled.manifest.modelId,
        'structured_planning'
      );
      const result = await adapter.generate({
        requestId: executionRequestId,
        taskId: batchId,
        ownerId,
        bookId,
        agentId: deputy.memberKey,
        prompt: compiled.manifest.compiledPrompt,
        maxOutputTokens: compiled.manifest.maxOutputTokens,
        temperature: compiled.manifest.temperature
      });
      if (!result.output.trim()) throw new Error('模型没有返回内容');
      const verifiedAt = this.clock.now();
      if (!this.repository.renewGenreProfileLease({
        ownerId,
        bookId,
        batchId,
        token: leaseToken,
        leaseExpiresAt: new Date(verifiedAt.getTime() + GENRE_PROFILE_LEASE_MS).toISOString(),
        now: verifiedAt.toISOString()
      })) {
        throw new V7BookGenreProfileEnsureError(
          '题材档案生成期间任务租约已经变化，已停止自动落档，请刷新核对结果。',
          true
        );
      }
      const candidate = this.profileCandidate(ownerId, bookId, logicalTaskId, sources, result.output);
      this.repository.succeedModelCall({
        requestId: executionRequestId,
        ownerId,
        bookId,
        inputTokens: Math.max(0, result.inputTokens),
        outputTokens: Math.max(0, result.outputTokens),
        cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)),
        output: result.output,
        now: this.clock.now().toISOString()
      });
      return candidate;
    } catch (error) {
      const failure = ensureError(error);
      this.repository.failModelCall({
        requestId: executionRequestId,
        ownerId,
        bookId,
        state: failure.outcomeUnknown ? 'unknown' : 'failed',
        message: failure.message.slice(0, 1_000),
        now: this.clock.now().toISOString()
      });
      throw failure;
    }
  }

  private profileCandidate(
    ownerId: string,
    bookId: string,
    logicalTaskId: string,
    sources: GenreProfileSources,
    raw: string
  ): V7BookGenreProfile {
    const suggestions = genreSuggestions(sources.profile, sources.genreAssets);
    const parsed = parseStructuredObject(raw, '题材工作档案');
    const primaryKey = profileText(parsed.primaryGenreKey ?? suggestions.primaryKey, '主体题材键', 80);
    const primary = sources.genreAssets.find((asset) => genreKey(asset) === primaryKey);
    if (primary === undefined) throw new Error(`题材工作档案选择了不存在的主体题材：${primaryKey}`);
    const supportingKeys = profileList(
      parsed.supportingGenreKeys ?? suggestions.supporting.map(genreKey),
      '融合题材键',
      true
    ).filter((key) => key !== primaryKey);
    if (supportingKeys.length > 4) throw new Error('融合题材键最多选择4项');
    const supporting = supportingKeys.map((key) => {
      const asset = sources.genreAssets.find((candidate) => genreKey(candidate) === key);
      if (asset === undefined) throw new Error(`题材工作档案选择了不存在的融合题材：${key}`);
      return asset;
    });
    const active = this.promptGovernance.activeBookGenreProfile(ownerId, bookId);
    const candidate: V7BookGenreProfile = {
      profileId: this.ids.next(),
      ownerId,
      bookId,
      version: (active?.version ?? 0) + 1,
      status: 'active',
      primaryGenreKey: primaryKey,
      supportingGenreKeys: supportingKeys,
      sourceAssetVersionIds: [primary, ...supporting].map((asset) => asset.assetId).toSorted(),
      sourceBookVersion: sources.profile.version,
      publicLabel: profileText(parsed.publicLabel, '题材组合名', 100),
      workingIdentity: profileText(parsed.workingIdentity, '题材工作身份', 500),
      primaryPromise: profileText(parsed.primaryPromise, '主要阅读承诺', 300),
      supportingFunctions: profileSupportingFunctions(parsed.supportingFunctions),
      writingPriorities: profileList(parsed.writingPriorities, '写作重点'),
      authenticityChecks: profileList(parsed.authenticityChecks, '真实性检查'),
      avoidPatterns: profileList(parsed.avoidPatterns, '避免项'),
      conflictResolutions: profileList(parsed.conflictResolutions, '冲突取舍', true),
      compiledByTaskId: logicalTaskId,
      createdAt: this.clock.now().toISOString()
    };
    const errors = validateBookGenreProfile(candidate, [primary, ...supporting]);
    if (errors.length > 0) throw new Error(`题材工作档案不完整：${errors.join('；')}`);
    return candidate;
  }

  private recordCandidate(
    candidate: V7BookGenreProfile,
    sources: GenreProfileSources,
    actorId: string
  ): V7BookGenreProfile {
    try {
      return this.promptGovernance.recordBookGenreProfile(candidate, actorId);
    } catch (error) {
      const active = this.promptGovernance.activeBookGenreProfile(candidate.ownerId, candidate.bookId);
      if (genreProfileIsCurrent(active, sources.profile, sources.genreAssets)) return active!;
      throw error;
    }
  }

  private sources(ownerId: string, bookId: string): GenreProfileSources {
    const profile = new BookProfileViewService(this.database).get({ ownerId, bookId });
    const now = this.clock.now().toISOString();
    this.promptGovernance.ensureSourceRegistrySeeded(now);
    const genreAssets = this.promptGovernance.publishedAssets()
      .filter((asset) => asset.kind === 'genre_persona')
      .toSorted((left, right) => left.assetId.localeCompare(right.assetId));
    const active = this.promptGovernance.activeBookGenreProfile(ownerId, bookId);
    const openingHash = sha256(stableStringify(profile.openingBlueprint));
    const fingerprint = sha256(stableStringify({
      contractVersion: GENRE_PROFILE_CONTRACT_VERSION,
      ownerId,
      bookId,
      openingVersion: profile.version,
      openingHash,
      confirmedBookBrief: confirmedBookBrief(profile),
      publishedGenreAssetIds: genreAssets.map((asset) => asset.assetId)
    }));
    return { profile, genreAssets, active, fingerprint, openingHash };
  }

  private deputy(now: string): V7SettingMemberDefinition {
    const governance = new V7AgentGovernanceRepository(this.database);
    governance.ensureSeeded(now);
    const roster = settingRosterFromGlobal(governance.snapshot().members).filter((member) => {
      const setting = this.repository.memberSetting(member.memberKey);
      return member.enabledByDefault && setting?.enabled !== 0;
    });
    const deputy = roster.find((member) => member.roleKey === 'deputy_editor');
    if (deputy === undefined) throw new V7BookGenreProfileEnsureError('副编当前不可用，无法整理题材档案。');
    return deputy;
  }

  private assertSourcesCurrent(ownerId: string, bookId: string, expected: GenreProfileSources): void {
    const current = this.sources(ownerId, bookId);
    if (current.profile.version !== expected.profile.version
      || current.openingHash !== expected.openingHash
      || stableStringify(current.genreAssets.map((asset) => asset.assetId))
        !== stableStringify(expected.genreAssets.map((asset) => asset.assetId))) {
      throw new V7BookGenreProfileEnsureError('开书资料或题材资产已经更新，请按最新资料重新整理题材档案。');
    }
  }
}

function genreProfileTaskContract(
  ownerId: string,
  bookId: string,
  logicalTaskId: string,
  active: V7BookGenreProfile | null,
  now: string
): V7TaskContract {
  return {
    contractId: `${logicalTaskId}-contract`,
    version: 1,
    ownerId,
    bookId,
    taskId: logicalTaskId,
    taskKind: 'planning_context',
    workstationKey: 'setting',
    operationMode: active === null ? 'fresh' : 'revise',
    objective: '把本书主体题材与融合题材整理成一份统一、简短、可执行的题材工作档案。',
    mustPreserve: ['作者确认的作品分类', '作者选择的融合题材', '开书资料中的人物、时代与硬禁项'],
    allowedChanges: ['只说明融合题材在本书承担的辅助功能和写作重点'],
    forbiddenChanges: ['不得新增作者未选题材', '不得把标签拼成剧情', '不得覆盖正式开书资料'],
    successCriteria: ['主体题材承诺明确', '融合功能不冲突', '真实性检查可执行', '内容短而具体'],
    outputContract: { format: 'json', object: 'book_genre_profile' },
    selectedSkillKeys: ['data-boundary', 'genre-fusion'],
    authorInstructionVersion: null,
    basedOnTaskId: active?.compiledByTaskId ?? null,
    createdAt: now
  };
}

function genreProfileBatchState(
  logicalTaskId: string,
  sourceFingerprint: string,
  phase: V7GenreProfileBatchStateRow['phase'],
  deputy: V7SettingMemberDefinition,
  publicMessage = phase === 'completed'
    ? `${deputy.displayName}已经整理好本书题材档案。`
    : phase === 'working'
      ? `${deputy.displayName}正在理解本书题材和融合方向。`
      : '正在准备本书题材资料。'
): V7GenreProfileBatchStateRow {
  return {
    taskKind: 'genre_profile',
    phase,
    logicalTaskId,
    sourceFingerprint,
    attemptedMemberKeys: phase === 'queued' ? [] : [deputy.memberKey],
    publicMessage
  };
}

function confirmedBookBrief(profile: BookProfileView): Readonly<Record<string, unknown>> {
  return {
    category: profile.category,
    fusionGenres: profile.subjects,
    mainTags: profile.mainTags,
    customTags: profile.customTags,
    storyDirection: profile.storyDirection,
    mustFollow: profile.mustFollow,
    protagonists: profile.protagonists.map((item) => ({
      role: item.role,
      name: item.name,
      background: item.background
    }))
  };
}

function genreProfileIsCurrent(
  active: V7BookGenreProfile | null,
  profile: BookProfileView,
  genreAssets: readonly V7PromptAssetVersion[]
): active is V7BookGenreProfile {
  return active !== null
    && active.sourceBookVersion === profile.version
    && active.sourceAssetVersionIds.every((assetId) => genreAssets.some((asset) => asset.assetId === assetId));
}

function genreSuggestions(
  profile: BookProfileView,
  assets: readonly V7PromptAssetVersion[]
): { primaryKey: string | null; supporting: V7PromptAssetVersion[] } {
  const primary = matchGenreAsset(assets, [profile.category, profile.openingBlueprint.categoryKey]);
  const primaryKey = primary === undefined ? null : genreKey(primary);
  const supporting = uniqueGenreAssets(
    profile.subjects.map((label) => matchGenreAsset(assets, [label])).filter(isPromptAsset)
  ).filter((asset) => genreKey(asset) !== primaryKey).slice(0, 4);
  return { primaryKey, supporting };
}

function compileGenreProfileResolutionPrompt(input: {
  taskContract: V7TaskContract;
  confirmedBookBrief: Readonly<Record<string, unknown>>;
  genreAssets: readonly V7PromptAssetVersion[];
  suggestedPrimaryKey: string | null;
  suggestedSupportingKeys: readonly string[];
}): string {
  return JSON.stringify({
    operation: 'v7_compile_book_genre_profile_v2',
    compatibilityMarker: 'v7_compile_book_genre_profile_v1',
    responsibility: '先理解作者实际选择的题材语义，再从候选卡中选出最贴切的主体与融合功能，同时生成一份短而统一的书级题材工作档案。',
    taskContract: input.taskContract,
    confirmedBookBrief: input.confirmedBookBrief,
    exactMatchHints: {
      primaryGenreKey: input.suggestedPrimaryKey,
      supportingGenreKeys: input.suggestedSupportingKeys,
      note: '这只是文字精确匹配提示。必须以开书资料的真实语义为准，不能因为关键词相似而误判。'
    },
    availableGenreCards: input.genreAssets.map((asset) => {
      const content = asset.content as V7GenrePersonaContent;
      return {
        genreKey: content.genreKey,
        publicName: content.publicName,
        aliases: content.aliases,
        readerPromise: content.readerPromise,
        requiredKnowledge: content.requiredKnowledge,
        avoidPatterns: content.avoidPatterns
      };
    }),
    rules: [
      '主体题材必须且只能选择1项；融合题材可选0至4项，不能与主体重复。',
      '未知、新兴或口语化题材名必须按含义映射，不能静默跳过，也不能凭关键词乱贴类别。',
      '不得新增作者没有表达的题材方向；标签只用于理解，不得拼成剧情。',
      '工作档案只服务后续工位，不修改正式开书资料，不生成具体剧情。'
    ],
    outputSchema: {
      primaryGenreKey: '必须来自availableGenreCards.genreKey',
      supportingGenreKeys: ['0至4个availableGenreCards.genreKey'],
      publicLabel: '作者看得懂的题材组合名',
      workingIdentity: '这本书在实际创作中是什么作品',
      primaryPromise: '主体题材给读者的主要体验',
      supportingFunctions: ['每一项必须是完整字符串，例如“权谋：负责势力博弈与信息差”；不要返回对象'],
      writingPriorities: ['后续创作最该抓住的重点'],
      authenticityChecks: ['需要持续核对的真实性边界'],
      avoidPatterns: ['本书最容易写偏的套路'],
      conflictResolutions: ['题材承诺冲突时如何取舍；没有可返回空数组']
    }
  });
}

function openingProfileSourceTrace(ownerId: string, bookId: string, profile: BookProfileView): V7ContextSourceTrace {
  const content = JSON.stringify(confirmedBookBrief(profile));
  return {
    ownerId,
    bookId,
    sourceKey: `opening_profile:${bookId}`,
    sourceType: 'opening_profile',
    sourceId: bookId,
    sourceVersion: String(profile.version),
    authority: 'confirmed',
    decision: 'included',
    reason: '副编必须根据当前正式开书资料整理书级题材档案。',
    contentHash: sha256(content),
    estimatedTokens: estimateTokens(content)
  };
}

function genreAssetSourceTraces(
  ownerId: string,
  bookId: string,
  assets: readonly V7PromptAssetVersion[]
): V7ContextSourceTrace[] {
  return assets.map((asset) => ({
    ownerId,
    bookId,
    sourceKey: `genre_persona:${asset.assetKey}`,
    sourceType: 'genre_persona',
    sourceId: asset.assetId,
    sourceVersion: String(asset.version),
    authority: 'reference',
    decision: 'included',
    reason: '副编从已发布题材卡中理解主体与融合题材，本卡是可选专业参考。',
    contentHash: sha256(stableStringify(asset.content)),
    estimatedTokens: estimateTokens(JSON.stringify(asset.content))
  }));
}

function matchGenreAsset(
  assets: readonly V7PromptAssetVersion[],
  labels: readonly (string | null | undefined)[]
): V7PromptAssetVersion | undefined {
  const normalizedLabels = labels
    .map((label) => label?.trim().toLocaleLowerCase('zh-CN') ?? '')
    .filter(Boolean);
  if (normalizedLabels.length === 0) return undefined;
  return assets.find((asset) => {
    const content = asset.content as V7GenrePersonaContent;
    const candidates = [content.genreKey, content.publicName, ...content.aliases]
      .map((value) => value.trim().toLocaleLowerCase('zh-CN'))
      .filter(Boolean);
    return normalizedLabels.some((label) => candidates.some((candidate) => (
      label === candidate || label.includes(candidate) || candidate.includes(label)
    )));
  });
}

function genreKey(asset: V7PromptAssetVersion): string {
  return String((asset.content as V7GenrePersonaContent).genreKey);
}

function isPromptAsset(asset: V7PromptAssetVersion | undefined): asset is V7PromptAssetVersion {
  return asset !== undefined;
}

function uniqueGenreAssets(assets: readonly V7PromptAssetVersion[]): V7PromptAssetVersion[] {
  return [...new Map(assets.map((asset) => [asset.assetId, asset])).values()];
}

function profileText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label}没有按要求返回`);
  const text = value.trim();
  if (text.length === 0 || Array.from(text).length > max) throw new Error(`${label}长度不符合要求`);
  return text;
}

function profileList(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}没有按要求返回`);
  const items = value.map((item) => {
    if (typeof item !== 'string') throw new Error(`${label}包含无效内容`);
    const text = item.trim();
    if (text.length === 0 || Array.from(text).length > 300) throw new Error(`${label}包含空项或过长内容`);
    return text;
  });
  if ((!allowEmpty && items.length === 0) || items.length > 8) {
    throw new Error(`${label}需要${allowEmpty ? '0至8' : '1至8'}项`);
  }
  return [...new Set(items)];
}

function profileSupportingFunctions(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('辅助功能没有按要求返回');
  const normalized = value.flatMap((item): string[] => {
    if (typeof item === 'string') return [item];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error('辅助功能包含无效内容');
    const record = item as Record<string, unknown>;
    const label = [record.genreKey, record.genre, record.label, record.name]
      .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)?.trim() ?? '';
    if (!Array.isArray(record.functions)) throw new Error('辅助功能包含无效内容');
    return record.functions.map((entry) => {
      if (typeof entry !== 'string' || entry.trim().length === 0) throw new Error('辅助功能包含无效内容');
      return label.length > 0 ? `${label}：${entry.trim()}` : entry.trim();
    });
  });
  return profileList(normalized, '辅助功能');
}

function runtimeSourcePrompt(content: Readonly<Record<string, unknown>>): string {
  if (!Object.prototype.hasOwnProperty.call(content, 'stageTaskPayload')) {
    throw new V7BookGenreProfileEnsureError('首次调用的冻结任务内容不完整，不能盲目重试。');
  }
  const payload = content.stageTaskPayload;
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

function ensureError(error: unknown): V7BookGenreProfileEnsureError {
  if (error instanceof V7BookGenreProfileEnsureError) return error;
  if (error instanceof DomainError) {
    return new V7BookGenreProfileEnsureError(error.message, false, error.code);
  }
  if (error instanceof ModelAdapterError) {
    return new V7BookGenreProfileEnsureError(error.message, error.outcomeUnknown);
  }
  return new V7BookGenreProfileEnsureError(error instanceof Error ? error.message : String(error));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
