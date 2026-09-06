import { randomUUID, randomInt } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { ExistingOpeningWorkflow, ExistingOpeningModelExecutor, PostgresOpeningTools, OpeningTaskService, existingOpeningModelResolver, loadModelRuntimeConfig, createAccountCoreService, createPostgresPool, createUsageCoreService, loadPostgresRuntimeConfig, runMigrations, type PgPool, type AccountCoreService } from '@wenmi-rebuild/backend';
import { IDEA, PACKAGE, PASS_REVIEW } from './opening-fixture.js';
import { openingRosterFromGlobal } from '../../packages/backend/src/legacy-opening/agent-governance/runtime-rosters.js';

let pool: PgPool, admin: PgPool, accounts: AccountCoreService, tasks: OpeningTaskService;
const config = loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan', WENMI_ARK_CODING_PLAN_API_KEY: 'synthetic-key-not-a-real-credential' });
const policy = { totalTokens: 300_000, maxAttempts: 4, deadlineMs: 60_000 };
describe('original opening engine through PostgreSQL tools', () => {
  beforeAll(async () => {
    const db = loadPostgresRuntimeConfig(process.env, 'migrator');
    if (!db.expectedDatabase.startsWith('wenmi_rebuild_test_')) throw Error('synthetic database required');
    await runMigrations({ config: db });
    admin = createPostgresPool(db);
    pool = createPostgresPool(loadPostgresRuntimeConfig({ ...process.env, WENMI_REBUILD_DATABASE_URL: process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL }, 'app'));
    accounts = createAccountCoreService(pool, { secureCookies: false });
    tasks = new OpeningTaskService(pool, accounts);
  });
  afterAll(async () => { await pool?.end(); await admin?.end(); });

  it('runs original design and independent review, freezing selected members and prompt configuration', async () => {
    const author = await prepared();
    const fetcher = vi.fn<typeof fetch>(async () => response(fetcher.mock.calls.length === 1 ? PACKAGE : PASS_REVIEW));
    const workflow = engine(fetcher), roster = openingRosterFromGlobal();
    const task = await workflow.create(author.token, randomUUID(), { idea: IDEA, selectedScreenwriterMemberKey: 'planner-deepseek-v4-pro', selectedChiefMemberKey: 'chief-glm-5-3' }, policy, { memberRoster: roster, governanceRevision: 126 });
    roster[0]!.displayName = 'later configuration';
    const result = await workflow.run(task.task_id, task.owner_id, 'test-worker');
    expect(result.task.status, JSON.stringify(result.state)).toBe('awaiting_author');
    expect(result.state?.status).toBe('awaiting_author_confirmation');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)));
    expect(bodies[0].model).not.toBe(bodies[1].model);
    expect(bodies[0].messages[0].content).toContain(IDEA);
    expect(await candidates(task.task_id)).toHaveLength(2);
    const prompts = (await pool.query('SELECT compilation FROM opening_workflow_prompts WHERE task_id=$1', [task.task_id])).rows;
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts)).not.toContain('later configuration');
    const usage = (await pool.query('SELECT state,input_tokens,output_tokens FROM usage_reservations WHERE reservation_id=$1', [task.reservation_id])).rows[0];
    expect(usage).toMatchObject({ state: 'succeeded', input_tokens: '60', output_tokens: '80' });
    await workflow.run(task.task_id, task.owner_id, 'another-worker');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps a completed design when review outcome is unknown and consumes a late receipt without resending', async () => {
    const author = await prepared();
    const fetcher = vi.fn<typeof fetch>(async () => { if (fetcher.mock.calls.length === 1) return response(PACKAGE); throw new TypeError('network interrupted'); });
    const workflow = engine(fetcher);
    const task = await workflow.create(author.token, randomUUID(), { idea: IDEA }, policy);
    const stopped = await workflow.run(task.task_id, task.owner_id, 'test-worker');
    expect(stopped.task.status).toBe('reconciling');
    expect(await candidates(task.task_id)).toHaveLength(1);
    await workflow.run(task.task_id, task.owner_id, 'another-worker');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const reviewModel = JSON.parse(String(fetcher.mock.calls[1]![1]?.body)).model;
    await tasks.recordReceipt(task.task_id, task.owner_id, stopped.task.active_call_id!, { inputTokens: 30, outputTokens: 40, outcome: 'continue', result: { provider: 'volcengine-ark-coding-plan', modelId: reviewModel, output: JSON.stringify(PASS_REVIEW), inputTokens: 30, outputTokens: 40 } });
    const recovered = await workflow.run(task.task_id, task.owner_id, 'recovery-worker');
    expect(recovered.state?.status, JSON.stringify(recovered.state)).toBe('awaiting_author_confirmation');
    expect(recovered.task.status).toBe('awaiting_author');
    expect(await candidates(task.task_id)).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('recovers a saved model result after candidate transaction rollback without repeating design', async () => {
    const author = await prepared();
    const fetcher = vi.fn<typeof fetch>(async () => response(fetcher.mock.calls.length === 1 ? PACKAGE : PASS_REVIEW));
    const workflow = engine(fetcher);
    const task = await workflow.create(author.token, randomUUID(), { idea: IDEA }, policy);
    // A scoped synthetic DB fault at the candidate/checkpoint boundary.
    await admin.query(`CREATE FUNCTION opening_test_fail126() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_id='${task.task_id}'::uuid THEN RAISE EXCEPTION 'synthetic commit interruption'; END IF; RETURN NEW; END $$`);
    await admin.query('CREATE TRIGGER opening_test_fail126 BEFORE INSERT ON opening_workflow_candidates FOR EACH ROW EXECUTE FUNCTION opening_test_fail126()');
    try { await expect(workflow.run(task.task_id, task.owner_id, 'test-worker')).rejects.toThrow('synthetic commit interruption'); }
    finally { await admin.query('DROP TRIGGER opening_test_fail126 ON opening_workflow_candidates'); await admin.query('DROP FUNCTION opening_test_fail126()'); }
    expect(await candidates(task.task_id)).toHaveLength(0);
    const interrupted = await tasks.get(author.token, task.task_id);
    expect(interrupted.engine_state).toMatchObject({ phase: 'package_design' });
    expect(interrupted.active_call_id).toBeNull();
    await admin.query("UPDATE opening_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE task_id=$1", [task.task_id]);
    const recovered = await workflow.run(task.task_id, task.owner_id, 'recovery-worker');
    expect(recovered.state?.status, JSON.stringify(recovered.state)).toBe('awaiting_author_confirmation');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await candidates(task.task_id)).toHaveLength(2);
  });

  it('retains the original structured-output repair before handing results to the author', async () => {
    const author = await prepared();
    const fetcher = vi.fn<typeof fetch>(async () => response(fetcher.mock.calls.length === 1 ? { title: 'incomplete' } : fetcher.mock.calls.length === 2 ? PACKAGE : PASS_REVIEW));
    const workflow = engine(fetcher), task = await workflow.create(author.token, randomUUID(), { idea: IDEA }, policy);
    const result = await workflow.run(task.task_id, task.owner_id, 'test-worker');
    expect(result.state?.status).toBe('awaiting_author_confirmation');
    expect(fetcher).toHaveBeenCalledTimes(3);
    const prompts = (await pool.query('SELECT request FROM opening_workflow_prompts WHERE task_id=$1', [task.task_id])).rows.map(r => r.request);
    const repair = prompts.find(r => r.operationMode === 'repair');
    expect(repair).toBeDefined();
    expect(prompts.find(r => r.requestId === repair.basedOnTaskId).member.memberKey).toBe(repair.member.memberKey);
  });

  it('leaves a substantive review decision to the author instead of auto-approving', async () => {
    const author = await prepared();
    const review = { ...PASS_REVIEW, verdict: 'author_decision', decisions: [{ field: 'possibleEnding.direction', question: '最终是否称帝？', currentValue: '建立稳定秩序', recommendation: '保留后续调整', reason: '需要作者决定', impact: '结局方向', required: true }] };
    const fetcher = vi.fn<typeof fetch>(async () => response(fetcher.mock.calls.length === 1 ? PACKAGE : review));
    const workflow = engine(fetcher), task = await workflow.create(author.token, randomUUID(), { idea: IDEA }, policy);
    const result = await workflow.run(task.task_id, task.owner_id, 'test-worker');
    expect(result.state?.status).toBe('awaiting_author_decision');
    expect(result.task.status).toBe('awaiting_author');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects foreign scope and stale workers before reading or changing engine state', async () => {
    const author = await prepared(), other = await prepared();
    const workflow = engine(vi.fn<typeof fetch>()), task = await workflow.create(author.token, randomUUID(), { idea: IDEA }, policy);
    const claim = await tasks.claim(task.task_id, task.owner_id, 'test-worker');
    const tools = new PostgresOpeningTools(tasks, { taskId: task.task_id, ownerId: task.owner_id, workerId: 'test-worker', token: claim.lease_token });
    await expect(tools.readOpeningIdea(other.ownerId, task.task_id)).rejects.toMatchObject({ code: 'TASK_SCOPE_DENIED' });
    await expect(tasks.get(other.token, task.task_id)).rejects.toMatchObject({ code: 'TASK_SCOPE_DENIED' });
    await admin.query("UPDATE opening_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE task_id=$1", [task.task_id]);
    await tasks.claim(task.task_id, task.owner_id, 'new-worker');
    await expect(tools.loadTask(task.owner_id, task.task_id)).rejects.toMatchObject({ code: 'TASK_LEASE_INVALID' });
  });
});

function engine(fetcher: typeof fetch) { return new ExistingOpeningWorkflow(tasks, new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(config, fetcher))); }
function response(value: unknown) { return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }], usage: { input_tokens: 30, output_tokens: 40 } }), { status: 200 }); }
async function candidates(taskId: string) { return (await pool.query('SELECT * FROM opening_workflow_candidates WHERE task_id=$1', [taskId])).rows; }
async function prepared() {
  const email = `workflow-${randomUUID()}@example.com`;
  const created = await accounts.createInternalUser({ email, displayName: '合成作者', password: 'synthetic test password' });
  await accounts.verifyEmailToken((await accounts.issueEmailVerificationToken(created.account.userId)).token);
  const login = await accounts.login({ email, password: 'synthetic test password', ipAddress: `127.3.${randomInt(1,255)}.${randomInt(1,255)}` });
  const ownerId = (await pool.query<{owner_id:string}>('SELECT owner_id FROM account_users WHERE user_id=$1', [created.account.userId])).rows[0]!.owner_id;
  await createUsageCoreService(pool).grantEntitlementSnapshot({ ownerId, sourceKind: 'internal_test', sourceId: randomUUID(), planKey: 'test', periodStart: new Date(Date.now()-1000), periodEnd: new Date(Date.now()+3600_000), computeQuota: 1_000_000 });
  return { token: login.token, ownerId };
}
