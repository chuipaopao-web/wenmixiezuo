import { createHash } from 'node:crypto';
import type { ModelAdapter, ModelRequest, ModelResult } from './model-adapter.js';

export class DeterministicModelAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic';
  public readonly modelId = 'wenmi-fixture-v1';

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (signal?.aborted === true) {
      throw signal.reason ?? new DOMException('调用已取消', 'AbortError');
    }
    const digest = createHash('sha256')
      .update(`${request.bookId}\n${request.agentId}\n${request.prompt}`)
      .digest('hex');
    const output = `【确定性假模型 ${digest.slice(0, 12)}】已根据任务 ${request.taskId} 生成可复现结果。`;
    return {
      provider: this.provider,
      modelId: this.modelId,
      output,
      inputTokens: Math.ceil(request.prompt.length / 2),
      outputTokens: Math.ceil(output.length / 2),
      cashCostCny: 0,
      state: 'succeeded'
    };
  }
}

