import { afterEach, describe, expect, it } from 'vitest';
import { PresenceService } from '../../../apps/api/src/application/agents/presence-service.js';
import { EventStore } from '../../../apps/api/src/application/events/event-store.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { MutableClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('真实Presence与SSE回放源', () => {
  it('状态由任务和心跳驱动，过期后显示离线', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-presence', taskType: 'runtime_probe', assignedAgentId: agents[0]!.agentId, idempotencyKey: 'presence', initialPhase: 'read_context', brief: {} });
    tasks.queue(scope, 'task-presence');
    tasks.claimNext('worker-one');
    const presence = new PresenceService(context.database, clock);
    expect(presence.list(scope).find((item) => item.agentId === agents[0]!.agentId)?.status).toBe('读取资料');
    clock.advance(16_000);
    expect(presence.list(scope).find((item) => item.agentId === agents[0]!.agentId)?.status).toBe('离线');
  });

  it('事件按持久递增序号回放并按书隔离', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const first = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const second = { ownerId: 'owner-one', bookId: 'book-beta' };
    initializeRuntimeBook(context, first, ids, clock, '甲书');
    initializeRuntimeBook(context, second, ids, clock, '乙书');
    const events = new EventStore(context.database, ids, clock);
    const event1 = events.append(first, 'task.created', { taskId: 'one' });
    const event2 = events.append(second, 'task.created', { taskId: 'two' });
    const event3 = events.append(first, 'task.completed', { taskId: 'one' });
    expect(events.replay(first, 0).map((event) => event.eventSeq)).toEqual([event1.eventSeq, event3.eventSeq]);
    expect(events.replay(first, event1.eventSeq).map((event) => event.eventSeq)).toEqual([event3.eventSeq]);
    expect(event2.eventSeq).toBeGreaterThan(event1.eventSeq);
  });
});

