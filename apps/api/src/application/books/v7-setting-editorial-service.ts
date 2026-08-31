import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  V7_OPENING_MEMBERS,
  V7_SETTING_CATALOG,
  openingRosterFromGlobal,
  settingRosterFromGlobal,
  buildSettingContextPack,
  compileChiefPrompt,
  compileDeputyPrompt,
  compileFusionPrompt,
  compileSettingGroupPrompt,
  compileSettingCatalogRecommendationPrompt,
  compileWriterPrompt,
  deputyNeeded,
  modelProfileKeyForBinding,
  parseChiefReview,
  parseDeputyBrief,
  parseSettingCatalogRecommendation,
  parseSettingGroupProposals,
  parseWriterProposal,
  parseStructuredObject,
  projectSettingFinalContent,
  sanitizeAuthorFacingSettingText,
  settingItemByKey,
  type V7AgentTaskKind,
  type V7ContextSourceTrace,
  type V7TaskOperationMode,
  type V7ChiefReview,
  type V7DeputyBrief,
  type V7SettingBatchView,
  type V7SettingCatalogItem,
  type V7SettingCatalogRecommendationView,
  type V7SettingContextPack,
  type V7SettingFinalReviewResult,
  type V7SettingFinalReviewView,
  type V7SettingItemView,
  type V7SettingMemberDefinition,
  type V7SettingMemberPublicView,
  type V7WriterProposal,
  type V7OpeningMemberDefinition
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7SettingEditorialRepository,
  type V7SettingBatchRow,
  type V7SettingCurrentItemRow,
  type V7SettingJobRow,
  type V7SettingOutputRow,
  type V7SettingFinalReviewStateRow
} from '../../infrastructure/db/repositories/v7-setting-editorial-repository.js';
import type { V7OpeningModelAdapterResolver } from '../../infrastructure/models/v7-opening-agent-model-gateway.js';
import { ModelAdapterError } from '../../infrastructure/models/model-adapter.js';
import { assertMembershipAllowsGeneration } from '../../infrastructure/security/membership-service.js';
import { BookProfileViewService, type BookProfileView } from './book-profile-view-service.js';
import { resolveV7TaskPolicy } from '../agents/v7-agent-runtime-policy.js';
import { compileV7RuntimePrompt } from '../agents/v7-runtime-prompt-compiler.js';
import {
  V7BookGenreProfileEnsureError,
  V7BookGenreProfileEnsureService
} from '../agents/v7-book-genre-profile-ensure-service.js';
import { V7PromptGovernanceRepository } from '../../infrastructure/db/repositories/v7-prompt-governance-repository.js';
import {
  readOpeningChiefTaskSnapshot,
  resolveOpeningChiefTaskSnapshot,
  resolveSettingTaskRoster
} from './v7-task-roster-snapshot.js';
import {
  confirmedSettingProjection,
  requireUsableSettingProjections
} from './v7-setting-context-projection.js';

// 火山计划模型在复杂设定上可能需要数分钟。租约必须覆盖完整的
// 副编→编剧→主编串行链，避免页面轮询在旧调用尚未返回时重复接管。
const LEASE_MS = 15 * 60_000;
const MAX_HANDOFFS = 2;
const SETTING_GROUP_SIZE = 5;
// 设定目录、提示词取舍规则或解析硬门禁变化时必须提升版本。
// 旧清单作为审计保留，但作者再次点击时要能创建一轮新任务，不能
// 因开书资料未变而永久复用已经不符合当前合同的结果。
const SETTING_RECOMMENDATION_CONTRACT_VERSION = 2;
// 轻量总审过去只能“指出”跨条目冲突，却可能让页面误以为正文已经
// 改好。版本 2 会把受影响条目分成小资料包，再交给同一位主编真正
// 写回候选正文；旧结果保留审计，但不会被当前页面继续复用。
const SETTING_FINAL_REVIEW_CONTRACT_VERSION = 2;
const FINAL_REVIEW_PATCH_PROMPT_LIMIT = 12_000;
const FINAL_REVIEW_PATCH_GROUP_SIZE = 4;

type BatchRow = V7SettingBatchRow;
type JobRow = V7SettingJobRow;
type OutputRow = V7SettingOutputRow;
type CurrentItemRow = V7SettingCurrentItemRow;
type RecommendationState = {
  taskKind: 'catalog_recommendation';
  phase: V7SettingCatalogRecommendationView['phase'];
  progress: number;
  assignedMemberKey: string | null;
  attemptedMemberKeys: string[];
  publicMessage: string;
};
type FinalReviewState = V7SettingFinalReviewStateRow;
type FinalReviewPatch = {
  itemKey: string;
  finalContent: string;
  summary: string;
  contextSummary: string;
  factEntries: string[];
  issues: V7ChiefReview['issues'];
  suggestions: string[];
};
type FinalReviewModelResult = Omit<V7SettingFinalReviewResult, 'patchedItemKeys'> & {
  patches: FinalReviewPatch[];
};
type ModelMember = Pick<V7SettingMemberDefinition, 'memberKey' | 'displayName' | 'roleKey' | 'model'>;
type SettingTaskLineage = Readonly<{
  operationMode: V7TaskOperationMode;
  basedOnTaskId: string | null;
  authorInstructionVersion: number | null;
}>;
type SettingModelInvocation = Readonly<{
  taskKind: V7AgentTaskKind;
  operationMode: V7TaskOperationMode;
  basedOnTaskId: string | null;
  authorInstructionVersion: number | null;
  sourceTraces: readonly V7ContextSourceTrace[];
  /** 同一成员、同一逻辑任务的已知失败才允许技术重试。 */
  technicalRetryTaskId: string | null;
}>;

export interface V7SettingRedesignTaskView {
  taskId: string;
  status: 'queued' | 'working' | 'ready' | 'failed';
  statusText: string;
  progress: { completed: number; total: number; percent: number };
  candidates: Array<{ outputId: string; memberKey: string; proposal: V7WriterProposal }>;
  failedMemberKeys: string[];
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}

type SettingRedesignTaskState = Readonly<{
  taskKind: 'item_redesign';
  itemKey: string;
  memberKeys: string[];
  authorNote: string;
  sourceRevision: number;
  currentContent: string;
  lineage: SettingTaskLineage;
  contextPack: V7SettingContextPack;
}>;

class SettingModelCallError extends Error {
  public constructor(message: string, public readonly outcomeUnknown = false) {
    super(message);
    this.name = 'SettingModelCallError';
  }
}

class SettingLeaseLostError extends Error {
  public constructor() {
    super('任务租约已经变化，本轮执行器停止写入。');
    this.name = 'SettingLeaseLostError';
  }
}

type SettingBatchFailure = Readonly<{
  code: string;
  stage: NonNullable<BatchRow['failure_stage']>;
  retrySafety: NonNullable<BatchRow['retry_safety']>;
  storedMessage: string;
  publicMessage: string;
}>;

export class V7SettingEditorialService {
  private readonly repository: V7SettingEditorialRepository;
  private readonly genreProfiles: V7BookGenreProfileEnsureService;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly adapters: V7OpeningModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>,
    private readonly openingRoster: () => readonly V7OpeningMemberDefinition[] = () => openingRosterFromGlobal(),
    private readonly settingRoster: () => readonly V7SettingMemberDefinition[] = () => settingRosterFromGlobal()
  ) {
    this.repository = new V7SettingEditorialRepository(database);
    this.genreProfiles = new V7BookGenreProfileEnsureService(database, adapters, ids, clock);
  }

  public department(ownerId: string, bookId: string): {
    catalog: V7SettingCatalogItem[]; recommendedKeys: string[]; confirmedItems: V7SettingItemView[];
    members: V7SettingMemberPublicView[]; activeBatch: V7SettingBatchView | null;
    recommendation: V7SettingCatalogRecommendationView | null;
    finalReview: V7SettingFinalReviewView | null;
  } {
    const profile = this.profile(ownerId, bookId);
    const catalog = V7_SETTING_CATALOG.map((item) => ({ ...item }));
    const recommendationRow = this.currentRecommendation(ownerId, bookId, profile, catalog);
    const previousRecommendation = recommendationRow ?? this.repository.latestRecommendationForBook(ownerId, bookId);
    const recommendation = previousRecommendation === undefined
      ? null
      : this.recommendationView(previousRecommendation, recommendationRow === undefined);
    const recommendedKeys = recommendation?.result?.requiredKeys ?? [];
    const batch = this.latestBatch(ownerId, bookId);
    const confirmedItems = this.currentItems(ownerId, bookId);
    const finalReviewRow = confirmedItems.length === 0
      ? undefined
      : this.currentFinalReview(
          ownerId,
          bookId,
          profile,
          confirmedItems,
          finalReviewRequestHash(profile, confirmedItems)
        );
    if (finalReviewRow !== undefined && (finalReviewRow.status === 'queued' || finalReviewRow.status === 'working')) {
      this.startFinalReview(finalReviewRow);
    }
    return {
      catalog, recommendedKeys,
      confirmedItems,
      members: this.membersView(ownerId, bookId, batch?.batch_id ?? null),
      activeBatch: batch === undefined ? null : this.toView(batch),
      recommendation,
      finalReview: finalReviewRow === undefined ? null : this.finalReviewView(finalReviewRow)
    };
  }

  public createRecommendation(ownerId: string, bookId: string, input: { idempotencyKey?: unknown }): V7SettingCatalogRecommendationView {
    const profile = this.profile(ownerId, bookId);
    const catalog = V7_SETTING_CATALOG.map((item) => ({ ...item }));
    const suppliedIdempotencyKey = input.idempotencyKey === undefined
      ? null
      : actionKey(input.idempotencyKey);
    const current = this.currentRecommendation(ownerId, bookId, profile, catalog);
    if (current !== undefined) {
      const canStartNew = current.status === 'partially_failed' && (
        current.retry_safety === 'manual_redesign'
        || (current.retry_safety === null
          && this.repository.latestModelOutcomeForBatch(ownerId, bookId, current.batch_id, ['succeeded']) !== undefined
          && this.repository.latestModelOutcomeForBatch(ownerId, bookId, current.batch_id, ['failed', 'unknown']) === undefined)
      );
      if (canStartNew && suppliedIdempotencyKey === null) {
        throw new DomainError(errorCodes.validation, '重新发起设定清单需要新的操作编号。', {}, false, 400);
      }
      if (!canStartNew) {
        if (current.status === 'queued' || current.status === 'working') {
          this.executableRecommendationChief(current);
          this.startRecommendation(current);
        }
        return this.recommendationView(current);
      }
    }
    // A task frozen to an older opening version remains audit evidence only. It
    // must never block a recommendation for the current opening contract.
    const requestHash = recommendationRequestHash(profile, catalog);
    const idempotencyKey = suppliedIdempotencyKey ?? `setting-recommendation-${requestHash.slice(0, 48)}`;
    const task = this.insertRecommendation(ownerId, bookId, profile, catalog, idempotencyKey);
    this.executableRecommendationChief(task);
    this.startRecommendation(task);
    return this.recommendationView(task);
  }

  public getRecommendation(ownerId: string, bookId: string, taskId: string): V7SettingCatalogRecommendationView {
    const row = this.repository.recommendation(ownerId, bookId, taskId);
    if (row === undefined) throw new DomainError(errorCodes.validation, '设定清单任务不存在或不属于本书。', {}, false, 404);
    const profile = this.profile(ownerId, bookId);
    const stale = recommendationIsStale(row, profile, V7_SETTING_CATALOG);
    if (stale) return this.recommendationView(row, true);
    if (row.status === 'queued' || row.status === 'working') this.startRecommendation(row);
    return this.recommendationView(this.repository.recommendation(ownerId, bookId, taskId) ?? row);
  }

  public getCurrentRecommendation(ownerId: string, bookId: string): V7SettingCatalogRecommendationView {
    const profile = this.profile(ownerId, bookId);
    const catalog = V7_SETTING_CATALOG.map((item) => ({ ...item }));
    const row = this.currentRecommendation(ownerId, bookId, profile, catalog)
      ?? this.repository.latestRecommendationForBook(ownerId, bookId);
    if (row === undefined) throw new DomainError(errorCodes.validation, '本书还没有设定清单任务。', {}, false, 404);
    const stale = recommendationIsStale(row, profile, catalog);
    if (!stale && (row.status === 'queued' || row.status === 'working')) this.startRecommendation(row);
    return this.recommendationView(this.repository.recommendation(ownerId, bookId, row.batch_id) ?? row, stale);
  }

  public retryRecommendation(ownerId: string, bookId: string, taskId: string): V7SettingCatalogRecommendationView {
    const row = this.repository.recommendation(ownerId, bookId, taskId);
    if (row === undefined) throw new DomainError(errorCodes.validation, '设定清单任务不存在或不属于本书。', {}, false, 404);
    const profile = this.profile(ownerId, bookId);
    const catalog = V7_SETTING_CATALOG.map((item) => ({ ...item }));
    if (
      row.opening_version !== profile.version
      || row.opening_hash !== hash(profile.openingBlueprint)
      || row.request_hash !== recommendationRequestHash(profile, catalog)
    ) {
      throw new DomainError(errorCodes.validation, '开书资料已经更新，请从最新资料重新整理设定清单。', {}, false, 409);
    }
    if (row.status !== 'partially_failed') {
      throw new DomainError(errorCodes.validation, '当前设定清单不需要继续整理。', {}, false, 409);
    }
    const unknown = this.repository.latestModelOutcomeForBatch(ownerId, bookId, taskId, ['unknown']);
    if (unknown !== undefined) {
      throw new DomainError(
        errorCodes.validation,
        '上次整理结果还不能确认，不能盲目重试。请先刷新页面核对结果。',
        {},
        false,
        409
      );
    }
    const failed = this.repository.latestModelOutcomeForBatch(ownerId, bookId, taskId, ['failed']);
    if (row.retry_safety === 'safe_after_precondition') {
      assertMembershipAllowsGeneration(this.database, ownerId, this.clock.now().toISOString(), 8_000);
    } else if (failed === undefined) {
      throw new DomainError(errorCodes.validation, '没有找到可以继续的已知失败调用。', {}, false, 409);
    }
    const chief = this.executableRecommendationChief(row);
    const state: RecommendationState = {
      taskKind: 'catalog_recommendation',
      phase: 'preparing',
      progress: 8,
      assignedMemberKey: chief.memberKey,
      attemptedMemberKeys: recommendationState(row).attemptedMemberKeys,
      publicMessage: `${chief.displayName}正在从已经保留的结果继续整理，不会重复读取已完成的资料。`
    };
    if (!this.repository.resetRecommendation({
      ownerId, bookId, taskId, stateJson: JSON.stringify(state), now: this.clock.now().toISOString()
    })) {
      throw new DomainError(errorCodes.validation, '设定清单状态已经变化，请刷新后再操作。', {}, true, 409);
    }
    const next = this.repository.recommendation(ownerId, bookId, taskId)!;
    this.startRecommendation(next);
    return this.recommendationView(next);
  }

  public retryCurrentRecommendation(ownerId: string, bookId: string): V7SettingCatalogRecommendationView {
    const profile = this.profile(ownerId, bookId);
    const catalog = V7_SETTING_CATALOG.map((item) => ({ ...item }));
    const row = this.currentRecommendation(ownerId, bookId, profile, catalog)
      ?? this.repository.latestRecommendationForBook(ownerId, bookId);
    if (row === undefined) throw new DomainError(errorCodes.validation, '本书还没有需要继续的设定清单。', {}, false, 404);
    return this.retryRecommendation(ownerId, bookId, row.batch_id);
  }

  public createFinalReview(ownerId: string, bookId: string, input: { idempotencyKey?: unknown }): V7SettingFinalReviewView {
    const profile = this.profile(ownerId, bookId);
    const items = this.currentItems(ownerId, bookId);
    if (items.length === 0) throw new DomainError(errorCodes.validation, '还没有可以统一整理的设定。');
    if (items.some((item) => item.content === null || item.state === 'failed')) {
      throw new DomainError(errorCodes.validation, '请先完成所有设定条目，再交给主编统一整理。', {}, false, 409);
    }
    const requestHash = finalReviewRequestHash(profile, items);
    const idempotencyKey = actionKey(input.idempotencyKey);
    const byKey = this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey);
    if (byKey !== undefined) {
      if (this.repository.finalReview(ownerId, bookId, byKey.batch_id) === undefined
        || !this.finalReviewMatchesCurrent(byKey, profile, items, requestHash)) {
        throw new DomainError(errorCodes.validation, '本次操作编号已经用于其他任务。', {}, false, 409);
      }
      if (byKey.status === 'queued' || byKey.status === 'working') {
        this.executableSettingRoster(byKey);
        this.startFinalReview(byKey);
      }
      return this.finalReviewView(byKey);
    }
    const existing = this.currentFinalReview(ownerId, bookId, profile, items, requestHash);
    if (existing !== undefined) {
      const canStartNew = existing.status === 'partially_failed' && (
        existing.retry_safety === 'manual_redesign'
        || (existing.retry_safety === null
          && this.repository.latestModelOutcomeForBatch(ownerId, bookId, existing.batch_id, ['succeeded']) !== undefined
          && this.repository.latestModelOutcomeForBatch(ownerId, bookId, existing.batch_id, ['failed', 'unknown']) === undefined)
      );
      if (!canStartNew) {
        if (existing.status === 'queued' || existing.status === 'working') {
          this.executableSettingRoster(existing);
          this.startFinalReview(existing);
        }
        return this.finalReviewView(existing);
      }
    }
    const chief = this.availableFinalReviewChiefs()[0];
    if (chief === undefined) throw new DomainError(errorCodes.validation, '主编们暂时都无法接单，请稍后再试。', {}, false, 409);
    const now = this.clock.now().toISOString();
    const taskId = this.ids.next();
    const state: FinalReviewState = {
      taskKind: 'batch_final_review', phase: 'preparing', progress: 5,
      assignedMemberKey: chief.memberKey, attemptedMemberKeys: [],
      publicMessage: `${chief.displayName}正在准备统一核对全部设定。`
    };
    this.repository.createFinalReviewTask({
      taskId, ownerId, bookId, idempotencyKey, requestHash,
      openingVersion: profile.version, openingHash: hash(profile.openingBlueprint),
      rosterJson: JSON.stringify(this.effectiveRoster()), stateJson: JSON.stringify(state), now
    });
    const row = this.requireFinalReview(ownerId, bookId, taskId);
    this.startFinalReview(row);
    return this.finalReviewView(row);
  }

  public getCurrentFinalReview(ownerId: string, bookId: string): V7SettingFinalReviewView {
    const profile = this.profile(ownerId, bookId);
    const items = this.currentItems(ownerId, bookId);
    if (items.length === 0) throw new DomainError(errorCodes.validation, '本书还没有统一整理任务。', {}, false, 404);
    const requestHash = finalReviewRequestHash(profile, items);
    const row = this.currentFinalReview(ownerId, bookId, profile, items, requestHash);
    if (row === undefined) throw new DomainError(errorCodes.validation, '当前设定版本还没有统一整理任务。', {}, false, 404);
    if (row.status === 'queued' || row.status === 'working') this.startFinalReview(row);
    return this.finalReviewView(this.requireFinalReview(ownerId, bookId, row.batch_id));
  }

  public retryFinalReview(ownerId: string, bookId: string, taskId: string): V7SettingFinalReviewView {
    const row = this.requireFinalReview(ownerId, bookId, taskId);
    this.executableSettingRoster(row);
    if (row.status !== 'partially_failed') throw new DomainError(errorCodes.validation, '当前统一整理任务不需要重试。', {}, false, 409);
    const currentHash = finalReviewRequestHash(
      this.profile(ownerId, bookId),
      this.currentItems(ownerId, bookId)
    );
    if (currentHash !== row.request_hash) {
      throw new DomainError(errorCodes.bookVersionConflict, '设定已经更新，请按当前版本重新发起统一整理。', {}, false, 409);
    }
    const state = finalReviewState(row);
    const unknown = this.repository.latestModelOutcomeForBatch(ownerId, bookId, taskId, ['unknown']);
    if (unknown !== undefined) throw new DomainError(errorCodes.validation, '上次结果还不能确认，不能盲目重试。', {}, false, 409);
    const failed = this.repository.latestModelOutcomeForBatch(ownerId, bookId, taskId, ['failed']);
    const completedModel = this.repository.latestModelOutcomeForBatch(ownerId, bookId, taskId, ['succeeded']);
    if (row.retry_safety === 'safe_after_precondition') {
      assertMembershipAllowsGeneration(this.database, ownerId, this.clock.now().toISOString(), 8_000);
    } else if (failed === undefined && !(row.retry_safety === 'technical_retry' && completedModel !== undefined)) {
      throw new DomainError(errorCodes.validation, '没有找到可以继续的已知失败调用或已保存模型结果。', {}, false, 409);
    }
    const next: FinalReviewState = {
      ...state, phase: 'preparing', progress: 5,
      publicMessage: '对不起，刚才没有整理完成。主编正在从已保存的资料继续。'
    };
    if (!this.repository.resetFinalReview({ ownerId, bookId, taskId, stateJson: JSON.stringify(next), now: this.clock.now().toISOString() })) {
      throw new DomainError(errorCodes.validation, '任务状态已经变化，请刷新后再试。', {}, true, 409);
    }
    const reset = this.requireFinalReview(ownerId, bookId, taskId);
    this.startFinalReview(reset);
    return this.finalReviewView(reset);
  }

  public resolveSelection(ownerId: string, bookId: string, input: { selectedItemKeys?: unknown; customItems?: unknown }): {
    selectedItems: V7SettingCatalogItem[]; customItems: V7SettingCatalogItem[];
  } {
    const profile = this.profile(ownerId, bookId);
    return normalizeSelection(profile, input.selectedItemKeys, input.customItems);
  }

  public createBatch(ownerId: string, bookId: string, input: {
    selectedItemKeys?: unknown; customItems?: unknown; authorNotes?: unknown; idempotencyKey?: unknown;
  }): V7SettingBatchView {
    const profile = this.profile(ownerId, bookId);
    const idempotencyKey = actionKey(input.idempotencyKey);
    const selection = normalizeSelection(profile, input.selectedItemKeys, input.customItems);
    const notes = normalizeNotes(input.authorNotes);
    const requestedItems = [...selection.selectedItems, ...selection.customItems];
    if (requestedItems.length === 0) throw new DomainError(errorCodes.validation, '请至少选择一项设定。');
    if (requestedItems.length > 40) throw new DomainError(errorCodes.validation, '一次最多设计40项设定。');
    const requestHash = hash({ itemKeys: requestedItems.map((item) => item.key), notes, openingVersion: profile.version });
    const existing = this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw new DomainError(errorCodes.validation, '本次操作编号已经用于另一组设定，请重新操作。', {}, false, 409);
      if (existing.status === 'queued' || existing.status === 'working') {
        this.executableSettingRoster(existing);
        this.start(existing);
      }
      return this.toView(existing);
    }
    // 补充设计只为没有有效结果的条目建工单。已有候选或已确认版本会继续
    // 进入资料包约束新条目，但绝不能被“补充设计”暗中覆盖；作者若要重做，
    // 必须走显式的重新设计入口。
    const initialItems = requestedItems.filter((item) => {
      const current = this.repository.currentItem(ownerId, bookId, item.key);
      return current === undefined || current.active_version_id === null;
    });
    if (initialItems.length === 0) throw new DomainError(errorCodes.validation, '这些设定都已经设计好了，请只选择新增条目；想修改旧内容可使用“重新设计”。');
    const now = this.clock.now().toISOString();
    // 先做整批最低调用预算校验。真正调用仍逐次精确预占；这里仅在确定连
    // 最少分组调用都无法完成时拒绝创建，避免先完成一半再突然伪装成成员失败。
    assertMembershipAllowsGeneration(this.database, ownerId, now, minimumSettingReservation(initialItems.length));
    const batchId = this.ids.next();
    const roster = this.effectiveRoster();
    const openingHash = hash(profile.openingBlueprint);
    const created = this.repository.atomic(() => {
      // 幂等回放、同条目在途检查、来源版本冻结和插入处于同一个
      // BEGIN IMMEDIATE 中；两个不同操作编号不能同时穿过检查创建工单。
      const replay = this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey);
      if (replay !== undefined) return { batch: replay, created: false };
      const allItems = requestedItems.filter((item) => {
        const current = this.repository.currentItem(ownerId, bookId, item.key);
        return current === undefined || current.active_version_id === null;
      });
      if (allItems.length === 0) {
        throw new DomainError(errorCodes.validation, '这些设定都已经设计好了，请只选择新增条目；想修改旧内容可使用“重新设计”。');
      }
      const conflictItemKey = this.repository.activeBatchItemConflict(
        ownerId, bookId, allItems.map((item) => item.key)
      );
      if (conflictItemKey !== undefined) {
        const conflict = allItems.find((item) => item.key === conflictItemKey);
        throw new DomainError(
          errorCodes.taskAlreadyRunning,
          `“${conflict?.label ?? conflictItemKey}”已经在设计中，请等待当前任务完成。`,
          {},
          true,
          409
        );
      }
      return this.repository.createBatchWithJobs({
        batch: {
          batchId, ownerId, bookId, idempotencyKey, requestHash,
          selectedItemsJson: JSON.stringify(selection.selectedItems.map((item) => item.key)),
          customItemsJson: JSON.stringify(selection.customItems), openingVersion: profile.version,
          openingHash, rosterJson: JSON.stringify(roster), now
        },
        jobs: allItems.map((item) => {
          const source = this.repository.currentItem(ownerId, bookId, item.key);
          return {
            jobId: this.ids.next(), item, authorNote: notes[item.key] ?? '',
            sourceRevision: source?.revision ?? null
          };
        })
      });
    });
    if (created.batch.request_hash !== requestHash) {
      throw new DomainError(errorCodes.validation, '本次操作编号已经用于另一组设定，请重新操作。', {}, false, 409);
    }
    const row = created.batch;
    this.start(row);
    return this.toView(row);
  }

  public getBatch(ownerId: string, bookId: string, batchId: string): V7SettingBatchView {
    const row = this.requireBatch(ownerId, bookId, batchId);
    if (row.status === 'queued' || row.status === 'working') this.start(row);
    return this.toView(row);
  }

  public retry(ownerId: string, bookId: string, batchId: string): V7SettingBatchView {
    const batch = this.requireBatch(ownerId, bookId, batchId);
    this.executableSettingRoster(batch);
    const jobs = this.jobs(ownerId, bookId, batchId);
    const unknown = this.repository.latestModelOutcomeForBatch(ownerId, bookId, batchId, ['unknown']);
    if (unknown !== undefined || batch.retry_safety === 'result_unknown') {
      throw new DomainError(
        errorCodes.validation,
        '上次有一项结果还不能确认，不能盲目重试。请先核对模型结果或改走重新设计。',
        {},
        false,
        409
      );
    }
    const failedJobs = jobs.filter((job) => job.state === 'failed');
    if (failedJobs.length === 0) {
      throw new DomainError(errorCodes.validation, '当前没有可重试的失败设定。', {}, false, 409);
    }
    const legacyMembershipGate = batch.failure_stage === null
      && batch.retry_safety === null
      && !this.repository.hasUnsettledModelCalls(ownerId, bookId, batchId)
      && this.repository.memberEvents(ownerId, bookId, batchId)
        .some((event) => legacyMembershipGateMemberEvent(event.internal_reason));
    const safePreDispatch = (batch.failure_stage === 'pre_dispatch'
      && batch.retry_safety === 'safe_after_precondition') || legacyMembershipGate;
    if (safePreDispatch) {
      // 条件尚未恢复时保持原批次和成功检查点不动，直接给作者真实的403。
      assertMembershipAllowsGeneration(
        this.database,
        ownerId,
        this.clock.now().toISOString(),
        minimumSettingReservation(failedJobs.length)
      );
    }
    for (const job of failedJobs) {
      if (!safePreDispatch && this.repository.latestModelOutcomeForJob(ownerId, bookId, batchId, job.item_key, ['failed']) === undefined) {
        throw new DomainError(
          errorCodes.validation,
          `“${job.item_label}”没有找到可核对的失败调用，不能盲目重试。请改走重新设计。`,
          {},
          false,
          409
        );
      }
    }
    const now = this.clock.now().toISOString();
    if (this.repository.resetFailedJobs(ownerId, bookId, batchId, now) === 0) {
      throw new DomainError(errorCodes.validation, '当前没有可重试的失败设定。', {}, false, 409);
    }
    this.start({
      ...batch,
      status: 'queued',
      error_message: null,
      error_code: null,
      failure_stage: null,
      retry_safety: null,
      updated_at: now
    });
    return this.toView(this.requireBatch(ownerId, bookId, batchId));
  }

  public restartFailed(ownerId: string, bookId: string, sourceBatchId: string, input: {
    idempotencyKey?: unknown;
  }): V7SettingBatchView {
    const sourceBatch = this.requireBatch(ownerId, bookId, sourceBatchId);
    if (sourceBatch.status !== 'partially_failed') {
      throw new DomainError(errorCodes.validation, '当前任务不需要重新发起。', {}, false, 409);
    }
    if (sourceBatch.retry_safety === 'result_unknown'
      || this.repository.hasUnsettledModelCalls(ownerId, bookId, sourceBatchId)) {
      throw new DomainError(
        errorCodes.validation,
        '上次有一项结果还不能确认，不能重复发起。请先刷新页面核对结果。',
        {},
        false,
        409
      );
    }
    const failedJobs = this.jobs(ownerId, bookId, sourceBatchId).filter((job) => job.state === 'failed');
    const restartJobs = failedJobs.filter((job) => this.repository.currentItem(
      ownerId, bookId, job.item_key
    )?.active_version_id == null);
    if (restartJobs.length === 0) {
      throw new DomainError(
        errorCodes.validation,
        '未完成条目已有可查看版本，请在对应条目中重新设计。',
        {},
        false,
        409
      );
    }
    const legacyManualFailure = sourceBatch.failure_stage === null
      && sourceBatch.retry_safety === null
      && restartJobs.every((job) => this.repository.latestModelOutcomeForJob(
        ownerId, bookId, sourceBatchId, job.item_key, ['failed']
      ) === undefined);
    if (sourceBatch.retry_safety !== 'manual_redesign' && !legacyManualFailure) {
      throw new DomainError(errorCodes.validation, '这次失败应使用安全续跑，不需要重新发起。', {}, false, 409);
    }
    const idempotencyKey = scopedActionKey('restart', input.idempotencyKey);
    const profile = this.profile(ownerId, bookId);
    const itemDefinitions = restartJobs.map((job): V7SettingCatalogItem => settingItemByKey(job.item_key) ?? ({
      key: job.item_key,
      label: job.item_label,
      prompt: job.item_prompt,
      source: '历史未完成设定',
      groupKey: 'custom',
      groupTitle: job.group_title,
      required: false,
      deputyPolicy: 'conditional'
    }));
    const requestHash = hash({
      taskKind: 'restart_failed_setting_items',
      sourceBatchId,
      openingVersion: profile.version,
      items: restartJobs.map((job) => ({
        itemKey: job.item_key,
        prompt: job.item_prompt,
        authorNote: job.author_note,
        sourceRevision: this.repository.currentItem(ownerId, bookId, job.item_key)?.revision ?? null
      }))
    });
    const replay = this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.request_hash !== requestHash) {
        throw new DomainError(errorCodes.validation, '本次操作编号已经用于其他任务。', {}, false, 409);
      }
      if (replay.status === 'queued' || replay.status === 'working') this.start(replay);
      return this.toView(replay);
    }
    const now = this.clock.now().toISOString();
    assertMembershipAllowsGeneration(this.database, ownerId, now, minimumSettingReservation(restartJobs.length));
    const newBatchId = this.ids.next();
    const roster = this.effectiveRoster();
    const created = this.repository.atomic(() => {
      const concurrentReplay = this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey);
      if (concurrentReplay !== undefined) return concurrentReplay;
      const conflictItemKey = this.repository.activeBatchItemConflict(
        ownerId, bookId, restartJobs.map((job) => job.item_key)
      );
      if (conflictItemKey !== undefined) {
        const conflict = restartJobs.find((job) => job.item_key === conflictItemKey);
        throw new DomainError(
          errorCodes.taskAlreadyRunning,
          `“${conflict?.item_label ?? conflictItemKey}”已经在设计中，请等待当前任务完成。`,
          {},
          true,
          409
        );
      }
      return this.repository.createBatchWithJobs({
        batch: {
          batchId: newBatchId,
          ownerId,
          bookId,
          idempotencyKey,
          requestHash,
          selectedItemsJson: JSON.stringify(itemDefinitions.filter((item) => item.source !== '历史未完成设定').map((item) => item.key)),
          customItemsJson: JSON.stringify(itemDefinitions.filter((item) => item.source === '历史未完成设定')),
          openingVersion: profile.version,
          openingHash: hash(profile.openingBlueprint),
          rosterJson: JSON.stringify(roster),
          now
        },
        jobs: restartJobs.map((job, index) => ({
          jobId: this.ids.next(),
          item: itemDefinitions[index]!,
          authorNote: job.author_note,
          sourceRevision: this.repository.currentItem(ownerId, bookId, job.item_key)?.revision ?? null
        }))
      }).batch;
    });
    if (created.request_hash !== requestHash) {
      throw new DomainError(errorCodes.validation, '本次操作编号已经用于其他任务。', {}, false, 409);
    }
    this.start(created);
    return this.toView(created);
  }

  public createItemReviewTask(ownerId: string, bookId: string, itemKey: string, input: {
    content?: unknown; instruction?: unknown; idempotencyKey?: unknown;
    sourceRedesignTaskId?: unknown; sourceOutputId?: unknown;
  }): V7SettingBatchView {
    const profile = this.profile(ownerId, bookId);
    const source = this.requireCurrentItem(ownerId, bookId, itemKey);
    const current = this.currentItemView(ownerId, bookId, itemKey);
    const content = input.content === undefined
      ? requiredText(current.content, '当前设定内容', 1, 2_000)
      : requiredText(input.content, '设定内容', 1, 2_000);
    const instruction = note(input.instruction);
    const sourceRedesignTaskId = optionalIdentifier(input.sourceRedesignTaskId, '重新设计任务');
    const sourceOutputId = optionalIdentifier(input.sourceOutputId, '重新设计方案');
    if ((sourceRedesignTaskId === null) !== (sourceOutputId === null)) {
      throw new DomainError(errorCodes.validation, '采用重新设计方案时缺少完整来源。', {}, false, 409);
    }
    const idempotencyKey = actionKey(input.idempotencyKey);
    const requestHash = hash({
      action: 'item_review', itemKey, content, instruction, openingVersion: profile.version,
      sourceRedesignTaskId, sourceOutputId
    });
    const existing = this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw new DomainError(errorCodes.validation, '本次操作编号已经用于另一项修改，请重新操作。', {}, false, 409);
      if (existing.status === 'queued' || existing.status === 'working') {
        this.executableSettingRoster(existing);
        this.start(existing);
      }
      return this.toView(existing);
    }
    let sourceRedesignBatch: BatchRow | null = null;
    if (sourceRedesignTaskId !== null && sourceOutputId !== null) {
      sourceRedesignBatch = this.requireBatch(ownerId, bookId, sourceRedesignTaskId);
      const sourceState = settingRedesignTaskState(sourceRedesignBatch);
      if (sourceState.itemKey !== itemKey || !['awaiting_author', 'partially_failed'].includes(sourceRedesignBatch.status)) {
        throw new DomainError(errorCodes.validation, '这份重新设计方案已经采用或不属于当前设定。', {}, false, 409);
      }
      this.assertCurrentRedesignSource(ownerId, bookId, sourceState);
      const selected = this.repository.outputsForBatchItem(
        ownerId, bookId, sourceRedesignBatch.batch_id, itemKey, 'writer_proposal'
      ).find((output) => output.output_id === sourceOutputId);
      if (selected === undefined) {
        throw new DomainError(errorCodes.validation, '选择的重新设计方案不存在或不属于这项任务。', {}, false, 409);
      }
      const proposal = JSON.parse(selected.content_json) as V7WriterProposal;
      if (proposal.content.trim() !== content) {
        throw new DomainError(errorCodes.validation, '提交内容与选择的重新设计方案不一致。', {}, false, 409);
      }
    }
    const active = this.latestBatch(ownerId, bookId);
    if (active !== undefined && (active.status === 'queued' || active.status === 'working')) {
      throw new DomainError(errorCodes.validation, '编辑部正在处理上一项任务，请等它完成后再提交新的修改。', {}, true, 409);
    }
    const item = settingItemByKey(itemKey) ?? {
      key: itemKey, label: source.item_label, prompt: source.item_prompt, source: '作者',
      groupKey: 'custom', groupTitle: source.group_title, required: false, deputyPolicy: 'conditional' as const
    };
    const taskNote = [
      '这是作者本轮确认的完整修改稿，必须以这份稿件为事实底稿；没有被本轮要求点名的内容不得擅自删除或改写。',
      `【作者修改稿】${content}`,
      `【本轮整理要求】${instruction || '保持作者修改稿原意，只做必要的清晰化和一致性修正，并重新交给主编检查。'}`
    ].join('\n');
    const now = this.clock.now().toISOString();
    const batchId = this.ids.next();
    const roster = this.effectiveRoster();
    const created = this.repository.atomic(() => {
      const result = this.repository.createBatchWithJobs({
        batch: {
          batchId, ownerId, bookId, idempotencyKey, requestHash,
          selectedItemsJson: JSON.stringify([itemKey]),
          customItemsJson: JSON.stringify({ taskKind: 'item_review', itemKey, sourceRevision: source.revision }),
          openingVersion: profile.version, openingHash: hash(profile.openingBlueprint),
          rosterJson: JSON.stringify(roster), now
        },
        jobs: [{ jobId: this.ids.next(), item, authorNote: taskNote }]
      });
      if (result.batch.request_hash !== requestHash) {
        throw new DomainError(errorCodes.validation, '本次操作编号已经用于另一项修改，请重新操作。', {}, false, 409);
      }
      if (result.created) {
        this.saveOutput(
          ownerId,
          bookId,
          result.batch.batch_id,
          itemKey,
          'author_revision',
          'author',
          {
            content, instruction,
            ...(sourceRedesignBatch === null ? {} : {
              sourceRedesignTaskId: sourceRedesignBatch.batch_id,
              sourceOutputId
            })
          },
          [],
          `${result.batch.batch_id}-${itemKey}-author-instruction`
        );
      }
      return result;
    });
    const row = created.batch;
    this.start(row);
    return this.toView(row);
  }

  public redesign(
    ownerId: string,
    bookId: string,
    itemKey: string,
    input: { memberKeys?: unknown; authorNote?: unknown; idempotencyKey?: unknown }
  ): V7SettingRedesignTaskView {
    const memberKeys = normalizeMemberKeys(input.memberKeys);
    const authorNote = note(input.authorNote);
    const idempotencyKey = scopedActionKey('redesign', input.idempotencyKey);
    const requestHash = hash({ action: 'item_redesign', itemKey, memberKeys, authorNote });
    const replay = this.existingSyntheticBatch(ownerId, bookId, idempotencyKey, requestHash);
    if (replay !== undefined) {
      const replayState = settingRedesignTaskState(replay);
      if (replayState.itemKey !== itemKey) {
        throw new DomainError(errorCodes.validation, '本次操作编号已经用于另一项设定。', {}, false, 409);
      }
      if (replay.status === 'queued' || replay.status === 'working') this.startRedesign(replay);
      return this.redesignTaskView(this.requireBatch(ownerId, bookId, replay.batch_id));
    }
    const source = this.requireCurrentItem(ownerId, bookId, itemKey);
    const lineage = this.revisionLineage(ownerId, bookId, source, null);
    const currentContent = this.currentItemView(ownerId, bookId, itemKey).content ?? '';
    const catalogItem = settingItemByKey(itemKey) ?? { key: itemKey, label: source.item_label, prompt: source.item_prompt, source: '自定义', groupKey: 'custom', groupTitle: source.group_title, required: false, deputyPolicy: 'conditional' as const };
    const currentRoster = this.effectiveRoster();
    for (const memberKey of memberKeys) {
      if (currentRoster.find((entry) => entry.memberKey === memberKey && entry.roleKey === 'screenwriter') === undefined) {
        throw new DomainError(errorCodes.validation, '选择的编剧当前无法接单。', {}, false, 409);
      }
    }
    assertMembershipAllowsGeneration(
      this.database,
      ownerId,
      this.clock.now().toISOString(),
      Math.max(8_000, memberKeys.length * 8_000)
    );
    const pack = this.contextPack(ownerId, bookId, catalogItem, authorNote);
    const state: SettingRedesignTaskState = {
      taskKind: 'item_redesign', itemKey, memberKeys, authorNote,
      sourceRevision: source.revision, currentContent, lineage, contextPack: pack
    };
    const { batch } = this.createSyntheticBatch(
      ownerId, bookId, idempotencyKey, requestHash, catalogItem, state
    );
    this.startRedesign(batch);
    return this.redesignTaskView(this.requireBatch(ownerId, bookId, batch.batch_id));
  }

  public getRedesign(
    ownerId: string,
    bookId: string,
    itemKey: string,
    taskId: string
  ): V7SettingRedesignTaskView {
    const batch = this.requireBatch(ownerId, bookId, taskId);
    const state = settingRedesignTaskState(batch);
    if (state.itemKey !== itemKey) {
      throw new DomainError(errorCodes.validation, '重新设计任务不存在或不属于这项设定。', {}, false, 404);
    }
    if (batch.status === 'completed') {
      throw new DomainError(errorCodes.validation, '这组方案已经用于新的设定任务，请查看当前设定。', {}, false, 409);
    }
    this.assertCurrentRedesignSource(ownerId, bookId, state);
    if (batch.status === 'queued' || batch.status === 'working') this.startRedesign(batch);
    return this.redesignTaskView(this.requireBatch(ownerId, bookId, taskId));
  }

  public getCurrentRedesign(ownerId: string, bookId: string, itemKey: string): V7SettingRedesignTaskView {
    const batch = this.repository.latestSyntheticTask(ownerId, bookId, itemKey, 'item_redesign');
    if (batch === undefined) {
      throw new DomainError(errorCodes.validation, '这项设定还没有重新设计任务。', {}, false, 404);
    }
    if (batch.status === 'completed') {
      throw new DomainError(errorCodes.validation, '这项设定当前没有待采用的重新设计方案。', {}, false, 404);
    }
    this.assertCurrentRedesignSource(ownerId, bookId, settingRedesignTaskState(batch));
    if (batch.status === 'queued' || batch.status === 'working') this.startRedesign(batch);
    return this.redesignTaskView(this.requireBatch(ownerId, bookId, batch.batch_id));
  }

  public retryRedesign(
    ownerId: string,
    bookId: string,
    itemKey: string,
    taskId: string
  ): V7SettingRedesignTaskView {
    const batch = this.requireBatch(ownerId, bookId, taskId);
    const state = settingRedesignTaskState(batch);
    if (state.itemKey !== itemKey) {
      throw new DomainError(errorCodes.validation, '重新设计任务不存在或不属于这项设定。', {}, false, 404);
    }
    this.assertCurrentRedesignSource(ownerId, bookId, state);
    if (batch.status !== 'partially_failed') {
      throw new DomainError(errorCodes.validation, '当前任务不需要重试。', {}, false, 409);
    }
    if (batch.retry_safety === 'result_unknown') {
      throw new DomainError(
        errorCodes.validation,
        '上次有一项结果还不能确认，不能盲目重试。请保留当前内容后重新发起。',
        {},
        false,
        409
      );
    }
    if (batch.retry_safety === 'safe_after_precondition') {
      const completedMembers = new Set(this.repository.outputsForBatchItem(
        ownerId, bookId, taskId, itemKey, 'writer_proposal'
      ).map((output) => output.member_key));
      const missingMemberCount = state.memberKeys.filter((memberKey) => !completedMembers.has(memberKey)).length;
      assertMembershipAllowsGeneration(
        this.database,
        ownerId,
        this.clock.now().toISOString(),
        Math.max(8_000, missingMemberCount * 8_000)
      );
    } else if (batch.retry_safety === 'technical_retry') {
      const failed = this.repository.latestModelOutcomeForBatch(ownerId, bookId, taskId, ['failed']);
      if (failed === undefined) {
        throw new DomainError(
          errorCodes.validation,
          '没有找到可核对的失败调用，不能盲目重试。请重新发起设计。',
          {},
          false,
          409
        );
      }
    } else {
      throw new DomainError(errorCodes.validation, '这次失败不能安全续跑，请基于当前内容重新设计。', {}, false, 409);
    }
    const now = this.clock.now().toISOString();
    if (!this.repository.resetSyntheticBatch(ownerId, bookId, taskId, now)) {
      throw new DomainError(errorCodes.validation, '当前任务状态已经变化，请刷新后再试。', {}, false, 409);
    }
    const queued = this.requireBatch(ownerId, bookId, taskId);
    this.startRedesign(queued);
    return this.redesignTaskView(this.requireBatch(ownerId, bookId, taskId));
  }

  public fuse(ownerId: string, bookId: string, itemKey: string, input: { outputIds?: unknown; authorNote?: unknown; idempotencyKey?: unknown }): V7SettingBatchView {
    const outputIds = normalizeOutputIds(input.outputIds);
    const authorNote = note(input.authorNote);
    const idempotencyKey = scopedActionKey('fusion', input.idempotencyKey);
    const requestHash = hash({ action: 'item_fusion', itemKey, outputIds, authorNote });
    const replay = this.existingSyntheticBatch(ownerId, bookId, idempotencyKey, requestHash);
    if (replay !== undefined) {
      if (this.jobs(ownerId, bookId, replay.batch_id).length === 0) {
        throw new DomainError(errorCodes.operationIncomplete, '旧融合任务无法安全恢复，请重新选择当前方案。', {}, false, 409);
      }
      if (replay.status === 'queued' || replay.status === 'working') this.start(replay);
      return this.toView(replay);
    }
    const rows = this.outputs(ownerId, bookId, itemKey, outputIds);
    if (rows.length !== outputIds.length) throw new DomainError(errorCodes.validation, '候选包含不存在或不属于本书的版本。');
    if (rows.some((row) => row.kind !== 'writer_proposal') || new Set(rows.map((row) => row.batch_id)).size !== 1) {
      throw new DomainError(errorCodes.validation, '只能融合同一轮重新设计产生的编剧方案。', {}, false, 409);
    }
    const sourceBatch = this.requireBatch(ownerId, bookId, rows[0]!.batch_id);
    const sourceState = settingRedesignTaskState(sourceBatch);
    if (sourceState.itemKey !== itemKey || !['awaiting_author', 'partially_failed'].includes(sourceBatch.status)) {
      throw new DomainError(errorCodes.validation, '这组重新设计方案已经采用或不属于当前设定。', {}, false, 409);
    }
    this.assertCurrentRedesignSource(ownerId, bookId, sourceState);
    const item = this.requireCurrentItem(ownerId, bookId, itemKey);
    const catalog = settingItemByKey(itemKey) ?? { key: itemKey, label: item.item_label, prompt: item.item_prompt, source: '自定义', groupKey: 'custom', groupTitle: item.group_title, required: false, deputyPolicy: 'never' as const };
    assertMembershipAllowsGeneration(this.database, ownerId, this.clock.now().toISOString(), 8_000);
    const now = this.clock.now().toISOString();
    const batchId = this.ids.next();
    const created = this.repository.atomic(() => {
      const result = this.repository.createBatchWithJobs({
        batch: {
          batchId, ownerId, bookId, idempotencyKey, requestHash,
          selectedItemsJson: JSON.stringify([itemKey]),
          customItemsJson: JSON.stringify({
            taskKind: 'item_fusion', itemKey, outputIds, authorNote,
            sourceTaskId: sourceBatch.batch_id, sourceRevision: sourceState.sourceRevision
          }),
          openingVersion: sourceBatch.opening_version,
          openingHash: sourceBatch.opening_hash,
          rosterJson: sourceBatch.roster_json,
          now
        },
        jobs: [{ jobId: this.ids.next(), item: catalog, authorNote }]
      });
      if (result.batch.request_hash !== requestHash) {
        throw new DomainError(errorCodes.validation, '操作编号已用于其他内容。', {}, false, 409);
      }
      return result;
    });
    const batch = created.batch;
    this.start(batch);
    return this.toView(batch);
  }

  public reviseItem(ownerId: string, bookId: string, itemKey: string, input: { content?: unknown; idempotencyKey?: unknown }): V7SettingBatchView {
    return this.createItemReviewTask(ownerId, bookId, itemKey, {
      content: input.content,
      instruction: '这是作者亲自修改后的版本。保留作者原意，只整理表达与明显的一致性问题，然后重新交给主编检查。',
      idempotencyKey: input.idempotencyKey
    });
  }

  public confirm(ownerId: string, bookId: string, itemKey: string, input: { expectedRevision?: unknown }): V7SettingItemView {
    const item = this.requireCurrentItem(ownerId, bookId, itemKey);
    const expected = integer(input.expectedRevision, '设定版本');
    if (item.revision !== expected) throw new DomainError(errorCodes.validation, '设定已经更新，请刷新后确认最新版本。', {}, true, 409);
    const version = this.repository.versionContent(ownerId, bookId, item.active_version_id);
    if (version === undefined) throw new DomainError(errorCodes.validation, '设定候选版本不存在。', {}, false, 409);
    const profile = this.profile(ownerId, bookId);
    const itemsBefore = this.currentItems(ownerId, bookId);
    const reviewHashBefore = finalReviewRequestHash(profile, itemsBefore);
    const reviewToAdvance = this.currentFinalReview(ownerId, bookId, profile, itemsBefore, reviewHashBefore);
    const canAdvanceReview = reviewToAdvance !== undefined
      && (reviewToAdvance.status === 'awaiting_author' || reviewToAdvance.status === 'completed')
      && parseFinalReviewStoredResult(reviewToAdvance.selected_items_json) !== null;
    const now = this.clock.now().toISOString();
    const nextRevision = expected + 1;
    const versionId = this.ids.next();
    const nextReviewHash = canAdvanceReview
      ? finalReviewRequestHash(profile, itemsBefore.map((candidate) => candidate.itemKey === itemKey
        ? { ...candidate, state: 'confirmed', stateText: stateText('confirmed'), revision: nextRevision }
        : candidate))
      : null;
    const confirmed = this.repository.confirmItem({
      ownerId, bookId, itemKey, sourceVersionId: item.active_version_id, sourceOutputId: item.source_output_id,
      expectedRevision: expected, nextRevision, versionId, now,
      ...(canAdvanceReview && reviewToAdvance !== undefined && nextReviewHash !== null
        ? { finalReviewAdvance: {
            taskId: reviewToAdvance.batch_id,
            expectedResultHash: reviewHashBefore,
            nextResultHash: nextReviewHash
          } }
        : {})
    });
    if (!confirmed) throw new DomainError(errorCodes.validation, '设定已经更新，请刷新后确认最新版本。', {}, true, 409);
    return this.currentItemView(ownerId, bookId, itemKey);
  }

  public adminMembers(): Array<V7SettingMemberDefinition & { enabled: boolean; revision: number; credentialReady: boolean }> {
    return this.settingRoster().map((member) => {
      const row = this.repository.memberSetting(member.memberKey);
      return { ...member, enabled: row?.enabled !== 0, revision: row?.revision ?? 1, credentialReady: member.model.plan === 'coding' ? this.credentials.codingPlan : this.credentials.agentPlan };
    });
  }

  public updateAdminMember(actorId: string, memberKey: string, input: { enabled?: unknown; expectedRevision?: unknown }): ReturnType<V7SettingEditorialService['adminMembers']>[number] {
    const definition = this.settingRoster().find((member) => member.memberKey === memberKey);
    if (definition === undefined) throw new DomainError(errorCodes.validation, '设定成员不存在。', {}, false, 404);
    if (typeof input.enabled !== 'boolean') throw new DomainError(errorCodes.validation, '请选择上岗或请假。');
    const expected = integer(input.expectedRevision, '成员设置版本');
    const now = this.clock.now().toISOString();
    const existing = this.repository.memberSetting(memberKey);
    const revision = existing?.revision ?? 1;
    if (revision !== expected) throw new DomainError(errorCodes.validation, '成员状态已经更新，请刷新后再操作。', {}, true, 409);
    const saved = this.repository.saveMemberSetting({ memberKey, enabled: input.enabled, expectedRevision: expected, actorId, now, exists: existing !== undefined });
    if (!saved) throw new DomainError(errorCodes.validation, '成员状态已经更新，请刷新后再操作。', {}, true, 409);
    return this.adminMembers().find((member) => member.memberKey === memberKey)!;
  }

  private currentRecommendation(
    ownerId: string,
    bookId: string,
    profile: BookProfileView,
    catalog: readonly V7SettingCatalogItem[]
  ): BatchRow | undefined {
    const openingHash = hash(profile.openingBlueprint);
    return this.repository.latestRecommendation(
      ownerId,
      bookId,
      profile.version,
      openingHash,
      recommendationRequestHash(profile, catalog)
    );
  }

  private insertRecommendation(
    ownerId: string,
    bookId: string,
    profile: BookProfileView,
    catalog: readonly V7SettingCatalogItem[],
    idempotencyKey: string
  ): BatchRow {
    const requestHash = recommendationRequestHash(profile, catalog);
    const existing = this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || recommendationState(existing).taskKind !== 'catalog_recommendation') {
        throw new DomainError(errorCodes.validation, '本次操作编号已经用于其他工作，请重新操作。', {}, false, 409);
      }
      return existing;
    }
    const chief = this.availableRecommendationChiefs()[0];
    if (chief === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '主编们今天都在请假，暂时无法整理设定清单。', {}, true, 409);
    }
    const taskId = this.ids.next();
    const now = this.clock.now().toISOString();
    const state: RecommendationState = {
      taskKind: 'catalog_recommendation',
      phase: 'preparing',
      progress: 8,
      assignedMemberKey: chief.memberKey,
      attemptedMemberKeys: [],
      publicMessage: '主人稍等，主编正在接收您已经确认的开书资料。'
    };
    this.repository.createRecommendationTask({
      taskId,
      ownerId,
      bookId,
      idempotencyKey,
      requestHash,
      openingVersion: profile.version,
      openingHash: hash(profile.openingBlueprint),
      rosterJson: JSON.stringify([chief]),
      stateJson: JSON.stringify(state),
      now
    });
    return this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey)!;
  }

  private startRecommendation(task: BatchRow): void {
    void this.executeRecommendation(task).catch(() => undefined);
  }

  private async executeRecommendation(task: BatchRow): Promise<void> {
    const token = randomUUID();
    const started = this.clock.now();
    const claimed = this.repository.claimBatch({
      ownerId: task.owner_id,
      bookId: task.book_id,
      batchId: task.batch_id,
      token,
      leaseExpiresAt: new Date(started.getTime() + LEASE_MS).toISOString(),
      now: started.toISOString()
    });
    if (!claimed) return;
    this.startLeaseHeartbeat(task, token);
    this.reconcileReclaimedBatch(task, started);
    let state = recommendationState(task);
    let chief: V7OpeningMemberDefinition;
    try {
      chief = this.executableRecommendationChief(task);
    } catch (error) {
      const failed = failedRecommendationState(
        state,
        '对不起，这是一轮历史设定清单，已保存的结果仍会保留，但不能再用旧成员或旧模型继续。请重新整理。'
      );
      this.repository.failRecommendation({
        ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
        stateJson: JSON.stringify(failed),
        message: error instanceof Error ? error.message.slice(0, 1_000) : '设定清单主编绑定无效',
        errorCode: errorCodes.operationIncomplete,
        failureStage: 'pre_dispatch',
        retrySafety: 'manual_redesign',
        now: this.clock.now().toISOString()
      });
      return;
    }
    const profile = this.profile(task.owner_id, task.book_id);
    const catalog = V7_SETTING_CATALOG.map((item) => ({ ...item }));
    if (
      task.opening_version !== profile.version
      || task.opening_hash !== hash(profile.openingBlueprint)
      || task.request_hash !== recommendationRequestHash(profile, catalog)
    ) {
      state = failedRecommendationState(state, '开书资料已经更新，请重新整理设定清单。');
      this.repository.failRecommendation({
        ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
        stateJson: JSON.stringify(state), message: '开书资料版本或设定目录已经变化',
        errorCode: errorCodes.bookVersionConflict, failureStage: 'pre_dispatch', retrySafety: 'manual_redesign',
        now: this.clock.now().toISOString()
      });
      return;
    }
    state = {
      ...state,
      phase: 'understanding',
      progress: 28,
      assignedMemberKey: chief.memberKey,
      attemptedMemberKeys: [chief.memberKey],
      publicMessage: `${chief.displayName}正在理解人物、时代和故事方向，请主人耐心等一下。`
    };
    this.repository.updateRecommendationState({
      ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
      stateJson: JSON.stringify(state), now: this.clock.now().toISOString()
    });
    this.recommendationEvent(task, chief, 'start', `${chief.displayName}开始整理本书设定清单`);
    try {
      await this.genreProfiles.ensure(task.owner_id, task.book_id);
      this.requireLeaseOwnership(task, token);
      const prompt = compileSettingCatalogRecommendationPrompt({
        openingProfile: recommendationOpeningProfile(profile),
        catalog,
        memberInstruction: ''
      });
      const failedAttempt = this.repository.latestModelOutcomeForJob(
        task.owner_id,
        task.book_id,
        task.batch_id,
        '__setting_catalog__',
        ['failed']
      );
      const technicalRetryTaskId = failedAttempt?.node_key === 'catalog_recommendation'
        && failedAttempt.member_key === chief.memberKey
        ? failedAttempt.logical_task_id
        : null;
      const logicalTaskId = `${task.batch_id}-catalog-chief-${chief.memberKey}`;
      const output = await this.model(
        task.owner_id, task.book_id, task.batch_id, '__setting_catalog__', 'catalog_recommendation',
        chief, prompt, 4_000, 0.25, logicalTaskId,
        settingModelInvocation({
          taskKind: 'setting_recommendation', operationMode: technicalRetryTaskId === null ? 'fresh' : 'retry',
          sourceTraces: [openingProfileSourceTrace(task.owner_id, task.book_id, profile)],
          technicalRetryTaskId
        })
      );
      this.requireLeaseOwnership(task, token);
      state = {
        ...state,
        phase: 'organizing',
        progress: 74,
        publicMessage: `${chief.displayName}已经读懂资料，正在把设定清单分成轻重缓急。`
      };
      if (!this.repository.updateRecommendationState({
        ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
        stateJson: JSON.stringify(state), now: this.clock.now().toISOString()
      })) throw new SettingLeaseLostError();
      let result: ReturnType<typeof parseSettingCatalogRecommendation>;
      try {
        result = parseSettingCatalogRecommendation(output, catalog);
      } catch {
        const repairTaskId = `${logicalTaskId}-repair`;
        const technicalRepairTaskId = failedAttempt?.node_key === 'catalog_recommendation_repair'
          && failedAttempt.member_key === chief.memberKey
          ? failedAttempt.logical_task_id
          : null;
        const repaired = await this.model(
          task.owner_id, task.book_id, task.batch_id, '__setting_catalog__', 'catalog_recommendation_repair',
          chief,
          `${prompt}\n上次结果已经保留，但JSON结构没有通过合同校验。只修复JSON结构和缺失字段，不改变原有设定取舍：${output}`,
          4_000,
          0.1,
          technicalRepairTaskId ?? repairTaskId,
          settingModelInvocation({
            taskKind: 'setting_recommendation',
            operationMode: 'repair',
            lineage: { operationMode: 'repair', basedOnTaskId: logicalTaskId, authorInstructionVersion: null },
            sourceTraces: [openingProfileSourceTrace(task.owner_id, task.book_id, profile)],
            technicalRetryTaskId: technicalRepairTaskId
          })
        );
        result = parseSettingCatalogRecommendation(repaired, catalog);
      }
      this.requireLeaseOwnership(task, token);
      state = {
        ...state,
        phase: 'validating',
        progress: 90,
        publicMessage: '清单已经整理出来，正在做最后一次完整检查。'
      };
      if (!this.repository.updateRecommendationState({
        ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
        stateJson: JSON.stringify(state), now: this.clock.now().toISOString()
      })) throw new SettingLeaseLostError();
      const ready: RecommendationState = {
        ...state,
        phase: 'ready',
        progress: 100,
        publicMessage: `${chief.displayName}已经整理好本书真正需要的设定清单。`
      };
      if (!this.repository.completeRecommendation({
        ownerId: task.owner_id,
        bookId: task.book_id,
        taskId: task.batch_id,
        token,
        resultJson: JSON.stringify({ taskKind: 'catalog_recommendation', result }),
        stateJson: JSON.stringify(ready),
        now: this.clock.now().toISOString()
      })) throw new SettingLeaseLostError();
      this.recommendationEvent(task, chief, 'complete', `${chief.displayName}已经完成设定清单`);
    } catch (error) {
      if (error instanceof SettingLeaseLostError) return;
      const failure = settingBatchFailure(error);
      if (!isSettingPreDispatchFailure(error)) {
        this.recommendationEvent(task, chief, 'leave', `${chief.displayName}这次没有完成设定清单`, undefined, error);
      }
      const failed = failedRecommendationState(
        state,
        failure.publicMessage
      );
      this.repository.failRecommendation({
        ownerId: task.owner_id,
        bookId: task.book_id,
        taskId: task.batch_id,
        token,
        stateJson: JSON.stringify(failed),
        message: failure.storedMessage,
        errorCode: failure.code,
        failureStage: failure.stage,
        retrySafety: failure.retrySafety,
        now: this.clock.now().toISOString()
      });
    }
  }

  private recommendationView(row: BatchRow, stale = false): V7SettingCatalogRecommendationView {
    const state = recommendationState(row);
    const result = recommendationResult(row.selected_items_json);
    let roster: V7OpeningMemberDefinition[] = [];
    try { roster = readOpeningChiefTaskSnapshot(row.roster_json); }
    catch { /* Historical/corrupt snapshots remain inspectable without execution. */ }
    const lookup = new Map([...V7_OPENING_MEMBERS, ...roster].map((member) => [member.memberKey, member]));
    const member = state.assignedMemberKey === null ? null : lookup.get(state.assignedMemberKey) ?? null;
    const status: V7SettingCatalogRecommendationView['status'] = stale
      ? 'failed'
      : row.status === 'awaiting_author'
      ? 'ready'
      : row.status === 'partially_failed'
        ? 'failed'
        : row.status === 'queued'
          ? 'queued'
          : 'working';
    const latestFailure = status === 'failed' && !stale
      ? this.repository.latestModelOutcomeForBatch(row.owner_id, row.book_id, row.batch_id, ['failed', 'unknown'])
      : undefined;
    const completedModel = status === 'failed' && !stale
      ? this.repository.latestModelOutcomeForBatch(row.owner_id, row.book_id, row.batch_id, ['succeeded'])
      : undefined;
    const restartable = !stale && status === 'failed' && (
      row.retry_safety === 'manual_redesign'
      || (row.retry_safety === null && latestFailure === undefined && completedModel !== undefined)
    );
    return {
      taskId: row.batch_id,
      status,
      statusText: stale ? '开书资料后来修改过；本书的一次主编整理已经使用，不会暗中再次调用。' : state.publicMessage,
      phase: stale ? 'failed' : state.phase,
      phaseText: stale ? '当前清单已过期' : recommendationPhaseText(state.phase),
      progress: stale ? 100 : Math.max(0, Math.min(100, Math.round(state.progress))),
      member: member === null ? null : { memberKey: member.memberKey, displayName: member.displayName },
      attemptedMembers: state.attemptedMemberKeys.map((key) => lookup.get(key)).filter((item): item is V7OpeningMemberDefinition => item !== undefined).map((item) => ({ memberKey: item.memberKey, displayName: item.displayName })),
      result: stale ? null : result,
      retryable: !stale && status === 'failed' && (
        row.retry_safety === 'safe_after_precondition'
        || (latestFailure?.state === 'failed' && row.retry_safety !== 'manual_redesign')
      ),
      restartable,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private availableRecommendationChiefs(): V7OpeningMemberDefinition[] {
    return this.openingRoster().filter((member) => member.roleKey === 'chief_editor' && member.enabledByDefault && (
      member.model.plan === 'coding' ? this.credentials.codingPlan : this.credentials.agentPlan
    )).toSorted((left, right) => Number(right.defaultForRole) - Number(left.defaultForRole) || left.fallbackPriority - right.fallbackPriority).map((member) => ({ ...member, model: { ...member.model } }));
  }

  private recommendationEvent(
    task: BatchRow,
    member: V7OpeningMemberDefinition,
    type: 'start' | 'complete' | 'leave',
    message: string,
    handoffTo?: string,
    error?: unknown
  ): void {
    this.repository.insertMemberEvent({
      eventId: this.ids.next(), ownerId: task.owner_id, bookId: task.book_id, batchId: task.batch_id,
      itemKey: '__setting_catalog__', memberKey: member.memberKey, eventType: type,
      handoffTo: handoffTo ?? null, publicMessage: message,
      internalReason: error instanceof Error ? error.message.slice(0, 1_000) : error === undefined ? null : String(error).slice(0, 1_000),
      now: this.clock.now().toISOString()
    });
  }

  private startFinalReview(task: BatchRow): void {
    void this.executeFinalReview(task).catch(() => undefined);
  }

  private async executeFinalReview(task: BatchRow): Promise<void> {
    const token = randomUUID();
    const started = this.clock.now();
    if (!this.repository.claimBatch({
      ownerId: task.owner_id, bookId: task.book_id, batchId: task.batch_id, token,
      leaseExpiresAt: new Date(started.getTime() + LEASE_MS).toISOString(), now: started.toISOString()
    })) return;
    this.startLeaseHeartbeat(task, token);
    this.reconcileReclaimedBatch(task, started);
    const state = finalReviewState(task);
    let chiefs: V7SettingMemberDefinition[];
    try {
      chiefs = this.executableSettingRoster(task)
        .filter((member) => member.roleKey === 'chief_editor')
        .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
    } catch (error) {
      this.repository.failFinalReview({
        ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
        stateJson: JSON.stringify({
          ...state, phase: 'failed', progress: 100,
          publicMessage: '对不起，这是一轮历史设定任务，已保存内容仍会保留，但不能再用旧成员或旧模型继续。请重新整理。'
        }),
        message: error instanceof Error ? error.message.slice(0, 1_000) : '设定任务冻结名册无效',
        errorCode: errorCodes.operationIncomplete,
        failureStage: 'pre_dispatch',
        retrySafety: 'manual_redesign',
        now: this.clock.now().toISOString()
      });
      return;
    }
    const profile = this.profile(task.owner_id, task.book_id);
    const items = this.currentItems(task.owner_id, task.book_id);
    const expectedHash = finalReviewRequestHash(profile, items);
    if (expectedHash !== task.request_hash) {
      this.repository.failFinalReview({
        ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
        stateJson: JSON.stringify({ ...state, phase: 'failed', progress: 100, publicMessage: '对不起，设定刚刚发生了变化，请重新整理当前版本。' }),
        message: '设定版本已变化', errorCode: errorCodes.bookVersionConflict,
        failureStage: 'pre_dispatch', retrySafety: 'manual_redesign', now: this.clock.now().toISOString()
      });
      return;
    }
    let lastError: unknown = new Error('没有可用主编');
    let localCommitFailure = false;
    for (const chief of chiefs) {
      try { this.requireLeaseOwnership(task, token); }
      catch (error) {
        if (error instanceof SettingLeaseLostError) return;
        throw error;
      }
      const attempted = [...new Set([...state.attemptedMemberKeys, chief.memberKey])];
      const working: FinalReviewState = {
        ...state, phase: 'reviewing', progress: 35, assignedMemberKey: chief.memberKey,
        attemptedMemberKeys: attempted, publicMessage: `${chief.displayName}正在统一核对人物、规则、时间与机构名称。`
      };
      if (!this.repository.updateFinalReviewState({
        ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
        stateJson: JSON.stringify(working), now: this.clock.now().toISOString()
      })) return;
      const failedAttempt = this.repository.latestModelOutcomeForJob(
        task.owner_id, task.book_id, task.batch_id, '__batch_final_review__', ['failed']
      );
      const logicalTaskId = `${task.batch_id}-batch-final-${chief.memberKey}`;
      const technicalRetryTaskId = failedAttempt?.node_key === 'batch_final_review'
        && failedAttempt.member_key === chief.memberKey
        ? failedAttempt.logical_task_id
        : null;
      let committing = false;
      try {
        const reviewPrompt = compileBatchFinalReviewPrompt(
          profile,
          items,
          this.currentSettingProjections(task.owner_id, task.book_id, items)
        );
        const raw = await this.model(
          task.owner_id, task.book_id, task.batch_id, '__batch_final_review__', 'batch_final_review', chief,
          reviewPrompt.prompt, 12_000, 0.22, logicalTaskId,
          settingModelInvocation({
            taskKind: 'setting_review', operationMode: technicalRetryTaskId === null ? 'fresh' : 'retry',
            sourceTraces: batchFinalReviewSourceTraces(task.owner_id, task.book_id, profile, items),
            technicalRetryTaskId
          })
        );
        this.requireLeaseOwnership(task, token);
        let detectedReview: FinalReviewModelResult;
        try {
          detectedReview = parseBatchFinalReview(raw, items, reviewPrompt.allowPatches);
        } catch {
          const repairTaskId = `${logicalTaskId}-repair`;
          const technicalRepairTaskId = failedAttempt?.node_key === 'batch_final_review_repair'
            && failedAttempt.member_key === chief.memberKey
            ? failedAttempt.logical_task_id
            : null;
          const repaired = await this.model(
            task.owner_id, task.book_id, task.batch_id, '__batch_final_review__', 'batch_final_review_repair', chief,
            `${reviewPrompt.prompt}\n上次统一整理结果已经保留，但JSON结构没有通过合同校验。只修复JSON结构和缺失字段，不重新判断、不增加冲突、不改变原有决定：${raw}`,
            12_000,
            0.1,
            technicalRepairTaskId ?? repairTaskId,
            settingModelInvocation({
              taskKind: 'setting_review', operationMode: 'repair',
              lineage: { operationMode: 'repair', basedOnTaskId: logicalTaskId, authorInstructionVersion: null },
              sourceTraces: batchFinalReviewSourceTraces(task.owner_id, task.book_id, profile, items),
              technicalRetryTaskId: technicalRepairTaskId
            })
          );
          detectedReview = parseBatchFinalReview(repaired, items, reviewPrompt.allowPatches);
        }
        const repairedPatches = [...detectedReview.patches];
        if (!reviewPrompt.allowPatches && detectedReview.conflicts.length > 0) {
          const patchPrompts = compileBatchFinalReviewPatchPrompts(profile, items, detectedReview);
          for (const [index, patchPrompt] of patchPrompts.entries()) {
            const patchItemKey = `__batch_final_review_patch__:${index + 1}`;
            const failedPatch = this.repository.latestModelOutcomeForJob(
              task.owner_id, task.book_id, task.batch_id, patchItemKey, ['failed']
            );
            const patchLogicalTaskId = `${task.batch_id}-batch-final-${chief.memberKey}-patch-${index + 1}`;
            const rawPatch = await this.model(
              task.owner_id, task.book_id, task.batch_id, patchItemKey, 'batch_final_review_patch', chief,
              patchPrompt.prompt, 12_000, 0.18, patchLogicalTaskId,
              settingModelInvocation({
                taskKind: 'setting_review', operationMode: failedPatch === undefined ? 'fresh' : 'retry',
                sourceTraces: batchFinalReviewSourceTraces(
                  task.owner_id,
                  task.book_id,
                  profile,
                  items.filter((item) => patchPrompt.itemKeys.includes(item.itemKey))
                ),
                technicalRetryTaskId: failedPatch?.node_key === 'batch_final_review_patch'
                  && failedPatch.member_key === chief.memberKey
                  ? failedPatch.logical_task_id
                  : null
              })
            );
            this.requireLeaseOwnership(task, token);
            try {
              repairedPatches.push(...parseBatchFinalReviewPatchGroup(rawPatch, patchPrompt.itemKeys));
            } catch {
              const patchRepairTaskId = `${patchLogicalTaskId}-repair`;
              const technicalPatchRepairTaskId = failedPatch?.node_key === 'batch_final_review_patch_repair'
                && failedPatch.member_key === chief.memberKey
                ? failedPatch.logical_task_id
                : null;
              const repairedPatch = await this.model(
                task.owner_id, task.book_id, task.batch_id, patchItemKey, 'batch_final_review_patch_repair', chief,
                `${patchPrompt.prompt}\n上次定向修订结果已经保留，但JSON结构没有通过合同校验。只修复JSON结构与缺失字段，不改变已经作出的统一决定：${rawPatch}`,
                12_000,
                0.1,
                technicalPatchRepairTaskId ?? patchRepairTaskId,
                settingModelInvocation({
                  taskKind: 'setting_review', operationMode: 'repair',
                  lineage: { operationMode: 'repair', basedOnTaskId: patchLogicalTaskId, authorInstructionVersion: null },
                  sourceTraces: batchFinalReviewSourceTraces(
                    task.owner_id,
                    task.book_id,
                    profile,
                    items.filter((item) => patchPrompt.itemKeys.includes(item.itemKey))
                  ),
                  technicalRetryTaskId: technicalPatchRepairTaskId
                })
              );
              this.requireLeaseOwnership(task, token);
              repairedPatches.push(...parseBatchFinalReviewPatchGroup(repairedPatch, patchPrompt.itemKeys));
            }
          }
        }
        const review: FinalReviewModelResult = { ...detectedReview, patches: repairedPatches };
        const applying: FinalReviewState = {
          ...working, phase: 'applying', progress: 80,
          publicMessage: `${chief.displayName}正在把统一后的结果放回对应条目。`
        };
        if (!this.repository.updateFinalReviewState({
          ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
          stateJson: JSON.stringify(applying), now: this.clock.now().toISOString()
        })) throw new SettingLeaseLostError();
        const ready: FinalReviewState = {
          ...applying, phase: 'ready', progress: 100,
          publicMessage: review.verdict === 'pass'
            ? `${chief.displayName}已经统一核对完成，可以保存。`
            : `${chief.displayName}已经统一整理，并标出了仍需您决定的内容。`
        };
        committing = true;
        this.repository.atomic(() => {
          this.requireLeaseOwnership(task, token);
          const currentProfile = this.profile(task.owner_id, task.book_id);
          const beforeCommit = this.currentItems(task.owner_id, task.book_id);
          if (finalReviewRequestHash(currentProfile, beforeCommit) !== task.request_hash) {
            throw new DomainError(
              errorCodes.bookVersionConflict,
              '设定在统一整理期间已经更新，本轮结果不会覆盖新版本。请按当前内容重新整理。',
              {}, false, 409
            );
          }
          const sentinelOutputId = this.saveOutput(
            task.owner_id, task.book_id, task.batch_id, '__batch_final_review__', 'chief_review', chief.memberKey,
            review, [], logicalTaskId
          );
          for (const patch of review.patches) {
            const current = items.find((item) => item.itemKey === patch.itemKey)!;
            const item = settingItemByKey(patch.itemKey) ?? {
              key: patch.itemKey, label: current.label, prompt: current.label, source: '自定义',
              groupKey: 'custom', groupTitle: current.groupTitle, required: false, deputyPolicy: 'conditional' as const
            };
            const itemReview: V7ChiefReview = {
              verdict: patch.issues.length === 0 ? 'pass' : 'needs_author',
              finalContent: patch.finalContent, summary: patch.summary,
              contextSummary: patch.contextSummary, factEntries: patch.factEntries,
              issues: patch.issues, suggestions: patch.suggestions
            };
            const outputId = this.saveOutput(
              task.owner_id, task.book_id, task.batch_id, patch.itemKey, 'chief_review', chief.memberKey,
              itemReview, [sentinelOutputId], `${logicalTaskId}:item:${patch.itemKey}`
            );
            this.saveCandidate(
              task.owner_id, task.book_id, item, itemReview, outputId, task.batch_id,
              chief.memberKey, current.revision
            );
            this.repository.replacePendingJobOutput({
              ownerId: task.owner_id, bookId: task.book_id, itemKey: patch.itemKey,
              outputId, memberKey: chief.memberKey, now: this.clock.now().toISOString()
            });
          }
          const patchedFacts = new Map(review.patches.map((patch) => [patch.itemKey, patch.factEntries]));
          const result: V7SettingFinalReviewResult = {
            verdict: review.verdict, summary: review.summary,
            contextSummary: review.contextSummary,
            factLedger: review.factLedger.map((entry) => ({
              ...entry,
              facts: patchedFacts.get(entry.itemKey) ?? entry.facts
            })),
            groupSummaries: review.groupSummaries,
            unifiedDecisions: review.unifiedDecisions, conflicts: review.conflicts,
            patchedItemKeys: review.patches.map((patch) => patch.itemKey)
          };
          // request_hash冻结模型输入；提交成功后的结果快照单独保存，避免主编
          // 自己生成的候选被下一次页面恢复误判为作者并发修改。
          const resultHash = finalReviewRequestHash(
            currentProfile,
            this.currentItems(task.owner_id, task.book_id)
          );
          if (!this.repository.completeFinalReview({
            ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
            resultJson: JSON.stringify({ taskKind: 'batch_final_review', result, resultHash }),
            stateJson: JSON.stringify(ready), now: this.clock.now().toISOString()
          })) throw new Error('统一整理任务的租约或状态已经变化');
        });
        return;
      } catch (error) {
        if (error instanceof SettingLeaseLostError) return;
        lastError = error;
        if (committing) localCommitFailure = true;
        if (settingOutcomeUnknown(error)
          || isSettingPreDispatchFailure(error)
          || committing
          || (error instanceof DomainError && error.code === errorCodes.bookVersionConflict)) break;
      }
    }
    const inputChanged = lastError instanceof DomainError && lastError.code === errorCodes.bookVersionConflict;
    const failure: SettingBatchFailure = inputChanged
      ? {
          code: errorCodes.bookVersionConflict,
          stage: 'post_dispatch',
          retrySafety: 'manual_redesign',
          storedMessage: lastError instanceof Error ? lastError.message.slice(0, 1_000) : String(lastError).slice(0, 1_000),
          publicMessage: '对不起，整理期间设定已经更新，本轮结果没有覆盖新版本。请按当前内容重新整理。'
        }
      : localCommitFailure
        ? {
            code: errorCodes.operationIncomplete,
            stage: 'post_dispatch',
            retrySafety: 'technical_retry',
            storedMessage: lastError instanceof Error ? lastError.message.slice(0, 1_000) : String(lastError).slice(0, 1_000),
            publicMessage: '对不起，这次结果已经生成，但保存没有完成。已有设定没有被覆盖，可以安全继续保存。'
          }
        : settingBatchFailure(lastError);
    const failed: FinalReviewState = {
      ...state, phase: 'failed', progress: 100,
      publicMessage: failure.publicMessage
    };
    this.repository.failFinalReview({
      ownerId: task.owner_id, bookId: task.book_id, taskId: task.batch_id, token,
      stateJson: JSON.stringify(failed),
      message: failure.storedMessage,
      errorCode: failure.code,
      failureStage: failure.stage,
      retrySafety: failure.retrySafety,
      now: this.clock.now().toISOString()
    });
  }

  private availableFinalReviewChiefs(): V7SettingMemberDefinition[] {
    return this.effectiveRoster().filter((member) => member.roleKey === 'chief_editor')
      .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
  }

  private finalReviewView(row: BatchRow): V7SettingFinalReviewView {
    const state = finalReviewState(row);
    const knownFailure = row.status === 'partially_failed'
      ? this.repository.latestModelOutcomeForBatch(row.owner_id, row.book_id, row.batch_id, ['failed'])
      : undefined;
    const completedModel = row.status === 'partially_failed'
      ? this.repository.latestModelOutcomeForBatch(row.owner_id, row.book_id, row.batch_id, ['succeeded'])
      : undefined;
    const unknownOutcome = row.status === 'partially_failed'
      ? this.repository.latestModelOutcomeForBatch(row.owner_id, row.book_id, row.batch_id, ['unknown'])
      : undefined;
    const inputStillCurrent = row.status !== 'partially_failed' || finalReviewRequestHash(
      this.profile(row.owner_id, row.book_id),
      this.currentItems(row.owner_id, row.book_id)
    ) === row.request_hash;
    const member = state.assignedMemberKey === null
      ? null
      : this.settingRoster().find((candidate) => candidate.memberKey === state.assignedMemberKey) ?? null;
    const stored = parseFinalReviewStoredResult(row.selected_items_json);
    const restartable = row.status === 'partially_failed' && inputStillCurrent && unknownOutcome === undefined && (
      row.retry_safety === 'manual_redesign'
      || (row.retry_safety === null && knownFailure === undefined && completedModel !== undefined)
    );
    return {
      taskId: row.batch_id,
      status: row.status === 'awaiting_author' || row.status === 'completed'
        ? 'ready'
        : row.status === 'partially_failed'
          ? 'failed'
          : row.status,
      statusText: state.publicMessage,
      progress: Math.max(0, Math.min(100, Math.round(state.progress))),
      member: member === null ? null : { memberKey: member.memberKey, displayName: member.displayName },
      result: stored?.result ?? null,
      retryable: row.status === 'partially_failed' && inputStillCurrent
        && unknownOutcome === undefined
        && (row.retry_safety === 'safe_after_precondition'
          || knownFailure !== undefined
          || (row.retry_safety === 'technical_retry' && completedModel !== undefined)),
      restartable,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private start(batch: BatchRow): void { void this.execute(batch).catch(() => undefined); }

  private startRedesign(batch: BatchRow): void {
    void this.executeRedesign(batch).catch(() => undefined);
  }

  private async executeRedesign(batch: BatchRow): Promise<void> {
    const token = randomUUID();
    const started = this.clock.now();
    const claimed = this.repository.claimBatch({
      ownerId: batch.owner_id,
      bookId: batch.book_id,
      batchId: batch.batch_id,
      token,
      leaseExpiresAt: new Date(started.getTime() + LEASE_MS).toISOString(),
      now: started.toISOString()
    });
    if (!claimed) return;
    this.startLeaseHeartbeat(batch, token);
    this.reconcileReclaimedBatch(batch, started);
    try {
      const state = settingRedesignTaskState(batch);
      const source = this.requireCurrentItem(batch.owner_id, batch.book_id, state.itemKey);
      if (source.revision !== state.sourceRevision) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '这项设定在重新设计期间已经变化；旧任务已停止，请基于最新内容重新设计。',
          {},
          false,
          409
        );
      }
      const roster = this.executableSettingRoster(batch);
      const members = state.memberKeys.map((memberKey) => requireTaskMember(roster, memberKey, 'screenwriter'));
      const completedMembers = new Set(this.repository.outputsForBatchItem(
        batch.owner_id, batch.book_id, batch.batch_id, state.itemKey, 'writer_proposal'
      ).map((output) => output.member_key));
      this.requireLeaseOwnership(batch, token);
      const results = await Promise.allSettled(members.map(async (member, index) => {
        if (completedMembers.has(member.memberKey)) return;
        const logicalTaskId = `${batch.batch_id}-redesign-${index}-${member.memberKey}`;
        const previous = this.repository.modelCallForLogicalTask(batch.owner_id, batch.book_id, logicalTaskId);
        const proposal = parseWriterProposal(await this.model(
          batch.owner_id,
          batch.book_id,
          batch.batch_id,
          state.itemKey,
          'redesign',
          member,
          compileWriterPrompt(state.contextPack, null, state.authorNote, state.currentContent),
          3_000,
          0.72,
          logicalTaskId,
          settingModelInvocation({
            taskKind: 'setting_design',
            operationMode: 'revise',
            lineage: state.lineage,
            sourceTraces: settingContextSourceTraces(state.contextPack),
            technicalRetryTaskId: previous?.state === 'failed' ? logicalTaskId : null
          })
        ));
        this.repository.atomic(() => {
          this.requireLeaseOwnership(batch, token);
          this.saveOutput(
            batch.owner_id,
            batch.book_id,
            batch.batch_id,
            state.itemKey,
            'writer_proposal',
            member.memberKey,
            proposal,
            [],
            logicalTaskId
          );
        });
      }));
      const outputs = this.repository.outputsForBatchItem(
        batch.owner_id, batch.book_id, batch.batch_id, state.itemKey, 'writer_proposal'
      );
      const reasons = results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
      if (reasons.some((reason) => reason instanceof SettingLeaseLostError)) return;
      if (outputs.length === 0 || reasons.length > 0) {
        const representative = reasons.find(settingOutcomeUnknown)
          ?? reasons.find(isSettingPreDispatchFailure)
          ?? reasons[0]
          ?? new Error('没有生成可用方案');
        const failure = settingBatchFailure(representative);
        this.repository.failClaimedSyntheticBatch({
          ownerId: batch.owner_id,
          bookId: batch.book_id,
          batchId: batch.batch_id,
          token,
          message: failure.storedMessage,
          code: failure.code,
          stage: failure.stage,
          retrySafety: failure.retrySafety,
          now: this.clock.now().toISOString()
        });
        return;
      }
      const current = this.requireCurrentItem(batch.owner_id, batch.book_id, state.itemKey);
      if (current.revision !== state.sourceRevision) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '这项设定在重新设计期间已经变化；生成结果已保留在审计记录中，请基于最新内容重新设计。',
          {},
          false,
          409
        );
      }
      this.repository.finishBatch({
        ownerId: batch.owner_id,
        bookId: batch.book_id,
        batchId: batch.batch_id,
        token,
        status: 'awaiting_author',
        now: this.clock.now().toISOString()
      });
    } catch (error) {
      if (error instanceof SettingLeaseLostError) return;
      const failure = settingBatchFailure(error);
      this.repository.failClaimedSyntheticBatch({
        ownerId: batch.owner_id,
        bookId: batch.book_id,
        batchId: batch.batch_id,
        token,
        message: failure.storedMessage,
        code: failure.code,
        stage: failure.stage,
        retrySafety: failure.retrySafety,
        now: this.clock.now().toISOString()
      });
    }
  }

  private async execute(batch: BatchRow): Promise<void> {
    const token = randomUUID();
    const now = this.clock.now();
    const claimed = this.repository.claimBatch({
      ownerId: batch.owner_id, bookId: batch.book_id, batchId: batch.batch_id, token,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS).toISOString(), now: now.toISOString()
    });
    if (!claimed) return;
    this.startLeaseHeartbeat(batch, token);
    this.reconcileReclaimedBatch(batch, now);
    try {
      const jobs = this.jobs(batch.owner_id, batch.book_id, batch.batch_id).filter((job) => job.state === 'queued' || job.state === 'working' || job.state === 'chief_review');
      const roster = this.executableSettingRoster(batch);
      const writers = roster.filter((member) => member.roleKey === 'screenwriter');
      if (writers.length === 0) throw new Error('任务冻结名册中没有可执行的编剧');
      // GLM 5.3在当前方舟结构化长输出中可能把额度全部用于思考而没有可提交正文。
      // 保留其作者主动选择和最终故障转交能力，但自动批量分组优先只占用已验证
      // 能稳定返回结构化内容的成员，避免一个慢失败席位拖住整批设定。
      const stableWriters = writers.filter((member) => member.model.modelId.toLowerCase() !== 'glm-5.3');
      const automaticWriters = stableWriters.length > 0 ? stableWriters : writers;
      const units = this.settingWorkUnits(batch, jobs);
      const queues = automaticWriters.map((): JobRow[][] => []);
      units.forEach((unit, index) => queues[index % Math.max(1, automaticWriters.length)]?.push(unit));
      let executionError: unknown = null;
      await Promise.allSettled(queues.map(async (queue, index) => {
        for (const unit of queue) {
          if (executionError !== null) return;
          // 一次最多可设计 40 项，不能只依赖首次租约。每项开工前续约，
          // 保证长批次仍由同一执行者持有，页面轮询只读进度、不重复派单。
          if (!this.renewLease(batch, token)) return;
          try {
            if (unit.length > 1) await this.runJobGroup(batch, unit, automaticWriters[index]!, roster, token);
            else await this.runJob(batch, unit[0]!, automaticWriters[index]!, roster, token);
          } catch (error) {
            executionError ??= error;
            throw error;
          }
        }
      }));
      if (executionError !== null) throw executionError;
      const remaining = this.jobs(batch.owner_id, batch.book_id, batch.batch_id);
      if (remaining.some((job) => job.state === 'failed')) {
        const knownFailure = this.repository.latestModelOutcomeForBatch(
          batch.owner_id, batch.book_id, batch.batch_id, ['failed']
        );
        this.repository.failBatch({
          ownerId: batch.owner_id,
          bookId: batch.book_id,
          batchId: batch.batch_id,
          token,
          message: knownFailure?.failure_message ?? '一项设定在模型返回后未能安全提交，请核对当前版本。',
          code: knownFailure === undefined ? errorCodes.operationIncomplete : errorCodes.modelRequestRejected,
          stage: knownFailure === undefined ? 'post_dispatch' : 'in_dispatch',
          retrySafety: knownFailure === undefined ? 'manual_redesign' : 'technical_retry',
          now: this.clock.now().toISOString()
        });
        return;
      }
      this.repository.finishBatch({ ownerId: batch.owner_id, bookId: batch.book_id, batchId: batch.batch_id, token, status: 'awaiting_author', now: this.clock.now().toISOString() });
    } catch (error) {
      if (error instanceof SettingLeaseLostError) return;
      const failure = settingBatchFailure(error);
      this.repository.failBatch({
        ownerId: batch.owner_id, bookId: batch.book_id, batchId: batch.batch_id, token,
        message: failure.storedMessage,
        code: failure.code,
        stage: failure.stage,
        retrySafety: failure.retrySafety,
        now: this.clock.now().toISOString()
      });
    }
  }

  private settingWorkUnits(batch: BatchRow, jobs: readonly JobRow[]): JobRow[][] {
    const grouped = new Map<string, JobRow[]>();
    const individual: JobRow[][] = [];
    for (const job of jobs) {
      const item = settingItemByKey(job.item_key) ?? {
        key: job.item_key, label: job.item_label, prompt: job.item_prompt, source: '自定义',
        groupKey: 'custom', groupTitle: job.group_title, required: false, deputyPolicy: 'conditional' as const
      };
      const hasEarlierOutput = this.repository.latestOutputForJob(
        batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'writer_proposal'
      ) !== undefined;
      const hasAuthorInstruction = this.repository.authorInstructionForBatch(
        batch.owner_id, batch.book_id, batch.batch_id, job.item_key
      ) !== undefined;
      if (job.state === 'chief_review' || hasEarlierOutput || hasAuthorInstruction || deputyNeeded(item, job.author_note)) {
        individual.push([job]);
        continue;
      }
      const list = grouped.get(item.groupKey) ?? [];
      list.push(job);
      grouped.set(item.groupKey, list);
    }
    const units = [...grouped.values()].flatMap((items) => {
      if (items.length < 2) return items.map((item) => [item]);
      const chunks: JobRow[][] = [];
      for (let index = 0; index < items.length; index += SETTING_GROUP_SIZE) {
        const chunk = items.slice(index, index + SETTING_GROUP_SIZE);
        if (chunk.length === 1 && chunks.length > 0 && chunks.at(-1)!.length < 6) chunks.at(-1)!.push(chunk[0]!);
        else chunks.push(chunk);
      }
      return chunks;
    });
    return [...units, ...individual];
  }

  private reconcileReclaimedBatch(batch: BatchRow, started: Date): void {
    const previousLeaseExpired = batch.status === 'working'
      && (batch.lease_expires_at === null || Date.parse(batch.lease_expires_at) <= started.getTime());
    if (previousLeaseExpired) {
      this.repository.markReclaimedModelCallsUnknown(
        batch.owner_id, batch.book_id, batch.batch_id, started.toISOString()
      );
    }
  }

  private async runJobGroup(
    batch: BatchRow,
    jobs: readonly JobRow[],
    initialWriter: V7SettingMemberDefinition,
    roster: readonly V7SettingMemberDefinition[],
    leaseToken: string
  ): Promise<void> {
    const items = jobs.map((job) => settingItemByKey(job.item_key) ?? {
      key: job.item_key, label: job.item_label, prompt: job.item_prompt, source: '自定义',
      groupKey: 'custom', groupTitle: job.group_title, required: false, deputyPolicy: 'conditional' as const
    });
    const sourceRevisions = new Map(jobs.map((job) => [job.job_id, jobSourceItemRevision(job)]));
    for (const job of jobs) {
      const expected = sourceRevisions.get(job.job_id);
      if (expected !== undefined && !sourceItemRevisionMatches(
        expected,
        this.repository.currentItem(batch.owner_id, batch.book_id, job.item_key)
      )) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '设定在任务开始前已经更新，本轮旧任务不会继续执行。',
          {},
          false,
          409
        );
      }
    }
    const pack = this.groupContextPack(batch.owner_id, batch.book_id, jobs, items);
    const manifest = {
      sources: pack.sources,
      openingVersion: pack.openingVersion,
      contextPolicyVersion: pack.contextPolicyVersion,
      characterCount: pack.characterCount,
      budgetChars: pack.budgetChars,
      itemKeys: jobs.map((job) => job.item_key)
    };
    for (const job of jobs) {
      const sourceItemRevision = sourceRevisions.get(job.job_id);
      const manifestJson = JSON.stringify({
        ...manifest,
        ...(sourceItemRevision === undefined ? {} : { sourceItemRevision })
      });
      this.repository.updateJobContext({
        ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id,
        manifestJson, contextHash: pack.hash, now: this.clock.now().toISOString()
      });
      job.context_manifest_json = manifestJson;
      job.context_hash = pack.hash;
    }
    const groupKey = hash(jobs.map((job) => job.item_key)).slice(0, 16);
    const writers = roster.filter((member) => member.roleKey === 'screenwriter');
    const assigned = writers.find((member) => jobs.some((job) => job.assigned_member_key === member.memberKey));
    const preferred = assigned ?? initialWriter;
    const ordered = [preferred, ...writers.filter((member) => member.memberKey !== preferred.memberKey)];
    const prompt = compileSettingGroupPrompt(pack, jobs.map((job, index) => ({
      itemKey: job.item_key,
      label: items[index]!.label,
      prompt: items[index]!.prompt,
      authorNote: job.author_note
    })));
    for (const candidate of ordered.slice(0, MAX_HANDOFFS + 1)) {
      for (const job of jobs) this.markWorking(job, candidate);
      const logicalTaskId = `${batch.batch_id}-group-${groupKey}-writer-${candidate.memberKey}`;
      try {
        const output = await this.model(
          batch.owner_id, batch.book_id, batch.batch_id, `__setting_group__:${groupKey}`, 'writer_group', candidate,
          prompt, 10_000, 0.68, logicalTaskId,
          settingModelInvocation({
            taskKind: 'setting_design', operationMode: 'fresh', sourceTraces: settingContextSourceTraces(pack)
          })
        );
        let parsed: ReturnType<typeof parseSettingGroupProposals>;
        let resultTaskId = logicalTaskId;
        try { parsed = parseSettingGroupProposals(output, jobs.map((job) => job.item_key)); }
        catch {
          resultTaskId = `${logicalTaskId}-repair`;
          const repaired = await this.model(
            batch.owner_id, batch.book_id, batch.batch_id, `__setting_group__:${groupKey}`, 'writer_group_repair', candidate,
            `${prompt}\n上次输出格式不完整。只补齐缺失条目和JSON字段，不改变已经设计的内容：${output}`,
            10_000, 0.4, resultTaskId,
            settingModelInvocation({
              taskKind: 'setting_design', operationMode: 'repair',
              lineage: { operationMode: 'repair', basedOnTaskId: logicalTaskId, authorInstructionVersion: null },
              sourceTraces: settingContextSourceTraces(pack)
            })
          );
          parsed = parseSettingGroupProposals(repaired, jobs.map((job) => job.item_key));
        }
        this.requireLeaseOwnership(batch, leaseToken);
        this.repository.atomic(() => {
          this.requireLeaseOwnership(batch, leaseToken);
          for (const result of parsed) {
            const job = jobs.find((entry) => entry.item_key === result.itemKey)!;
            const item = items[jobs.indexOf(job)]!;
            const outputId = this.saveOutput(
              batch.owner_id, batch.book_id, batch.batch_id, job.item_key,
              'writer_proposal', candidate.memberKey, result.proposal, [], `${resultTaskId}:item:${job.item_key}`
            );
            this.saveCandidate(
              batch.owner_id, batch.book_id, item, result.review, outputId, batch.batch_id,
              candidate.memberKey, sourceRevisions.get(job.job_id)
            );
            this.repository.markJobNeedsAuthor({
              ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id,
              outputId, now: this.clock.now().toISOString()
            });
            this.event(batch, job, candidate, 'complete', `${candidate.displayName}已完成${job.item_label}`);
          }
        });
        return;
      } catch (error) {
        if (error instanceof SettingLeaseLostError) throw error;
        if (isSettingPreDispatchFailure(error)) throw error;
        if (settingOutcomeUnknown(error)) {
          for (const job of jobs) this.failJob(job, '本组结果暂时无法确认');
          throw error;
        }
        if (error instanceof DomainError && error.code === errorCodes.bookVersionConflict) {
          throw error;
        }
        const next = ordered[ordered.indexOf(candidate) + 1];
        for (const job of jobs) {
          this.event(batch, job, candidate, 'leave', `${candidate.displayName}本轮没有完成`, next?.memberKey, error);
          if (next !== undefined) this.event(batch, job, candidate, 'handoff', `工作已交接给${next.displayName}`, next.memberKey);
        }
      }
    }
    // 分组调用已知失败时，保留原有逐项恢复路径，避免整组内容一起丢失。
    for (const [index, job] of jobs.entries()) await this.runJob(batch, job, writers[index % writers.length]!, roster, leaseToken);
  }

  private groupContextPack(
    ownerId: string,
    bookId: string,
    jobs: readonly JobRow[],
    items: readonly V7SettingCatalogItem[]
  ): V7SettingContextPack {
    const profile = this.profile(ownerId, bookId);
    const projections = this.repository.confirmedVersions(ownerId, bookId).map(confirmedSettingProjection);
    requireUsableSettingProjections(projections);
    const confirmedSettings = projections.map((projection) => ({
      itemKey: projection.itemKey,
      label: projection.label,
      content: `${projection.contextSummary}\n${projection.factEntries.map((fact) => `- ${fact}`).join('\n')}`,
      revision: projection.revision
    }));
    const contracts = jobs.map((job, index) => ({
      itemKey: job.item_key, label: items[index]!.label, prompt: items[index]!.prompt, authorNote: job.author_note
    }));
    const contractText = JSON.stringify(contracts);
    const groupId = `group-${hash(jobs.map((job) => job.item_key)).slice(0, 16)}`;
    const authorNote = jobs.filter((job) => job.author_note.trim()).map((job) => `${job.item_label}：${job.author_note}`).join('\n');
    return buildSettingContextPack({
      ownerId,
      bookId,
      itemKey: groupId,
      openingVersion: profile.version,
      openingSummary: settingContextProfileText(profile),
      confirmedSettings,
      authorNote,
      itemContract: { label: jobs[0]!.group_title, prompt: contractText },
      sources: [
        { sourceType: 'opening_profile', sourceId: bookId, version: profile.version, hash: hash(profile.openingBlueprint) },
        ...confirmedSettings.map((setting) => ({ sourceType: 'confirmed_setting' as const, sourceId: setting.itemKey, version: setting.revision, hash: hash(setting.content) })),
        ...(authorNote ? [{ sourceType: 'author_note' as const, sourceId: groupId, version: 1, hash: hash(authorNote) }] : []),
        { sourceType: 'catalog_contract', sourceId: groupId, version: 1, hash: hash(contractText) }
      ]
    });
  }

  private renewLease(batch: BatchRow, token: string): boolean {
    const now = this.clock.now();
    return this.repository.renewBatchLease({
      ownerId: batch.owner_id,
      bookId: batch.book_id,
      batchId: batch.batch_id,
      token,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
      now: now.toISOString()
    });
  }

  private requireLeaseOwnership(batch: BatchRow, token: string): void {
    if (!this.renewLease(batch, token)) {
      throw new SettingLeaseLostError();
    }
  }

  private startLeaseHeartbeat(batch: BatchRow, token: string): void {
    const timer = setInterval(() => {
      try {
        if (!this.renewLease(batch, token)) clearInterval(timer);
      } catch {
        clearInterval(timer);
      }
    }, Math.min(60_000, Math.floor(LEASE_MS / 3)));
    // 心跳只保护正在执行的模型调用；不能让它单独阻止 API/测试进程退出。
    timer.unref();
  }

  private async runJob(
    batch: BatchRow,
    job: JobRow,
    initialWriter: V7SettingMemberDefinition,
    roster: readonly V7SettingMemberDefinition[],
    leaseToken: string
  ): Promise<void> {
    const item = settingItemByKey(job.item_key) ?? { key: job.item_key, label: job.item_label, prompt: job.item_prompt, source: '自定义', groupKey: 'custom', groupTitle: job.group_title, required: false, deputyPolicy: 'conditional' as const };
    const pack = this.contextPack(batch.owner_id, batch.book_id, item, job.author_note);
    const existingItem = this.repository.currentItem(batch.owner_id, batch.book_id, job.item_key);
    const reviewSourceRevision = itemReviewSourceRevision(batch, job.item_key);
    const ordinarySourceRevision = jobSourceItemRevision(job);
    const expectedSourceRevision = reviewSourceRevision === undefined
      ? ordinarySourceRevision
      : reviewSourceRevision;
    if (expectedSourceRevision !== undefined
      && !sourceItemRevisionMatches(expectedSourceRevision, existingItem)) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '这项设定在任务等待期间已经更新，本轮旧修改不会覆盖当前版本。',
        {},
        false,
        409
      );
    }
    const lineage = this.batchRevisionLineage(batch.owner_id, batch.book_id, existingItem, batch.batch_id);
    const currentContent = existingItem?.active_version_id === null || existingItem === undefined
      ? ''
      : this.currentItemView(batch.owner_id, batch.book_id, job.item_key).content ?? '';
    const manifestJson = JSON.stringify({
      sources: pack.sources,
      openingVersion: pack.openingVersion,
      ...(ordinarySourceRevision === undefined ? {} : { sourceItemRevision: ordinarySourceRevision })
    });
    this.repository.updateJobContext({ ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id, manifestJson, contextHash: pack.hash, now: this.clock.now().toISOString() });
    job.context_manifest_json = manifestJson;
    job.context_hash = pack.hash;
    const fusionSource = itemFusionSource(batch, job.item_key);
    if (fusionSource !== undefined) {
      await this.runFusionJob(batch, job, item, pack, roster, leaseToken, fusionSource);
      return;
    }
    // 作者在页面提交的是本轮完整修改稿，不是给编剧二次创作的素材。
    // 队列任务仍然负责租约、失败恢复和进度展示，但模型链应直接进入
    // 主编复审；否则编剧重写既浪费一次调用，也可能删掉作者刚确认的事实。
    const storedAuthorRevision = this.repository.latestOutputForJob(
      batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'author_revision'
    );
    let authorRevisionContent: string | null = null;
    let authorRevisionSourceTaskId: string | null = null;
    if (storedAuthorRevision !== undefined) {
      const stored = JSON.parse(storedAuthorRevision.content_json) as { content?: unknown; sourceRedesignTaskId?: unknown };
      authorRevisionContent = requiredText(stored.content, '作者修改稿', 1, 2_000);
      authorRevisionSourceTaskId = optionalIdentifier(stored.sourceRedesignTaskId, '重新设计任务');
    }
    const failedAttempt = this.repository.latestModelOutcomeForJob(
      batch.owner_id, batch.book_id, batch.batch_id, job.item_key, ['failed']
    );
    const taskFor = (nodeKey: string, memberKey: string, fallbackTaskId: string): {
      logicalTaskId: string; technicalRetryTaskId: string | null;
    } => failedAttempt?.node_key === nodeKey && failedAttempt.member_key === memberKey
      ? { logicalTaskId: failedAttempt.logical_task_id, technicalRetryTaskId: failedAttempt.logical_task_id }
      : { logicalTaskId: fallbackTaskId, technicalRetryTaskId: null };
    const storedDeputy = this.repository.latestOutputForJob(
      batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'deputy_brief'
    );
    let brief: V7DeputyBrief | null = storedDeputy === undefined
      ? null
      : parseDeputyBrief(JSON.stringify(JSON.parse(storedDeputy.content_json)));
    if (authorRevisionContent === null && deputyNeeded(item, job.author_note)) {
      const deputy = requireTaskRole(roster, 'deputy_editor');
      if (brief === null) {
        const deputyTask = taskFor('deputy', deputy.memberKey, `${batch.batch_id}-${job.item_key}-deputy`);
        this.repository.assignJobMember({ ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id, memberKey: deputy.memberKey, now: this.clock.now().toISOString() });
        this.event(batch, job, deputy, 'start', `${deputy.displayName}正在核对${job.item_label}`);
        try {
          brief = parseDeputyBrief(await this.model(
            batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'deputy', deputy,
            compileDeputyPrompt(pack), 2_000, 0.3, deputyTask.logicalTaskId,
            settingModelInvocation({
              taskKind: 'planning_context', operationMode: lineage?.operationMode ?? 'fresh',
              ...(lineage === undefined ? {} : { lineage }), sourceTraces: settingContextSourceTraces(pack),
              technicalRetryTaskId: deputyTask.technicalRetryTaskId
            })
          ));
          this.repository.atomic(() => {
            this.requireLeaseOwnership(batch, leaseToken);
            this.saveOutput(batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'deputy_brief', deputy.memberKey, brief, [], deputyTask.logicalTaskId);
            this.event(batch, job, deputy, 'complete', `${deputy.displayName}已完成${job.item_label}资料核对`);
          });
        } catch (error) {
          if (error instanceof SettingLeaseLostError) throw error;
          if (isSettingPreDispatchFailure(error)) throw error;
          if (settingOutcomeUnknown(error)) throw error;
          this.event(batch, job, deputy, 'leave', `${deputy.displayName}请假中`, initialWriter.memberKey, error);
          this.event(batch, job, deputy, 'handoff', `工作已交接给${initialWriter.displayName}`, initialWriter.memberKey);
        }
      }
    }
    const writers = roster.filter((member) => member.roleKey === 'screenwriter');
    const assignedWriter = writers.find((member) => member.memberKey === job.assigned_member_key);
    const preferredWriter = assignedWriter ?? initialWriter;
    const ordered = [preferredWriter, ...writers.filter((member) => member.memberKey !== preferredWriter.memberKey)];
    const storedWriter = this.repository.latestOutputForJob(
      batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'writer_proposal'
    );
    let proposal: V7WriterProposal | null = authorRevisionContent === null
      ? storedWriter === undefined
        ? null
        : parseWriterProposal(JSON.stringify(JSON.parse(storedWriter.content_json)))
      : {
          content: authorRevisionContent,
          designRationale: '作者亲自提交完整修改稿，主编只检查一致性与可执行性。',
          storyConsequences: [],
          dependencies: [],
          risks: []
        };
    let writer: V7SettingMemberDefinition | null = authorRevisionContent === null
      ? storedWriter === undefined
        ? null
        : roster.find((member) => member.memberKey === storedWriter.member_key) ?? null
      : initialWriter;
    let proposalOutputId = storedAuthorRevision?.output_id ?? storedWriter?.output_id ?? '';
    for (const candidate of proposal === null ? ordered.slice(0, MAX_HANDOFFS + 1) : []) {
      const attempted = this.markWorking(job, candidate);
      const writerTask = taskFor(
        'writer', candidate.memberKey, `${batch.batch_id}-${job.item_key}-writer-${candidate.memberKey}`
      );
      try {
        const writerPrompt = compileWriterPrompt(pack, brief, job.author_note, currentContent);
        const output = await this.model(
          batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'writer', candidate,
          writerPrompt, 3_000, 0.72, writerTask.logicalTaskId,
          settingModelInvocation({
            taskKind: 'setting_design', operationMode: lineage?.operationMode ?? 'fresh',
            ...(lineage === undefined ? {} : { lineage }), sourceTraces: settingContextSourceTraces(pack),
            technicalRetryTaskId: writerTask.technicalRetryTaskId
          })
        );
        let proposalTaskId = writerTask.logicalTaskId;
        try { proposal = parseWriterProposal(output); }
        catch {
          const repairTask = taskFor(
            'writer_repair', candidate.memberKey, `${writerTask.logicalTaskId}-repair`
          );
          proposalTaskId = repairTask.logicalTaskId;
          proposal = parseWriterProposal(await this.model(
            batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'writer_repair', candidate,
            `${writerPrompt}\n上次格式不合格。只修复JSON结构，不改变设计：${output}`, 3_000, 0.4, repairTask.logicalTaskId,
            settingModelInvocation({
              taskKind: 'setting_design', operationMode: 'repair',
              lineage: {
                operationMode: 'repair', basedOnTaskId: writerTask.logicalTaskId,
                authorInstructionVersion: lineage?.authorInstructionVersion ?? null
              },
              sourceTraces: settingContextSourceTraces(pack),
              technicalRetryTaskId: repairTask.technicalRetryTaskId
            })
          ));
        }
        this.repository.atomic(() => {
          this.requireLeaseOwnership(batch, leaseToken);
          writer = candidate;
          proposalOutputId = this.saveOutput(batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'writer_proposal', candidate.memberKey, proposal, [], proposalTaskId);
          this.event(batch, job, candidate, 'complete', `${candidate.displayName}已完成${job.item_label}`);
        });
        break;
      } catch (error) {
        if (error instanceof SettingLeaseLostError) throw error;
        if (isSettingPreDispatchFailure(error)) throw error;
        if (settingOutcomeUnknown(error)) throw error;
        const next = ordered[attempted.length];
        this.event(batch, job, candidate, 'leave', `${candidate.displayName}这次没有完成，正在交接`, next?.memberKey, error);
        if (next !== undefined) this.event(batch, job, candidate, 'handoff', `工作已交接给${next.displayName}`, next.memberKey);
      }
    }
    if (proposal === null || writer === null) { this.failJob(job, '对不起，这项设定这次没有完成，已完成内容仍然保留'); return; }
    const chief = authorRevisionContent === null
      ? independentTaskChief(roster, writer)
      : requireTaskRole(roster, 'chief_editor');
    this.repository.markJobChiefReview({ ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id, outputId: proposalOutputId, memberKey: chief.memberKey, now: this.clock.now().toISOString() });
    const chiefTask = taskFor('chief', chief.memberKey, `${batch.batch_id}-${job.item_key}-chief`);
    try {
      const chiefPrompt = authorRevisionContent === null
        ? compileChiefPrompt(pack, proposal)
        : [
            '【本轮权威底稿】以下方案正文是作者亲自提交的完整修改稿，不是编剧候选。',
            '除修复与已确认资料的明确冲突或消除歧义外，不得删减、换题、缩写或恢复旧版本；需要作者取舍的内容保留原文并写进issues。',
            compileChiefPrompt(pack, proposal)
          ].join('\n');
      const rawReview = await this.model(
        batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'chief', chief,
        chiefPrompt, 3_000, 0.35, chiefTask.logicalTaskId,
        settingModelInvocation({
          taskKind: 'setting_review', operationMode: lineage?.operationMode ?? 'fresh',
          ...(lineage === undefined ? {} : { lineage }), sourceTraces: settingContextSourceTraces(pack),
          technicalRetryTaskId: chiefTask.technicalRetryTaskId
        })
      );
      let review: V7ChiefReview;
      let reviewTaskId = chiefTask.logicalTaskId;
      try { review = parseChiefReview(rawReview); }
      catch {
        const repairTask = taskFor(
          'chief_repair', chief.memberKey, `${chiefTask.logicalTaskId}-repair`
        );
        reviewTaskId = repairTask.logicalTaskId;
        review = parseChiefReview(await this.model(
          batch.owner_id,
          batch.book_id,
          batch.batch_id,
          job.item_key,
          'chief_repair',
          chief,
          `${chiefPrompt}\n上次输出存在空字段或JSON结构问题。只补齐缺失字段并修复JSON，不增加新的设定事实：${rawReview}`,
          3_000,
          0.2,
          repairTask.logicalTaskId,
          settingModelInvocation({
            taskKind: 'setting_review', operationMode: 'repair',
            lineage: {
              operationMode: 'repair', basedOnTaskId: chiefTask.logicalTaskId,
              authorInstructionVersion: lineage?.authorInstructionVersion ?? null
            },
            sourceTraces: settingContextSourceTraces(pack),
            technicalRetryTaskId: repairTask.technicalRetryTaskId
          })
        ), proposal.content);
      }
      this.requireLeaseOwnership(batch, leaseToken);
      this.repository.atomic(() => {
        this.requireLeaseOwnership(batch, leaseToken);
        const now = this.clock.now().toISOString();
        const reviewOutputId = this.saveOutput(batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'chief_review', chief.memberKey, review, [proposalOutputId], reviewTaskId);
        this.saveCandidate(
          batch.owner_id, batch.book_id, item, review, reviewOutputId, batch.batch_id, chief.memberKey,
          expectedSourceRevision
        );
        if (authorRevisionSourceTaskId !== null) {
          this.repository.markRedesignConsumed(
            batch.owner_id, batch.book_id, authorRevisionSourceTaskId, now
          );
        }
        this.repository.markJobNeedsAuthor({ ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id, outputId: reviewOutputId, now });
        this.event(batch, job, chief, 'complete', `主编已审查${job.item_label}`);
      });
    } catch (error) {
      if (error instanceof SettingLeaseLostError) throw error;
      if (isSettingPreDispatchFailure(error)) throw error;
      if (settingOutcomeUnknown(error)) throw error;
      if (error instanceof DomainError && error.code === errorCodes.bookVersionConflict) throw error;
      this.event(batch, job, chief, 'leave', '主编这次没有完成审查', undefined, error);
      this.failJob(job, '对不起，主编这次没有完成审查，编剧方案仍然保留');
    }
  }

  private async runFusionJob(
    batch: BatchRow,
    job: JobRow,
    item: V7SettingCatalogItem,
    pack: V7SettingContextPack,
    roster: readonly V7SettingMemberDefinition[],
    leaseToken: string,
    frozen: ItemFusionSource
  ): Promise<void> {
    const outputIds = normalizeOutputIds(frozen.outputIds);
    const authorNote = note(frozen.authorNote);
    const sourceTaskId = optionalIdentifier(frozen.sourceTaskId, '重新设计任务');
    if (sourceTaskId === null || typeof frozen.sourceRevision !== 'number' || !Number.isInteger(frozen.sourceRevision)) {
      throw new DomainError(errorCodes.validation, '融合任务缺少可核对的来源版本。', {}, false, 409);
    }
    const sourceRevision = frozen.sourceRevision;
    const rows = this.outputs(batch.owner_id, batch.book_id, job.item_key, outputIds);
    if (rows.length !== outputIds.length
      || rows.some((row) => row.kind !== 'writer_proposal' || row.batch_id !== sourceTaskId)) {
      throw new DomainError(errorCodes.validation, '融合候选与冻结的重新设计任务不一致。', {}, false, 409);
    }
    const sourceBatch = this.requireBatch(batch.owner_id, batch.book_id, sourceTaskId);
    const sourceState = settingRedesignTaskState(sourceBatch);
    const current = this.requireCurrentItem(batch.owner_id, batch.book_id, job.item_key);
    if (sourceState.itemKey !== job.item_key
      || sourceState.sourceRevision !== sourceRevision
      || current.revision !== sourceRevision) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '这项设定已经更新，旧方案不会覆盖当前版本。请基于当前内容重新设计。',
        {},
        false,
        409
      );
    }
    const chief = requireTaskRole(roster, 'chief_editor');
    this.repository.markJobChiefReview({
      ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id,
      outputId: rows[0]!.output_id, memberKey: chief.memberKey, now: this.clock.now().toISOString()
    });
    this.event(batch, job, chief, 'start', `${chief.displayName}正在融合${job.item_label}的多份方案`);
    const failed = this.repository.latestModelOutcomeForJob(
      batch.owner_id, batch.book_id, batch.batch_id, job.item_key, ['failed']
    );
    const logicalTaskId = `${batch.batch_id}-${job.item_key}-fusion-chief`;
    const technicalRetryTaskId = failed?.node_key === 'fusion' && failed.member_key === chief.memberKey
      ? failed.logical_task_id
      : null;
    const prompt = compileFusionPrompt(
      pack,
      rows.map((row) => parseWriterProposal(JSON.stringify(JSON.parse(row.content_json)))),
      authorNote
    );
    const raw = await this.model(
      batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'fusion', chief,
      prompt, 3_000, 0.35, technicalRetryTaskId ?? logicalTaskId,
      settingModelInvocation({
        taskKind: 'setting_review', operationMode: technicalRetryTaskId === null ? 'fusion' : 'retry',
        sourceTraces: settingContextSourceTraces(pack), technicalRetryTaskId
      })
    );
    this.requireLeaseOwnership(batch, leaseToken);
    let review: V7ChiefReview;
    let reviewTaskId = technicalRetryTaskId ?? logicalTaskId;
    try {
      review = parseChiefReview(raw);
    } catch {
      const repairTaskId = `${logicalTaskId}-repair`;
      const repairFailed = failed?.node_key === 'fusion_repair' && failed.member_key === chief.memberKey
        ? failed.logical_task_id
        : null;
      reviewTaskId = repairFailed ?? repairTaskId;
      review = parseChiefReview(await this.model(
        batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'fusion_repair', chief,
        `${prompt}\n上次输出存在空字段或JSON结构问题。只修复JSON并保留融合结果：${raw}`,
        3_000, 0.2, reviewTaskId,
        settingModelInvocation({
          taskKind: 'setting_review', operationMode: 'repair',
          lineage: { operationMode: 'repair', basedOnTaskId: logicalTaskId, authorInstructionVersion: null },
          sourceTraces: settingContextSourceTraces(pack), technicalRetryTaskId: repairFailed
        })
      ));
      this.requireLeaseOwnership(batch, leaseToken);
    }
    this.repository.atomic(() => {
      this.requireLeaseOwnership(batch, leaseToken);
      const now = this.clock.now().toISOString();
      const reviewOutputId = this.saveOutput(
        batch.owner_id, batch.book_id, batch.batch_id, job.item_key, 'fusion', chief.memberKey,
        review, outputIds, reviewTaskId
      );
      this.saveCandidate(
        batch.owner_id, batch.book_id, item, review, reviewOutputId, batch.batch_id,
        chief.memberKey, sourceRevision
      );
      this.repository.markRedesignConsumed(
        batch.owner_id, batch.book_id, sourceTaskId, now
      );
      this.repository.markJobNeedsAuthor({
        ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id,
        outputId: reviewOutputId, now
      });
      this.event(batch, job, chief, 'complete', `主编已融合${job.item_label}的多份方案`);
    });
  }

  private contextPack(ownerId: string, bookId: string, item: V7SettingCatalogItem, authorNote: string): V7SettingContextPack {
    const profile = this.profile(ownerId, bookId);
    const confirmed = this.repository.confirmedVersions(ownerId, bookId);
    const openingSummary = settingContextProfileText(profile);
    const projections = confirmed.map(confirmedSettingProjection);
    requireUsableSettingProjections(projections);
    // 相关性不能由普通程序猜。这里完整保留每一项由Agent在审查时
    // 生成的短摘要与事实账本；若总量超过硬上限，资料包会明确阻断，
    // 交给后续的语义整理节点，而不是静默裁掉作者已确认事实。
    const confirmedSettings = projections.map((projection) => ({
      itemKey: projection.itemKey,
      label: projection.label,
      content: `${projection.contextSummary}\n${projection.factEntries.map((fact) => `- ${fact}`).join('\n')}`,
      revision: projection.revision
    }));
    const sources = [
      { sourceType: 'opening_profile' as const, sourceId: bookId, version: profile.version, hash: hash(profile.openingBlueprint) },
      ...confirmedSettings.map((setting) => ({ sourceType: 'confirmed_setting' as const, sourceId: setting.itemKey, version: setting.revision, hash: hash(setting.content) })),
      ...(authorNote ? [{ sourceType: 'author_note' as const, sourceId: item.key, version: 1, hash: hash(authorNote) }] : []),
      { sourceType: 'catalog_contract' as const, sourceId: item.key, version: 1, hash: hash(item.prompt) }
    ];
    return buildSettingContextPack({ ownerId, bookId, itemKey: item.key, openingVersion: profile.version, openingSummary, confirmedSettings, authorNote, itemContract: { label: item.label, prompt: item.prompt }, sources });
  }

  private async model(ownerId: string, bookId: string, batchId: string, itemKey: string, nodeKey: string, member: ModelMember, prompt: string, maxOutputTokens: number, temperature: number, logicalTaskId: string, invocation: SettingModelInvocation): Promise<string> {
    const technicalRetry = invocation.technicalRetryTaskId !== null;
    const taskId = invocation.technicalRetryTaskId ?? logicalTaskId;
    const existing = this.repository.modelCallForLogicalTask(ownerId, bookId, taskId);
    if (!technicalRetry && existing?.state === 'succeeded' && existing.output_text !== null) return existing.output_text;
    if (!technicalRetry && existing !== undefined) {
      throw new SettingModelCallError(
        existing.failure_message ?? '调用结果未确认',
        existing.state === 'working' || existing.state === 'unknown'
      );
    }
    if (technicalRetry && existing?.state !== 'failed') {
      throw new SettingModelCallError(
        existing?.state === 'unknown' || existing?.state === 'working'
          ? '上次结果尚未确认，不能盲目重试'
          : '没有找到可以技术重试的已知失败调用',
        existing?.state === 'unknown' || existing?.state === 'working'
      );
    }
    const now = this.clock.now().toISOString();
    const promptGovernance = new V7PromptGovernanceRepository(this.database);
    promptGovernance.ensureSourceRegistrySeeded(now);
    const retrySnapshot = technicalRetry
      ? promptGovernance.runtimeBundleByTaskScope({ ownerId, bookId, taskId })
      : null;
    if (technicalRetry && retrySnapshot === null) {
      throw new SettingModelCallError('首次调用的冻结任务资料不存在，不能盲目重试');
    }
    const runtimePolicy = technicalRetry
      ? null
      : resolveV7TaskPolicy(this.database, member.memberKey, invocation.taskKind);
    const frozenPrompt = retrySnapshot === null ? prompt : runtimeSourcePrompt(retrySnapshot.contextPack.content);
    const compiled = compileV7RuntimePrompt({
      requestId: taskId,
      ownerId,
      bookId,
      taskId,
      memberKey: member.memberKey,
      runtimeRoleKey: member.roleKey,
      modelProfileKey: modelProfileKeyForBinding(member.model),
      taskKind: invocation.taskKind,
      workstationKey: 'setting',
      operationMode: technicalRetry ? 'retry' : invocation.operationMode,
      authorInstructionVersion: invocation.authorInstructionVersion,
      basedOnTaskId: invocation.basedOnTaskId,
      sourceTraces: invocation.sourceTraces,
      sourcePrompt: frozenPrompt,
      promptAssets: promptGovernance.publishedAssets(),
      genreProfile: promptGovernance.activeBookGenreProfile(ownerId, bookId),
      governanceRevision: retrySnapshot?.manifest.governanceRevision ?? promptGovernance.summary().revision,
      temperature: retrySnapshot?.manifest.temperature ?? runtimePolicy?.temperature ?? temperature,
      maxOutputTokens: retrySnapshot?.manifest.maxOutputTokens ?? maxOutputTokens,
      createdAt: now,
      ...(retrySnapshot === null ? {} : { retrySnapshot })
    });
    promptGovernance.saveRuntimeBundle(compiled);
    const executionRequestId = `${taskId}:execution:${this.ids.next()}`;
    const reserved = Math.max(8_000, compiled.manifest.compiledPrompt.length + compiled.manifest.maxOutputTokens + 2_000);
    assertMembershipAllowsGeneration(this.database, ownerId, now, reserved);
    this.repository.startModelCall({
      requestId: executionRequestId, ownerId, bookId, batchId, itemKey, nodeKey, memberKey: member.memberKey,
      provider: compiled.manifest.provider, modelId: compiled.manifest.modelId, plan: compiled.manifest.plan,
      promptHash: compiled.manifest.compiledPromptHash, reservedTokens: reserved,
      governanceRevision: compiled.manifest.governanceRevision, temperature: compiled.manifest.temperature, now
    });
    try {
      const adapter = this.adapters.resolve(compiled.manifest.provider, compiled.manifest.modelId, 'structured_planning');
      const result = await adapter.generate({ requestId: executionRequestId, taskId: batchId, ownerId, bookId, agentId: member.memberKey,
        prompt: compiled.manifest.compiledPrompt, maxOutputTokens: compiled.manifest.maxOutputTokens,
        temperature: compiled.manifest.temperature });
      if (!result.output.trim()) throw new Error('模型没有返回内容');
      const completed = this.clock.now().toISOString();
      this.repository.succeedModelCall({
        requestId: executionRequestId, ownerId, bookId, inputTokens: Math.max(0, result.inputTokens), outputTokens: Math.max(0, result.outputTokens),
        cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)), output: result.output, now: completed
      });
      return result.output;
    } catch (error) {
      const completed = this.clock.now().toISOString();
      const unknown = settingOutcomeUnknown(error);
      this.repository.failModelCall({
        requestId: executionRequestId, ownerId, bookId, state: unknown ? 'unknown' : 'failed',
        message: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000), now: completed
      });
      throw new SettingModelCallError(
        error instanceof Error ? error.message : String(error),
        unknown
      );
    }
  }

  private saveOutput(ownerId: string, bookId: string, batchId: string, itemKey: string, kind: string, memberKey: string, content: unknown, sources: string[], requestId: string): string {
    const outputId = this.ids.next();
    return this.repository.saveOutput({
      outputId, ownerId, bookId, batchId, itemKey, kind, memberKey,
      contentJson: JSON.stringify(content), sourcesJson: JSON.stringify(sources), requestId, now: this.clock.now().toISOString()
    });
  }

  private revisionLineage(
    ownerId: string,
    bookId: string,
    item: CurrentItemRow | undefined,
    authorInstructionBatchId: string | null
  ): SettingTaskLineage {
    const parent = item?.source_output_id === null || item?.source_output_id === undefined
      ? undefined
      : this.repository.outputTaskLineage(ownerId, bookId, item.source_output_id);
    const instruction = authorInstructionBatchId === null || item === undefined
      ? undefined
      : this.repository.authorInstructionForBatch(ownerId, bookId, authorInstructionBatchId, item.item_key);
    return {
      operationMode: 'revise',
      basedOnTaskId: parent?.request_id ?? null,
      authorInstructionVersion: instruction?.version ?? null
    };
  }

  private batchRevisionLineage(
    ownerId: string,
    bookId: string,
    item: CurrentItemRow | undefined,
    batchId: string
  ): SettingTaskLineage | undefined {
    if (item === undefined || this.repository.authorInstructionForBatch(ownerId, bookId, batchId, item.item_key) === undefined) {
      return undefined;
    }
    return this.revisionLineage(ownerId, bookId, item, batchId);
  }

  private saveCandidate(ownerId: string, bookId: string, item: V7SettingCatalogItem, review: V7ChiefReview, outputId: string, batchId: string, createdBy: string, expectedRevision?: number | null): void {
    const now = this.clock.now().toISOString();
    const versionId = this.ids.next();
    const saved = this.repository.saveCandidate({
      versionId, ownerId, bookId, item, contentJson: JSON.stringify(review), outputId, batchId, createdBy, now,
      ...(expectedRevision === undefined ? {} : { expectedRevision })
    });
    if (saved === null) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '这项设定在任务执行期间已经更新，本轮结果已保留在审计记录中，但不会覆盖新版本。',
        {},
        false,
        409
      );
    }
  }

  private assertCurrentRedesignSource(ownerId: string, bookId: string, state: SettingRedesignTaskState): void {
    const current = this.requireCurrentItem(ownerId, bookId, state.itemKey);
    if (current.revision !== state.sourceRevision) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '这项设定已经更新，旧的重新设计方案不会覆盖当前版本。请基于当前内容重新设计。',
        {},
        false,
        409
      );
    }
  }

  private existingSyntheticBatch(
    ownerId: string,
    bookId: string,
    idempotencyKey: string,
    requestHash: string
  ): BatchRow | undefined {
    const existing = this.repository.findBatchByIdempotency(ownerId, bookId, idempotencyKey);
    if (existing !== undefined && existing.request_hash !== requestHash) {
      throw new DomainError(errorCodes.validation, '操作编号已用于其他内容。', {}, false, 409);
    }
    return existing;
  }

  private createSyntheticBatch(
    ownerId: string,
    bookId: string,
    idempotencyKey: string,
    requestHash: string,
    item: V7SettingCatalogItem,
    state: unknown
  ): { batch: BatchRow; created: boolean } {
    const profile = this.profile(ownerId, bookId);
    const now = this.clock.now().toISOString();
    const batchId = this.ids.next();
    const inserted = this.repository.createSyntheticBatch({
      batchId, ownerId, bookId, key: idempotencyKey, requestHash, itemKey: item.key,
      customItemsJson: JSON.stringify(state), openingVersion: profile.version,
      openingHash: hash(profile.openingBlueprint), rosterJson: JSON.stringify(this.effectiveRoster()), now
    });
    // owner/book/idempotency_key 有唯一约束。INSERT OR IGNORE + 回读让
    // 两个并发同请求共用一份任务；若负载不同则仍按 hash 冲突拒绝。
    const created = this.existingSyntheticBatch(ownerId, bookId, idempotencyKey, requestHash);
    if (created === undefined) throw new Error('新建设定任务后无法回读');
    return { batch: created, created: inserted };
  }

  private replaySyntheticItem(batch: BatchRow, itemKey: string): V7SettingItemView {
    if (this.repository.hasCandidateFromBatch(batch.owner_id, batch.book_id, itemKey, batch.batch_id)) {
      if (batch.status === 'queued' || batch.status === 'working') {
        this.repository.setBatchAwaitingAuthor(
          batch.owner_id,
          batch.book_id,
          batch.batch_id,
          this.clock.now().toISOString()
        );
      }
      return this.currentItemView(batch.owner_id, batch.book_id, itemKey);
    }
    if (batch.status === 'queued' || batch.status === 'working') {
      throw new DomainError(errorCodes.validation, '这次操作正在处理，请稍后再查看。', {}, false, 409);
    }
    const failure = settingBatchFailureFromRow(batch);
    const status = batch.error_code === errorCodes.membershipRequired
      || batch.error_code === errorCodes.membershipExpired
      || batch.error_code === errorCodes.membershipQuotaExhausted
      ? 403
      : batch.retry_safety === 'technical_retry'
        ? 503
        : 409;
    throw new DomainError(
      batch.error_code ?? errorCodes.operationIncomplete,
      `${failure}当前没有可回放的有效结果。`,
      {},
      status === 503,
      status
    );
  }

  private redesignTaskView(batch: BatchRow): V7SettingRedesignTaskView {
    const state = settingRedesignTaskState(batch);
    const outputRows = this.repository.outputsForBatchItem(
      batch.owner_id,
      batch.book_id,
      batch.batch_id,
      state.itemKey,
      'writer_proposal'
    );
    const outputByMember = new Map(outputRows.map((output) => [output.member_key, output]));
    const completed = state.memberKeys.filter((memberKey) => outputByMember.has(memberKey));
    const terminal = batch.status === 'awaiting_author' || batch.status === 'completed' || batch.status === 'partially_failed';
    const status: V7SettingRedesignTaskView['status'] = batch.status === 'awaiting_author' || batch.status === 'completed'
      ? 'ready'
      : batch.status === 'partially_failed'
        ? 'failed'
        : batch.status;
    const candidates = status === 'ready' || status === 'failed'
      ? state.memberKeys.flatMap((memberKey) => {
        const output = outputByMember.get(memberKey);
        if (output === undefined) return [];
        return [{
          outputId: output.output_id,
          memberKey,
          proposal: authorProposal(parseWriterProposal(output.content_json))
        }];
      })
      : [];
    return {
      taskId: batch.batch_id,
      status,
      statusText: status === 'queued'
        ? '正在安排编剧'
        : status === 'working'
          ? '编剧正在重新设计这项设定'
          : status === 'ready'
            ? '新方案已经整理好，请您看看'
            : settingBatchFailureFromRow(batch) + '已有内容不会丢失。',
      progress: {
        completed: completed.length,
        total: state.memberKeys.length,
        percent: terminal
          ? 100
          : Math.round(completed.length * 100 / Math.max(1, state.memberKeys.length))
      },
      candidates,
      failedMemberKeys: terminal
        ? state.memberKeys.filter((memberKey) => !outputByMember.has(memberKey))
        : [],
      retryable: status === 'failed'
        && (batch.retry_safety === 'safe_after_precondition' || batch.retry_safety === 'technical_retry'),
      createdAt: batch.created_at,
      updatedAt: batch.updated_at
    };
  }

  private failSyntheticBatch(batch: BatchRow, error: unknown): void {
    const failure = settingBatchFailure(error);
    this.repository.failSyntheticBatch({
      ownerId: batch.owner_id,
      bookId: batch.book_id,
      batchId: batch.batch_id,
      message: failure.storedMessage,
      code: failure.code,
      stage: failure.stage,
      retrySafety: failure.retrySafety,
      now: this.clock.now().toISOString()
    });
  }

  private markWorking(job: JobRow, member: V7SettingMemberDefinition): string[] {
    const attempted = [...new Set([...(JSON.parse(job.attempted_members_json) as string[]), member.memberKey])];
    this.repository.markJobWorking({
      ownerId: job.owner_id, bookId: job.book_id, jobId: job.job_id, memberKey: member.memberKey,
      attemptedJson: JSON.stringify(attempted), attemptCount: attempted.length, manifestJson: job.context_manifest_json,
      contextHash: job.context_hash, now: this.clock.now().toISOString()
    });
    this.event({ batch_id: job.batch_id, owner_id: job.owner_id, book_id: job.book_id } as BatchRow, job, member, 'start', `${member.displayName}正在设计${job.item_label}`);
    job.attempted_members_json = JSON.stringify(attempted); job.assigned_member_key = member.memberKey;
    return attempted;
  }

  private failJob(job: JobRow, message: string): void {
    this.repository.markJobFailed(job.owner_id, job.book_id, job.job_id, this.clock.now().toISOString());
    void message;
  }

  private event(batch: BatchRow, job: JobRow, member: V7SettingMemberDefinition, type: 'start'|'complete'|'leave'|'handoff'|'return', message: string, handoffTo?: string, error?: unknown): void {
    this.repository.insertMemberEvent({
      eventId: this.ids.next(), ownerId: batch.owner_id, bookId: batch.book_id, batchId: batch.batch_id,
      itemKey: job.item_key, memberKey: member.memberKey, eventType: type, handoffTo: handoffTo ?? null,
      publicMessage: message, internalReason: error instanceof Error ? error.message.slice(0, 1_000) : error === undefined ? null : String(error).slice(0, 1_000),
      now: this.clock.now().toISOString()
    });
  }

  private effectiveRoster(): V7SettingMemberDefinition[] {
    return this.settingRoster().filter((member) => {
      const row = this.repository.memberSetting(member.memberKey);
      return member.enabledByDefault && row?.enabled !== 0;
    }).map((member) => ({ ...member, model: { ...member.model } }));
  }

  private executableSettingRoster(batch: BatchRow): V7SettingMemberDefinition[] {
    try {
      return resolveSettingTaskRoster(batch.roster_json, this.effectiveRoster());
    } catch {
      throw new DomainError(
        errorCodes.validation,
        '这是一轮历史设定任务，已保存内容仍会保留，但不能再用旧成员或旧模型继续。请重新发起当前任务。',
        {},
        false,
        409
      );
    }
  }

  private executableRecommendationChief(task: BatchRow): V7OpeningMemberDefinition {
    try {
      return resolveOpeningChiefTaskSnapshot(task.roster_json, this.openingRoster())[0]!;
    } catch {
      throw new DomainError(
        errorCodes.validation,
        '这是一轮历史设定清单，已保存结果仍会保留，但不能再用旧主编或旧模型继续。请重新整理。',
        {},
        false,
        409
      );
    }
  }

  private requireRole(role: V7SettingMemberDefinition['roleKey']): V7SettingMemberDefinition {
    const member = this.effectiveRoster().find((entry) => entry.roleKey === role);
    if (member === undefined) throw new DomainError(errorCodes.validation, `${role === 'chief_editor' ? '主编' : '副编'}当前请假中。`, {}, false, 409);
    return member;
  }

  private membersView(ownerId: string, bookId: string, batchId: string | null): V7SettingMemberPublicView[] {
    const jobs = batchId === null ? [] : this.jobs(ownerId, bookId, batchId);
    const events = this.repository.memberEvents(ownerId, bookId, batchId);
    const enabled = new Set(this.effectiveRoster().map((member) => member.memberKey));
    const roster = this.settingRoster();
    return roster.map((member) => {
      const current = jobs.find((job) => job.assigned_member_key === member.memberKey && (job.state === 'working' || job.state === 'chief_review'));
      // 旧实现把会员前置门禁误记成成员“请假/交接”。这些记录必须保留审计，
      // 但不能继续改变当前名册，否则作者补充额度后仍会看到整个团队永久离岗。
      const last = [...events].reverse().find((event) =>
        event.member_key === member.memberKey && !legacyMembershipGateMemberEvent(event.internal_reason)
      );
      const leave = !enabled.has(member.memberKey) || last?.event_type === 'leave' || last?.event_type === 'handoff';
      const handoffName = last?.handoff_to_member_key === null || last?.handoff_to_member_key === undefined ? null : roster.find((entry) => entry.memberKey === last.handoff_to_member_key)?.displayName ?? null;
      const completedCount = this.repository.completedWriterCount(ownerId, bookId, member.memberKey);
      return {
        memberKey: member.memberKey, displayName: member.displayName,
        role: member.roleKey === 'chief_editor' ? '主编' : member.roleKey === 'deputy_editor' ? '副编' : '编剧',
        presence: leave ? 'leave' : current === undefined ? 'ready' : 'working',
        statusText: leave
          ? handoffName === null ? '亲爱的，我今天请假啦' : `我先请假啦，已经交给${handoffName}继续`
          : current === undefined
            ? last?.event_type === 'leave' ? '我已经返岗，随时可以接单' : '我在这儿，随时可以接单'
            : member.roleKey === 'chief_editor'
              ? `老板稍等，我正在检查${current.item_label}`
              : member.roleKey === 'deputy_editor'
                ? `我正在整理${current.item_label}需要的资料`
                : `亲爱的，我正在加急设计${current.item_label}`,
        currentItem: current?.item_label ?? null, handoffTo: handoffName, completedCount
      };
    });
  }

  private toView(batch: BatchRow): V7SettingBatchView {
    const current = this.requireBatch(batch.owner_id, batch.book_id, batch.batch_id);
    const jobs = this.jobs(batch.owner_id, batch.book_id, batch.batch_id);
    const done = jobs.filter((job) => job.state === 'needs_author' || job.state === 'confirmed').length;
    const failedJobs = jobs.filter((job) => job.state === 'failed');
    const legacyMembershipGate = current.status === 'partially_failed'
      && current.failure_stage === null
      && current.retry_safety === null
      && !this.repository.hasUnsettledModelCalls(current.owner_id, current.book_id, current.batch_id)
      && this.repository.memberEvents(current.owner_id, current.book_id, current.batch_id)
        .some((event) => legacyMembershipGateMemberEvent(event.internal_reason));
    const knownFailedCalls = failedJobs.length > 0 && failedJobs.every((job) => (
      this.repository.latestModelOutcomeForJob(
        current.owner_id, current.book_id, current.batch_id, job.item_key, ['failed']
      ) !== undefined
    ));
    const retryable = current.status === 'partially_failed' && failedJobs.length > 0 && (
      legacyMembershipGate
      || (current.failure_stage === 'pre_dispatch' && current.retry_safety === 'safe_after_precondition')
      || (current.retry_safety === 'technical_retry' && knownFailedCalls)
      || (current.failure_stage === null && current.retry_safety === null && knownFailedCalls)
    );
    const restartable = current.status === 'partially_failed'
      && !retryable
      && !this.repository.hasUnsettledModelCalls(current.owner_id, current.book_id, current.batch_id)
      && (current.retry_safety === 'manual_redesign'
        || (current.failure_stage === null && current.retry_safety === null))
      && failedJobs.some((job) => this.repository.currentItem(
        current.owner_id, current.book_id, job.item_key
      )?.active_version_id == null);
    return {
      batchId: current.batch_id, status: current.status,
      statusText: settingBatchStatusText(current, done),
      progress: { completed: done, total: jobs.length, percent: jobs.length === 0 ? 0 : Math.round(done * 100 / jobs.length) },
      members: this.membersView(batch.owner_id, batch.book_id, batch.batch_id), items: jobs.map((job) => this.jobView(job)),
      retryable,
      restartable,
      createdAt: current.created_at, updatedAt: current.updated_at
    };
  }

  private jobView(job: JobRow): V7SettingItemView {
    const item = this.repository.currentItem(job.owner_id, job.book_id, job.item_key);
    if (item === undefined || item.active_version_id === null) return { itemKey: job.item_key, label: job.item_label, groupTitle: job.group_title, state: job.state, stateText: stateText(job.state), assignedMemberKey: job.assigned_member_key, content: null, designRationale: null, storyConsequences: [], issues: [], suggestions: [], revision: 0 };
    return this.currentItemView(job.owner_id, job.book_id, job.item_key, job.state, job.assigned_member_key);
  }

  private currentItems(ownerId: string, bookId: string): V7SettingItemView[] {
    return this.repository.itemKeys(ownerId, bookId).map((itemKey) => this.currentItemView(ownerId, bookId, itemKey));
  }

  private currentSettingProjections(
    ownerId: string,
    bookId: string,
    items: readonly V7SettingItemView[]
  ): ReturnType<typeof confirmedSettingProjection>[] {
    return items.map((item) => {
      const current = this.requireCurrentItem(ownerId, bookId, item.itemKey);
      const version = this.repository.versionContent(ownerId, bookId, current.active_version_id);
      if (version === undefined) throw new Error(`设定“${item.label}”当前版本不存在`);
      return confirmedSettingProjection({
        item_key: item.itemKey,
        item_label: item.label,
        version_id: current.active_version_id,
        revision: current.revision,
        content_json: version.content_json
      });
    });
  }

  private currentFinalReview(
    ownerId: string,
    bookId: string,
    profile: BookProfileView,
    items: readonly V7SettingItemView[],
    requestHash: string
  ): BatchRow | undefined {
    const exact = this.repository.latestFinalReview(ownerId, bookId, requestHash);
    if (exact !== undefined) return exact;
    const latest = this.repository.latestFinalReview(ownerId, bookId);
    return latest !== undefined && this.finalReviewMatchesCurrent(latest, profile, items, requestHash)
      ? latest
      : undefined;
  }

  private finalReviewMatchesCurrent(
    row: BatchRow,
    profile: BookProfileView,
    items: readonly V7SettingItemView[],
    requestHash = finalReviewRequestHash(profile, items)
  ): boolean {
    if (row.request_hash === requestHash) return true;
    if (row.status !== 'awaiting_author' && row.status !== 'completed') return false;
    const stored = parseFinalReviewStoredResult(row.selected_items_json);
    if (stored === null) return false;
    if (stored.resultHash !== null) return stored.resultHash === requestHash;
    // Compatibility for the first local review created before resultHash was
    // persisted. It is current only when the opening profile is unchanged and
    // no setting item was edited after that task completed.
    if (row.opening_version !== profile.version || row.opening_hash !== hash(profile.openingBlueprint)) return false;
    const latestItemUpdate = this.repository.latestSettingItemUpdatedAt(row.owner_id, row.book_id);
    return latestItemUpdate !== null && Date.parse(latestItemUpdate) <= Date.parse(row.updated_at);
  }

  private currentItemView(ownerId: string, bookId: string, itemKey: string, jobState?: V7SettingItemView['state'], assignedMemberKey: string | null = null): V7SettingItemView {
    const item = this.requireCurrentItem(ownerId, bookId, itemKey);
    const version = this.repository.versionContent(ownerId, bookId, item.active_version_id);
    if (version === undefined) throw new DomainError(errorCodes.validation, '设定版本不存在或不属于本书。', {}, false, 404);
    const content = JSON.parse(version.content_json) as Partial<V7ChiefReview & V7WriterProposal>;
    const state = jobState ?? (item.state === 'confirmed' ? 'confirmed' : 'needs_author');
    const finalContent = content.finalContent ?? content.content ?? null;
    return {
      itemKey, label: item.item_label, groupTitle: item.group_title, state, stateText: stateText(state), assignedMemberKey,
      content: finalContent === null ? null : projectSettingFinalContent(finalContent),
      designRationale: content.designRationale === undefined ? null : sanitizeAuthorFacingSettingText(content.designRationale),
      storyConsequences: (content.storyConsequences ?? []).map(sanitizeAuthorFacingSettingText).filter(Boolean),
      issues: (content.issues ?? []).map((issue) => ({
        problem: sanitizeAuthorFacingSettingText(issue.problem),
        impact: sanitizeAuthorFacingSettingText(issue.impact),
        suggestion: sanitizeAuthorFacingSettingText(issue.suggestion)
      })),
      suggestions: (content.suggestions ?? []).map(sanitizeAuthorFacingSettingText).filter(Boolean), revision: item.revision
    };
  }

  private requireCurrentItem(ownerId: string, bookId: string, itemKey: string): CurrentItemRow {
    const row = this.repository.currentItem(ownerId, bookId, itemKey);
    if (row === undefined || row.active_version_id === null) throw new DomainError(errorCodes.validation, '设定条目不存在或不属于本书。', {}, false, 404);
    return row;
  }

  private latestBatch(ownerId: string, bookId: string): BatchRow | undefined { return this.repository.latestEditorialBatch(ownerId, bookId); }
  private requireBatch(ownerId: string, bookId: string, batchId: string): BatchRow { const row = this.repository.batch(ownerId, bookId, batchId); if (row === undefined) throw new DomainError(errorCodes.validation, '设定任务不存在或不属于本书。', {}, false, 404); return row; }
  private requireFinalReview(ownerId: string, bookId: string, taskId: string): BatchRow { const row = this.repository.finalReview(ownerId, bookId, taskId); if (row === undefined) throw new DomainError(errorCodes.validation, '统一整理任务不存在或不属于本书。', {}, false, 404); return row; }
  private jobs(ownerId: string, bookId: string, batchId: string): JobRow[] { return this.repository.jobs(ownerId, bookId, batchId); }
  private outputs(ownerId: string, bookId: string, itemKey: string, ids: string[]): OutputRow[] { return this.repository.outputs(ownerId, bookId, itemKey, ids); }
  private profile(ownerId: string, bookId: string): BookProfileView { return new BookProfileViewService(this.database).get({ ownerId, bookId }); }
}

function settingModelInvocation(input: {
  taskKind: V7AgentTaskKind;
  operationMode: V7TaskOperationMode;
  lineage?: SettingTaskLineage;
  sourceTraces?: readonly V7ContextSourceTrace[];
  technicalRetryTaskId?: string | null;
}): SettingModelInvocation {
  return {
    taskKind: input.taskKind,
    operationMode: input.operationMode,
    basedOnTaskId: input.lineage?.basedOnTaskId ?? null,
    authorInstructionVersion: input.lineage?.authorInstructionVersion ?? null,
    sourceTraces: input.sourceTraces ?? [],
    technicalRetryTaskId: input.technicalRetryTaskId ?? null
  };
}

function settingContextSourceTraces(pack: V7SettingContextPack): V7ContextSourceTrace[] {
  return pack.sources.map((source) => {
    const detail = source.sourceType === 'opening_profile'
      ? pack.openingSummary
      : source.sourceType === 'confirmed_setting'
        ? pack.confirmedSettings.find((item) => item.itemKey === source.sourceId)?.content ?? ''
        : source.sourceType === 'author_note'
          ? pack.authorNote
          : pack.itemContract.prompt;
    return {
      ownerId: pack.ownerId,
      bookId: pack.bookId,
      sourceKey: `${source.sourceType}:${source.sourceId}`,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceVersion: String(source.version),
      authority: source.sourceType === 'author_note'
        ? 'author_source'
        : source.sourceType === 'catalog_contract'
          ? 'reference'
          : 'confirmed',
      decision: 'included',
      reason: source.sourceType === 'author_note'
        ? '作者本轮明确补充，必须参与本次设定判断。'
        : source.sourceType === 'catalog_contract'
          ? '当前设定条目的职责边界。'
          : '当前书籍已经确认的正式资料。',
      contentHash: source.hash,
      estimatedTokens: estimateSettingTokens(detail)
    };
  });
}

function openingProfileSourceTrace(ownerId: string, bookId: string, profile: BookProfileView): V7ContextSourceTrace {
  const content = JSON.stringify(recommendationOpeningProfile(profile));
  return {
    ownerId,
    bookId,
    sourceKey: `opening_profile:${bookId}`,
    sourceType: 'opening_profile',
    sourceId: bookId,
    sourceVersion: String(profile.version),
    authority: 'confirmed',
    decision: 'included',
    reason: '主编必须根据当前正式开书资料整理设定清单。',
    contentHash: hash(content),
    estimatedTokens: estimateSettingTokens(content)
  };
}

function estimateSettingTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}

function finalReviewRequestHash(profile: BookProfileView, items: readonly V7SettingItemView[]): string {
  return hash({
    taskKind: 'batch_final_review',
    contractVersion: SETTING_FINAL_REVIEW_CONTRACT_VERSION,
    openingVersion: profile.version,
    openingHash: hash(profile.openingBlueprint),
    items: items.toSorted((left, right) => left.itemKey.localeCompare(right.itemKey)).map((item) => ({
      itemKey: item.itemKey,
      revision: item.revision,
      content: item.content,
      issues: item.issues
    }))
  });
}

function compileBatchFinalReviewPrompt(
  profile: BookProfileView,
  items: readonly V7SettingItemView[],
  projections: readonly ReturnType<typeof confirmedSettingProjection>[]
): { prompt: string; allowPatches: boolean } {
  const common = {
    operation: 'v7_setting_batch_final_review_v1',
    responsibility: '作为本书设定总审主编，跨条目统一核对全部候选设定。只修复明确冲突和影响后续检索的歧义，不重写已经优秀且一致的内容。',
    confirmedOpeningProfile: recommendationOpeningProfile(profile),
    reviewOrder: [
      '先核对作者原意、主角身份、时代、题材与明确禁项。',
      '再核对同一人物、组织、职位、地名、规则、数量、时间和权限是否前后一致。',
      '再核对每项颗粒度是否足够支撑后续规划，同时没有提前写死具体卷内事件。',
      '有冲突时选择对整本书最稳妥的一套表达，并只返回真正需要改动的条目。'
    ],
    hardRules: [
      '不能把候选计划、可能情节或主编推测写成已经发生的事实。',
      '不能新增开书资料没有授权的系统、超能力、游戏、修仙、后宫或其他题材。',
      '不能用空泛大词替换原有具体有效信息。',
      '无法根据现有资料决定的价值选择必须保留给作者，并在issues中说明；可以统一的术语和逻辑冲突由主编直接统一。',
      'patches只能包含发生实质改动的条目；未改条目不要重复返回。',
      '只返回JSON，不要解释过程。'
    ],
    outputSchema: {
      verdict: 'pass或needs_author',
      summary: '给作者看的统一整理结论，120字以内',
      contextSummary: '供后续规划先读取的全书设定摘要，300字以内，不新增事实',
      factLedger: [{ itemKey: '条目键', label: '条目名称', facts: ['从该条目完整正文逐条提取的硬事实'] }],
      groupSummaries: [{ groupTitle: '分组名称', summary: '本组关键边界，200字以内', itemKeys: ['该组条目键'] }],
      unifiedDecisions: [{ topic: '统一了什么', decision: '采用的统一表达', reason: '为什么' }],
      conflicts: [{ itemKeys: ['涉及条目键'], problem: '冲突', decision: '如何统一', impact: '不统一会影响什么' }],
      patches: [{
        itemKey: '必须来自currentSettingCandidates.itemKey',
        finalContent: '统一后的完整条目正文，不能只返回差异',
        summary: '本项改了什么',
        contextSummary: '修改后供检索的一句话摘要',
        factEntries: ['修改后从finalContent提取的硬事实'],
        issues: [{ problem: '仍需作者决定的问题', impact: '影响', suggestion: '建议' }],
        suggestions: ['补充建议；没有则空数组']
      }]
    }
  };
  const exactPayload = {
    ...common,
    reviewInputMode: 'exact_current_items',
    currentSettingCandidates: items.map((item) => ({
      itemKey: item.itemKey,
      label: item.label,
      groupTitle: item.groupTitle,
      revision: item.revision,
      content: item.content,
      existingIssues: item.issues
    }))
  };
  const exactPrompt = JSON.stringify(exactPayload);
  if (Array.from(exactPrompt).length <= 12_000) return { prompt: exactPrompt, allowPatches: true };

  const projectionByKey = new Map(projections.map((projection) => [projection.itemKey, projection]));
  const compactPayload = {
    ...common,
    reviewInputMode: 'layered_semantic_index',
    responsibility: `${common.responsibility} 当前条目较多，本轮只读取各条目设计时同步生成的语义索引，完整原文保留在逐项版本中。`,
    currentSettingCandidates: items.map((item) => {
      const projection = projectionByKey.get(item.itemKey);
      if (projection === undefined) throw new Error(`设定“${item.label}”缺少当前语义索引`);
      return {
        itemKey: item.itemKey,
        label: item.label,
        groupTitle: item.groupTitle,
        revision: item.revision,
        contextSummary: projection.contextSummary,
        existingIssues: item.issues
      };
    }),
    compactModeRules: [
      '本轮负责全书级统一、分组摘要和冲突定位，不凭摘要重写任何完整条目。',
      'patches必须返回空数组；发现需要改原文的问题时放入conflicts，交回对应条目单独处理。',
      'factLedger每项只摘录contextSummary已经明确表达的1至4条核心事实，不能补猜。'
    ]
  };
  const compactPrompt = JSON.stringify(compactPayload);
  const compactCharacters = Array.from(compactPrompt).length;
  if (compactCharacters > 12_000) {
    throw new Error(`设定总审轻量索引仍有${compactCharacters}字，超过12000字安全范围`);
  }
  return { prompt: compactPrompt, allowPatches: false };
}

function compileBatchFinalReviewPatchPrompts(
  profile: BookProfileView,
  items: readonly V7SettingItemView[],
  review: FinalReviewModelResult
): Array<{ itemKeys: string[]; prompt: string }> {
  const affectedKeys = [...new Set(review.conflicts.flatMap((conflict) => conflict.itemKeys))];
  const affected = affectedKeys.map((itemKey) => {
    const item = items.find((candidate) => candidate.itemKey === itemKey);
    if (item === undefined || item.content === null) throw new Error('设定总审冲突引用了没有正文的条目');
    return item;
  });
  const build = (group: readonly V7SettingItemView[]): string => JSON.stringify({
    operation: 'v7_setting_batch_final_review_patch_v1',
    responsibility: '作为本书设定总审主编，根据已经完成的全书级冲突判断，把本组受影响条目真正改回正文。只修复列明的冲突，不扩写剧情，不改变作者原意。',
    confirmedOpeningProfile: recommendationOpeningProfile(profile),
    unifiedDecisions: review.unifiedDecisions,
    conflicts: review.conflicts.filter((conflict) => conflict.itemKeys.some((itemKey) => group.some((item) => item.itemKey === itemKey))),
    affectedItems: group.map((item) => ({
      itemKey: item.itemKey,
      label: item.label,
      groupTitle: item.groupTitle,
      currentContent: item.content,
      existingIssues: item.issues
    })),
    hardRules: [
      'patches必须逐项完整覆盖affectedItems，不能遗漏，也不能返回其他条目。',
      'finalContent必须是改好后的完整正文，不能只给差异或一句决定。',
      '即使某个条目已经采用最终口径，也要原样保留有效内容并返回完整正文，确保本组结果可原子核对。',
      '统一名称、数值与权限时要同步修正同一条目里的所有关联表达，不能只改第一处。',
      '保留原条目中不冲突的具体信息、硬约束、代价与检索事实；不能把详细内容缩成空泛摘要。',
      '现有资料无法决定的价值选择继续放在issues中，不得替作者拍板。',
      '只返回JSON，不要解释过程。'
    ],
    outputSchema: {
      patches: [{
        itemKey: '必须来自affectedItems.itemKey',
        finalContent: '统一后的完整条目正文，2000字以内',
        summary: '本项实际改了什么',
        contextSummary: '供后续检索的一句话摘要',
        factEntries: ['从finalContent逐条提取的硬事实'],
        issues: [{ problem: '仍需作者决定的问题', impact: '影响', suggestion: '建议' }],
        suggestions: ['非阻断补充建议；没有则空数组']
      }]
    }
  });
  const groups: V7SettingItemView[][] = [];
  let current: V7SettingItemView[] = [];
  for (const item of affected) {
    const candidate = [...current, item];
    if (current.length > 0 && (candidate.length > FINAL_REVIEW_PATCH_GROUP_SIZE
      || Array.from(build(candidate)).length > FINAL_REVIEW_PATCH_PROMPT_LIMIT)) {
      groups.push(current);
      current = [item];
    } else {
      current = candidate;
    }
    if (Array.from(build(current)).length > FINAL_REVIEW_PATCH_PROMPT_LIMIT) {
      throw new Error(`设定“${item.label}”的定向修订资料仍超过${FINAL_REVIEW_PATCH_PROMPT_LIMIT}字安全范围`);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.map((group) => ({ itemKeys: group.map((item) => item.itemKey), prompt: build(group) }));
}

function parseBatchFinalReviewPatchGroup(raw: string, expectedItemKeys: readonly string[]): FinalReviewPatch[] {
  const value = parseStructuredObject(raw, '设定总审定向修订结果');
  const allowed = new Set(expectedItemKeys);
  const seen = new Set<string>();
  const patches = finalObjectArray(value.patches, '定向修订条目').map((entry): FinalReviewPatch => {
    const itemKey = requiredText(entry.itemKey, '定向修订条目键', 1, 160);
    if (!allowed.has(itemKey) || seen.has(itemKey)) throw new Error('定向修订条目重复或不属于本组');
    seen.add(itemKey);
    const issues = finalObjectArray(entry.issues, '待决定问题').map((issue) => ({
      problem: requiredText(issue.problem, '待决定问题', 1, 500),
      impact: requiredText(issue.impact, '问题影响', 1, 500),
      suggestion: requiredText(issue.suggestion, '处理建议', 1, 500)
    }));
    const finalContent = requiredText(entry.finalContent, '统一后内容', 1, 2_000);
    return {
      itemKey,
      finalContent,
      summary: requiredText(entry.summary, '修订摘要', 1, 500),
      contextSummary: requiredText(entry.contextSummary ?? entry.summary, '修订检索摘要', 1, 300),
      factEntries: Array.isArray(entry.factEntries) && entry.factEntries.length > 0
        ? finalStringArray(entry.factEntries, '修订设定事实', 1, 24)
        : [finalContent],
      issues,
      suggestions: finalStringArray(entry.suggestions, '补充建议', 0, 12)
    };
  });
  if (patches.length !== expectedItemKeys.length || expectedItemKeys.some((itemKey) => !seen.has(itemKey))) {
    throw new Error('设定总审定向修订没有完整覆盖本组冲突条目');
  }
  return patches;
}

function batchFinalReviewSourceTraces(
  ownerId: string,
  bookId: string,
  profile: BookProfileView,
  items: readonly V7SettingItemView[]
): V7ContextSourceTrace[] {
  return [openingProfileSourceTrace(ownerId, bookId, profile), ...items.map((item): V7ContextSourceTrace => ({
    ownerId,
    bookId,
    sourceKey: `setting_candidate:${item.itemKey}`,
    sourceType: 'setting_candidate',
    sourceId: item.itemKey,
    sourceVersion: String(item.revision),
    authority: item.state === 'confirmed' ? 'confirmed' : 'candidate',
    decision: 'included',
    reason: '统一整理必须核对当前可见的全部设定条目。',
    contentHash: hash(item.content ?? ''),
    estimatedTokens: estimateSettingTokens(item.content ?? '')
  }))];
}

function parseBatchFinalReview(
  raw: string,
  items: readonly V7SettingItemView[],
  allowPatches = true
): FinalReviewModelResult {
  const value = parseStructuredObject(raw, '设定统一整理结果');
  const verdict = value.verdict === 'pass' || value.verdict === 'needs_author' ? value.verdict : null;
  if (verdict === null) throw new Error('设定统一整理没有返回有效结论');
  const allowed = new Set(items.map((item) => item.itemKey));
  const contextSummary = requiredText(value.contextSummary ?? value.summary, '全书设定摘要', 1, 600);
  const hasProvidedFactLedger = Array.isArray(value.factLedger) && value.factLedger.length > 0;
  const rawFactLedger = hasProvidedFactLedger
    ? finalObjectArray(value.factLedger, '设定事实账本')
    : items.map((item) => ({ itemKey: item.itemKey, label: item.label, facts: [item.content ?? ''] }));
  const factLedger = rawFactLedger.map((entry) => {
    const itemKey = requiredText(entry.itemKey, '事实条目键', 1, 160);
    if (!allowed.has(itemKey)) throw new Error('设定事实账本引用了不存在的条目');
    const item = items.find((candidate) => candidate.itemKey === itemKey)!;
    return {
      itemKey,
      label: requiredText(entry.label ?? item.label, '事实条目名称', 1, 160),
      facts: hasProvidedFactLedger
        ? finalStringArray(entry.facts, '设定事实', 1, 24)
        : [requiredText((entry.facts as unknown[])[0], '历史设定事实', 1, 2_000)]
    };
  });
  if (factLedger.length !== items.length || new Set(factLedger.map((entry) => entry.itemKey)).size !== items.length) {
    throw new Error('设定事实账本没有完整覆盖当前设定');
  }
  const fallbackGroups = [...new Set(items.map((item) => item.groupTitle))].map((groupTitle) => ({
    groupTitle,
    summary: items.filter((item) => item.groupTitle === groupTitle).map((item) => item.label).join('、'),
    itemKeys: items.filter((item) => item.groupTitle === groupTitle).map((item) => item.itemKey)
  }));
  const groupSummaries = (Array.isArray(value.groupSummaries) && value.groupSummaries.length > 0
    ? finalObjectArray(value.groupSummaries, '设定分组摘要')
    : fallbackGroups).map((entry) => {
    const itemKeys = finalStringArray(entry.itemKeys, '分组条目', 1, 40);
    if (itemKeys.some((key) => !allowed.has(key))) throw new Error('设定分组摘要引用了不存在的条目');
    return {
      groupTitle: requiredText(entry.groupTitle, '设定分组', 1, 160),
      summary: requiredText(entry.summary, '分组摘要', 1, 500),
      itemKeys
    };
  });
  const unifiedDecisions = finalObjectArray(value.unifiedDecisions, '统一决定').map((entry) => ({
    topic: requiredText(entry.topic, '统一主题', 1, 100),
    decision: requiredText(entry.decision, '统一决定', 1, 500),
    reason: requiredText(entry.reason, '统一理由', 1, 500)
  }));
  const conflicts = finalObjectArray(value.conflicts, '冲突清单').map((entry) => {
    const itemKeys = finalStringArray(entry.itemKeys, '冲突条目', 1, 20);
    if (itemKeys.some((key) => !allowed.has(key))) throw new Error('冲突清单引用了不存在的设定条目');
    return {
      itemKeys,
      problem: requiredText(entry.problem, '冲突问题', 1, 500),
      decision: requiredText(entry.decision, '冲突决定', 1, 500),
      impact: requiredText(entry.impact, '冲突影响', 1, 500)
    };
  });
  const seen = new Set<string>();
  const patches = finalObjectArray(value.patches, '修订条目').map((entry): FinalReviewPatch => {
    const itemKey = requiredText(entry.itemKey, '修订条目键', 1, 160);
    if (!allowed.has(itemKey) || seen.has(itemKey)) throw new Error('修订条目重复或不属于本书');
    seen.add(itemKey);
    const issues = finalObjectArray(entry.issues, '待决定问题').map((issue) => ({
      problem: requiredText(issue.problem, '待决定问题', 1, 500),
      impact: requiredText(issue.impact, '问题影响', 1, 500),
      suggestion: requiredText(issue.suggestion, '处理建议', 1, 500)
    }));
    return {
      itemKey,
      finalContent: requiredText(entry.finalContent, '统一后内容', 1, 2_000),
      summary: requiredText(entry.summary, '修订摘要', 1, 500),
      contextSummary: requiredText(entry.contextSummary ?? entry.summary, '修订检索摘要', 1, 300),
      factEntries: Array.isArray(entry.factEntries) && entry.factEntries.length > 0
        ? finalStringArray(entry.factEntries, '修订设定事实', 1, 24)
        : [requiredText(entry.finalContent, '统一后内容', 1, 2_000)],
      issues,
      suggestions: finalStringArray(entry.suggestions, '补充建议', 0, 12)
    };
  });
  if (!allowPatches && patches.length > 0) throw new Error('轻量总审不能直接改写完整设定条目');
  if (new Set(groupSummaries.flatMap((entry) => entry.itemKeys)).size !== items.length) {
    throw new Error('设定分组摘要没有完整覆盖当前设定');
  }
  return {
    verdict,
    summary: requiredText(value.summary, '统一整理摘要', 1, 500),
    contextSummary,
    factLedger,
    groupSummaries,
    unifiedDecisions,
    conflicts,
    patches
  };
}

function finalObjectArray(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 40 || value.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))) {
    throw new Error(`${label}格式不正确`);
  }
  return value as Array<Record<string, unknown>>;
}

function finalStringArray(value: unknown, label: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${label}数量不正确`);
  return value.map((entry) => requiredText(entry, label, 1, 500));
}

function finalReviewState(row: BatchRow): FinalReviewState {
  const parsed = JSON.parse(row.custom_items_json) as Partial<FinalReviewState>;
  if (parsed.taskKind !== 'batch_final_review') throw new Error('统一整理任务状态损坏');
  return {
    taskKind: 'batch_final_review',
    phase: parsed.phase ?? 'preparing',
    progress: Number.isFinite(parsed.progress) ? Number(parsed.progress) : 0,
    assignedMemberKey: typeof parsed.assignedMemberKey === 'string' ? parsed.assignedMemberKey : null,
    attemptedMemberKeys: Array.isArray(parsed.attemptedMemberKeys) ? parsed.attemptedMemberKeys.filter((key): key is string => typeof key === 'string') : [],
    publicMessage: typeof parsed.publicMessage === 'string' ? parsed.publicMessage : '主编正在准备统一整理。'
  };
}

function settingRedesignTaskState(row: BatchRow): SettingRedesignTaskState {
  let value: Partial<SettingRedesignTaskState>;
  try {
    value = JSON.parse(row.custom_items_json) as Partial<SettingRedesignTaskState>;
  } catch {
    throw new DomainError(errorCodes.validation, '这是一轮旧的重新设计任务，已有内容仍会保留，请重新发起。', {}, false, 409);
  }
  const lineage = value.lineage as Partial<SettingTaskLineage> | undefined;
  if (
    value.taskKind !== 'item_redesign'
    || typeof value.itemKey !== 'string'
    || !Array.isArray(value.memberKeys)
    || value.memberKeys.length < 1
    || value.memberKeys.length > 3
    || value.memberKeys.some((memberKey) => typeof memberKey !== 'string')
    || typeof value.authorNote !== 'string'
    || typeof value.sourceRevision !== 'number'
    || !Number.isInteger(value.sourceRevision)
    || value.sourceRevision < 0
    || typeof value.currentContent !== 'string'
    || lineage === undefined
    || typeof lineage.operationMode !== 'string'
    || (lineage.basedOnTaskId !== null && typeof lineage.basedOnTaskId !== 'string')
    || (lineage.authorInstructionVersion !== null && typeof lineage.authorInstructionVersion !== 'number')
    || value.contextPack === null
    || typeof value.contextPack !== 'object'
  ) {
    throw new DomainError(errorCodes.validation, '这是一轮旧的重新设计任务，已有内容仍会保留，请重新发起。', {}, false, 409);
  }
  return value as SettingRedesignTaskState;
}

function parseFinalReviewStoredResult(value: string): { result: V7SettingFinalReviewResult; resultHash: string | null } | null {
  const parsed = JSON.parse(value) as { taskKind?: unknown; result?: unknown; resultHash?: unknown };
  if (parsed.taskKind !== 'batch_final_review' || parsed.result === null || typeof parsed.result !== 'object') return null;
  return {
    result: parsed.result as V7SettingFinalReviewResult,
    resultHash: typeof parsed.resultHash === 'string' && parsed.resultHash.length > 0 ? parsed.resultHash : null
  };
}

function recommendationRequestHash(profile: BookProfileView, catalog: readonly V7SettingCatalogItem[]): string {
  return hash({
    taskKind: 'catalog_recommendation',
    contractVersion: SETTING_RECOMMENDATION_CONTRACT_VERSION,
    openingVersion: profile.version,
    openingBlueprint: profile.openingBlueprint,
    catalog: catalog.map((item) => ({ key: item.key, label: item.label, prompt: item.prompt, group: item.groupTitle }))
  });
}

function recommendationIsStale(
  row: BatchRow,
  profile: BookProfileView,
  catalog: readonly V7SettingCatalogItem[]
): boolean {
  return row.opening_version !== profile.version
    || row.opening_hash !== hash(profile.openingBlueprint)
    || row.request_hash !== recommendationRequestHash(profile, catalog);
}

function recommendationOpeningProfile(profile: BookProfileView): unknown {
  return {
    title: profile.title,
    channel: profile.channel,
    category: profile.category,
    subjects: profile.subjects,
    mainTags: profile.mainTags,
    customTags: profile.customTags,
    protagonists: profile.protagonists,
    storyDirection: profile.storyDirection,
    openingStart: profile.openingStart,
    storyEnding: profile.storyEnding,
    mustFollow: profile.mustFollow,
    style: profile.style,
    confirmedOpening: profile.openingBlueprint
  };
}

function recommendationState(row: BatchRow): RecommendationState {
  const value = JSON.parse(row.custom_items_json) as Partial<RecommendationState>;
  if (
    value.taskKind !== 'catalog_recommendation'
    || !recommendationPhases.includes(value.phase as RecommendationState['phase'])
    || typeof value.progress !== 'number'
    || (value.assignedMemberKey !== null && typeof value.assignedMemberKey !== 'string')
    || !Array.isArray(value.attemptedMemberKeys)
    || typeof value.publicMessage !== 'string'
  ) throw new Error('设定清单任务状态无效');
  return {
    taskKind: 'catalog_recommendation',
    phase: value.phase as RecommendationState['phase'],
    progress: value.progress,
    assignedMemberKey: value.assignedMemberKey ?? null,
    attemptedMemberKeys: value.attemptedMemberKeys.filter((key): key is string => typeof key === 'string'),
    publicMessage: value.publicMessage
  };
}

function recommendationResult(value: string): V7SettingCatalogRecommendationView['result'] {
  const parsed = JSON.parse(value) as { taskKind?: unknown; result?: unknown };
  if (parsed.taskKind !== 'catalog_recommendation' || parsed.result === null || parsed.result === undefined) return null;
  const result = parsed.result as Record<string, unknown>;
  if (!Array.isArray(result.requiredKeys) || !Array.isArray(result.suggestedKeys) || !Array.isArray(result.excludedKeys) || typeof result.summary !== 'string') {
    throw new Error('设定清单结果无效');
  }
  return {
    requiredKeys: result.requiredKeys.filter((key): key is string => typeof key === 'string'),
    suggestedKeys: result.suggestedKeys.filter((key): key is string => typeof key === 'string'),
    excludedKeys: result.excludedKeys.filter((key): key is string => typeof key === 'string'),
    summary: result.summary
  };
}

function failedRecommendationState(state: RecommendationState, publicMessage: string): RecommendationState {
  return { ...state, phase: 'failed', progress: 100, publicMessage };
}

function requireTaskRole(
  roster: readonly V7SettingMemberDefinition[],
  role: 'chief_editor' | 'deputy_editor'
): V7SettingMemberDefinition {
  const member = roster.find((candidate) => candidate.roleKey === role);
  if (member === undefined) throw new Error(`任务冻结名册中缺少${role === 'chief_editor' ? '主编' : '副编'}`);
  return member;
}

function requireTaskMember(
  roster: readonly V7SettingMemberDefinition[],
  memberKey: string,
  role: V7SettingMemberDefinition['roleKey']
): V7SettingMemberDefinition {
  const member = roster.find((candidate) => candidate.memberKey === memberKey && candidate.roleKey === role);
  if (member === undefined) throw new Error('任务冻结名册中缺少作者选择的编剧');
  return member;
}

function independentTaskChief(
  roster: readonly V7SettingMemberDefinition[],
  writer: V7SettingMemberDefinition
): V7SettingMemberDefinition {
  const writerSignature = settingModelSignature(writer);
  const chief = roster
    .filter((candidate) => candidate.roleKey === 'chief_editor')
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority)
    .find((candidate) => settingModelSignature(candidate) !== writerSignature);
  if (chief === undefined) throw new Error('任务冻结名册中缺少与设计成员底模不同的主编');
  return chief;
}

function settingModelSignature(member: V7SettingMemberDefinition): string {
  return `${member.model.provider}:${member.model.modelId}:${member.model.plan}`;
}

function settingOutcomeUnknown(error: unknown): boolean {
  return (error instanceof V7BookGenreProfileEnsureError && error.outcomeUnknown)
    || (error instanceof SettingModelCallError && error.outcomeUnknown)
    || (error instanceof ModelAdapterError && error.outcomeUnknown);
}

function isSettingPreDispatchFailure(error: unknown): boolean {
  const code = settingDomainCode(error);
  return code !== null && [
    errorCodes.membershipRequired,
    errorCodes.membershipExpired,
    errorCodes.membershipQuotaExhausted,
    errorCodes.budgetExhausted
  ].includes(code as typeof errorCodes.membershipRequired);
}

function settingDomainCode(error: unknown): string | null {
  if (error instanceof DomainError) return error.code;
  if (error instanceof V7BookGenreProfileEnsureError) return error.domainCode;
  return null;
}

function settingBatchFailure(error: unknown): SettingBatchFailure {
  const storedMessage = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
  const code = settingDomainCode(error);
  if (code === errorCodes.membershipRequired) {
    return {
      code,
      stage: 'pre_dispatch',
      retrySafety: 'safe_after_precondition',
      storedMessage,
      publicMessage: '对不起，当前会员暂不包含这项创作服务；已完成的设定都已保留。开通后可继续未完成条目。'
    };
  }
  if (code === errorCodes.membershipExpired) {
    return {
      code,
      stage: 'pre_dispatch',
      retrySafety: 'safe_after_precondition',
      storedMessage,
      publicMessage: '对不起，会员已经到期；已完成的设定都已保留。续费后可继续未完成条目。'
    };
  }
  if (code === errorCodes.membershipQuotaExhausted) {
    return {
      code,
      stage: 'pre_dispatch',
      retrySafety: 'safe_after_precondition',
      storedMessage,
      publicMessage: '对不起，本期剩余算力不足以继续这一轮；已完成的设定都已保留。续费后可继续未完成条目。'
    };
  }
  if (code === errorCodes.budgetExhausted) {
    return {
      code,
      stage: 'pre_dispatch',
      retrySafety: 'safe_after_precondition',
      storedMessage,
      publicMessage: '对不起，本书当前创作预算不足；已完成的设定都已保留。调整预算后可继续未完成条目。'
    };
  }
  if (settingOutcomeUnknown(error)) {
    return {
      code: errorCodes.modelCallInterrupted,
      stage: 'in_dispatch',
      retrySafety: 'result_unknown',
      storedMessage,
      publicMessage: '对不起，有一项上次结果还不能确认，系统已停止自动重试；已完成的设定都已保留。'
    };
  }
  if (error instanceof SettingModelCallError || error instanceof ModelAdapterError) {
    return {
      code: errorCodes.modelRequestRejected,
      stage: 'in_dispatch',
      retrySafety: 'technical_retry',
      storedMessage,
      publicMessage: '对不起，这一轮没有全部完成；已完成的设定都已保留，可以重试明确失败的条目。'
    };
  }
  return {
    code: error instanceof DomainError ? error.code : errorCodes.operationIncomplete,
    stage: 'post_dispatch',
    retrySafety: 'manual_redesign',
    storedMessage,
    publicMessage: '对不起，这一轮没有全部完成；已完成的设定都已保留，请检查后重新设计未完成条目。'
  };
}

function settingBatchStatusText(batch: BatchRow, completedCount: number): string {
  if (batch.status === 'queued') return '老板稍等，大家正在准备';
  if (batch.status === 'working') return '亲爱的，编辑部正在加急设计中';
  if (batch.status === 'awaiting_author') return '这一轮已经整理好，请老板看看';
  if (batch.status === 'completed') return '这一轮已经确认好啦';
  const failure = settingBatchFailureFromRow(batch);
  const completed = completedCount > 0 ? `已完成${completedCount}项都已保留。` : '';
  return `${failure}${completed}`;
}

function settingBatchFailureFromRow(batch: BatchRow): string {
  if (batch.error_code === errorCodes.membershipRequired) return '对不起，当前会员暂不包含这项创作服务；';
  if (batch.error_code === errorCodes.membershipExpired) return '对不起，会员已经到期；';
  if (batch.error_code === errorCodes.membershipQuotaExhausted) return '对不起，本期剩余算力不足以继续这一轮；';
  if (batch.error_code === errorCodes.budgetExhausted) return '对不起，本书当前创作预算不足；';
  if (batch.retry_safety === 'result_unknown') return '对不起，有一项上次结果还不能确认，系统已停止自动重试；';
  return '对不起，这一轮没有全部完成；';
}

function legacyMembershipGateMemberEvent(reason: string | null): boolean {
  return reason !== null && /(?:会员算力值已用完|剩余算力值不足|会员已到期|开通会员)/u.test(reason);
}

function jobSourceItemRevision(job: JobRow): number | null | undefined {
  if (job.context_manifest_json === null) return undefined;
  const stored = JSON.parse(job.context_manifest_json) as { sourceItemRevision?: unknown };
  if (!Object.prototype.hasOwnProperty.call(stored, 'sourceItemRevision')) return undefined;
  if (stored.sourceItemRevision === null) return null;
  if (typeof stored.sourceItemRevision !== 'number'
    || !Number.isInteger(stored.sourceItemRevision)
    || stored.sourceItemRevision < 0) {
    throw new DomainError(
      errorCodes.validation,
      '设定任务缺少可核对的来源版本，旧结果不会覆盖当前内容。',
      {},
      false,
      409
    );
  }
  return stored.sourceItemRevision;
}

function sourceItemRevisionMatches(expected: number | null, current: CurrentItemRow | undefined): boolean {
  return expected === null ? current === undefined : current?.revision === expected;
}

function itemReviewSourceRevision(batch: BatchRow, itemKey: string): number | undefined {
  const stored = JSON.parse(batch.custom_items_json) as { taskKind?: unknown; itemKey?: unknown; sourceRevision?: unknown };
  if (stored.taskKind !== 'item_review' || stored.itemKey !== itemKey) return undefined;
  if (typeof stored.sourceRevision !== 'number' || !Number.isInteger(stored.sourceRevision) || stored.sourceRevision < 0) {
    throw new DomainError(errorCodes.validation, '设定复审任务缺少可核对的来源版本。', {}, false, 409);
  }
  return stored.sourceRevision;
}

interface ItemFusionSource {
  taskKind: 'item_fusion';
  itemKey: string;
  outputIds?: unknown;
  authorNote?: unknown;
  sourceTaskId?: unknown;
  sourceRevision?: unknown;
}

function itemFusionSource(batch: BatchRow, itemKey: string): ItemFusionSource | undefined {
  const stored = JSON.parse(batch.custom_items_json) as Partial<ItemFusionSource>;
  if (stored.taskKind !== 'item_fusion') return undefined;
  if (stored.itemKey !== itemKey) {
    throw new DomainError(errorCodes.validation, '融合任务与设定条目不一致。', {}, false, 409);
  }
  return stored as ItemFusionSource;
}

function minimumSettingReservation(itemCount: number): number {
  return Math.max(8_000, Math.ceil(Math.max(1, itemCount) / SETTING_GROUP_SIZE) * 8_000);
}

function runtimeSourcePrompt(content: Readonly<Record<string, unknown>>): string {
  if (!Object.prototype.hasOwnProperty.call(content, 'stageTaskPayload')) {
    throw new SettingModelCallError('首次调用的冻结任务内容不完整，不能盲目重试');
  }
  const payload = content.stageTaskPayload;
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

const recommendationPhases: readonly RecommendationState['phase'][] = [
  'preparing', 'understanding', 'organizing', 'validating', 'handoff', 'ready', 'failed'
];

function recommendationPhaseText(phase: RecommendationState['phase']): string {
  return ({
    preparing: '正在接收资料',
    understanding: '正在理解作品',
    organizing: '正在整理设定清单',
    validating: '正在检查清单',
    handoff: '工作正在交接',
    ready: '设定清单已完成',
    failed: '本轮没有完成'
  })[phase];
}

function settingContextProfileText(profile: BookProfileView): string {
  const blueprint = profile.openingBlueprint;
  const protagonists = (blueprint.protagonists ?? profile.protagonists).flatMap((item) => [
    item.name,
    item.age,
    item.background ?? '',
    item.familyBackground ?? '',
    item.careerBackground ?? '',
    item.goldenFinger ?? '',
    ...(item.personalities ?? []),
    item.visualIdentity?.appearance ?? '',
    item.visualIdentity?.build ?? '',
    item.visualIdentity?.signatureFeature ?? ''
  ]);
  return [
    profile.title,
    profile.channel,
    profile.category,
    ...profile.subjects,
    ...profile.mainTags,
    ...profile.customTags,
    blueprint.worldBackground,
    ...protagonists,
    profile.storyDirection,
    profile.storyEnding,
    ...(blueprint.mustFollow ?? profile.mustFollow ?? [])
  ].map((item) => item.trim()).filter(Boolean).join(' · ');
}
function normalizeSelection(profile: BookProfileView, selectedValue: unknown, customValue: unknown): { selectedItems: V7SettingCatalogItem[]; customItems: V7SettingCatalogItem[] } {
  void profile;
  const active = V7_SETTING_CATALOG;
  const keys = Array.isArray(selectedValue) ? selectedValue.filter((entry): entry is string => typeof entry === 'string') : [];
  const selectedItems = [...new Set(keys)].map((key) => active.find((item) => item.key === key)).filter((item): item is V7SettingCatalogItem => item !== undefined);
  if (selectedItems.length !== new Set(keys).size) throw new DomainError(errorCodes.validation, '选择中包含不适用于本书的设定条目。');
  const customItems = Array.isArray(customValue) ? customValue.map((entry, index) => { const row = typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry as Record<string, unknown> : {}; const label = requiredText(row.label, `自定义条目${index + 1}名称`, 1, 40); const prompt = requiredText(row.prompt, `自定义条目${index + 1}说明`, 1, 300); return { key: `custom-${hash(`${label}\n${prompt}`).slice(0, 16)}`, label, prompt, source: '作者自定义', groupKey: 'custom', groupTitle: '自定义设定', required: false, deputyPolicy: 'conditional' as const }; }) : [];
  if (customItems.length > 10) throw new DomainError(errorCodes.validation, '一次最多补充10个自定义条目。');
  return { selectedItems, customItems };
}
function normalizeNotes(value: unknown): Record<string, string> { if (value === undefined) return {}; if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new DomainError(errorCodes.validation, '条目意见格式不正确。'); return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, noteValue]) => [key, note(noteValue)])); }
function normalizeMemberKeys(value: unknown): string[] { const keys = Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))] : []; if (keys.length < 1 || keys.length > 3) throw new DomainError(errorCodes.validation, '请选择1至3名编剧。'); return keys; }
function normalizeOutputIds(value: unknown): string[] { const ids = Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))] : []; if (ids.length < 2 || ids.length > 3) throw new DomainError(errorCodes.validation, '请选择2至3份候选融合。'); return ids; }
function note(value: unknown): string { if (value === undefined || value === null) return ''; if (typeof value !== 'string') throw new DomainError(errorCodes.validation, '调整意见格式不正确。'); const text = value.trim(); if (Array.from(text).length > 800) throw new DomainError(errorCodes.validation, '调整意见最多800字。'); return text; }
function actionKey(value: unknown): string { const key = typeof value === 'string' ? value.trim() : ''; if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(key)) throw new DomainError(errorCodes.validation, '操作编号无效，请重新操作。'); return key; }
function optionalIdentifier(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  const identifier = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,160}$/u.test(identifier)) throw new DomainError(errorCodes.validation, `${label}无效。`);
  return identifier;
}
function scopedActionKey(scope: 'redesign' | 'fusion' | 'author' | 'restart', value: unknown): string {
  const raw = actionKey(value);
  const scoped = `${scope}-${raw}`;
  return scoped.length <= 128 ? scoped : `${scope}-${hash(raw)}`;
}
function integer(value: unknown, label: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new DomainError(errorCodes.validation, `${label}无效。`); return value; }
function requiredText(value: unknown, label: string, min: number, max: number): string { const text = typeof value === 'string' ? value.trim() : ''; const length = Array.from(text).length; if (length < min || length > max) throw new DomainError(errorCodes.validation, `${label}需要${min}至${max}字。`); return text; }
function hash(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function stateText(state: V7SettingItemView['state']): string { return ({ queued: '正在安排人手', working: '亲爱的，我正在加急设计中', chief_review: '老板稍等，主编正在仔细检查', needs_author: '已经整理好，请您看看', confirmed: '已确认', failed: '对不起，这项设定这次没有完成，请重新设计' })[state]; }
function authorProposal(proposal: V7WriterProposal): V7WriterProposal {
  return {
    content: projectSettingFinalContent(proposal.content),
    designRationale: sanitizeAuthorFacingSettingText(proposal.designRationale),
    storyConsequences: proposal.storyConsequences.map(sanitizeAuthorFacingSettingText).filter(Boolean),
    dependencies: proposal.dependencies.map(sanitizeAuthorFacingSettingText).filter(Boolean),
    risks: proposal.risks.map(sanitizeAuthorFacingSettingText).filter(Boolean)
  };
}
