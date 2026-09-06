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

  it("creates and reads a manual book source while preserving raw form strings", async () => {
    const login = await createVerifiedLogin("manual-create@example.com", "手动作者");
    const openingPackage = minimalManualPackage({
      title: "  双城旧梦  ",
      possibleEnding: { direction: "", price: "  代价\n保留空格  ", openness: "" }
    });
    const created = await books.createManualBookFromSession(login.token, {
      openingIdea: "  一个带空格和换行的想法\n第二行  ",
      openingPackage,
      idempotencyKey: "manual-raw"
    });

    expect(created.book).toMatchObject({ title: "双城旧梦", status: "active", version: 1 });
    expect(created.source).toMatchObject({
      sourceVersion: 1,
      sourceType: "manual_opening_package",
      openingIdea: "  一个带空格和换行的想法\n第二行  "
    });
    expect(created.source.openingPackage).toEqual(openingPackage);
    expect(created.chapterDirectory).toMatchObject({ directoryVersion: 1, entryCount: 0 });

    await expect(books.readManualBookFromSession(login.token, created.book.bookId)).resolves.toEqual(created);
    const rows = await migratorPool.query<{ sources: string; directories: string; books: string }>(
      `SELECT
         (SELECT count(*) FROM manual_book_opening_sources) AS sources,
         (SELECT count(*) FROM manual_book_chapter_directories) AS directories,
         (SELECT count(*) FROM bookshelf_books) AS books`
    );
    expect(rows.rows[0]).toEqual({ sources: "1", directories: "1", books: "1" });
  });

  it("keeps idempotency on complete manual input, ignores object key order, and treats array or text changes as conflict", async () => {
    const login = await createVerifiedLogin("manual-idempotency@example.com", "幂等作者");
    const openingPackage = minimalManualPackage({ mustFollow: ["不写后宫", "保留成长线"] });
    const created = await books.createManualBookFromSession(login.token, {
      openingIdea: "原始想法",
      openingPackage,
      idempotencyKey: "manual-same"
    });
    const reorderedPackage = {
      possibleEnding: openingPackage.possibleEnding,
      longTermDirection: openingPackage.longTermDirection,
      opening: openingPackage.opening,
      protagonists: openingPackage.protagonists,
      backgrounds: openingPackage.backgrounds,
      positioning: {
        tags: openingPackage.positioning.tags,
        genres: openingPackage.positioning.genres,
        category: openingPackage.positioning.category,
        channel: openingPackage.positioning.channel,
        publishingPlatform: openingPackage.positioning.publishingPlatform,
        coreAppeal: openingPackage.positioning.coreAppeal,
        expectedTotalWords: openingPackage.positioning.expectedTotalWords
      },
      title: openingPackage.title,
      mustFollow: openingPackage.mustFollow,
      authorNotes: openingPackage.authorNotes
    };
    await expect(books.createManualBookFromSession(login.token, {
      openingPackage: reorderedPackage,
      openingIdea: "原始想法",
      idempotencyKey: "manual-same"
    })).resolves.toEqual(created);

    await expect(books.createManualBookFromSession(login.token, {
      openingPackage: { ...openingPackage, mustFollow: [...openingPackage.mustFollow!].reverse() },
      openingIdea: "原始想法",
      idempotencyKey: "manual-same"
    })).rejects.toMatchObject({ code: "BOOK_IDEMPOTENCY_CONFLICT" });
    await expect(books.createManualBookFromSession(login.token, {
      openingPackage,
      openingIdea: "原始想法改动",
      idempotencyKey: "manual-same"
    })).rejects.toMatchObject({ code: "BOOK_IDEMPOTENCY_CONFLICT" });

    const second = await books.createManualBookFromSession(login.token, {
      openingPackage,
      openingIdea: "原始想法",
      idempotencyKey: "manual-same-content-new-key"
    });
    expect(second.book.bookId).not.toBe(created.book.bookId);
  });

  it("does not treat an earlier metadata-only idempotency key as a completed manual book", async () => {
    const login = await createVerifiedLogin("manual-metadata@example.com", "元数据作者");
    await books.createBookFromSession(login.token, { title: "元数据书", idempotencyKey: "metadata-key" });
    await expect(books.createManualBookFromSession(login.token, {
      openingPackage: minimalManualPackage({ title: "元数据书" }),
      idempotencyKey: "metadata-key"
    })).rejects.toMatchObject({ code: "BOOK_IDEMPOTENCY_CONFLICT" });
  });

  it("rejects invalid manual package fields without replacing unsafe text", async () => {
    const login = await createVerifiedLogin("manual-invalid@example.com", "非法作者");
    await expect(books.createManualBookFromSession(login.token, {
      openingPackage: { ...minimalManualPackage(), ownerId: login.ownerId },
      idempotencyKey: "bad-top"
    } as never)).rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.createManualBookFromSession(login.token, {
      openingPackage: minimalManualPackage({ title: "坏\u0000书" }),
      idempotencyKey: "bad-nul"
    })).rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
    await expect(books.createManualBookFromSession(login.token, {
      openingPackage: minimalManualPackage({ backgrounds: { eraAndWorld: "孤立\ud800", openingSituation: "" } }),
      idempotencyKey: "bad-surrogate"
    })).rejects.toMatchObject({ code: "BOOK_INPUT_INVALID" });
  });

  it("hides manual sources across owners and from metadata-only books", async () => {
    const first = await createVerifiedLogin("manual-owner-a@example.com", "手动甲");
    const second = await createVerifiedLogin("manual-owner-b@example.com", "手动乙");
    const manual = await books.createManualBookFromSession(first.token, {
      openingPackage: minimalManualPackage(),
      idempotencyKey: "manual-owner"
    });
    await expect(books.readManualBookFromSession(second.token, manual.book.bookId))
      .rejects.toMatchObject({ code: "BOOK_NOT_FOUND" });

    const metadataOnly = await books.createBookFromSession(first.token, { title: "只有元数据", idempotencyKey: "metadata-only" });
    await expect(books.readManualBookFromSession(first.token, metadataOnly.bookId))
      .rejects.toMatchObject({ code: "BOOK_NOT_FOUND" });
  });

  it("rejects manual reads and creates after session revocation, password change, or suspension", async () => {
    const first = await createVerifiedLogin("manual-session@example.com", "手动失效");
    const second = await accounts.login({ email: "manual-session@example.com", password: "verified password value", ipAddress: "127.0.0.1" });
    const manual = await books.createManualBookFromSession(first.token, {
      openingPackage: minimalManualPackage(),
      idempotencyKey: "manual-session"
    });

    await accounts.revokeOtherSessions(first.token);
    await expect(books.readManualBookFromSession(second.token, manual.book.bookId))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    await accounts.changePassword({
      sessionToken: first.token,
      currentPassword: "verified password value",
      nextPassword: "changed password value",
      ipAddress: "127.0.0.1"
    });
    await expect(books.createManualBookFromSession(first.token, {
      openingPackage: minimalManualPackage({ title: "失效创建" }),
      idempotencyKey: "after-password"
    })).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    const fresh = await accounts.login({ email: "manual-session@example.com", password: "changed password value", ipAddress: "127.0.0.1" });
    await migratorPool.query("UPDATE account_users SET status = 'suspended' WHERE email_normalized = 'manual-session@example.com'");
    await expect(books.readManualBookFromSession(fresh.token, manual.book.bookId))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("does not restore an archived manual book on idempotent retry", async () => {
    const login = await createVerifiedLogin("manual-archive@example.com", "归档手动");
    const input = { openingPackage: minimalManualPackage({ title: "归档后重试" }), idempotencyKey: "archive-retry" };
    const created = await books.createManualBookFromSession(login.token, input);
    await books.archiveBook(login.token, created.book.bookId, { expectedVersion: 1 });
    const retry = await books.createManualBookFromSession(login.token, input);
    expect(retry.book).toMatchObject({ bookId: created.book.bookId, status: "archived", version: 2 });
  });

  it("rolls back manual source and directory creation when audit insertion fails and keeps sources immutable for the app role", async () => {
    const login = await createVerifiedLogin("manual-audit@example.com", "手动审计");
    const repository = new PostgresBookshelfRepository(appPool);
    await expect(accounts.withAuthenticatedSessionTransaction(login.token, async (client, session) => {
      const book = await repository.insertBook(client, {
        bookId: randomUUID(),
        ownerId: session.account.ownerId,
        title: "审计失败书",
        idempotencyKey: "audit-fail",
        idempotencyInputHash: "a".repeat(64)
      });
      await repository.insertManualOpeningSource(client, {
        sourceId: randomUUID(),
        ownerId: session.account.ownerId,
        bookId: book.bookId,
        openingIdea: null,
        openingPackage: minimalManualPackage({ title: "审计失败书" }),
        inputHash: "a".repeat(64)
      });
      await repository.insertManualChapterDirectory(client, {
        directoryId: randomUUID(),
        ownerId: session.account.ownerId,
        bookId: book.bookId
      });
      await repository.recordAudit(client, {
        auditId: randomUUID(),
        bookId: book.bookId,
        ownerId: session.account.ownerId,
        actorUserId: session.account.userId,
        eventType: "manual_book_created",
        result: "succeeded",
        detail: { secret: "blocked" }
      });
    })).rejects.toBeTruthy();
    const counts = await migratorPool.query<{ books: string; sources: string; directories: string }>(
      `SELECT
         (SELECT count(*) FROM bookshelf_books WHERE idempotency_key = 'audit-fail') AS books,
         (SELECT count(*) FROM manual_book_opening_sources WHERE input_hash = $1) AS sources,
         (SELECT count(*) FROM manual_book_chapter_directories d JOIN bookshelf_books b ON b.book_id = d.book_id WHERE b.idempotency_key = 'audit-fail') AS directories`,
      ["a".repeat(64)]
    );
    expect(counts.rows[0]).toEqual({ books: "0", sources: "0", directories: "0" });

    const created = await books.createManualBookFromSession(login.token, {
      openingPackage: minimalManualPackage({ title: "不可变来源" }),
      idempotencyKey: "immutable-source"
    });
    await expect(appPool.query("UPDATE manual_book_opening_sources SET opening_idea = 'changed' WHERE book_id = $1", [created.book.bookId]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(appPool.query("DELETE FROM manual_book_opening_sources WHERE book_id = $1", [created.book.bookId]))
      .rejects.toMatchObject({ code: "42501" });
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
    "TRUNCATE manual_book_chapter_directories, manual_book_opening_sources, bookshelf_book_audit_events, bookshelf_books, account_security_audit_events, account_rate_limits, account_one_time_tokens, account_sessions, account_users RESTART IDENTITY CASCADE"
  );
}

function minimalManualPackage(overrides: Record<string, unknown> = {}) {
  return {
    title: "汉末小卒",
    positioning: {
      publishingPlatform: "fanqie",
      channel: "male",
      category: "历史",
      genres: ["历史古代"],
      tags: [],
      coreAppeal: "",
      expectedTotalWords: 100_000
    },
    backgrounds: { eraAndWorld: "", openingSituation: "" },
    protagonists: [{
      name: "刘成",
      age: "十八",
      identity: "",
      background: "边军小卒",
      familyBackground: "",
      careerBackground: "",
      goldenFinger: "",
      visualIdentity: { appearance: "", build: "", signatureFeature: "" },
      goal: "",
      dilemma: "",
      personality: ["谨慎"],
      boundary: ""
    }],
    opening: { startingSituation: "", incitingIncident: "", immediateConflict: "", readerPromise: "" },
    longTermDirection: { centralConflict: "", progression: "", relationshipDirection: "", storyPotential: "" },
    possibleEnding: { direction: "", price: "", openness: "" },
    authorNotes: [],
    mustFollow: ["不写后宫"],
    ...overrides
  };
}
