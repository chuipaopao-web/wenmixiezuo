import type { DatabaseSync } from 'node:sqlite';
import { modelProfileKeyForBinding, type V7CharacterMemberDefinition } from '@wenmi/v7-backend';
import { UuidGenerator, type Clock } from '../../domain/ids.js';
import { V7CharacterMemoryRepository } from '../db/repositories/v7-character-memory-repository.js';
import { assertMembershipAllowsGeneration } from '../security/membership-service.js';
import type { ModelAdapter } from './model-adapter.js';
import { ModelAdapterError } from './model-adapter.js';
import type { ModelPurpose } from './model-runtime-config.js';
import { thinkingTokenAllowance } from './model-runtime-config.js';
import { resolveV7TaskPolicy } from '../../application/agents/v7-agent-runtime-policy.js';
import { compileV7RuntimePrompt } from '../../application/agents/v7-runtime-prompt-compiler.js';
import { V7PromptGovernanceRepository } from '../db/repositories/v7-prompt-governance-repository.js';
import {
  V7BookGenreProfileEnsureError,
  V7BookGenreProfileEnsureService
} from '../../application/agents/v7-book-genre-profile-ensure-service.js';

export interface V7CharacterMemoryModelAdapterResolver {
  resolve(provider: string, modelId: string, purpose: ModelPurpose): ModelAdapter;
}

export interface V7CharacterMemoryModelRequest {
  requestId: string;
  /**
   * 同一次创作任务的稳定编号。技术重试只更换 requestId（执行尝试），
   * logicalTaskId 始终指向首次冻结的 TaskContract/ContextPack/PromptManifest。
   */
  logicalTaskId: string;
  technicalRetry: boolean;
  ownerId: string;
  bookId: string;
  runId: string;
  runKind: 'context_pack' | 'maintenance';
  member: V7CharacterMemberDefinition;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
}

export interface V7CharacterMemoryModelResult {
  requestId: string;
  provider: string;
  modelId: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
}

export class V7CharacterMemoryModelError extends Error {
  public constructor(message: string, public readonly outcomeUnknown = false) {
    super(message);
  }
}

export class V7CharacterMemoryModelGateway {
  private readonly repository: V7CharacterMemoryRepository;
  private readonly genreProfiles: V7BookGenreProfileEnsureService;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly adapters: V7CharacterMemoryModelAdapterResolver,
    private readonly clock: Clock
  ) {
    this.repository = new V7CharacterMemoryRepository(database);
    this.genreProfiles = new V7BookGenreProfileEnsureService(database, adapters, new UuidGenerator(), clock);
  }

  public async generate(request: V7CharacterMemoryModelRequest): Promise<V7CharacterMemoryModelResult> {
    const existing = this.repository.modelCall(request.requestId);
    if (existing !== undefined) {
      if (existing.owner_id !== request.ownerId || existing.book_id !== request.bookId) {
        throw new V7CharacterMemoryModelError('人物资料调用不属于当前书籍');
      }
      if (existing.run_id !== request.runId
        || existing.run_kind !== request.runKind
        || existing.member_key !== request.member.memberKey
        || existing.provider !== request.member.model.provider
        || existing.model_id !== request.member.model.modelId
        || existing.plan !== request.member.model.plan) {
        throw new V7CharacterMemoryModelError(
          '这次人物任务保存的是历史成员或旧模型调用，已保留原记录，但不能继续恢复。请重新创建当前人物任务。'
        );
      }
      if (existing.state === 'succeeded' && existing.output_text !== null) {
        return {
          requestId: existing.request_id,
          provider: existing.provider,
          modelId: existing.model_id,
          output: existing.output_text,
          inputTokens: existing.input_tokens ?? 0,
          outputTokens: existing.output_tokens ?? 0
        };
      }
      if (existing.state === 'working' || existing.state === 'unknown') {
        throw new V7CharacterMemoryModelError('上一次人物资料调用结果尚未确认，已停止重复扣量。', true);
      }
      throw new V7CharacterMemoryModelError(existing.failure_message ?? '上一次人物资料调用没有完成');
    }
    const taskKind = request.runKind === 'context_pack' ? 'character_context' : 'character_maintenance';
    const runtimePolicy = resolveV7TaskPolicy(this.database, request.member.memberKey, taskKind);
    const now = this.clock.now().toISOString();
    const promptGovernance = new V7PromptGovernanceRepository(this.database);
    promptGovernance.ensureSourceRegistrySeeded(now);
    const retrySnapshot = request.technicalRetry
      ? promptGovernance.runtimeBundleByTaskScope({
          ownerId: request.ownerId,
          bookId: request.bookId,
          taskId: request.logicalTaskId
        })
      : null;
    if (request.technicalRetry && retrySnapshot === null) {
      throw new V7CharacterMemoryModelError('找不到本任务首次冻结的资料快照，不能盲目重试；请重新创建人物任务。');
    }
    let genreProfile = promptGovernance.activeBookGenreProfile(request.ownerId, request.bookId);
    if (!request.technicalRetry) {
      try {
        genreProfile = await this.genreProfiles.ensure(request.ownerId, request.bookId);
      } catch (error) {
        throw new V7CharacterMemoryModelError(
          error instanceof Error ? error.message : '题材工作档案没有准备完成',
          error instanceof V7BookGenreProfileEnsureError && error.outcomeUnknown
        );
      }
    }
    const compiled = compileV7RuntimePrompt({
      requestId: request.requestId,
      ownerId: request.ownerId,
      bookId: request.bookId,
      taskId: request.logicalTaskId,
      memberKey: request.member.memberKey,
      runtimeRoleKey: request.member.roleKey,
      modelProfileKey: modelProfileKeyForBinding(request.member.model),
      taskKind,
      workstationKey: 'continuity_record',
      operationMode: request.technicalRetry ? 'retry' : 'fresh',
      sourcePrompt: request.prompt,
      promptAssets: promptGovernance.publishedAssets(),
      genreProfile,
      governanceRevision: promptGovernance.summary().revision,
      temperature: runtimePolicy.temperature,
      maxOutputTokens: request.maxOutputTokens,
      createdAt: now,
      retrySnapshot: retrySnapshot ?? undefined
    });
    promptGovernance.saveRuntimeBundle(compiled);
    const purpose: ModelPurpose = request.runKind === 'maintenance' ? 'novel_reviewer' : 'structured_planning';
    const reasoningTokens = thinkingTokenAllowance(request.member.model.modelId, purpose, request.maxOutputTokens, compiled.manifest.compiledPrompt.length);
    const reservedTokens = Math.max(8_000, compiled.manifest.compiledPrompt.length + request.maxOutputTokens + reasoningTokens);
    assertMembershipAllowsGeneration(this.database, request.ownerId, now, reservedTokens);
    this.repository.startModelCall({
      requestId: request.requestId,
      ownerId: request.ownerId,
      bookId: request.bookId,
      runId: request.runId,
      runKind: request.runKind,
      memberKey: request.member.memberKey,
      provider: request.member.model.provider,
      modelId: request.member.model.modelId,
      plan: request.member.model.plan,
      promptHash: compiled.manifest.compiledPromptHash,
      reservedTokens,
      governanceRevision: runtimePolicy.governanceRevision,
      temperature: runtimePolicy.temperature,
      now
    });
    try {
      const adapter = this.adapters.resolve(request.member.model.provider, request.member.model.modelId, purpose);
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
      if (result.output.trim().length === 0) throw new V7CharacterMemoryModelError('人物资料成员没有返回可用结果');
      this.repository.completeModelCall({
        requestId: request.requestId,
        inputTokens: Math.max(0, result.inputTokens),
        outputTokens: Math.max(0, result.outputTokens),
        cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)),
        outputText: result.output,
        now: this.clock.now().toISOString()
      });
      return {
        requestId: request.requestId,
        provider: result.provider,
        modelId: result.modelId,
        output: result.output,
        inputTokens: Math.max(0, result.inputTokens),
        outputTokens: Math.max(0, result.outputTokens)
      };
    } catch (error) {
      const normalized = normalizeFailure(error);
      this.repository.failModelCall(
        request.requestId,
        normalized.outcomeUnknown ? 'unknown' : 'failed',
        normalized.message,
        this.clock.now().toISOString()
      );
      throw new V7CharacterMemoryModelError(normalized.message, normalized.outcomeUnknown);
    }
  }
}

function normalizeFailure(error: unknown): { message: string; outcomeUnknown: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof V7CharacterMemoryModelError || error instanceof ModelAdapterError) {
    return { message, outcomeUnknown: error.outcomeUnknown };
  }
  return { message, outcomeUnknown: false };
}
