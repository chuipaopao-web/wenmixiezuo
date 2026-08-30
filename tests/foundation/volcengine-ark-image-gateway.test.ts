import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  V7CoverImageGatewayError,
  VolcengineArkImageGateway
} from '../../apps/api/src/infrastructure/models/volcengine-ark-image-gateway.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const PROMPT = '竖版历史网文封面，主角站在城楼前，画面有强烈层次、鲜明对比和商业缩略图辨识度。';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('火山方舟封面图片网关', () => {
  it('专用图片凭据缺失时使用Agent Plan套餐能力返岗', () => {
    expect(new VolcengineArkImageGateway({ WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-plan-key' }).configured).toBe(true);
    expect(new VolcengineArkImageGateway({
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/plan/',
      ANTHROPIC_AUTH_TOKEN: 'compatible-agent-plan-key'
    }).configured).toBe(true);
    expect(new VolcengineArkImageGateway({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_AUTH_TOKEN: 'unrelated-key'
    }).configured).toBe(false);
    expect(new VolcengineArkImageGateway({}).configured).toBe(false);
  });

  it('专用图片凭据优先，并按Seedream当前协议请求base64图片', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => jsonResponse({
      data: [{ b64_json: PNG.toString('base64') }]
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new VolcengineArkImageGateway({
      WENMI_ARK_IMAGE_API_KEY: 'dedicated-image-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-plan-key'
    });

    const result = await gateway.generate({ requestId: 'cover-request-1', prompt: PROMPT });

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer).toEqual(PNG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer dedicated-image-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'doubao-seedream-5-0-260128',
      size: '2K',
      response_format: 'b64_json',
      output_format: 'png',
      stream: false,
      sequential_image_generation: 'disabled',
      watermark: false
    });
  });

  it('Agent Plan套餐凭据使用专属图片入口和套餐内Seedream标识', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({
      data: [{ b64_json: PNG.toString('base64') }]
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new VolcengineArkImageGateway({ WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-plan-key' });

    await gateway.generate({ requestId: 'cover-agent-plan-1', prompt: PROMPT });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/images/generations');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'doubao-seedream-5.0-lite' });
  });

  it('立即下载官方临时URL并保存真实图片字节', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: 'https://images.example.test/temporary-cover.png' }] }))
      .mockResolvedValueOnce(binaryResponse(PNG, 'https://images.example.test/temporary-cover.png'));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new VolcengineArkImageGateway({ WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-plan-key' });

    const result = await gateway.generate({ requestId: 'cover-request-2', prompt: PROMPT });

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer).toEqual(PNG);
    expect(fetchMock).toHaveBeenNthCalledWith(2, new URL('https://images.example.test/temporary-cover.png'), expect.objectContaining({
      method: 'GET', redirect: 'follow'
    }));
  });

  it('拒绝不安全临时地址和非图片交付', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [{ url: 'http://images.example.test/cover.png' }] })));
    const gateway = new VolcengineArkImageGateway({ WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-plan-key' });
    await expect(gateway.generate({ requestId: 'cover-request-3', prompt: PROMPT })).rejects.toThrow('图片地址不安全');

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [{ b64_json: Buffer.from('not-an-image').toString('base64') }] })));
    await expect(gateway.generate({ requestId: 'cover-request-4', prompt: PROMPT })).rejects.toThrow('不是受支持的图片');
  });

  it('区分供应商明确拒绝与提交后结果未知，供计量层决定释放或保留预留', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: '请求参数无效' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    })));
    const gateway = new VolcengineArkImageGateway({ WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-plan-key' });
    const knownFailure = await gateway.generate({ requestId: 'cover-known-failure', prompt: PROMPT }).catch((error: unknown) => error);
    expect(knownFailure).toBeInstanceOf(V7CoverImageGatewayError);
    expect((knownFailure as V7CoverImageGatewayError).outcomeUnknown).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket closed after write'); }));
    const unknownFailure = await gateway.generate({ requestId: 'cover-unknown-result', prompt: PROMPT }).catch((error: unknown) => error);
    expect(unknownFailure).toBeInstanceOf(V7CoverImageGatewayError);
    expect((unknownFailure as V7CoverImageGatewayError).outcomeUnknown).toBe(true);
  });
});

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function binaryResponse(buffer: Buffer, url: string): Response {
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ 'content-length': String(buffer.length), 'content-type': 'image/png' }),
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  } as Response;
}
