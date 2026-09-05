import { randomUUID } from "node:crypto";
import {
  accountDisplayNameSchema,
  accountEmailSchema,
  accountProfileSchema,
  publicAccountSchema,
  type AccountProfile,
  type PublicAccount
} from "@wenmi-rebuild/contracts";
import { DomainError } from "../../domain/errors.js";
import {
  hashNewPassword,
  hashVerifiedPassword,
  hashRateLimitScope,
  hashToken,
  issueRandomToken,
  readCookie,
  shouldUpgradePassword,
  verifyPassword,
  verifyUnknownAccountPassword,
  type AccountRecord,
  type AuthContext,
  type IssuedOneTimeToken,
  type IssuedSession,
  type OneTimeTokenPurpose,
  type PasswordRecord
} from "../../domain/accounts/index.js";
import { PostgresAccountRepository, type TokenRow } from "../../infrastructure/postgres/repositories/account-repository.js";
import type { PgPool, PgClient } from "../../infrastructure/postgres/client.js";

export const REBUILD_SESSION_COOKIE = "wenmi_rebuild_session";

const SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1_000;

export interface AccountServiceOptions {
  readonly secureCookies: boolean;
  readonly allowedCookiePath?: string;
}

export interface CreateInternalAccountInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly ipAddress: string;
}

export interface PasswordChangeInput {
  readonly sessionToken: string;
  readonly currentPassword: string;
  readonly nextPassword: string;
  readonly ipAddress: string;
}

export interface ProfileUpdateInput {
  readonly sessionToken: string;
  readonly displayName: string;
  readonly expectedVersion: number;
}

export class AccountCoreService {
  private readonly repository: PostgresAccountRepository;
  private readonly secureCookies: boolean;
  private readonly cookiePath: string;

  public constructor(pool: PgPool, options: AccountServiceOptions) {
    this.repository = new PostgresAccountRepository(pool);
    this.secureCookies = options.secureCookies;
    this.cookiePath = options.allowedCookiePath ?? "/";
  }

  public async createInternalUser(input: CreateInternalAccountInput): Promise<{ readonly account: PublicAccount }> {
    const email = normalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);
    const password = await hashNewPassword(input.password);
    return this.repository.withTransaction(async (client) => {
      const existing = await this.repository.findByEmail(client, email, true);
      if (existing !== null) {
        throw new DomainError("ACCOUNT_INPUT_INVALID", "这个邮箱已经存在。");
      }
      const account = await this.repository.insertAccount(client, {
        userId: randomUUID(),
        ownerId: randomUUID(),
        email,
        displayName,
        role: "user",
        status: "active",
        emailVerifiedAt: null,
        password
      });
      await this.audit(client, "account_created_internal", "succeeded", account, null, { emailVerified: false });
      return { account: publicAccount(account) };
    });
  }

  public async issueEmailVerificationToken(userId: string): Promise<IssuedOneTimeToken> {
    return this.issueOneTimeToken(userId, "email_verification", EMAIL_TOKEN_TTL_MS);
  }

  public async issuePasswordResetToken(email: string): Promise<IssuedOneTimeToken | null> {
    const normalized = normalizeEmail(email);
    const result = await this.repository.withTransaction(async (client) => {
      const allowed = await this.checkRateLimit(client, "email", normalized, "password_reset_issue", 3, 60 * 60 * 1_000, 60 * 60 * 1_000);
      const account = await this.repository.findByEmail(client, normalized, true);
      if (!allowed) return { kind: "limited" as const };
      if (account === null || account.status !== "active" || account.emailVerifiedAt === null) {
        await this.repository.recordAudit(client, {
          auditId: randomUUID(),
          userId: account?.userId ?? null,
          actorUserId: null,
          eventType: "password_reset_issue",
          result: "rejected",
          email: normalized,
          detail: { accepted: true }
        });
        return { kind: "empty" as const };
      }
      return { kind: "issued" as const, token: await this.issueOneTimeTokenInsideTransaction(client, account, "password_reset", RESET_TOKEN_TTL_MS) };
    });
    if (result.kind === "limited") throw new DomainError("ACCOUNT_RATE_LIMITED", "操作太频繁，请稍后再试。", true);
    return result.kind === "issued" ? result.token : null;
  }

  public async verifyEmailToken(token: string): Promise<{ readonly account: PublicAccount }> {
    const { account } = await this.consumeOneTimeToken(token, "email_verification", async (client, lockedAccount) => {
      const verified = await this.repository.verifyEmail(client, lockedAccount.userId);
      await this.audit(client, "email_verified", "succeeded", verified, verified.userId, {});
      return verified;
    });
    return { account: publicAccount(account) };
  }

  public async resetPasswordWithToken(token: string, nextPassword: string): Promise<{ readonly reset: true }> {
    const next = await hashNewPassword(nextPassword);
    await this.consumeOneTimeToken(token, "password_reset", async (client, lockedAccount) => {
      const changed = await this.repository.replacePassword(client, lockedAccount.userId, next);
      await this.repository.revokeUserSessions(client, changed.userId, null, "password_reset");
      await this.repository.revokeUserTokens(client, changed.userId, null);
      await this.audit(client, "password_reset", "succeeded", changed, changed.userId, {});
      return changed;
    });
    return { reset: true };
  }

  public async login(input: LoginInput): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const password = input.password;
    const prepared = await this.repository.withTransaction(async (client) => {
      const ipAllowed = await this.checkRateLimit(client, "ip", input.ipAddress, "login", 30, 5 * 60 * 1_000, 15 * 60 * 1_000);
      if (!ipAllowed) {
        return { rateAllowed: false, account: null };
      }
      const emailAllowed = await this.checkRateLimit(client, "email", email, "login", 10, 5 * 60 * 1_000, 15 * 60 * 1_000);
      return {
        rateAllowed: emailAllowed,
        account: await this.repository.findByEmail(client, email, false)
      };
    });
    if (!prepared.rateAllowed) throw new DomainError("ACCOUNT_RATE_LIMITED", "操作太频繁，请稍后再试。", true);

    if (prepared.account === null) {
      await verifyUnknownAccountPassword(password);
      await this.auditLoginFailure(email, null);
      throw new DomainError("ACCOUNT_CREDENTIALS_INVALID", "邮箱或密码不正确。");
    }

    const accountBeforeHash = prepared.account;
    const passwordMatches = await verifyPassword(password, accountBeforeHash.password);
    const upgradedPassword = passwordMatches && shouldUpgradePassword(accountBeforeHash.password)
      ? await hashVerifiedPassword(password)
      : null;

    const result = await this.repository.withTransaction(async (client) => {
      const account = await this.repository.findByEmail(client, email, true);
      if (
        account === null ||
        account.credentialVersion !== accountBeforeHash.credentialVersion ||
        !samePasswordRecord(account.password, accountBeforeHash.password) ||
        !passwordMatches
      ) {
        await this.audit(client, "login_failed", "failed", account, null, {});
        return { kind: "invalid" as const };
      }
      if (account.status !== "active") {
        await this.audit(client, "login_rejected", "rejected", account, null, { reason: "account_status" });
        return { kind: "disabled" as const };
      }
      if (account.emailVerifiedAt === null) {
        await this.audit(client, "login_rejected", "rejected", account, null, { reason: "email_unverified" });
        return { kind: "unverified" as const };
      }
      const current = upgradedPassword === null
        ? account
        : await this.repository.upgradePasswordWithoutVersionChange(client, account.userId, upgradedPassword);
      const issued = await this.issueSessionInsideTransaction(client, current);
      await this.audit(client, "login_success", "succeeded", current, current.userId, {});
      return { kind: "issued" as const, issued };
    });
    if (result.kind === "invalid") throw new DomainError("ACCOUNT_CREDENTIALS_INVALID", "邮箱或密码不正确。");
    if (result.kind === "disabled") throw new DomainError("ACCOUNT_DISABLED", "这个账号暂时不能使用。");
    if (result.kind === "unverified") throw new DomainError("ACCOUNT_EMAIL_NOT_VERIFIED", "请先完成邮箱验证。");
    return result.issued;
  }

  public async authenticateToken(token: string, touch = true): Promise<AuthContext | null> {
    if (token.length === 0 || token.length > 512) return null;
    return this.repository.withTransaction(async (client) => {
      const session = await this.repository.findSessionByTokenHash(client, hashToken(token), false);
      if (session === null) return null;
      const now = await this.repository.databaseTime(client);
      if (!sessionIsValid(session, now)) return null;
      if (touch) await this.repository.touchSession(client, session.sessionId);
      return authContextFor(session.account, session.sessionId);
    });
  }

  public async authenticateCookie(cookieHeader: string | undefined): Promise<AuthContext | null> {
    const token = readCookie(cookieHeader, REBUILD_SESSION_COOKIE);
    if (token === null) return null;
    return this.authenticateToken(token);
  }

  public async logout(sessionToken: string): Promise<{ readonly loggedOut: true; readonly cookie: string }> {
    await this.repository.withTransaction(async (client) => {
      const session = await this.lockAndValidateSession(client, sessionToken);
      await this.repository.revokeSession(client, session.sessionId, session.account.userId, "logout");
      await this.audit(client, "logout", "succeeded", session.account, session.account.userId, {});
    });
    return { loggedOut: true, cookie: this.clearCookie() };
  }

  public async changePassword(input: PasswordChangeInput): Promise<{ readonly changed: true; readonly revokedSessions: number }> {
    const located = await this.locateValidSession(input.sessionToken);
    if (located === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
    const rateAllowed = await this.repository.withTransaction(async (client) =>
      this.checkRateLimit(client, "ip", input.ipAddress, "password_change", 10, 10 * 60 * 1_000, 10 * 60 * 1_000)
    );
    if (!rateAllowed) throw new DomainError("ACCOUNT_RATE_LIMITED", "操作太频繁，请稍后再试。", true);
    const currentMatches = located === null ? false : await verifyPassword(input.currentPassword, located.account.password);
    const next = await hashNewPassword(input.nextPassword);
    const result = await this.repository.withTransaction(async (client) => {
      const session = await this.lockAndValidateSession(client, input.sessionToken);
      if (!currentMatches || located === null || !samePasswordRecord(session.account.password, located.account.password)) {
        await this.audit(client, "password_change", "failed", session.account, session.account.userId, {});
        return { kind: "invalid" as const };
      }
      const changed = await this.repository.replacePassword(client, session.account.userId, next);
      const revoked = await this.repository.revokeUserSessions(client, changed.userId, null, "password_changed");
      await this.repository.revokeUserTokens(client, changed.userId, null);
      await this.audit(client, "password_change", "succeeded", changed, changed.userId, { revokedSessions: revoked });
      return { kind: "changed" as const, revokedSessions: revoked };
    });
    if (result.kind === "invalid") throw new DomainError("ACCOUNT_CREDENTIALS_INVALID", "当前密码不正确。");
    return { changed: true, revokedSessions: result.revokedSessions };
  }

  public async revokeOtherSessions(sessionToken: string): Promise<{ readonly revoked: number }> {
    return this.repository.withTransaction(async (client) => {
      const session = await this.lockAndValidateSession(client, sessionToken);
      const revoked = await this.repository.revokeUserSessions(client, session.account.userId, session.sessionId, "revoked_by_user");
      await this.audit(client, "sessions_revoke_others", "succeeded", session.account, session.account.userId, { revokedSessions: revoked });
      return { revoked };
    });
  }

  public async getProfile(sessionToken: string): Promise<AccountProfile> {
    const session = await this.locateValidSession(sessionToken);
    if (session === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
    return accountProfile(session.account);
  }

  public async updateProfile(input: ProfileUpdateInput): Promise<AccountProfile> {
    const displayName = normalizeDisplayName(input.displayName);
    const expectedVersion = validateExpectedProfileVersion(input.expectedVersion);
    const result = await this.repository.withTransaction(async (client) => {
      const session = await this.lockAndValidateSession(client, input.sessionToken);
      if (session.account.profileVersion !== expectedVersion) {
        await this.audit(client, "profile_update", "rejected", session.account, session.account.userId, {
          reason: "version_conflict",
          expectedVersion,
          currentVersion: session.account.profileVersion
        });
        return { kind: "conflict" as const, profile: accountProfile(session.account) };
      }
      if (session.account.displayName === displayName) {
        return { kind: "ok" as const, profile: accountProfile(session.account) };
      }
      const updated = await this.repository.updateProfileDisplayName(client, session.account.userId, displayName);
      await this.audit(client, "profile_update", "succeeded", updated, updated.userId, {
        previousVersion: session.account.profileVersion,
        nextVersion: updated.profileVersion
      });
      return { kind: "ok" as const, profile: accountProfile(updated) };
    });
    if (result.kind === "conflict") {
      throw new DomainError("ACCOUNT_PROFILE_CONFLICT", "资料已经更新，请刷新后重试。");
    }
    return result.profile;
  }

  public cookieFromToken(token: string): string {
    return `${REBUILD_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=${this.cookiePath}; Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}${this.secureCookies ? "; Secure" : ""}`;
  }

  public clearCookie(): string {
    return `${REBUILD_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=${this.cookiePath}; Max-Age=0${this.secureCookies ? "; Secure" : ""}`;
  }

  private async issueOneTimeToken(userId: string, purpose: OneTimeTokenPurpose, ttlMs: number): Promise<IssuedOneTimeToken> {
    return this.repository.withTransaction(async (client) => {
      const account = await this.repository.findByUserId(client, userId, true);
      if (account === null) throw new DomainError("ACCOUNT_TOKEN_INVALID", "账号验证链接无效。");
      return this.issueOneTimeTokenInsideTransaction(client, account, purpose, ttlMs);
    });
  }

  private async issueOneTimeTokenInsideTransaction(
    client: PgClient,
    account: AccountRecord,
    purpose: OneTimeTokenPurpose,
    ttlMs: number
  ): Promise<IssuedOneTimeToken> {
    if (account.status !== "active") {
      await this.audit(client, `${purpose}_token_issue`, "rejected", account, account.userId, { reason: "account_status" });
      throw new DomainError("ACCOUNT_DISABLED", "这个账号暂时不能使用。");
    }
    await this.repository.supersedeTokens(client, account.userId, purpose);
    const token = issueRandomToken();
    const now = await this.repository.databaseTime(client);
    const row = await this.repository.insertOneTimeToken(client, {
      tokenId: randomUUID(),
      userId: account.userId,
      purpose,
      tokenHash: hashToken(token),
      credentialVersion: account.credentialVersion,
      expiresAt: new Date(now.getTime() + ttlMs)
    });
    await this.audit(client, `${purpose}_token_issued`, "succeeded", account, account.userId, {});
    return { tokenId: row.tokenId, userId: row.userId, purpose, token, expiresAt: row.expiresAt };
  }

  private async consumeOneTimeToken(
    token: string,
    purpose: OneTimeTokenPurpose,
    consume: (client: PgClient, account: AccountRecord, token: TokenRow) => Promise<AccountRecord>
  ): Promise<{ readonly account: AccountRecord }> {
    const tokenHash = hashToken(token);
    const located = await this.repository.withTransaction(async (client) => this.repository.findOneTimeToken(client, tokenHash));
    if (located === null) throw new DomainError("ACCOUNT_TOKEN_INVALID", "验证链接无效或已经过期。");
    const result = await this.repository.withTransaction(async (client) => {
      const account = await this.repository.findByUserId(client, located.userId, true);
      const lockedToken = await this.repository.findOneTimeTokenForUpdate(client, tokenHash);
      const now = await this.repository.databaseTime(client);
      if (account === null || lockedToken === null || !tokenCanBeConsumed(lockedToken, account, purpose, now)) {
        await this.repository.recordAudit(client, {
          auditId: randomUUID(),
          userId: account?.userId ?? located.userId,
          actorUserId: null,
          eventType: `${purpose}_token_consumed`,
          result: "rejected",
          email: account?.email ?? null,
          detail: { reason: "invalid" }
        });
        return { kind: "invalid" as const };
      }
      await this.repository.consumeOneTimeToken(client, lockedToken.tokenId);
      return { kind: "consumed" as const, account: await consume(client, account, lockedToken) };
    });
    if (result.kind === "invalid") throw new DomainError("ACCOUNT_TOKEN_INVALID", "验证链接无效或已经过期。");
    return { account: result.account };
  }

  private async issueSessionInsideTransaction(client: PgClient, account: AccountRecord): Promise<IssuedSession> {
    const now = await this.repository.databaseTime(client);
    const token = issueRandomToken();
    await this.repository.insertSession(client, {
      sessionId: randomUUID(),
      userId: account.userId,
      tokenHash: hashToken(token),
      credentialVersion: account.credentialVersion,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS)
    });
    await client.query("UPDATE account_users SET last_login_at = clock_timestamp(), updated_at = clock_timestamp() WHERE user_id = $1", [account.userId]);
    return {
      account: publicAccount(account),
      token,
      cookie: this.cookieFromToken(token),
      expiresInSeconds: Math.floor(SESSION_TTL_MS / 1_000)
    };
  }

  private async lockAndValidateSession(client: PgClient, sessionToken: string) {
    const located = await this.repository.findSessionByTokenHash(client, hashToken(sessionToken), false);
    if (located === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
    const account = await this.repository.findByUserId(client, located.account.userId, true);
    const session = await this.repository.findSessionByTokenHash(client, hashToken(sessionToken), true);
    const now = await this.repository.databaseTime(client);
    if (account === null || session === null || session.account.userId !== account.userId || !sessionIsValid({ ...session, account }, now)) {
      throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
    }
    return { ...session, account };
  }

  private async locateValidSession(sessionToken: string) {
    return this.repository.withTransaction(async (client) => {
      const session = await this.repository.findSessionByTokenHash(client, hashToken(sessionToken), false);
      if (session === null) return null;
      const now = await this.repository.databaseTime(client);
      return sessionIsValid(session, now) ? session : null;
    });
  }

  private async checkRateLimit(
    client: PgClient,
    scopeKind: "email" | "ip" | "session",
    scope: string,
    action: string,
    limit: number,
    windowMs: number,
    blockMs: number
  ): Promise<boolean> {
    const result = await this.repository.checkRateLimit(client, {
      scopeKind,
      scopeHash: hashRateLimitScope(scope),
      action,
      limit,
      windowMs,
      blockMs
    });
    return result.allowed;
  }

  private async audit(
    client: PgClient,
    eventType: string,
    result: "succeeded" | "failed" | "rejected",
    account: AccountRecord | null,
    actorUserId: string | null,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.repository.recordAudit(client, {
      auditId: randomUUID(),
      userId: account?.userId ?? null,
      actorUserId,
      eventType,
      result,
      email: account?.email ?? null,
      detail
    });
  }

  private async auditLoginFailure(email: string, account: AccountRecord | null): Promise<void> {
    await this.repository.withTransaction(async (client) => {
      await this.audit(client, "login_failed", "failed", account, null, { emailKnown: account !== null });
    });
  }
}

export function createAccountCoreService(pool: PgPool, options: AccountServiceOptions): AccountCoreService {
  return new AccountCoreService(pool, options);
}

function sessionIsValid(
  session: { readonly expiresAt: Date; readonly revokedAt: Date | null; readonly sessionCredentialVersion: number; readonly account: AccountRecord },
  now: Date
): boolean {
  return session.revokedAt === null &&
    session.expiresAt.getTime() > now.getTime() &&
    session.sessionCredentialVersion === session.account.credentialVersion &&
    session.account.status === "active" &&
    session.account.emailVerifiedAt !== null;
}

function tokenCanBeConsumed(token: TokenRow, account: AccountRecord, purpose: OneTimeTokenPurpose, now: Date): boolean {
  return token.userId === account.userId &&
    account.status === "active" &&
    token.purpose === purpose &&
    token.credentialVersion === account.credentialVersion &&
    token.consumedAt === null &&
    token.supersededAt === null &&
    token.revokedAt === null &&
    token.expiresAt.getTime() > now.getTime();
}

function authContextFor(account: AccountRecord, sessionId: string): AuthContext {
  return {
    userId: account.userId,
    ownerId: account.ownerId,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    sessionId,
    credentialVersion: account.credentialVersion
  };
}

function publicAccount(account: AccountRecord): PublicAccount {
  return publicAccountSchema.parse({
    userId: account.userId,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    status: account.status,
    emailVerified: account.emailVerifiedAt !== null
  });
}

function accountProfile(account: AccountRecord): AccountProfile {
  return accountProfileSchema.parse({
    displayName: account.displayName,
    profileVersion: account.profileVersion
  });
}

function normalizeEmail(raw: string): string {
  const parsed = accountEmailSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("ACCOUNT_INPUT_INVALID", "请输入有效的邮箱地址。");
  }
  return parsed.data;
}

function normalizeDisplayName(raw: string): string {
  const parsed = accountDisplayNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("ACCOUNT_INPUT_INVALID", "昵称需要1至80个字符。");
  }
  return parsed.data;
}

function validateExpectedProfileVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new DomainError("ACCOUNT_INPUT_INVALID", "资料版本已经失效，请刷新后重试。");
  }
  return value;
}

function samePasswordRecord(left: PasswordRecord, right: PasswordRecord): boolean {
  return left.format === right.format &&
    left.salt === right.salt &&
    left.hash === right.hash &&
    left.n === right.n &&
    left.r === right.r &&
    left.p === right.p &&
    left.keyLength === right.keyLength;
}
