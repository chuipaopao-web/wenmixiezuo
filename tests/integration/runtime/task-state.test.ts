import { afterEach, describe, expect, it } from 'vitest';
import { EventStore } from '../../../apps/api/src/application/events/event-store.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('持久任务状态机', () => {
  it('依赖、幂等、全局单并发、检查点、暂停和继续可恢复', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const agents = initializeRuntimeBook(context, scope, ids, clock);
    const events = new EventStore(context.database, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock, events);
    const input = { taskId: 'task-first', taskType: 'runtime_probe', assignedAgentId: agents[0]!.agentId, idempotencyKey: 'idem-first', initialPhase: 'read_context', brief: { goal: '探测' } };
    const first = tasks.create(scope, input);
    expect(tasks.create(scope, { ...input, taskId: 'different-id' }).taskId).toBe(first.taskId);
    tasks.create(scope, { taskId: 'task-second', taskType: 'runtime_probe', assignedAgentId: agents[1]!.agentId, idempotencyKey: 'idem-second', initialPhase: 'execute', brief: { goal: '第二项' } });
    tasks.addDependency(scope, 'task-second', 'task-first');
    tasks.queue(scope, 'task-first');
    tasks.queue(scope, 'task-second');
    expect(tasks.claimNext('worker-one')?.taskId).toBe('task-first');
    expect(tasks.claimNext('worker-two')).toBeNull();
    tasks.checkpoint(scope, 'task-first', 'worker-one', 'write_draft', { offset: 12 });
    tasks.requestPause(scope, 'task-first');
    expect(tasks.pauseAtCheckpoint(scope, 'task-first', 'worker-one').checkpoint).toEqual({ offset: 12 });
    tasks.queue(scope, 'task-first');
    expect(tasks.claimNext('worker-one')?.attemptCount).toBe(2);
    tasks.complete(scope, 'task-first', 'worker-one');
    expect(context.database.prepare(`
      SELECT status, completed_at FROM task_phases
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND phase_key = ?
    `).get(scope.ownerId, scope.bookId, 'task-first', 'write_draft')).toMatchObject({
      status: 'succeeded',
      completed_at: expect.any(String)
    });
    expect(tasks.claimNext('worker-one')?.taskId).toBe('task-second');
    expect(events.replay(scope, 0).map((event) => event.eventSeq)).toEqual([...events.replay(scope, 0).map((event) => event.eventSeq)].sort((a, b) => a - b));
  });

  it('任务在接管恢复后成功完成时清除历史错误码', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    initializeRuntimeBook(context, scope, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, {
      taskId: 'task-takeover',
      taskType: 'runtime_probe',
      idempotencyKey: 'idem-takeover',
      initialPhase: 'execute',
      brief: {}
    });
    tasks.queue(scope, 'task-takeover');
    tasks.claimNext('worker-one');
    context.database.prepare(`UPDATE tasks SET error_code = 'EDITOR_TAKEOVER' WHERE task_id = ?`)
      .run('task-takeover');

    expect(tasks.complete(scope, 'task-takeover', 'worker-one')).toMatchObject({ status: 'succeeded' });
    expect(context.database.prepare(`SELECT error_code FROM tasks WHERE task_id = ?`).get('task-takeover'))
      .toEqual({ error_code: null });
  });

  it('任务失败时同步关闭当前阶段和当前尝试', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    initializeRuntimeBook(context, scope, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, {
      taskId: 'task-failure',
      taskType: 'runtime_probe',
      idempotencyKey: 'idem-failure',
      initialPhase: 'execute',
      brief: {}
    });
    tasks.queue(scope, 'task-failure');
    const claimed = tasks.claimNext('worker-one')!;

    expect(tasks.fail(scope, 'task-failure', 'worker-one', 'TEST_FAILURE')).toMatchObject({
      status: 'failed',
      errorCode: 'TEST_FAILURE'
    });
    expect(context.database.prepare("SELECT status, completed_at FROM task_phases WHERE task_id = ? AND phase_key = ?")
      .get('task-failure', claimed.currentPhase)).toMatchObject({
        status: 'failed',
        completed_at: expect.any(String)
      });
    expect(context.database.prepare("SELECT status, error_code, completed_at FROM task_attempts WHERE task_id = ? AND attempt_no = ?")
      .get('task-failure', claimed.currentAttemptNo)).toMatchObject({
        status: 'failed',
        error_code: 'TEST_FAILURE',
        completed_at: expect.any(String)
      });
  });

  it('跨书不能读取、依赖或控制任务', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const firstScope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const secondScope = { ownerId: 'owner-one', bookId: 'book-beta' };
    initializeRuntimeBook(context, firstScope, ids, clock, '甲书');
    initializeRuntimeBook(context, secondScope, ids, clock, '乙书');
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(firstScope, { taskId: 'task-alpha', taskType: 'runtime_probe', idempotencyKey: 'idem-alpha', initialPhase: 'execute', brief: {} });
    tasks.create(secondScope, { taskId: 'task-beta', taskType: 'runtime_probe', idempotencyKey: 'idem-beta', initialPhase: 'execute', brief: {} });
    expect(() => tasks.require(secondScope, 'task-alpha')).toThrow('越权');
    expect(() => tasks.addDependency(firstScope, 'task-alpha', 'task-beta')).toThrow('越权');
  });
});
