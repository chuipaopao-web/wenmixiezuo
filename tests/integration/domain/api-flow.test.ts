import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('建书REST流程', () => {
  it('从自然语言定位草稿到确认建书并查询9岗位', async () => {
    context = createTestContext();
    const app = await createServer(context.config, context.database);
    try {
      const draftResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '北宋副本', text: '主角进入游戏副本，从朱仙镇开始', category: '历史', tags: ['成长'] }
      });
      expect(draftResponse.statusCode).toBe(200);
      const draft = draftResponse.json().data as { draftId: string; version: number };
      const confirmResponse = await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, payload: { expectedVersion: draft.version }
      });
      expect(confirmResponse.statusCode).toBe(200);
      const book = confirmResponse.json().data as { bookId: string };
      const agents = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/agents` });
      expect((agents.json().data as unknown[])).toHaveLength(9);
      const books = await app.inject({ method: 'GET', url: '/api/v1/books' });
      expect(books.json().data).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

