import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('白话叙事模板接口', () => {
  let context: TestContext | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    context?.close();
  });

  it('按书校验并返回卷级公开投影、自定义和不用模板入口', async () => {
    context = createTestContext();
    const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), {
      title: '模板接口书', text: '一个悬疑故事，主角追查家族秘密'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });

    const response = await app.inject({
      method: 'GET', url: `/api/v1/books/${book.bookId}/planning-templates?scope=volume`
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      contractVersion: 1,
      registryVersion: 2,
      scope: 'volume',
      registryHash: expect.stringMatching(/^sha256:/u),
      alternativeChoices: [
        expect.objectContaining({ mode: 'custom', publicTitle: '我自己安排' }),
        expect.objectContaining({ mode: 'none', publicTitle: '这次不用模板' })
      ]
    });
    expect(response.json().data.templates.every((item: Record<string, unknown>) => item.scope === 'volume')).toBe(true);
    expect(response.body).not.toMatch(/sourceMethod|legacyIds|Save the Cat/iu);
    expect(response.json().data.templates.map((item: Record<string, unknown>) => item.sourceLabel))
      .toEqual(expect.arrayContaining(['三幕式', '五幕式', '救猫咪结构']));
  });

  it('拒绝非法范围和不存在的书', async () => {
    context = createTestContext();
    const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), {
      title: '校验书', text: '校验模板范围'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });
    expect((await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/planning-templates?scope=chapter` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/books/not-found/planning-templates?scope=event' })).statusCode).toBe(404);
  });
});
