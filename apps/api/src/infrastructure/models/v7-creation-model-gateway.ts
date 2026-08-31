import type { DatabaseSync } from 'node:sqlite';
import {
  modelProfileKeyForBinding,
  type V7ContextSourceTrace,
  type V7CreationMemberDefinition,
  type V7WorkstationKey
} from '@wenmi/v7-backend';
import { UuidGenerator, type Clock } from '../../domain/ids.js';
import { V7CreationRuntimeRepository } from '../db/repositories/v7-creation-runtime-repository.js';
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

export interface V7CreationModelAdapterResolver {
  resolve(provider: string, modelId: string, purpose: ModelPurpose): ModelAdapter;
}

export interface V7CreationModelRequest {
  requestId: string;
  ownerId: string;
  bookId: string;
  workflowId: string;
  runKind: 'context' | 'option' | 'option_review' | 'outline' | 'manuscript' | 'review' | 'settlement';
  nodeKey: string;
  workstationKey: V7WorkstationKey;
  member: V7CreationMemberDefinition;
  purpose: 'structured_planning' | 'novel_writer' | 'novel_reviewer';
  operationMode: 'fresh' | 'revise' | 'fusion' | 'repair';
  /** 只能引用当前书、当前工作流中已经成功保存的真实模型任务。 */
  basedOnTaskId: string | null;
  /** 当前创作链尚未持久化细粒度作者意见版本；没有证据时必须显式为 null。 */
  authorInstructionVersion: number | null;
  /** 上游资料编辑 Agent 已完成的采用/排除决定；空数组表示仅有历史聚合快照。 */
  sourceTraces: readonly V7ContextSourceTrace[];
  /** Explicit author-approved recovery from one audited unknown call. */
  acknowledgedUnknownRequestId?: string | null;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
}

export interface V7CreationModelResult {
  requestId: string;
  provider: string;
  modelId: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
}

export class V7CreationModelError extends Error {
  public constructor(message: string, public readonly outcomeUnknown = false) { super(message); }
}

export class V7CreationModelGateway {
  private readonly repository: V7CreationRuntimeRepository;
  private readonly activeCalls = new Map<string, Map<string, AbortController>>();
  private readonly genreProfiles: V7BookGenreProfileEnsureService;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly adapters: V7CreationModelAdapterResolver,
    private readonly clock: Clock
  ) {
    this.repository = new V7CreationRuntimeRepository(database);
    this.genreProfiles = new V7BookGenreProfileEnsureService(database, adapters, new UuidGenerator(), clock);
  }

  public cancelWorkflow(workflowId: string): void {
    const calls = this.activeCalls.get(workflowId);
    if (calls === undefined) return;
    for (const controller of calls.values()) {
      controller.abort(new DOMException('任务已停止，成员已停止当前工作。', 'AbortError'));
    }
  }

  public async generate(request: V7CreationModelRequest): Promise<V7CreationModelResult> {
    const existing = this.repository.modelCall(request.requestId);
    if (existing !== undefined) {
      if (existing.owner_id !== request.ownerId || existing.book_id !== request.bookId || existing.workflow_id !== request.workflowId) {
        throw new V7CreationModelError('这次成员工作不属于当前书籍。');
      }
      if (existing.state === 'succeeded' && existing.output_text !== null) {
        return {
          requestId: existing.request_id, provider: existing.provider, modelId: existing.model_id,
          output: existing.output_text, inputTokens: existing.input_tokens ?? 0, outputTokens: existing.output_tokens ?? 0
        };
      }
      if (existing.state === 'working' || existing.state === 'unknown') {
        throw new V7CreationModelError('上一次工作结果还没有确认，已停止重复下单。', true);
      }
      throw new V7CreationModelError(existing.failure_message ?? '上一次工作没有完成。');
    }

    // The request id contains the assigned member.  Historical tasks may be
    // resumed after the live roster has changed, which can otherwise create a
    // different request id for the same logical node.  An unresolved call may
    // already have consumed quota, so never start a second member until that
    // original outcome is known.
    const siblingNodeCalls = this.repository.modelCallsForWorkflow(
      request.ownerId,
      request.bookId,
      request.workflowId
    ).filter((call) => (
      call.run_kind === request.runKind
      && call.node_key === request.nodeKey
      && call.request_id !== request.requestId
    )).sort((left, right) => left.started_at.localeCompare(right.started_at)
      || left.request_id.localeCompare(right.request_id));
    // Preserve every unknown call for audit, but let a later successful takeover
    // become the effective checkpoint for this logical node.  Looking for any
    // historical unknown call would permanently brick all future revisions even
    // after the author explicitly switched members and obtained a valid result.
    const latestSiblingNodeCall = siblingNodeCalls.at(-1);
    const unresolvedNodeCall = latestSiblingNodeCall !== undefined
      && (latestSiblingNodeCall.state === 'working' || latestSiblingNodeCall.state === 'unknown')
      ? latestSiblingNodeCall
      : undefined;
    if (unresolvedNodeCall !== undefined && request.acknowledgedUnknownRequestId !== unresolvedNodeCall.request_id) {
      throw new V7CreationModelError('上一次工作结果还没有确认，已停止跨成员重复下单。', true);
    }

    const taskKind = creationTaskKind(request.runKind, request.workstationKey);
    assertCreationWorkstation(request.runKind, request.workstationKey);
    const lineage = verifiedTaskLineage(this.repository, request);
    const runtimePolicy = resolveV7TaskPolicy(this.database, request.member.memberKey, taskKind);
    const now = this.clock.now().toISOString();
    const promptGovernance = new V7PromptGovernanceRepository(this.database);
    promptGovernance.ensureSourceRegistrySeeded(now);
    let genreProfile;
    try {
      genreProfile = await this.genreProfiles.ensure(request.ownerId, request.bookId);
    } catch (error) {
      throw new V7CreationModelError(
        error instanceof Error ? error.message : '题材工作档案没有准备完成',
        error instanceof V7BookGenreProfileEnsureError && error.outcomeUnknown
      );
    }
    const compiled = compileV7RuntimePrompt({
      requestId: request.requestId,
      ownerId: request.ownerId,
      bookId: request.bookId,
      taskId: request.requestId,
      memberKey: request.member.memberKey,
      runtimeRoleKey: request.member.roleKey,
      modelProfileKey: modelProfileKeyForBinding(request.member.model),
      taskKind,
      workstationKey: request.workstationKey,
      operationMode: request.operationMode,
      basedOnTaskId: lineage.basedOnTaskId,
      authorInstructionVersion: lineage.authorInstructionVersion,
      sourcePrompt: request.prompt,
      // Passing an explicit empty list deliberately disables the shared
      // compiler's compatibility discovery and preserves one aggregate stage
      // snapshot for historical creation tasks without fine-grained evidence.
      sourceTraces: request.sourceTraces,
      promptAssets: promptGovernance.publishedAssets(),
      genreProfile,
      governanceRevision: promptGovernance.summary().revision,
      temperature: runtimePolicy.temperature,
      createdAt: now
    });
    promptGovernance.saveRuntimeBundle(compiled);
    const reasoningTokens = thinkingTokenAllowance(request.member.model.modelId, request.purpose, request.maxOutputTokens);
    // 额度单位是 Token，不能把中文字符数直接当 Token 冻结。真实链方案约
    // 2 个中文字符/Token；继续使用字符数会把 7.8k 输入误报成近 20k，
    // 既阻塞会员额度，也让后台看起来像收到了一份异常巨大的资料包。
    const estimatedPromptTokens = Math.max(
      compiled.contextPack.estimatedTokens,
      Math.ceil(Array.from(compiled.manifest.compiledPrompt).length / 2)
    );
    const reservedTokens = Math.max(8_000, estimatedPromptTokens + request.maxOutputTokens + reasoningTokens);
    assertMembershipAllowsGeneration(this.database, request.ownerId, now, reservedTokens);
    this.repository.beginModelCall({
      requestId: request.requestId, ownerId: request.ownerId, bookId: request.bookId,
      workflowId: request.workflowId, runKind: request.runKind, nodeKey: request.nodeKey,
      memberKey: request.member.memberKey, provider: request.member.model.provider,
      modelId: request.member.model.modelId, plan: request.member.model.plan, purpose: request.purpose,
      promptHash: compiled.manifest.compiledPromptHash, reservedTokens,
      governanceRevision: runtimePolicy.governanceRevision, temperature: runtimePolicy.temperature, now
    });

    try {
      const adapter = this.adapters.resolve(request.member.model.provider, request.member.model.modelId, request.purpose);
      const controller = new AbortController();
      const workflowCalls = this.activeCalls.get(request.workflowId) ?? new Map<string, AbortController>();
      workflowCalls.set(request.requestId, controller);
      this.activeCalls.set(request.workflowId, workflowCalls);
      const result = await adapter.generate({
        requestId: request.requestId,
        taskId: request.workflowId,
        ownerId: request.ownerId,
        bookId: request.bookId,
        agentId: request.member.memberKey,
        prompt: compiled.manifest.compiledPrompt,
        maxOutputTokens: request.maxOutputTokens,
        temperature: runtimePolicy.temperature
      }, controller.signal);
      if (result.output.trim().length === 0) throw new V7CreationModelError('成员没有交回可用内容。');
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
      const normalized = normalizeFailure(error);
      this.repository.failModelCall(request.requestId, normalized.outcomeUnknown ? 'unknown' : 'failed', normalized.message, this.clock.now().toISOString());
      throw new V7CreationModelError(normalized.message, normalized.outcomeUnknown);
    } finally {
      const workflowCalls = this.activeCalls.get(request.workflowId);
      workflowCalls?.delete(request.requestId);
      if (workflowCalls?.size === 0) this.activeCalls.delete(request.workflowId);
    }
  }
}

function creationTaskKind(runKind: V7CreationModelRequest['runKind'], workstationKey: V7WorkstationKey) {
  if (runKind === 'review' && workstationKey === 'chapter_outline') return 'chapter_outline_review' as const;
  return ({ context: 'planning_context', option: 'planning_tree', option_review: 'planning_review',
    outline: 'chapter_outline', manuscript: 'manuscript', review: 'manuscript_review', settlement: 'settlement' } as const)[runKind];
}

function assertCreationWorkstation(
  runKind: V7CreationModelRequest['runKind'],
  workstationKey: V7WorkstationKey
): void {
  const valid = runKind === 'context' || runKind === 'option' || runKind === 'option_review'
    ? workstationKey === 'volume' || workstationKey === 'chain'
    : runKind === 'outline'
      ? workstationKey === 'chapter_outline'
      : runKind === 'manuscript'
        ? workstationKey === 'manuscript'
        : runKind === 'review'
          ? workstationKey === 'review' || workstationKey === 'chapter_outline'
          : workstationKey === 'continuity_record';
  if (!valid) throw new V7CreationModelError(`创作任务工位与调用类型不一致：${runKind}/${workstationKey}`);
}

function verifiedTaskLineage(
  repository: V7CreationRuntimeRepository,
  request: V7CreationModelRequest
): { basedOnTaskId: string | null; authorInstructionVersion: null } {
  if (request.authorInstructionVersion !== null) {
    throw new V7CreationModelError('当前创作链没有可核验的作者意见版本记录，不能伪造作者意见版本。');
  }
  if (request.operationMode === 'fresh') {
    if (request.basedOnTaskId !== null) {
      throw new V7CreationModelError('首次创作任务不能伪装成基于另一项任务的修改。');
    }
    return { basedOnTaskId: null, authorInstructionVersion: null };
  }
  if (request.basedOnTaskId === null) {
    throw new V7CreationModelError('修改、融合或修复必须绑定当前书中真实存在的原模型任务。');
  }
  const basedOn = repository.modelCall(request.basedOnTaskId);
  if (basedOn === undefined || basedOn.owner_id !== request.ownerId || basedOn.book_id !== request.bookId
    || basedOn.workflow_id !== request.workflowId || basedOn.state !== 'succeeded') {
    throw new V7CreationModelError('修改、融合或修复引用的原模型任务不存在、不属于当前书，或尚未成功完成。');
  }
  return { basedOnTaskId: basedOn.request_id, authorInstructionVersion: null };
}

function normalizeFailure(error: unknown): { message: string; outcomeUnknown: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof V7CreationModelError) return { message, outcomeUnknown: error.outcomeUnknown };
  if (error instanceof ModelAdapterError) return { message, outcomeUnknown: error.outcomeUnknown };
  return { message, outcomeUnknown: false };
}
