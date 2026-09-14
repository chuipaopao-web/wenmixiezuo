/**
 * AUTH-TAKEOVER-01 身份域应用服务：产品唯一身份权威（SQLite存储）。
 * 域层（passwords/tokens）逐行复用rebuild域实现并以parity测试锁定；
 * 所有哈希（已知/未知账号验证、升级、改密）统一走域有界队列（并发上限2+等待上限16，
 * 超限503可重试），无第二条裸调scrypt路径（R2-4）。
 *
 * CAS与最终写入屏障（R2-1/R2-2，返工2）：
 * - login/changePassword 的全部异步哈希完成后，最终写入是一个同步BEGIN IMMEDIATE事务，
 *   事务内重新读取账号并核验 status='active' + credential_version + password_hash 三重条件，
 *   任一不符即回滚并有界重试/拒绝——第二次await期间发生的停用/改密不会被绕过；
 * - changePassword 最终事务内还重查发起会话（存在、同账号、未撤销、未过期），已退出/被撤销/
 *   过期的会话不能完成改密；
 * - 会话签发（INSERT）、审计、凭据/last_login写入全部在同一事务内，无中间可见状态。
 *
 * 凭据升级→credential_version+1；改密→credential_version+1并撤销其他会话；
 * 停用→撤销全部会话（状态屏障，不依赖版本）；恢复→旧会话已撤销不可复活，需重新登录。
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError } from '../domain/errors.js';
import { grantDefaultBronze } from '../infrastructure/security/membership-service.js';
import { accountUsageTotals } from '../infrastructure/security/account-usage-service.js';
import {
  hashVerifiedPassword, isSupportedPasswordRecord, shouldUpgradePassword, verifyPassword, verifyUnknownAccountPassword
} from './domain/passwords.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, issueRandomToken, hashToken, readCookie } from './domain/tokens.js';
import type { AccountRole, AccountStatus, AuthContext, IssuedSession, PasswordRecord, PublicAccount } from './domain/types.js';

const MAX_LOGIN_ATTEMPTS = 3;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

interface AccountRow {
  user_id: string;
  owner_id: string;
  email_normalized: string;
  display_name: string;
  password_salt: string;
  password_hash: string;
  password_format: string | null;
  password_n: number | null;
  password_r: number | null;
  password_p: number | null;
  credential_version: number;
  role: AccountRole;
  status: AccountStatus;
  created_at: string;
  last_login_at: string | null;
}

interface SessionRow extends AccountRow {
  session_id: string;
  expires_at: string;
  last_seen_at: string;
}

/** 行→域凭据记录；NULL格式列=历史v1参数，其余只接受精确支持组合，异常记录fail closed（不降级）。 */
function passwordRecordOf(row: AccountRow): PasswordRecord | null {
  const format = row.password_format === null ? 'scrypt-v1-legacy' : row.password_format;
  const n = row.password_format === null ? 16_384 : row.password_n;
  const r = row.password_format === null ? 8 : row.password_r;
  const p = row.password_format === null ? 1 : row.password_p;
  if (n === null || r === null || p === null) return null;
  const record: PasswordRecord = {
    format: format as PasswordRecord['format'],
    salt: row.password_salt,
    hash: row.password_hash,
    n, r, p,
    keyLength: 64
  };
  return isSupportedPasswordRecord(record) ? record : null;
}

function constantTimeHexMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** 最终事务内的账号状态守卫：active+凭据版本+哈希三重一致（R2-1）。 */
function guardAccountState(current: AccountRow | undefined, baseline: AccountRow): boolean {
  if (current === undefined) return false;
  return current.status === 'active'
    && current.credential_version === baseline.credential_version
    && current.password_hash === baseline.password_hash;
}

export class IdentityService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly secureCookies: boolean,
    private readonly legacyOwnerId: string,
    private readonly ttlSeconds = SESSION_TTL_SECONDS
  ) {}

  public async register(input: { email: string; password: string; displayName?: string }): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const password = validatePasswordPolicy(input.password);
    const displayName = normalizeDisplayName(input.displayName, email);
    const record = await hashVerifiedPassword(password);
    const now = new Date().toISOString();
    const userId = randomUUID();
    const generatedOwnerId = randomUUID();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.database.prepare('SELECT 1 FROM user_accounts WHERE email_normalized = ?').get(email);
      if (existing !== undefined) {
        throw new DomainError('EMAIL_ALREADY_REGISTERED', '这个邮箱已经注册，请直接登录', {}, false, 409);
      }
      const accountCount = Number((this.database.prepare('SELECT COUNT(*) AS total FROM user_accounts').get() as { total: number }).total);
      const role: AccountRole = accountCount === 0 ? 'admin' : 'user';
      const legacyOwner = accountCount === 0
        ? this.database.prepare(`
            SELECT o.owner_id
            FROM owners o
            WHERE o.owner_id = ?
              AND EXISTS (
                SELECT 1 FROM books b
                WHERE b.owner_id = o.owner_id AND b.status <> 'purged'
              )
              AND NOT EXISTS (
                SELECT 1 FROM user_accounts a WHERE a.owner_id = o.owner_id
              )
            LIMIT 1
          `).get(this.legacyOwnerId) as { owner_id: string } | undefined
        : undefined;
      const ownerId = legacyOwner?.owner_id ?? generatedOwnerId;
      if (legacyOwner === undefined) {
        this.database.prepare(`
          INSERT INTO owners (owner_id, display_name, version, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?)
        `).run(ownerId, displayName, now, now);
      } else {
        this.database.prepare('UPDATE owners SET display_name = ?, updated_at = ? WHERE owner_id = ?')
          .run(displayName, now, ownerId);
      }
      this.database.prepare(`
        INSERT INTO user_accounts (
          user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
          password_format, password_n, password_r, password_p, credential_version,
          role, status, created_at, updated_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?)
      `).run(userId, ownerId, email, displayName, record.salt, record.hash, record.format, record.n, record.r, record.p, role, now, now, now);
      if (role === 'user') grantDefaultBronze(this.database, userId, ownerId, now);
      this.recordAudit('register', userId, email, userId, now, { role, adoptedLegacyData: legacyOwner !== undefined });
      const issued = this.insertSession(this.requireAccountById(userId), now);
      this.database.exec('COMMIT');
      return issued;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 登录（CAS安全，R2-1返工2）：验证派生与（如需）升级哈希全部在事务外完成后，
   * 最终写入是一个同步事务：重读账号→三重校验（active+版本+哈希）→CAS写入→审计→签发会话。
   * 任何await窗口内发生的停用/改密都会在事务内被拦截。
   */
  public async login(input: { email: string; password: string }): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const now = new Date().toISOString();
    for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
      const row = this.findAccountByEmail(email);
      if (row === undefined) {
        // 未知账号按最贵支持参数（v2）经域有界队列派生一次：枚举计时不弱于已知v2账号路径。
        await verifyUnknownAccountPassword(password);
        this.recordAudit('login_failed', null, email, null, now, {});
        throw invalidCredentials();
      }
      const record = passwordRecordOf(row);
      if (record === null) {
        // fail closed：损坏/不受支持的凭据记录直接拒绝，不降级到任何默认参数。
        this.recordAudit('login_failed', row.user_id, email, null, now, { reason: 'credential_record_unsupported' });
        throw invalidCredentials();
      }
      // R2-4：已知账号验证走域verifyPassword（有界哈希队列），无裸scrypt路径。
      const matches = password.length <= MAX_PASSWORD_LENGTH && await verifyPassword(password, record);
      // 升级哈希（如需）同样在事务外完成，走域有界队列。
      const upgraded = matches && shouldUpgradePassword(record) ? await hashNewPasswordFrom(password) : null;

      // ── 最终同步事务：三重校验+CAS写入+审计+签发会话，原子完成 ──
      this.database.exec('BEGIN IMMEDIATE');
      let issued: IssuedSession | null = null;
      try {
        const current = this.findAccountByEmail(email);
        if (current === undefined || !guardAccountState(current, row)) {
          this.database.exec('ROLLBACK');
          if (current !== undefined && current.status !== 'active') {
            this.recordAudit('login_rejected', current.user_id, email, null, now, { reason: 'account_status' });
            throw new DomainError('ACCOUNT_SUSPENDED', '这个账号已暂停使用，请联系管理员', {}, false, 403);
          }
          continue; // 凭据并发变化或账号消失：按新状态有界重试
        }
        const active = current;
        if (!matches) {
          this.recordAudit('login_failed', row.user_id, email, null, now, {});
          this.database.exec('ROLLBACK');
          throw invalidCredentials();
        }
        if (upgraded !== null) {
          const changed = this.database.prepare(`
            UPDATE user_accounts
            SET password_salt = ?, password_hash = ?, password_format = ?, password_n = ?, password_r = ?, password_p = ?,
                credential_version = credential_version + 1, last_login_at = ?, updated_at = ?
            WHERE user_id = ? AND credential_version = ? AND password_hash = ?
          `).run(upgraded.salt, upgraded.hash, upgraded.format, upgraded.n, upgraded.r, upgraded.p, now, now, active.user_id, row.credential_version, row.password_hash);
          if (changed.changes !== 1) {
            this.database.exec('ROLLBACK');
            continue;
          }
        } else {
          const touched = this.database.prepare(
            'UPDATE user_accounts SET last_login_at = ?, updated_at = ? WHERE user_id = ? AND credential_version = ? AND password_hash = ?'
          ).run(now, now, active.user_id, row.credential_version, row.password_hash);
          if (touched.changes !== 1) {
            this.database.exec('ROLLBACK');
            continue;
          }
        }
        this.recordAudit('login_success', active.user_id, email, current.user_id, now, {});
        issued = this.insertSession({ ...active, last_login_at: now }, now);
        this.database.exec('COMMIT');
        return issued;
      } catch (error) {
        try { this.database.exec('ROLLBACK'); } catch { /* 已回滚 */ }
        throw error;
      }
    }
    throw new DomainError('LOGIN_STATE_CONFLICT', '登录时账号状态发生变化，请重试', {}, true, 409);
  }

  /** 会话验证：cookie→token哈希→未撤销会话→active账号→未过期；last_seen节流更新。 */
  public authenticate(cookieHeader: string | undefined, now = new Date()): AuthContext | null {
    const token = readCookie(cookieHeader, SESSION_COOKIE);
    if (token === null || token.length > 512) return null;
    const row = this.database.prepare(`
      SELECT s.session_id, s.expires_at, s.last_seen_at, a.*
      FROM auth_sessions s
      JOIN user_accounts a ON a.user_id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL
    `).get(hashToken(token)) as SessionRow | undefined;
    if (row === undefined || row.status !== 'active' || Date.parse(row.expires_at) <= now.getTime()) return null;
    if (now.getTime() - Date.parse(row.last_seen_at) >= 5 * 60 * 1_000) {
      this.database.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE session_id = ?').run(now.toISOString(), row.session_id);
    }
    return {
      userId: row.user_id,
      ownerId: row.owner_id,
      email: row.email_normalized,
      displayName: row.display_name,
      role: row.role,
      sessionId: row.session_id,
      credentialVersion: row.credential_version
    };
  }

  public logout(context: AuthContext): string {
    const now = new Date().toISOString();
    this.database.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ? AND user_id = ?')
      .run(now, context.sessionId, context.userId);
    this.recordAudit('logout', context.userId, context.email, context.userId, now, {});
    return this.clearCookie();
  }

  /**
   * 改密（R2-2返工2）：当前密码验证与新密码哈希全部在事务外完成后，
   * 最终同步事务内核查：账号三重校验 + 发起会话有效性（存在/同账号/未撤销/未过期），
   * 通过才CAS写新凭据（版本+1）并撤销其他会话——已退出/被撤销的会话不能完成改密。
   */
  public async changePassword(input: { context: AuthContext; currentPassword: string; nextPassword: string }): Promise<{ changed: true; revokedSessions: number }> {
    const nextPasswordValid = validatePasswordPolicy(input.nextPassword);
    const now = new Date().toISOString();
    for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
      const row = this.requireAccountById(input.context.userId);
      const record = passwordRecordOf(row);
      if (record === null) {
        this.recordAudit('password_change_failed', row.user_id, row.email_normalized, input.context.userId, now, { reason: 'credential_record_unsupported' });
        throw invalidCredentials();
      }
      // R2-4：当前密码验证与新密码派生均走域有界队列。
      const matches = await verifyPassword(input.currentPassword, record);
      const next = await hashNewPasswordFrom(nextPasswordValid);

      // ── 最终同步事务：账号三重校验+发起会话核查+CAS写入+撤销+审计，原子完成 ──
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const current = this.requireAccountById(input.context.userId);
        if (!guardAccountState(current, row)) {
          this.database.exec('ROLLBACK');
          if (current.status !== 'active') {
            throw new DomainError('ACCOUNT_SUSPENDED', '这个账号已暂停使用', {}, false, 403);
          }
          continue;
        }
        if (!matches) {
          this.recordAudit('password_change_failed', current.user_id, current.email_normalized, input.context.userId, now, {});
          this.database.exec('ROLLBACK');
          throw invalidCredentials();
        }
        // R2-2：发起会话必须在写入时刻仍然有效（存在、同账号、未撤销、未过期）。
        const session = this.database.prepare(
          'SELECT expires_at FROM auth_sessions WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL'
        ).get(input.context.sessionId, current.user_id) as { expires_at: string } | undefined;
        if (session === undefined || Date.parse(session.expires_at) <= Date.now()) {
          this.database.exec('ROLLBACK');
          throw new DomainError('AUTHENTICATION_REQUIRED', '登录状态已失效，请重新登录后再修改密码', {}, false, 401);
        }
        const updated = this.database.prepare(`
          UPDATE user_accounts
          SET password_salt = ?, password_hash = ?, password_format = ?, password_n = ?, password_r = ?, password_p = ?,
              credential_version = credential_version + 1, updated_at = ?
          WHERE user_id = ? AND credential_version = ? AND password_hash = ?
        `).run(next.salt, next.hash, next.format, next.n, next.r, next.p, now, current.user_id, row.credential_version, row.password_hash);
        if (updated.changes !== 1) {
          this.database.exec('ROLLBACK');
          continue;
        }
        const revoke = this.database.prepare(
          'UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND session_id <> ?'
        ).run(now, current.user_id, input.context.sessionId);
        const revoked = Number(revoke.changes);
        this.recordAudit('password_changed', current.user_id, current.email_normalized, input.context.userId, now, { revokedSessions: revoked });
        this.database.exec('COMMIT');
        return { changed: true, revokedSessions: revoked };
      } catch (error) {
        try { this.database.exec('ROLLBACK'); } catch { /* 已回滚 */ }
        throw error;
      }
    }
    throw new DomainError('LOGIN_STATE_CONFLICT', '账号状态发生变化，请重试', {}, true, 409);
  }

  /** 撤销除当前外的全部会话（“退出其他设备”）；当前会话也须仍有效。 */
  public revokeOtherSessions(context: AuthContext): { revoked: number } {
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const session = this.database.prepare(
        'SELECT expires_at FROM auth_sessions WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL'
      ).get(context.sessionId, context.userId) as { expires_at: string } | undefined;
      if (session === undefined || Date.parse(session.expires_at) <= Date.now()) {
        this.database.exec('ROLLBACK');
        throw new DomainError('AUTHENTICATION_REQUIRED', '登录状态已失效，请重新登录', {}, false, 401);
      }
      const revoke = this.database.prepare(
        'UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND session_id <> ?'
      ).run(now, context.userId, context.sessionId);
      const revoked = Number(revoke.changes);
      this.recordAudit('sessions_revoked', context.userId, context.email, context.userId, now, { revoked });
      this.database.exec('COMMIT');
      return { revoked };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public overview(): { totalUsers: number; activeUsers: number; suspendedUsers: number; totalBooks: number; totalTokens: number } {
    const users = this.database.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
      FROM user_accounts
    `).get() as { total: number; active: number | null; suspended: number | null };
    const books = this.database.prepare(`
      SELECT COUNT(*) AS total
      FROM books b
      INNER JOIN user_accounts a ON a.owner_id = b.owner_id
      WHERE b.status <> 'purged'
    `).get() as { total: number };
    const usage = accountUsageTotals(this.database);
    return {
      totalUsers: Number(users.total),
      activeUsers: Number(users.active ?? 0),
      suspendedUsers: Number(users.suspended ?? 0),
      totalBooks: Number(books.total),
      totalTokens: usage.consumedTokens
    };
  }

  public listUsers(input: { query?: string; status?: string; offset?: number; limit?: number }): { items: PublicAccount[]; total: number } {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (input.query?.trim()) {
      clauses.push("(email_normalized LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')");
      const like = `%${input.query.trim().toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      values.push(like, like);
    }
    if (input.status === 'active' || input.status === 'suspended') {
      clauses.push('status = ?');
      values.push(input.status);
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS total FROM user_accounts ${where}`).get(...values) as { total: number }).total);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const rows = this.database.prepare(
      `SELECT * FROM user_accounts ${where} ORDER BY created_at DESC, user_id LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as unknown as AccountRow[];
    return { items: rows.map(publicAccount), total };
  }

  public setUserStatus(actor: AuthContext, userId: string, status: 'active' | 'suspended'): PublicAccount {
    if (actor.userId === userId && status === 'suspended') {
      throw new DomainError('CANNOT_SUSPEND_SELF', '不能暂停当前正在使用的管理员账号', {}, false, 409);
    }
    const target = this.requireAccountById(userId);
    if (target.role === 'admin' && status === 'suspended') {
      const activeAdmins = Number((this.database.prepare("SELECT COUNT(*) AS total FROM user_accounts WHERE role = 'admin' AND status = 'active'").get() as { total: number }).total);
      if (activeAdmins <= 1) {
        throw new DomainError('LAST_ADMIN_REQUIRED', '至少要保留一个可用的管理员账号', {}, false, 409);
      }
    }
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('UPDATE user_accounts SET status = ?, updated_at = ? WHERE user_id = ?').run(status, now, userId);
      if (status === 'suspended') {
        this.database.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, userId);
      }
      this.recordAudit(status === 'suspended' ? 'user_suspended' : 'user_reactivated', userId, target.email_normalized, actor.userId, now, {});
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return publicAccount({ ...target, status });
  }

  private findAccountByEmail(email: string): AccountRow | undefined {
    return this.database.prepare('SELECT * FROM user_accounts WHERE email_normalized = ?').get(email) as AccountRow | undefined;
  }

  /** 事务内签发会话（INSERT，无独立可见窗口）。 */
  private insertSession(account: AccountRow, nowIso: string): IssuedSession {
    const token = issueRandomToken();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.parse(nowIso) + this.ttlSeconds * 1_000).toISOString();
    this.database.prepare(`
      INSERT INTO auth_sessions (session_id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(sessionId, account.user_id, hashToken(token), nowIso, expiresAt, nowIso);
    return {
      account: publicAccount(account),
      cookie: `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${this.ttlSeconds}${this.secureCookies ? '; Secure' : ''}`,
      expiresInSeconds: this.ttlSeconds
    };
  }

  private clearCookie(): string {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${this.secureCookies ? '; Secure' : ''}`;
  }

  private requireAccountById(userId: string): AccountRow {
    const row = this.database.prepare('SELECT * FROM user_accounts WHERE user_id = ?').get(userId) as AccountRow | undefined;
    if (row === undefined) throw new DomainError('ACCOUNT_NOT_FOUND', '账号不存在', {}, false, 404);
    return row;
  }

  private recordAudit(
    eventType: 'register' | 'login_success' | 'login_failed' | 'login_rejected' | 'logout' | 'user_suspended' | 'user_reactivated' | 'password_changed' | 'password_change_failed' | 'sessions_revoked',
    userId: string | null,
    email: string | null,
    actorUserId: string | null,
    now: string,
    details: Record<string, unknown>
  ): void {
    this.database.prepare(`
      INSERT INTO auth_audit_events (audit_id, user_id, event_type, email_normalized, actor_user_id, recorded_at, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), userId, eventType, email, actorUserId, now, JSON.stringify(details));
  }
}

function invalidCredentials(): DomainError {
  return new DomainError('INVALID_CREDENTIALS', '邮箱或密码不正确', {}, false, 401);
}

/** 升级/改密的新凭据派生：走域有界队列（密码策略已在入口校验）。 */
async function hashNewPasswordFrom(password: string): Promise<PasswordRecord> {
  return hashVerifiedPassword(password);
}

function normalizeEmail(raw: string): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value.length < 3 || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    throw new DomainError('INVALID_EMAIL', '请输入有效的邮箱地址', {}, false, 400);
  }
  return value;
}

function validatePasswordPolicy(raw: string): string {
  if (typeof raw !== 'string' || raw.length < MIN_PASSWORD_LENGTH || raw.length > MAX_PASSWORD_LENGTH) {
    throw new DomainError('INVALID_PASSWORD', `密码需要${MIN_PASSWORD_LENGTH}至${MAX_PASSWORD_LENGTH}个字符`, {}, false, 400);
  }
  return raw;
}

function normalizeDisplayName(raw: string | undefined, email: string): string {
  const value = raw?.trim() || email.split('@', 1)[0] || '作者';
  if (value.length < 1 || value.length > 30) {
    throw new DomainError('INVALID_DISPLAY_NAME', '昵称需要1至30个字符', {}, false, 400);
  }
  return value;
}

function publicAccount(row: AccountRow): PublicAccount {
  return {
    userId: row.user_id,
    email: row.email_normalized,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
}
