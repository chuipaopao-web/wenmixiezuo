import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock } from '../../domain/ids.js';

/** 会员套餐：周期（自然月数）与算力值（token）配额。 */
export const MEMBERSHIP_PLANS = {
  monthly: { months: 1, tokenQuota: 300_000_000 },
  quarterly: { months: 3, tokenQuota: 1_000_000_000 },
  yearly: { months: 12, tokenQuota: 10_000_000_000 }
} as const;

export type MembershipPlan = keyof typeof MEMBERSHIP_PLANS;

export const MEMBERSHIP_PLAN_LABELS: Record<MembershipPlan, string> = {
  monthly: '包月会员',
  quarterly: '包季会员',
  yearly: '包年会员'
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
    status: 'active' | 'revoked';
    tokenQuota: number;
    tokensConsumed: number;
    tokensRemaining: number;
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

function activeMembershipByOwner(database: DatabaseSync, ownerId: string, nowIso: string): MembershipRow | undefined {
  const row = database.prepare(
    "SELECT * FROM user_memberships WHERE owner_id = ? AND status = 'active'"
  ).get(ownerId) as MembershipRow | undefined;
  if (row === undefined) return undefined;
  return row.period_end > nowIso ? row : undefined;
}

function tokensConsumedSince(database: DatabaseSync, ownerId: string, sinceIso: string): number {
  const row = database.prepare(`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
    FROM usage_ledger WHERE owner_id = ? AND recorded_at >= ?
  `).get(ownerId, sinceIso) as { tokens: number };
  return Number(row.tokens);
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
  nowIso: string
): null | 'membership-required' | 'quota-exhausted' {
  const account = findAccountByOwner(database, ownerId);
  if (account === undefined) return null;
  if (account.role === 'admin') return null;
  const membership = activeMembershipByOwner(database, ownerId, nowIso);
  if (membership === undefined) return 'membership-required';
  const consumed = tokensConsumedSince(database, ownerId, membership.period_start);
  return consumed >= membership.token_quota ? 'quota-exhausted' : null;
}

/**
 * 生成门禁：账号体系内的非管理员用户必须持有生效会员且周期内算力值未耗尽。
 * 未关联账号的所有者（本机遗留工作区、测试合成所有者）不受门禁限制。
 */
export function assertMembershipAllowsGeneration(database: DatabaseSync, ownerId: string, nowIso: string): void {
  const reason = membershipGenerationBlockReason(database, ownerId, nowIso);
  if (reason === 'membership-required') {
    throw new DomainError(errorCodes.membershipRequired,
      '召集AI团队需使用算力，请联系管理员微信595341366开通会员。', { ...MEMBERSHIP_CONTACT }, false, 403);
  }
  if (reason === 'quota-exhausted') {
    throw new DomainError(errorCodes.membershipQuotaExhausted,
      '召集AI团队需使用算力，会员算力值已用完，请联系管理员微信595341366续费。', { ...MEMBERSHIP_CONTACT }, false, 403);
  }
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
    const consumed = tokensConsumedSince(this.database, ownerId, row.period_start);
    const expired = row.period_end <= nowIso;
    return {
      isAdmin: false,
      membership: {
        plan: row.plan,
        planLabel: MEMBERSHIP_PLAN_LABELS[row.plan],
        status: row.status,
        tokenQuota: Number(row.token_quota),
        tokensConsumed: consumed,
        tokensRemaining: Math.max(0, Number(row.token_quota) - consumed),
        periodStart: row.period_start,
        periodEnd: row.period_end,
        expired
      }
    };
  }

  public grant(actorUserId: string, targetUserId: string, plan: MembershipPlan): MembershipStatus {
    if (!isMembershipPlan(plan)) {
      throw new DomainError(errorCodes.validation, '请选择包月、包季或包年套餐', {}, false, 400);
    }
    const target = findAccountById(this.database, targetUserId);
    if (target === undefined) {
      throw new DomainError(errorCodes.validation, '目标账号不存在', {}, false, 404);
    }
    const definition = MEMBERSHIP_PLANS[plan];
    const nowIso = this.clock.now().toISOString();
    // 续费顺延：已有生效会员的剩余天数保留，新周期从今天开始重新计量算力（配额按新套餐刷新），
    // 到期日从"剩余到期日或今天"往后加套餐月数，避免提前续费白白丢掉剩余时间。
    const existingActive = this.database.prepare(
      "SELECT period_end FROM user_memberships WHERE user_id = ? AND status = 'active'"
    ).get(target.user_id) as { period_end: string } | undefined;
    const baseEnd = existingActive !== undefined && existingActive.period_end > nowIso
      ? existingActive.period_end
      : nowIso;
    const periodEnd = addMonths(baseEnd, definition.months);
    this.database.exec('BEGIN IMMEDIATE');
    try {
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
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.statusForOwner(target.owner_id);
  }

  public revoke(actorUserId: string, targetUserId: string): void {
    const target = findAccountById(this.database, targetUserId);
    if (target === undefined) {
      throw new DomainError(errorCodes.validation, '目标账号不存在', {}, false, 404);
    }
    const nowIso = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE user_memberships SET status = 'revoked', updated_at = ?
      WHERE user_id = ? AND status = 'active'
    `).run(nowIso, target.user_id);
    if (result.changes !== 1) {
      throw new DomainError(errorCodes.validation, '该账号当前没有生效的会员', {}, false, 409);
    }
  }

  public listUsersWithMembership(input: { query?: string; status?: string; offset?: number; limit?: number } = {}): { items: AdminMembershipUser[]; total: number } {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (input.query?.trim()) {
      clauses.push('(a.email_normalized LIKE ? OR a.display_name LIKE ?)');
      const like = `%${input.query.trim().toLowerCase()}%`;
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
    const rows = this.database.prepare(`
      SELECT a.user_id, a.owner_id, a.display_name, a.email_normalized, a.role, a.status AS account_status,
        m.plan, m.token_quota, m.period_start, m.period_end, m.status AS membership_status,
        (SELECT COALESCE(SUM(l.input_tokens + l.output_tokens), 0) FROM usage_ledger l
          WHERE l.owner_id = a.owner_id AND m.user_id IS NOT NULL AND l.recorded_at >= m.period_start) AS period_tokens,
        (SELECT COALESCE(SUM(l.input_tokens + l.output_tokens), 0) FROM usage_ledger l
          WHERE l.owner_id = a.owner_id) AS total_tokens
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
