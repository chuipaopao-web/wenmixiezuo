import type { DatabaseSync } from 'node:sqlite';
import {
  modelProfileKeyForBinding,
  type V7AgentTaskKind,
  type V7ContextSourceTrace,
  type V7CreationMemberDefinition,
  type V7PlanningMemberDefinition,
  type V7TaskOperationMode,
  type V7WorkstationKey
} from '@wenmi/v7-backend';
import { UuidGenerator, type Clock } from '../../domain/ids.js';
import { V7PlanningRuntimeRepository } from '../db/repositories/v7-planning-runtime-repository.js';
import { assertMembershipAllowsGeneration } from '../security/membership-service.js';
import type { ModelAdapter } from './model-adapter.js';
import { ModelAdapterError } from './model-adapter.js';
import type { ModelPurpose } from './model-runtime-config.js';
import { thinkingTokenAllowance } from './model-runtime-config.js';
import { resolveV7TaskPolicy } from '../../application/agents/v7-agent-runtime-policy.js';
import { compileV7RuntimePrompt } from '../../application/agents/v7-runtime-prompt-compiler.js';
import { V7PromptGovernanceRepository } from '../db/repositories/v7-prompt-governance-repository.js';
import { UnitOfWork } from '../db/unit-of-work.js';
import {
  V7BookGenreProfileEnsureError,
  V7BookGenreProfileEnsureInProgressError,
  V7BookGenreProfileEnsureService
} from '../../application/agents/v7-book-genre-profile-ensure-service.js';

export interface V7PlanningModelAdapterResolver {
  resolve(provider: string, modelId: string, purpose: ModelPurpose): ModelAdapter;
}

export type V7PlanningOperationMode = Exclude<V7TaskOperationMode, 'retry'>;
export type V7PlanningTaskKind = Extract<
  V7AgentTaskKind,
  'planning_context' | 'planning_recipe' | 'planning_review' | 'planning_tree' | 'planning_maintenance'
>;
export type V7PlanningWorkstationKey = Extract<
  V7WorkstationKey,
  'full_book_route' | 'volume' | 'chain' | 'continuity_record'
>;

export interface V7PlanningModelRequest {
  requestId: string;
  /** Stable task identity; execution retries receive a new requestId only. */
  logicalTaskId?: string;
  technicalRetry?: boolean;
  ownerId: string;
  bookId: string;
  runId: string;
  runKind: 'recipe' | 'tree' | 'maintenance';
  nodeKey: string;
  taskKind: V7PlanningTaskKind;
  workstationKey: V7PlanningWorkstationKey;
  operationMode: V7PlanningOperationMode;
  basedOnTaskId: string | null;
  authorInstructionVersion: number | null;
  sourceTraces: readonly V7ContextSourceTrace[];
  member: V7PlanningMemberDefinition | V7CreationMemberDefinition;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
  failFastOnGenreProfileLease?: boolean;
}

export interface V7PlanningModelResult {
  requestId: string;
  provider: string;
  modelId: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
}

export class V7PlanningModelError extends Error {
  public constructor(message: string, public readonly outcomeUnknown = false) {
    super(message);
  }
}

export class V7PlanningModelCallInProgressError extends V7PlanningModelError {
  public constructor(message = '同一项模型调用已经由另一服务实例接手。') {
    super(message, true);
  }
}

// Ark调用硬上限为15分钟；多留1分钟只用于跨实例交接，超过后按结果未知处理。
const MODEL_CALL_ACTIVE_WINDOW_MILLISECONDS = 16 * 60_000;

export class V7PlanningModelGateway {
  private readonly repository: V7PlanningRuntimeRepository;
  private readonly genreProfiles: V7BookGenreProfileEnsureService;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly adapters: V7PlanningModelAdapterResolver,
    private readonly clock: Clock
  ) {
    this.repository = new V7PlanningRuntimeRepository(database);
    this.genreProfiles = new V7BookGenreProfileEnsureService(database, adapters, new UuidGenerator(), clock);
  }

  public async generate(request: V7PlanningModelRequest): Promise<V7PlanningModelResult> {
    this.assertLineage(request);
    const existing = this.repository.modelCall(request.requestId);
    if (existing !== undefined) return this.reuseModelCall(request, existing);
    const taskKind = request.taskKind;
    const runtimePolicy = resolveV7TaskPolicy(this.database, request.member.memberKey, taskKind);
    const now = this.clock.now().toISOString();
    const promptGovernance = new V7PromptGovernanceRepository(this.database);
    promptGovernance.ensureSourceRegistrySeeded(now);
    const logicalTaskId = request.logicalTaskId ?? request.requestId;
    const retrySnapshot = request.technicalRetry === true
      ? promptGovernance.runtimeBundleByTaskScope({
          ownerId: request.ownerId,
          bookId: request.bookId,
          taskId: logicalTaskId
        })
      : null;
    if (request.technicalRetry === true && retrySnapshot === null) {
      throw new V7PlanningModelError('找不到本任务首次冻结的资料快照，不能盲目重试；请重新创建规划维护任务。');
    }
    let genreProfile = promptGovernance.activeBookGenreProfile(request.ownerId, request.bookId);
    if (request.technicalRetry !== true) {
      try {
        genreProfile = await this.genreProfiles.ensure(request.ownerId, request.bookId, {
          failFastOnActiveLease: request.failFastOnGenreProfileLease === true
        });
      } catch (error) {
        if (error instanceof V7BookGenreProfileEnsureInProgressError) {
          throw new V7PlanningModelCallInProgressError(error.message);
        }
        throw new V7PlanningModelError(
          error instanceof Error ? error.message : '题材工作档案没有准备完成',
          error instanceof V7BookGenreProfileEnsureError && error.outcomeUnknown
        );
      }
    }
    const compiled = compileV7RuntimePrompt({
      requestId: request.requestId,
      ownerId: request.ownerId,
      bookId: request.bookId,
      taskId: logicalTaskId,
      memberKey: request.member.memberKey,
      runtimeRoleKey: request.member.roleKey,
      modelProfileKey: modelProfileKeyForBinding(request.member.model),
      taskKind,
      workstationKey: request.workstationKey,
      operationMode: request.technicalRetry === true ? 'retry' : request.operationMode,
      basedOnTaskId: request.basedOnTaskId,
      authorInstructionVersion: request.authorInstructionVersion,
      sourcePrompt: request.prompt,
      sourceTraces: request.sourceTraces,
      promptAssets: promptGovernance.publishedAssets(),
      genreProfile,
      governanceRevision: promptGovernance.summary().revision,
      temperature: runtimePolicy.temperature,
      maxOutputTokens: request.maxOutputTokens,
      createdAt: now,
      retrySnapshot: retrySnapshot ?? undefined
    });
    const reasoningTokens = thinkingTokenAllowance(request.member.model.modelId, 'structured_planning', request.maxOutputTokens);
    const reservedTokens = Math.max(8_000, compiled.manifest.compiledPrompt.length + request.maxOutputTokens + reasoningTokens);
    let claimed = false;
    let winner: ReturnType<V7PlanningRuntimeRepository['modelCall']> = undefined;
    new UnitOfWork(this.database).run(() => {
      winner = this.repository.modelCall(request.requestId);
      if (winner === undefined) {
        assertMembershipAllowsGeneration(this.database, request.ownerId, now, reservedTokens);
        claimed = this.repository.beginModelCall({
          requestId: request.requestId, ownerId: request.ownerId, bookId: request.bookId,
          runId: request.runId, runKind: request.runKind, nodeKey: request.nodeKey,
          memberKey: request.member.memberKey, provider: request.member.model.provider,
          modelId: request.member.model.modelId, plan: request.member.model.plan,
          promptHash: compiled.manifest.compiledPromptHash, reservedTokens,
          governanceRevision: runtimePolicy.governanceRevision, temperature: runtimePolicy.temperature, now
        });
      }
    });
    if (!claimed) {
      winner ??= this.repository.modelCall(request.requestId);
      if (winner === undefined) throw new V7PlanningModelError('模型调用执行权刚刚变化，请刷新后重试');
      return this.reuseModelCall(request, winner);
    }
    try {
      promptGovernance.saveRuntimeBundle(compiled);
      const adapter = this.adapters.resolve(request.member.model.provider, request.member.model.modelId, 'structured_planning');
      const result = await adapter.generate({
        requestId: request.requestId,
        taskId: request.runId,
        ownerId: request.ownerId,
        bookId: request.bookId,
        agentId: request.member.memberKey,
        prompt: compiled.manifest.compiledPrompt,
        maxOutputTokens: request.maxOutputTokens,
        temperature: runtimePolicy.temperature
      });
      if (result.output.trim().length === 0) throw new V7PlanningModelError('成员没有返回可见方案');
      const completedAt = this.clock.now().toISOString();
      const completed = this.repository.completeModelCall({
        requestId: request.requestId,
        inputTokens: Math.max(0, result.inputTokens),
        outputTokens: Math.max(0, result.outputTokens),
        cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)),
        outputText: result.output,
        now: completedAt
      });
      if (!completed) {
        const current = this.repository.modelCall(request.requestId);
        if (current?.state === 'succeeded' && current.output_text !== null) {
          return this.reuseModelCall(request, current);
        }
        throw new V7PlanningModelError('模型已经返回结果，但本次落档状态刚刚变化，请刷新核对结果。', true);
      }
      return {
        requestId: request.requestId, provider: result.provider, modelId: result.modelId,
        output: result.output, inputTokens: Math.max(0, result.inputTokens), outputTokens: Math.max(0, result.outputTokens)
      };
    } catch (error) {
      const failure = error instanceof V7PlanningModelError
        ? error
        : (() => {
            const normalized = normalizeFailure(error);
            return new V7PlanningModelError(normalized.message, normalized.outcomeUnknown);
          })();
      const recorded = this.repository.failModelCall(
        request.requestId,
        failure.outcomeUnknown ? 'unknown' : 'failed',
        failure.message,
        this.clock.now().toISOString()
      );
      if (!recorded) {
        const current = this.repository.modelCall(request.requestId);
        if (current?.state === 'succeeded' && current.output_text !== null) {
          return this.reuseModelCall(request, current);
        }
        throw new V7PlanningModelError('模型调用落档状态已经变化，已停止交给其他成员重复执行。', true);
      }
      throw failure;
    }
  }

  private reuseModelCall(
    request: V7PlanningModelRequest,
    existing: NonNullable<ReturnType<V7PlanningRuntimeRepository['modelCall']>>
  ): V7PlanningModelResult {
    if (existing.owner_id !== request.ownerId || existing.book_id !== request.bookId) {
      throw new V7PlanningModelError('模型调用不属于当前书籍');
    }
    if (existing.run_id !== request.runId
      || existing.run_kind !== request.runKind
      || existing.node_key !== request.nodeKey
      || existing.member_key !== request.member.memberKey
      || existing.provider !== request.member.model.provider
      || existing.model_id !== request.member.model.modelId
      || existing.plan !== request.member.model.plan) {
      throw new V7PlanningModelError('历史模型调用的任务成员或模型绑定已经变化，不能恢复执行');
    }
    if (existing.state === 'succeeded' && existing.output_text !== null) {
      return {
        requestId: existing.request_id, provider: existing.provider, modelId: existing.model_id,
        output: existing.output_text, inputTokens: existing.input_tokens ?? 0, outputTokens: existing.output_tokens ?? 0
      };
    }
    if (existing.state === 'working') {
      const startedAt = Date.parse(existing.started_at);
      const age = this.clock.now().getTime() - startedAt;
      if (Number.isFinite(startedAt) && age <= MODEL_CALL_ACTIVE_WINDOW_MILLISECONDS) {
        throw new V7PlanningModelCallInProgressError();
      }
      const now = this.clock.now().toISOString();
      const markedUnknown = this.repository.failModelCall(
        existing.request_id,
        'unknown',
        '模型调用执行实例中断，供应商结果尚未确认。',
        now
      );
      if (!markedUnknown) {
        const current = this.repository.modelCall(existing.request_id);
        if (current?.state === 'succeeded' && current.output_text !== null) {
          return this.reuseModelCall(request, current);
        }
      }
      throw new V7PlanningModelError('上一次调用结果尚未确认，已停止重复扣量。', true);
    }
    if (existing.state === 'unknown') {
      throw new V7PlanningModelError('上一次调用结果尚未确认，已停止重复扣量。', true);
    }
    throw new V7PlanningModelError(existing.failure_message ?? '上一次调用没有完成');
  }

  private assertLineage(request: V7PlanningModelRequest): void {
    assertPlanningContractShape(request);
    if (request.authorInstructionVersion !== null) {
      throw new V7PlanningModelError('当前规划链尚未持久化作者意见版本，不得填写或猜测版本号');
    }
    if (request.operationMode === 'fresh') {
      if (request.basedOnTaskId !== null) {
        throw new V7PlanningModelError('新建规划任务不得携带来源任务');
      }
      return;
    }
    if ((request.operationMode === 'revise' || request.operationMode === 'repair')
      && request.basedOnTaskId === null) {
      throw new V7PlanningModelError('调整或修复规划必须绑定一个已成功的真实来源任务');
    }
    // 融合可以由 ContextPack 记录多个来源，因此不强制单一父任务；
    // 但只要显式填了 basedOnTaskId，就必须证明它真实且同源。
    if (request.basedOnTaskId === null) return;
    if (request.basedOnTaskId === request.requestId) {
      throw new V7PlanningModelError('规划任务不能把自己伪装成来源任务');
    }
    const basedOn = this.repository.modelCall(request.basedOnTaskId);
    if (basedOn === undefined || basedOn.owner_id !== request.ownerId || basedOn.book_id !== request.bookId) {
      throw new V7PlanningModelError('任务来源不存在或不属于当前书籍');
    }
    if (basedOn.state !== 'succeeded') {
      throw new V7PlanningModelError('任务来源尚未成功，不能作为调整或修复依据');
    }
    if (basedOn.run_kind !== request.runKind) {
      throw new V7PlanningModelError('任务来源不属于当前规划工作流');
    }
    const contract = this.database.prepare(`SELECT task_kind AS taskKind,workstation_key AS workstationKey
      FROM v7_task_contracts WHERE owner_id=? AND book_id=? AND task_id=?
      ORDER BY version DESC LIMIT 1`).get(
      request.ownerId, request.bookId, request.basedOnTaskId
    ) as { taskKind: string; workstationKey: string } | undefined;
    if (contract === undefined || !isPlanningTaskKind(contract.taskKind)
      || contract.workstationKey !== request.workstationKey) {
      throw new V7PlanningModelError('任务来源不属于当前规划工作流');
    }
  }
}

function assertPlanningContractShape(request: V7PlanningModelRequest): void {
  const correct = request.runKind === 'maintenance'
    ? request.taskKind === 'planning_maintenance' && request.workstationKey === 'continuity_record'
    : request.runKind === 'tree'
      ? (request.taskKind === 'planning_context' || request.taskKind === 'planning_tree')
        && request.workstationKey !== 'continuity_record'
      : (request.taskKind === 'planning_context' || request.taskKind === 'planning_recipe'
        || request.taskKind === 'planning_review')
        && request.workstationKey !== 'continuity_record';
  if (!correct) throw new V7PlanningModelError('规划任务类型、工位与工作流不匹配');
}

function isPlanningTaskKind(value: string): value is V7PlanningTaskKind {
  return value === 'planning_context' || value === 'planning_recipe' || value === 'planning_review'
    || value === 'planning_tree' || value === 'planning_maintenance';
}

function normalizeFailure(error: unknown): { message: string; outcomeUnknown: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ModelAdapterError) return { message, outcomeUnknown: error.outcomeUnknown };
  return { message, outcomeUnknown: false };
}
