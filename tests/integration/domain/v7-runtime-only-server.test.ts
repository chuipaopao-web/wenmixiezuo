import { afterEach, describe, expect, it } from 'vitest';
import { createV7Server } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7 唯一 API 运行入口', () => {
  it('保留 V7 与共享平台能力，同时不注册旧产品路由', async () => {
    context = createTestContext('wenmi-v7-only-server-');
    const app = await createV7Server(context.config, context.database, { trustedTest: true });
    try {
      for (const url of [
        '/api/v1/v7/books',
        '/api/v1/v7/opening-taxonomy',
        '/api/v1/v7/editorial/planning-members',
        '/api/v1/v7/editorial/creation-members',
        '/api/v1/admin/dashboard'
      ]) {
        const response = await app.inject({ method: 'GET', url, headers: BROWSER_HEADERS });
        expect(response.statusCode, url).toBe(200);
      }

      for (const url of [
        '/api/v1/books',
        '/api/v1/opening-taxonomy',
        '/api/v1/books/legacy-book/volume-plans',
        '/api/v1/events'
      ]) {
        const response = await app.inject({ method: 'GET', url, headers: BROWSER_HEADERS });
        expect(response.statusCode, url).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});
