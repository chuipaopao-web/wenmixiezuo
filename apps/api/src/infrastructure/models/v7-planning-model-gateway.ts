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
import type { Clock } from '../../domain/ids.js';
import { V7PlanningRuntimeRepository } from '../db/repositories/v7-planning-runtime-repository.js';
import { assertMembershipAllowsGeneration } from '../security/membership-service.js';
import type { ModelAdapter } from './model-adapter.js';
import { ModelAdapterError } from './model-adapter.js';
import type { ModelPurpose } from './model-runtime-config.js';
import { thinkingTokenAllowance } from './model-runtime-config.js';
import { resolveV7TaskPolicy } from '../../application/agents/v7-agent-runtime-policy.js';
import { compileV7RuntimePrompt } from '../../application/agents/v7-runtime-prompt-compiler.js';
import { V7PromptGovernanceRepository } from '../db/repositories/v7-prompt-governance-repository.js';

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

export class V7PlanningModelGateway {
  private readonly repository: V7PlanningRuntimeRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly adapters: V7PlanningModelAdapterResolver,
    private readonly clock: Clock
  ) {
    this.repository = new V7PlanningRuntimeRepository(database);
  }

  public async generate(request: V7PlanningModelRequest): Promise<V7PlanningModelResult> {
    this.assertLineage(request);
    const existing = this.repository.modelCall(request.requestId);
    if (existing !== undefined) {
      if (existing.owner_id !== request.ownerId || existing.book_id !== request.bookId) {
        throw new V7PlanningModelError('模型调用不属于当前书籍');
      }
      if (existing.state === 'succeeded' && existing.output_text !== null) {
        return {
          requestId: existing.request_id, provider: existing.provider, modelId: existing.model_id,
          output: existing.output_text, inputTokens: existing.input_tokens ?? 0, outputTokens: existing.output_tokens ?? 0
        };
      }
      if (existing.state === 'unknown' || existing.state === 'working') {
        throw new V7PlanningModelError('上一次调用结果尚未确认，已停止重复扣量。', true);
      }
      throw new V7PlanningModelError(existing.failure_message ?? '上一次调用没有完成');
    }
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
      genreProfile: promptGovernance.activeBookGenreProfile(request.ownerId, request.bookId),
      governanceRevision: promptGovernance.summary().revision,
      temperature: runtimePolicy.temperature,
      maxOutputTokens: request.maxOutputTokens,
      createdAt: now,
      retrySnapshot: retrySnapshot ?? undefined
    });
    promptGovernance.saveRuntimeBundle(compiled);
    const reasoningTokens = thinkingTokenAllowance(request.member.model.modelId, 'structured_planning', request.maxOutputTokens);
    const reservedTokens = Math.max(8_000, compiled.manifest.compiledPrompt.length + request.maxOutputTokens + reasoningTokens);
    assertMembershipAllowsGeneration(this.database, request.ownerId, now, reservedTokens);
    this.repository.beginModelCall({
      requestId: request.requestId, ownerId: request.ownerId, bookId: request.bookId,
      runId: request.runId, runKind: request.runKind, nodeKey: request.nodeKey,
      memberKey: request.member.memberKey, provider: request.member.model.provider,
      modelId: request.member.model.modelId, plan: request.member.model.plan,
      promptHash: compiled.manifest.compiledPromptHash, reservedTokens,
      governanceRevision: runtimePolicy.governanceRevision, temperature: runtimePolicy.temperature, now
    });
    try {
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
      this.repository.completeModelCall({
        requestId: request.requestId,
        inputTokens: Math.max(0, result.inputTokens),
        outputTokens: Math.max(0, result.outputTokens),
        cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)),
        outputText: result.output,
        now: completedAt
      });
      return {
        requestId: request.requestId, provider: result.provider, modelId: result.modelId,
        output: result.output, inputTokens: Math.max(0, result.inputTokens), outputTokens: Math.max(0, result.outputTokens)
      };
    } catch (error) {
      if (error instanceof V7PlanningModelError) {
        this.repository.failModelCall(request.requestId, error.outcomeUnknown ? 'unknown' : 'failed', error.message, this.clock.now().toISOString());
        throw error;
      }
      const normalized = normalizeFailure(error);
      this.repository.failModelCall(request.requestId, normalized.outcomeUnknown ? 'unknown' : 'failed', normalized.message, this.clock.now().toISOString());
      throw new V7PlanningModelError(normalized.message, normalized.outcomeUnknown);
    }
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
