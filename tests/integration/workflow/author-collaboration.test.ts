import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('对象旁作者想法协作', () => {
  let context: TestContext | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    context?.close();
  });

  it('六个流程位置都保存一次原话、意图和定位，重复请求不会重复写入', async () => {
    context = createTestContext();
    const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), {
      title: '作者想法书', text: '验证六个对象旁保存作者原话'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });
    const targets = [
      ['book_profile', 'book', book.bookId],
      ['setting', 'setting_module', 'power-system'],
      ['volume_plan', 'volume_plan', 'volume-plan-1'],
      ['event', 'story_event', 'event-1'],
      ['chapter_outline', 'chapter_outline', 'outline-1'],
      ['manuscript', 'chapter', 'chapter-1']
    ] as const;
    for (const [surface, subjectType, subjectId] of targets) {
      const payload = {
        surface, subjectType, subjectId, intentStrength: 'inspiration',
        originalText: `${surface} 的原始想法`, attachmentRefs: [], mentionedAgentIds: [],
        scopeNotes: '只供当前对象参考', idempotencyKey: `idea-${surface}`
      };
      const first = await app.inject({ method: 'POST', url: `/api/v1/books/${book.bookId}/author-planning-inputs`, payload });
      const retry = await app.inject({ method: 'POST', url: `/api/v1/books/${book.bookId}/author-planning-inputs`, payload });
      expect(first.statusCode, first.body).toBe(200);
      expect(retry.json().data.authorInputId).toBe(first.json().data.authorInputId);
      expect(first.json().data).toMatchObject({ surface, subjectType, subjectId, status: 'new', originalText: `${surface} 的原始想法` });
    }
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM author_planning_inputs').get()).toEqual({ count: 6 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM fact_assertions').get()).toEqual({ count: 0 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM author_planning_inputs WHERE original_text_hash = ?')
      .get(createHash('sha256').update('event 的原始想法').digest('hex'))).toEqual({ count: 1 });
  });

  it('引用同书附件和真实成员，保留已绑定旧消息的附件且拒绝跨书引用', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '甲书', text: '附件属于甲书' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '乙书', text: '不能看到甲书附件' });
    app = await createServer(context.config, context.database, { trustedTest: true });
    const upload = await uploadText(app, first.bookId, 'old-note.txt', '旧消息里的作者原话');
    const attachmentId = upload.json().data.attachmentId as string;
    const freshUpload = await uploadText(app, first.bookId, 'fresh-note.txt', '只在作者想法中使用');
    const freshAttachmentId = freshUpload.json().data.attachmentId as string;
    const sent = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/messages`,
      payload: { content: '这是一条已有消息', attachmentIds: [attachmentId] }
    });
    expect(sent.statusCode).toBe(200);
    const agent = context.database.prepare(`SELECT agent_id FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND enabled = 1 ORDER BY created_at LIMIT 1`)
      .get(context.config.ownerId, first.bookId) as { agent_id: string };
    const created = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/author-planning-inputs`,
      payload: {
        surface: 'setting', subjectType: 'setting_module', subjectId: 'characters', intentStrength: 'question',
        originalText: '请点名这位成员判断附件中的人物动机。', attachmentRefs: [attachmentId, freshAttachmentId],
        mentionedAgentIds: [agent.agent_id], scopeNotes: null, idempotencyKey: 'idea-with-old-attachment'
      }
    });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().data).toMatchObject({ attachmentRefs: [attachmentId, freshAttachmentId], mentionedAgentIds: [agent.agent_id] });
    const linkedDiscard = await app.inject({ method: 'POST', url: `/api/v1/books/${first.bookId}/chat-attachments/${freshAttachmentId}/discard`, payload: {} });
    expect(linkedDiscard.statusCode).toBe(409);
    expect(context.database.prepare('SELECT message_id FROM chat_attachments WHERE attachment_id = ?').get(attachmentId))
      .toEqual({ message_id: expect.any(String) });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM messages WHERE owner_id = ? AND book_id = ?')
      .get(context.config.ownerId, first.bookId)).toEqual({ count: expect.any(Number) });

    const crossBook = await app.inject({
      method: 'POST', url: `/api/v1/books/${second.bookId}/author-planning-inputs`,
      payload: {
        surface: 'setting', subjectType: 'setting_module', subjectId: 'characters', intentStrength: 'question',
        originalText: '越权引用', attachmentRefs: [attachmentId], mentionedAgentIds: [agent.agent_id],
        scopeNotes: null, idempotencyKey: 'cross-book-idea'
      }
    });
    expect(crossBook.statusCode).toBe(404);
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM author_planning_inputs WHERE book_id = ?')
      .get(second.bookId)).toEqual({ count: 0 });
  });

  it('采用映射、暂存理由、撤回与幂等决定可恢复，灵感不会被自动升级', async () => {
    context = createTestContext();
    const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), {
      title: '采用映射书', text: '想法必须说明是否采用'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });
    const created = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/author-planning-inputs`,
      payload: {
        surface: 'event', subjectType: 'story_event', subjectId: 'event-1', intentStrength: 'inspiration',
        originalText: '结尾可以让女主开始改观。', attachmentRefs: [], mentionedAgentIds: [],
        scopeNotes: null, idempotencyKey: 'event-inspiration'
      }
    });
    const authorInputId = created.json().data.authorInputId as string;
    expect(created.json().data.status).toBe('new');
    const decisionPayload = {
      expectedStatus: 'new', status: 'adapted', handlingReason: '保留关系变化，但改成共同承担风险后自然改观。',
      appliedToRefs: [{ kind: 'story_event', id: 'event-1', version: 2, contentHash: 'a'.repeat(64), required: true }],
      idempotencyKey: 'decide-event-inspiration'
    };
    const decided = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/author-planning-inputs/${authorInputId}/decisions`,
      payload: decisionPayload
    });
    const retry = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/author-planning-inputs/${authorInputId}/decisions`,
      payload: decisionPayload
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(decided.json().data).toMatchObject({
      intentStrength: 'inspiration', status: 'adapted',
      handlingReason: '保留关系变化，但改成共同承担风险后自然改观。',
      appliedToRefs: [expect.objectContaining({ kind: 'story_event', id: 'event-1', version: 2 })]
    });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM author_planning_input_decisions').get()).toEqual({ count: 1 });
    expect(context.database.prepare(`SELECT original_text FROM author_planning_inputs WHERE author_input_id = ?`).get(authorInputId))
      .toEqual({ original_text: '结尾可以让女主开始改观。' });

    const withdrawn = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/author-planning-inputs/${authorInputId}/decisions`,
      payload: { expectedStatus: 'adapted', status: 'withdrawn', handlingReason: '作者改变了当前事件方向。', appliedToRefs: [], idempotencyKey: 'withdraw-event-inspiration' }
    });
    expect(withdrawn.json().data).toMatchObject({ status: 'withdrawn', originalText: '结尾可以让女主开始改观。' });
  });

  it('失败请求事务回滚，同一幂等键不同内容冲突，列表严格按对象和书过滤', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '过滤甲', text: '对象过滤' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '过滤乙', text: '跨书过滤' });
    app = await createServer(context.config, context.database, { trustedTest: true });
    const base = {
      surface: 'volume_plan', subjectType: 'volume_plan', subjectId: 'volume-1', intentStrength: 'preference',
      originalText: '这一卷更重视人物关系。', attachmentRefs: [], mentionedAgentIds: [], scopeNotes: null,
      idempotencyKey: 'same-key'
    };
    expect((await app.inject({ method: 'POST', url: `/api/v1/books/${first.bookId}/author-planning-inputs`, payload: base })).statusCode).toBe(200);
    const conflict = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/author-planning-inputs`,
      payload: { ...base, originalText: '同一幂等键的另一段话' }
    });
    expect(conflict.statusCode).toBe(409);
    await app.inject({
      method: 'POST', url: `/api/v1/books/${second.bookId}/author-planning-inputs`,
      payload: { ...base, idempotencyKey: 'second-book-key', originalText: '乙书自己的想法' }
    });
    const filtered = await app.inject({
      method: 'GET', url: `/api/v1/books/${first.bookId}/author-planning-inputs?surface=volume_plan&subjectType=volume_plan&subjectId=volume-1`
    });
    expect(filtered.json().data).toHaveLength(1);
    expect(filtered.json().data[0]).toMatchObject({ bookId: first.bookId, originalText: '这一卷更重视人物关系。' });
    expect(JSON.stringify(filtered.json().data)).not.toContain('乙书自己的想法');
  });
});

async function uploadText(app: FastifyInstance, bookId: string, filename: string, text: string) {
  const boundary = `----wenmi-${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: text/plain',
    '', ''
  ].join('\r\n'));
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({
    method: 'POST', url: `/api/v1/books/${bookId}/chat-attachments`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, Buffer.from(text), tail])
  });
}
