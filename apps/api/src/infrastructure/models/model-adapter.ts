export type ModelCallState = 'pending' | 'working' | 'succeeded' | 'failed' | 'interrupted';

export interface ModelRequest {
  requestId: string;
  taskId: string;
  ownerId: string;
  bookId: string;
  agentId: string;
  prompt: string;
  maxOutputTokens: number;
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
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>;
}

