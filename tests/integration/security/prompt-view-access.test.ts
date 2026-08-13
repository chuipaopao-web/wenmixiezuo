import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('完整岗位提示词查看保护', () => {
  let context: TestContext | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    context?.close();
  });

  it('公开团队接口不下发完整提示词，正确密码才按用途返回实际运行提示词', async () => {
    context = createTestContext('wenmi-prompt-view-');
    app = await createServer(context.config, context.database, { trustedTest: true });

    const publicResponse = await app.inject({ method: 'GET', url: '/api/v1/team-template' });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json().data).toMatchObject({
      fullPromptAccess: { configured: true, passwordProtected: true },
      members: expect.arrayContaining([expect.objectContaining({ roleStatement: expect.any(String) })])
    });
    expect(publicResponse.body).not.toContain('variants');

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/prompt-view',
      payload: { password: 'wrong-password', roleKey: 'chief_editor' }
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('PROMPT_VIEW_PASSWORD_INVALID');

    const unlocked = await app.inject({
      method: 'POST',
      url: '/api/v1/prompt-view',
      payload: { password: context.config.promptViewPassword, roleKey: 'chief_editor' }
    });
    expect(unlocked.statusCode).toBe(200);
    expect(unlocked.headers['cache-control']).toContain('no-store');
    expect(unlocked.headers.pragma).toBe('no-cache');
    const data = unlocked.json().data as {
      identity: string;
      variants: Array<{ purpose: string; prompt: string }>;
    };
    expect(data.identity).toContain('貂蝉');
    expect(data.variants.map((item) => item.purpose)).toEqual(['discussion', 'structured_planning', 'review_synthesis']);
    expect(data.variants.every((item) => item.prompt.length > 300)).toBe(true);
    expect(data.variants.every((item) => item.prompt.includes('资深长篇网文主编'))).toBe(true);
    expect(data.variants.every((item) => item.prompt.includes('核心专长：'))).toBe(true);
    expect(data.variants.every((item) => item.prompt.includes('只推进当前最需要确认的一步'))).toBe(true);
    expect(unlocked.body).not.toContain(String(context.config.promptViewPassword));
    expect(publicResponse.body).not.toContain(data.variants[0]?.prompt ?? '__missing__');
  });

  it('未配置查看密码时拒绝返回完整提示词', async () => {
    context = createTestContext('wenmi-prompt-view-unconfigured-');
    app = await createServer({ ...context.config, promptViewPassword: null }, context.database, { trustedTest: true });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/prompt-view',
      payload: { password: 'anything', roleKey: 'lead_writer' }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('OPERATION_INCOMPLETE');
  });

  it('按本书成员查看时拒绝跨书成员或岗位错配', async () => {
    context = createTestContext('wenmi-prompt-view-scope-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '第一本书' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '第二本书' });
    const secondEditor = context.database.prepare(`
      SELECT a.agent_id AS agentId
      FROM agent_instances a
      JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = 'chief_editor'
      LIMIT 1
    `).get(context.config.ownerId, second.bookId) as { agentId: string };
    app = await createServer(context.config, context.database, { trustedTest: true });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/prompt-view',
      payload: {
        password: context.config.promptViewPassword,
        roleKey: 'chief_editor',
        bookId: first.bookId,
        agentId: secondEditor.agentId
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('连续错误达到上限后临时锁定请求来源', async () => {
    context = createTestContext('wenmi-prompt-view-rate-');
    app = await createServer(context.config, context.database, { trustedTest: true });
    for (let index = 0; index < 5; index += 1) {
      await app.inject({
        method: 'POST', url: '/api/v1/prompt-view',
        payload: { password: `wrong-${index}`, roleKey: 'lead_writer' }
      });
    }
    const blocked = await app.inject({
      method: 'POST', url: '/api/v1/prompt-view',
      payload: { password: context.config.promptViewPassword, roleKey: 'lead_writer' }
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('PROMPT_VIEW_RATE_LIMITED');
  });
});
