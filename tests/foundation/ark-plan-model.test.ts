import { describe, expect, it, vi } from 'vitest';
import { ArkPlanModelAdapter } from '../../apps/api/src/infrastructure/models/ark-plan-model.js';
import { ModelAdapterError } from '../../apps/api/src/infrastructure/models/model-adapter.js';

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
      const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number; messages: unknown[]; thinking?: { type?: string } };
      expect(body).toMatchObject({ model: 'kimi-k2-6-modelhub', max_tokens: 100 });
      expect(body.thinking).toEqual({ type: 'disabled' });
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
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/coding/v1/messages');
      const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
      expect(body.thinking).toBeUndefined();
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

  it('DeepSeek事实点评关闭隐藏思考以保留完整JSON输出额度', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
      expect(body.thinking).toEqual({ type: 'disabled' });
      return Response.json({ content: [{ type: 'text', text: '{"verdict":"pass"}' }], usage: { input_tokens: 5, output_tokens: 8 } });
    });
    const adapter = new ArkPlanModelAdapter({
      plan: 'coding', provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', apiKey: 'coding-test-key', purpose: 'novel_reviewer'
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

  it('主笔重写系统合同明确禁止只返回修改片段', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { system?: string };
      expect(body.system).toContain('修改后的完整章节');
      expect(body.system).toContain('禁止只返回修改片段');
      return Response.json({ content: [{ type: 'text', text: '完整正文' }], usage: { input_tokens: 5, output_tokens: 2 } });
    });
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2-260617',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'novel_writer'
    }, fetchImpl);

    await expect(adapter.generate(request)).resolves.toMatchObject({ output: '完整正文' });
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
    expect(error).toMatchObject<Partial<ModelAdapterError>>({ failureClass: 'authentication_failure', retryable: false, statusCode: 403 });
    expect((error as Error).message).toContain('403');
    expect((error as Error).message).not.toContain('secret-must-not-leak');
  });

  it('只把限流和服务端故障标记为可重试技术错误', async () => {
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2-260617',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'discussion'
    }, async () => new Response('rate limited', { status: 429 }));

    const error = await adapter.generate(request).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelAdapterError);
    expect(error).toMatchObject<Partial<ModelAdapterError>>({ failureClass: 'technical_failure', retryable: true, statusCode: 429 });
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

    const error = await adapter.generate(request).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelAdapterError);
    expect(error).toMatchObject<Partial<ModelAdapterError>>({
      failureClass: 'technical_failure', retryable: false, outcomeUnknown: true
    });
    expect((error as Error).message).toMatch(/1000毫秒/u);
    expect(observedAbort).toBe(true);
  });

  it('2xx响应不可解析时冻结为供应商结果未知而不是安全重试', async () => {
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2-260617',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'discussion'
    }, async () => new Response('not-json', { status: 200 }));

    const error = await adapter.generate(request).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelAdapterError);
    expect(error).toMatchObject<Partial<ModelAdapterError>>({
      failureClass: 'technical_failure', retryable: false, statusCode: 200, outcomeUnknown: true
    });
  });

  it('Kimi K2.7 Code does not send the unsupported thinking parameter', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
      expect(body.thinking).toBeUndefined();
      return Response.json({
        content: [{ type: 'text', text: '{"chapterGoal":"reverse analysis"}' }],
        usage: { input_tokens: 5, output_tokens: 8 }
      });
    });
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k2.7-code',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'novel_reviewer'
    }, fetchImpl);

    await adapter.generate(request);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
