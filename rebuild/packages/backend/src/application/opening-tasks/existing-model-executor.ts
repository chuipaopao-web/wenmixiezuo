import { DomainError } from "../../domain/errors.js";
import { ArkPlanModelAdapter } from "../../infrastructure/models/ark-plan-model.js";
import { ModelAdapterError, type ModelAdapter, type ModelResult } from "../../infrastructure/models/model-adapter.js";
import { thinkingTokenAllowance, type ModelRuntimeConfig } from "../../infrastructure/models/model-runtime-config.js";
import { OpeningTaskService, type OpeningLease } from "./service.js";

export interface ExistingOpeningModelInput {
  lease: OpeningLease;
  step: string;
  memberKey: string;
  provider: string;
  modelId: string;
  /** Exact compiled prompt from the existing opening workflow; never rebuilt here. */
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
}
export type OpeningModelResolver = (provider: string, modelId: string) => ModelAdapter;

/** Same production-only resolution checks as the old factory; no deterministic fallback. */
export function existingOpeningModelResolver(config: ModelRuntimeConfig, fetchImpl: typeof fetch = fetch): OpeningModelResolver {
  return (provider, modelId) => {
    const endpoint = [config.endpoints.coding, config.endpoints.agent].find(item => item.provider === provider);
    const profiles = [...Object.values(config.roleProfiles), ...config.publicProfiles];
    if (config.activeMode !== "subscription-plan" || !endpoint?.apiKey || !profiles.some(p => p.provider === provider && p.modelId === modelId)) {
      throw new DomainError("CONFIGURATION_INVALID", "当前开书成员的模型连接尚未配置完成。");
    }
    return new ArkPlanModelAdapter({ plan: endpoint.plan, provider, modelId, baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, purpose: "structured_planning" }, fetchImpl);
  };
}

/** Bridges the existing transport to PG task/usage records; all inputs are trusted internal values. */
export class ExistingOpeningModelExecutor {
  constructor(private readonly tasks: OpeningTaskService, private readonly resolve: OpeningModelResolver) {}

  async execute(input: ExistingOpeningModelInput, signal?: AbortSignal): Promise<ModelResult> {
    if (signal?.aborted) throw new DomainError("TASK_NOT_CLAIMABLE", "本次执行已取消。");
    if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 150_000
      || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 100_000
      || typeof input.memberKey !== "string" || !input.memberKey.trim() || input.memberKey.length > 120
      || (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2))) {
      throw new DomainError("TASK_REQUEST_INVALID", "开书模型输入或预算不正确。");
    }
    // Validate configured credentials/model before recording dispatch intent.
    const adapter = this.resolve(input.provider, input.modelId);
    if (adapter.provider !== input.provider || adapter.modelId !== input.modelId) throw new DomainError("CONFIGURATION_INVALID", "模型连接与当前成员不一致。");
    const reserved = Math.max(8_000, input.prompt.length + input.maxOutputTokens
      + thinkingTokenAllowance(input.modelId, "structured_planning", input.maxOutputTokens, input.prompt.length));
    const callId = await this.tasks.beginCall(input.lease, input.step, adapter.provider, adapter.modelId, reserved);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let heartbeat: Promise<void> | null = null;
    const timer = setInterval(() => {
      if (heartbeat !== null) return;
      heartbeat = this.tasks.renew(input.lease).catch(() => { controller.abort(); }).finally(() => { heartbeat = null; });
    }, 10_000);
    timer.unref();
    let result: ModelResult;
    try {
      result = await adapter.generate({ requestId: callId, taskId: input.lease.taskId, ownerId: input.lease.ownerId,
        bookId: `v7-prebook:${input.lease.taskId}`, agentId: input.memberKey, prompt: input.prompt,
        maxOutputTokens: input.maxOutputTokens, ...(input.temperature === undefined ? {} : { temperature: input.temperature }) }, controller.signal);
    } catch (error) {
      // Only an explicit rejected HTTP request proves no generation occurred. Timeouts/aborts stay unknown.
      if (error instanceof ModelAdapterError && !error.outcomeUnknown && [400,401,403,404,429].includes(error.statusCode ?? 0)) {
        await this.tasks.recordReceipt(input.lease.taskId, input.lease.ownerId, callId, {
          inputTokens: 0, outputTokens: 0, result: null, outcome: "not_started", evidence: `供应商明确拒绝请求，HTTP ${error.statusCode}`
        });
        throw new ModelAdapterError("模型服务明确拒绝了本次请求，已有结果已保留。", error.failureClass, error.retryable, error.statusCode, false);
      } else {
        await this.tasks.markCallUnknown(input.lease.taskId, input.lease.ownerId, callId);
      }
      // Never pass vendor response bodies/credentials into public errors or task evidence.
      throw new ModelAdapterError("本次模型执行结果未确认，请读取任务状态和已保存结果。", "technical_failure", false, undefined, true);
    } finally {
      clearInterval(timer);
      signal?.removeEventListener("abort", cancel);
      if (heartbeat !== null) await heartbeat;
    }
    if (result.provider !== input.provider || result.modelId !== input.modelId) {
      await this.tasks.markCallUnknown(input.lease.taskId, input.lease.ownerId, callId);
      throw new DomainError("TASK_EXTERNAL_CHECK_REQUIRED", "模型返回来源不一致，已暂停核对。");
    }
    // Save the raw visible result and actual usage before the existing engine parses/reviews it.
    // No reasoning content is returned by the preserved transport.
    const saved = await this.tasks.recordReceipt(input.lease.taskId, input.lease.ownerId, callId, {
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, result: { ...result }, outcome: "continue"
    });
    if (saved.status !== "queued") throw new DomainError("TASK_NOT_CLAIMABLE", "模型返回已保存，本次任务暂不继续。");
    return result;
  }
}
