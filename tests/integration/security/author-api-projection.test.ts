import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { AgentGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/agent-governance-repository.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site', 'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

describe('作者API与管理员审计物理分离', () => {
  it('新作者投影不返回任务、讨论、模型、方法和原始错误字段，旧缓存仍能读，原件只走管理员路由', async () => {
    context = createTestContext('wenmi-author-projection-');
    const app = await createServer(context.config, context.database);
    try {
      const adminRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const userRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
        payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' } });
      const adminCookie = cookieFrom(adminRegister);
      const userCookie = cookieFrom(userRegister);
      const ownerId = (context.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized = ?')
        .get('writer@example.com') as { owner_id: string }).owner_id;
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const book = initializeDomainBook(context, ownerId, ids, clock, { title: '投影隔离验证书' });
      const scope = { ownerId, bookId: book.bookId };
      const agent = new AgentGovernanceRepository(context.database).listTeam(scope)[0]!;
      const snapshot = context.database.prepare('SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?')
        .get(agent.agentId) as { model_snapshot_id: string };
      const budgets = new BudgetService(context.database, ids, clock);
      const budget = budgets.create(scope, 'standard', 5_000, 0);
      new TaskService(context.database, context.config.releaseId, clock).create(scope, {
        taskId: 'task-author-projection', taskType: 'discussion', assignedAgentId: agent.agentId,
        idempotencyKey: 'author-projection', budgetId: budget.budgetId, initialPhase: 'collecting',
        brief: { discussionId: 'discussion-secret', methodKey: 'save_the_cat', scopeText: '设计当前卷' }
      });
      const reservationId = budgets.reserve(scope, budget.budgetId, 'projection-call', 200, 0);
      context.database.prepare(`INSERT INTO model_calls (
        request_id, owner_id, book_id, task_id, phase_key, agent_id, provider, model_id, model_snapshot_id,
        input_hash, parameters_hash, reservation_id, state, error_class, error_detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', 'provider_error', ?, ?)`).run(
        'projection-call', ownerId, book.bookId, 'task-author-projection', 'collecting', agent.agentId,
        'secret-provider', 'secret-model', snapshot.model_snapshot_id, 'a'.repeat(64), 'b'.repeat(64), reservationId,
        'SQL C:\\private\\wenmi.sqlite Worker secret-provider/secret-model', clock.now().toISOString()
      );

      const clean = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/tasks/task-author-projection`,
        headers: { host: BROWSER_HEADERS.host, cookie: userCookie, 'x-wenmi-author-projection': 'clean-v1' } });
      expect(clean.statusCode).toBe(200);
      const cleanData = clean.json().data as Record<string, unknown>;
      expect(cleanData).toMatchObject({
        task: { recoveryKey: 'task-author-projection', workKind: 'discussion', assignedMemberKey: agent.agentId },
        recovery: { hasFailureEvidence: true, message: expect.any(String) }
      });
      const serialized = JSON.stringify(cleanData);
      expect(serialized).not.toMatch(/taskId|discussionId|provider|modelId|model_id|methodKey|errorCode|errorMessage|error_detail|Worker|SQL|private|secret-model/iu);
      expect(cleanData).not.toHaveProperty('modelCalls');
      expect(cleanData).not.toHaveProperty('phases');
      expect(cleanData).not.toHaveProperty('toolCalls');


      const cleanFailure = await app.inject({
        method: 'GET',
        url: `/api/v1/books/${book.bookId}/tasks/missing-task`,
        headers: { host: BROWSER_HEADERS.host, cookie: userCookie, 'x-wenmi-author-projection': 'clean-v1' }
      });
      expect(cleanFailure.statusCode).toBe(500);
      expect(cleanFailure.json()).toMatchObject({
        error: { message: expect.any(String), action: expect.any(String), retryable: false },
        meta: { recoveryKey: expect.any(String) }
      });
      expect(JSON.stringify(cleanFailure.json())).not.toMatch(/code|details|taskId|errorCode|SQL|sqlite|provider|modelId|stack|worker/iu);
      const legacy = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/tasks/task-author-projection`,
        headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(legacy.statusCode).toBe(200);
      expect(legacy.json().data.task.taskId).toBe('task-author-projection');
      expect(legacy.json().data.modelCalls[0].provider).toBe('创作服务');
      expect(JSON.stringify(legacy.json().data.modelCalls[0])).not.toMatch(/secret-provider|secret-model|private/iu);

      const deniedAudit = await app.inject({ method: 'GET', url: `/api/v1/admin/audit/books/${book.bookId}/tasks/task-author-projection`,
        headers: { host: BROWSER_HEADERS.host, cookie: userCookie } });
      expect(deniedAudit.statusCode).toBe(403);
      const audit = await app.inject({ method: 'GET', url: `/api/v1/admin/audit/books/${book.bookId}/tasks/task-author-projection`,
        headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(audit.statusCode).toBe(200);
      expect(audit.json().data.modelCalls[0]).toMatchObject({ provider: 'secret-provider', model_id: 'secret-model' });
      expect(audit.json().data.task).toMatchObject({ task_id: 'task-author-projection', task_type: 'discussion' });
    } finally {
      await app.close();
    }
  });
});