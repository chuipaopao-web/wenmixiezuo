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

  it('20条历史blocked与1条cancelled不污染Presence，无活动任务只返回一行待命', () => {
    // P0-2 / R02 回归：同一 Agent 有 20 条历史 blocked、1 条 cancelled 且无活动任务时，
    // Presence 只返回一行“待命”，不把历史受阻当成正在工作，也不产生重复行。
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const agentId = agents[0]!.agentId;
    const now = clock.now().toISOString();
    const setBlocked = context.database.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?');
    for (let i = 0; i < 20; i += 1) {
      const taskId = `t-blocked-${i}`;
      tasks.create(scope, { taskId, taskType: 'runtime_probe', assignedAgentId: agentId, idempotencyKey: `blocked-${i}`, initialPhase: 'read_context', brief: {} });
      tasks.queue(scope, taskId);
      setBlocked.run('blocked', now, taskId);
    }
    tasks.create(scope, { taskId: 't-cancelled', taskType: 'runtime_probe', assignedAgentId: agentId, idempotencyKey: 'cancelled', initialPhase: 'read_context', brief: {} });
    tasks.queue(scope, 't-cancelled');
    context.database.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?').run('cancelled', now, 't-cancelled');

    const presence = new PresenceService(context.database, clock);
    const rows = presence.list(scope).filter((item) => item.agentId === agentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('待命');
    expect(rows[0]!.taskId).toBeNull();
  });

  it('同一Agent多条活动任务时Presence只返回一行并优先working', () => {
    // P0-2 / R02 回归：每个 Agent 至多取一条当前任务；working 优先于 waiting_confirmation。
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const agentId = agents[0]!.agentId;
    const now = clock.now().toISOString();
    tasks.create(scope, { taskId: 't-wait', taskType: 'runtime_probe', assignedAgentId: agentId, idempotencyKey: 'wait', initialPhase: 'read_context', brief: {} });
    tasks.queue(scope, 't-wait');
    context.database.prepare(`UPDATE tasks SET status = 'waiting_confirmation', current_phase = 'owner_confirmation', heartbeat_at = ?, updated_at = ? WHERE task_id = ?`).run(now, now, 't-wait');
    tasks.create(scope, { taskId: 't-work', taskType: 'runtime_probe', assignedAgentId: agentId, idempotencyKey: 'work', initialPhase: 'read_context', brief: {} });
    tasks.queue(scope, 't-work');
    tasks.claimNext('worker-one');

    const presence = new PresenceService(context.database, clock);
    const rows = presence.list(scope).filter((item) => item.agentId === agentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe('t-work');
    expect(rows[0]!.status).toBe('读取资料');
  });

  it('跨书任务不互相污染Presence', () => {
    // P0-2 / R02 回归：跨书任务不得影响另一本书的成员状态。
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const bookA = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const bookB = { ownerId: 'owner-one', bookId: 'book-beta' };
    const agentsA = initializeRuntimeBook(context, bookA, ids, clock, '甲书');
    const agentsB = initializeRuntimeBook(context, bookB, ids, clock, '乙书');
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(bookA, { taskId: 't-a-work', taskType: 'runtime_probe', assignedAgentId: agentsA[0]!.agentId, idempotencyKey: 'a-work', initialPhase: 'read_context', brief: {} });
    tasks.queue(bookA, 't-a-work');
    tasks.claimNext('worker-one');

    const presence = new PresenceService(context.database, clock);
    const rowsA = presence.list(bookA);
    const rowsB = presence.list(bookB);
    const aAgent0 = rowsA.find((r) => r.agentId === agentsA[0]!.agentId);
    const bAgent0 = rowsB.find((r) => r.agentId === agentsB[0]!.agentId);
    expect(aAgent0?.status).not.toBe('待命');
    expect(bAgent0?.status).toBe('待命');
    expect(rowsB).toHaveLength(agentsB.length);
  });
});

