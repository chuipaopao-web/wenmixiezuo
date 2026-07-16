import { describe, expect, it, vi } from 'vitest';
import { ArkPlanModelAdapter } from '../../apps/api/src/infrastructure/models/ark-plan-model.js';

const request = {
  requestId: 'request-plan-1',
  taskId: 'task-plan-1',
  ownerId: 'owner-1',
  bookId: 'book-1',
  agentId: 'agent-1',
  prompt: '只回复结果',
  maxOutputTokens: 100
};

describe('火山方舟严格套餐适配器', () => {
  it('只调用Agent Plan Messages端点并将现金费用记为零', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/plan/v1/messages');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer agent-test-key');
      const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number; messages: unknown[] };
      expect(body).toMatchObject({ model: 'kimi-k2-6-modelhub', max_tokens: 100 });
      expect(body.messages).toHaveLength(1);
      return Response.json({
        model: 'kimi-k2.6',
        content: [{ type: 'text', text: '套餐结果' }],
        usage: { input_tokens: 8, output_tokens: 2 }
      });
    });
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent',
      provider: 'volcengine-ark-agent-plan',
      modelId: 'kimi-k2-6-modelhub',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
      apiKey: 'agent-test-key',
      purpose: 'discussion'
    }, fetchImpl);

    await expect(adapter.generate(request)).resolves.toEqual({
      provider: 'volcengine-ark-agent-plan',
      modelId: 'kimi-k2-6-modelhub',
      output: '套餐结果',
      inputTokens: 8,
      outputTokens: 2,
      cashCostCny: 0,
      state: 'succeeded'
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('Coding Plan只能进入/api/coding且不会使用普通Endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/coding/v1/messages');
      return Response.json({ content: [{ type: 'text', text: '正文' }], usage: { input_tokens: 5, output_tokens: 2 } });
    });
    const adapter = new ArkPlanModelAdapter({
      plan: 'coding',
      provider: 'volcengine-ark-coding-plan',
      modelId: 'deepseek-v4-pro',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      apiKey: 'coding-test-key',
      purpose: 'novel_writer'
    }, fetchImpl);

    await adapter.generate(request);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('GLM关闭隐藏思考，确保额度用于岗位最终输出', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
      expect(body.thinking).toEqual({ type: 'disabled' });
      return Response.json({ content: [{ type: 'text', text: '设定结论' }], usage: { input_tokens: 5, output_tokens: 2 } });
    });
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2-260617',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'discussion'
    }, fetchImpl);

    await expect(adapter.generate(request)).resolves.toMatchObject({ output: '设定结论' });
  });

  it('尊重取消并对错误响应脱敏', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled-by-owner'));
    const neverCalled = vi.fn<typeof fetch>();
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent',
      provider: 'volcengine-ark-agent-plan',
      modelId: 'glm-5-2-260617',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
      apiKey: 'secret-must-not-leak',
      purpose: 'novel_reviewer'
    }, neverCalled);

    await expect(adapter.generate(request, controller.signal)).rejects.toThrow('cancelled-by-owner');
    expect(neverCalled).not.toHaveBeenCalled();

    const failing = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2-260617',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'secret-must-not-leak', purpose: 'novel_reviewer'
    }, async () => new Response('{"error":{"message":"denied"}}', { status: 403 }));
    const error = await failing.generate(request).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('403');
    expect((error as Error).message).not.toContain('secret-must-not-leak');
  });

  it('超时会真实中断底层HTTP请求', async () => {
    let observedAbort = false;
    const fetchImpl: typeof fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        observedAbort = true;
        reject(init.signal?.reason);
      }, { once: true });
    });
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2-260617',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key',
      purpose: 'discussion', timeoutMs: 1_000
    }, fetchImpl);

    await expect(adapter.generate(request)).rejects.toThrow(/1000毫秒/u);
    expect(observedAbort).toBe(true);
  });
});
