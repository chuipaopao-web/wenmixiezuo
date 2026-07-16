import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('工作台API', () => {
  let context: TestContext | undefined;
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    context?.close();
  });

  it('工作区按书聚合真实状态，明确命令零模型调用', async () => {
    context = createTestContext();
    const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), {
      title: '工作台接口书', text: '聚合工作区并执行确定性命令'
    });
    app = await createServer(context.config, context.database);
    const workspaceResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/workspace` });
    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json().data).toMatchObject({
      book: { bookId: book.bookId, title: '工作台接口书' },
      confirmations: { count: 0 }
    });
    expect(workspaceResponse.json().data.agents).toHaveLength(9);

    const commandResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/messages`, payload: { content: '写1章' }
    });
    expect(commandResponse.statusCode).toBe(200);
    expect(commandResponse.json().data.action).toMatchObject({ kind: 'chapter_batch_scheduled', count: 1 });
    const prepareResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/messages`, payload: { content: '准备接管' }
    });
    expect(prepareResponse.json().data.action).toMatchObject({ kind: 'takeover_prepared', fromEpoch: 1 });
    const takeoverId = prepareResponse.json().data.action.takeoverId as string;
    const takeoverResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/messages`, payload: { content: `确认接管 ${takeoverId}` }
    });
    expect(takeoverResponse.json().data.action).toMatchObject({ kind: 'takeover_completed', editorEpoch: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE owner_id = ? AND book_id = ?`)
      .get(context.config.ownerId, book.bookId)).toEqual({ count: 0 });
  });

  it('研究元数据可查看但接口不返回缓存原文，候选不会修改正史', async () => {
    context = createTestContext();
    const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), {
      title: '研究接口书', text: '验证研究来源隔离'
    });
    app = await createServer(context.config, context.database);
    const sourceResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/research/sources`, payload: {
        title: '历史公开资料', content: '原始研究材料只存储在研究缓存，不应由列表接口直接返回。',
        language: 'zh-CN', credibility: 75
      }
    });
    const sourceId = sourceResponse.json().data.researchSourceId as string;
    await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/research/claims`, payload: {
        sourceId, claim: '某制度可能限制人物通行', evidence: '公开材料中的制度记载'
      }
    });
    const listResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/research/sources` });
    expect(listResponse.body).not.toContain('原始研究材料只存储在研究缓存');
    expect(listResponse.json().data[0]).toMatchObject({ title: '历史公开资料', credibility: 75 });
    const claimsResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/research/claims` });
    expect(claimsResponse.json().data[0]).toMatchObject({ candidate_status: 'candidate' });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(context.config.ownerId, book.bookId)).toEqual({ canon_revision: 0 });
  });
});
