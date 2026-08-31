import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock } from '../../domain/ids.js';
import { accountUsageRelation, accountUsageTotals } from './account-usage-service.js';

/**
 * 算力值口径（2026-08-20 老板拍板）：算力值 = 真实 token × 2。
 * 账号级权威用量投影及其底层来源永远记真实 token（与模型服务后台对齐）；
 * 会员配额、前台展示一律用算力值（双倍），前端不出现 token 字眼。
 */
export const COMPUTE_VALUE_MULTIPLIER = 2;

/** 算力值配额换算成真实 token 额度（预算、冻结等真实口径使用）。 */
export function realTokenAllowance(computeQuota: number): number {
  return Math.max(1, Math.floor(computeQuota / COMPUTE_VALUE_MULTIPLIER));
}

/** 会员套餐：周期（自然月数）与算力值配额。青铜为免费体验档，长期有效不卡到期。 */
export const MEMBERSHIP_PLANS = {
  bronze: { months: 1200, tokenQuota: 200_000 },
  silver: { months: 12, tokenQuota: 20_000_000 },
  gold: { months: 12, tokenQuota: 50_000_000 },
  diamond: { months: 12, tokenQuota: 200_000_000 }
} as const;

export type MembershipPlan = keyof typeof MEMBERSHIP_PLANS;

export const MEMBERSHIP_PLAN_LABELS: Record<MembershipPlan, string> = {
  bronze: '青铜会员',
  silver: '白银会员',
  gold: '黄金会员',
  diamond: '钻石会员'
};

/** 各档位公开价格，仅用于展示。 */
export const MEMBERSHIP_PLAN_PRICES: Record<MembershipPlan, string> = {
  bronze: '免费',
  silver: '98元',
  gold: '198元',
  diamond: '980元'
};

/** 后台会员流水的默认实收金额；管理员可在办理时按真实收款覆盖。 */
export const MEMBERSHIP_PLAN_PRICE_CASH_MICROS: Record<MembershipPlan, number> = {
  bronze: 0,
  silver: 98_000_000,
  gold: 198_000_000,
  diamond: 980_000_000
};


/** 办理会员联系方式的唯一来源；错误详情与前端提示共用。 */
export const MEMBERSHIP_CONTACT = { wechat: '595341366' } as const;

export function isMembershipPlan(value: unknown): value is MembershipPlan {
  return typeof value === 'string' && value in MEMBERSHIP_PLANS;
}

interface AccountRow { user_id: string; owner_id: string; role: string; }

interface MembershipRow {
  user_id: string;
  owner_id: string;
  plan: MembershipPlan;
  token_quota: number;
  period_start: string;
  period_end: string;
  status: 'active' | 'revoked';
}

export interface MembershipStatus {
  isAdmin: boolean;
  membership: null | {
    plan: MembershipPlan;
    planLabel: string;
    planPrice: string;
    status: 'active' | 'revoked';
    /** 以下三项均为算力值（=真实 token × 2），前台直接展示，不出现 token 字眼。 */
    computeQuota: number;
    computeConsumed: number;
    computeRemaining: number;
    periodStart: string;
    periodEnd: string;
    expired: boolean;
  };
}

export interface AdminMembershipUser {
  userId: string;
  displayName: string;
  email: string;
  role: 'admin' | 'user';
  accountStatus: 'active' | 'suspended';
  membership: null | {
    plan: MembershipPlan;
    planLabel: string;
    status: 'active' | 'revoked';
    tokenQuota: number;
    periodTokens: number;
    totalTokens: number;
    periodStart: string;
    periodEnd: string;
    expired: boolean;
  };
  totalTokens: number;
}

function findAccountByOwner(database: DatabaseSync, ownerId: string): AccountRow | undefined {
  return database.prepare('SELECT user_id, owner_id, role FROM user_accounts WHERE owner_id = ?').get(ownerId) as AccountRow | undefined;
}

function findAccountById(database: DatabaseSync, userId: string): AccountRow | undefined {
  return database.prepare('SELECT user_id, owner_id, role FROM user_accounts WHERE user_id = ?').get(userId) as AccountRow | undefined;
}

function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, daysInMonth));
  return date.toISOString();
}

/** 生成是否被会员门禁拦截；返回原因或 null（放行）。开书等前置流程用它避免误伤。 */
export function membershipGenerationBlockReason(
  database: DatabaseSync,
  ownerId: string,
  nowIso: string,
  additionalRealTokens = 0
): null | 'membership-required' | 'membership-expired' | 'quota-exhausted' {
  const account = findAccountByOwner(database, ownerId);
  if (account === undefined) return null;
  if (account.role === 'admin') return null;
  const row = database.prepare(
    "SELECT * FROM user_memberships WHERE owner_id = ? AND status = 'active'"
  ).get(ownerId) as MembershipRow | undefined;
  if (row === undefined) return 'membership-required';
  // 已有生效会员记录但周期已过：不是"从未开通"，应提示续费而非开通。
  if (row.period_end <= nowIso) return 'membership-expired';
  // 配额是算力值（双倍口径），真实消耗换算成算力值后再比较。
  const usage = accountUsageTotals(database, { ownerId, since: row.period_start });
  const committed = usage.consumedTokens + usage.reservedTokens + Math.max(0, additionalRealTokens);
  const projectedCompute = committed * COMPUTE_VALUE_MULTIPLIER;
  const quotaReached = additionalRealTokens > 0
    ? projectedCompute > row.token_quota
    : projectedCompute >= row.token_quota;
  return quotaReached ? 'quota-exhausted' : null;
}

/**
 * 生成门禁：账号体系内的非管理员用户必须持有生效会员且周期内算力值未耗尽。
 * 未关联账号的所有者（本机遗留工作区、测试合成所有者）不受门禁限制。
 */
export function assertMembershipAllowsGeneration(
  database: DatabaseSync,
  ownerId: string,
  nowIso: string,
  additionalRealTokens = 0
): void {
  const reason = membershipGenerationBlockReason(database, ownerId, nowIso, additionalRealTokens);
  if (reason === 'membership-required') {
    throw new DomainError(errorCodes.membershipRequired,
      '召集AI团队需使用算力，请联系管理员微信595341366开通会员。', { ...MEMBERSHIP_CONTACT }, false, 403);
  }
  if (reason === 'quota-exhausted') {
    throw new DomainError(errorCodes.membershipQuotaExhausted,
      '召集AI团队需使用算力，会员算力值已用完，请联系管理员微信595341366续费。', { ...MEMBERSHIP_CONTACT }, false, 403);
  }
  if (reason === 'membership-expired') {
    throw new DomainError(errorCodes.membershipExpired,
      '召集AI团队需使用算力，会员已到期，请联系管理员微信595341366续费。', { ...MEMBERSHIP_CONTACT }, false, 403);
  }
}

/** 书籍预算的真实 token 上限：跟随所有者当前会员等级，未开通会员（含管理员、遗留所有者）给宽松的默认值。 */
export const DEFAULT_BOOK_TOKEN_LIMIT = 20_000_000;

export function bookTokenLimitForOwner(database: DatabaseSync, ownerId: string): number {
  const row = database.prepare(
    "SELECT token_quota FROM user_memberships WHERE owner_id = ? AND status = 'active'"
  ).get(ownerId) as { token_quota: number } | undefined;
  if (row === undefined) return DEFAULT_BOOK_TOKEN_LIMIT;
  return realTokenAllowance(Number(row.token_quota));
}

/**
 * 新注册普通账号自动发放青铜体验（20万算力值，长期有效）。
 * 必须在注册事务内调用；granted_by 记本人（系统默认发放）。
 */
export function grantDefaultBronze(database: DatabaseSync, userId: string, ownerId: string, nowIso: string): void {
  database.prepare(`
    INSERT INTO user_memberships (
      user_id, owner_id, plan, token_quota, period_start, period_end, status, granted_by_user_id, created_at, updated_at
    ) VALUES (?, ?, 'bronze', ?, ?, '2099-12-31T00:00:00.000Z', 'active', ?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, ownerId, MEMBERSHIP_PLANS.bronze.tokenQuota, nowIso, userId, nowIso, nowIso);
}

export class MembershipService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly clock: Clock
  ) {}

  public statusForOwner(ownerId: string): MembershipStatus {
    const account = findAccountByOwner(this.database, ownerId);
    if (account === undefined) return { isAdmin: true, membership: null };
    if (account.role === 'admin') return { isAdmin: true, membership: null };
    const nowIso = this.clock.now().toISOString();
    const row = this.database.prepare(
      "SELECT * FROM user_memberships WHERE owner_id = ? AND status = 'active'"
    ).get(ownerId) as MembershipRow | undefined;
    if (row === undefined) return { isAdmin: false, membership: null };
    const consumed = accountUsageTotals(this.database, { ownerId, since: row.period_start }).consumedTokens;
    const computeConsumed = consumed * COMPUTE_VALUE_MULTIPLIER;
    const expired = row.period_end <= nowIso;
    return {
      isAdmin: false,
      membership: {
        plan: row.plan,
        planLabel: MEMBERSHIP_PLAN_LABELS[row.plan],
        planPrice: MEMBERSHIP_PLAN_PRICES[row.plan],
        status: row.status,
        computeQuota: Number(row.token_quota),
        computeConsumed,
        computeRemaining: Math.max(0, Number(row.token_quota) - computeConsumed),
        periodStart: row.period_start,
        periodEnd: row.period_end,
        expired
      }
    };
  }

  public grant(
    actorUserId: string,
    targetUserId: string,
    plan: MembershipPlan,
    payment: { amountCashMicros?: number; note?: string; idempotencyKey?: string } = {}
  ): MembershipStatus {
    if (!isMembershipPlan(plan)) {
      throw new DomainError(errorCodes.validation, '请选择青铜、白银、黄金或钻石会员', {}, false, 400);
    }
    const target = findAccountById(this.database, targetUserId);
    if (target === undefined) {
      throw new DomainError(errorCodes.validation, '目标账号不存在', {}, false, 404);
    }
    const definition = MEMBERSHIP_PLANS[plan];
    const nowIso = this.clock.now().toISOString();
    const amountCashMicros = payment.amountCashMicros ?? MEMBERSHIP_PLAN_PRICE_CASH_MICROS[plan];
    if (!Number.isInteger(amountCashMicros) || amountCashMicros < 0 || amountCashMicros > 100_000_000_000) {
      throw new DomainError(errorCodes.validation, '实收金额不正确', {}, false, 400);
    }
    const note = payment.note?.trim().slice(0, 500) ?? '';
    const idempotencyKey = membershipActionKey(payment.idempotencyKey);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (idempotencyKey !== null) {
        const replay = this.database.prepare(`
          SELECT user_id,event_type,plan,amount_cash_micros,note FROM membership_transactions
          WHERE actor_user_id=? AND idempotency_key=?
        `).get(actorUserId, idempotencyKey) as {
          user_id: string; event_type: string; plan: MembershipPlan; amount_cash_micros: number; note: string;
        } | undefined;
        if (replay !== undefined) {
          if (replay.user_id !== target.user_id || replay.event_type === 'revoke' || replay.plan !== plan
            || Number(replay.amount_cash_micros) !== amountCashMicros || replay.note !== note) {
            throw new DomainError(errorCodes.validation, '本次会员办理编号已经用于另一项操作', {}, false, 409);
          }
          this.database.exec('COMMIT');
          return this.statusForOwner(target.owner_id);
        }
      }
      // 续费顺延：已有生效会员的剩余天数保留，新周期从今天开始重新计量算力（配额按新套餐刷新），
      // 到期日从"剩余到期日或今天"往后加套餐月数，避免提前续费白白丢掉剩余时间。
      // 在事务内读取 existingActive，避免并发连续 grant 都基于旧 period_end 计算、丢失后一次顺延。
      const existingActive = this.database.prepare(
        "SELECT plan, period_end FROM user_memberships WHERE user_id = ? AND status = 'active'"
      ).get(target.user_id) as { plan: MembershipPlan; period_end: string } | undefined;
      const baseEnd = existingActive !== undefined && existingActive.period_end > nowIso
        ? existingActive.period_end
        : nowIso;
      const periodEnd = addMonths(baseEnd, definition.months);
      this.database.prepare(`
        INSERT INTO user_memberships (
          user_id, owner_id, plan, token_quota, period_start, period_end, status, granted_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          plan = excluded.plan,
          token_quota = excluded.token_quota,
          period_start = excluded.period_start,
          period_end = excluded.period_end,
          status = 'active',
          granted_by_user_id = excluded.granted_by_user_id,
          updated_at = excluded.updated_at
      `).run(target.user_id, target.owner_id, plan, definition.tokenQuota, nowIso, periodEnd, actorUserId, nowIso, nowIso);
      const eventType = existingActive === undefined
        || (existingActive.plan === 'bronze' && plan !== 'bronze') ? 'grant' : 'renew';
      this.database.prepare(`
        INSERT INTO membership_transactions (
          transaction_id, user_id, owner_id, event_type, plan, amount_cash_micros,
          period_start, period_end, actor_user_id, note, created_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), target.user_id, target.owner_id, eventType, plan,
        amountCashMicros, nowIso, periodEnd, actorUserId, note, nowIso, idempotencyKey
      );
      // 书籍预算上限跟随会员等级（算力值配额换算真实 token）：升级后立即解封，
      // 避免"会员还有额度、书籍预算却提前卡死"的双重限制（2026-08-20 老板指令：不要乱限制用户）。
      const allowance = realTokenAllowance(definition.tokenQuota);
      this.database.prepare(`
        UPDATE budgets SET token_limit = ?,
          status = CASE WHEN spent_tokens + reserved_tokens >= ? THEN 'exhausted' ELSE 'active' END,
          updated_at = ?
        WHERE owner_id = ? AND status IN ('active', 'exhausted')
      `).run(allowance, allowance, nowIso, target.owner_id);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.statusForOwner(target.owner_id);
  }

  public revoke(actorUserId: string, targetUserId: string, idempotencyKeyValue?: string): void {
    const target = findAccountById(this.database, targetUserId);
    if (target === undefined) {
      throw new DomainError(errorCodes.validation, '目标账号不存在', {}, false, 404);
    }
    const nowIso = this.clock.now().toISOString();
    const idempotencyKey = membershipActionKey(idempotencyKeyValue);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (idempotencyKey !== null) {
        const replay = this.database.prepare(`
          SELECT user_id,event_type FROM membership_transactions
          WHERE actor_user_id=? AND idempotency_key=?
        `).get(actorUserId, idempotencyKey) as { user_id: string; event_type: string } | undefined;
        if (replay !== undefined) {
          if (replay.user_id !== target.user_id || replay.event_type !== 'revoke') {
            throw new DomainError(errorCodes.validation, '本次会员办理编号已经用于另一项操作', {}, false, 409);
          }
          this.database.exec('COMMIT');
          return;
        }
      }
      const existing = this.database.prepare(`
        SELECT plan, period_start, period_end FROM user_memberships WHERE user_id = ? AND status = 'active'
      `).get(target.user_id) as { plan: MembershipPlan; period_start: string; period_end: string } | undefined;
      const result = this.database.prepare(`
        UPDATE user_memberships SET status = 'revoked', updated_at = ?
        WHERE user_id = ? AND status = 'active'
      `).run(nowIso, target.user_id);
      if (result.changes !== 1 || existing === undefined) {
        throw new DomainError(errorCodes.validation, '该账号当前没有生效的会员', {}, false, 409);
      }
      this.database.prepare(`
        INSERT INTO membership_transactions (
          transaction_id, user_id, owner_id, event_type, plan, amount_cash_micros,
          period_start, period_end, actor_user_id, note, created_at, idempotency_key
        ) VALUES (?, ?, ?, 'revoke', ?, 0, ?, ?, ?, '', ?, ?)
      `).run(randomUUID(), target.user_id, target.owner_id, existing.plan, existing.period_start, existing.period_end,
        actorUserId, nowIso, idempotencyKey);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public listUsersWithMembership(input: { query?: string; status?: string; offset?: number; limit?: number } = {}): { items: AdminMembershipUser[]; total: number } {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (input.query?.trim()) {
      clauses.push("(a.email_normalized LIKE ? ESCAPE '\\' OR a.display_name LIKE ? ESCAPE '\\')");
      const like = `%${input.query.trim().toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      values.push(like, like);
    }
    if (input.status === 'active' || input.status === 'suspended') {
      clauses.push('a.status = ?');
      values.push(input.status);
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS total FROM user_accounts a ${where}`).get(...values) as { total: number }).total);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const usageRelation = accountUsageRelation(this.database);
    const rows = this.database.prepare(`
      SELECT a.user_id, a.owner_id, a.display_name, a.email_normalized, a.role, a.status AS account_status,
        m.plan, m.token_quota, m.period_start, m.period_end, m.status AS membership_status,
        (SELECT COALESCE(SUM(u.consumed_tokens), 0) FROM ${usageRelation} u
          WHERE u.owner_id = a.owner_id AND u.usage_state = 'consumed'
            AND m.user_id IS NOT NULL AND u.recorded_at >= m.period_start) AS period_tokens,
        (SELECT COALESCE(SUM(u.consumed_tokens), 0) FROM ${usageRelation} u
          WHERE u.owner_id = a.owner_id AND u.usage_state = 'consumed') AS total_tokens
      FROM user_accounts a
      LEFT JOIN user_memberships m ON m.user_id = a.user_id
      ${where}
      ORDER BY a.created_at DESC, a.user_id LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as Array<{
      user_id: string; owner_id: string; display_name: string; email_normalized: string;
      role: 'admin' | 'user'; account_status: 'active' | 'suspended';
      plan: MembershipPlan | null; token_quota: number | null; period_start: string | null;
      period_end: string | null; membership_status: 'active' | 'revoked' | null;
      period_tokens: number | null; total_tokens: number;
    }>;
    const nowIso = this.clock.now().toISOString();
    return {
      items: rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email_normalized,
        role: row.role,
        accountStatus: row.account_status,
        membership: row.plan === null || row.membership_status === null ? null : {
          plan: row.plan,
          planLabel: MEMBERSHIP_PLAN_LABELS[row.plan],
          status: row.membership_status,
          tokenQuota: Number(row.token_quota ?? 0),
          periodTokens: Number(row.period_tokens ?? 0),
          totalTokens: Number(row.total_tokens),
          periodStart: row.period_start ?? '',
          periodEnd: row.period_end ?? '',
          expired: (row.period_end ?? '') <= nowIso
        },
        totalTokens: Number(row.total_tokens)
      })),
      total
    };
  }
}

function membershipActionKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/u.test(normalized)) {
    throw new DomainError(errorCodes.validation, '会员办理编号无效，请刷新页面后重试', {}, false, 400);
  }
  return normalized;
}
