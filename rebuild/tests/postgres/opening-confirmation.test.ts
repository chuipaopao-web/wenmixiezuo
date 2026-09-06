import { randomUUID, randomInt } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { OpeningConfirmationService, ExistingOpeningWorkflow, ExistingOpeningModelExecutor, OpeningTaskService, existingOpeningModelResolver, loadModelRuntimeConfig, createAccountCoreService, createBookShelfService, createPostgresPool, createUsageCoreService, loadPostgresRuntimeConfig, runMigrations, type PgPool, type AccountCoreService, type BookShelfService } from '@wenmi-rebuild/backend';
import { createApiServer } from '../../apps/api/src/create-server.js';
import { IDEA, PACKAGE, PASS_REVIEW } from './opening-fixture.js';
import type { OpeningPackage } from '../../packages/backend/src/legacy-opening/opening-agent/opening-agent-contracts.js';
import { openingPackageUnchanged, validateV7OpeningConfirmationPackage } from '../../packages/backend/src/application/opening-tasks/opening-package-contract.js';

let pool: PgPool, admin: PgPool, accounts: AccountCoreService, tasks: OpeningTaskService, books: BookShelfService, confirmation: OpeningConfirmationService;
let server: Awaited<ReturnType<typeof createApiServer>>, originalUrl: string | undefined;
const model = loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan', WENMI_ARK_CODING_PLAN_API_KEY: 'synthetic-key-not-a-real-credential' });
describe('reviewed opening confirmation', () => {
  beforeAll(async () => {
    const db = loadPostgresRuntimeConfig(process.env, 'migrator');
    if (!db.expectedDatabase.startsWith('wenmi_rebuild_test_')) throw Error('synthetic database required');
    await runMigrations({ config: db });
    admin = createPostgresPool(db);
    originalUrl = process.env.WENMI_REBUILD_DATABASE_URL;
    process.env.WENMI_REBUILD_DATABASE_URL = process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL;
    pool = createPostgresPool(loadPostgresRuntimeConfig(process.env, 'app'));
    accounts = createAccountCoreService(pool, { secureCookies: false });
    tasks = new OpeningTaskService(pool, accounts);
    books = createBookShelfService(pool, accounts);
    confirmation = new OpeningConfirmationService(pool, accounts);
    server = await createApiServer({ accountPool: pool, accountService: accounts });
  });
  afterAll(async () => { await server?.close(); await pool?.end(); await admin?.end(); process.env.WENMI_REBUILD_DATABASE_URL = originalUrl; });

  it('confirms through the existing URL and retains AI source when editing the resulting book', async () => {
    const run = await ready();
    const reply = await post(run.token, run.input);
    expect(reply.statusCode, reply.body).toBe(200);
    const created = reply.json().data;
    expect(created).toMatchObject({ title: PACKAGE.title, nextView: 'information', status: 'active' });
    const profile = await books.getBookProfileFromSession(run.token, created.bookId);
    expect(profile.source).toBe('agent_opening_package');
    expect(profile.openingBlueprint?.openingIdea).toBe(IDEA);
    const updated = await books.updateBookProfileFromSession(run.token, created.bookId, { title: '作者的新书名', expectedVersion: 1,
      openingBlueprint: { ...profile.openingBlueprint!, openingIdea: 'client must not replace source' } });
    expect(updated).toMatchObject({ source: 'agent_opening_package', version: 2 });
    expect(updated.openingBlueprint?.openingIdea).toBe(IDEA);
    const sources = (await pool.query('SELECT opening_idea,opening_package,source_type,candidate_id FROM agent_book_opening_sources WHERE book_id=$1', [created.bookId])).rows;
    expect(sources[0]).toMatchObject({ opening_idea: IDEA, source_type: 'agent_opening_package', candidate_id: run.input.candidateId, opening_package: { title: PACKAGE.title } });
    expect((await pool.query('SELECT book_id FROM manual_book_opening_sources WHERE book_id=$1', [created.bookId])).rows).toHaveLength(0);
    const duplicates = await Promise.all(Array.from({ length: 4 }, () => confirmation.confirm(run.token, { ...run.input, idempotencyKey: randomUUID() })));
    expect(new Set(duplicates.map(x => x.bookId))).toEqual(new Set([created.bookId]));
    expect((await books.listBooks(run.token, {})).books).toHaveLength(1);
    expect((await pool.query('SELECT book_id FROM bookshelf_book_audit_events WHERE book_id=$1 AND event_type=$2', [created.bookId, 'agent_book_confirmed'])).rows).toHaveLength(1);
    const lifecycleBook = (await books.listBooks(run.token, {})).books[0]!;
    await books.archiveBook(run.token, created.bookId, { expectedVersion: lifecycleBook.version });
    await expect(confirmation.confirm(run.token, run.input)).rejects.toMatchObject({ code: 'BOOK_VERSION_CONFLICT' });
  });

  it('serializes first-time concurrent confirmations without creating two books or charges', async () => {
    const run = await ready();
    const before = (await pool.query('SELECT * FROM usage_reservations WHERE reservation_id=$1', [run.task.reservation_id])).rows[0];
    const results = await Promise.all(Array.from({ length: 4 }, () => confirmation.confirm(run.token, run.input)));
    expect(new Set(results.map(x => x.bookId)).size).toBe(1);
    expect((await books.listBooks(run.token, {})).books).toHaveLength(1);
    const after = (await pool.query('SELECT * FROM usage_reservations WHERE reservation_id=$1', [run.task.reservation_id])).rows[0];
    expect(after).toEqual(before);
    const otherTask = await ready(run);
    await expect(confirmation.confirm(run.token, { ...otherTask.input, idempotencyKey: run.input.idempotencyKey })).rejects.toMatchObject({ code: 'BOOK_IDEMPOTENCY_CONFLICT' });
  });

  it('rejects unauthenticated, foreign, modified, stale and forged ownership requests', async () => {
    const run = await ready(), other = await author();
    expect((await post('', run.input)).statusCode).toBe(401);
    expect((await post(other.token, run.input)).statusCode).toBe(404);
    expect((await post(run.token, { ...run.input, ownerId: other.ownerId })).statusCode).toBe(400);
    expect((await post(run.token, { ...run.input, candidateId: 'candidate-stale-version' })).statusCode).toBe(409);
    expect((await post(run.token, { ...run.input, openingPackage: { ...PACKAGE, title: '已修改未复审' } })).statusCode).toBe(409);
    const badOrigin = await server.inject({ method: 'POST', url: '/v1/v7/opening-books', headers: { ...headers(run.token), origin: 'https://external.invalid' }, payload: run.input });
    expect(badOrigin.statusCode).toBe(403);
    expect((await books.listBooks(run.token, {})).books).toHaveLength(0);
  });

  it('requires the active review to refer to the selected package and leaves author decisions unconfirmed', async () => {
    const run = await ready();
    const state = run.state!;
    await admin.query("UPDATE opening_workflow_candidates SET source_candidate_ids='[]' WHERE task_id=$1 AND candidate_id=$2", [run.task.task_id, state.activeReviewCandidateId]);
    await expect(confirmation.confirm(run.token, run.input)).rejects.toMatchObject({ code: 'BOOK_VERSION_CONFLICT' });
    await admin.query('UPDATE opening_workflow_candidates SET source_candidate_ids=$3 WHERE task_id=$1 AND candidate_id=$2', [run.task.task_id, state.activeReviewCandidateId, JSON.stringify([run.input.candidateId])]);
    await admin.query("UPDATE opening_tasks SET engine_state=jsonb_set(engine_state,'{status}','\"awaiting_author_decision\"') WHERE task_id=$1", [run.task.task_id]);
    await expect(confirmation.confirm(run.token, run.input)).rejects.toMatchObject({ code: 'BOOK_VERSION_CONFLICT' });
    expect((await books.listBooks(run.token, {})).books).toHaveLength(0);
  });

  it('rolls back book, source, profile, directory and receipt when final audit insert fails, then safely retries', async () => {
    const run = await ready();
    await admin.query(`CREATE FUNCTION opening_fail127() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${run.ownerId}'::uuid AND NEW.event_type='agent_book_confirmed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await admin.query('CREATE TRIGGER opening_fail127 BEFORE INSERT ON bookshelf_book_audit_events FOR EACH ROW EXECUTE FUNCTION opening_fail127()');
    try { await expect(confirmation.confirm(run.token, run.input)).rejects.toThrow('synthetic audit failure'); }
    finally { await admin.query('DROP TRIGGER opening_fail127 ON bookshelf_book_audit_events'); await admin.query('DROP FUNCTION opening_fail127()'); }
    for (const table of ['bookshelf_books', 'agent_book_opening_sources', 'book_profile_versions', 'manual_book_chapter_directories']) {
      expect((await pool.query(`SELECT book_id FROM ${table} WHERE owner_id=$1`, [run.ownerId])).rows).toHaveLength(0);
    }
    expect((await tasks.get(run.token, run.task.task_id)).engine_state).toEqual(run.state);
    await confirmation.confirm(run.token, run.input);
    expect((await books.listBooks(run.token, {})).books).toHaveLength(1);
  });

  it('preserves legacy comparison of reviewed author-visible additions and ignores only internal revision instructions', () => {
    const stored: OpeningPackage = { ...structuredClone(PACKAGE), authorNotes: ['作者保留的检查项'], authorInstructions: [], revisionDirective: { allowedFields: ['title'], authorMessages: ['不改其他内容'] } };
    stored.protagonists[0]!.goal = '作者明确填写的目标';
    const submitted = structuredClone(stored);
    delete submitted.revisionDirective;
    delete submitted.authorInstructions;
    const parsed = validateV7OpeningConfirmationPackage(submitted);
    expect(openingPackageUnchanged(stored, parsed.comparisonPackage)).toBe(true);
    submitted.protagonists[0]!.goal = '未经审查的新目标';
    expect(openingPackageUnchanged(stored, submitted)).toBe(false);
  });
});

function headers(token: string) { return { host: '127.0.0.1:43280', origin: 'http://127.0.0.1:43280', 'content-type': 'application/json', ...(token ? { cookie: `wenmi_rebuild_session=${token}` } : {}) }; }
function post(token: string, payload: unknown) { return server.inject({ method: 'POST', url: '/v1/v7/opening-books', headers: headers(token), payload }); }
async function ready(existing?: Awaited<ReturnType<typeof author>>) {
  const identity = existing ?? await author();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(fetcher.mock.calls.length === 1 ? PACKAGE : PASS_REVIEW) }], usage: { input_tokens: 30, output_tokens: 40 } }), { status: 200 }));
  const workflow = new ExistingOpeningWorkflow(tasks, new ExistingOpeningModelExecutor(tasks, existingOpeningModelResolver(model, fetcher)));
  const task = await workflow.create(identity.token, randomUUID(), { idea: IDEA, selectedChiefMemberKey: 'chief-glm-5-3' }, { totalTokens: 200_000, maxAttempts: 4, deadlineMs: 60_000 });
  const run = await workflow.run(task.task_id, task.owner_id, 'test-worker');
  expect(run.state?.status).toBe('awaiting_author_confirmation');
  const input = { taskId: task.task_id, candidateId: run.state!.activePackageCandidateId!, openingPackage: structuredClone(PACKAGE), idempotencyKey: randomUUID() };
  return { ...identity, task, state: run.state, input };
}
async function author() {
  const email = `confirmation-${randomUUID()}@example.com`;
  const account = (await accounts.createInternalUser({ email, displayName: '合成确认作者', password: 'synthetic test password' })).account;
  await accounts.verifyEmailToken((await accounts.issueEmailVerificationToken(account.userId)).token);
  const login = await accounts.login({ email, password: 'synthetic test password', ipAddress: `127.4.${randomInt(1,255)}.${randomInt(1,255)}` });
  const ownerId = (await pool.query<{owner_id:string}>('SELECT owner_id FROM account_users WHERE user_id=$1', [account.userId])).rows[0]!.owner_id;
  await createUsageCoreService(pool).grantEntitlementSnapshot({ ownerId, sourceKind: 'internal_test', sourceId: randomUUID(), planKey: 'test', periodStart: new Date(Date.now()-1000), periodEnd: new Date(Date.now()+3600_000), computeQuota: 1_000_000 });
  return { token: login.token, ownerId };
}
