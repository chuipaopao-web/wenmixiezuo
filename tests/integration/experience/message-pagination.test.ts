import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('长对话分页窗口', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('默认只返回最近窗口，游标可读取更早历史且工作区保留全量计数', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '长对话分页书', text: '验证长篇项目历史分页' });
    const conversation = context.database.prepare(`SELECT conversation_id FROM conversations WHERE owner_id = ? AND book_id = ?`)
      .get(context.config.ownerId, book.bookId) as { conversation_id: string };
    const insert = context.database.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type,
        message_type, content, references_json, created_at
      ) VALUES (?, ?, ?, ?, 'boss', 'text', ?, '[]', ?)
    `);
    for (let index = 1; index <= 520; index += 1) {
      const suffix = String(index).padStart(4, '0');
      insert.run(`history-${suffix}`, conversation.conversation_id, context.config.ownerId, book.bookId, `历史消息 ${suffix}`, clock.now().toISOString());
    }
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const latest = (await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/messages?limit=10` })).json().data as Array<{ message_id: string }>;
      expect(latest.map((message) => message.message_id)).toEqual(Array.from({ length: 10 }, (_, index) => `history-${String(index + 511).padStart(4, '0')}`));
      const earlier = (await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/messages?limit=10&before=${latest[0]!.message_id}` })).json().data as Array<{ message_id: string }>;
      expect(earlier.map((message) => message.message_id)).toEqual(Array.from({ length: 10 }, (_, index) => `history-${String(index + 501).padStart(4, '0')}`));
      const workspace = (await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/workspace` })).json().data as { messageCount: number };
      expect(workspace.messageCount).toBe(520);
    } finally {
      await app.close();
    }
  });
});
