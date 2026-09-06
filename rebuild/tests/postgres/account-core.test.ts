import { createHash, randomUUID, scrypt } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountCoreService,
  createPostgresPool,
  hashNewPassword,
  hashToken,
  legacyScryptRecord,
  loadPostgresRuntimeConfig,
  PostgresAccountRepository,
  runMigrations,
  type AccountCoreService,
  type PgPool
} from "@wenmi-rebuild/backend";

let appPool: PgPool;
let migratorPool: PgPool;
let service: AccountCoreService;

describe("real PostgreSQL account core", () => {
  beforeAll(async () => {
    const migratorConfig = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!migratorConfig.expectedDatabase.startsWith("wenmi_rebuild_test_")) {
      throw new Error("account core tests require a random wenmi_rebuild_test_<suffix> database");
    }
    await runMigrations({ config: migratorConfig });
    migratorPool = createPostgresPool(migratorConfig);
    const appUrl = process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL;
    if (!appUrl) throw new Error("WENMI_REBUILD_TEST_APP_DATABASE_URL is required");
    const appConfig = loadPostgresRuntimeConfig({ ...process.env, WENMI_REBUILD_DATABASE_URL: appUrl }, "app");
    appPool = createPostgresPool(appConfig);
    service = createAccountCoreService(appPool, { secureCookies: false });
  });

  beforeEach(async () => {
    await truncateAccounts(migratorPool);
  });

  afterAll(async () => {
    await appPool?.end();
    await migratorPool?.end();
  });

  it("requires real internal email verification before login and consumes the token once", async () => {
    const created = await service.createInternalUser({
      email: " Writer@Example.COM ",
      displayName: "作者一号",
      password: "verified password one"
    });
    expect(created.account).toMatchObject({ email: "writer@example.com", role: "user", emailVerified: false });

    await expect(service.login({ email: "writer@example.com", password: "verified password one", ipAddress: "127.0.0.1" }))
      .rejects.toMatchObject({ code: "ACCOUNT_EMAIL_NOT_VERIFIED" });

    const verification = await service.issueEmailVerificationToken(created.account.userId);
    const results = await Promise.allSettled([
      service.verifyEmailToken(verification.token),
      service.verifyEmailToken(verification.token)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const issued = await service.login({ email: "writer@example.com", password: "verified password one", ipAddress: "127.0.0.1" });
    expect(issued.cookie).toContain("wenmi_rebuild_session=");
    await expect(service.authenticateToken(issued.token)).resolves.toMatchObject({ email: "writer@example.com" });
  });

  it("revokes old sessions and recovery tokens when changing password", async () => {
    const created = await service.createInternalUser({
      email: "change@example.com",
      displayName: "改密作者",
      password: "initial password value"
    });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const reset = await service.issuePasswordResetToken(created.account.email);
    expect(reset?.token).toBeTruthy();
    const first = await service.login({ email: created.account.email, password: "initial password value", ipAddress: "127.0.0.1" });
    const second = await service.login({ email: created.account.email, password: "initial password value", ipAddress: "127.0.0.1" });

    await expect(service.changePassword({
      sessionToken: first.token,
      currentPassword: "initial password value",
      nextPassword: "updated password value",
      ipAddress: "127.0.0.1"
    })).resolves.toEqual({ changed: true, revokedSessions: 2 });

    await expect(service.authenticateToken(first.token)).resolves.toBeNull();
    await expect(service.authenticateToken(second.token)).resolves.toBeNull();
    await expect(service.login({ email: created.account.email, password: "initial password value", ipAddress: "127.0.0.1" }))
      .rejects.toMatchObject({ code: "ACCOUNT_CREDENTIALS_INVALID" });
    await expect(service.login({ email: created.account.email, password: "updated password value", ipAddress: "127.0.0.1" }))
      .resolves.toMatchObject({ account: { email: created.account.email } });
    await expect(service.resetPasswordWithToken(reset!.token, "reset password should fail")).rejects.toMatchObject({ code: "ACCOUNT_TOKEN_INVALID" });
  });

  it("upgrades legacy scrypt rows only after a locked successful login", async () => {
    const password = "legacy password value";
    const salt = "00112233445566778899aabbccddeeff";
    const hash = await legacyHash(password, salt);
    const record = legacyScryptRecord(salt, hash);
    const userId = randomUUID();
    await migratorPool.query(
      `INSERT INTO account_users (
         user_id, owner_id, email_normalized, display_name, role, status, email_verified_at,
         password_format, password_salt, password_hash, password_n, password_r, password_p, password_key_length
       ) VALUES ($1, $2, 'legacy@example.com', '旧账号', 'user', 'active', clock_timestamp(), $3, $4, $5, $6, $7, $8, $9)`,
      [userId, randomUUID(), record.format, record.salt, record.hash, record.n, record.r, record.p, record.keyLength]
    );

    await service.login({ email: "legacy@example.com", password, ipAddress: "127.0.0.1" });

    const upgraded = await migratorPool.query<{ password_format: string; password_n: number; password_p: number; credential_version: number }>(
      "SELECT password_format, password_n, password_p, credential_version FROM account_users WHERE user_id = $1",
      [userId]
    );
    expect(upgraded.rows[0]).toMatchObject({ password_format: "scrypt-v2", password_n: 32_768, password_p: 3, credential_version: 1 });
  });

  it("keeps audit details free of raw token and password fields", async () => {
    const created = await service.createInternalUser({
      email: "audit@example.com",
      displayName: "审计作者",
      password: "audit password value"
    });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const issued = await service.login({ email: created.account.email, password: "audit password value", ipAddress: "127.0.0.1" });
    await expect(service.login({ email: created.account.email, password: "wrong password value", ipAddress: "127.0.0.1" }))
      .rejects.toMatchObject({ code: "ACCOUNT_CREDENTIALS_INVALID" });
    await expect(service.changePassword({
      sessionToken: issued.token,
      currentPassword: "wrong password value",
      nextPassword: "audit password changed",
      ipAddress: "127.0.0.1"
    })).rejects.toMatchObject({ code: "ACCOUNT_CREDENTIALS_INVALID" });
    await service.revokeOtherSessions(issued.token);

    const rows = await migratorPool.query<{ detail: string }>("SELECT detail::text AS detail FROM account_security_audit_events");
    expect(rows.rows.map((row) => row.detail).join("\n")).not.toMatch(/password|token|cookie|secret|authorization/i);
    const failures = await migratorPool.query<{ event_type: string; result: string }>(
      "SELECT event_type, result FROM account_security_audit_events WHERE result = 'failed' ORDER BY occurred_at"
    );
    expect(failures.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["login_failed", "password_change"]));
    await expect(appPool.query("DELETE FROM account_security_audit_events")).rejects.toMatchObject({ code: "42501" });
  });

  it("persists first-wave concurrent rate-limit attempts", async () => {
    const repository = new PostgresAccountRepository(appPool);
    const attempts = Array.from({ length: 12 }, () =>
      repository.withTransaction((client) => repository.checkRateLimit(client, {
        scopeKind: "email",
        scopeHash: sha256("burst@example.com"),
        action: "login",
        limit: 10,
        windowMs: 5 * 60 * 1_000,
        blockMs: 15 * 60 * 1_000
      }))
    );
    const results = await Promise.all(attempts);
    expect(results.filter((result) => result.allowed)).toHaveLength(10);

    const rateLimit = await migratorPool.query<{ attempts: number; blocked_until: Date | null }>(
      "SELECT attempts, blocked_until FROM account_rate_limits WHERE action = 'login' AND scope_kind = 'email'"
    );
    expect(Number(rateLimit.rows[0]?.attempts)).toBe(11);
    expect(rateLimit.rows[0]?.blocked_until).not.toBeNull();
    await repository.withTransaction((client) => repository.checkRateLimit(client, {
      scopeKind: "ip",
      scopeHash: sha256("198.51.100.11"),
      action: "login",
      limit: 1,
      windowMs: 5 * 60 * 1_000,
      blockMs: 15 * 60 * 1_000
    }));
    await repository.withTransaction((client) => repository.checkRateLimit(client, {
      scopeKind: "ip",
      scopeHash: sha256("198.51.100.11"),
      action: "login",
      limit: 1,
      windowMs: 5 * 60 * 1_000,
      blockMs: 15 * 60 * 1_000
    }));
    const emailRowsAfterBlockedIp = await migratorPool.query<{ total: string }>(
      "SELECT COUNT(*) AS total FROM account_rate_limits WHERE action = 'login' AND scope_kind = 'email'"
    );
    await service.login({ email: "new-missing@example.com", password: "unknown password value", ipAddress: "198.51.100.11" }).catch(() => undefined);
    const emailRowsAfterExtraAttempt = await migratorPool.query<{ total: string }>(
      "SELECT COUNT(*) AS total FROM account_rate_limits WHERE action = 'login' AND scope_kind = 'email'"
    );
    expect(emailRowsAfterExtraAttempt.rows[0]?.total).toBe(emailRowsAfterBlockedIp.rows[0]?.total);
  });

  it("rejects one-time tokens after an account is suspended", async () => {
    const created = await service.createInternalUser({
      email: "suspended@example.com",
      displayName: "停用作者",
      password: "suspended password value"
    });
    const verification = await service.issueEmailVerificationToken(created.account.userId);
    await migratorPool.query("UPDATE account_users SET status = 'suspended' WHERE user_id = $1", [created.account.userId]);

    await expect(service.verifyEmailToken(verification.token)).rejects.toMatchObject({ code: "ACCOUNT_TOKEN_INVALID" });
  });

  it("rejects expired tokens using stored database state", async () => {
    const created = await service.createInternalUser({
      email: "expired@example.com",
      displayName: "过期作者",
      password: "expired password value"
    });
    const verification = await service.issueEmailVerificationToken(created.account.userId);
    await migratorPool.query("UPDATE account_one_time_tokens SET expires_at = clock_timestamp() - interval '1 second' WHERE token_hash = $1", [
      hashToken(verification.token)
    ]);

    await expect(service.verifyEmailToken(verification.token)).rejects.toMatchObject({ code: "ACCOUNT_TOKEN_INVALID" });
  });

  it("does not leave an old-password session valid after a reset/login race", async () => {
    const created = await service.createInternalUser({
      email: "race@example.com",
      displayName: "竞争作者",
      password: "race original password"
    });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const reset = await service.issuePasswordResetToken(created.account.email);
    expect(reset).not.toBeNull();

    const results = await Promise.allSettled([
      service.resetPasswordWithToken(reset!.token, "race updated password"),
      service.login({ email: created.account.email, password: "race original password", ipAddress: "127.0.0.1" })
    ]);
    const oldLogin = results.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<AccountCoreService["login"]>>> =>
      result.status === "fulfilled" && "token" in result.value
    );
    if (oldLogin !== undefined) {
      await expect(service.authenticateToken(oldLogin.value.token)).resolves.toBeNull();
    }
    await expect(service.login({ email: created.account.email, password: "race original password", ipAddress: "127.0.0.1" }))
      .rejects.toMatchObject({ code: "ACCOUNT_CREDENTIALS_INVALID" });
    await expect(service.login({ email: created.account.email, password: "race updated password", ipAddress: "127.0.0.1" }))
      .resolves.toMatchObject({ account: { email: created.account.email } });
  });

  it("revokes only the current account's other sessions", async () => {
    const first = await service.createInternalUser({ email: "first@example.com", displayName: "第一作者", password: "first password value" });
    const second = await service.createInternalUser({ email: "second@example.com", displayName: "第二作者", password: "second password value" });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(first.account.userId)).token);
    await service.verifyEmailToken((await service.issueEmailVerificationToken(second.account.userId)).token);
    const firstA = await service.login({ email: first.account.email, password: "first password value", ipAddress: "127.0.0.1" });
    const firstB = await service.login({ email: first.account.email, password: "first password value", ipAddress: "127.0.0.1" });
    const secondSession = await service.login({ email: second.account.email, password: "second password value", ipAddress: "127.0.0.1" });

    await expect(service.revokeOtherSessions(firstA.token)).resolves.toEqual({ revoked: 1 });
    await expect(service.authenticateToken(firstA.token)).resolves.toMatchObject({ email: first.account.email });
    await expect(service.authenticateToken(firstB.token)).resolves.toBeNull();
    await expect(service.authenticateToken(secondSession.token)).resolves.toMatchObject({ email: second.account.email });
  });

  it("rolls back account creation when same-transaction audit fails", async () => {
    const repository = new PostgresAccountRepository(appPool);
    const password = await hashNewPassword("rollback password value");
    const userId = randomUUID();
    await expect(repository.withTransaction(async (client) => {
      const account = await repository.insertAccount(client, {
        userId,
        ownerId: randomUUID(),
        email: "rollback@example.com",
        displayName: "回滚作者",
        role: "user",
        status: "active",
        emailVerifiedAt: null,
        password
      });
      await repository.recordAudit(client, {
        auditId: randomUUID(),
        userId: account.userId,
        actorUserId: null,
        eventType: "forced_audit_failure",
        result: "succeeded",
        email: account.email,
        detail: { password: "blocked" }
      });
    })).rejects.toBeTruthy();

    const row = await migratorPool.query("SELECT 1 FROM account_users WHERE user_id = $1", [userId]);
    expect(row.rowCount).toBe(0);
  });

  it("reads and updates only the current user's profile with optimistic versions", async () => {
    const created = await service.createInternalUser({ email: "profile@example.com", displayName: " 原昵称 ", password: "profile password value" });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const session = await service.login({ email: created.account.email, password: "profile password value", ipAddress: "127.0.0.1" });

    await expect(service.getProfile(session.token)).resolves.toEqual({ displayName: "原昵称", profileVersion: 1 });
    await expect(service.updateProfile({ sessionToken: session.token, displayName: " 原昵称 ", expectedVersion: 1 }))
      .resolves.toEqual({ displayName: "原昵称", profileVersion: 1 });
    await expect(service.updateProfile({ sessionToken: session.token, displayName: "新昵称", expectedVersion: 1 }))
      .resolves.toEqual({ displayName: "新昵称", profileVersion: 2 });
    await expect(service.updateProfile({ sessionToken: session.token, displayName: "旧请求覆盖", expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "ACCOUNT_PROFILE_CONFLICT" });

    const audit = await migratorPool.query<{ event_type: string; result: string }>(
      "SELECT event_type, result FROM account_security_audit_events WHERE event_type = 'profile_update' ORDER BY occurred_at"
    );
    expect(audit.rows).toEqual([
      { event_type: "profile_update", result: "succeeded" },
      { event_type: "profile_update", result: "rejected" }
    ]);
  });

  it("allows only one concurrent profile update for the same version", async () => {
    const created = await service.createInternalUser({ email: "profile-race@example.com", displayName: "并发作者", password: "profile race password" });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const session = await service.login({ email: created.account.email, password: "profile race password", ipAddress: "127.0.0.1" });

    const results = await Promise.allSettled([
      service.updateProfile({ sessionToken: session.token, displayName: "并发一", expectedVersion: 1 }),
      service.updateProfile({ sessionToken: session.token, displayName: "并发二", expectedVersion: 1 })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(service.getProfile(session.token)).resolves.toMatchObject({ profileVersion: 2 });
  });

  it("rejects profile writes from revoked, suspended, or credential-stale sessions", async () => {
    const created = await service.createInternalUser({ email: "profile-auth@example.com", displayName: "认证作者", password: "profile auth password" });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const first = await service.login({ email: created.account.email, password: "profile auth password", ipAddress: "127.0.0.1" });
    const second = await service.login({ email: created.account.email, password: "profile auth password", ipAddress: "127.0.0.1" });

    await service.revokeOtherSessions(first.token);
    await expect(service.updateProfile({ sessionToken: second.token, displayName: "撤销后", expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    await service.changePassword({
      sessionToken: first.token,
      currentPassword: "profile auth password",
      nextPassword: "profile auth changed",
      ipAddress: "127.0.0.1"
    });
    await expect(service.updateProfile({ sessionToken: first.token, displayName: "改密后", expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    const fresh = await service.login({ email: created.account.email, password: "profile auth changed", ipAddress: "127.0.0.1" });
    await migratorPool.query("UPDATE account_users SET status = 'suspended' WHERE user_id = $1", [created.account.userId]);
    await expect(service.updateProfile({ sessionToken: fresh.token, displayName: "停用后", expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("rolls back profile changes when same-transaction audit fails", async () => {
    const created = await service.createInternalUser({ email: "profile-rollback@example.com", displayName: "未修改", password: "profile rollback password" });
    const repository = new PostgresAccountRepository(appPool);

    await expect(repository.withTransaction(async (client) => {
      const account = await repository.findByUserId(client, created.account.userId, true);
      if (account === null) throw new Error("missing account");
      const updated = await repository.updateProfileDisplayName(client, account.userId, "不应提交");
      await repository.recordAudit(client, {
        auditId: randomUUID(),
        userId: updated.userId,
        actorUserId: updated.userId,
        eventType: "profile_update",
        result: "succeeded",
        email: updated.email,
        detail: { token: "blocked" }
      });
    })).rejects.toBeTruthy();

    const row = await migratorPool.query<{ display_name: string; profile_version: number }>(
      "SELECT display_name, profile_version FROM account_users WHERE user_id = $1",
      [created.account.userId]
    );
    expect(row.rows[0]).toMatchObject({ display_name: "未修改", profile_version: 1 });
  });
});

async function truncateAccounts(pool: PgPool): Promise<void> {
  await pool.query(
    "TRUNCATE book_profile_versions, manual_book_chapter_directories, manual_book_opening_sources, bookshelf_book_audit_events, bookshelf_books, account_security_audit_events, account_rate_limits, account_one_time_tokens, account_sessions, account_users RESTART IDENTITY CASCADE"
  );
}

function legacyHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
      if (error !== null) reject(error);
      else resolve(Buffer.from(derived).toString("hex"));
    });
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
