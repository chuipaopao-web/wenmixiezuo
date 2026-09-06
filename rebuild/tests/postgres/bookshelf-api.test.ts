import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountCoreService,
  createBookShelfService,
  createPostgresPool,
  loadPostgresRuntimeConfig,
  runMigrations,
  type AccountCoreService,
  type BookShelfService,
  type PgPool
} from "@wenmi-rebuild/backend";
import { createApiServer } from "../../apps/api/src/create-server.js";

let appPool: PgPool;
let migratorPool: PgPool;
let accounts: AccountCoreService;
let books: BookShelfService;
let originalEnv: NodeJS.ProcessEnv;

describe("bookshelf HTTP routes", () => {
  beforeAll(async () => {
    originalEnv = { ...process.env };
    const migratorConfig = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!migratorConfig.expectedDatabase.startsWith("wenmi_rebuild_test_")) {
      throw new Error("bookshelf API tests require a random wenmi_rebuild_test_<suffix> database");
    }
    await runMigrations({ config: migratorConfig });
    migratorPool = createPostgresPool(migratorConfig);
    const appUrl = process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL;
    if (!appUrl) throw new Error("WENMI_REBUILD_TEST_APP_DATABASE_URL is required");
    process.env.WENMI_REBUILD_DATABASE_URL = appUrl;
    const appConfig = loadPostgresRuntimeConfig(process.env, "app");
    appPool = createPostgresPool(appConfig);
    accounts = createAccountCoreService(appPool, { secureCookies: false });
    books = createBookShelfService(appPool, accounts);
  });

  beforeEach(async () => {
    await truncateAll(migratorPool);
  });

  afterAll(async () => {
    process.env = originalEnv;
    await appPool?.end();
    await migratorPool?.end();
  });

  it("lists books with the UI-compatible envelope and next cursor metadata", async () => {
    const login = await createVerifiedLogin("books-api@example.com", "书架接口");
    const older = await books.createBookFromSession(login.token, { title: "旧书", idempotencyKey: "old" });
    const newer = await books.createBookFromSession(login.token, { title: "新书", idempotencyKey: "new" });
    await migratorPool.query("UPDATE bookshelf_books SET created_at = CASE WHEN book_id = $1 THEN '2026-09-06T00:00:00.001Z'::timestamptz(3) ELSE '2026-09-06T00:00:00.002Z'::timestamptz(3) END", [older.bookId]);
    const server = await createApiServer({ accountPool: appPool });
    try {
      const first = await server.inject({
        method: "GET",
        url: "/v1/v7/books?limit=1",
        headers: { host: "127.0.0.1:43280", cookie: `wenmi_rebuild_session=${login.token}` }
      });
      expect(first.statusCode).toBe(200);
      expect(first.headers["cache-control"]).toBe("no-store");
      const firstBody = JSON.parse(first.body);
      expect(firstBody).toMatchObject({
        data: [{ bookId: newer.bookId, title: "新书", status: "active", version: 1, updatedAt: expect.any(String) }],
        meta: { requestId: expect.any(String), nextCursor: expect.any(String) }
      });

      const second = await server.inject({
        method: "GET",
        url: `/v1/v7/books?limit=1&cursor=${encodeURIComponent(firstBody.meta.nextCursor)}`,
        headers: { host: "127.0.0.1:43280", cookie: `wenmi_rebuild_session=${login.token}` }
      });
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body)).toMatchObject({
        data: [{ bookId: older.bookId, title: "旧书" }],
        meta: { requestId: expect.any(String), nextCursor: null }
      });
    } finally {
      await server.close();
    }
  });

  it("rejects strict query/body mistakes and unauthorized or cross-owner lifecycle operations", async () => {
    const first = await createVerifiedLogin("books-strict-a@example.com", "严格甲");
    const second = await createVerifiedLogin("books-strict-b@example.com", "严格乙");
    const book = await books.createBookFromSession(first.token, { title: "严格书", idempotencyKey: "strict" });
    const server = await createApiServer({ accountPool: appPool });
    try {
      const badQuery = await server.inject({
        method: "GET",
        url: "/v1/v7/books?status=deleted",
        headers: { host: "127.0.0.1:43280", cookie: `wenmi_rebuild_session=${first.token}` }
      });
      expect(badQuery.statusCode).toBe(400);
      expect(badQuery.headers["cache-control"]).toBe("no-store");

      const unknown = await server.inject({
        method: "POST",
        url: `/v1/v7/books/${book.bookId}/archive`,
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${first.token}`),
        payload: { expectedVersion: 1, ownerId: "evil" }
      });
      expect(unknown.statusCode).toBe(400);

      const crossOwner = await server.inject({
        method: "POST",
        url: `/v1/v7/books/${book.bookId}/archive`,
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${second.token}`),
        payload: { expectedVersion: 1 }
      });
      expect(crossOwner.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("archives, rejects stale versions, restores, and keeps no-store on encoded hook rejections", async () => {
    const login = await createVerifiedLogin("books-life-api@example.com", "生命周期接口");
    const book = await books.createBookFromSession(login.token, { title: "接口归档", idempotencyKey: "life" });
    const server = await createApiServer({ accountPool: appPool });
    try {
      const encoded = await server.inject({
        method: "POST",
        url: `/v1/%767/books/${book.bookId}/archive`,
        headers: { ...jsonWriteHeaders(`wenmi_rebuild_session=${login.token}`), origin: "http://evil.example" },
        payload: { expectedVersion: 1 }
      });
      expect(encoded.statusCode).toBe(403);
      expect(encoded.headers["cache-control"]).toBe("no-store");

      const archived = await server.inject({
        method: "POST",
        url: `/v1/v7/books/${book.bookId}/archive`,
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${login.token}`),
        payload: { expectedVersion: 1 }
      });
      expect(archived.statusCode).toBe(200);
      expect(JSON.parse(archived.body)).toMatchObject({ data: { status: "archived", version: 2 } });

      const stale = await server.inject({
        method: "POST",
        url: `/v1/v7/books/${book.bookId}/restore`,
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${login.token}`),
        payload: { expectedVersion: 1 }
      });
      expect(stale.statusCode).toBe(409);

      const restored = await server.inject({
        method: "POST",
        url: `/v1/v7/books/${book.bookId}/restore`,
        headers: jsonWriteHeaders(`wenmi_rebuild_session=${login.token}`),
        payload: { expectedVersion: 2 }
      });
      expect(restored.statusCode).toBe(200);
      expect(JSON.parse(restored.body)).toMatchObject({ data: { status: "active", version: 3 } });
    } finally {
      await server.close();
    }
  });
});

async function createVerifiedLogin(email: string, displayName: string): Promise<{ readonly token: string }> {
  const created = await accounts.createInternalUser({
    email,
    displayName,
    password: "verified password value"
  });
  await accounts.verifyEmailToken((await accounts.issueEmailVerificationToken(created.account.userId)).token);
  const login = await accounts.login({ email: created.account.email, password: "verified password value", ipAddress: "127.0.0.1" });
  return { token: login.token };
}

async function truncateAll(pool: PgPool): Promise<void> {
  await pool.query(
    "TRUNCATE manual_book_chapter_directories, manual_book_opening_sources, bookshelf_book_audit_events, bookshelf_books, account_security_audit_events, account_rate_limits, account_one_time_tokens, account_sessions, account_users RESTART IDENTITY CASCADE"
  );
}

function jsonWriteHeaders(cookie: string) {
  return {
    host: "127.0.0.1:43280",
    origin: "http://127.0.0.1:43280",
    "content-type": "application/json",
    cookie
  };
}
