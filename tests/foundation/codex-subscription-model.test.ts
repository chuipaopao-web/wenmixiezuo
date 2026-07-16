import { describe, expect, it, vi } from 'vitest';
import {
  CodexSubscriptionModelAdapter,
  type CodexProcessRunner
} from '../../apps/api/src/infrastructure/models/codex-subscription-model.js';

const request = {
  requestId: 'request-codex-1', taskId: 'task-codex-1', ownerId: 'owner-1', bookId: 'book-1',
  agentId: 'agent-1', prompt: '写第一章', maxOutputTokens: 8_000
};

describe('Codex订阅模型适配器', () => {
  it('使用GPT-5.6 Sol、临时只读模式且现金费用为零', async () => {
    const run = vi.fn<CodexProcessRunner['run']>(async (input) => {
      expect(input.args).toEqual(expect.arrayContaining([
        'exec', '--ephemeral', '--ignore-user-config', '--model', 'gpt-5.6-sol', '--sandbox', 'read-only', '--json', '-'
      ]));
      expect(input.prompt).toContain('秋香（主笔）');
      expect(input.prompt).toContain('2500至3500');
      expect(input.prompt).toContain('不得调用工具');
      return { output: '完整章节正文', inputTokens: 120, outputTokens: 2800 };
    });
    const adapter = new CodexSubscriptionModelAdapter({
      executable: 'codex', provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol',
      workingDirectory: 'D:\\wenmixiezuo\\data\\cache\\codex-runtime', timeoutMs: 180_000,
      purpose: 'novel_writer', roleKey: 'writer'
    }, { run });

    await expect(adapter.generate(request)).resolves.toMatchObject({
      provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol', output: '完整章节正文',
      inputTokens: 120, outputTokens: 2800, cashCostCny: 0, state: 'succeeded'
    });
  });

  it('调用前已取消时不启动Codex进程', async () => {
    const run = vi.fn<CodexProcessRunner['run']>();
    const adapter = new CodexSubscriptionModelAdapter({
      executable: 'codex', provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol',
      workingDirectory: 'D:\\wenmixiezuo\\data\\cache\\codex-runtime', timeoutMs: 180_000,
      purpose: 'discussion', roleKey: 'chief_editor'
    }, { run });
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(adapter.generate(request, controller.signal)).rejects.toThrow('cancelled');
    expect(run).not.toHaveBeenCalled();
  });
});

