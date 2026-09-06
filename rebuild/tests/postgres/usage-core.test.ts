import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountCoreService,
  createBookShelfService,
  createPostgresPool,
  createUsageCoreService,
  loadPostgresRuntimeConfig,
  runMigrations,
  withTransaction,
  type AccountCoreService,
  type BookShelfService,
  type PgPool,
  type UsageCoreService
} from "@wenmi-rebuild/backend";

let appPool: PgPool | undefined;
let migratorPool: PgPool | undefined;
let accounts: AccountCoreService | undefined;
let books: BookShelfService | undefined;
let usage: UsageCoreService | undefined;

describe("real PostgreSQL usage core", () => {
  beforeAll(async () => {
    const migratorConfig = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!migratorConfig.expectedDatabase.startsWith("wenmi_rebuild_test_")) {
      throw new Error("usage tests require a random wenmi_rebuild_test_<suffix> database");
    }
    await runMigrations({ config: migratorConfig });
    const appUrl = process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL;
    if (!appUrl) throw new Error("WENMI_REBUILD_TEST_APP_DATABASE_URL is required for usage tests");
    appPool = createPostgresPool(loadPostgresRuntimeConfig({ ...process.env, WENMI_REBUILD_DATABASE_URL: appUrl }, "app"));
    migratorPool = createPostgresPool(migratorConfig);
    accounts = createAccountCoreService(appPool, { secureCookies: false });
    books = createBookShelfService(appPool, accounts);
    usage = createUsageCoreService(appPool);
  });

  beforeEach(async () => {
    await truncateUsageData();
  });

  afterAll(async () => {
    await appPool?.end();
    await migratorPool?.end();
  });

  it("replays source grants and rejects overlapping snapshots without choosing an arbitrary latest entitlement", async () => {
    const login = await createVerifiedLogin("usage-grant-idem@example.com");
    const input = { ownerId: login.ownerId, sourceKind: "internal_test" as const, sourceId: "grant-source",
      planKey: "test", computeQuota: 2_000, periodStart: new Date(Date.now() - 1_000), periodEnd: new Date(Date.now() + 60_000) };
    const granted = await usage!.grantEntitlementSnapshot(input);
    expect((await usage!.grantEntitlementSnapshot(input)).entitlementSnapshotId).toBe(granted.entitlementSnapshotId);
    await expect(usage!.grantEntitlementSnapshot({ ...input, sourceId: "overlap", computeQuota: 4_000 }))
      .rejects.toMatchObject({ code: "USAGE_IDEMPOTENCY_CONFLICT" });
    await expect(usage!.grantEntitlementSnapshot({ ...input, computeQuota: 4_000 }))
      .rejects.toMatchObject({ code: "USAGE_IDEMPOTENCY_CONFLICT" });
  });

  it("reserves against an explicit entitlement snapshot inside the authenticated session transaction", async () => {
    const login = await createVerifiedLogin("usage-reserve@example.com");
    await grant(login.ownerId, 2_000);
    const reservation = await accounts!.withAuthenticatedSessionTransaction(login.token, async (client, session) =>
      usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
        operationKind: "prebook_opening",
        operationId: "prebook-1",
        idempotencyKey: "reserve-1",
        request: { prompt: "same" },
        reservedTokens: 600,
        provider: "test-provider",
        modelId: "test-model"
      })
    );

    expect(reservation.state).toBe("reserved");
    const totals = await withTransaction(appPool!, (client) => usage!.totalsForOwnerTransaction(client, login.ownerId));
    expect(totals).toMatchObject({ consumedCompute: 0, reservedCompute: 1_200, remainingCompute: 800 });
  });

  it("does not reserve without an entitlement snapshot and keeps the old unlinked-owner bypass out of PG", async () => {
    const login = await createVerifiedLogin("usage-no-entitlement@example.com");
    await expect(accounts!.withAuthenticatedSessionTransaction(login.token, async (client, session) =>
      usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
        operationKind: "prebook_opening",
        operationId: "prebook-none",
        idempotencyKey: "reserve-none",
        request: { prompt: "none" },
        reservedTokens: 1
      })
    )).rejects.toMatchObject({ code: "USAGE_ENTITLEMENT_REQUIRED" });
  });

  it("locks the entitlement range so concurrent reservations cannot spend the same balance twice", async () => {
    const login = await createVerifiedLogin("usage-concurrent@example.com");
    await grant(login.ownerId, 2_000);

    const attempts = await Promise.allSettled([
      reservePrebook(login.token, "race-a", 600),
      reservePrebook(login.token, "race-b", 600)
    ]);
    const fulfilled = attempts.filter((item) => item.status === "fulfilled");
    const rejected = attempts.filter((item) => item.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "USAGE_QUOTA_EXHAUSTED" });
    const totals = await withTransaction(appPool!, (client) => usage!.totalsForOwnerTransaction(client, login.ownerId));
    expect(totals.reservedCompute).toBe(1_200);
  });

  it("keeps reservation idempotency scoped and rejects same keys with different inputs", async () => {
    const first = await createVerifiedLogin("usage-idem-a@example.com");
    const second = await createVerifiedLogin("usage-idem-b@example.com");
    await grant(first.ownerId, 10_000);
    await grant(second.ownerId, 10_000);

    const one = await reservePrebook(first.token, "same", 100, { text: "a" });
    const retry = await reservePrebook(first.token, "same", 100, { text: "a" });
    expect(retry.reservationId).toBe(one.reservationId);
    await expect(reservePrebook(first.token, "same", 100, { text: "b" }))
      .rejects.toMatchObject({ code: "USAGE_IDEMPOTENCY_CONFLICT" });

    const otherOwner = await reservePrebook(second.token, "same", 100, { text: "b" });
    expect(otherOwner.ownerId).toBe(second.ownerId);
  });

  it("keeps raw-owner same-key concurrency to one reservation without a session wrapper", async () => {
    const login = await createVerifiedLogin("usage-raw-owner@example.com");
    await grant(login.ownerId, 10_000);

    const attempts = await Promise.all(Array.from({ length: 6 }, () =>
      withTransaction(appPool!, (client) => usage!.reserveForOwnerTransaction(client, login.ownerId, {
        operationKind: "prebook_opening",
        operationId: "raw-owner-prebook",
        idempotencyKey: "raw-same-key",
        request: { prompt: "raw" },
        reservedTokens: 100
      }))
    ));

    expect(new Set(attempts.map((item) => item.reservationId)).size).toBe(1);
    const rows = await migratorPool!.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM usage_reservations WHERE owner_id = $1 AND idempotency_key = 'raw-same-key'",
      [login.ownerId]
    );
    expect(rows.rows[0]).toEqual({ count: 1 });
  });

  it("keeps unknown calls reserved, allows idempotent retry to see the same record, and releases only with explicit not-started evidence", async () => {
    const login = await createVerifiedLogin("usage-unknown@example.com");
    await grant(login.ownerId, 10_000);
    const reservation = await reservePrebook(login.token, "unknown", 500);
    const unknown = await withTransaction(appPool!, (client) => usage!.markUnknownTransaction(client, {
      ownerId: login.ownerId,
      reservationId: reservation.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-unknown"
    }));
    expect(unknown.state).toBe("unknown");
    expect((await reservePrebook(login.token, "unknown", 500)).state).toBe("unknown");
    await expect(withTransaction(appPool!, (client) => usage!.releaseTransaction(client, {
      ownerId: login.ownerId,
      reservationId: reservation.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-unknown",
      confirmedNotStarted: false as true,
      evidence: "missing confirmation"
    }))).rejects.toMatchObject({ code: "USAGE_RESERVATION_STATE_INVALID" });

    const totalsWhileUnknown = await withTransaction(appPool!, (client) => usage!.totalsForOwnerTransaction(client, login.ownerId));
    expect(totalsWhileUnknown.reservedCompute).toBe(1_000);
    const released = await withTransaction(appPool!, (client) => usage!.releaseTransaction(client, {
      ownerId: login.ownerId,
      reservationId: reservation.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-unknown",
      confirmedNotStarted: true,
      evidence: "provider request id was never accepted"
    }));
    expect(released.state).toBe("released");
    const totalsAfterRelease = await withTransaction(appPool!, (client) => usage!.totalsForOwnerTransaction(client, login.ownerId));
    expect(totalsAfterRelease.reservedCompute).toBe(0);
  });

  it("settles once, refuses a different replay, and keeps original reservation replay valid after call metadata is filled", async () => {
    const login = await createVerifiedLogin("usage-settle@example.com");
    await grant(login.ownerId, 10_000);
    const reservation = await reservePrebook(login.token, "settle", 500);

    const settled = await withTransaction(appPool!, (client) => usage!.settleTransaction(client, {
      ownerId: login.ownerId,
      reservationId: reservation.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-settle",
      inputTokens: 120,
      outputTokens: 130,
      provider: "provider-a",
      modelId: "model-a",
      externalCallId: "call-a"
    }));
    expect(settled.state).toBe("succeeded");
    expect(await withTransaction(appPool!, (client) => usage!.settleTransaction(client, {
      ownerId: login.ownerId,
      reservationId: reservation.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-settle",
      inputTokens: 120,
      outputTokens: 130,
      provider: "provider-a",
      modelId: "model-a",
      externalCallId: "call-a"
    }))).toMatchObject({ state: "succeeded" });
    await expect(withTransaction(appPool!, (client) => usage!.settleTransaction(client, {
      ownerId: login.ownerId,
      reservationId: reservation.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-settle",
      inputTokens: 200,
      outputTokens: 130
    }))).rejects.toMatchObject({ code: "USAGE_IDEMPOTENCY_CONFLICT" });
    expect(await reservePrebook(login.token, "settle", 500)).toMatchObject({
      reservationId: reservation.reservationId,
      state: "succeeded"
    });
  });

  it("keeps over-reserved actual usage under review and rejects later lower settlement or release", async () => {
    const login = await createVerifiedLogin("usage-review@example.com");
    await grant(login.ownerId, 10_000);
    const review = await reservePrebook(login.token, "review", 100);
    const reviewed = await withTransaction(appPool!, (client) => usage!.settleTransaction(client, {
      ownerId: login.ownerId,
      reservationId: review.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-review",
      inputTokens: 101,
      outputTokens: 1,
      provider: "provider-review",
      modelId: "model-review",
      externalCallId: "call-review"
    }));
    expect(reviewed.state).toBe("unknown");
    const rows = await appPool!.query("SELECT state FROM usage_reservations WHERE reservation_id = $1", [review.reservationId]);
    expect(rows.rows[0]).toMatchObject({ state: "unknown" });
    const reviewEvents = await appPool!.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM usage_reservation_events WHERE reservation_id = $1 AND event_type = 'usage.settlement_requires_review'",
      [review.reservationId]
    );
    expect(reviewEvents.rows[0]).toEqual({ count: 1 });

    expect(await withTransaction(appPool!, (client) => usage!.settleTransaction(client, {
      ownerId: login.ownerId,
      reservationId: review.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-review",
      inputTokens: 101,
      outputTokens: 1,
      provider: "provider-review",
      modelId: "model-review",
      externalCallId: "call-review"
    }))).toMatchObject({ state: "unknown" });
    const replayEvents = await appPool!.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM usage_reservation_events WHERE reservation_id = $1 AND event_type = 'usage.settlement_requires_review'",
      [review.reservationId]
    );
    expect(replayEvents.rows[0]).toEqual({ count: 1 });

    await expect(withTransaction(appPool!, (client) => usage!.settleTransaction(client, {
      ownerId: login.ownerId,
      reservationId: review.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-review",
      inputTokens: 10,
      outputTokens: 10,
      provider: "provider-review",
      modelId: "model-review",
      externalCallId: "call-review"
    }))).rejects.toMatchObject({ code: "USAGE_SETTLEMENT_REQUIRES_REVIEW" });
    await expect(withTransaction(appPool!, (client) => usage!.releaseTransaction(client, {
      ownerId: login.ownerId,
      reservationId: review.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-review",
      confirmedNotStarted: true,
      evidence: "cannot release because actual usage was received"
    }))).rejects.toMatchObject({ code: "USAGE_SETTLEMENT_REQUIRES_REVIEW" });
  });

  it("checks known book ownership before reserving and keeps prebook reservations bookless", async () => {
    const first = await createVerifiedLogin("usage-book-a@example.com");
    const second = await createVerifiedLogin("usage-book-b@example.com");
    await grant(first.ownerId, 10_000);
    await grant(second.ownerId, 10_000);
    const book = await books!.createBookFromSession(first.token, { title: "用量书", idempotencyKey: "book" });

    const prebook = await reservePrebook(first.token, "bookless", 100);
    expect(prebook.bookId).toBeNull();
    await expect(accounts!.withAuthenticatedSessionTransaction(first.token, async (client, session) =>
      usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
        operationKind: "prebook_opening",
        operationId: "prebook-with-book",
        bookId: book.bookId,
        idempotencyKey: "prebook-with-book",
        request: { workflow: "x" },
        reservedTokens: 100
      })
    )).rejects.toMatchObject({ code: "USAGE_RESERVATION_STATE_INVALID" });
    await expect(accounts!.withAuthenticatedSessionTransaction(first.token, async (client, session) =>
      usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
        operationKind: "book_workflow",
        operationId: "workflow-without-book",
        idempotencyKey: "workflow-without-book",
        request: { workflow: "x" },
        reservedTokens: 100
      })
    )).rejects.toMatchObject({ code: "BOOK_NOT_FOUND" });
    await expect(accounts!.withAuthenticatedSessionTransaction(second.token, async (client, session) =>
      usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
        operationKind: "book_workflow",
        operationId: "workflow-1",
        bookId: book.bookId,
        idempotencyKey: "wrong-owner",
        request: { workflow: "x" },
        reservedTokens: 100
      })
    )).rejects.toMatchObject({ code: "BOOK_NOT_FOUND" });
  });

  it("allows same-provider call id only once while different providers may use the same call id", async () => {
    const login = await createVerifiedLogin("usage-call-id@example.com");
    await grant(login.ownerId, 20_000);

    await reservePrebookWithCall(login.token, "call-a", "provider-a", "shared-call");
    await expect(reservePrebookWithCall(login.token, "call-b", "provider-a", "shared-call"))
      .rejects.toMatchObject({ code: "23505" });
    const differentProvider = await reservePrebookWithCall(login.token, "call-c", "provider-b", "shared-call");
    expect(differentProvider.provider).toBe("provider-b");
  });

  it("replays and settles an existing reservation after the entitlement period expires", async () => {
    const login = await createVerifiedLogin("usage-expired-replay@example.com");
    await grant(login.ownerId, 10_000);
    const reservation = await reservePrebook(login.token, "expire-replay", 200);
    await expireEntitlementsForOwner(login.ownerId);

    expect(await reservePrebook(login.token, "expire-replay", 200)).toMatchObject({
      reservationId: reservation.reservationId,
      state: "reserved"
    });
    const settled = await withTransaction(appPool!, (client) => usage!.settleTransaction(client, {
      ownerId: login.ownerId,
      reservationId: reservation.reservationId,
      operationKind: "prebook_opening",
      operationId: "prebook-expire-replay",
      inputTokens: 50,
      outputTokens: 50
    }));
    expect(settled.state).toBe("succeeded");
    await expect(reservePrebook(login.token, "new-after-expire", 100))
      .rejects.toMatchObject({ code: "USAGE_ENTITLEMENT_REQUIRED" });
  });

  it("rejects suspended owners, revoked sessions, unsafe integers, invalid JSON, and immutable usage table writes", async () => {
    const login = await createVerifiedLogin("usage-invalid@example.com");
    await grant(login.ownerId, 10_000);
    await accounts!.logout(login.token);
    await expect(accounts!.withAuthenticatedSessionTransaction(login.token, async (client, session) =>
      usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
        operationKind: "prebook_opening",
        operationId: "revoked-session",
        idempotencyKey: "revoked-session",
        request: { prompt: "x" },
        reservedTokens: 100
      })
    )).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    const suspended = await createVerifiedLogin("usage-suspended@example.com");
    await grant(suspended.ownerId, 10_000);
    await migratorPool!.query("UPDATE account_users SET status = 'suspended' WHERE owner_id = $1", [suspended.ownerId]);
    await expect(withTransaction(appPool!, (client) => usage!.reserveForOwnerTransaction(client, suspended.ownerId, {
      operationKind: "prebook_opening",
      operationId: "suspended",
      idempotencyKey: "suspended",
      request: { prompt: "x" },
      reservedTokens: 100
    }))).rejects.toMatchObject({ code: "USAGE_ENTITLEMENT_REQUIRED" });

    const valid = await createVerifiedLogin("usage-invalid-json@example.com");
    await grant(valid.ownerId, Number.MAX_SAFE_INTEGER);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(reservePrebook(valid.token, "cyclic", 100, cyclic))
      .rejects.toMatchObject({ code: "USAGE_RESERVATION_STATE_INVALID" });
    await expect(reservePrebook(valid.token, "nan", 100, { value: Number.NaN }))
      .rejects.toMatchObject({ code: "USAGE_RESERVATION_STATE_INVALID" });
    await expect(reservePrebook(valid.token, "unsafe", Number.MAX_SAFE_INTEGER))
      .rejects.toMatchObject({ code: "USAGE_RESERVATION_STATE_INVALID" });

    const snapshot = await appPool!.query<{ entitlement_snapshot_id: string }>(
      "SELECT entitlement_snapshot_id FROM usage_entitlement_snapshots WHERE owner_id = $1 LIMIT 1",
      [valid.ownerId]
    );
    await expect(appPool!.query("UPDATE usage_entitlement_snapshots SET plan_key = 'mutated' WHERE entitlement_snapshot_id = $1", [snapshot.rows[0]!.entitlement_snapshot_id]))
      .rejects.toMatchObject({ code: "42501" });
    const reservation = await reservePrebook(valid.token, "immutable-event", 100);
    await expect(appPool!.query("UPDATE usage_reservation_events SET event_type = 'mutated' WHERE reservation_id = $1", [reservation.reservationId]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("rolls back usage reservation when a later operation in the caller transaction fails", async () => {
    const login = await createVerifiedLogin("usage-caller-rollback@example.com");
    await grant(login.ownerId, 10_000);
    await expect(accounts!.withAuthenticatedSessionTransaction(login.token, async (client, session) => {
      await usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
        operationKind: "prebook_opening",
        operationId: "caller-rollback",
        idempotencyKey: "caller-rollback",
        request: { prompt: "x" },
        reservedTokens: 100
      });
      await client.query(
        `INSERT INTO bookshelf_book_audit_events (audit_id, book_id, owner_id, actor_user_id, event_type, result, detail)
         VALUES ($1, NULL, $2, $3, 'forced_failure', 'failed', $4::jsonb)`,
        [randomUUID(), session.account.ownerId, session.account.userId, JSON.stringify({ password: "should fail" })]
      );
    })).rejects.toMatchObject({ code: "23514" });

    const rows = await migratorPool!.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM usage_reservations WHERE idempotency_key = 'caller-rollback'"
    );
    expect(rows.rows[0]).toEqual({ count: 0 });
  });

  it("rolls back reservation writes when the append-only usage event fails", async () => {
    const login = await createVerifiedLogin("usage-rollback@example.com");
    await grant(login.ownerId, 10_000);
    await migratorPool!.query(`
      CREATE OR REPLACE FUNCTION usage_event_failure_for_test()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced usage event failure';
      END;
      $$;
    `);
    await migratorPool!.query(`
      CREATE TRIGGER usage_event_failure_for_test
      BEFORE INSERT ON usage_reservation_events
      FOR EACH ROW EXECUTE FUNCTION usage_event_failure_for_test()
    `);
    try {
      await expect(reservePrebook(login.token, "rollback", 100)).rejects.toThrow(/forced usage event failure/);
      const rows = await migratorPool!.query("SELECT count(*)::int AS count FROM usage_reservations WHERE idempotency_key = 'rollback'");
      expect(rows.rows[0]).toEqual({ count: 0 });
    } finally {
      await dropUsageEventFailureTrigger();
    }
  });
});

async function createVerifiedLogin(email: string): Promise<{ readonly token: string; readonly userId: string; readonly ownerId: string }> {
  const created = await accounts!.createInternalUser({ email, displayName: "用量作者", password: "usage test password" });
  const issued = await accounts!.issueEmailVerificationToken(created.account.userId);
  await accounts!.verifyEmailToken(issued.token);
  const login = await accounts!.login({ email, password: "usage test password", ipAddress: "127.0.0.1" });
  const row = await appPool!.query<{ owner_id: string }>("SELECT owner_id FROM account_users WHERE user_id = $1", [created.account.userId]);
  return { token: login.token, userId: created.account.userId, ownerId: row.rows[0]!.owner_id };
}

async function grant(ownerId: string, computeQuota: number): Promise<void> {
  await usage!.grantEntitlementSnapshot({
    ownerId,
    sourceKind: "internal_test",
    sourceId: `grant-${ownerId}-${computeQuota}`,
    planKey: "test-plan",
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2099-01-01T00:00:00.000Z"),
    computeQuota
  });
}

async function reservePrebook(token: string, key: string, reservedTokens: number, request: unknown = { text: key }) {
  return accounts!.withAuthenticatedSessionTransaction(token, async (client, session) =>
    usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
      operationKind: "prebook_opening",
      operationId: `prebook-${key}`,
      idempotencyKey: key,
      request,
      reservedTokens
    })
  );
}

async function reservePrebookWithCall(token: string, key: string, provider: string, externalCallId: string) {
  return accounts!.withAuthenticatedSessionTransaction(token, async (client, session) =>
    usage!.reserveFromAuthenticatedSessionTransaction(client, session, {
      operationKind: "prebook_opening",
      operationId: `prebook-${key}`,
      idempotencyKey: key,
      request: { text: key },
      reservedTokens: 100,
      provider,
      modelId: "model-call",
      externalCallId
    })
  );
}

async function expireEntitlementsForOwner(ownerId: string): Promise<void> {
  await migratorPool!.query("ALTER TABLE usage_entitlement_snapshots DISABLE TRIGGER usage_entitlement_snapshots_no_update");
  try {
    await migratorPool!.query(
      "UPDATE usage_entitlement_snapshots SET period_end = '2026-01-02T00:00:00.000Z' WHERE owner_id = $1",
      [ownerId]
    );
  } finally {
    await migratorPool!.query("ALTER TABLE usage_entitlement_snapshots ENABLE TRIGGER usage_entitlement_snapshots_no_update");
  }
}

async function truncateUsageData(): Promise<void> {
  await dropUsageEventFailureTrigger();
  await migratorPool!.query(
    "TRUNCATE usage_reservation_events, usage_reservations, usage_entitlement_snapshots, book_profile_versions, manual_book_chapter_directories, manual_book_opening_sources, bookshelf_book_audit_events, bookshelf_books, account_security_audit_events, account_rate_limits, account_one_time_tokens, account_sessions, account_users RESTART IDENTITY CASCADE"
  );
}

async function dropUsageEventFailureTrigger(): Promise<void> {
  if (!migratorPool) return;
  await migratorPool.query("DROP TRIGGER IF EXISTS usage_event_failure_for_test ON usage_reservation_events");
  await migratorPool.query("DROP FUNCTION IF EXISTS usage_event_failure_for_test()");
}
