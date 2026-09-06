import { randomUUID, randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OpeningTaskService, ExistingOpeningModelExecutor, existingOpeningModelResolver, loadModelRuntimeConfig, createAccountCoreService, createPostgresPool, createUsageCoreService, loadPostgresRuntimeConfig, runMigrations, type PgPool, type AccountCoreService } from "@wenmi-rebuild/backend";

let pool: PgPool, accounts: AccountCoreService, tasks: OpeningTaskService;
const config = loadModelRuntimeConfig({ WENMI_MODEL_MODE: "subscription-plan", WENMI_ARK_CODING_PLAN_API_KEY: "synthetic-key-not-a-real-credential" });
describe("existing model adapter with PG opening tasks", () => {
  beforeAll(async () => {
    const db = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!db.expectedDatabase.startsWith("wenmi_rebuild_test_")) throw Error("synthetic database required");
    await runMigrations({ config: db });
    pool = createPostgresPool(loadPostgresRuntimeConfig({ ...process.env, WENMI_REBUILD_DATABASE_URL: process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL }, "app"));
    accounts = createAccountCoreService(pool, { secureCookies: false });
    tasks = new OpeningTaskService(pool, accounts);
  });
  afterAll(async () => { await pool?.end(); });

  it("uses the existing wire protocol and persists visible output and actual usage", async () => {
    const run = await prepared();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://ark.cn-beijing.volces.com/api/coding/v1/messages");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "deepseek-v4-pro", messages: [{ role: "user", content: run.input.prompt }] });
      return response();
    });
    const executor = new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(config, fetcher));
    const result = await executor.execute(run.input);
    expect(result.output).toBe('{"title":"新故事"}');
    const stored = await tasks.get(run.token, run.input.lease.taskId);
    expect(stored).toMatchObject({ status: "queued", input_tokens: "30", output_tokens: "40" });
    expect(stored.checkpoint).toMatchObject({ step: "design", result: { output: result.output, provider: run.input.provider, modelId: run.input.modelId } });
    expect(JSON.stringify(stored.checkpoint)).not.toContain("hidden reasoning");
    const next = await tasks.claim(stored.task_id, stored.owner_id, "next-worker");
    await expect(executor.execute({ ...run.input, lease: { ...run.input.lease, token: next.lease_token, workerId: "next-worker" } })).rejects.toMatchObject({ code: "TASK_IDEMPOTENCY_CONFLICT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("validates configured models and scope before network dispatch", async () => {
    const run = await prepared();
    const fetcher = vi.fn<typeof fetch>();
    const executor = new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(config, fetcher));
    await expect(executor.execute({ ...run.input, modelId: "unapproved" })).rejects.toMatchObject({ code: "CONFIGURATION_INVALID" });
    await expect(executor.execute({ ...run.input, lease: { ...run.input.lease, ownerId: randomUUID() } })).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
    const noCredentials = new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(loadModelRuntimeConfig({}), fetcher));
    await expect(noCredentials.execute(run.input)).rejects.toMatchObject({ code: "CONFIGURATION_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await tasks.get(run.token, run.input.lease.taskId)).active_call_id).toBeNull();
  });

  it("keeps an interrupted network call unknown and does not automatically resend", async () => {
    const run = await prepared();
    const fetcher = vi.fn<typeof fetch>(async () => { throw new TypeError("network failure"); });
    const executor = new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(config, fetcher));
    await expect(executor.execute(run.input)).rejects.toMatchObject({ outcomeUnknown: true, retryable: false });
    expect((await tasks.get(run.token, run.input.lease.taskId)).status).toBe("reconciling");
    await expect(executor.execute(run.input)).rejects.toMatchObject({ code: "TASK_LEASE_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves explicit provider rejection classification and safe retry state without leaking the response", async () => {
    const run = await prepared();
    const fetcher = vi.fn<typeof fetch>(async () => new Response("private vendor diagnostic", { status: 429 }));
    const executor = new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(config, fetcher));
    const error = await executor.execute(run.input).catch(error => error);
    expect(error).toMatchObject({ statusCode: 429, outcomeUnknown: false });
    expect(error.message).not.toContain("private vendor diagnostic");
    expect((await tasks.get(run.token, run.input.lease.taskId)).status).toBe("queued");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch an already cancelled signal", async () => {
    const run = await prepared();
    const fetcher = vi.fn<typeof fetch>();
    const executor = new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(config, fetcher));
    await expect(executor.execute(run.input, AbortSignal.abort())).rejects.toMatchObject({ code: "TASK_NOT_CLAIMABLE" });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await tasks.get(run.token, run.input.lease.taskId)).active_call_id).toBeNull();
  });

  it("keeps a late result and bills actual usage when the author cancels during generation", async () => {
    const run = await prepared();
    const fetcher = vi.fn<typeof fetch>(async () => {
      await tasks.cancel(run.token, run.input.lease.taskId);
      return response();
    });
    const executor = new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(config, fetcher));
    await expect(executor.execute(run.input)).rejects.toMatchObject({ code: "TASK_NOT_CLAIMABLE" });
    const stored = await tasks.get(run.token, run.input.lease.taskId);
    expect(stored.status).toBe("cancelled");
    expect(stored.checkpoint).toMatchObject({ result: { output: '{"title":"新故事"}' } });
    const usage = (await pool.query("SELECT state,input_tokens,output_tokens FROM usage_reservations WHERE reservation_id=$1", [stored.reservation_id])).rows[0];
    expect(usage).toMatchObject({ state: "succeeded", input_tokens: "30", output_tokens: "40" });
  });
});

function response() { return new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "hidden reasoning" }, { type: "text", text: '{"title":"新故事"}' }], usage: { input_tokens: 30, output_tokens: 40 } }), { status: 200 }); }
async function prepared() {
  const email = `model-${randomUUID()}@example.com`;
  const created = await accounts.createInternalUser({ email, displayName: "合成作者", password: "synthetic test password" });
  const verify = await accounts.issueEmailVerificationToken(created.account.userId);
  await accounts.verifyEmailToken(verify.token);
  const login = await accounts.login({ email, password: "synthetic test password", ipAddress: `127.2.${randomInt(1,255)}.${randomInt(1,255)}` });
  const ownerId = (await pool.query<{ owner_id: string }>("SELECT owner_id FROM account_users WHERE user_id=$1", [created.account.userId])).rows[0]!.owner_id;
  await createUsageCoreService(pool).grantEntitlementSnapshot({ ownerId, sourceKind: "internal_test", sourceId: randomUUID(), planKey: "test", periodStart: new Date(Date.now()-1000), periodEnd: new Date(Date.now()+3600_000), computeQuota: 1_000_000 });
  const task = await tasks.enqueue(login.token, randomUUID(), { idea: "一个返乡旅人寻找过去的故事" }, { totalTokens: 100_000, maxAttempts: 4, deadlineMs: 60_000 });
  const claimed = await tasks.claim(task.task_id, ownerId, "test-worker");
  return { token: login.token, input: { lease: { ownerId, taskId: task.task_id, workerId: "test-worker", token: claimed.lease_token }, step: "design", memberKey: "selected-editor", provider: "volcengine-ark-coding-plan", modelId: "deepseek-v4-pro", prompt: "现有执行器编译好的提示原样传递", maxOutputTokens: 100 } };
}
