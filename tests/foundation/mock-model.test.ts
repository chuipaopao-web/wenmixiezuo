import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '../../apps/api/src/infrastructure/models/deterministic-model.js';

const request = {
  requestId: 'request-1',
  taskId: 'task-1',
  ownerId: 'owner-1',
  bookId: 'book-1',
  agentId: 'agent-1',
  prompt: '生成一个测试结果',
  maxOutputTokens: 100
};

describe('确定性假模型', () => {
  it('相同输入生成相同输出且现金费用为零', async () => {
    const adapter = new DeterministicModelAdapter();
    const first = await adapter.generate(request);
    const second = await adapter.generate(request);
    expect(first.output).toBe(second.output);
    expect(first.cashCostCny).toBe(0);
    expect(first.provider).toBe('local-deterministic');
  });

  it('尊重真实取消信号', async () => {
    const adapter = new DeterministicModelAdapter();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(adapter.generate(request, controller.signal)).rejects.toThrow('cancelled');
  });
});

