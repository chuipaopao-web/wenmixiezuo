import { ModelAdapterError, type ModelAdapter, type ModelRequest, type ModelResult } from './model-adapter.js';
import { assertPlanBaseUrl, type ModelPlan, type ModelPurpose } from './model-runtime-config.js';

export interface ArkPlanModelOptions {
  plan: ModelPlan;
  provider: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  purpose: ModelPurpose;
  systemPrompt?: string;
  timeoutMs?: number;
}

interface ArkMessagesResponse {
  content?: Array<{ type?: string; text?: string; thinking?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const SYSTEM_PROMPTS: Record<ModelPurpose, string> = {
  discussion: '你是文秘写作中的小说创作成员。只按当前岗位和当前书籍范围给出明确、可执行的中文意见，不冒充其他成员，不声称执行了未执行的操作。',
  structured_planning: '你是文秘写作中的正式规划成员。严格执行输入中的operation、instructions和outputContract，只输出一个可直接解析的JSON对象，不用Markdown，不写解释、确认请求或后续承诺。',
  novel_writer: '你是文秘写作的主笔。根据输入的章节信息或修改要求输出完整中文小说正文。正文优先达到2700至3200有效字符，且不得少于2350或超过3650，只输出正文，不使用Markdown代码围栏，不写TODO、占位符或解释。正文中禁止出现“前章、上一章、本章、下一章”、章纲、审查、生成或资料包等创作过程说明，承接前文必须直接进入故事。重写时必须返回修改后的完整章节，禁止只返回修改片段、摘要或省略未修改段落；必须逐项落实requiredActions，明确要求删除、后移、合并或避免的表达不得原样复现，也不得仅换近义词保留同一种问题。输出前在内部核对每一项修改要求，但不要输出核对过程。保持人物、时间线和因果连续。',
  novel_reviewer: '你是文秘写作的独立审校。只输出一个JSON对象，不使用Markdown围栏。字段必须为verdict(pass|rewrite|blocked)、summary、issues数组和scores对象；每个issue包含location、issueType、severity(blocker|major|minor|observation)、evidence、requiredAction；scores包含continuity、character、pacing、style、hook五个0至100整数。',
  review_synthesis: '你是文秘写作的主编汇总器。只综合各席结构化报告，不读取正文再做一轮点评。只输出JSON对象，字段必须且只能为panelId、manuscriptVersionId、recommendedVerdict、priorityIssueIndexes、preservedDisagreements、rationale。'
};

export class ArkPlanModelAdapter implements ModelAdapter {
  public readonly provider: string;
  public readonly modelId: string;
  readonly #endpoint: string;

  public constructor(
    private readonly options: ArkPlanModelOptions,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.#endpoint = `${assertPlanBaseUrl(options.plan, options.baseUrl)}/v1/messages`;
    if (options.apiKey.trim().length === 0) throw new Error(`${planDisplayName(options.plan)}凭证未配置`);
  }

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (signal?.aborted === true) throw signal.reason ?? new DOMException('模型调用已取消', 'AbortError');
    // Reasoning-capable plan models can legitimately need more than five minutes for
    // long-form planning and review. Aborting a paid-plan request leaves the remote
    // result unknown and makes a safe retry impossible, so use the documented
    // fifteen-minute safety ceiling while preserving explicit test overrides.
    const timeoutMs = this.options.timeoutMs ?? 900_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000) throw new Error('模型调用超时必须在1秒至15分钟之间');
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = (): void => controller.abort(signal?.reason ?? new DOMException('模型调用已取消', 'AbortError'));
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException(`${planDisplayName(this.options.plan)}模型调用超时`, 'TimeoutError'));
    }, timeoutMs);
    let response: Response;
    // opencodego（opencode.ai/zen/go）的 Messages 网关只认 Anthropic 标准
    // x-api-key 认证头（Bearer 会 401 Missing API key），且其 Kimi 上游把
    // 字符串 content 误判为空消息（400 messages must not be empty），必须
    // 使用文本块数组；火山方舟套餐端点维持原有 Bearer + 字符串 content 不变。
    const opencodegoWire = this.options.plan === 'opencodego';
    try {
      response = await this.fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: {
          ...(opencodegoWire
            ? { 'x-api-key': this.options.apiKey }
            : { authorization: `Bearer ${this.options.apiKey}` }),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          model: this.modelId,
          max_tokens: request.maxOutputTokens,
          ...(requiresVisibleOutput(this.modelId, this.options.purpose) ? { thinking: { type: 'disabled' } } : {}),
          system: appendSupplement(
            this.options.systemPrompt ?? SYSTEM_PROMPTS[this.options.purpose],
            request.supplementalInstructions
          ),
          messages: [{
            role: 'user',
            content: opencodegoWire ? [{ type: 'text', text: request.prompt }] : request.prompt
          }]
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (timedOut) throw new ModelAdapterError(
        `${planDisplayName(this.options.plan)}模型调用在${timeoutMs}毫秒内未完成，供应商结果状态未知`,
        'technical_failure', false, undefined, true
      );
      if (isAborted(signal)) throw signal?.reason ?? new DOMException('模型调用已取消', 'AbortError');
      throw new ModelAdapterError(
        `${planDisplayName(this.options.plan)}请求中断，供应商结果状态未知${error instanceof Error && error.name.length > 0 ? `：${error.name}` : ''}`,
        'technical_failure', false, undefined, true
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
    if (!response.ok) {
      const detail = sanitize(await response.text().catch(() => ''), this.options.apiKey).slice(0, 240);
      const message = `${planDisplayName(this.options.plan)}返回${response.status}${detail.length === 0 ? '' : `：${detail}`}`;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      const failureClass = retryable
        ? 'technical_failure'
        : response.status === 401 || response.status === 403
          ? 'authentication_failure'
          : 'request_failure';
      throw new ModelAdapterError(message, failureClass, retryable, response.status);
    }
    let body: ArkMessagesResponse;
    try {
      body = await response.json() as ArkMessagesResponse;
    } catch {
      throw new ModelAdapterError(`${planDisplayName(this.options.plan)}已返回成功状态但响应无法解析，供应商结果状态未知`,
        'technical_failure', false, response.status, true);
    }
    const output = body.content?.filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text!.trim()).filter(Boolean).join('\n').trim();
    if (output === undefined || output.length === 0) throw new ModelAdapterError(
      `${planDisplayName(this.options.plan)}已执行但没有形成可提交文字（${describeEmptyResponse(body)}）`,
      // A parsed 2xx response is a known, unusable result rather than an unknown
      // provider outcome.  In particular, Kimi can spend the complete allowance
      // on reasoning and stop at max_tokens with an empty text block.  The caller
      // may retry with the task's guarded larger budget without triggering an
      // unsafe editor takeover or leaving a false reconciliation hold.
      'technical_failure', true, response.status, false
    );
    return {
      provider: this.provider,
      modelId: this.modelId,
      output,
      inputTokens: finiteTokenCount(body.usage?.input_tokens),
      outputTokens: finiteTokenCount(body.usage?.output_tokens),
      cashCostCny: 0,
      state: 'succeeded'
    };
  }
}

function describeEmptyResponse(body: ArkMessagesResponse): string {
  const blocks = Array.isArray(body.content) ? body.content : [];
  const types = [...new Set(blocks.map((item) => item.type).filter((value): value is string => typeof value === 'string'))];
  const thinkingCharacters = blocks.reduce(
    (total, item) => total + (typeof item.thinking === 'string' ? item.thinking.length : 0),
    0
  );
  return [
    `停止原因=${typeof body.stop_reason === 'string' ? body.stop_reason : '未知'}`,
    `内容块=${blocks.length}`,
    `类型=${types.length > 0 ? types.join(',') : '无'}`,
    `思考字符=${thinkingCharacters}`,
    `输出Token=${finiteTokenCount(body.usage?.output_tokens)}`
  ].join('，');
}

function planDisplayName(plan: ModelPlan): string {
  if (plan === 'opencodego') return 'opencodego';
  return plan === 'coding' ? '火山方舟Coding Plan' : '火山方舟Agent Plan';
}

function appendSupplement(systemPrompt: string, supplement: string | undefined): string {
  if (supplement === undefined || supplement.trim().length === 0) return systemPrompt;
  return [
    systemPrompt,
    '【老板为本书设置的岗位补充要求】',
    supplement.trim(),
    '以上是软性创作偏好；若与系统硬约束、事实证据、正史、安全或输出格式冲突，以系统硬约束为准。'
  ].join('\n\n');
}

function requiresVisibleOutput(modelId: string, purpose: ModelPurpose): boolean {
  // Kimi K2.7 Code rejects the optional Anthropic-compatible `thinking` field
  // on the Agent Plan endpoint. Keep this capability model-specific.
  if (modelId === 'kimi-k2.7-code') return false;
  // GLM 5.3 同样拒绝 thinking 字段（400 InvalidParameter），但它会直接返回可见内容，
  // 任何用途都不能附加 thinking 参数。2026-08-18 两个方舟套餐端点实测。
  if (modelId.startsWith('glm-5.3')) return false;
  // Review and other machine-readable contracts need a closed, visible JSON
  // result. MiniMax can otherwise spend the whole bounded allowance in a
  // `thinking` block and return no report at all. That is a technical model
  // failure, not evidence that the manuscript failed quality review.
  if (purpose === 'novel_reviewer' || purpose === 'review_synthesis' || purpose === 'structured_planning') return true;
  if (modelId.startsWith('glm-') || modelId.startsWith('kimi-')) return true;
  // DeepSeek's hidden reasoning can consume the complete review allowance before
  // the bounded JSON report is closed.  Disable it only for deterministic review
  // contracts; creative planning keeps the model's normal reasoning behaviour.
  return modelId.startsWith('deepseek-') && purpose !== 'novel_writer';
}

function finiteTokenCount(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value >= 0 ? value : 0;
}

function sanitize(value: string, secret: string): string {
  return secret.length === 0 ? value : value.replaceAll(secret, '***');
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
