import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import {
  assertMembershipAllowsGeneration,
  MembershipService,
  MEMBERSHIP_PLANS
} from '../../../apps/api/src/infrastructure/security/membership-service.js';
import { FixedClock, MutableClock } from '../../helpers/test-context.js';
import { DomainError } from '../../../apps/api/src/domain/errors.js';
import { OPENING_TAXONOMY } from '../../../apps/api/src/contracts/opening-blueprint.js';

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

interface AccountRow { user_id: string; owner_id: string; email_normalized: string; role: string }

function accountRows(database: TestContext['database']): AccountRow[] {
  return database.prepare('SELECT user_id, owner_id, email_normalized, role FROM user_accounts ORDER BY created_at').all() as unknown as AccountRow[];
}

function seedOwner(database: TestContext['database'], ownerId: string, now: string): void {
  database.prepare(`
    INSERT INTO owners (owner_id, display_name, version, created_at, updated_at)
    VALUES (?, '会员测试所有者', 1, ?, ?)
  `).run(ownerId, now, now);
}

function seedBookAndUsage(database: TestContext['database'], ownerId: string, tokens: number, recordedAt: string): void {
  const now = '2026-07-01T00:00:00.000Z';
  database.prepare(`
    INSERT INTO books (book_id, owner_id, title, status, version, positioning_version, canon_revision, editor_epoch, created_at, updated_at)
    VALUES ('member-book', ?, '会员测试书', 'active', 1, 0, 0, 0, ?, ?)
  `).run(ownerId, now, now);
  database.prepare(`
    INSERT INTO budgets (budget_id, owner_id, book_id, mode, token_limit, cash_limit_micros, status, created_at, updated_at)
    VALUES ('budget-1', ?, 'member-book', 'standard', 0, 0, 'active', ?, ?)
  `).run(ownerId, now, now);
  database.prepare(`
    INSERT INTO budget_reservations (reservation_id, budget_id, owner_id, book_id, request_id, frozen_tokens, frozen_cash_micros, status, created_at)
    VALUES ('resv-1', 'budget-1', ?, 'member-book', 'req-1', 0, 0, 'settled', ?)
  `).run(ownerId, now);
  database.prepare(`
    INSERT INTO usage_ledger (
      budget_id, reservation_id, owner_id, book_id, task_id, request_id, provider, model_id,
      input_tokens, output_tokens, cash_micros, duration_ms, recorded_at
    ) VALUES ('budget-1', 'resv-1', ?, 'member-book', NULL, 'req-1', 'test', 'test-model', ?, 0, 0, 0, ?)
  `).run(ownerId, tokens, recordedAt);
}

describe('会员系统：管理端开通、算力值与生成门禁', () => {
  it('管理员可开通、续费和撤销会员，普通用户无权操作', async () => {
    context = createTestContext('wenmi-membership-admin-');
    const app = await createServer(context.config, context.database);
    try {
      const adminRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const userRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' } });
      const adminCookie = cookieFrom(adminRegister);
      const userCookie = cookieFrom(userRegister);
      const rows = accountRows(context.database);
      const admin = rows.find((row) => row.email_normalized === 'admin@example.com')!;
      const user = rows.find((row) => row.email_normalized === 'writer@example.com')!;

      const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/memberships', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(denied.statusCode).toBe(403);
      const badPlan = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'lifetime' } });
      expect(badPlan.statusCode).toBe(400);
      const missingUser = await app.inject({ method: 'POST', url: '/api/v1/admin/memberships/no-such-user', headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'silver' } });
      expect(missingUser.statusCode).toBe(404);

      // 注册即自动发放青铜体验（2026-08-20 起），无需管理员操作。
      const emptyStatus = await app.inject({ method: 'GET', url: '/api/v1/membership/me', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(emptyStatus.statusCode).toBe(200);
      expect(emptyStatus.json().data.membership).toMatchObject({
        plan: 'bronze', planLabel: '青铜会员', status: 'active',
        computeQuota: MEMBERSHIP_PLANS.bronze.tokenQuota, computeConsumed: 0, expired: false
      });

      const grant = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'silver' } });
      expect(grant.statusCode).toBe(200);
      expect(grant.json().data.membership).toMatchObject({
        plan: 'silver', planLabel: '白银会员', status: 'active',
        computeQuota: MEMBERSHIP_PLANS.silver.tokenQuota, computeConsumed: 0,
        computeRemaining: MEMBERSHIP_PLANS.silver.tokenQuota, expired: false
      });

      const renew = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'diamond' } });
      expect(renew.statusCode).toBe(200);
      expect(renew.json().data.membership).toMatchObject({ plan: 'diamond', planLabel: '钻石会员', computeQuota: MEMBERSHIP_PLANS.diamond.tokenQuota });

      const list = await app.inject({ method: 'GET', url: '/api/v1/admin/memberships', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(list.statusCode).toBe(200);
      const entries = (list.json().data as { items: Array<{ userId: string; membership: { plan: string } | null }> }).items;
      expect(entries).toHaveLength(2);
      expect(entries.find((entry) => entry.userId === user.user_id)?.membership).toMatchObject({ plan: 'diamond' });

      const revoke = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}/revoke`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: {} });
      expect(revoke.statusCode).toBe(200);
      const revokedStatus = await app.inject({ method: 'GET', url: '/api/v1/membership/me', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(revokedStatus.json().data).toEqual({ isAdmin: false, membership: null });
      const revokeAgain = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}/revoke`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: {} });
      expect(revokeAgain.statusCode).toBe(409);

      const adminStatus = await app.inject({ method: 'GET', url: '/api/v1/membership/me', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(adminStatus.json().data).toEqual({ isAdmin: true, membership: null });
      expect(admin.role).toBe('admin');
    } finally {
      await app.close();
    }
  });

  it('生成门禁：未开通、算力值用完分别被拦截，管理员与未关联账号不受限', () => {
    context = createTestContext('wenmi-membership-gate-');
    const database = context.database;
    const clock = new FixedClock(new Date('2026-08-15T00:00:00.000Z'));
    const memberships = new MembershipService(database, clock);
    const now = clock.now().toISOString();

    // 未关联账号的合成所有者不受门禁限制（本机遗留工作区/测试所有者）。
    expect(() => assertMembershipAllowsGeneration(database, 'owner-synthetic', now)).not.toThrow();

    const adminRegister = { user_id: 'user-admin', owner_id: 'owner-admin', role: 'admin' };
    seedOwner(database, adminRegister.owner_id, now);
    database.prepare(`
      INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, 'admin@example.com', '管理员', 'salt', 'hash', 'admin', 'active', ?, ?)
    `).run(adminRegister.user_id, adminRegister.owner_id, now, now);
    expect(() => assertMembershipAllowsGeneration(database, adminRegister.owner_id, now)).not.toThrow();

    const user = { user_id: 'user-writer', owner_id: 'owner-writer', role: 'user' };
    seedOwner(database, user.owner_id, now);
    database.prepare(`
      INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, 'writer@example.com', '作者', 'salt', 'hash', 'user', 'active', ?, ?)
    `).run(user.user_id, user.owner_id, now, now);

    expect(() => assertMembershipAllowsGeneration(database, user.owner_id, now)).toThrowError(expect.objectContaining({ code: 'MEMBERSHIP_REQUIRED' }) as unknown as Error);

    memberships.grant(adminRegister.user_id, user.user_id, 'silver');
    expect(() => assertMembershipAllowsGeneration(database, user.owner_id, now)).not.toThrow();

    // 周期内用完套餐算力值后再次拦截：配额是算力值（双倍口径），真实 token 用掉一半即耗尽。
    const realTokensToExhaust = MEMBERSHIP_PLANS.silver.tokenQuota / 2;
    seedBookAndUsage(database, user.owner_id, realTokensToExhaust, now);
    try {
      assertMembershipAllowsGeneration(database, user.owner_id, now);
      expect.unreachable('算力值用完后应当被拦截');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('MEMBERSHIP_QUOTA_EXHAUSTED');
    }

    // 管理列表能读到周期消耗与累计消耗（真实 token 口径，供与供应商后台对账）。
    const list = memberships.listUsersWithMembership();
    const entry = list.items.find((row) => row.userId === user.user_id);
    expect(entry?.membership).toMatchObject({ plan: 'silver', periodTokens: realTokensToExhaust });
    expect(entry?.totalTokens).toBe(realTokensToExhaust);

    // statusForOwner 汇报算力值口径：已消耗=真实×2，剩余 0。
    const status = memberships.statusForOwner(user.owner_id);
    expect(status.membership).toMatchObject({ computeConsumed: MEMBERSHIP_PLANS.silver.tokenQuota, computeRemaining: 0 });
  });

  it('无会员用户可以开书但不会创建首个AI任务，开通会员后恢复', async () => {
    context = createTestContext('wenmi-membership-onboarding-');
    const app = await createServer(context.config, context.database);
    try {
      const adminRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const userRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' } });
      const adminCookie = cookieFrom(adminRegister);
      const userCookie = cookieFrom(userRegister);
      const rows = accountRows(context.database);
      const user = rows.find((row) => row.email_normalized === 'writer@example.com')!;
      // 新注册默认发放青铜体验；本用例验证"无会员"路径，先撤销青铜恢复未开通状态。
      const revokeBronze = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}/revoke`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: {} });
      expect(revokeBronze.statusCode).toBe(200);
      const openingBlueprint = {
        styleIntent: { languageTones: ['自然'], emotionalTones: ['热血'], pacingAndPayoff: ['紧凑'], atmospheres: ['历史'], custom: [] },
        taxonomyVersion: OPENING_TAXONOMY.version, channel: 'male', categoryKey: 'male-history-brain',
        targetAudience: '历史题材读者',
        protagonists: [{ role: 'male_lead', name: '赵四', age: '二十岁', background: '朱仙镇屯兵之子。', personalities: ['果断'] }],
        storyDirection: '赵四进入南宋副本，从朱仙镇开始改写岳家军的命运。',
        worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' },
        fullBookOutline: '赵四在一个个历史副本里积攒人心与力量。', mainTags: ['历史'], auxiliaryTags: [],
        storyTraits: [], customTags: ['成长'], initialMap: '', mustFollow: ['不偏离历史主线']
      };

      // 未开通会员：开书本身必须成功（否则用户进不了设定页看会员提示）。
      const draft = (await app.inject({ method: 'POST', url: '/api/v1/books/drafts', headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: { title: '无会员开书', text: '验证开书不被会员门禁拦截', openingBlueprint } })).json().data as { draftId: string; version: number };
      const confirm = await app.inject({ method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: { expectedVersion: draft.version } });
      expect(confirm.statusCode).toBe(200);
      const bookId = (confirm.json().data as { bookId: string }).bookId;
      const taskCount = (context.database.prepare('SELECT COUNT(*) AS total FROM tasks WHERE owner_id = ?').get(user.owner_id) as { total: number }).total;
      expect(taskCount).toBe(0);
      const discussionCount = (context.database.prepare('SELECT COUNT(*) AS total FROM discussions WHERE owner_id = ?').get(user.owner_id) as { total: number }).total;
      expect(discussionCount).toBe(0);

      // 未开通会员：手动召集 AI 被会员门禁拦截。
      const blockedPanel = await app.inject({
        method: 'POST', url: `/api/v1/books/${bookId}/setting-outline-workspace/story-kernel/collaboration/start`,
        headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: { idempotencyKey: 'membership-blocked-panel' }
      });
      expect(blockedPanel.statusCode).toBe(403);
      expect((blockedPanel.json() as { error: { code: string } }).error.code).toBe('MEMBERSHIP_REQUIRED');

      // 开通会员后再次开书：建书不再自动建任务，手动召集照常创建任务。
      const grant = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'silver' } });
      expect(grant.statusCode).toBe(200);
      const memberDraft = (await app.inject({ method: 'POST', url: '/api/v1/books/drafts', headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: { title: '会员开书', text: '验证会员开书创建首个任务', openingBlueprint } })).json().data as { draftId: string; version: number };
      const memberConfirm = await app.inject({ method: 'POST', url: `/api/v1/book-drafts/${memberDraft.draftId}/confirm`, headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: { expectedVersion: memberDraft.version } });
      expect(memberConfirm.statusCode).toBe(200);
      const memberBookId = (memberConfirm.json().data as { bookId: string }).bookId;
      const memberTaskCount = (context.database.prepare('SELECT COUNT(*) AS total FROM tasks WHERE owner_id = ?').get(user.owner_id) as { total: number }).total;
      expect(memberTaskCount).toBe(0);
      const startPanel = await app.inject({
        method: 'POST', url: `/api/v1/books/${memberBookId}/setting-outline-workspace/story-kernel/collaboration/start`,
        headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: { idempotencyKey: 'membership-first-panel' }
      });
      expect(startPanel.statusCode).toBe(200);
      const taskCountAfterStart = (context.database.prepare('SELECT COUNT(*) AS total FROM tasks WHERE owner_id = ?').get(user.owner_id) as { total: number }).total;
      expect(taskCountAfterStart).toBeGreaterThan(0);
      expect(bookId).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('会员到期后生成被拦截，状态里标记已到期', () => {
    context = createTestContext('wenmi-membership-expiry-');
    const database = context.database;
    const clock = new MutableClock(new Date('2026-08-15T00:00:00.000Z'));
    const memberships = new MembershipService(database, clock);
    const now = clock.now().toISOString();

    const admin = { user_id: 'user-admin', owner_id: 'owner-admin' };
    const user = { user_id: 'user-writer', owner_id: 'owner-writer' };
    for (const account of [admin, user]) {
      seedOwner(database, account.owner_id, now);
      database.prepare(`
        INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'salt', 'hash', 'user', 'active', ?, ?)
      `).run(account.user_id, account.owner_id, `${account.user_id}@example.com`, account.user_id, now, now);
    }

    memberships.grant(admin.user_id, user.user_id, 'silver');
    // 付费档周期 12 个月：推进 370 天后到期拦截。
    clock.advance(370 * 24 * 60 * 60 * 1000);
    const later = clock.now().toISOString();
    expect(() => assertMembershipAllowsGeneration(database, user.owner_id, later)).toThrowError(expect.objectContaining({ code: 'MEMBERSHIP_EXPIRED' }) as unknown as Error);
    expect(memberships.statusForOwner(user.owner_id).membership).toMatchObject({ expired: true, status: 'active' });
  });
});
