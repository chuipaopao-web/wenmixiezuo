import { describe, expect, it, vi } from 'vitest';
import {
  CodexSubscriptionModelAdapter,
  type CodexProcessRunner
} from '../../apps/api/src/infrastructure/models/codex-subscription-model.js';
import { ModelAdapterError } from '../../apps/api/src/infrastructure/models/model-adapter.js';
import { buildRoleSystemPrompt } from '../../apps/api/src/domain/role-prompts.js';

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
      expect(input.args).toContain('model_reasoning_effort="xhigh"');
      expect(input.prompt).toContain('秋香（主笔）');
      expect(input.prompt).toContain('优先输出2700至3200');
      expect(input.prompt).toContain('不得少于2350或超过3650');
      expect(input.prompt).toContain('不得调用工具');
      return { output: '完整章节正文', inputTokens: 120, outputTokens: 2800 };
    });
    const adapter = new CodexSubscriptionModelAdapter({
      executable: 'codex', provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol',
      workingDirectory: 'D:\\wenmixiezuo\\data\\cache\\codex-runtime', timeoutMs: 180_000,
      purpose: 'novel_writer', systemPrompt: buildRoleSystemPrompt('writer', 'novel_writer')
    }, { run });

    await expect(adapter.generate(request)).resolves.toMatchObject({
      provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol', output: '完整章节正文',
      inputTokens: 120, outputTokens: 2800, cashCostCny: 0, state: 'succeeded'
    });
  });

  it('开放对话使用中等推理强度而不是按整章最高强度运行', async () => {
    const run = vi.fn<CodexProcessRunner['run']>(async (input) => {
      expect(input.args).toContain('model_reasoning_effort="medium"');
      return { output: '请先确认主角、机制和首副本。', inputTokens: 80, outputTokens: 30 };
    });
    const adapter = new CodexSubscriptionModelAdapter({
      executable: 'codex', provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol',
      workingDirectory: 'D:\\wenmixiezuo\\data\\cache\\codex-runtime', timeoutMs: 180_000,
      purpose: 'discussion', systemPrompt: buildRoleSystemPrompt('chief_editor', 'discussion')
    }, { run });

    await expect(adapter.generate(request)).resolves.toMatchObject({
      output: '请先确认主角、机制和首副本。', cashCostCny: 0
    });
  });

  it('调用前已取消时不启动Codex进程', async () => {
    const run = vi.fn<CodexProcessRunner['run']>();
    const adapter = new CodexSubscriptionModelAdapter({
      executable: 'codex', provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol',
      workingDirectory: 'D:\\wenmixiezuo\\data\\cache\\codex-runtime', timeoutMs: 180_000,
      purpose: 'discussion', systemPrompt: buildRoleSystemPrompt('chief_editor', 'discussion')
    }, { run });
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(adapter.generate(request, controller.signal)).rejects.toThrow('cancelled');
    expect(run).not.toHaveBeenCalled();
  });

  it('子进程中断后冻结为订阅结果未知而不是自动重复调用', async () => {
    const adapter = new CodexSubscriptionModelAdapter({
      executable: 'codex', provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol',
      workingDirectory: 'D:\\wenmixiezuo\\data\\cache\\codex-runtime', timeoutMs: 180_000,
      purpose: 'discussion', systemPrompt: buildRoleSystemPrompt('chief_editor', 'discussion')
    }, { run: async () => { throw new Error('process closed'); } });

    const error = await adapter.generate(request).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelAdapterError);
    expect(error).toMatchObject<Partial<ModelAdapterError>>({
      failureClass: 'technical_failure', retryable: false, outcomeUnknown: true
    });
  });
});
