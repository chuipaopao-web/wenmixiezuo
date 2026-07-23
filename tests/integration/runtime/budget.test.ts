import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { EventStore } from '../../../apps/api/src/application/events/event-store.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('预算冻结与结算', () => {
  it('并发式顺序申请不能超卖并在70%写持久事件', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    initializeRuntimeBook(context, scope, ids, clock);
    const events = new EventStore(context.database, ids, clock);
    const service = new BudgetService(context.database, ids, clock, events);
    const budget = service.create(scope, 'standard', 100, 0);
    const first = service.reserve(scope, budget.budgetId, 'request-first', 60, 0);
    expect(() => service.reserve(scope, budget.budgetId, 'request-over', 50, 0)).toThrow('预算不足');
    const second = service.reserve(scope, budget.budgetId, 'request-second', 20, 0);
    expect(service.require(scope, budget.budgetId).reservedTokens).toBe(80);
    const threshold = events.replay(scope, 0).find((event) => event.eventType === 'budget.threshold.reached');
    expect(threshold?.data).toMatchObject({
      exhausted: false,
      forecast: { remainingTokens: 20, recommendedAction: 'reduce_optional_agents_and_retrieval' }
    });
    service.settle(scope, first, { taskId: null, provider: 'local-deterministic', modelId: 'fixture', inputTokens: 30, outputTokens: 20, cashMicros: 0, durationMs: 5 });
    service.release(scope, second);
    const settled = service.require(scope, budget.budgetId);
    expect(settled.spentTokens).toBe(50);
    expect(settled.reservedTokens).toBe(0);
    expect(settled.status).toBe('active');
  });

  it('未知现金费用在冻结前暂停', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    initializeRuntimeBook(context, scope, ids, clock);
    const service = new BudgetService(context.database, ids, clock);
    const budget = service.create(scope, 'standard', 100, 0);
    expect(() => service.reserve(scope, budget.budgetId, 'unknown-cost', 10, null)).toThrow('现金费用未知');
  });

  it('can raise a token-only book limit without ever enabling cash fallback', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    initializeRuntimeBook(context, scope, ids, clock);
    const service = new BudgetService(context.database, ids, clock);
    const budget = service.create(scope, 'standard', 240_000, 0);

    const revised = service.reviseTokenLimit(scope, budget.budgetId, 240_000, 5_000_000);
    expect(revised).toMatchObject({ tokenLimit: 5_000_000, cashLimitMicros: 0, status: 'active' });
    expect(() => service.reviseTokenLimit(scope, budget.budgetId, 240_000, 6_000_000)).toThrow('预算版本已经变化');
  });
});
