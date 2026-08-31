import { afterEach, describe, expect, it } from 'vitest';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { V7PlanningMaintenanceService } from '../../../apps/api/src/application/planning/v7-planning-maintenance-service.js';
import { V7PlanningTreeService } from '../../../apps/api/src/application/planning/v7-planning-tree-service.js';
import { SystemClock, UuidGenerator } from '../../../apps/api/src/domain/ids.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { parseProgressivePlanningBrief } from '@wenmi/v7-backend';

const HEADERS = {
  host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site', 'content-type': 'application/json'
};
let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7规划编辑部三席协作', () => {
  it('规划维护技术重试沿用首次冻结快照，只更换执行尝试编号', async () => {
    context = createTestContext('wenmi-v7-planning-maintenance-retry-');
    const resolver = new RetryPlanningMaintenanceResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'planning-maintenance-retry@example.com', '规划作者');
      const bookId = await createBook(app, cookie, '规划维护重试书');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      prepareConfirmedChain(ownerId, bookId);
      insertSettlement(ownerId, bookId);
      const maintenance = new V7PlanningMaintenanceService(
        context.database, resolver, new UuidGenerator(), new SystemClock()
      );
      const started = maintenance.trigger(ownerId, bookId, 'event_settlement', 'settlement-event-1');
      const failed = await pollMaintenance(maintenance, ownerId, bookId, started.runId);
      expect(failed).toMatchObject({ status: 'failed' });
      const initialAttemptCount = resolver.calls;
      expect(initialAttemptCount).toBeGreaterThan(0);
      const logicalTaskId = `${started.runId}:maintenance:1`;
      const frozenBefore = context.database.prepare(`SELECT manifest_id,compiled_prompt_hash,context_pack_id,
        task_contract_id,task_id FROM v7_prompt_manifests WHERE owner_id=? AND book_id=? AND task_id=?`)
        .get(ownerId, bookId, logicalTaskId) as Record<string, unknown>;
      expect(frozenBefore).toMatchObject({ task_id: logicalTaskId });
      expect(() => maintenance.retry(ownerId, 'another-book', started.runId)).toThrow(/不存在|本书/u);

      resolver.allowSuccess = true;
      expect(maintenance.retry(ownerId, bookId, started.runId)).toMatchObject({ status: 'waiting' });
      const completed = await pollMaintenance(maintenance, ownerId, bookId, started.runId);
      expect(completed).toMatchObject({ status: 'completed', actualCount: 1, suggestionCount: 1 });
      expect(resolver.requestIds).toEqual(expect.arrayContaining([
        `${started.runId}:maintenance:0:1`, `${started.runId}:maintenance:1:1`
      ]));
      expect(resolver.prompts[initialAttemptCount]).toBe(resolver.prompts[0]);
      const frozenAfter = context.database.prepare(`SELECT manifest_id,compiled_prompt_hash,context_pack_id,
        task_contract_id,task_id FROM v7_prompt_manifests WHERE owner_id=? AND book_id=? AND task_id=?`)
        .get(ownerId, bookId, logicalTaskId) as Record<string, unknown>;
      expect(frozenAfter).toEqual(frozenBefore);
      expect((context.database.prepare(`SELECT COUNT(*) AS total FROM v7_prompt_manifests
        WHERE owner_id=? AND book_id=? AND task_id=?`).get(ownerId, bookId, logicalTaskId) as { total: number }).total).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('规划正式树版本变化后拒绝用旧维护任务重试', async () => {
    context = createTestContext('wenmi-v7-planning-maintenance-source-change-');
    const resolver = new RetryPlanningMaintenanceResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'planning-maintenance-source@example.com', '规划作者');
      const bookId = await createBook(app, cookie, '规划版本变化书');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      prepareConfirmedChain(ownerId, bookId);
      insertSettlement(ownerId, bookId);
      const maintenance = new V7PlanningMaintenanceService(
        context.database, resolver, new UuidGenerator(), new SystemClock()
      );
      const started = maintenance.trigger(ownerId, bookId, 'event_settlement', 'settlement-event-1');
      expect(await pollMaintenance(maintenance, ownerId, bookId, started.runId)).toMatchObject({ status: 'failed' });
      reviseConfirmedChain(ownerId, bookId);
      const attemptsBeforeRetry = resolver.calls;
      resolver.allowSuccess = true;
      maintenance.retry(ownerId, bookId, started.runId);
      const rejected = await pollMaintenance(maintenance, ownerId, bookId, started.runId);
      expect(rejected).toMatchObject({ status: 'failed' });
      expect(rejected.errorMessage).toMatch(/已确认规划已经更新/u);
      expect(resolver.calls).toBe(attemptsBeforeRetry);
    } finally {
      await app.close();
    }
  });

  it('冻结成员全部失败后如实道歉，刷新页面不会伪装工作中或重复调用', async () => {
    context = createTestContext('wenmi-v7-planning-failed-');
    const resolver = new AlwaysFailingPlanningResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'planning-failed@example.com', '失败恢复作者');
      const bookId = await createBook(app, cookie, '失败恢复测试书');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-routes/runs`, {
        authorGoal: '张三必须始终是主角。', idempotencyKey: 'planning-failed-run-0001'
      });
      const runId = started.json().data.runId as string;
      const failed = await pollRouteRun(app, cookie, bookId, runId);
      expect(failed).toMatchObject({ status: 'failed', phase: 'failed' });
      expect(failed.message).toMatch(/^对不起/u);
      expect(failed.message).not.toMatch(/JSON|Expected|position|column|SyntaxError/iu);
      expect(failed.message).toContain('可以重新开始');
      expect(failed.actors.every((actor: { status: string }) => actor.status === 'failed')).toBe(true);
      const callsAfterFailure = resolver.calls;
      const refreshed = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-routes/runs/${runId}`);
      expect(refreshed.json().data).toMatchObject({ status: 'failed', phase: 'failed' });
      expect(resolver.calls).toBe(callsAfterFailure);
      const tasks = await request(app, cookie, 'GET', '/api/v1/v7/planning-tasks?limit=10');
      expect(tasks.json().data).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: runId, status: 'failed', canStop: false })
      ]));
    } finally {
      await app.close();
    }
  });

  it('主编发现正式资料冲突后等待作者处理，不把语义决定误当成员失败反复交接', async () => {
    context = createTestContext('wenmi-v7-planning-source-issues-');
    const resolver = new SourceIssuePlanningResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'planning-source-issues@example.com', '资料校对作者');
      const bookId = await createBook(app, cookie, '资料口径测试书');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-routes/runs`, {
        authorGoal: '保持张三是行动中心。', idempotencyKey: 'planning-source-issues-run-0001'
      });
      const runId = started.json().data.runId as string;
      const waiting = await pollRouteRun(app, cookie, bookId, runId);

      expect(waiting).toMatchObject({
        status: 'waiting_for_you', phase: 'waiting_for_you', canDecide: false,
        sourceIssues: ['总兵力在两项正式设定中分别为八千和三万，需要作者统一。']
      });
      expect(waiting.routes).toEqual([]);
      expect(waiting.message).toContain('请先统一');
      expect(resolver.calls).toBe(1);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_planning_recipe_proposals
        WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, runId)).toEqual({ count: 0 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_planning_route_candidates
        WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, runId)).toEqual({ count: 0 });
      const refreshed = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-routes/runs/${runId}`);
      expect(refreshed.json().data.sourceIssues).toEqual(waiting.sourceIssues);
      expect(resolver.calls).toBe(1);
      const tasks = await request(app, cookie, 'GET', '/api/v1/v7/planning-tasks?limit=10');
      expect(tasks.json().data).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: runId, status: 'waiting_for_you', canStop: false })
      ]));
    } finally {
      await app.close();
    }
  });

  it('长任务可停止，停止后后台返回也不能覆盖已停止状态', async () => {
    context = createTestContext('wenmi-v7-planning-cancel-');
    const resolver = new BlockingPlanningResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'planning-cancel@example.com', '暂停测试作者');
      const bookId = await createBook(app, cookie, '暂停测试书');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-routes/runs`, {
        authorGoal: '张三穿越北宋，从底层成长但不替代历史人物。',
        candidateCount: 3,
        idempotencyKey: 'planning-cancel-run-0001'
      });
      expect(started.statusCode).toBe(200);
      const runId = started.json().data.runId as string;
      await resolver.waitUntilEntered();
      const working = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-routes/runs/${runId}`);
      expect(working.statusCode).toBe(200);
      expect(working.json().data.actors).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: '资料策划', status: 'working' }),
        expect.objectContaining({ memberKey: 'chief-deepseek-v4-pro', status: 'waiting' }),
        expect.objectContaining({ memberKey: 'chief-glm-5-3', status: 'waiting' }),
        expect.objectContaining({ memberKey: 'chief-kimi-k3', status: 'waiting' })
      ]));
      const stopped = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-routes/runs/${runId}/cancel`, {});
      expect(stopped.statusCode).toBe(200);
      resolver.release();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const tasks = await request(app, cookie, 'GET', '/api/v1/v7/planning-tasks?limit=10');
      expect(tasks.statusCode).toBe(200);
      expect(tasks.json().data).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: runId, ownerId, bookId, status: 'cancelled', canStop: false })
      ]));
      expect(context.database.prepare('SELECT status,current_phase FROM v7_planning_recipe_runs WHERE run_id=?')
        .get(runId)).toEqual({ status: 'cancelled', current_phase: 'cancelled' });
    } finally {
      resolver.release();
      await app.close();
    }
  });

  it('全案输出被截断时只让原主编低温修复一次，不把整案交给下一名主编重做', async () => {
    context = createTestContext('wenmi-v7-planning-direct-repair-');
    const resolver = new RepairingDirectPlanningResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'planning-direct-repair@example.com', '结构修复作者');
      const bookId = await createBook(app, cookie, '结构修复测试书');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-routes/runs`, {
        authorGoal: '张三必须始终是主角。', candidateCount: 3,
        idempotencyKey: 'planning-direct-repair-run-0001'
      });
      const ready = await pollRouteRun(app, cookie, bookId, started.json().data.runId as string);
      expect(ready).toMatchObject({ status: 'waiting_for_you', canDecide: true });
      expect(ready.routes).toHaveLength(3);
      expect(context.database.prepare(`SELECT node_key,member_key,state FROM v7_planning_model_calls
        WHERE owner_id=? AND book_id=? AND node_key IN ('direct_story_route:chief_editor','direct_story_route_repair:chief_editor')
        ORDER BY started_at`).all(ownerId, bookId)).toEqual([
        { node_key: 'direct_story_route:chief_editor', member_key: 'chief-deepseek-v4-pro', state: 'succeeded' },
        { node_key: 'direct_story_route_repair:chief_editor', member_key: 'chief-deepseek-v4-pro', state: 'succeeded' }
      ]);
      expect(resolver.prompts.some((prompt) => prompt.includes('不要改写方案方向'))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('三席同源独立出案，单成员失败只交接本席，作者确认后形成不可变配方', async () => {
    context = createTestContext('wenmi-v7-planning-editorial-');
    const resolver = new PlanningResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'planning-editorial@example.com', '规划作者');
      const bookId = await createBook(app, cookie, '张三北宋录');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-recipes/runs`, {
        authorGoal: '计划写三百万字，分八卷，张三必须始终是主角。',
        candidateCount: 3,
        idempotencyKey: 'planning-recipe-run-0001'
      });
      expect(started.statusCode).toBe(200);
      const runId = started.json().data.runId as string;
      const ready = await poll(app, cookie, bookId, runId);
      expect(ready).toMatchObject({ status: 'waiting_for_you', completedSeats: 3, totalSeats: 3, canConfirm: true });
      expect(ready.proposals.map((proposal: { seat: string }) => proposal.seat).sort()).toEqual(['全案主编一席', '全案主编二席', '全案主编三席'].sort());
      expect(ready.comparison.summary).toContain('推荐');
      expect(JSON.stringify(ready)).not.toMatch(/provider|modelId|prompt|hash|sourceFingerprint/iu);
      expect(resolver.prompts.filter((prompt) => prompt.includes('你看不到其他席位答案'))).toHaveLength(4);
      expect(resolver.prompts.filter((prompt) => prompt.includes('三份已经独立保存的方案比较'))).toHaveLength(1);

      const structureCalls = context.database.prepare(`SELECT member_key,state FROM v7_planning_model_calls
        WHERE owner_id=? AND book_id=? AND node_key='structure_deputy' ORDER BY started_at,request_id`)
        .all(ownerId, bookId) as Array<{ member_key: string; state: string }>;
      expect(structureCalls).toEqual([
        { member_key: 'chief-glm-5-3', state: 'failed' },
        { member_key: 'chief-kimi-k3', state: 'succeeded' }
      ]);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_planning_recipe_proposals
        WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, runId)).toEqual({ count: 4 });

      const confirmed = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-recipes/runs/${runId}/confirm`, {
        choice: 'comparison', authorNote: '保留张三主角地位，卷数后续允许调整。',
        idempotencyKey: 'planning-recipe-confirm-0001'
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().data).toMatchObject({ status: 'confirmed', revision: 1, nextStep: 'book_tree' });
      expect(context.database.prepare(`SELECT lifecycle,COUNT(*) AS count FROM v7_planning_recipe_versions
        WHERE owner_id=? AND book_id=? GROUP BY lifecycle`).all(ownerId, bookId)).toEqual([{ lifecycle: 'confirmed', count: 1 }]);
      const repeated = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-recipes/runs/${runId}/confirm`, {
        choice: 'comparison', authorNote: '保留张三主角地位，卷数后续允许调整。',
        idempotencyKey: 'planning-recipe-confirm-0001'
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.recipeVersionId).toBe(confirmed.json().data.recipeVersionId);

      const blockedBeforeRoute = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/generation-runs`, {
          idempotencyKey: 'book-tree-blocked-before-route-0001'
        });
      expect(blockedBeforeRoute.statusCode).toBe(409);

      const routeStarted = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-routes/runs`, {
        authorGoal: '计划写三百万字，分八卷，张三必须始终是主角。',
        candidateCount: 3,
        idempotencyKey: 'planning-route-run-0001'
      });
      expect(routeStarted.statusCode).toBe(200);
      expect(parseProgressivePlanningBrief(progressiveBriefOutput('路线一'), 'chief_editor', []).selectedStrategies)
        .toHaveLength(4);
      const routeRunId = routeStarted.json().data.runId as string;
      const routesReady = await pollRouteRun(app, cookie, bookId, routeRunId);
      if (routesReady.status === 'failed') {
        const failedCalls = context.database.prepare(`SELECT node_key,member_key,state,failure_message,substr(output_text,1,400) AS output_preview FROM v7_planning_model_calls
          WHERE owner_id=? AND book_id=? AND run_id=? ORDER BY started_at,request_id`)
          .all(ownerId, bookId, routeRunId);
        const proposalCount = context.database.prepare(`SELECT COUNT(*) AS count FROM v7_planning_recipe_proposals
          WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, routeRunId);
        throw new Error(`路线任务失败：${routesReady.errorMessage ?? routesReady.message}；提案=${JSON.stringify(proposalCount)}；调用数=${failedCalls.length}`);
      }
      expect(routesReady).toMatchObject({ status: 'waiting_for_you', canDecide: true });
      expect(routesReady.routes).toHaveLength(3);
      expect(routesReady.chiefReview.routeReviews).toHaveLength(3);
      expect(routesReady.routes.every((route: { targetVolumes: number; commercialAudience: string; retentionPositioning: string }) =>
        route.targetVolumes > 0 && route.commercialAudience.length > 0 && route.retentionPositioning.length > 0)).toBe(true);
      expect(routesReady.chiefReview.routeReviews.every((review: {
        volumeJudgement: string; audienceJudgement: string; retentionJudgement: string;
      }) => review.volumeJudgement.length > 0 && review.audienceJudgement.length > 0 && review.retentionJudgement.length > 0)).toBe(true);
      expect(new Set(routesReady.routes.map((route: { title: string }) => route.title)).size).toBe(3);
      expect(new Set(routesReady.routes.map((route: { memberName: string }) => route.memberName)).size).toBe(3);
      expect(new Set(routesReady.actors.map((actor: { memberName: string }) => actor.memberName)).size).toBe(routesReady.actors.length);
      expect(JSON.stringify(routesReady)).not.toMatch(/methodKey|modelId|provider|prompt|temperature|sourceFingerprint/iu);
      const routeManifestRoles = context.database.prepare(`SELECT DISTINCT manifest.role_key
        FROM v7_prompt_manifests manifest
        JOIN v7_planning_model_calls call ON call.request_id=manifest.task_id
        WHERE call.owner_id=? AND call.book_id=? AND call.run_id=? ORDER BY manifest.role_key`)
        .all(ownerId, bookId, routeRunId) as Array<{ role_key: string }>;
      expect(routeManifestRoles.map((row) => row.role_key)).toEqual(['chief_editor', 'deputy_editor']);

      const storedRoster = context.database.prepare(`SELECT roster_json FROM v7_planning_recipe_runs
        WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, routeRunId) as { roster_json: string };
      const historicalRoster = JSON.parse(storedRoster.roster_json) as {
        directChiefs: Array<{ roleKey: string }>;
      };
      historicalRoster.directChiefs[1]!.roleKey = 'structure_deputy';
      context.database.prepare(`UPDATE v7_planning_recipe_runs SET roster_json=?
        WHERE owner_id=? AND book_id=? AND run_id=?`).run(JSON.stringify(historicalRoster), ownerId, bookId, routeRunId);
      const historicalView = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-routes/runs/${routeRunId}`);
      expect(historicalView.statusCode).toBe(200);
      expect(historicalView.json().data.actors.some((actor: { role: string }) => actor.role === '全案规划主编')).toBe(true);
      expect(JSON.stringify(historicalView.json().data.actors)).not.toMatch(/structure_deputy|commercial_deputy/u);

      const invalidAdjustment = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-routes/runs/${routeRunId}/decision`, {
          mode: 'adjust', routeIds: [routesReady.routes[0].routeId], authorNote: '',
          idempotencyKey: 'planning-route-adjustment-without-note-0001'
        });
      expect(invalidAdjustment.statusCode).toBe(400);
      expect(JSON.stringify(invalidAdjustment.json())).toContain('请先写下需要调整');

      const routeDecision = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-routes/runs/${routeRunId}/decision`, {
          mode: 'select', routeIds: [routesReady.routes[0].routeId], authorNote: '',
          idempotencyKey: 'planning-route-decision-0001'
        });
      expect(routeDecision.statusCode).toBe(200);
      expect(routeDecision.json().data).toMatchObject({ status: 'confirmed', nextStep: 'book_tree' });
      const selectedCandidate = context.database.prepare(`SELECT route_json FROM v7_planning_route_candidates
        WHERE owner_id=? AND book_id=? AND run_id=? AND route_id=?`)
        .get(ownerId, bookId, routeRunId, routesReady.routes[0].routeId) as { route_json: string };
      const confirmedRoute = context.database.prepare(`SELECT route_json,source_route_ids_json FROM v7_planning_route_versions
        WHERE owner_id=? AND book_id=? AND lifecycle='confirmed'`)
        .get(ownerId, bookId) as { route_json: string; source_route_ids_json: string };
      expect(JSON.parse(confirmedRoute.route_json)).toEqual(JSON.parse(selectedCandidate.route_json));
      expect(JSON.parse(confirmedRoute.source_route_ids_json)).toEqual([routesReady.routes[0].routeId]);
      expect(JSON.stringify(JSON.parse(confirmedRoute.route_json))).not.toContain(routesReady.routes[1].title);
      expect(JSON.stringify(JSON.parse(confirmedRoute.route_json))).not.toContain(routesReady.routes[2].title);
      const repeatedRouteDecision = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-routes/runs/${routeRunId}/decision`, {
          mode: 'select', routeIds: [routesReady.routes[0].routeId], authorNote: '',
          idempotencyKey: 'planning-route-decision-0001'
        });
      expect(repeatedRouteDecision.statusCode).toBe(200);
      expect(repeatedRouteDecision.json().data).toEqual(routeDecision.json().data);

      const latestRoute = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-routes/latest`);
      expect(latestRoute.statusCode).toBe(200);
      expect(latestRoute.json().data).toMatchObject({ runId: routeRunId, status: 'completed' });

      const methodSearchPrompts = resolver.prompts.filter((prompt) => prompt.includes('v7-planning-method-search-v1'));
      expect(methodSearchPrompts).toHaveLength(1);
      const briefPrompts = resolver.prompts.filter((prompt) => prompt.includes('你是文秘写作V7的一名全案规划主编'));
      expect(briefPrompts).toHaveLength(3);
      expect(briefPrompts.every((prompt) => prompt.includes('少量候选方法中选4—6项'))).toBe(true);
      const searches = context.database.prepare(`SELECT search_request_json,candidate_methods_json FROM v7_planning_method_searches
        WHERE owner_id=? AND book_id=? AND run_id=?`).all(ownerId, bookId, routeRunId) as Array<{
          search_request_json: string; candidate_methods_json: string;
        }>;
      expect(searches).toHaveLength(1);
      expect(searches.every((row) => {
        const ids = (JSON.parse(row.search_request_json) as { relevantSettingSourceIds: string[] }).relevantSettingSourceIds;
        return ids.length > 0 && !ids.includes(`setting-ledger:${bookId}`);
      })).toBe(true);
      expect(searches.every((row) => (JSON.parse(row.candidate_methods_json) as unknown[]).length <= 12)).toBe(true);
      const settingSourceTraces = context.database.prepare(`SELECT trace.owner_id AS ownerId,trace.book_id AS bookId,
        trace.source_id AS sourceId,trace.source_version AS sourceVersion,trace.decision,trace.reason
        FROM v7_context_source_traces trace
        JOIN v7_prompt_manifests manifest ON manifest.context_pack_id=trace.context_pack_id
        JOIN v7_planning_model_calls model_call ON model_call.request_id=manifest.task_id
        WHERE model_call.owner_id=? AND model_call.book_id=? AND model_call.run_id=?
          AND model_call.node_key LIKE 'direct_story_route:%' AND trace.source_type='setting'`)
        .all(ownerId, bookId, routeRunId) as Array<{
          ownerId: string; bookId: string; sourceId: string; sourceVersion: string;
          decision: 'included' | 'excluded'; reason: string;
        }>;
      expect(settingSourceTraces.length).toBeGreaterThanOrEqual(3);
      expect(settingSourceTraces.every((trace) => trace.ownerId === ownerId && trace.bookId === bookId)).toBe(true);
      expect(settingSourceTraces.every((trace) => trace.sourceVersion.length > 0
        && (trace.decision === 'included' || trace.decision === 'excluded'))).toBe(true);
      expect(settingSourceTraces.some((trace) => trace.sourceId === `setting-ledger:${bookId}`
        && trace.decision === 'included')).toBe(true);
      expect(settingSourceTraces.some((trace) => trace.sourceId !== `setting-ledger:${bookId}`
        && trace.decision === 'included')).toBe(true);
      const storyPrompts = resolver.prompts.filter((prompt) => prompt.includes('你是长篇小说规划编剧'));
      expect(storyPrompts).toHaveLength(0);

      const bookTree = await generateTree(app, cookie, bookId, 'book', bookId, 'book-tree-generation-0001');
      if (bookTree.status === 'failed') throw new Error(`全书树任务失败：${bookTree.message}`);
      expect(bookTree).toMatchObject({ status: 'ready', treeKind: 'book', scopeId: bookId, canOpenCandidate: true });
      const bookView = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}`);
      expect(bookView.statusCode).toBe(200);
      expect(bookView.json().data).toMatchObject({ treeKind: 'book', status: 'candidate', revision: 1 });
      expect(JSON.stringify(bookTree)).not.toMatch(/provider|modelId|prompt|hash|sourceFingerprint/iu);
      const planningTasks = await request(app, cookie, 'GET', '/api/v1/v7/planning-tasks?limit=20');
      expect(planningTasks.statusCode).toBe(200);
      expect(planningTasks.json().data).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: routeRunId, taskKind: 'planning_route', ownerId, bookId, status: 'completed' }),
        expect.objectContaining({ taskId: bookTree.runId, taskKind: 'planning_tree', ownerId, bookId, status: 'waiting_for_you' })
      ]));
      await confirmTree(app, cookie, bookId, 'book', bookId, 1, 'confirm-book-tree-0001');

      const volumeTree = await generateTree(app, cookie, bookId, 'volume', 'volume-1', 'volume-tree-generation-0001');
      expect(volumeTree).toMatchObject({ status: 'ready', treeKind: 'volume', scopeId: 'volume-1' });
      await confirmTree(app, cookie, bookId, 'volume', 'volume-1', 1, 'confirm-volume-tree-0001');

      const chainTree = await generateTree(app, cookie, bookId, 'chain', 'chain-1', 'chain-tree-generation-0001');
      expect(chainTree).toMatchObject({ status: 'ready', treeKind: 'chain', scopeId: 'chain-1' });
      await confirmTree(app, cookie, bookId, 'chain', 'chain-1', 1, 'confirm-chain-tree-0001');
      const treeCalls = context.database.prepare(`SELECT node_key,member_key,state FROM v7_planning_model_calls
        WHERE owner_id=? AND book_id=? AND run_kind='tree' ORDER BY started_at,request_id`)
        .all(ownerId, bookId) as Array<{ node_key: string; member_key: string; state: string }>;
      expect(treeCalls.filter((call) => call.node_key === 'context_plan')).toHaveLength(3);
      expect(treeCalls.filter((call) => call.node_key === 'context_plan')
        .every((call) => call.state === 'succeeded' && call.member_key.startsWith('deputy-'))).toBe(true);
      expect(treeCalls.filter((call) => call.node_key !== 'context_plan').slice(0, 4)).toEqual([
        { node_key: `book:${bookId}`, member_key: 'planner-deepseek-v4-pro', state: 'succeeded' },
        { node_key: `book:${bookId}:repair`, member_key: 'planner-deepseek-v4-pro', state: 'succeeded' },
        { node_key: 'volume:volume-1', member_key: 'planner-deepseek-v4-pro', state: 'failed' },
        { node_key: 'volume:volume-1', member_key: 'planner-glm-5-3', state: 'succeeded' }
      ]);
      expect(treeCalls.filter((call) => call.state === 'succeeded')).toHaveLength(7);
      expect(context.database.prepare(`SELECT operation_mode,based_on_task_id FROM v7_task_contracts
        WHERE owner_id=? AND book_id=? AND task_id=?`).get(
        ownerId, bookId, `${bookTree.runId}:tree:1:repair`
      )).toEqual({ operation_mode: 'repair', based_on_task_id: `${bookTree.runId}:tree:1` });

      const confirmedHashBefore = (context.database.prepare(`SELECT content_hash FROM v7_planning_tree_versions
        WHERE owner_id=? AND book_id=? AND tree_kind='chain' AND scope_id='chain-1' AND lifecycle='confirmed'`)
        .get(ownerId, bookId) as { content_hash: string }).content_hash;
      insertSettlement(ownerId, bookId);
      const maintenance = new V7PlanningMaintenanceService(
        context.database, resolver, new UuidGenerator(), new SystemClock()
      );
      const maintenanceStarted = maintenance.trigger(ownerId, bookId, 'event_settlement', 'settlement-event-1');
      const maintained = await pollMaintenance(maintenance, ownerId, bookId, maintenanceStarted.runId);
      expect(maintained, maintained.errorMessage ?? maintained.message)
        .toMatchObject({ status: 'completed', actualCount: 1, suggestionCount: 1 });
      expect(context.database.prepare(`SELECT contract.operation_mode,contract.based_on_task_id,
        contract.author_instruction_version FROM v7_task_contracts contract
        JOIN v7_prompt_manifests manifest ON manifest.task_id=contract.task_id
          AND manifest.owner_id=contract.owner_id AND manifest.book_id=contract.book_id
        JOIN v7_planning_model_calls model_call ON model_call.member_key=manifest.member_key
          AND model_call.owner_id=manifest.owner_id AND model_call.book_id=manifest.book_id
        WHERE model_call.owner_id=? AND model_call.book_id=? AND model_call.run_id=?
          AND model_call.run_kind='maintenance' AND model_call.state='succeeded' LIMIT 1`)
        .get(ownerId, bookId, maintenanceStarted.runId)).toEqual({
          operation_mode: 'fresh', based_on_task_id: null, author_instruction_version: null
        });
      const repeatedMaintenance = maintenance.trigger(ownerId, bookId, 'event_settlement', 'settlement-event-1');
      expect(repeatedMaintenance.runId).toBe(maintenanceStarted.runId);
      const chainAfter = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-trees/chain/chain-1`);
      expect(chainAfter.statusCode).toBe(200);
      expect(chainAfter.json().data.root.children[0].actual).toMatchObject({ state: 'deviated', outcome: '张三保住小队但提前暴露能力。' });
      const suggestions = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-adjustment-suggestions`);
      expect(suggestions.statusCode).toBe(200);
      expect(suggestions.json().data).toHaveLength(1);
      expect(suggestions.json().data[0].detail.proposedChange).toContain('未来');
      const confirmedHashAfter = (context.database.prepare(`SELECT content_hash FROM v7_planning_tree_versions
        WHERE owner_id=? AND book_id=? AND tree_kind='chain' AND scope_id='chain-1' AND lifecycle='confirmed'`)
        .get(ownerId, bookId) as { content_hash: string }).content_hash;
      expect(confirmedHashAfter).toBe(confirmedHashBefore);
      context.database.prepare(`UPDATE user_accounts SET role='admin'
        WHERE email_normalized='planning-editorial@example.com'`).run();
      const adminPlanningTasks = await app.inject({
        method: 'GET', url: '/api/v1/v7/admin/planning-tasks?limit=20',
        headers: { host: HEADERS.host, cookie }
      });
      expect(adminPlanningTasks.statusCode).toBe(200);
      expect(adminPlanningTasks.json().data).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: routeRunId, ownerId, bookId }),
        expect.objectContaining({ taskId: chainTree.runId, ownerId, bookId, treeKind: 'chain' })
      ]));
      const routeAudit = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/v7/planning-runtime/recipe/${routeRunId}?ownerId=${encodeURIComponent(ownerId)}&bookId=${encodeURIComponent(bookId)}`,
        headers: { host: HEADERS.host, cookie }
      });
      expect(routeAudit.statusCode).toBe(200);
      expect(routeAudit.json().data).toMatchObject({
        methodSearches: expect.arrayContaining([expect.objectContaining({ retrieval_version: 'v7-method-retrieval-1' })]),
        methodProposals: expect.any(Array), storyRoutes: expect.any(Array),
        routeReview: expect.objectContaining({ review: expect.objectContaining({ schema: 'v7-planning-route-review-v1' }) })
      });
      expect(routeAudit.json().data.methodSearches).toHaveLength(1);
      expect(routeAudit.json().data.storyRoutes).toHaveLength(3);
      const audit = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/v7/planning-runtime/maintenance/${maintenanceStarted.runId}?ownerId=${encodeURIComponent(ownerId)}&bookId=${encodeURIComponent(bookId)}`,
        headers: { host: HEADERS.host, cookie }
      });
      expect(audit.statusCode).toBe(200);
      expect(audit.json().data).toMatchObject({
        run: { source_kind: 'event_settlement', status: 'succeeded' },
        actuals: [expect.objectContaining({ node_key: 'chain-event-1' })],
        suggestions: [expect.objectContaining({ node_key: 'chain-event-1', state: 'pending' })],
        calls: expect.arrayContaining([
          expect.objectContaining({ member_key: 'continuity-deepseek-v4-pro', state: 'failed' }),
          expect.objectContaining({ member_key: 'continuity-glm-5-3', state: 'succeeded' })
        ])
      });
      const maintenanceManifestRoles = context.database.prepare(`SELECT DISTINCT manifest.role_key
        FROM v7_prompt_manifests manifest
        JOIN v7_planning_model_calls call ON call.member_key=manifest.member_key
          AND call.owner_id=manifest.owner_id AND call.book_id=manifest.book_id
        WHERE call.owner_id=? AND call.book_id=? AND call.run_id=?`)
        .all(ownerId, bookId, maintenanceStarted.runId) as Array<{ role_key: string }>;
      expect(maintenanceManifestRoles.map((row) => row.role_key)).toEqual(['continuity_editor']);

      const suggestionId = suggestions.json().data[0].suggestionId as string;
      const accepted = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-adjustment-suggestions/${suggestionId}/decision`, {
          decision: 'accept', authorNote: '下一版把暴露能力后的追查压力写进去。',
          idempotencyKey: 'accept-planning-adjustment-0001'
        });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().data).toEqual({ suggestionId, state: 'accepted', nextEffect: 'next_candidate_only' });
      const acceptedAgain = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-adjustment-suggestions/${suggestionId}/decision`, {
          decision: 'accept', authorNote: '下一版把暴露能力后的追查压力写进去。',
          idempotencyKey: 'accept-planning-adjustment-0001'
        });
      expect(acceptedAgain.statusCode).toBe(200);
      expect(acceptedAgain.json().data).toEqual(accepted.json().data);
      const pendingAfterDecision = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-adjustment-suggestions`);
      expect(pendingAfterDecision.json().data).toEqual([]);

      const regenerated = await generateTree(app, cookie, bookId, 'chain', 'chain-1', 'chain-tree-after-adjustment-0001');
      expect(regenerated.status).toBe('ready');
      const acceptedSource = context.database.prepare(`SELECT i.label,i.authority
        FROM v7_planning_generation_runs r JOIN v7_planning_source_items i ON i.snapshot_id=r.source_snapshot_id
        WHERE r.owner_id=? AND r.book_id=? AND r.idempotency_key=? AND i.source_id=?`)
        .get(ownerId, bookId, 'chain-tree-after-adjustment-0001', suggestionId);
      expect(acceptedSource).toEqual({ label: '作者已采纳的未来调整方向', authority: 'goal' });
      expect((context.database.prepare(`SELECT content_hash FROM v7_planning_tree_versions
        WHERE owner_id=? AND book_id=? AND tree_kind='chain' AND scope_id='chain-1' AND lifecycle='confirmed'`)
        .get(ownerId, bookId) as { content_hash: string }).content_hash).toBe(confirmedHashBefore);

      const fusionRunStarted = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-routes/runs`, {
        authorGoal: '在保持张三主动成长的前提下，重新准备三套可以融合的长期方向。',
        candidateCount: 3,
        idempotencyKey: 'planning-route-run-for-fusion-0001'
      });
      expect(fusionRunStarted.statusCode).toBe(200);
      const fusionRunId = fusionRunStarted.json().data.runId as string;
      const fusionRoutes = await pollRouteRun(app, cookie, bookId, fusionRunId);
      if (fusionRoutes.status === 'failed') throw new Error(`融合前路线任务失败：${fusionRoutes.errorMessage ?? fusionRoutes.message}`);
      expect(fusionRoutes.routes).toHaveLength(3);
      const fusionRouteIds = fusionRoutes.routes.slice(0, 2).map((route: { routeId: string }) => route.routeId);
      const merged = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-routes/runs/${fusionRunId}/decision`, {
          mode: 'merge', routeIds: fusionRouteIds,
          authorNote: '保留第一套的小人物立足和第二套的家国目标，但岳飞不能代替张三完成关键选择。',
          idempotencyKey: 'planning-route-merge-0001'
        });
      expect(merged.statusCode).toBe(200);
      expect(merged.json().data).toMatchObject({ status: 'confirmed', nextStep: 'book_tree' });
      const mergedAgain = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-routes/runs/${fusionRunId}/decision`, {
          mode: 'merge', routeIds: fusionRouteIds,
          authorNote: '保留第一套的小人物立足和第二套的家国目标，但岳飞不能代替张三完成关键选择。',
          idempotencyKey: 'planning-route-merge-0001'
        });
      expect(mergedAgain.statusCode).toBe(200);
      expect(mergedAgain.json().data).toEqual(merged.json().data);
      expect(context.database.prepare(`SELECT decision_kind,author_note,source_route_ids_json
        FROM v7_planning_route_decisions WHERE owner_id=? AND book_id=? AND run_id=?`)
        .get(ownerId, bookId, fusionRunId)).toEqual({
          decision_kind: 'merge',
          author_note: '保留第一套的小人物立足和第二套的家国目标，但岳飞不能代替张三完成关键选择。',
          source_route_ids_json: JSON.stringify(fusionRouteIds)
        });
      const fusionCalls = context.database.prepare(`SELECT node_key,state FROM v7_planning_model_calls
        WHERE owner_id=? AND book_id=? AND run_id=? AND node_key='route_fusion'`)
        .all(ownerId, bookId, fusionRunId) as Array<{ node_key: string; state: string }>;
      expect(fusionCalls).toEqual([{ node_key: 'route_fusion', state: 'succeeded' }]);
      expect(context.database.prepare(`SELECT contract.operation_mode,contract.based_on_task_id,
        contract.author_instruction_version FROM v7_task_contracts contract
        JOIN v7_planning_model_calls model_call ON model_call.request_id=contract.task_id
        WHERE model_call.owner_id=? AND model_call.book_id=? AND model_call.run_id=?
          AND model_call.node_key='route_fusion' LIMIT 1`).get(ownerId, bookId, fusionRunId)).toEqual({
        operation_mode: 'fusion', based_on_task_id: null, author_instruction_version: null
      });

      const otherCookie = await register(app, 'planning-outsider@example.com', '另一位作者');
      const isolated = await request(app, otherCookie, 'GET',
        `/api/v1/v7/books/${bookId}/planning-tree-generation-runs/${bookTree.runId}`);
      expect(isolated.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('旧半失败配方任务保持终态，刷新不再伪装工作中或重复调用', async () => {
    context = createTestContext('wenmi-v7-planning-partial-terminal-');
    const resolver = new PartialRecipeResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'planning-partial@example.com', '半失败作者');
      const bookId = await createBook(app, cookie, '半失败规划测试');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-recipes/runs`, {
        authorGoal: '设计全书粗路线。', idempotencyKey: 'planning-partial-run-0001'
      });
      const runId = started.json().data.runId as string;
      const failed = await poll(app, cookie, bookId, runId);
      expect(failed).toMatchObject({ status: 'failed', completedSeats: 2, canConfirm: false });
      expect(failed.message).toMatch(/^对不起/u);
      expect(failed.message).toContain('已保留完成内容');
      expect(failed.message).toContain('重新开始');
      expect(context.database.prepare(`SELECT status FROM v7_planning_recipe_runs
        WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, runId)).toEqual({ status: 'partially_failed' });
      const callsAfterFailure = resolver.calls;
      for (let index = 0; index < 2; index += 1) {
        const refreshed = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-recipes/runs/${runId}`);
        expect(refreshed.json().data).toMatchObject({ status: 'failed', completedSeats: 2 });
      }
      expect(resolver.calls).toBe(callsAfterFailure);
    } finally { await app.close(); }
  });
});

class BlockingPlanningResolver implements V7OpeningModelAdapterResolver {
  private releaseGate!: () => void;
  private enteredGate!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.releaseGate = resolve; });
  private readonly entered = new Promise<void>((resolve) => { this.enteredGate = resolve; });
  private announced = false;

  public waitUntilEntered(): Promise<void> { return this.entered; }
  public release(): void { this.releaseGate(); }
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (): Promise<ModelResult> => {
      if (!this.announced) { this.announced = true; this.enteredGate(); }
      await this.gate;
      return {
        provider, modelId, output: methodSearchOutput(), inputTokens: 20, outputTokens: 20,
        cashCostCny: 0, state: 'succeeded'
      };
    } };
  }
}

class AlwaysFailingPlanningResolver implements V7OpeningModelAdapterResolver {
  public calls = 0;
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (): Promise<ModelResult> => {
      this.calls += 1;
      throw new SyntaxError("Expected ',' or '}' after property value in JSON at position 13153 (line 1 column 13154)");
    } };
  }
}

class SourceIssuePlanningResolver implements V7OpeningModelAdapterResolver {
  public calls = 0;
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (): Promise<ModelResult> => {
      this.calls += 1;
      return {
        provider, modelId, output: JSON.stringify({
          ...JSON.parse(methodSearchOutput()),
          missingCriticalInputs: ['总兵力在两项正式设定中分别为八千和三万，需要作者统一。']
        }),
        inputTokens: 100, outputTokens: 100, cashCostCny: 0, state: 'succeeded'
      };
    } };
  }
}

class RepairingDirectPlanningResolver implements V7OpeningModelAdapterResolver {
  public readonly prompts: string[] = [];
  private malformedReturned = false;
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      const prompt = stageTaskPrompt(request.prompt);
      this.prompts.push(prompt);
      let output: string;
      if (prompt.includes('v7-planning-method-search-v1')) {
        output = methodSearchOutput(prompt);
      } else if (prompt.includes('v7-planning-route-review-v1')) {
        output = routeReviewOutput(prompt);
      } else if (prompt.includes('你刚才设计的全书方向内容可以保留')) {
        output = routeFusionOutput(prompt);
      } else if (prompt.includes('v7-planning-route-fusion-v2')) {
        output = routeFusionOutput(prompt);
        if (!this.malformedReturned) {
          this.malformedReturned = true;
          output = output.slice(0, -24);
        }
      } else {
        output = routeFusionOutput(prompt);
      }
      return { provider, modelId, output, inputTokens: 200, outputTokens: 900, cashCostCny: 0, state: 'succeeded' };
    } };
  }
}

class PlanningResolver implements V7OpeningModelAdapterResolver {
  public readonly prompts: string[] = [];
  private failedStructure = false;
  private returnedMalformedBookTree = false;
  private failedVolumeWriter = false;
  private failedMaintainer = false;
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      this.prompts.push(request.prompt);
      const stagePrompt = stageTaskPrompt(request.prompt);
      if (request.agentId === 'chief-glm-5-3' && !this.failedStructure) {
        this.failedStructure = true;
        throw new Error('模拟全案主编二席临时请假');
      }
      if (request.agentId === 'planner-deepseek-v4-pro'
        && stagePrompt.includes('PlanningTreeDocument')
        && stagePrompt.includes('treeKind固定为volume')
        && !request.requestId.endsWith(':repair')
        && !this.failedVolumeWriter) {
        this.failedVolumeWriter = true;
        throw new Error('模拟规划编剧临时请假');
      }
      if (request.agentId === 'continuity-deepseek-v4-pro' && !this.failedMaintainer) {
        this.failedMaintainer = true;
        throw new Error('模拟规划维护员临时请假');
      }
      let output = stagePrompt.includes('v7-planning-maintenance-v1')
        ? planningMaintenanceOutput()
        : stagePrompt.includes('v7-planning-method-search-v1')
          ? methodSearchOutput(stagePrompt)
        : stagePrompt.includes('v7-planning-route-fusion-v2')
          ? routeFusionOutput(stagePrompt)
        : stagePrompt.includes('v7-planning-route-review-v1')
          ? routeReviewOutput(stagePrompt)
        : stagePrompt.includes('PlanningTreeDocument')
          ? planningTreeOutput(stagePrompt)
        : stagePrompt.includes('v7-planning-story-route-v1')
          ? storyRouteOutput(stagePrompt)
        : stagePrompt.includes('v7-progressive-planning-brief-v2')
          ? progressiveBriefOutput(stagePrompt)
          : stagePrompt.includes('三份已经独立保存的方案比较')
          ? comparisonOutput(stagePrompt)
          : proposalOutput(stagePrompt);
      if (request.agentId === 'planner-deepseek-v4-pro'
        && stagePrompt.includes('PlanningTreeDocument')
        && stagePrompt.includes('treeKind固定为book')
        && !request.requestId.endsWith(':repair')
        && !this.returnedMalformedBookTree) {
        this.returnedMalformedBookTree = true;
        output = output.slice(0, -24);
      }
      return { provider, modelId, output, inputTokens: 200, outputTokens: 900, cashCostCny: 0, state: 'succeeded' };
    }};
  }
}

class PartialRecipeResolver implements V7OpeningModelAdapterResolver {
  public calls = 0;
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      this.calls += 1;
      const prompt = stageTaskPrompt(request.prompt);
      if (prompt.includes('席位：全案主编三席')) throw new Error('模拟三席本轮全部请假');
      const output = prompt.includes('三份已经独立保存的方案比较')
        ? comparisonOutput(prompt)
        : proposalOutput(prompt);
      return { provider, modelId, output, inputTokens: 100, outputTokens: 300, cashCostCny: 0, state: 'succeeded' };
    }};
  }
}

class RetryPlanningMaintenanceResolver implements V7OpeningModelAdapterResolver {
  public calls = 0;
  public allowSuccess = false;
  public readonly prompts: string[] = [];
  public readonly requestIds: string[] = [];
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      this.calls += 1;
      this.prompts.push(request.prompt);
      this.requestIds.push(request.requestId);
      if (!this.allowSuccess) throw new Error('模拟全部规划维护员本轮请假');
      return {
        provider, modelId, output: planningMaintenanceOutput(), inputTokens: 100, outputTokens: 300,
        cashCostCny: 0, state: 'succeeded'
      };
    } };
  }
}

function stageTaskPrompt(compiledPrompt: string): string {
  try {
    const manifest = JSON.parse(compiledPrompt) as {
      contextPack?: { content?: { stageTaskPayload?: unknown } };
    };
    const payload = manifest.contextPack?.content?.stageTaskPayload;
    if (typeof payload === 'string') return payload;
    if (payload !== undefined) return JSON.stringify(payload);
  } catch {
    // Legacy and deliberately malformed prompts remain directly readable by the fixture.
  }
  return compiledPrompt;
}

function routeFusionOutput(prompt: string): string {
  const routeIds = [...prompt.matchAll(/"routeId":"([^"]+)"/gu)]
    .map((match) => match[1]!)
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 3);
  const routeNumber = prompt.includes('路线三') ? 3 : prompt.includes('路线二') ? 2 : 1;
  return JSON.stringify({
    schema: 'v7-planning-route-fusion-v2',
    publicSummary: '保留小人物立足的可信成长，并吸收家国目标形成更强的长期方向。',
    route: JSON.parse(storyRouteOutput(`第${routeNumber}套故事路线`)),
    brief: JSON.parse(progressiveBriefOutput(prompt)),
    adoptedParts: routeIds.map((routeId, index) => ({
      routeId,
      adopted: index === 0 ? '采用小人物逐步立足的成长路径。' : '采用家国目标带来的长期压力。'
    })),
    discardedRisks: ['不让历史名将替代张三完成核心选择']
  });
}

function progressiveBriefOutput(prompt: string): string {
  const seatKey = /"seatKey":"(chief_editor|structure_deputy|commercial_deputy)"/u.exec(prompt)?.[1]
    ?? (prompt.includes('路线二') ? 'structure_deputy' : prompt.includes('路线三') ? 'commercial_deputy' : 'chief_editor');
  const selectedStrategies = [
    {
      source: 'agent_original', title: '张三选择改变格局', layer: 'book_backbone',
      applicationNote: '每次扩大格局都由张三的一次主动选择及其后果推动。', caution: '不能让岳飞替张三完成核心选择。'
    },
    {
      source: 'agent_original', title: '胜利改变问题性质', layer: 'volume_distribution',
      applicationNote: '每卷胜利都打开不同性质的新问题，避免只换更强敌人。', caution: '阶段回报必须真实兑现。'
    },
    {
      source: 'agent_original', title: '历史关系双向改变', layer: 'volume_distribution',
      applicationNote: '历史人物与张三互相影响，关系变化同时改变政治和战争选择。', caution: '尊重正式资料中的时代边界。'
    },
    {
      source: 'agent_original', title: '底层资源转为长期筹码', layer: 'book_backbone',
      applicationNote: '张三在底层获得的人与资源必须在后续承担新的作用和代价。', caution: '不能靠凭空扩张解决资源问题。'
    }
  ];
  return JSON.stringify({
    schema: 'v7-progressive-planning-brief-v2', seatKey,
    publicSummary: '让张三从北宋底层立足，通过自己的选择逐卷改变旧秩序。',
    centralPromise: '张三从无名小卒成长为能够建立新秩序的人。',
    causalSpine: '每次阶段胜利都扩大张三的责任，并直接触发下一卷不同性质的问题。',
    protagonistArc: '张三从只求活命，成长为愿意承担天下后果的建立者。',
    longFormCapacity: '身份、班底、地方、朝堂和天下逐层扩大，足以承载八卷且不重复。',
    pressureRhythm: '压力从个人生存逐步扩大到团队、势力和天下，中段用一次真实崩塌改变路线。',
    payoffCadence: '每卷至少兑现一次不可逆的身份、关系或格局变化。',
    informationRhythm: '信息随张三地位扩大而展开，不提前讲透天下。',
    distinctiveness: '现代组织能力必须通过历史条件下的选择和代价落地。',
    selectedStrategies: selectedStrategies.slice(0, 6),
    creativeOpenings: ['具体历史节点允许合理架空', '每卷事件链进入该卷时再创造'],
    strengths: ['主角中心稳定', '卷间变化清楚'], risks: ['不能重复同一种立功升级'],
    authorDecisions: ['终局是否建立新朝']
  });
}

function methodSearchOutput(prompt = ''): string {
  const planningLayers = prompt.includes('单卷树资料策划') ? ['volume']
    : prompt.includes('单元链树资料策划') ? ['chain']
      : ['book_backbone', 'volume_distribution'];
  return JSON.stringify({
    schema: 'v7-planning-method-search-v1',
    publicGoal: '为三百万字历史长篇寻找全书递进、因果和追读方法。',
    taskPersona: {
      publicLabel: '历史成长与家国线融合策划身份',
      workingIdentity: '熟悉北宋社会约束、长篇成长递进和连载回报的本任务策划者',
      priorities: ['张三始终用自己的选择推动局势', '历史约束与成长回报同时成立'],
      authenticityChecks: ['关键资源和身份变化都有时代条件', '历史人物不替代张三完成核心选择'],
      avoidPatterns: ['不套固定升级模板', '不把岗位写成固定专业人设']
    },
    taskResponsibilities: ['把当前层目标拆成因果相连且有阶段回报的推进', '只使用会改变本轮设计的正式资料'],
    creativeSpace: ['可忽略全部候选方法并按本书人物原创', '允许在史实边界内设计独特冲突和回报'],
    searchQueries: ['长篇跨卷递进', '历史争霸因果升级', '阶段回报避免拖沓'],
    planningLayers,
    dimensions: ['macro_architecture', 'causal_dynamics', 'serial_rhythm'],
    desiredCount: 10,
    scaleHint: '三百万字、约八卷的历史长篇。',
    avoidNotes: ['不引入系统或超凡能力', '不能让岳飞替代张三成为行动中心'],
    relevantSettingSourceIds: ['planning-setting-version'],
    missingCriticalInputs: []
  });
}

function storyRouteOutput(prompt: string): string {
  const routeNumber = Number(/第(\d+)套故事路线/u.exec(prompt)?.[1] ?? '1');
  const variants = [
    ['边军立足到新政破局', '从小卒立足、整军、守土，最终以新政改变旧秩序。'],
    ['结盟岳飞北伐复国', '从救下一支败军开始，与岳飞结盟推进北伐并承担权力代价。'],
    ['民生经营到天下归心', '从安置流民和经营一城开始，以组织能力积累统一全国的根基。']
  ] as const;
  const [title, promise] = variants[Math.max(0, Math.min(2, routeNumber - 1))]!;
  const targetWords = 3_000_000;
  const targetVolumes = 8;
  return JSON.stringify({
    schema: 'v7-planning-story-route-v1', routeTitle: title, oneLinePromise: promise,
    publicSummary: `${title}让张三始终用自己的选择推动局势。`,
    readingExperience: routeNumber === 1 ? '稳步升级、战争与治理交替兑现。' : routeNumber === 2 ? '强目标北伐，结盟与分歧持续加压。' : '经营积累与大局反转并重。',
    protagonistJourney: '张三从没有身份的小卒，成长为能承担天下后果的建立者。', targetWords, targetVolumes,
    commercialAudience: routeNumber === 1
      ? '喜欢小人物军旅逆袭、历史细节和稳步扩张的番茄男频读者。'
      : routeNumber === 2
        ? '喜欢强目标北伐、家国热血和名将合作的历史读者。'
        : '喜欢种田经营、民生建设和势力成长的长线读者。',
    retentionPositioning: routeNumber === 1
      ? '每卷兑现一次军职、班底或地盘的不可逆跃迁，同时打开更大的统治难题。'
      : routeNumber === 2
        ? '以北伐总目标持续牵引，每卷完成一次关键突破并制造更难的联盟选择。'
        : '用一城一地的建设成果持续兑现获得感，再让成果引发新的资源与权力冲突。',
    volumeRoadmap: Array.from({ length: targetVolumes }, (_, index) => ({
      order: index + 1, title: `第${index + 1}卷·阶段${index + 1}`,
      direction: `张三完成第${index + 1}次不可逆的身份与局势变化。`,
      protagonistChange: `张三从阶段${index + 1}的选择中获得更大责任。`,
      mainPressure: `旧秩序与对立势力制造第${index + 1}层阻力。`,
      readerPayoff: `兑现一次明确胜利，同时打开更大的问题。`,
      targetWords: targetWords / targetVolumes,
      handoff: index === targetVolumes - 1 ? '完成全书核心承诺。' : `上一卷结果直接触发第${index + 2}卷。`
    })),
    firstVolumeFocus: ['五百字内让张三陷入必须行动的处境', '黄金三章兑现主角独有价值', '卷末形成第一次不可逆身份变化'],
    sellingPoints: ['张三始终是行动中心', '历史规则与现代认知形成真实碰撞', '每卷都有清楚回报'],
    risks: ['不能只靠历史知识无代价获胜'], openQuestions: ['统一后的制度选择由作者后续确认']
  });
}

function routeReviewOutput(prompt: string): string {
  const routeIds = [...prompt.matchAll(/"routeId":"([^"]+)"/gu)].map((match) => match[1]!).filter((id, index, all) => all.indexOf(id) === index);
  return JSON.stringify({
    schema: 'v7-planning-route-review-v1', publicSummary: '三套路线都保留张三主角地位，但主要快感和长期压力不同。',
    recommendedRouteId: routeIds[0],
    routeReviews: routeIds.slice(0, 3).map((routeId, index) => ({
      routeId, publicName: `路线${index + 1}`, biggestStrength: `第${index + 1}套的长期变化最鲜明。`,
      mainRisk: '中段不能重复同一种胜利。', suitableFor: '喜欢历史成长与阶段兑现的读者。', keyDifference: `核心推进方式${index + 1}不同。`,
      volumeJudgement: '八卷可以承接三百万字，各卷责任和篇幅匹配。',
      audienceJudgement: '受众与这套路线的主要快感匹配，表达具体。',
      retentionJudgement: '卷卷有不可逆变化和新问题，追读承诺可持续。'
    })),
    commonRisks: ['岳飞不能替代张三完成核心选择'], authorDecisions: ['是否接受架空历史结局']
  });
}

function planningMaintenanceOutput(): string {
  return JSON.stringify({
    schema: 'v7-planning-maintenance-v1',
    publicSummary: '张三已经完成首次军营求生，但能力暴露时间早于原规划。',
    actuals: [{
      treeKind: 'chain', scopeId: 'chain-1', nodeKey: 'chain-event-1', state: 'deviated',
      summary: '张三在第一次冲突中保住小队，并提前暴露了组织能力。',
      emotionResult: '压迫后的第一次小幅释放已经兑现。',
      experienceResult: '读者看到了张三主动选择带来的真实回报。',
      outcome: '张三保住小队但提前暴露能力。'
    }],
    suggestions: [{
      treeKind: 'chain', scopeId: 'chain-1', nodeKey: 'chain-event-1',
      publicSummary: '下一事件应承接能力暴露带来的审视。',
      reason: '正文实际比原规划更早暴露张三能力。',
      proposedChange: '未来事件增加上级试探与同袍猜疑，不回改已经完成的冲突。'
    }]
  });
}

function planningTreeOutput(prompt: string): string {
  const treeKind = /treeKind固定为(book|volume|chain)/u.exec(prompt)?.[1] as 'book'|'volume'|'chain';
  const scopeId = /scopeId固定为([^。\n]+)/u.exec(prompt)?.[1] ?? 'unknown';
  const root = treeKind === 'book'
    ? treeNode('book-root', 'book', 1, '张三改变北宋的全书方向', null, [
        treeNode('book-volume-1', 'volume', 1, '第一卷：小卒立足', { treeKind: 'volume', scopeId: 'volume-1' }),
        treeNode('book-ending', 'ending', 2, '可能结局：建立新秩序', null)
      ])
    : treeKind === 'volume'
      ? treeNode('volume-root', 'volume', 1, '第一卷：小卒立足', null, [
          treeNode('volume-chain-1', 'chain', 1, '军营求生链', { treeKind: 'chain', scopeId: 'chain-1' })
        ])
      : treeNode('chain-root', 'chain', 1, '军营求生链', null, [
          treeNode('chain-event-1', 'event', 1, '张三在首次冲突中证明价值', null)
        ]);
  return JSON.stringify({
    schema: 'v7-planning-tree-v1', treeKind, scopeId, title: root.title,
    designStrategy: {
      libraryRefs: [],
      originalStrategies: [{ title: '张三选择产生后果', applicationNote: '本层全部推进都由张三的主动选择和不可逆结果串联。' }],
      decisionNote: '没有为了使用后台资产而套剧情，先按本书人物和当前局势完成本层责任。'
    },
    root
  });
}

function treeNode(
  key: string,
  kind: 'book'|'volume'|'ending'|'chain'|'event',
  sequence: number,
  title: string,
  linkedTree: null | { treeKind: 'volume'|'chain'; scopeId: string },
  children: any[] = []
) {
  return {
    key, kind, sequence, title,
    story: {
      summary: `${title}的剧情方向。`, majorEvents: [`完成${title}的核心变化`],
      protagonistChange: '张三通过自己的选择改变处境。', outcome: '形成不可逆的新局面。', nextStep: '由新局面自然引出下一阶段。'
    },
    emotion: {
      publicSummary: '先承压再释放，让回报清楚可见。', openingEmotion: '紧张和期待',
      pressureMovement: '阻力逐步增强但不重复。', releaseEmotion: '阶段目标达成后的爽感。', intensity: 'strong'
    },
    experience: {
      publicSummary: '读者能看见张三主动改变命运。', pressureRhythm: '逐步加压，中间保留喘息。',
      payoffCadence: '本层结束前兑现一次明确变化。', informationRhythm: '只揭示当前行动需要的信息。',
      contrastWithPrevious: '冲突形态和责任都发生变化。', designReason: '保证长篇递进而不重复。'
    },
    causality: {
      trigger: '张三的处境逼迫他采取行动。', causes: ['旧秩序阻碍张三实现目标。'],
      coreConflict: '张三的选择与旧秩序发生冲突。', turningPoint: '张三主动承担风险并改变局面。',
      consequences: ['张三获得新的位置，也面对更大责任。']
    },
    threads: { foreshadowing: [], openQuestions: ['下一阶段张三如何承担更大责任？'] },
    budget: { wordTarget: kind === 'book' ? 3_000_000 : kind === 'volume' ? 360_000 : 30_000, chapterRange: null },
    linkedTree, children
  };
}

function proposalOutput(prompt: string): string {
  const seatKey = prompt.includes('席位：全案主编二席') ? 'structure_deputy'
    : prompt.includes('席位：全案主编三席') ? 'commercial_deputy' : 'chief_editor';
  const recipeId = /配方recipeId固定为([^，\n]+)/u.exec(prompt)?.[1] ?? `recipe-${seatKey}`;
  return JSON.stringify({
    schema: 'v7-planning-recipe-proposal-v1', seatKey,
    publicSummary: `${seatKey}给出八卷递进方案。`, selectionReason: '兼顾长篇容量、阶段变化和单链兑现。',
    recipe: recipe(recipeId, `${seatKey}方案`), strengths: ['层次清楚', '每卷有变化'],
    risks: ['未来卷仍需按实际正文调整'], authorDecisions: ['总字数是否保持三百万字']
  });
}

function comparisonOutput(prompt: string): string {
  const proposalIds = [...prompt.matchAll(/"proposalId":"([^"]+)"/gu)].map((match) => match[1]!);
  return JSON.stringify({
    schema: 'v7-planning-recipe-comparison-v1', publicSummary: '三案都保留张三主角地位，推荐兼顾结构与追读的一案。',
    recommendedProposalId: proposalIds[0], recommendedRecipe: recipe('comparison-recipe', '主编整理方案'),
    differences: proposalIds.slice(0, 3).map((proposalId, index) => ({ proposalId, publicName: `方案${index + 1}`, difference: `侧重${index + 1}` })),
    fusionNotes: ['保留结构方案的卷间递进', '吸收商业方案的首卷兑现'],
    risks: ['不能让岳飞替张三完成核心选择'], authorDecisions: ['终局是否建立新朝']
  });
}

function recipe(recipeId: string, title: string) {
  const experience = {
    publicSummary: '见证张三逐卷改变处境。', pressureRhythm: '压力逐卷提高并保留喘息。',
    payoffCadence: '每卷完成一次不可逆变化。', informationRhythm: '信息随主角视野逐步展开。',
    contrastWithPrevious: '下一卷改变冲突形态。', designReason: '避免长篇中段重复。'
  };
  return {
    recipeId, version: 1, engineVersion: '1.1.0', status: 'candidate', title,
    sourceSnapshotLabel: '服务端冻结资料',
    root: {
      nodeId: 'book', layer: 'book_backbone', title: '张三从小卒到改变时代',
      responsibility: '保持张三是行动中心，完成从求生到建立新秩序的长期变化。', status: 'ready',
      budget: { wordTarget: 3_000_000, volumeRange: [8, 8] }, hardRequirements: ['主角必须是张三'],
      methodGuidance: [], readerExperience: experience, creativeSpace: ['具体历史节点允许合理架空'],
      expectedChanges: ['身份、关系和责任持续改变'], children: [{
        nodeId: 'distribution', layer: 'volume_distribution', title: '八卷递进',
        responsibility: '把全书变化分配给八卷，每卷承担不同责任。', status: 'ready',
        budget: { wordTarget: 3_000_000, volumeRange: [8, 8] }, hardRequirements: ['中间卷不能重复升级'],
        methodGuidance: [], readerExperience: experience, creativeSpace: ['卷数可由作者调整'],
        expectedChanges: ['形成八个前后相接的阶段'], children: []
      }]
    }
  };
}

async function register(app: Awaited<ReturnType<typeof createServer>>, email: string, displayName: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
    payload: { email, password: 'strong-pass-123', displayName } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie']; return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function createBook(app: Awaited<ReturnType<typeof createServer>>, cookie: string, title: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...HEADERS, cookie }, payload: {
    idempotencyKey: 'planning-editorial-book-0001',
    openingPackage: {
      title, positioning: {
        publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: ['历史脑洞'], tags: ['历史', '权谋'],
        coreAppeal: '张三改变北宋。', expectedTotalWords: 3_000_000
      },
      backgrounds: { eraAndWorld: '北宋末年', openingSituation: '' },
      protagonists: [{ name: '张三', age: '20岁', identity: '男主', background: '现代人穿越为小卒', familyBackground: '', careerBackground: '', goldenFinger: '', goal: '改变时代', dilemma: '身份低微', personality: ['谨慎'], boundary: '不能靠系统解决问题' }],
      opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
      longTermDirection: { centralConflict: '小人物与旧秩序冲突', progression: '从小卒成长', relationshipDirection: '与岳飞相识并合作', storyPotential: '逐卷扩大影响' },
      possibleEnding: { direction: '建立新秩序', price: '承担损失', openness: '允许调整' }, authorNotes: [],
      mustFollow: ['主角必须是张三', '不使用系统和超凡力量']
    }
  } });
  expect(response.statusCode).toBe(200); return response.json().data.bookId as string;
}

function confirmSetting(ownerId: string, bookId: string): void {
  const now = '2026-07-16T00:00:00.000Z';
  context!.database.prepare(`INSERT INTO v7_setting_item_versions
    (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
    VALUES ('planning-setting-version',?,?, 'world-stage',1,'confirmed',?,'author',?)`)
    .run(ownerId, bookId, JSON.stringify({ era: '北宋末年', rule: '写实历史，无超凡体系' }), now);
  context!.database.prepare(`INSERT INTO v7_setting_items
    (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
    VALUES (?,?,'world-stage','世界舞台','核心设定','时代和世界规则','confirmed','planning-setting-version',1,?)`)
    .run(ownerId, bookId, now);
  context!.database.prepare(`INSERT INTO v7_setting_item_versions
    (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
    VALUES ('planning-setting-game-noise',?,?, 'game-rules',1,'confirmed',?,'author',?)`)
    .run(ownerId, bookId, JSON.stringify({ system: '游戏数值体系', levels: '一百级' }), now);
  context!.database.prepare(`INSERT INTO v7_setting_items
    (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
    VALUES (?,?,'game-rules','游戏规则','可选设定','游戏数值体系','confirmed','planning-setting-game-noise',1,?)`)
    .run(ownerId, bookId, now);
}

function prepareConfirmedChain(ownerId: string, bookId: string): void {
  const service = new V7PlanningTreeService(context!.database, new UuidGenerator(), new SystemClock());
  const tree = JSON.parse(planningTreeOutput('treeKind固定为chain\nscopeId固定为chain-1。')) as Record<string, unknown>;
  service.createCandidate(ownerId, bookId, 'chain', 'chain-1', {
    expectedRevision: 0,
    tree,
    sourceRefs: [{ sourceKind: 'opening', sourceId: bookId, version: '1' }],
    idempotencyKey: 'planning-maintenance-chain-create-0001'
  });
  service.confirmCandidate(ownerId, bookId, 'chain', 'chain-1', {
    expectedRevision: 1,
    idempotencyKey: 'planning-maintenance-chain-confirm-0001'
  });
}

function reviseConfirmedChain(ownerId: string, bookId: string): void {
  const service = new V7PlanningTreeService(context!.database, new UuidGenerator(), new SystemClock());
  const before = service.get(ownerId, bookId, 'chain', 'chain-1') as unknown as { revision: number };
  const tree = JSON.parse(planningTreeOutput('treeKind固定为chain\nscopeId固定为chain-1。')) as {
    title: string;
    root: { title: string; children: Array<{ title: string }> };
  };
  tree.title = '军营求生链·调整版';
  tree.root.title = '军营求生链·调整版';
  tree.root.children[0]!.title = '张三在首次冲突中证明价值并承担后果';
  const candidate = service.createCandidate(ownerId, bookId, 'chain', 'chain-1', {
    expectedRevision: before.revision,
    tree,
    sourceRefs: [{ sourceKind: 'opening', sourceId: bookId, version: '1' }],
    idempotencyKey: 'planning-maintenance-chain-revise-0001'
  });
  service.confirmCandidate(ownerId, bookId, 'chain', 'chain-1', {
    expectedRevision: (candidate as unknown as { revision: number }).revision,
    idempotencyKey: 'planning-maintenance-chain-confirm-0002'
  });
}

function insertSettlement(ownerId: string, bookId: string): void {
  const now = '2026-07-16T01:00:00.000Z';
  context!.database.prepare(`INSERT INTO stage_settlements
    (stage_settlement_id,owner_id,book_id,stage_type,stage_key,version,chapter_start,chapter_end,canon_revision,
     irreversible_results_json,entity_states_json,closed_threads_json,open_threads_json,relationship_changes_json,
     knowledge_changes_json,resource_changes_json,rule_changes_json,exclusions_json,status,created_at,activated_at)
    VALUES ('settlement-event-1',?,?,'story_arc','event-1',1,1,8,1,?,?,?,?,?,?,?,?,?,'active',?,?)`).run(
    ownerId, bookId,
    JSON.stringify(['张三保住了小队']), JSON.stringify([{ entity: '张三', state: '能力被看见' }]),
    JSON.stringify(['首次求生冲突']), JSON.stringify(['上级会如何试探张三']),
    JSON.stringify([{ relation: '张三与小队', change: '初步信任' }]), JSON.stringify([]),
    JSON.stringify([{ resource: '军中位置', change: '获得立足点' }]), JSON.stringify([]),
    JSON.stringify(['未发生升官']), now, now
  );
  context!.database.prepare(`INSERT INTO stage_settlement_sources
    (stage_settlement_source_id,owner_id,book_id,stage_settlement_id,source_type,source_id,source_hash,source_locator_json,created_at)
    VALUES ('settlement-source-1',?,?,'settlement-event-1','chapter_settlement','chapter-settlement-1',?,? ,?)`).run(
    ownerId, bookId, 'a'.repeat(64), JSON.stringify({ chapterStart: 1, chapterEnd: 8 }), now
  );
}

async function request(app: Awaited<ReturnType<typeof createServer>>, cookie: string, method: 'GET'|'POST', url: string, payload?: unknown) {
  const headers = { ...HEADERS, cookie };
  return payload === undefined ? await app.inject({ method, url, headers }) : await app.inject({ method, url, headers, payload: payload as object });
}

async function poll(app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, runId: string): Promise<any> {
  for (let index = 0; index < 160; index += 1) {
    const response = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-recipes/runs/${runId}`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (!['waiting', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('规划编辑部任务未按时完成');
}

async function pollRouteRun(
  app: Awaited<ReturnType<typeof createServer>>,
  cookie: string,
  bookId: string,
  runId: string
): Promise<any> {
  for (let index = 0; index < 240; index += 1) {
    const response = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-routes/runs/${runId}`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (!['waiting', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('三套故事路线没有按时完成');
}

async function generateTree(
  app: Awaited<ReturnType<typeof createServer>>,
  cookie: string,
  bookId: string,
  treeKind: 'book'|'volume'|'chain',
  scopeId: string,
  idempotencyKey: string
): Promise<any> {
  const started = await request(app, cookie, 'POST',
    `/api/v1/v7/books/${bookId}/planning-trees/${treeKind}/${scopeId}/generation-runs`, { idempotencyKey });
  expect(started.statusCode).toBe(200);
  const runId = started.json().data.runId as string;
  for (let index = 0; index < 160; index += 1) {
    const response = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-tree-generation-runs/${runId}`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (!['waiting', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('规划树任务未按时完成');
}

async function confirmTree(
  app: Awaited<ReturnType<typeof createServer>>,
  cookie: string,
  bookId: string,
  treeKind: 'book'|'volume'|'chain',
  scopeId: string,
  expectedRevision: number,
  idempotencyKey: string
): Promise<void> {
  const response = await request(app, cookie, 'POST',
    `/api/v1/v7/books/${bookId}/planning-trees/${treeKind}/${scopeId}/confirm`, { expectedRevision, idempotencyKey });
  expect(response.statusCode).toBe(200);
  expect(response.json().data.status).toBe('confirmed');
}

async function pollMaintenance(
  service: V7PlanningMaintenanceService,
  ownerId: string,
  bookId: string,
  runId: string
): Promise<any> {
  for (let index = 0; index < 160; index += 1) {
    const view = service.get(ownerId, bookId, runId);
    if (!['waiting', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('规划维护任务未按时完成');
}
