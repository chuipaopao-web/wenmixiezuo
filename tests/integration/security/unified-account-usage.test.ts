import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../../../apps/api/src/http/server.js';
import {
  accountUsageTotals,
  SupplementalAccountUsageRepository
} from '../../../apps/api/src/infrastructure/security/account-usage-service.js';
import {
  assertMembershipAllowsGeneration,
  MembershipService
} from '../../../apps/api/src/infrastructure/security/membership-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};
const HASH = 'a'.repeat(64);

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

function insertTokenCallRows(database: TestContext['database'], ownerId: string, bookId: string, at: string): void {
  database.prepare(`INSERT INTO usage_ledger (
    budget_id,reservation_id,owner_id,book_id,task_id,request_id,provider,model_id,
    input_tokens,output_tokens,cash_micros,duration_ms,recorded_at
  ) VALUES ('missing-budget','missing-reservation',?,? ,NULL,'ledger-success','provider','ledger-model',10,5,100,1,?)`)
    .run(ownerId, bookId, at);

  for (const [suffix, state, reserved, input, output, cash, completed] of stateRows('interrupted')) {
    database.prepare(`INSERT INTO prebook_opening_design_calls (
      call_id,owner_id,idempotency_key,attempt_no,input_hash,role_key,member_name,provider,model_id,state,
      reserved_tokens,input_tokens,output_tokens,cash_micros,duration_ms,result_json,error_class,error_detail,
      started_at,completed_at,created_at,updated_at
    ) VALUES (?,?,?,1,?,'chief_editor','主编','provider','prebook-model',?,?,?,?,?,1,NULL,NULL,NULL,?,?,?,?)`)
      .run(`prebook-${suffix}`, ownerId, `prebook-idem-${suffix}`, HASH, state, reserved, input, output, cash, at, completed ? at : null, at, at);
  }

  for (const [suffix, state, reserved, input, output, cash, completed] of stateRows('unknown')) {
    database.prepare(`INSERT INTO v7_opening_agent_model_calls (
      request_id,owner_id,task_id,node_key,member_key,provider,model_id,plan,state,prompt_hash,
      reserved_tokens,input_tokens,output_tokens,cash_micros,started_at,completed_at,created_at,updated_at
    ) VALUES (?,?,'missing-opening-task','design','chief','provider','opening-model','agent',?,?, ?,?,?,?, ?,?,?,?)`)
      .run(`opening-${suffix}`, ownerId, state, HASH, reserved, input, output, cash, at, completed ? at : null, at, at);
  }

  for (const [suffix, state, reserved, input, output, cash, completed] of stateRows('unknown')) {
    database.prepare(`INSERT INTO v7_setting_model_calls (
      request_id,owner_id,book_id,batch_id,item_key,node_key,member_key,provider,model_id,plan,state,prompt_hash,
      reserved_tokens,input_tokens,output_tokens,cash_micros,started_at,completed_at,updated_at
    ) VALUES (?,?,?,'missing-batch','world','design','editor','provider','setting-model','agent',?,?, ?,?,?,?, ?,?,?)`)
      .run(`setting-${suffix}`, ownerId, bookId, state, HASH, reserved, input, output, cash, at, completed ? at : null, at);
  }

  for (const [suffix, state, reserved, input, output, cash, completed] of stateRows('unknown')) {
    database.prepare(`INSERT INTO v7_planning_model_calls (
      request_id,owner_id,book_id,run_id,run_kind,node_key,member_key,provider,model_id,plan,state,prompt_hash,
      reserved_tokens,input_tokens,output_tokens,cash_micros,started_at,completed_at,updated_at
    ) VALUES (?,?,?,'planning-run','tree','route','editor','provider','planning-model','agent',?,?, ?,?,?,?, ?,?,?)`)
      .run(`planning-${suffix}`, ownerId, bookId, state, HASH, reserved, input, output, cash, at, completed ? at : null, at);
  }

  for (const [suffix, state, reserved, input, output, cash, completed] of stateRows('unknown')) {
    database.prepare(`INSERT INTO v7_character_model_calls (
      request_id,owner_id,book_id,run_id,run_kind,member_key,provider,model_id,plan,state,prompt_hash,
      reserved_tokens,input_tokens,output_tokens,cash_micros,started_at,completed_at,updated_at
    ) VALUES (?,?,?,'character-run','context_pack','editor','provider','character-model','agent',?,?, ?,?,?,?, ?,?,?)`)
      .run(`character-${suffix}`, ownerId, bookId, state, HASH, reserved, input, output, cash, at, completed ? at : null, at);
  }

  for (const [suffix, state, reserved, input, output, cash, completed] of stateRows('unknown')) {
    database.prepare(`INSERT INTO v7_creation_model_calls (
      request_id,owner_id,book_id,workflow_id,run_kind,node_key,member_key,provider,model_id,plan,purpose,state,prompt_hash,
      reserved_tokens,input_tokens,output_tokens,cash_micros,started_at,completed_at,updated_at
    ) VALUES (?,?,?,'missing-workflow','outline','outline','editor','provider','creation-model','agent','structured_planning',?,?, ?,?,?,?, ?,?,?)`)
      .run(`creation-${suffix}`, ownerId, bookId, state, HASH, reserved, input, output, cash, at, completed ? at : null, at);
  }
}

function stateRows(reservedState: 'interrupted' | 'unknown'): Array<[string, string, number, number | null, number | null, number | null, boolean]> {
  return [
    ['success', 'succeeded', 20, 10, 5, 100, true],
    ['reserved', reservedState === 'interrupted' ? 'interrupted' : 'working', 20, null, null, null, false],
    ['failed', 'failed', 20, null, null, null, true]
  ];
}

describe('统一账号级用量投影', () => {
  it('缺少统一投影时在外部调用前失败，不允许静默漏记V7计费用量', () => {
    const database = new DatabaseSync(':memory:');
    try {
      expect(() => new SupplementalAccountUsageRepository(database).start({
        sourceKind: 'v7_title', sourceId: 'missing-projection-call', ownerId: 'owner', bookId: 'book',
        provider: 'provider', modelId: 'model', reservedTokens: 100, startedAt: new Date().toISOString()
      })).toThrow('账号用量投影尚未就绪');
    } finally {
      database.close();
    }
  });

  it('逐来源区分成功、预留和失败，并让补充来源覆盖同一原生书名/封面而不双计', () => {
    context = createTestContext('wenmi-unified-usage-sources-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const ownerId = context.config.ownerId;
    const book = initializeDomainBook(context, ownerId, ids, clock, { title: '统一用量测试书' });
    const at = clock.now().toISOString();
    context.database.exec('PRAGMA foreign_keys = OFF');
    insertTokenCallRows(context.database, ownerId, book.bookId, at);

    context.database.prepare(`INSERT INTO v7_book_title_design_calls (
      design_id,owner_id,book_id,idempotency_key,request_hash,source_version,member_key,state,prompt_hash,
      provider,model_id,input_tokens,output_tokens,cash_micros,options_json,created_at,completed_at,updated_at
    ) VALUES ('title-legacy',?,?, 'title-legacy-idem',?,1,'chief','succeeded',?,'provider','title-model',10,5,100,'[]',?,?,?)`)
      .run(ownerId, book.bookId, HASH, HASH, at, at, at);
    context.database.prepare(`INSERT INTO v7_book_title_design_calls (
      design_id,owner_id,book_id,idempotency_key,request_hash,source_version,member_key,state,prompt_hash,
      provider,model_id,input_tokens,output_tokens,cash_micros,options_json,created_at,completed_at,updated_at
    ) VALUES ('title-new',?,?, 'title-new-idem',?,1,'chief','succeeded',?,'provider','title-model',10,5,100,'[]',?,?,?)`)
      .run(ownerId, book.bookId, HASH, HASH, at, at, at);

    context.database.prepare(`INSERT INTO v7_book_cover_designs (
      design_id,owner_id,book_id,idempotency_key,request_hash,source_version,chief_member_key,visual_member_key,
      state,work_order_json,provider,model_id,created_at,completed_at,updated_at
    ) VALUES ('cover-legacy',?,?,'cover-legacy-idem',?,1,'chief','visual','succeeded','{}','image-provider','image-model',?,?,?)`)
      .run(ownerId, book.bookId, HASH, at, at, at);
    context.database.prepare(`INSERT INTO v7_book_cover_designs (
      design_id,owner_id,book_id,idempotency_key,request_hash,source_version,chief_member_key,visual_member_key,
      state,work_order_json,provider,model_id,created_at,completed_at,updated_at
    ) VALUES ('cover-new',?,?,'cover-new-idem',?,1,'chief','visual','succeeded','{}','image-provider','image-model',?,?,?)`)
      .run(ownerId, book.bookId, HASH, at, at, at);

    const supplemental = new SupplementalAccountUsageRepository(context.database);
    supplemental.start({
      sourceKind: 'v7_title', sourceId: 'title-new', ownerId, bookId: book.bookId,
      provider: 'provider', modelId: 'title-model', reservedTokens: 25, startedAt: at
    });
    supplemental.succeed({ sourceKind: 'v7_title', sourceId: 'title-new', inputTokens: 11, outputTokens: 6, cashMicros: 120, completedAt: at });
    // 重复启动、按相同结果结算必须幂等。
    supplemental.start({
      sourceKind: 'v7_title', sourceId: 'title-new', ownerId, bookId: book.bookId,
      provider: 'provider', modelId: 'title-model', reservedTokens: 25, startedAt: at
    });
    supplemental.succeed({ sourceKind: 'v7_title', sourceId: 'title-new', inputTokens: 11, outputTokens: 6, cashMicros: 120, completedAt: at });
    supplemental.start({
      sourceKind: 'v7_cover_text', sourceId: 'cover-text-success', ownerId, bookId: book.bookId,
      provider: 'provider', modelId: 'cover-text-model', reservedTokens: 25, startedAt: at
    });
    supplemental.succeed({ sourceKind: 'v7_cover_text', sourceId: 'cover-text-success', inputTokens: 10, outputTokens: 5, cashMicros: 100, completedAt: at });
    supplemental.start({
      sourceKind: 'v7_cover_text', sourceId: 'cover-text-reserved', ownerId, bookId: book.bookId,
      provider: 'provider', modelId: 'cover-text-model', reservedTokens: 20, startedAt: at
    });
    supplemental.markUnknown('v7_cover_text', 'cover-text-reserved', at);
    supplemental.start({
      sourceKind: 'v7_cover_text', sourceId: 'cover-text-failed', ownerId, bookId: book.bookId,
      provider: 'provider', modelId: 'cover-text-model', reservedTokens: 20, startedAt: at
    });
    supplemental.fail('v7_cover_text', 'cover-text-failed', at);
    supplemental.start({
      sourceKind: 'v7_cover_image', sourceId: 'cover-new', ownerId, bookId: book.bookId,
      provider: 'image-provider', modelId: 'image-model', reservedUnits: 1, startedAt: at
    });
    supplemental.succeed({ sourceKind: 'v7_cover_image', sourceId: 'cover-new', consumedUnits: 1, completedAt: at });

    const rows = context.database.prepare(`SELECT source_kind,source_id,usage_state,consumed_tokens,reserved_tokens,
      consumed_units,reserved_units FROM account_usage_projection WHERE owner_id=?`).all(ownerId) as unknown as Array<{
        source_kind: string; source_id: string; usage_state: string; consumed_tokens: number;
        reserved_tokens: number; consumed_units: number; reserved_units: number;
      }>;
    expect(context.database.prepare(`SELECT source_kind,source_id,COUNT(*) AS count FROM account_usage_projection
      GROUP BY source_kind,source_id HAVING COUNT(*)>1`).all()).toEqual([]);
    for (const source of ['prebook_opening', 'v7_opening', 'v7_setting', 'v7_planning', 'v7_character', 'v7_creation']) {
      const sourceRows = rows.filter((row) => row.source_kind === source);
      expect(sourceRows.map((row) => row.usage_state).sort(), source).toEqual(['consumed', 'failed', 'reserved']);
      expect(sourceRows.find((row) => row.usage_state === 'consumed')?.consumed_tokens, source).toBe(15);
      expect(sourceRows.find((row) => row.usage_state === 'reserved')?.reserved_tokens, source).toBe(20);
      expect(sourceRows.find((row) => row.usage_state === 'failed')).toMatchObject({ consumed_tokens: 0, reserved_tokens: 0 });
    }
    expect(rows.filter((row) => row.source_kind === 'v7_title' && row.source_id === 'title-new')).toHaveLength(1);
    expect(rows.find((row) => row.source_kind === 'v7_title' && row.source_id === 'title-new')?.consumed_tokens).toBe(17);
    expect(rows.find((row) => row.source_kind === 'v7_title' && row.source_id === 'title-legacy')?.consumed_tokens).toBe(15);
    expect(rows.filter((row) => row.source_kind === 'v7_cover_image' && row.source_id === 'cover-new')).toHaveLength(1);
    expect(rows.find((row) => row.source_kind === 'v7_cover_image' && row.source_id === 'cover-new')?.consumed_units).toBe(1);
    expect(rows.find((row) => row.source_kind === 'v7_cover_image' && row.source_id === 'cover-legacy')?.consumed_units).toBe(1);
    expect(rows.find((row) => row.source_id === 'cover-text-reserved')).toMatchObject({ usage_state: 'reserved', reserved_tokens: 20 });
    expect(rows.find((row) => row.source_id === 'cover-text-failed')).toMatchObject({ usage_state: 'failed', consumed_tokens: 0, reserved_tokens: 0 });

    const totals = accountUsageTotals(context.database, { ownerId });
    // usage_ledger 15 + six native V7/prebook sources 90 + two title calls 32 + cover text 15.
    expect(totals.consumedTokens).toBe(152);
    // six native reservations 120 + one supplemental cover-text reservation 20.
    expect(totals.reservedTokens).toBe(140);
    expect(totals.consumedUnits).toBe(2);
  });

  it('会员门禁、会员汇总、管理员用量和仪表盘都读取同一权威口径', async () => {
    context = createTestContext('wenmi-unified-usage-consumers-');
    const app = await createServer(context.config, context.database);
    try {
      const adminRegistration = await app.inject({
        method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' }
      });
      const userRegistration = await app.inject({
        method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
        payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' }
      });
      const adminCookie = cookieFrom(adminRegistration);
      const userCookie = cookieFrom(userRegistration);
      const user = context.database.prepare(`SELECT user_id,owner_id FROM user_accounts WHERE email_normalized='writer@example.com'`)
        .get() as { user_id: string; owner_id: string };
      const ids = new SequenceIds();
      const book = initializeDomainBook(context, user.owner_id, ids, new FixedClock(), { title: '统一会员口径测试书' });
      const now = new Date().toISOString();
      context.database.prepare(`UPDATE user_memberships SET token_quota=100,period_start=?,period_end='2099-12-31T00:00:00.000Z'
        WHERE user_id=?`).run(new Date(Date.now() - 60_000).toISOString(), user.user_id);
      context.database.prepare(`INSERT INTO v7_planning_model_calls (
        request_id,owner_id,book_id,run_id,run_kind,node_key,member_key,provider,model_id,plan,state,prompt_hash,
        reserved_tokens,input_tokens,output_tokens,cash_micros,started_at,completed_at,updated_at
      ) VALUES ('planning-consumed',?,?,'run','tree','route','editor','provider','planning-model','agent','succeeded',?,40,20,10,500,?,?,?)`)
        .run(user.owner_id, book.bookId, HASH, now, now, now);
      context.database.prepare(`INSERT INTO v7_planning_model_calls (
        request_id,owner_id,book_id,run_id,run_kind,node_key,member_key,provider,model_id,plan,state,prompt_hash,
        reserved_tokens,started_at,updated_at
      ) VALUES ('planning-reserved',?,?,'run','tree','route','editor','provider','planning-model','agent','working',?,20,?,?)`)
        .run(user.owner_id, book.bookId, HASH, now, now);
      const supplemental = new SupplementalAccountUsageRepository(context.database);
      supplemental.start({
        sourceKind: 'v7_cover_image', sourceId: 'cover-consumed', ownerId: user.owner_id, bookId: book.bookId,
        provider: 'image-provider', modelId: 'image-model', reservedUnits: 1, startedAt: now
      });
      supplemental.succeed({
        sourceKind: 'v7_cover_image', sourceId: 'cover-consumed', consumedUnits: 1, completedAt: now
      });
      supplemental.start({
        sourceKind: 'v7_cover_image', sourceId: 'cover-reserved', ownerId: user.owner_id, bookId: book.bookId,
        provider: 'image-provider', modelId: 'image-model', reservedUnits: 1, startedAt: now
      });

      expect(() => assertMembershipAllowsGeneration(context!.database, user.owner_id, now))
        .toThrowError(expect.objectContaining({ code: 'MEMBERSHIP_QUOTA_EXHAUSTED' }) as unknown as Error);
      const status = new MembershipService(context.database, new FixedClock(new Date(now))).statusForOwner(user.owner_id);
      expect(status.membership).toMatchObject({ computeQuota: 100, computeConsumed: 60, computeRemaining: 40 });

      const membershipList = await app.inject({ method: 'GET', url: '/api/v1/admin/memberships', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      const membershipEntry = membershipList.json().data.items.find((item: { userId: string }) => item.userId === user.user_id);
      expect(membershipEntry).toMatchObject({ totalTokens: 30, membership: { periodTokens: 30 } });

      const usage = await app.inject({ method: 'GET', url: '/api/v1/admin/usage', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(usage.statusCode).toBe(200);
      expect(usage.json().data).toMatchObject({
        totalTokens: 30, totalInputTokens: 20, totalOutputTokens: 10, totalCashMicros: 500,
        totalImageUnits: 1, totalReservedImageUnits: 1, totalCalls: 2
      });
      const usageUser = usage.json().data.perUser.find((item: { userId: string }) => item.userId === user.user_id);
      expect(usageUser).toMatchObject({ tokens: 30, calls: 2, cashMicros: 500, imageUnits: 1, reservedImageUnits: 1 });

      const dashboard = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json().data.overview).toMatchObject({
        computeToday: 60, apiCashMicrosToday: 500, imageUnitsToday: 1, reservedImageUnits: 1
      });
      expect(dashboard.json().data.topUsers[0]).toMatchObject({
        userId: user.user_id, compute: 60, calls: 2, cashMicros: 500, imageUnits: 1
      });

      const self = await app.inject({ method: 'GET', url: '/api/v1/membership/me', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(self.json().data.membership).toMatchObject({ computeConsumed: 60 });
    } finally {
      await app.close();
    }
  });
});
