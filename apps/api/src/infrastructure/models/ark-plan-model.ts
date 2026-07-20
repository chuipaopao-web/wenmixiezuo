import { ModelAdapterError, type ModelAdapter, type ModelRequest, type ModelResult } from './model-adapter.js';
import { assertPlanBaseUrl, type ModelPurpose } from './model-runtime-config.js';

export interface ArkPlanModelOptions {
  plan: 'coding' | 'agent';
  provider: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  purpose: ModelPurpose;
  systemPrompt?: string;
  timeoutMs?: number;
}

interface ArkMessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const SYSTEM_PROMPTS: Record<ModelPurpose, string> = {
  discussion: '你是文秘写作中的小说创作成员。只按当前岗位和当前书籍范围给出明确、可执行的中文意见，不冒充其他成员，不声称执行了未执行的操作。',
  novel_writer: '你是文秘写作的主笔。根据输入的章节信息或修改要求输出完整中文小说正文。正文有效字符必须在2500至3500之间，只输出正文，不使用Markdown代码围栏，不写TODO、占位符或解释。保持人物、时间线和因果连续。',
  novel_reviewer: '你是文秘写作的独立审校。只输出一个JSON对象，不使用Markdown围栏。字段必须为verdict(pass|rewrite|blocked)、summary、issues数组和scores对象；每个issue包含location、issueType、severity(blocker|major|minor|observation)、evidence、requiredAction；scores包含continuity、character、pacing、style、hook五个0至100整数。'
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
    if (options.apiKey.trim().length === 0) throw new Error(`${options.plan} plan凭证未配置`);
  }

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (signal?.aborted === true) throw signal.reason ?? new DOMException('模型调用已取消', 'AbortError');
    const timeoutMs = this.options.timeoutMs ?? 120_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000) throw new Error('方舟模型调用超时必须在1秒至15分钟之间');
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = (): void => controller.abort(signal?.reason ?? new DOMException('模型调用已取消', 'AbortError'));
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('方舟套餐模型调用超时', 'TimeoutError'));
    }, timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          model: this.modelId,
          max_tokens: request.maxOutputTokens,
          ...(requiresVisibleOutput(this.modelId) ? { thinking: { type: 'disabled' } } : {}),
          system: this.options.systemPrompt ?? SYSTEM_PROMPTS[this.options.purpose],
          messages: [{ role: 'user', content: request.prompt }]
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (timedOut) throw new ModelAdapterError(
        `方舟套餐模型调用在${timeoutMs}毫秒内未完成，供应商结果状态未知`,
        'technical_failure', false, undefined, true
      );
      if (isAborted(signal)) throw signal?.reason ?? new DOMException('模型调用已取消', 'AbortError');
      throw new ModelAdapterError(
        `方舟套餐请求中断，供应商结果状态未知${error instanceof Error && error.name.length > 0 ? `：${error.name}` : ''}`,
        'technical_failure', false, undefined, true
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
    if (!response.ok) {
      const detail = sanitize(await response.text().catch(() => ''), this.options.apiKey).slice(0, 240);
      const message = `火山方舟${this.options.plan === 'coding' ? 'Coding Plan' : 'Agent Plan'}返回${response.status}${detail.length === 0 ? '' : `：${detail}`}`;
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
      throw new ModelAdapterError('方舟套餐已返回成功状态但响应无法解析，供应商结果状态未知',
        'technical_failure', false, response.status, true);
    }
    const output = body.content?.filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text!.trim()).filter(Boolean).join('\n').trim();
    if (output === undefined || output.length === 0) throw new ModelAdapterError(
      '火山方舟套餐已执行但没有可提交文字，供应商结果状态未知',
      'technical_failure', false, response.status, true
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

function requiresVisibleOutput(modelId: string): boolean {
  return modelId.startsWith('glm-') || modelId.startsWith('kimi-');
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
