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

export class ModelAdapterError extends Error {
  public constructor(
    message: string,
    public readonly failureClass: ModelFailureClass,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    public readonly outcomeUnknown = false,
    public readonly knownUsage?: {inputTokens:number;outputTokens:number;cashCostCny:number},
    /** 机器可读失败原因（兼容可选）：输出长度截断='output_length_limit'。调用方按此分型，不解析message文本。 */
    public readonly causeCode?: 'output_length_limit'
  ) {
    super(message);
    this.name = 'ModelAdapterError';
  }
}
