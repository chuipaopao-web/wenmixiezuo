import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual
} from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError } from '../../domain/errors.js';
import type { AccountRole, AuthContext } from './auth-context.js';

const SESSION_COOKIE = 'wenmi_session';
const PASSWORD_BYTES = 64;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

interface AccountRow {
  user_id: string;
  owner_id: string;
  email_normalized: string;
  display_name: string;
  password_salt: string;
  password_hash: string;
  role: AccountRole;
  status: 'active' | 'suspended';
  created_at: string;
  last_login_at: string | null;
}

interface SessionRow extends AccountRow {
  session_id: string;
  expires_at: string;
  last_seen_at: string;
}

export interface PublicAccount {
  userId: string;
  email: string;
  displayName: string;
  role: AccountRole;
  status: 'active' | 'suspended';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface IssuedSession {
  account: PublicAccount;
  cookie: string;
  expiresInSeconds: number;
}

export class AccountAuthService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly secureCookies: boolean,
    private readonly legacyOwnerId: string,
    private readonly ttlSeconds = SESSION_TTL_SECONDS
  ) {}

  public async register(input: { email: string; password: string; displayName?: string }): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const displayName = normalizeDisplayName(input.displayName, email);
    const salt = randomBytes(16).toString('hex');
    const passwordHash = await derivePasswordHash(password, salt);
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
          role, status, created_at, updated_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(userId, ownerId, email, displayName, salt, passwordHash, role, now, now, now);
      this.recordAudit('register', userId, email, userId, now, {
        role,
        adoptedLegacyData: legacyOwner !== undefined
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.issueSession(this.requireAccountById(userId), now);
  }

  public async login(input: { email: string; password: string }): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const account = this.database.prepare('SELECT * FROM user_accounts WHERE email_normalized = ?').get(email) as AccountRow | undefined;
    const salt = account?.password_salt ?? '00000000000000000000000000000000';
    const supplied = await derivePasswordHash(password.slice(0, MAX_PASSWORD_LENGTH), salt);
    const valid = password.length <= MAX_PASSWORD_LENGTH
      && account !== undefined
      && constantTimeHexMatches(supplied, account.password_hash);
    const now = new Date().toISOString();
    if (!valid || account === undefined) {
      this.recordAudit('login_failed', account?.user_id ?? null, email, null, now, {});
      throw new DomainError('INVALID_CREDENTIALS', '邮箱或密码不正确', {}, false, 401);
    }
    if (account.status !== 'active') {
      throw new DomainError('ACCOUNT_SUSPENDED', '这个账号已暂停使用，请联系管理员', {}, false, 403);
    }
    this.database.prepare('UPDATE user_accounts SET last_login_at = ?, updated_at = ? WHERE user_id = ?').run(now, now, account.user_id);
    this.recordAudit('login_success', account.user_id, email, account.user_id, now, {});
    return this.issueSession({ ...account, last_login_at: now }, now);
  }

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
      sessionId: row.session_id
    };
  }

  public logout(context: AuthContext): string {
    const now = new Date().toISOString();
    this.database.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ? AND user_id = ?')
      .run(now, context.sessionId, context.userId);
    this.recordAudit('logout', context.userId, context.email, context.userId, now, {});
    return this.clearCookie();
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
    const usage = this.database.prepare(`
      SELECT COALESCE(SUM(l.input_tokens + l.output_tokens), 0) AS total
      FROM usage_ledger l
      INNER JOIN user_accounts a ON a.owner_id = l.owner_id
    `).get() as { total: number };
    return {
      totalUsers: Number(users.total),
      activeUsers: Number(users.active ?? 0),
      suspendedUsers: Number(users.suspended ?? 0),
      totalBooks: Number(books.total),
      totalTokens: Number(usage.total)
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

  private issueSession(account: AccountRow, nowIso: string): IssuedSession {
    const token = randomBytes(32).toString('base64url');
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
    eventType: 'register' | 'login_success' | 'login_failed' | 'logout' | 'user_suspended' | 'user_reactivated',
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

export function constantTimeTokenMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || actual.length === 0 || actual.length > 1_024) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeEmail(raw: string): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value.length < 3 || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    throw new DomainError('INVALID_EMAIL', '请输入有效的邮箱地址', {}, false, 400);
  }
  return value;
}

function validatePassword(raw: string): string {
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

function derivePasswordHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_BYTES, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
      if (error !== null) reject(error);
      else resolve(Buffer.from(derived).toString('hex'));
    });
  });
}

function constantTimeHexMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  const prefix = `${name}=`;
  const part = header.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return part === undefined ? null : part.slice(prefix.length);
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