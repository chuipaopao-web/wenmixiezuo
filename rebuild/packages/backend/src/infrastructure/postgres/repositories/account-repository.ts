import { withTransaction, type PgClient, type PgPool } from "../client.js";
import type { AccountRecord, AccountRole, AccountStatus, OneTimeTokenPurpose, PasswordRecord } from "../../../domain/accounts/index.js";

export interface AccountInsert {
  readonly userId: string;
  readonly ownerId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly emailVerifiedAt: Date | null;
  readonly password: PasswordRecord;
}

export interface TokenRow {
  readonly tokenId: string;
  readonly userId: string;
  readonly purpose: OneTimeTokenPurpose;
  readonly tokenHash: string;
  readonly credentialVersion: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly supersededAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface SessionAccountRow {
  readonly sessionId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly sessionCredentialVersion: number;
  readonly account: AccountRecord;
}

type AccountRow = {
  user_id: string;
  owner_id: string;
  email_normalized: string;
  display_name: string;
  role: AccountRole;
  status: AccountStatus;
  email_verified_at: Date | string | null;
  password_format: PasswordRecord["format"];
  password_salt: string;
  password_hash: string;
  password_n: number;
  password_r: number;
  password_p: number;
  password_key_length: 64;
  credential_version: number;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
};

export class PostgresAccountRepository {
  public constructor(private readonly pool: PgPool) {}

  public async withTransaction<T>(work: (client: PgClient) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, work);
  }

  public async findByEmail(client: PgClient, email: string, lock = false): Promise<AccountRecord | null> {
    const result = await client.query<AccountRow>(
      `SELECT ${accountColumns()} FROM account_users WHERE email_normalized = $1${lock ? " FOR UPDATE" : ""}`,
      [email]
    );
    return result.rows[0] === undefined ? null : mapAccount(result.rows[0]);
  }

  public async findByUserId(client: PgClient, userId: string, lock = false): Promise<AccountRecord | null> {
    const result = await client.query<AccountRow>(
      `SELECT ${accountColumns()} FROM account_users WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`,
      [userId]
    );
    return result.rows[0] === undefined ? null : mapAccount(result.rows[0]);
  }

  public async insertAccount(client: PgClient, input: AccountInsert): Promise<AccountRecord> {
    const result = await client.query<AccountRow>(
      `INSERT INTO account_users (
         user_id, owner_id, email_normalized, display_name, role, status, email_verified_at,
         password_format, password_salt, password_hash, password_n, password_r, password_p, password_key_length
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${accountColumns()}`,
      [
        input.userId,
        input.ownerId,
        input.email,
        input.displayName,
        input.role,
        input.status,
        input.emailVerifiedAt,
        input.password.format,
        input.password.salt,
        input.password.hash,
        input.password.n,
        input.password.r,
        input.password.p,
        input.password.keyLength
      ]
    );
    return mapAccount(result.rows[0]!);
  }

  public async verifyEmail(client: PgClient, userId: string): Promise<AccountRecord> {
    const result = await client.query<AccountRow>(
      `UPDATE account_users
       SET email_verified_at = COALESCE(email_verified_at, clock_timestamp()), updated_at = clock_timestamp()
       WHERE user_id = $1
       RETURNING ${accountColumns()}`,
      [userId]
    );
    return mapAccount(result.rows[0]!);
  }

  public async replacePassword(client: PgClient, userId: string, password: PasswordRecord): Promise<AccountRecord> {
    const result = await client.query<AccountRow>(
      `UPDATE account_users
       SET password_format = $2, password_salt = $3, password_hash = $4, password_n = $5,
           password_r = $6, password_p = $7, password_key_length = $8,
           credential_version = credential_version + 1, updated_at = clock_timestamp()
       WHERE user_id = $1
       RETURNING ${accountColumns()}`,
      [userId, password.format, password.salt, password.hash, password.n, password.r, password.p, password.keyLength]
    );
    return mapAccount(result.rows[0]!);
  }

  public async upgradePasswordWithoutVersionChange(client: PgClient, userId: string, password: PasswordRecord): Promise<AccountRecord> {
    const result = await client.query<AccountRow>(
      `UPDATE account_users
       SET password_format = $2, password_salt = $3, password_hash = $4, password_n = $5,
           password_r = $6, password_p = $7, password_key_length = $8, updated_at = clock_timestamp()
       WHERE user_id = $1
       RETURNING ${accountColumns()}`,
      [userId, password.format, password.salt, password.hash, password.n, password.r, password.p, password.keyLength]
    );
    return mapAccount(result.rows[0]!);
  }

  public async insertSession(
    client: PgClient,
    input: { readonly sessionId: string; readonly userId: string; readonly tokenHash: string; readonly credentialVersion: number; readonly expiresAt: Date }
  ): Promise<void> {
    await client.query(
      `INSERT INTO account_sessions (session_id, user_id, token_hash, credential_version, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.sessionId, input.userId, input.tokenHash, input.credentialVersion, input.expiresAt]
    );
  }

  public async findSessionByTokenHash(client: PgClient, tokenHash: string, lock = false): Promise<SessionAccountRow | null> {
    const result = await client.query<AccountRow & {
      session_id: string;
      expires_at: Date | string;
      revoked_at: Date | string | null;
      session_credential_version: number;
    }>(
      `SELECT s.session_id, s.expires_at, s.revoked_at, s.credential_version AS session_credential_version,
              ${accountColumns("a")}
       FROM account_sessions s
       JOIN account_users a ON a.user_id = s.user_id
       WHERE s.token_hash = $1${lock ? " FOR UPDATE OF s" : ""}`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      sessionId: row.session_id,
      expiresAt: toDate(row.expires_at),
      revokedAt: row.revoked_at === null ? null : toDate(row.revoked_at),
      sessionCredentialVersion: Number(row.session_credential_version),
      account: mapAccount(row)
    };
  }

  public async touchSession(client: PgClient, sessionId: string): Promise<void> {
    await client.query("UPDATE account_sessions SET last_seen_at = clock_timestamp() WHERE session_id = $1", [sessionId]);
  }

  public async revokeSession(client: PgClient, sessionId: string, userId: string, reason: string): Promise<number> {
    const result = await client.query(
      `UPDATE account_sessions
       SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoked_reason = $3
       WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId, reason]
    );
    return result.rowCount ?? 0;
  }

  public async revokeUserSessions(client: PgClient, userId: string, exceptSessionId: string | null, reason: string): Promise<number> {
    const result = await client.query(
      `UPDATE account_sessions
       SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoked_reason = $3
       WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR session_id <> $2::uuid)`,
      [userId, exceptSessionId, reason]
    );
    return result.rowCount ?? 0;
  }

  public async supersedeTokens(client: PgClient, userId: string, purpose: OneTimeTokenPurpose): Promise<void> {
    await client.query(
      `UPDATE account_one_time_tokens
       SET superseded_at = clock_timestamp()
       WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND superseded_at IS NULL AND revoked_at IS NULL`,
      [userId, purpose]
    );
  }

  public async insertOneTimeToken(
    client: PgClient,
    input: {
      readonly tokenId: string;
      readonly userId: string;
      readonly purpose: OneTimeTokenPurpose;
      readonly tokenHash: string;
      readonly credentialVersion: number;
      readonly expiresAt: Date;
    }
  ): Promise<TokenRow> {
    const result = await client.query<TokenDbRow>(
      `INSERT INTO account_one_time_tokens (token_id, user_id, purpose, token_hash, credential_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${tokenColumns()}`,
      [input.tokenId, input.userId, input.purpose, input.tokenHash, input.credentialVersion, input.expiresAt]
    );
    return mapToken(result.rows[0]!);
  }

  public async findOneTimeTokenForUpdate(client: PgClient, tokenHash: string): Promise<TokenRow | null> {
    const result = await client.query<TokenDbRow>(
      `SELECT ${tokenColumns()} FROM account_one_time_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash]
    );
    return result.rows[0] === undefined ? null : mapToken(result.rows[0]);
  }

  public async findOneTimeToken(client: PgClient, tokenHash: string): Promise<TokenRow | null> {
    const result = await client.query<TokenDbRow>(
      `SELECT ${tokenColumns()} FROM account_one_time_tokens WHERE token_hash = $1`,
      [tokenHash]
    );
    return result.rows[0] === undefined ? null : mapToken(result.rows[0]);
  }

  public async consumeOneTimeToken(client: PgClient, tokenId: string): Promise<void> {
    await client.query("UPDATE account_one_time_tokens SET consumed_at = clock_timestamp() WHERE token_id = $1", [tokenId]);
  }

  public async revokeUserTokens(client: PgClient, userId: string, purpose: OneTimeTokenPurpose | null): Promise<number> {
    const result = await client.query(
      `UPDATE account_one_time_tokens
       SET revoked_at = COALESCE(revoked_at, clock_timestamp())
       WHERE user_id = $1
         AND ($2::text IS NULL OR purpose = $2)
         AND consumed_at IS NULL
         AND superseded_at IS NULL
         AND revoked_at IS NULL`,
      [userId, purpose]
    );
    return result.rowCount ?? 0;
  }

  public async recordAudit(
    client: PgClient,
    input: {
      readonly auditId: string;
      readonly userId: string | null;
      readonly actorUserId: string | null;
      readonly eventType: string;
      readonly result: "succeeded" | "failed" | "rejected";
      readonly email: string | null;
      readonly detail?: Record<string, unknown>;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO account_security_audit_events
         (audit_id, user_id, actor_user_id, event_type, result, email_normalized, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.auditId, input.userId, input.actorUserId, input.eventType, input.result, input.email, input.detail ?? {}]
    );
  }

  public async databaseTime(client: PgClient): Promise<Date> {
    const result = await client.query<{ now: Date | string }>("SELECT clock_timestamp() AS now");
    return toDate(result.rows[0]!.now);
  }

  public async checkRateLimit(
    client: PgClient,
    input: {
      readonly scopeKind: "email" | "ip" | "session";
      readonly scopeHash: string;
      readonly action: string;
      readonly limit: number;
      readonly windowMs: number;
      readonly blockMs: number;
    }
  ): Promise<{ readonly allowed: boolean; readonly blockedUntil: Date | null }> {
    await client.query(
      "DELETE FROM account_rate_limits WHERE window_started_at < clock_timestamp() - interval '2 days' AND (blocked_until IS NULL OR blocked_until < clock_timestamp())"
    );
    const inserted = await client.query(
      `INSERT INTO account_rate_limits (scope_kind, scope_hash, action, window_started_at, attempts, blocked_until)
       VALUES ($1, $2, $3, clock_timestamp(), 1, NULL)
       ON CONFLICT (scope_kind, scope_hash, action) DO NOTHING
       RETURNING attempts`,
      [input.scopeKind, input.scopeHash, input.action]
    );
    if (inserted.rowCount === 1) return { allowed: true, blockedUntil: null };
    const row = (await client.query<{
      window_started_at: Date | string;
      attempts: number;
      blocked_until: Date | string | null;
      now: Date | string;
    }>(
      `SELECT window_started_at, attempts, blocked_until, clock_timestamp() AS now
       FROM account_rate_limits
       WHERE scope_kind = $1 AND scope_hash = $2 AND action = $3
       FOR UPDATE`,
      [input.scopeKind, input.scopeHash, input.action]
    )).rows[0];
    if (row === undefined) return { allowed: true, blockedUntil: null };
    const now = toDate(row.now);
    if (row !== undefined && row.blocked_until !== null && toDate(row.blocked_until).getTime() > now.getTime()) {
      return { allowed: false, blockedUntil: toDate(row.blocked_until) };
    }
    if (now.getTime() - toDate(row.window_started_at).getTime() >= input.windowMs) {
      await client.query(
        `UPDATE account_rate_limits
         SET window_started_at = clock_timestamp(), attempts = 1, blocked_until = NULL
         WHERE scope_kind = $1 AND scope_hash = $2 AND action = $3`,
        [input.scopeKind, input.scopeHash, input.action]
      );
      return { allowed: true, blockedUntil: null };
    }
    const attempts = Number(row.attempts) + 1;
    const updated = await client.query<{ blocked_until: Date | string | null }>(
      `UPDATE account_rate_limits
       SET attempts = $4::integer,
           blocked_until = CASE WHEN $4::integer > $5::integer THEN clock_timestamp() + ($6::double precision * interval '1 millisecond') ELSE NULL END
       WHERE scope_kind = $1 AND scope_hash = $2 AND action = $3
       RETURNING blocked_until`,
      [input.scopeKind, input.scopeHash, input.action, attempts, input.limit, input.blockMs]
    );
    const blockedUntil = updated.rows[0]?.blocked_until ?? null;
    return { allowed: attempts <= input.limit, blockedUntil: blockedUntil === null ? null : toDate(blockedUntil) };
  }
}

type TokenDbRow = {
  token_id: string;
  user_id: string;
  purpose: OneTimeTokenPurpose;
  token_hash: string;
  credential_version: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  superseded_at: Date | string | null;
  revoked_at: Date | string | null;
};

function accountColumns(alias?: string): string {
  const prefix = alias === undefined ? "" : `${alias}.`;
  return `${prefix}user_id, ${prefix}owner_id, ${prefix}email_normalized, ${prefix}display_name,
    ${prefix}role, ${prefix}status, ${prefix}email_verified_at, ${prefix}password_format,
    ${prefix}password_salt, ${prefix}password_hash, ${prefix}password_n, ${prefix}password_r,
    ${prefix}password_p, ${prefix}password_key_length, ${prefix}credential_version,
    ${prefix}created_at, ${prefix}updated_at, ${prefix}last_login_at`;
}

function tokenColumns(): string {
  return "token_id, user_id, purpose, token_hash, credential_version, expires_at, consumed_at, superseded_at, revoked_at";
}

function mapAccount(row: AccountRow): AccountRecord {
  return {
    userId: row.user_id,
    ownerId: row.owner_id,
    email: row.email_normalized,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    emailVerifiedAt: row.email_verified_at === null ? null : toDate(row.email_verified_at),
    password: {
      format: row.password_format,
      salt: row.password_salt,
      hash: row.password_hash,
      n: Number(row.password_n),
      r: Number(row.password_r),
      p: Number(row.password_p),
      keyLength: 64
    },
    credentialVersion: Number(row.credential_version),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    lastLoginAt: row.last_login_at === null ? null : toDate(row.last_login_at)
  };
}

function mapToken(row: TokenDbRow): TokenRow {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    purpose: row.purpose,
    tokenHash: row.token_hash,
    credentialVersion: Number(row.credential_version),
    expiresAt: toDate(row.expires_at),
    consumedAt: row.consumed_at === null ? null : toDate(row.consumed_at),
    supersededAt: row.superseded_at === null ? null : toDate(row.superseded_at),
    revokedAt: row.revoked_at === null ? null : toDate(row.revoked_at)
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
