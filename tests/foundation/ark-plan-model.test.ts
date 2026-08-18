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
      // 方舟套餐端点维持原有字符串 content，不随 opencodego 的块数组格式变化
      expect(body.messages).toEqual([{ role: 'user', content: '只回复结果' }]);
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

  it('MiniMax文学审查关闭隐藏思考以免只返回思考块', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
      expect(body.thinking).toEqual({ type: 'disabled' });
      return Response.json({
        content: [{ type: 'text', text: '{verdict:pass}' }],
        usage: { input_tokens: 8, output_tokens: 12 }
      });
    });
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'minimax-m3',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'novel_reviewer'
    }, fetchImpl);

    await adapter.generate(request);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('DeepSeek规划关闭隐藏思考，但小说正文保留完整创作推演', async () => {
    const seen: Array<{ type?: string } | undefined> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
      seen.push(body.thinking);
      return Response.json({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 5, output_tokens: 2 } });
    });
    await new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'discussion'
    }, fetchImpl).generate(request);
    await new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'novel_writer'
    }, fetchImpl).generate(request);
    expect(seen).toEqual([{ type: 'disabled' }, undefined]);
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

  it('真实套餐默认保留十五分钟完成长篇规划，避免五分钟误中断', async () => {
    vi.useFakeTimers();
    try {
      let observedAbort = false;
      const fetchImpl: typeof fetch = async (_input, init) => await new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          observedAbort = true;
          reject(init.signal?.reason);
        }, { once: true });
        setTimeout(() => resolve(Response.json({
          content: [{ type: 'text', text: '长篇规划完成' }],
          usage: { input_tokens: 8, output_tokens: 4 }
        })), 300_001);
      });
      const adapter = new ArkPlanModelAdapter({
        plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'discussion'
      }, fetchImpl);

      const pending = adapter.generate(request);
      await vi.advanceTimersByTimeAsync(300_001);
      await expect(pending).resolves.toMatchObject({ output: '长篇规划完成' });
      expect(observedAbort).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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

  it('已解析的max_tokens空文字是已知失败，可由调用方使用更大额度安全重试', async () => {
    const adapter = new ArkPlanModelAdapter({
      plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k2.7-code',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'discussion'
    }, async () => Response.json({
      stop_reason: 'max_tokens',
      content: [
        { type: 'thinking', thinking: '内部推理已达到当前额度' },
        { type: 'text', text: '' }
      ],
      usage: { input_tokens: 5_200, output_tokens: 3_600 }
    }));

    const error = await adapter.generate(request).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelAdapterError);
    expect(error).toMatchObject<Partial<ModelAdapterError>>({
      failureClass: 'technical_failure', retryable: true, statusCode: 200, outcomeUnknown: false
    });
    expect((error as Error).message).toContain('max_tokens');
    expect((error as Error).message).not.toContain('结果状态未知');
  });

  describe('opencodego 适配', () => {
    it('opencodego地址补全Messages路径，使用x-api-key认证与文本块消息，并按plan文案报错且脱敏', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toBe('https://opencode.ai/zen/go/v1/messages');
        // 2026-08-16 实测：go 网关 Messages 接口只认 x-api-key，Bearer 会 401；
        // 其 Kimi 上游把字符串 content 误判为空消息，必须发送文本块数组。
        expect(new Headers(init?.headers).get('x-api-key')).toBe('opencodego-key');
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: unknown }> };
        expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: request.prompt }] }]);
        return Response.json({ content: [{ type: 'text', text: 'opencodego结果' }], usage: { input_tokens: 4, output_tokens: 2 } });
      });
      const adapter = new ArkPlanModelAdapter({
        plan: 'opencodego', provider: 'opencodego', modelId: 'deepseek-v4-flash',
        baseUrl: 'https://opencode.ai/zen/go', apiKey: 'opencodego-key', purpose: 'discussion'
      }, fetchImpl);
      await expect(adapter.generate(request)).resolves.toMatchObject({
        provider: 'opencodego', modelId: 'deepseek-v4-flash', output: 'opencodego结果', state: 'succeeded'
      });

      const failing = new ArkPlanModelAdapter({
        plan: 'opencodego', provider: 'opencodego', modelId: 'deepseek-v4-flash',
        baseUrl: 'https://opencode.ai/zen/go', apiKey: 'secret-opencodego', purpose: 'discussion'
      }, async () => new Response('{"error":{"message":"bad request"}}', { status: 400 }));
      const error = await failing.generate(request).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ModelAdapterError);
      expect(error).toMatchObject<Partial<ModelAdapterError>>({ failureClass: 'request_failure', retryable: false, statusCode: 400 });
      expect((error as Error).message).toContain('opencodego');
      expect((error as Error).message).not.toContain('secret-opencodego');
    });

    it('opencodego的DeepSeek事实点评仍关闭隐藏思考', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
        expect(body.thinking).toEqual({ type: 'disabled' });
        return Response.json({ content: [{ type: 'text', text: '{"verdict":"pass"}' }], usage: { input_tokens: 5, output_tokens: 8 } });
      });
      const adapter = new ArkPlanModelAdapter({
        plan: 'opencodego', provider: 'opencodego', modelId: 'deepseek-v4-flash',
        baseUrl: 'https://opencode.ai/zen/go', apiKey: 'opencodego-key', purpose: 'novel_reviewer'
      }, fetchImpl);
      await adapter.generate(request);
      expect(fetchImpl).toHaveBeenCalledOnce();
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

  it('GLM 5.3 在任何用途下都不发送 thinking 参数（方舟实测 400）', async () => {
    for (const purpose of ['discussion', 'novel_reviewer'] as const) {
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
        expect(body.thinking).toBeUndefined();
        return Response.json({
          content: [{ type: 'text', text: '{"chapterGoal":"visible output"}' }],
          usage: { input_tokens: 5, output_tokens: 8 }
        });
      });
      const adapter = new ArkPlanModelAdapter({
        plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'glm-5.3',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose
      }, fetchImpl);

      await adapter.generate(request);
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it('MiniMax M3 在任何用途下都关闭思考（不关闭会把全部额度烧进思考块）', async () => {
    for (const purpose of ['discussion', 'structured_planning', 'novel_reviewer'] as const) {
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { thinking?: { type?: string } };
        expect(body.thinking).toEqual({ type: 'disabled' });
        return Response.json({
          content: [{ type: 'text', text: '可见输出' }],
          usage: { input_tokens: 5, output_tokens: 8 }
        });
      });
      const adapter = new ArkPlanModelAdapter({
        plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId: 'minimax-m3',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose
      }, fetchImpl);

      await adapter.generate(request);
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it('GLM 5.3 的 max_tokens 在可见输出限额上追加思考余量，其他模型不变', async () => {
    const seen: Array<{ model: string; maxTokens: number }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number };
      seen.push({ model: body.model, maxTokens: body.max_tokens });
      return Response.json({
        content: [{ type: 'text', text: '可见输出' }],
        usage: { input_tokens: 5, output_tokens: 8 }
      });
    });
    for (const modelId of ['glm-5.3', 'glm-5.2', 'kimi-k2.7-code', 'deepseek-v4-flash']) {
      const adapter = new ArkPlanModelAdapter({
        plan: 'agent', provider: 'volcengine-ark-agent-plan', modelId,
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', apiKey: 'agent-test-key', purpose: 'discussion'
      }, fetchImpl);
      await adapter.generate(request);
    }
    expect(seen).toEqual([
      { model: 'glm-5.3', maxTokens: 100 + 16_000 },
      { model: 'glm-5.2', maxTokens: 100 },
      { model: 'kimi-k2.7-code', maxTokens: 100 },
      { model: 'deepseek-v4-flash', maxTokens: 100 }
    ]);
  });
});
