import { createHash } from 'node:crypto';

const ARK_IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const ARK_AGENT_PLAN_IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface V7CoverImageResult {
  provider: 'volcengine-ark-image';
  modelId: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  buffer: Buffer;
  contentHash: string;
}

export interface V7CoverImageGateway {
  readonly configured: boolean;
  readonly modelId: string;
  generate(input: { requestId: string; prompt: string }): Promise<V7CoverImageResult>;
}

export class V7CoverImageGatewayError extends Error {
  public constructor(message: string, public readonly outcomeUnknown: boolean) {
    super(message);
    this.name = 'V7CoverImageGatewayError';
  }
}

export class VolcengineArkImageGateway implements V7CoverImageGateway {
  public readonly configured: boolean;
  public readonly modelId: string;
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;

  public constructor(env: NodeJS.ProcessEnv = process.env) {
    // 专用图片凭证始终优先；没有专用凭证时，使用 Agent Plan 套餐中
    // 已包含的 Seedream 权益。这里不接受 Coding Plan 或普通按量地址，
    // 避免无意中切换到合同外的付费路线。
    const credential = imageCredential(env);
    this.apiKey = credential?.apiKey;
    this.endpoint = credential?.endpoint ?? ARK_IMAGE_ENDPOINT;
    this.modelId = nonEmpty(env.WENMI_ARK_IMAGE_MODEL_ID)
      ?? (credential?.kind === 'agent-plan' ? 'doubao-seedream-5.0-lite' : 'doubao-seedream-5-0-260128');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/u.test(this.modelId)) {
      throw new Error('图片模型编号格式无效');
    }
    this.configured = this.apiKey !== undefined;
  }

  public async generate(input: { requestId: string; prompt: string }): Promise<V7CoverImageResult> {
    if (!this.configured || this.apiKey === undefined) throw new Error('封面画师当前未值班');
    const prompt = input.prompt.trim();
    if (prompt.length < 20 || prompt.length > 12_000) throw new Error('封面制作说明长度无效');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      let response: Response;
      try {
        response = await fetch(this.endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
            'x-client-request-id': input.requestId
          },
          body: JSON.stringify({
            model: this.modelId,
            prompt,
            size: '2K',
            response_format: 'b64_json',
            output_format: 'png',
            stream: false,
            sequential_image_generation: 'disabled',
            watermark: false
          })
        });
      } catch (error) {
        throw new V7CoverImageGatewayError(publicFailureMessage(error, '图片服务连接中断'), true);
      }
      const body = await response.json().catch(() => null) as {
        data?: Array<{ b64_json?: unknown; url?: unknown }>;
        error?: { message?: unknown };
      } | null;
      if (!response.ok) {
        const publicMessage = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : `图片服务返回${response.status}`;
        throw new V7CoverImageGatewayError(publicMessage, false);
      }
      try {
        const delivery = body?.data?.[0];
        const buffer = typeof delivery?.b64_json === 'string' && delivery.b64_json.length > 0
          ? Buffer.from(delivery.b64_json, 'base64')
          : typeof delivery?.url === 'string' && delivery.url.length > 0
            ? await downloadTemporaryImage(delivery.url, controller.signal)
            : null;
        if (buffer === null) throw new Error('封面画师没有交付可保存的图片');
        assertImageSize(buffer);
        const mimeType = detectImageMime(buffer);
        return {
          provider: 'volcengine-ark-image', modelId: this.modelId, mimeType, buffer,
          contentHash: createHash('sha256').update(buffer).digest('hex')
        };
      } catch (error) {
        if (error instanceof V7CoverImageGatewayError) throw error;
        throw new V7CoverImageGatewayError(publicFailureMessage(error, '封面图片交付无法确认'), true);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function publicFailureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message.trim().slice(0, 300)
    : fallback;
}

async function downloadTemporaryImage(value: string, signal: AbortSignal): Promise<Buffer> {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('封面画师交付的图片地址不安全');
  const response = await fetch(url, { method: 'GET', signal, redirect: 'follow' });
  if (!response.ok) throw new Error(`封面图片下载失败（${response.status}）`);
  if (new URL(response.url).protocol !== 'https:') throw new Error('封面画师交付的图片地址不安全');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) throw new Error('封面图片大小异常');
  const buffer = Buffer.from(await response.arrayBuffer());
  assertImageSize(buffer);
  return buffer;
}

function assertImageSize(buffer: Buffer): void {
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('封面图片大小异常');
}

function detectImageMime(buffer: Buffer): V7CoverImageResult['mimeType'] {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  throw new Error('封面画师交付的文件不是受支持的图片');
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function imageCredential(env: NodeJS.ProcessEnv): { apiKey: string; endpoint: string; kind: 'dedicated' | 'agent-plan' } | undefined {
  const dedicated = nonEmpty(env.WENMI_ARK_IMAGE_API_KEY);
  if (dedicated !== undefined) return { apiKey: dedicated, endpoint: ARK_IMAGE_ENDPOINT, kind: 'dedicated' };
  const directAgentPlan = nonEmpty(env.WENMI_ARK_AGENT_PLAN_API_KEY);
  if (directAgentPlan !== undefined) return { apiKey: directAgentPlan, endpoint: ARK_AGENT_PLAN_IMAGE_ENDPOINT, kind: 'agent-plan' };
  return undefined;
}
