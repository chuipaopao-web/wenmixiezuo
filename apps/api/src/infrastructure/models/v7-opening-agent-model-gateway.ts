import type { DatabaseSync } from 'node:sqlite';
import {
  OpeningAgentModelError,
  modelProfileKeyForBinding,
  validateMemberModelPolicy,
  type OpeningAgentModelGateway,
  type OpeningModelRequest,
  type OpeningModelResult,
  type OpeningReconciliationRequest,
  type OpeningReconciliation,
  type V7AgentFailureClass
} from '@wenmi/v7-backend';
import type { Clock } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertMembershipAllowsGeneration } from '../security/membership-service.js';
import type { ModelAdapter } from './model-adapter.js';
import { ModelAdapterError } from './model-adapter.js';
import type { ModelPurpose } from './model-runtime-config.js';
import { thinkingTokenAllowance } from './model-runtime-config.js';
import { resolveV7TaskPolicy } from '../../application/agents/v7-agent-runtime-policy.js';
import { compileV7RuntimePrompt } from '../../application/agents/v7-runtime-prompt-compiler.js';
import { V7PromptGovernanceRepository } from '../db/repositories/v7-prompt-governance-repository.js';

export interface V7OpeningModelAdapterResolver {
  resolve(provider: string, modelId: string, purpose: ModelPurpose): ModelAdapter;
}

interface CallRow {
  request_id: string;
  owner_id: string;
  task_id: string;
  node_key: string;
  member_key: string;
  provider: string;
  model_id: string;
  state: 'working' | 'succeeded' | 'failed' | 'unknown';
  input_tokens: number | null;
  output_tokens: number | null;
  output_text: string | null;
  failure_class: V7AgentFailureClass | null;
  failure_message: string | null;
  task_contract_json: string | null;
}

export class V7OpeningAgentModelGateway implements OpeningAgentModelGateway {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly adapters: V7OpeningModelAdapterResolver,
    private readonly clock: Clock
  ) {}

  public async generate(request: OpeningModelRequest): Promise<OpeningModelResult> {
    const policyErrors = validateMemberModelPolicy(request.member);
    if (policyErrors.length > 0) throw new OpeningAgentModelError(policyErrors.join('；'), 'credential_unavailable');
    this.assertOpeningTaskScope(request.ownerId, request.taskId);
    const existing = this.row(request.requestId);
    if (existing !== undefined) return this.resolveExisting(existing, request);
    this.verifyLineage(request);

    const runtimePolicy = resolveV7TaskPolicy(this.database, request.member.memberKey, request.taskKind);
    const now = this.clock.now().toISOString();
    const promptGovernance = new V7PromptGovernanceRepository(this.database);
    promptGovernance.ensureSourceRegistrySeeded(now);
    const compiled = compileV7RuntimePrompt({
      requestId: request.requestId,
      ownerId: request.ownerId,
      bookId: `v7-prebook:${request.taskId}`,
      taskId: request.requestId,
      memberKey: request.member.memberKey,
      runtimeRoleKey: request.member.roleKey,
      modelProfileKey: modelProfileKeyForBinding(request.member.model),
      taskKind: request.taskKind,
      workstationKey: request.workstationKey,
      operationMode: request.operationMode,
      authorInstructionVersion: request.authorInstructionVersion,
      basedOnTaskId: request.basedOnTaskId,
      sourcePrompt: request.prompt,
      sourceTraces: request.sourceTraces,
      promptAssets: promptGovernance.publishedAssets(),
      governanceRevision: promptGovernance.summary().revision,
      temperature: runtimePolicy.temperature,
      createdAt: now
    });
    const reasoningTokens = thinkingTokenAllowance(
      request.member.model.modelId,
      'structured_planning',
      request.maxOutputTokens
    );
    const reservedTokens = Math.max(8_000, compiled.manifest.compiledPrompt.length + request.maxOutputTokens + reasoningTokens);
    try {
      assertMembershipAllowsGeneration(this.database, request.ownerId, now, reservedTokens);
    } catch (error) {
      if (error instanceof DomainError && MEMBERSHIP_GENERATION_ERRORS.has(error.code)) {
        throw new OpeningAgentModelError(error.message, 'budget_exhausted', false, error.code);
      }
      throw error;
    }
    this.database.prepare(`
      INSERT INTO v7_opening_agent_model_calls (
        request_id, owner_id, task_id, node_key, member_key, provider, model_id, plan,
        state, prompt_hash, reserved_tokens, governance_revision, temperature,
        task_contract_json, context_pack_json, prompt_manifest_json,
        started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.requestId, request.ownerId, request.taskId, request.nodeKey, request.member.memberKey,
      request.member.model.provider, request.member.model.modelId, request.member.model.plan,
      compiled.manifest.compiledPromptHash, reservedTokens,
      runtimePolicy.governanceRevision, runtimePolicy.temperature,
      JSON.stringify(compiled.taskContract), JSON.stringify(compiled.contextPack), JSON.stringify(compiled.manifest),
      now, now, now
    );

    try {
      const adapter = this.adapters.resolve(
        request.member.model.provider,
        request.member.model.modelId,
        'structured_planning'
      );
      const result = await adapter.generate({
        requestId: request.requestId,
        taskId: request.taskId,
        ownerId: request.ownerId,
        bookId: `v7-prebook:${request.taskId}`,
        agentId: request.member.memberKey,
        prompt: compiled.manifest.compiledPrompt,
        maxOutputTokens: request.maxOutputTokens,
        temperature: runtimePolicy.temperature
      });
      if (result.output.trim().length === 0) {
        const error = new OpeningAgentModelError('模型没有返回可见内容', 'empty_response');
        this.markFailed(request, error.failureClass, error.message);
        throw error;
      }
      const completedAt = this.clock.now().toISOString();
      const updated = this.database.prepare(`
        UPDATE v7_opening_agent_model_calls
        SET state = 'succeeded', input_tokens = ?, output_tokens = ?, cash_micros = ?, output_text = ?,
            completed_at = ?, updated_at = ?
        WHERE request_id = ? AND owner_id = ? AND task_id = ? AND node_key = ? AND member_key = ?
          AND state = 'working'
      `).run(
        Math.max(0, result.inputTokens), Math.max(0, result.outputTokens),
        Math.max(0, Math.round(result.cashCostCny * 1_000_000)), result.output,
        completedAt, completedAt, request.requestId, request.ownerId, request.taskId,
        request.nodeKey, request.member.memberKey
      );
      if (updated.changes !== 1) throw new OpeningAgentModelError('模型调用状态已经变化，拒绝重复结算', 'outcome_unknown', true);
      return {
        requestId: request.requestId,
        provider: result.provider,
        modelId: result.modelId,
        output: result.output,
        inputTokens: Math.max(0, result.inputTokens),
        outputTokens: Math.max(0, result.outputTokens)
      };
    } catch (error) {
      if (error instanceof OpeningAgentModelError) throw error;
      const normalized = normalizeFailure(error);
      if (normalized.outcomeUnknown) this.markUnknown(request, normalized.failureClass, normalized.message);
      else this.markFailed(request, normalized.failureClass, normalized.message);
      throw new OpeningAgentModelError(normalized.message, normalized.failureClass, normalized.outcomeUnknown);
    }
  }

  public async reconcile(request: OpeningReconciliationRequest): Promise<OpeningReconciliation> {
    this.assertOpeningTaskScope(request.ownerId, request.taskId);
    const row = this.row(request.requestId);
    if (row === undefined) return { status: 'unknown' };
    this.assertRowScope(row, request);
    if (row.state === 'succeeded') return { status: 'succeeded', result: resultFromRow(row) };
    if (row.state === 'failed') {
      return {
        status: 'failed',
        failureClass: row.failure_class ?? 'provider_unavailable',
        message: row.failure_message ?? '模型调用没有完成'
      };
    }
    if (row.state === 'working') {
      this.markUnknown(request, 'outcome_unknown', '进程恢复时供应商结果无法确认');
    }
    return { status: 'unknown' };
  }

  private row(requestId: string): CallRow | undefined {
    return this.database.prepare(`
      SELECT request_id, owner_id, task_id, node_key, member_key, provider, model_id, state, input_tokens, output_tokens,
             output_text, failure_class, failure_message, task_contract_json
      FROM v7_opening_agent_model_calls WHERE request_id = ?
    `).get(requestId) as CallRow | undefined;
  }

  private resolveExisting(row: CallRow, request: OpeningModelRequest): OpeningModelResult {
    this.assertRowScope(row, request);
    this.assertStoredContract(row, request);
    if (row.provider !== request.member.model.provider || row.model_id !== request.member.model.modelId) {
      throw new OpeningAgentModelError('模型调用检查点与冻结成员绑定不一致', 'version_changed');
    }
    if (row.state === 'succeeded') return resultFromRow(row);
    if (row.state === 'failed') {
      throw new OpeningAgentModelError(
        row.failure_message ?? '模型调用已经失败',
        row.failure_class ?? 'provider_unavailable'
      );
    }
    throw new OpeningAgentModelError('模型调用结果尚未确认，必须先对账', 'outcome_unknown', true);
  }

  private markFailed(
    request: Pick<OpeningModelRequest, 'requestId' | 'ownerId' | 'taskId' | 'nodeKey' | 'member'>,
    failureClass: V7AgentFailureClass,
    message: string
  ): void {
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      UPDATE v7_opening_agent_model_calls
      SET state = 'failed', failure_class = ?, failure_message = ?, completed_at = ?, updated_at = ?
      WHERE request_id = ? AND owner_id = ? AND task_id = ? AND node_key = ? AND member_key = ?
        AND state = 'working'
    `).run(
      failureClass, message.slice(0, 1_000), now, now,
      request.requestId, request.ownerId, request.taskId, request.nodeKey, request.member.memberKey
    );
  }

  private markUnknown(
    request: (
      Pick<OpeningModelRequest, 'requestId' | 'ownerId' | 'taskId' | 'nodeKey' | 'member'>
      | OpeningReconciliationRequest
    ),
    failureClass: V7AgentFailureClass,
    message: string
  ): void {
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      UPDATE v7_opening_agent_model_calls
      SET state = 'unknown', failure_class = ?, failure_message = ?, updated_at = ?
      WHERE request_id = ? AND owner_id = ? AND task_id = ? AND node_key = ? AND member_key = ?
        AND state = 'working'
    `).run(
      failureClass, message.slice(0, 1_000), now,
      request.requestId, request.ownerId, request.taskId, request.nodeKey,
      'member' in request ? request.member.memberKey : request.memberKey
    );
  }

  private assertOpeningTaskScope(ownerId: string, taskId: string): void {
    const row = this.database.prepare(`
      SELECT 1 FROM v7_opening_agent_tasks WHERE owner_id = ? AND task_id = ?
    `).get(ownerId, taskId);
    if (row === undefined) {
      throw new OpeningAgentModelError('开书模型任务不存在或不属于当前账号', 'version_changed');
    }
  }

  private assertRowScope(
    row: CallRow,
    request: Pick<OpeningModelRequest, 'ownerId' | 'taskId' | 'nodeKey'> & { memberKey?: string; member?: { memberKey: string } }
  ): void {
    const memberKey = request.member?.memberKey ?? request.memberKey;
    if (
      row.owner_id !== request.ownerId
      || row.task_id !== request.taskId
      || row.node_key !== request.nodeKey
      || (memberKey !== undefined && row.member_key !== memberKey)
    ) {
      throw new OpeningAgentModelError('模型调用检查点不存在或不属于当前开书任务', 'version_changed');
    }
  }

  private verifyLineage(request: OpeningModelRequest): void {
    if (request.authorInstructionVersion !== null && (
      !Number.isInteger(request.authorInstructionVersion) || request.authorInstructionVersion < 1
    )) {
      throw new OpeningAgentModelError('作者调整版本无效', 'version_changed');
    }
    if (request.operationMode === 'fresh') {
      if (request.basedOnTaskId !== null) {
        throw new OpeningAgentModelError('首次开书模型任务不能绑定历史请求', 'version_changed');
      }
      return;
    }
    if (request.basedOnTaskId === null || request.basedOnTaskId === request.requestId) {
      throw new OpeningAgentModelError('开书修改或修复缺少上一真实模型请求', 'version_changed');
    }
    const source = this.database.prepare(`
      SELECT request_id, member_key FROM v7_opening_agent_model_calls
      WHERE request_id = ? AND owner_id = ? AND task_id = ? AND node_key = ? AND state = 'succeeded'
      LIMIT 1
    `).get(request.basedOnTaskId, request.ownerId, request.taskId, request.nodeKey) as {
      request_id: string;
      member_key: string;
    } | undefined;
    if (source === undefined) {
      throw new OpeningAgentModelError('开书修改或修复来源不存在、未成功或不属于当前任务', 'version_changed');
    }
    if (request.operationMode === 'repair' && source.member_key !== request.member.memberKey) {
      throw new OpeningAgentModelError('格式修复必须由原成员绑定上一真实模型结果', 'version_changed');
    }
  }

  private assertStoredContract(row: CallRow, request: OpeningModelRequest): void {
    // 0091之前的历史调用没有冻结任务合同；继续按owner/task/node/member兼容恢复。
    if (row.task_contract_json === null) return;
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(row.task_contract_json) as Record<string, unknown>;
    } catch {
      throw new OpeningAgentModelError('模型调用检查点合同无法读取', 'version_changed');
    }
    const expected = {
      taskKind: request.taskKind,
      workstationKey: request.workstationKey,
      operationMode: request.operationMode,
      basedOnTaskId: request.basedOnTaskId,
      authorInstructionVersion: request.authorInstructionVersion
    } as const;
    for (const [key, value] of Object.entries(expected)) {
      if (Object.prototype.hasOwnProperty.call(stored, key) && stored[key] !== value) {
        throw new OpeningAgentModelError('模型调用检查点与当前显式任务合同不一致', 'version_changed');
      }
    }
  }
}

const MEMBERSHIP_GENERATION_ERRORS = new Set<string>([
  errorCodes.membershipRequired,
  errorCodes.membershipExpired,
  errorCodes.membershipQuotaExhausted
]);

function resultFromRow(row: CallRow): OpeningModelResult {
  if (row.output_text === null) throw new OpeningAgentModelError('成功调用缺少可恢复输出', 'outcome_unknown', true);
  return {
    requestId: row.request_id,
    provider: row.provider,
    modelId: row.model_id,
    output: row.output_text,
    inputTokens: Math.max(0, row.input_tokens ?? 0),
    outputTokens: Math.max(0, row.output_tokens ?? 0)
  };
}

function normalizeFailure(error: unknown): {
  failureClass: V7AgentFailureClass;
  message: string;
  outcomeUnknown: boolean;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ModelAdapterError) {
    if (error.outcomeUnknown) return { failureClass: 'outcome_unknown', message, outcomeUnknown: true };
    if (error.failureClass === 'authentication_failure') {
      return { failureClass: 'credential_unavailable', message, outcomeUnknown: false };
    }
    if (error.statusCode === 429) return { failureClass: 'rate_limited', message, outcomeUnknown: false };
    if (/timeout|超时/iu.test(message)) return { failureClass: 'timeout', message, outcomeUnknown: false };
    if (/network|fetch|socket|连接/iu.test(message)) return { failureClass: 'network_failure', message, outcomeUnknown: false };
    return { failureClass: 'provider_unavailable', message, outcomeUnknown: false };
  }
  if (/凭证|api.?key|subscription-plan|套餐/iu.test(message)) {
    return { failureClass: 'credential_unavailable', message, outcomeUnknown: false };
  }
  return { failureClass: 'provider_unavailable', message, outcomeUnknown: false };
}
