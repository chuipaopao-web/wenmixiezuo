import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

describe('建书前 AI 开书设计', () => {
  it('按账号隔离、幂等生成并把真实用量纳入会员算力，不提前创建空书', async () => {
    context = createTestContext('wenmi-prebook-opening-');
    const app = await createServer(context.config, context.database);
    try {
      await app.inject({
        method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-000', displayName: '管理员' }
      });
      const firstRegister = await app.inject({
        method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
        payload: { email: 'first@example.com', password: 'strong-pass-123', displayName: '作者甲' }
      });
      const secondRegister = await app.inject({
        method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
        payload: { email: 'second@example.com', password: 'strong-pass-456', displayName: '作者乙' }
      });
      const firstCookie = cookieFrom(firstRegister);
      const secondCookie = cookieFrom(secondRegister);
      const input = {
        idea: '张丞穿越到了大秦帝国，醒来便被诬陷盗取军粮账册，三天后问斩。',
        idempotencyKey: 'opening-design-test-0001'
      };
      const started = await app.inject({
        method: 'POST', url: '/api/v1/opening-designs',
        headers: { ...BROWSER_HEADERS, cookie: firstCookie }, payload: input
      });
      expect(started.statusCode).toBe(200);
      expect(started.json().data).toMatchObject({
        idempotencyKey: input.idempotencyKey,
        status: 'working',
        member: { roleKey: 'chief_editor', displayName: '貂蝉' }
      });

      let view = started.json().data as { status: string; design: Record<string, unknown> | null };
      for (let attempt = 0; attempt < 50 && view.status === 'working'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const polled = await app.inject({
          method: 'GET', url: `/api/v1/opening-designs/${input.idempotencyKey}`,
          headers: { host: BROWSER_HEADERS.host, cookie: firstCookie }
        });
        expect(polled.statusCode).toBe(200);
        view = polled.json().data as typeof view;
      }
      expect(view).toMatchObject({
        status: 'succeeded',
        design: {
          title: '大秦谏臣',
          channel: 'male',
          worldBackground: expect.stringContaining('秦始皇'),
          protagonists: [expect.objectContaining({ name: '张丞', background: expect.stringContaining('穿越') })],
          mustFollow: ['无额外限制']
        }
      });

      const callRows = context.database.prepare(`
        SELECT state, input_tokens, output_tokens, result_json
        FROM prebook_opening_design_calls WHERE idempotency_key = ? ORDER BY attempt_no
      `).all(input.idempotencyKey) as unknown as Array<{
        state: string; input_tokens: number; output_tokens: number; result_json: string | null;
      }>;
      expect(callRows).toHaveLength(1);
      expect(callRows[0]).toMatchObject({ state: 'succeeded', result_json: expect.any(String) });
      const actualTokens = callRows[0]!.input_tokens + callRows[0]!.output_tokens;
      expect(actualTokens).toBeGreaterThan(0);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM books').get()).toEqual({ count: 0 });

      const membership = await app.inject({
        method: 'GET', url: '/api/v1/membership/me', headers: { host: BROWSER_HEADERS.host, cookie: firstCookie }
      });
      expect(membership.json().data.membership.computeConsumed).toBe(actualTokens * 2);

      const repeated = await app.inject({
        method: 'POST', url: '/api/v1/opening-designs',
        headers: { ...BROWSER_HEADERS, cookie: firstCookie }, payload: input
      });
      expect(repeated.json().data.status).toBe('succeeded');
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM prebook_opening_design_calls').get()).toEqual({ count: 1 });

      const crossOwner = await app.inject({
        method: 'GET', url: `/api/v1/opening-designs/${input.idempotencyKey}`,
        headers: { host: BROWSER_HEADERS.host, cookie: secondCookie }
      });
      expect(crossOwner.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
