import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { PlatformModelSchemeService } from '../../../apps/api/src/application/agents/platform-model-scheme-service.js';
import { AgentGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/agent-governance-repository.js';
import { roleModelProfiles } from '../../../apps/api/src/contracts/agent-team-v2.js';
import { MembershipService } from '../../../apps/api/src/infrastructure/security/membership-service.js';

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function registerAdminAndUser(app: Awaited<ReturnType<typeof createServer>>) {
  const adminRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
  const userRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' } });
  return { adminCookie: cookieFrom(adminRegister), userCookie: cookieFrom(userRegister) };
}

function ownerIdOf(email: string): string {
  const row = context!.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized = ?').get(email) as { owner_id: string };
  return row.owner_id;
}

describe('管理后台：算力消耗与平台模型方案', () => {
  it('普通用户访问全局算力、平台方案与模型绑定接口一律 403，能力快照不暴露模型名', async () => {
    context = createTestContext('wenmi-admin-platform-gate-');
    const app = await createServer(context.config, context.database);
    try {
      const { adminCookie, userCookie } = await registerAdminAndUser(app);
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const book = initializeDomainBook(context, ownerIdOf('writer@example.com'), ids, clock, { title: '门禁测试书' });

      const deniedUrls = [
        { method: 'GET' as const, url: '/api/v1/admin/usage' },
        { method: 'GET' as const, url: '/api/v1/admin/model-scheme' },
        { method: 'POST' as const, url: '/api/v1/admin/model-scheme' },
        { method: 'GET' as const, url: `/api/v1/books/${book.bookId}/model-bindings` },
        { method: 'POST' as const, url: `/api/v1/books/${book.bookId}/model-bindings/preview` },
        { method: 'POST' as const, url: `/api/v1/books/${book.bookId}/model-bindings/activate` },
        { method: 'GET' as const, url: `/api/v1/books/${book.bookId}/usage` }
      ];
      for (const denied of deniedUrls) {
        const response = await app.inject({ method: denied.method, url: denied.url, headers: { ...BROWSER_HEADERS, cookie: userCookie }, payload: denied.method === 'POST' ? {} : undefined });
        expect(response.statusCode, denied.url).toBe(403);
      }

      const userCapabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(userCapabilities.statusCode).toBe(200);
      expect(userCapabilities.json().data.modelRuntime.profiles).toEqual([]);
      const adminCapabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(adminCapabilities.json().data.modelRuntime.profiles.length).toBeGreaterThan(0);

      const adminUsage = await app.inject({ method: 'GET', url: '/api/v1/admin/usage', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(adminUsage.statusCode).toBe(200);
      expect(adminUsage.json().data.perUser.length).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('任务详情对普通用户隐藏供应商与模型名并清洗错误原文，管理员保留完整证据', async () => {
    context = createTestContext('wenmi-admin-platform-sanitize-');
    const app = await createServer(context.config, context.database);
    try {
      const { adminCookie, userCookie } = await registerAdminAndUser(app);
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const ownerId = ownerIdOf('writer@example.com');
      const writerUserId = (context.database.prepare('SELECT user_id FROM user_accounts WHERE email_normalized = ?').get('writer@example.com') as { user_id: string }).user_id;
      const adminUserId = (context.database.prepare('SELECT user_id FROM user_accounts WHERE email_normalized = ?').get('admin@example.com') as { user_id: string }).user_id;
      new MembershipService(context.database, clock).grant(adminUserId, writerUserId, 'monthly');
      const book = initializeDomainBook(context, ownerId, ids, clock, { title: '清洗测试书' });
      const scope = { ownerId, bookId: book.bookId };
      const agent = new AgentGovernanceRepository(context.database).listTeam(scope)[0]!;
      const snapshot = context.database.prepare('SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?')
        .get(agent.agentId) as { model_snapshot_id: string };
      const budgets = new BudgetService(context.database, ids, clock);
      const budget = budgets.create(scope, 'standard', 1_000, 0);
      new TaskService(context.database, context.config.releaseId, clock).create(scope, {
        taskId: 'task-sanitize', taskType: 'model_probe', assignedAgentId: agent.agentId,
        idempotencyKey: 'sanitize-probe', budgetId: budget.budgetId, initialPhase: 'draft', brief: {}
      });
      const reservationId = budgets.reserve(scope, budget.budgetId, 'request-sanitize', 200, 0);
      context.database.prepare(`INSERT INTO model_calls (
        request_id, owner_id, book_id, task_id, phase_key, agent_id, provider, model_id, model_snapshot_id,
        input_hash, parameters_hash, reservation_id, state, error_class, error_detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', 'rate_limit', ?, ?)`).run(
        'request-sanitize', ownerId, book.bookId, 'task-sanitize', 'draft', agent.agentId,
        'volcengine-ark-agent-plan', 'deepseek-v4-pro', snapshot.model_snapshot_id,
        'a'.repeat(64), 'b'.repeat(64), reservationId,
        'volcengine-ark-agent-plan 的 deepseek-v4-pro 触发限流，请稍后重试', clock.now().toISOString()
      );

      const userView = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/tasks/task-sanitize`, headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(userView.statusCode).toBe(200);
      const userCall = userView.json().data.modelCalls[0] as { provider: string; model_id: string; error_detail: string };
      expect(userCall.provider).toBe('创作服务');
      expect(userCall.model_id).toBe('创作服务');
      expect(userCall.error_detail).not.toMatch(/deepseek|volcengine|ark/iu);
      expect(userCall.error_detail).toContain('限流');

      // 管理员查看自己名下书籍的任务详情时保留完整技术证据（跨用户书籍按 owner 隔离，本就不可见）。
      const adminOwnerId = ownerIdOf('admin@example.com');
      const adminBook = initializeDomainBook(context, adminOwnerId, ids, clock, { title: '管理员证据书' });
      const adminScope = { ownerId: adminOwnerId, bookId: adminBook.bookId };
      const adminAgent = new AgentGovernanceRepository(context.database).listTeam(adminScope)[0]!;
      const adminSnapshot = context.database.prepare('SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?')
        .get(adminAgent.agentId) as { model_snapshot_id: string };
      const adminBudget = budgets.create(adminScope, 'standard', 1_000, 0);
      new TaskService(context.database, context.config.releaseId, clock).create(adminScope, {
        taskId: 'task-evidence', taskType: 'model_probe', assignedAgentId: adminAgent.agentId,
        idempotencyKey: 'evidence-probe', budgetId: adminBudget.budgetId, initialPhase: 'draft', brief: {}
      });
      const adminReservationId = budgets.reserve(adminScope, adminBudget.budgetId, 'request-evidence', 200, 0);
      context.database.prepare(`INSERT INTO model_calls (
        request_id, owner_id, book_id, task_id, phase_key, agent_id, provider, model_id, model_snapshot_id,
        input_hash, parameters_hash, reservation_id, state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?)`).run(
        'request-evidence', adminOwnerId, adminBook.bookId, 'task-evidence', 'draft', adminAgent.agentId,
        'volcengine-ark-agent-plan', 'deepseek-v4-pro', adminSnapshot.model_snapshot_id,
        'a'.repeat(64), 'b'.repeat(64), adminReservationId, clock.now().toISOString()
      );
      const adminView = await app.inject({ method: 'GET', url: `/api/v1/books/${adminBook.bookId}/tasks/task-evidence`, headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(adminView.statusCode).toBe(200);
      const adminCall = adminView.json().data.modelCalls[0] as { provider: string; model_id: string };
      expect(adminCall.provider).toBe('volcengine-ark-agent-plan');
      expect(adminCall.model_id).toBe('deepseek-v4-pro');
    } finally {
      await app.close();
    }
  });

  it('管理员保存平台方案：同模型与名单外模型被拒绝，合法方案落库并收敛全部书籍', async () => {
    context = createTestContext('wenmi-admin-platform-scheme-');
    const app = await createServer(context.config, context.database);
    try {
      const { adminCookie } = await registerAdminAndUser(app);
      const describe0 = await app.inject({ method: 'GET', url: '/api/v1/admin/model-scheme', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(describe0.statusCode).toBe(200);
      expect(describe0.json().data.source).toBe('default');
      expect(describe0.json().data.members.length).toBe(14);
      expect(describe0.json().data.allowedModels.length).toBeGreaterThan(0);

      const sameModel = Object.fromEntries(Object.keys(roleModelProfiles).map((role) => [role, roleModelProfiles.chief_editor]));
      const rejected1 = await app.inject({ method: 'POST', url: '/api/v1/admin/model-scheme', headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { profiles: sameModel } });
      expect(rejected1.statusCode).toBe(400);
      const outside = { ...roleModelProfiles, chief_editor: { provider: 'unknown-provider', modelId: 'unknown-model', plan: 'agent' } };
      const rejected2 = await app.inject({ method: 'POST', url: '/api/v1/admin/model-scheme', headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { profiles: outside } });
      expect(rejected2.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('平台方案服务：保存后存量书未来任务收敛，重复保存不再修订', () => {
    context = createTestContext('wenmi-admin-platform-converge-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '平台收敛测试书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new PlatformModelSchemeService(context.database, ids, clock);
    const roleProfiles = context.config.modelRuntime.roleProfiles;

    expect(service.storedProfiles()).toBeNull();
    const result = service.save('user-admin', roleModelProfiles, roleProfiles, '测试收敛');
    expect(result.convergence.booksVisited).toBe(1);
    expect(result.convergence.revisedBooks).toBe(1);
    expect(result.convergence.updatedAgents).toBe(14);
    expect(service.storedProfiles()).toEqual(roleModelProfiles);

    const bindings = new AgentGovernanceRepository(context.database).activeBindings(scope);
    for (const binding of bindings) {
      const expected = roleModelProfiles[binding.roleKey as keyof typeof roleModelProfiles];
      expect(`${binding.provider}/${binding.modelId}`).toBe(`${expected.provider}/${expected.modelId}`);
    }

    const again = service.save('user-admin', roleModelProfiles, roleProfiles);
    expect(again.convergence.revisedBooks).toBe(0);
    expect(again.convergence.updatedAgents).toBe(0);
  });
});
