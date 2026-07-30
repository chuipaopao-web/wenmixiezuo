import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '../../apps/api/src/infrastructure/models/deterministic-model.js';
import { parseMasterOutlineDepositOutput } from '../../apps/api/src/application/artifacts/planning-artifact-service.js';

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

  it('在零费用测试模式为不同规划阶段返回各自的结构合同', async () => {
    const adapter = new DeterministicModelAdapter();
    const master = await adapter.generate({
      ...request,
      prompt: '你是当前书籍的活动主编。剧情总纲落库 输出合同'
    });
    const volume = await adapter.generate({
      ...request,
      prompt: '你是当前书籍的活动主编。卷纲落库 输出合同'
    });
    const chapters = await adapter.generate({
      ...request,
      prompt: '你是当前书籍的活动主编。规划落库 输出合同'
    });

    expect(master.output).toContain('剧情总纲落库');
    const parsedMaster = parseMasterOutlineDepositOutput(master.output);
    expect(parsedMaster?.outlineSchema).toBe('stage_master_v2');
    expect(parsedMaster?.majorStages[0]?.chapterRange).toEqual({ start: 1, end: 50 });
    expect(parsedMaster?.majorStages[0]?.pendingThreads).toBeDefined();
    expect(volume.output).toContain('卷纲落库');
    expect(chapters.output).toContain('规划落库');
    expect(master.output).not.toBe(volume.output);
  });
});
