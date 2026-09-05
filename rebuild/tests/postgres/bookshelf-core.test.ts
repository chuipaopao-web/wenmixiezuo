import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountCoreService,
  createBookShelfService,
  createPostgresPool,
  loadPostgresRuntimeConfig,
  PostgresBookshelfRepository,
  runMigrations,
  type AccountCoreService,
  type BookShelfService,
  type PgPool
} from "@wenmi-rebuild/backend";

let appPool: PgPool;
let migratorPool: PgPool;
let accounts: AccountCoreService;
let books: BookShelfService;

describe("real PostgreSQL bookshelf core", () => {
  beforeAll(async () => {
    const migratorConfig = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!migratorConfig.expectedDatabase.startsWith("wenmi_rebuild_test_")) {
      throw new Error("bookshelf core tests require a random wenmi_rebuild_test_<suffix> database");
    }
    await runMigrations({ config: migratorConfig });
    migratorPool = createPostgresPool(migratorConfig);
    const appUrl = process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL;
    if (!appUrl) throw new Error("WENMI_REBUILD_TEST_APP_DATABASE_URL is required");
    const appConfig = loadPostgresRuntimeConfig({ ...process.env, WENMI_REBUILD_DATABASE_URL: appUrl }, "app");
    appPool = createPostgresPool(appConfig);
    accounts = createAccountCoreService(appPool, { secureCookies: false });
    books = createBookShelfService(appPool, accounts);
  });

  beforeEach(async () => {
    await truncateAll(migratorPool);
  });

  afterAll(async () => {
    await appPool?.end();
    await migratorPool?.end();
  });

  it("creates only metadata through the internal service and keeps idempotency scoped to the owner", async () => {
    const first = await createVerifiedLogin("create-a@example.com", "作者甲");
    const second = await createVerifiedLogin("create-b@example.com", "作者乙");

    const created = await books.createBookFromSession(first.token, { title: "  第一部书  ", idempotencyKey: "manual-1" });
    expect(created).toMatchObject({ title: "第一部书", status: "active", version: 1 });
    expect(created).not.toHaveProperty("nextView");

    await expect(books.createBookFromSession(first.token, { title: "第一部书", idempotencyKey: "manual-1" }))
      .resolves.toEqual(created);
    await expect(books.createBookFromSession(first.token, { title: "另一本", idempotencyKey: "manual-1" }))
      .rejects.toMatchObject({ code: "BOOK_IDEMPOTENCY_CONFLICT" });

    const otherOwner = await books.createBookFromSession(second.token, { title: "第一部书", idempotencyKey: "manual-1" });
    expect(otherOwner.bookId).not.toBe(created.bookId);
    await expect(books.listBooks(first.token, {})).resolves.toMatchObject({ books: [created], nextCursor: null });
    await expect(books.listBooks(second.token, {})).resolves.toMatchObject({ books: [otherOwner], nextCursor: null });
  });

  it("allows only one concurrent create for the same idempotency key and input", async () => {
    const login = await createVerifiedLogin("concurrent-create@example.com", "并发作者");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () =>
      books.createBookFromSession(login.token, { title: "同一本书", idempotencyKey: "same-create" })
    ));
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const ids = new Set(results.map((result) => result.status === "fulfilled" ? result.value.bookId : ""));
    expect(ids.size).toBe(1);
    const stored = await appPool.query<{ count: string }>("SELECT count(*) FROM bookshelf_books");
    expect(Number(stored.rows[0]!.count)).toBe(1);
  });

  it("lists by owner with stable keyset pagination, literal search, and cursor binding", async () => {
    const first = await createVerifiedLogin("list-a@example.com", "列表甲");
    const second = await createVerifiedLogin("list-b@example.com", "列表乙");
    const firstBooks = await Promise.all([
      books.createBookFromSession(first.token, { title: "100%_真书", idempotencyKey: "b1" }),
      books.createBookFromSession(first.token, { title: "100xy真书", idempotencyKey: "b2" }),
      books.createBookFromSession(first.token, { title: "边城旧梦", idempotencyKey: "b3" }),
      books.createBookFromSession(first.token, { title: "边城新梦", idempotencyKey: "b4" })
    ]);
    await books.createBookFromSession(second.token, { title: "别人书架", idempotencyKey: "other" });
    await migratorPool.query("UPDATE bookshelf_books SET created_at = '2026-09-06T12:00:00.123Z'::timestamptz(3), updated_at = '2026-09-06T12:00:00.123Z'::timestamptz(3)");

    const literal = await books.listBooks(first.token, { q: "%_", limit: 10 });
    expect(literal.books.map((book) => book.title)).toEqual(["100%_真书"]);

    const firstPage = await books.listBooks(first.token, { limit: 2 });
    expect(firstPage.books).toHaveLength(2);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await books.listBooks(first.token, { limit: 2, cursor: firstPage.nextCursor! });
    expect(secondPage.books).toHaveLength(2);
    const pagedIds = [...firstPage.books, ...secondPage.books].map((book) => book.bookId);
    expect(new Set(pagedIds)).toEqual(new Set(firstBooks.map((book) => book.bookId)));

    await expect(books.listBooks(second.token, { limit: 2, cursor: firstPage.nextCursor! }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.listBooks(first.token, { status: "active", q: "边城", limit: 1, cursor: firstPage.nextCursor! }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.listBooks(first.token, { cursor: Buffer.from(JSON.stringify({
      v: 1,
      ownerId: first.ownerId,
      status: "all",
      q: null,
      createdAt: "2026-02-31",
      bookId: firstBooks[0]!.bookId
    }), "utf8").toString("base64url") }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.listBooks(first.token, { cursor: Buffer.from(JSON.stringify({
      v: 1,
      ownerId: first.ownerId,
      status: "all",
      q: null,
      createdAt: "0000-01-01T00:00:00.000Z",
      bookId: firstBooks[0]!.bookId
    }), "utf8").toString("base64url") }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.listBooks(first.token, { cursor: Buffer.from(JSON.stringify({
      v: 1,
      ownerId: first.ownerId,
      status: "all",
      q: null,
      createdAt: "+010000-01-01T00:00:00.000Z",
      bookId: firstBooks[0]!.bookId
    }), "utf8").toString("base64url") }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.listBooks(first.token, { cursor: "not+base64url" }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.listBooks(first.token, { q: "abc\u0000def" }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
  });

  it("rejects nul characters before PostgreSQL sees text inputs", async () => {
    const login = await createVerifiedLogin("nul@example.com", "零字节作者");
    await expect(books.createBookFromSession(login.token, { title: "坏\u0000书", idempotencyKey: "nul-title" }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.createBookFromSession(login.token, { title: "正常书", idempotencyKey: "bad\u0000key" }))
      .rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
  });

  it("archives and restores with optimistic versions, no-op semantics, and owner isolation", async () => {
    const first = await createVerifiedLogin("life-a@example.com", "生命周期甲");
    const second = await createVerifiedLogin("life-b@example.com", "生命周期乙");
    const book = await books.createBookFromSession(first.token, { title: "归档书", idempotencyKey: "life" });

    await expect(books.archiveBook(second.token, book.bookId, { expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "BOOK_NOT_FOUND" });
    const archived = await books.archiveBook(first.token, book.bookId, { expectedVersion: 1 });
    expect(archived).toMatchObject({ status: "archived", version: 2 });
    await expect(books.archiveBook(first.token, book.bookId, { expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "BOOK_VERSION_CONFLICT" });
    await expect(books.archiveBook(first.token, book.bookId, { expectedVersion: 2 }))
      .resolves.toEqual(archived);
    const restored = await books.restoreBook(first.token, book.bookId, { expectedVersion: 2 });
    expect(restored).toMatchObject({ status: "active", version: 3 });

    const audits = await migratorPool.query<{ event_type: string; result: string }>(
      "SELECT event_type, result FROM bookshelf_book_audit_events WHERE book_id = $1 ORDER BY occurred_at, event_type",
      [book.bookId]
    );
    expect(audits.rows).toEqual([
      { event_type: "book_created", result: "succeeded" },
      { event_type: "book_archived", result: "succeeded" },
      { event_type: "book_archived", result: "rejected" },
      { event_type: "book_restored", result: "succeeded" }
    ]);
  });

  it("allows one winner for concurrent lifecycle writes with the same expected version", async () => {
    const login = await createVerifiedLogin("concurrent-life@example.com", "并发生命周期");
    const book = await books.createBookFromSession(login.token, { title: "抢锁书", idempotencyKey: "race" });
    const results = await Promise.allSettled([
      books.archiveBook(login.token, book.bookId, { expectedVersion: 1 }),
      books.archiveBook(login.token, book.bookId, { expectedVersion: 1 })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = await books.listBooks(login.token, { status: "archived" });
    expect(stored.books).toHaveLength(1);
    expect(stored.books[0]).toMatchObject({ version: 2 });
  });

  it("rejects writes after session revocation, credential change, or account suspension", async () => {
    const first = await createVerifiedLogin("invalid-session@example.com", "失效作者");
    const second = await accounts.login({ email: "invalid-session@example.com", password: "verified password value", ipAddress: "127.0.0.1" });
    const book = await books.createBookFromSession(first.token, { title: "会话测试", idempotencyKey: "session-book" });

    await accounts.revokeOtherSessions(first.token);
    await expect(books.archiveBook(second.token, book.bookId, { expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    await accounts.changePassword({
      sessionToken: first.token,
      currentPassword: "verified password value",
      nextPassword: "changed password value",
      ipAddress: "127.0.0.1"
    });
    await expect(books.archiveBook(first.token, book.bookId, { expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    const fresh = await accounts.login({ email: "invalid-session@example.com", password: "changed password value", ipAddress: "127.0.0.1" });
    await migratorPool.query("UPDATE account_users SET status = 'suspended' WHERE email_normalized = 'invalid-session@example.com'");
    await expect(books.archiveBook(fresh.token, book.bookId, { expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("rolls back book writes when append-only audit insertion fails and denies app audit updates", async () => {
    const login = await createVerifiedLogin("audit-book@example.com", "审计作者");
    const book = await books.createBookFromSession(login.token, { title: "审计书", idempotencyKey: "audit-book" });
    const repository = new PostgresBookshelfRepository(appPool);
    await expect(repository.withTransaction(async (client) => {
      await repository.updateBookStatus(client, login.ownerId, book.bookId, "archived");
      await repository.recordAudit(client, {
        auditId: randomUUID(),
        bookId: book.bookId,
        ownerId: login.ownerId,
        actorUserId: login.userId,
        eventType: "book_archived",
        result: "succeeded",
        detail: { token: "blocked" }
      });
    })).rejects.toBeTruthy();
    const stored = await books.listBooks(login.token, {});
    expect(stored.books[0]).toMatchObject({ status: "active", version: 1 });

    await expect(appPool.query("UPDATE bookshelf_book_audit_events SET result = 'failed' WHERE book_id = $1", [book.bookId]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(appPool.query("DELETE FROM bookshelf_book_audit_events WHERE book_id = $1", [book.bookId]))
      .rejects.toMatchObject({ code: "42501" });
  });
});

async function createVerifiedLogin(email: string, displayName: string): Promise<{ readonly token: string; readonly userId: string; readonly ownerId: string }> {
  const created = await accounts.createInternalUser({
    email,
    displayName,
    password: "verified password value"
  });
  await accounts.verifyEmailToken((await accounts.issueEmailVerificationToken(created.account.userId)).token);
  const login = await accounts.login({ email: created.account.email, password: "verified password value", ipAddress: "127.0.0.1" });
  const context = await accounts.authenticateToken(login.token, false);
  if (context === null) throw new Error("expected login context");
  return { token: login.token, userId: context.userId, ownerId: context.ownerId };
}

async function truncateAll(pool: PgPool): Promise<void> {
  await pool.query(
    "TRUNCATE bookshelf_book_audit_events, bookshelf_books, account_security_audit_events, account_rate_limits, account_one_time_tokens, account_sessions, account_users RESTART IDENTITY CASCADE"
  );
}
