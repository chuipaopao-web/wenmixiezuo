import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountCoreService,
  createPostgresPool,
  loadPostgresRuntimeConfig,
  runMigrations,
  type AccountCoreService,
  type PgPool
} from "@wenmi-rebuild/backend";
import { createApiServer } from "../../apps/api/src/create-server.js";

let appPool: PgPool;
let migratorPool: PgPool;
let service: AccountCoreService;
let originalEnv: NodeJS.ProcessEnv;

describe("account HTTP routes", () => {
  beforeAll(async () => {
    originalEnv = { ...process.env };
    const migratorConfig = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!migratorConfig.expectedDatabase.startsWith("wenmi_rebuild_test_")) {
      throw new Error("account API tests require a random wenmi_rebuild_test_<suffix> database");
    }
    await runMigrations({ config: migratorConfig });
    migratorPool = createPostgresPool(migratorConfig);
    const appUrl = process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL;
    if (!appUrl) throw new Error("WENMI_REBUILD_TEST_APP_DATABASE_URL is required");
    process.env.WENMI_REBUILD_DATABASE_URL = appUrl;
    const appConfig = loadPostgresRuntimeConfig(process.env, "app");
    appPool = createPostgresPool(appConfig);
    service = createAccountCoreService(appPool, { secureCookies: false });
  });

  beforeEach(async () => {
    await migratorPool.query(
      "TRUNCATE manual_book_chapter_directories, manual_book_opening_sources, bookshelf_book_audit_events, bookshelf_books, account_security_audit_events, account_rate_limits, account_one_time_tokens, account_sessions, account_users RESTART IDENTITY CASCADE"
    );
  });

  afterAll(async () => {
    process.env = originalEnv;
    await appPool?.end();
    await migratorPool?.end();
  });

  it("logs in with the migrated UI-compatible envelope and no-store response", async () => {
    const created = await service.createInternalUser({
      email: "api@example.com",
      displayName: "接口作者",
      password: "api password value"
    });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const server = await createApiServer({ accountPool: appPool });
    try {
      const login = await server.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: jsonWriteHeaders(),
        payload: { email: "api@example.com", password: "api password value" }
      });
      expect(login.statusCode).toBe(200);
      expect(login.headers["cache-control"]).toBe("no-store");
      expect(login.headers["set-cookie"]).toEqual(expect.stringContaining("wenmi_rebuild_session="));
      expect(JSON.parse(login.body)).toMatchObject({
        data: {
          account: {
            email: "api@example.com",
            displayName: "接口作者",
            role: "user",
            status: "active",
            emailVerified: true
          },
          expiresInSeconds: 86_400
        },
        meta: { requestId: expect.any(String) }
      });

      const me = await server.inject({
        method: "GET",
        url: "/v1/auth/me",
        headers: {
          host: "127.0.0.1:43280",
          cookie: String(login.headers["set-cookie"]).split(";", 1)[0]
        }
      });
      expect(me.statusCode).toBe(200);
      expect(me.headers["cache-control"]).toBe("no-store");
      expect(JSON.parse(me.body).data.email).toBe("api@example.com");
    } finally {
      await server.close();
    }
  });

  it("rejects cross-origin writes, duplicate cookies, and keeps auth errors no-store", async () => {
    const server = await createApiServer({ accountPool: appPool });
    try {
      const badOrigin = await server.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { ...jsonWriteHeaders(), origin: "http://evil.example" },
        payload: { email: "api@example.com", password: "api password value" }
      });
      expect(badOrigin.statusCode).toBe(403);
      expect(badOrigin.headers["cache-control"]).toBe("no-store");

      const duplicate = await server.inject({
        method: "GET",
        url: "/v1/auth/me",
        headers: {
          host: "127.0.0.1:43282",
          cookie: "wenmi_rebuild_session=a; wenmi_rebuild_session=b"
        }
      });
      expect(duplicate.statusCode).toBe(403);
      expect(duplicate.headers["cache-control"]).toBe("no-store");

      const health = await server.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("applies auth security hooks to encoded route URLs", async () => {
    const created = await service.createInternalUser({
      email: "encoded@example.com",
      displayName: "编码作者",
      password: "encoded password value"
    });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const server = await createApiServer({ accountPool: appPool });
    try {
      const encodedAuth = await server.inject({
        method: "POST",
        url: "/v1/%61uth/login",
        headers: { ...jsonWriteHeaders(), origin: "http://evil.example" },
        payload: { email: "encoded@example.com", password: "encoded password value" }
      });
      expect(encodedAuth.statusCode).toBe(403);
      expect(encodedAuth.headers["cache-control"]).toBe("no-store");

      const encodedLogin = await server.inject({
        method: "POST",
        url: "/v1/auth/%6cogin",
        headers: {
          ...jsonWriteHeaders(),
          cookie: "wenmi_rebuild_session=a; wenmi_rebuild_session=b"
        },
        payload: { email: "encoded@example.com", password: "encoded password value" }
      });
      expect(encodedLogin.statusCode).toBe(403);
      expect(encodedLogin.headers["cache-control"]).toBe("no-store");
    } finally {
      await server.close();
    }
  });

  it("serves profile reads and rejects unknown profile update fields", async () => {
    const created = await service.createInternalUser({
      email: "profile-api@example.com",
      displayName: "接口昵称",
      password: "profile api password"
    });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const login = await service.login({ email: created.account.email, password: "profile api password", ipAddress: "127.0.0.1" });
    const server = await createApiServer({ accountPool: appPool });
    try {
      const profile = await server.inject({
        method: "GET",
        url: "/v1/auth/profile",
        headers: { host: "127.0.0.1:43280", cookie: `wenmi_rebuild_session=${login.token}` }
      });
      expect(profile.statusCode).toBe(200);
      expect(JSON.parse(profile.body)).toMatchObject({ data: { displayName: "接口昵称", profileVersion: 1 } });

      const unknown = await server.inject({
        method: "POST",
        url: "/v1/auth/profile",
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${login.token}`),
        payload: { displayName: "新接口昵称", expectedVersion: 1, role: "admin" }
      });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.headers["cache-control"]).toBe("no-store");

      const invalidVersion = await server.inject({
        method: "POST",
        url: "/v1/auth/profile",
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${login.token}`),
        payload: { displayName: "新接口昵称", expectedVersion: 0 }
      });
      expect(invalidVersion.statusCode).toBe(400);

      const updated = await server.inject({
        method: "POST",
        url: "/v1/auth/profile",
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${login.token}`),
        payload: { displayName: " 新接口昵称 ", expectedVersion: 1 }
      });
      expect(updated.statusCode).toBe(200);
      expect(JSON.parse(updated.body)).toMatchObject({ data: { displayName: "新接口昵称", profileVersion: 2 } });

      const conflict = await server.inject({
        method: "POST",
        url: "/v1/auth/profile",
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${login.token}`),
        payload: { displayName: "覆盖", expectedVersion: 1 }
      });
      expect(conflict.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });
});

function jsonWriteHeaders(cookie?: string) {
  return {
    host: "127.0.0.1:43280",
    origin: "http://127.0.0.1:43280",
    "content-type": "application/json",
    ...(cookie === undefined ? {} : { cookie })
  };
}
