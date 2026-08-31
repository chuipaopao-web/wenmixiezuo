import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import {
  assertMembershipAllowsGeneration,
  MembershipService,
  MEMBERSHIP_PLANS
} from '../../../apps/api/src/infrastructure/security/membership-service.js';
import { FixedClock, MutableClock } from '../../helpers/test-context.js';
import { DomainError } from '../../../apps/api/src/domain/errors.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';

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
      const missingUser = await app.inject({ method: 'POST', url: '/api/v1/admin/memberships/no-such-user', headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'silver', idempotencyKey: 'membership-missing-0001' } });
      expect(missingUser.statusCode).toBe(404);

      // 注册即自动发放青铜体验（2026-08-20 起），无需管理员操作。
      const emptyStatus = await app.inject({ method: 'GET', url: '/api/v1/membership/me', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(emptyStatus.statusCode).toBe(200);
      expect(emptyStatus.json().data.membership).toMatchObject({
        plan: 'bronze', planLabel: '青铜会员', status: 'active',
        computeQuota: MEMBERSHIP_PLANS.bronze.tokenQuota, computeConsumed: 0, expired: false
      });

      const grant = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'silver', idempotencyKey: 'membership-grant-0001' } });
      expect(grant.statusCode).toBe(200);
      expect(grant.json().data.membership).toMatchObject({
        plan: 'silver', planLabel: '白银会员', status: 'active',
        computeQuota: MEMBERSHIP_PLANS.silver.tokenQuota, computeConsumed: 0,
        computeRemaining: MEMBERSHIP_PLANS.silver.tokenQuota, expired: false
      });

      const grantReplay = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'silver', idempotencyKey: 'membership-grant-0001' } });
      expect(grantReplay.statusCode).toBe(200);
      expect(grantReplay.json().data.membership.periodEnd).toBe(grant.json().data.membership.periodEnd);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM membership_transactions WHERE idempotency_key=?')
        .get('membership-grant-0001')).toEqual({ count: 1 });
      const grantKeyConflict = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'gold', idempotencyKey: 'membership-grant-0001' } });
      expect(grantKeyConflict.statusCode).toBe(409);

      const renew = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'diamond', idempotencyKey: 'membership-renew-0001' } });
      expect(renew.statusCode).toBe(200);
      expect(renew.json().data.membership).toMatchObject({ plan: 'diamond', planLabel: '钻石会员', computeQuota: MEMBERSHIP_PLANS.diamond.tokenQuota });

      const list = await app.inject({ method: 'GET', url: '/api/v1/admin/memberships', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(list.statusCode).toBe(200);
      const entries = (list.json().data as { items: Array<{ userId: string; membership: { plan: string } | null }> }).items;
      expect(entries).toHaveLength(2);
      expect(entries.find((entry) => entry.userId === user.user_id)?.membership).toMatchObject({ plan: 'diamond' });

      const revoke = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}/revoke`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { idempotencyKey: 'membership-revoke-0001' } });
      expect(revoke.statusCode).toBe(200);
      const revokedStatus = await app.inject({ method: 'GET', url: '/api/v1/membership/me', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(revokedStatus.json().data).toEqual({ isAdmin: false, membership: null });
      const revokeReplay = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}/revoke`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { idempotencyKey: 'membership-revoke-0001' } });
      expect(revokeReplay.statusCode).toBe(200);
      const revokeAgain = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}/revoke`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { idempotencyKey: 'membership-revoke-0002' } });
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

  it('无会员用户不能调用V7模型，开通会员后同一能力恢复', async () => {
    context = createTestContext('wenmi-membership-onboarding-');
    context.config.modelRuntime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    const generate = vi.fn(async () => ({
      provider: 'test-provider', modelId: 'deepseek-v4-pro',
      output: JSON.stringify({ options: [
        { text: '汉末执棋人', note: '权谋成长' },
        { text: '小卒定山河', note: '身份反差' },
        { text: '边军起势', note: '底层开局' }
      ] }),
      inputTokens: 30, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const
    }));
    const app = await createServer(context.config, context.database, {
      v7OpeningModelAdapters: { resolve: () => ({ provider: 'test-provider', modelId: 'deepseek-v4-pro', generate }) }
    });
    try {
      const adminRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const userRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' } });
      const adminCookie = cookieFrom(adminRegister);
      const userCookie = cookieFrom(userRegister);
      const rows = accountRows(context.database);
      const user = rows.find((row) => row.email_normalized === 'writer@example.com')!;
      const revokeBronze = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}/revoke`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { idempotencyKey: 'membership-onboarding-revoke' } });
      expect(revokeBronze.statusCode).toBe(200);
      const manualBook = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...BROWSER_HEADERS, cookie: userCookie },
        payload: {
          openingPackage: {
            title: 'V7会员门禁测试书',
            positioning: { publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: [], tags: [], coreAppeal: '', expectedTotalWords: 1_000_000 },
            backgrounds: { eraAndWorld: '', openingSituation: '' },
            protagonists: [{ name: '赵四', age: '青年', identity: '男主', background: '现代青年。', familyBackground: '', careerBackground: '', goldenFinger: '', goal: '', dilemma: '', personality: ['果断'], boundary: '' }],
            opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
            longTermDirection: { centralConflict: '', progression: '', relationshipDirection: '', storyPotential: '' },
            possibleEnding: { direction: '', price: '', openness: '' }, authorNotes: [], mustFollow: ['不偏离历史主线']
          },
          idempotencyKey: 'membership-v7-book-0001'
        }
      });
      expect(manualBook.statusCode).toBe(200);
      const bookId = manualBook.json().data.bookId as string;

      const blocked = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/title-designs`,
        headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: { idempotencyKey: 'membership-blocked-v7' }
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe('MEMBERSHIP_REQUIRED');
      expect(generate).not.toHaveBeenCalled();

      const grant = await app.inject({ method: 'POST', url: `/api/v1/admin/memberships/${user.user_id}`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { plan: 'silver', idempotencyKey: 'membership-onboarding-grant' } });
      expect(grant.statusCode).toBe(200);
      const allowed = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/title-designs`,
        headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: { idempotencyKey: 'membership-allowed-v7' }
      });
      expect(allowed.statusCode).toBe(200);
      expect(generate).toHaveBeenCalledTimes(1);
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
