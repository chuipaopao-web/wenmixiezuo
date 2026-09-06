import { randomUUID, randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpeningTaskService, createAccountCoreService, createPostgresPool, createUsageCoreService, loadPostgresRuntimeConfig, runMigrations, type PgPool, type AccountCoreService, type OpeningTask } from "@wenmi-rebuild/backend";

let pool: PgPool, admin: PgPool, accounts: AccountCoreService, service: OpeningTaskService;
const policy = { totalTokens: 1000, maxAttempts: 4, deadlineMs: 60_000 };
const idea = { idea: "一个寻找失落故乡的旅人", memberId: "preferred-editor" };
describe("opening task persistence and recovery", () => {
  beforeAll(async () => {
    const config = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!config.expectedDatabase.startsWith("wenmi_rebuild_test_")) throw Error("synthetic test database required");
    await runMigrations({ config });
    // Re-running the immutable migration ledger must do nothing.
    await runMigrations({ config });
    admin = createPostgresPool(config);
    pool = createPostgresPool(loadPostgresRuntimeConfig({ ...process.env, WENMI_REBUILD_DATABASE_URL: process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL }, "app"));
    accounts = createAccountCoreService(pool, { secureCookies: false });
    service = new OpeningTaskService(pool, accounts);
  });
  afterAll(async () => { await pool?.end(); await admin?.end(); });

  it("atomically persists the request and one reservation under concurrent repeat submissions", async () => {
    const user = await login();
    const jobs = await Promise.all(Array.from({ length: 5 }, () => service.enqueue(user.token, "repeat", idea, policy)));
    expect(new Set(jobs.map(j => j.task_id)).size).toBe(1);
    const saved = jobs[0]!;
    expect(saved.request).toEqual(idea);
    expect((await pool.query("SELECT * FROM usage_reservations WHERE operation_id=$1", [saved.task_id])).rows).toHaveLength(1);
    await expect(service.enqueue(user.token, "repeat", { idea: "另一个完全不同的开书想法" }, policy)).rejects.toMatchObject({ code: "TASK_IDEMPOTENCY_CONFLICT" });
    const other = await login();
    await expect(service.get(other.token, saved.task_id)).rejects.toMatchObject({ code: "TASK_SCOPE_DENIED" });
    await expect(service.cancel(other.token, saved.task_id)).rejects.toMatchObject({ code: "TASK_SCOPE_DENIED" });
  });

  it("restarts from the saved design and settles both stages only once", async () => {
    const { user, task } = await queued();
    const first = await claim(task);
    const call = await service.beginCall(lease(first), "design", "test-provider", "test-model", 700);
    const receipt = { inputTokens: 100, outputTokens: 200, result: { design: "保存的设计" }, outcome: "continue" as const };
    const saved = await service.recordReceipt(task.task_id, user.ownerId, call, receipt);
    expect(saved.status).toBe("queued");
    service = new OpeningTaskService(pool, accounts);
    expect((await service.get(user.token, task.task_id)).checkpoint).toEqual({ step: "design", result: receipt.result });
    expect((await service.recordReceipt(task.task_id, user.ownerId, call, receipt)).input_tokens).toBe("100");
    await expect(service.recordReceipt(task.task_id, user.ownerId, call, { ...receipt, outputTokens: 201 })).rejects.toMatchObject({ code: "TASK_IDEMPOTENCY_CONFLICT" });
    const second = await claim(saved);
    await expect(service.beginCall(lease(second), "design", "test-provider", "test-model", 200)).rejects.toMatchObject({ code: "TASK_IDEMPOTENCY_CONFLICT" });
    await expect(service.beginCall(lease(second), "review", "test-provider", "test-model", 701)).rejects.toMatchObject({ code: "USAGE_QUOTA_EXHAUSTED" });
    const review = await service.beginCall(lease(second), "review", "test-provider", "test-model", 700);
    const final = await service.recordReceipt(task.task_id, user.ownerId, review, { inputTokens: 50, outputTokens: 50, result: { reviewed: true }, outcome: "ready" });
    expect(final.status).toBe("awaiting_author");
    expect(await reservation(final)).toMatchObject({ state: "succeeded", input_tokens: "150", output_tokens: "250" });
  });

  it("recovers an expired undispatched lease and rejects the old worker", async () => {
    const { task } = await queued();
    const first = await claim(task);
    await expect(claim(task)).rejects.toMatchObject({ code: "TASK_NOT_CLAIMABLE" });
    await expire(first);
    const second = await claim(task);
    expect(second.lease_token).toBeGreaterThan(first.lease_token);
    await expect(service.beginCall(lease(first), "design", "p", "m", 100)).rejects.toMatchObject({ code: "TASK_LEASE_INVALID" });
    await service.renew(lease(second));
  });

  it("keeps unknown dispatches reserved; late evidence completes without redispatch", async () => {
    const { user, task } = await queued();
    const claimed = await claim(task);
    const call = await service.beginCall(lease(claimed), "design", "p", "m", 100);
    await expire(claimed);
    const unknown = await claim(task);
    expect(unknown.status).toBe("reconciling");
    expect((await reservation(task)).state).toBe("unknown");
    expect((await claim(task)).status).toBe("reconciling");
    const recovered = await service.recordReceipt(task.task_id, user.ownerId, call, { inputTokens: 20, outputTokens: 20, outcome: "ready", result: "找回的方案" });
    expect(recovered.status).toBe("awaiting_author");
    expect((await reservation(task)).state).toBe("succeeded");
  });

  it("cancels queued work without a call and settles work already performed", async () => {
    const first = await queued();
    expect((await service.cancel(first.user.token, first.task.task_id)).status).toBe("cancelled");
    expect((await reservation(first.task)).state).toBe("released");
    const { user, task } = await queued();
    const claimed = await claim(task);
    const call = await service.beginCall(lease(claimed), "design", "p", "m", 100);
    expect((await service.cancel(user.token, task.task_id)).status).toBe("reconciling");
    const final = await service.recordReceipt(task.task_id, user.ownerId, call, { inputTokens: 20, outputTokens: 10, outcome: "ready", result: "取消前已生成的结果" });
    expect(final.status).toBe("cancelled");
    expect(final.checkpoint).toEqual({ step: "design", result: "取消前已生成的结果" });
    expect(await reservation(task)).toMatchObject({ state: "succeeded", input_tokens: "20", output_tokens: "10" });
  });

  it("backs off known failures and stops at the common attempt limit", async () => {
    const { task } = await queued({ ...policy, maxAttempts: 2 });
    const first = await claim(task);
    expect((await service.failBeforeDispatch(lease(first), true)).status).toBe("queued");
    await expect(claim(task)).rejects.toMatchObject({ code: "TASK_NOT_CLAIMABLE" });
    await admin.query("UPDATE opening_tasks SET retry_at=clock_timestamp()-interval '1 second' WHERE task_id=$1", [task.task_id]);
    const second = await claim(task);
    expect((await service.failBeforeDispatch(lease(second), true)).status).toBe("failed");
    expect((await reservation(task)).state).toBe("released");
  });

  it("requires nonexecution evidence and persists overbudget receipts for reconciliation", async () => {
    const { user, task } = await queued();
    const claimed = await claim(task);
    const call = await service.beginCall(lease(claimed), "design", "p", "m", 1000);
    await expect(service.recordReceipt(task.task_id, user.ownerId, call, { inputTokens: 0, outputTokens: 0, outcome: "not_started", result: null })).rejects.toMatchObject({ code: "TASK_REQUEST_INVALID" });
    const result = await service.recordReceipt(task.task_id, user.ownerId, call, { inputTokens: 800, outputTokens: 300, outcome: "ready", result: "超预算但已保存" });
    expect(result.status).toBe("reconciling");
    expect(result.checkpoint).toEqual({ step: "design", result: "超预算但已保存" });
    expect((await reservation(task)).state).toBe("unknown");
    expect((await claim(task)).status).toBe("reconciling");
  });

  it("cancellation after proven nonexecution releases, whereas an executed zero-token call settles", async () => {
    for (const outcome of ["not_started", "failed"] as const) {
      const { user, task } = await queued();
      const claimed = await claim(task);
      const call = await service.beginCall(lease(claimed), "design", "p", "m", 100);
      await service.cancel(user.token, task.task_id);
      await service.recordReceipt(task.task_id, user.ownerId, call, { inputTokens: 0, outputTokens: 0, outcome, evidence: "测试供应商确认未执行", result: null });
      expect((await reservation(task)).state).toBe(outcome === "not_started" ? "released" : "succeeded");
    }
  });

  it("rolls back reservation when task persistence fails and preserves immutable evidence", async () => {
    const user = await login();
    await admin.query(`CREATE FUNCTION opening_insert_failure_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected opening insert failure'; END $$;
      CREATE TRIGGER opening_insert_failure_test BEFORE INSERT ON opening_tasks FOR EACH ROW EXECUTE FUNCTION opening_insert_failure_test();`);
    try {
      await expect(service.enqueue(user.token, "rollback", idea, policy)).rejects.toThrow("injected opening insert failure");
      expect((await pool.query("SELECT * FROM usage_reservations WHERE owner_id=$1", [user.ownerId])).rows).toHaveLength(0);
    } finally {
      await admin.query("DROP TRIGGER opening_insert_failure_test ON opening_tasks; DROP FUNCTION opening_insert_failure_test();");
    }
    const task = await service.enqueue(user.token, "rollback", idea, policy);
    await expect(pool.query("UPDATE opening_tasks SET request='{}' WHERE task_id=$1", [task.task_id])).rejects.toThrow("immutable");
    const claimed = await claim(task);
    const call = await service.beginCall(lease(claimed), "design", "p", "m", 100);
    await service.recordReceipt(task.task_id, user.ownerId, call, { inputTokens: 1, outputTokens: 1, result: "证据", outcome: "ready" });
    await expect(pool.query("UPDATE opening_task_calls SET receipt='{}' WHERE call_id=$1", [call])).rejects.toThrow("immutable");
  });

  it("rejects revoked author sessions and suspended dispatch but still preserves late provider evidence", async () => {
    const { user, task } = await queued();
    const claimed = await claim(task);
    const call = await service.beginCall(lease(claimed), "design", "p", "m", 100);
    await accounts.logout(user.token);
    await expect(service.get(user.token, task.task_id)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    await admin.query("UPDATE account_users SET status='suspended' WHERE owner_id=$1", [user.ownerId]);
    await expect(service.renew(lease(claimed))).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
    expect((await service.recordReceipt(task.task_id, user.ownerId, call, { inputTokens: 5, outputTokens: 5, result: "已完成", outcome: "ready" })).status).toBe("awaiting_author");
  });

  it("rolls back receipt and task updates together if settlement persistence fails", async () => {
    const { user, task } = await queued();
    const claimed = await claim(task);
    const call = await service.beginCall(lease(claimed), "design", "p", "m", 100);
    const receipt = { inputTokens: 10, outputTokens: 20, result: "方案", outcome: "ready" as const };
    await admin.query(`CREATE FUNCTION opening_settle_failure_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='usage.settled' THEN RAISE EXCEPTION 'injected settle failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER opening_settle_failure_test BEFORE INSERT ON usage_reservation_events FOR EACH ROW EXECUTE FUNCTION opening_settle_failure_test();`);
    try {
      await expect(service.recordReceipt(task.task_id, user.ownerId, call, receipt)).rejects.toThrow("injected settle failure");
      expect((await service.get(user.token, task.task_id)).input_tokens).toBe("0");
      expect((await pool.query("SELECT receipt FROM opening_task_calls WHERE call_id=$1", [call])).rows[0]!.receipt).toBeNull();
    } finally {
      await admin.query("DROP TRIGGER opening_settle_failure_test ON usage_reservation_events; DROP FUNCTION opening_settle_failure_test();");
    }
    expect((await service.recordReceipt(task.task_id, user.ownerId, call, receipt)).status).toBe("awaiting_author");
  });
});

async function login() {
  const email = `opening-${randomUUID()}@example.com`;
  const created = await accounts.createInternalUser({ email, displayName: "测试作者", password: "test opening password" });
  const verify = await accounts.issueEmailVerificationToken(created.account.userId);
  await accounts.verifyEmailToken(verify.token);
  const session = await accounts.login({ email, password: "test opening password", ipAddress: `127.1.${randomInt(1,255)}.${randomInt(1,255)}` });
  const ownerId = (await pool.query<{ owner_id: string }>("SELECT owner_id FROM account_users WHERE user_id=$1", [created.account.userId])).rows[0]!.owner_id;
  await createUsageCoreService(pool).grantEntitlementSnapshot({ ownerId, sourceKind: "internal_test", sourceId: randomUUID(), planKey: "test", periodStart: new Date(Date.now()-1000), periodEnd: new Date(Date.now()+3600_000), computeQuota: 20_000 });
  return { ownerId, token: session.token };
}
async function queued(customPolicy = policy) { const user = await login(); return { user, task: await service.enqueue(user.token, randomUUID(), idea, customPolicy) }; }
function lease(task: OpeningTask) { return { taskId: task.task_id, ownerId: task.owner_id, workerId: task.worker_id!, token: task.lease_token }; }
function claim(task: OpeningTask) { return service.claim(task.task_id, task.owner_id, "test-worker"); }
async function expire(task: OpeningTask) { await admin.query("UPDATE opening_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE task_id=$1", [task.task_id]); }
async function reservation(task: OpeningTask) { return (await pool.query("SELECT state,input_tokens,output_tokens FROM usage_reservations WHERE reservation_id=$1", [task.reservation_id])).rows[0]; }
