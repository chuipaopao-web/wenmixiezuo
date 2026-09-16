export type ModelCallState = 'pending' | 'working' | 'succeeded' | 'failed' | 'interrupted';

export interface ModelRequest {
  requestId: string;
  taskId: string;
  ownerId: string;
  bookId: string;
  agentId: string;
  prompt: string;
  /** Trusted gateway task kind; scopes model protocol changes to verified nodes. */
  executionKind?: 'opening_design';
  supplementalInstructions?: string;
  maxOutputTokens: number;
  /** 可信调用方按节点预算策略显式指定的推理余量（Token），覆盖按模型/用途的默认折算；
   * 仅时间机器大综合节点等有实测证据的调用点使用；未提供时走默认策略。 */
  thinkingHeadroomTokens?: number;
  temperature?: number;
}

export interface ModelResult {
  provider: string;
  modelId: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
  cashCostCny: number;
  state: Extract<ModelCallState, 'succeeded'>;
}

export interface ModelAdapter {
  readonly provider: string;
  readonly modelId: string;
  /** Exact serialized model-visible input, including adapter-added system text. */
  inputContext?(request: Pick<ModelRequest, 'prompt' | 'supplementalInstructions' | 'executionKind'>): string;
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>;
}

export type ModelFailureClass = 'technical_failure' | 'authentication_failure' | 'request_failure';

/** 白名单脱敏的供应商失败诊断（2026-09-16 ab8464c4端到端A节点400缺具体原因）。
 * 只允许机器可读token：供应商错误code、请求ID、参数名；绝不包含供应商自由文本、
 * 提示词、密钥、思维链或作者内容。网关可将这些token并入diagnosticCode供离线诊断，
 * 不得把供应商正文透传给作者UI。 */
export interface VendorFailureDiagnostic {
  code?: string;
  requestId?: string;
  param?: string;
}

/** 截断安全统计（2026-09-16 1f831c6a复核项2）：只存数值/枚举——停止原因、可见文本
 * 字符数（长度，不存内容）、是否含推理块、供应商明确上报的分项token；分项未上报
 * 一律null，不按总差值猜测。绝不包含部分正文、思维链、提示词或密钥；不改变
 * known/unknown计量，截断仍是失败。 */
export interface TruncationDiagnostic {
  stopReason: string;
  visibleTextChars: number;
  thinkingBlocksPresent: boolean;
  reasoningTokens: number | null;
  visibleTokens: number | null;
}

export class ModelAdapterError extends Error {
  public constructor(
    message: string,
    public readonly failureClass: ModelFailureClass,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    public readonly outcomeUnknown = false,
    public readonly knownUsage?: {inputTokens:number;outputTokens:number;cashCostCny:number},
    /** 机器可读失败原因（兼容可选）：输出长度截断='output_length_limit'。调用方按此分型，不解析message文本。 */
    public readonly causeCode?: 'output_length_limit',
    public readonly vendorDiagnostic?: VendorFailureDiagnostic,
    public readonly truncationDiagnostic?: TruncationDiagnostic
  ) {
    super(message);
    this.name = 'ModelAdapterError';
  }
}
