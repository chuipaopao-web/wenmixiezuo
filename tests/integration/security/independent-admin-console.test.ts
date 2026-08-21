import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';

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

async function registerAccounts(app: Awaited<ReturnType<typeof createServer>>) {
  const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
    payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
  const user = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
    payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' } });
  const row = context!.database.prepare("SELECT user_id,owner_id FROM user_accounts WHERE email_normalized='writer@example.com'")
    .get() as { user_id: string; owner_id: string };
  return { adminCookie: cookieFrom(admin), userCookie: cookieFrom(user), userId: row.user_id, ownerId: row.owner_id };
}

describe('独立管理后台：权限、问题、模板、提示词和经营数据', () => {
  it('普通作者不能读取任何后台模块，自己的反馈可以安全进入问题中心', async () => {
    context = createTestContext('wenmi-independent-admin-gate-');
    const app = await createServer(context.config, context.database);
    try {
      const { adminCookie, userCookie, ownerId } = await registerAccounts(app);
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const book = initializeDomainBook(context, ownerId, ids, clock, { title: '后台问题测试书' });
      const scope = { ownerId, bookId: book.bookId };
      new TaskService(context.database, context.config.releaseId, new FixedClock()).create(scope, {
        taskId: 'task-failed-admin-center', taskType: 'volume_plan_generation', idempotencyKey: 'failed-admin-center',
        initialPhase: 'draft', brief: { source: 'test' }
      });
      context.database.prepare(`UPDATE tasks SET status='failed', current_phase='failed', error_code='MODEL_TIMEOUT',
        updated_at='2026-08-21T01:00:00.000Z' WHERE task_id='task-failed-admin-center'`).run();

      const member = context.database.prepare(`SELECT agent_id, display_name FROM agent_instances
        WHERE owner_id = ? AND book_id = ? ORDER BY agent_id LIMIT 1`)
        .get(scope.ownerId, scope.bookId) as { agent_id: string; display_name: string };
      const discussions = new DiscussionService(context.database, ids, clock);
      const partial = discussions.create(scope, {
        type: 'quick',
        scopeText: '后台部分失败同步测试',
        createdByAgentId: member.agent_id,
        participants: [{ agentId: member.agent_id, reason: '独立设定方案' }]
      });
      discussions.setParticipantRunStatus(scope, partial.discussionId, member.agent_id, 'unavailable', '模型套餐暂时不可用');
      new TaskService(context.database, context.config.releaseId, clock).create(scope, {
        taskId: 'task-partial-setting-admin-center', taskType: 'discussion', idempotencyKey: 'partial-setting-admin-center',
        initialPhase: 'complete', brief: { purpose: 'setting_proposal_panel', discussionId: partial.discussionId }
      });
      context.database.prepare(`UPDATE tasks SET status='succeeded', updated_at='2026-08-21T01:01:00.000Z'
        WHERE task_id='task-partial-setting-admin-center'`).run();

      for (const url of ['/api/v1/admin/dashboard', '/api/v1/admin/issues', '/api/v1/admin/membership-stats',
        '/api/v1/admin/narrative-methods', '/api/v1/admin/prompt-catalog', '/api/v1/admin/prompt-calls']) {
        const denied = await app.inject({ method: 'GET', url, headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
        expect(denied.statusCode, url).toBe(403);
      }

      const feedback = await app.inject({ method: 'POST', url: '/api/v1/feedback',
        headers: { ...BROWSER_HEADERS, cookie: userCookie },
        payload: { bookId: book.bookId, taskId: 'task-failed-admin-center', category: 'bug',
          message: '点击重新生成后一直没有结果', pagePath: '/?view=volume' } });
      expect(feedback.statusCode).toBe(200);

      const dashboard = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard',
        headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json().data).toMatchObject({ overview: { failedTasksToday: expect.any(Number) } });

      const issues = await app.inject({ method: 'GET', url: '/api/v1/admin/issues',
        headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(issues.statusCode).toBe(200);
      const issueItems = issues.json().data.items as Array<Record<string, unknown>>;
      expect(issueItems).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceType: 'failed_task', sourceId: 'task-failed-admin-center', severity: 'high' }),
        expect.objectContaining({ sourceType: 'feedback', category: 'bug', detail: '点击重新生成后一直没有结果' }),
        expect.objectContaining({ sourceType: 'failed_task', sourceId: 'task-partial-setting-admin-center', category: 'setting_member_failure', detail: expect.stringContaining('模型套餐暂时不可用') })
      ]));

      const feedbackIssue = issueItems.find((item) => item.sourceType === 'feedback')!;
      const update = await app.inject({ method: 'PATCH',
        url: `/api/v1/admin/issues/feedback/${String(feedbackIssue.sourceId)}`,
        headers: { ...BROWSER_HEADERS, cookie: adminCookie },
        payload: { status: 'in_progress', severity: 'critical', note: '已复现，等待修复' } });
      expect(update.statusCode).toBe(200);
      expect(update.json().data).toMatchObject({ status: 'in_progress', severity: 'critical', note: '已复现，等待修复' });
    } finally {
      await app.close();
    }
  });

  it('会员实收形成不可变流水，收入、会员数和续费次数按真实交易统计', async () => {
    context = createTestContext('wenmi-independent-admin-revenue-');
    const app = await createServer(context.config, context.database);
    try {
      const { adminCookie, userId } = await registerAccounts(app);
      const grant = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${userId}`,
        headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'silver', amountCny: 88.5, note: '首年优惠' } });
      expect(grant.statusCode).toBe(200);
      const renew = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${userId}`,
        headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'gold', amountCny: 168, note: '升级续费' } });
      expect(renew.statusCode).toBe(200);

      const stats = await app.inject({ method: 'GET', url: '/api/v1/admin/membership-stats',
        headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(stats.statusCode).toBe(200);
      expect(stats.json().data.summary).toMatchObject({ activeMembers: 1, totalRevenueCashMicros: 256_500_000, renewals: 1 });
      expect(stats.json().data.transactions).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventType: 'grant', plan: 'silver', amountCashMicros: 88_500_000, note: '首年优惠' }),
        expect.objectContaining({ eventType: 'renew', plan: 'gold', amountCashMicros: 168_000_000, note: '升级续费' })
      ]));
      expect((context.database.prepare('SELECT COUNT(*) AS total FROM membership_transactions').get() as { total: number }).total).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('叙事方法与提示词采用版本化覆盖，作者只会在未来调用中继承', async () => {
    context = createTestContext('wenmi-independent-admin-prompts-');
    const app = await createServer(context.config, context.database);
    try {
      const { adminCookie } = await registerAccounts(app);
      const methods = await app.inject({ method: 'GET', url: '/api/v1/admin/narrative-methods',
        headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(methods.statusCode).toBe(200);
      const first = methods.json().data.items[0] as { methodKey: string; content: Record<string, unknown> };
      const savedMethod = await app.inject({ method: 'PUT', url: `/api/v1/admin/narrative-methods/${first.methodKey}`,
        headers: { ...BROWSER_HEADERS, cookie: adminCookie },
        payload: { enabled: true, content: { ...first.content, internalLabel: '后台测试方法' } } });
      expect(savedMethod.statusCode).toBe(200);
      expect(savedMethod.json().data).toMatchObject({ version: 1, enabled: true, content: { internalLabel: '后台测试方法' } });

      const catalog = await app.inject({ method: 'GET', url: '/api/v1/admin/prompt-catalog',
        headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(catalog.statusCode).toBe(200);
      const trigger = catalog.json().data.triggers[0] as { triggerKey: string; authorActions: string[]; contextPackages: string[] };
      expect(trigger.authorActions.length).toBeGreaterThan(0);
      expect(trigger.contextPackages.length).toBeGreaterThan(0);
      const override = await app.inject({ method: 'POST', url: '/api/v1/admin/prompt-overrides',
        headers: { ...BROWSER_HEADERS, cookie: adminCookie },
        payload: { triggerKey: trigger.triggerKey, roleKey: '*', phaseKey: '*', content: '后续调用必须保留人物主动选择。' } });
      expect(override.statusCode).toBe(200);
      expect(override.json().data).toMatchObject({ version: 1, content: '后续调用必须保留人物主动选择。' });
      expect((context.database.prepare("SELECT COUNT(*) AS total FROM platform_prompt_overrides WHERE status='active'").get() as { total: number }).total).toBe(1);
      expect((context.database.prepare('SELECT COUNT(*) AS total FROM model_call_prompt_snapshots').get() as { total: number }).total).toBe(0);
    } finally {
      await app.close();
    }
  });
});
