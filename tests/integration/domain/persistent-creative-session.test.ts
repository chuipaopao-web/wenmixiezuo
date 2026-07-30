import { afterEach, describe, expect, it } from 'vitest';
import { ConversationService } from '../../../apps/api/src/application/chat/conversation-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { CreativeSessionRepository } from '../../../apps/api/src/infrastructure/db/repositories/creative-session-repository.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('持续剧情创作会话', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('首次启动双编剧，普通追问只续接主编，重大改向才开新轮', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '持续会话书',
      text: '张三准备进入天安城'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );

    const first = service.sendBossMessage(scope, '我们讨论张三应该怎样进入天安城');
    expect(first.action).toMatchObject({
      kind: 'creative_session_started',
      purpose: 'creative_exploration',
      roundKind: 'initial_exploration'
    });
    const sessionId = String(first.action.sessionId);
    const firstTask = new TaskService(context.database, context.config.releaseId, clock)
      .require(scope, String(first.action.taskId));
    expect(firstTask.brief).toMatchObject({
      purpose: 'creative_exploration',
      creativeSessionId: sessionId,
      roundKind: 'initial_exploration'
    });

    const followup = service.sendBossMessage(scope, '我倾向让他伪装成商队成员，但担心太普通');
    expect(followup.action).toMatchObject({
      kind: 'creative_session_continued',
      sessionId,
      agentId: expect.any(String)
    });
    const followupTask = new TaskService(context.database, context.config.releaseId, clock)
      .require(scope, String(followup.action.taskId));
    expect(followupTask).toMatchObject({ taskType: 'conversation_reply' });
    expect(followupTask.brief).toMatchObject({
      creativeSessionId: sessionId,
      creativeSessionAction: 'continue_discussion'
    });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM discussions WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });

    const paused = service.sendBossMessage(scope, '暂停');
    expect(paused.action).toMatchObject({
      kind: 'pause_requested',
      creativeSessionId: sessionId,
      creativeSessionStatus: 'paused'
    });
    expect(context.database.prepare(`
      SELECT status FROM creative_sessions
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
    `).get(sessionId, scope.ownerId, scope.bookId)).toEqual({ status: 'paused' });

    const resumed = service.sendBossMessage(scope, '继续');
    expect(resumed.action).toMatchObject({
      kind: 'tasks_resumed',
      creativeSessionId: sessionId,
      creativeSessionStatus: 'exploring'
    });

    const redirect = service.sendBossMessage(scope, '重大改向：不要伪装，改成天安城主动邀请张三');
    expect(redirect.action).toMatchObject({
      kind: 'creative_session_round_scheduled',
      sessionId,
      purpose: 'creative_exploration',
      roundKind: 'major_redirect'
    });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM creative_sessions WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM discussions WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
    expect(context.database.prepare(`
      SELECT current_blackboard_revision FROM creative_sessions
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
    `).get(sessionId, scope.ownerId, scope.bookId)).toEqual({ current_blackboard_revision: 3 });
  });

  it('不同书拥有隔离的活动会话', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const firstBook = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '甲书', text: '甲剧情' });
    const secondBook = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '乙书', text: '乙剧情' });
    const service = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const first = service.sendBossMessage(
      { ownerId: context.config.ownerId, bookId: firstBook.bookId },
      '讨论甲书主角怎样逃出皇城'
    );
    const second = service.sendBossMessage(
      { ownerId: context.config.ownerId, bookId: secondBook.bookId },
      '讨论乙书主角怎样守住城池'
    );
    expect(first.action.sessionId).not.toBe(second.action.sessionId);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM creative_sessions`).get()).toEqual({ count: 2 });
  });

  it('上一段滚动规划已完成时，明确规划后续章节会关闭旧会话并建立新议题', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '滚动规划书',
      text: '前三章已经规划完成'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );

    const first = service.sendBossMessage(scope, '讨论并规划第1—3章');
    const firstSessionId = String(first.action.sessionId);
    context.database.prepare(`
      UPDATE discussions SET status = 'confirmed'
      WHERE discussion_id = ? AND owner_id = ? AND book_id = ?
    `).run(String(first.action.discussionId), scope.ownerId, scope.bookId);
    context.database.prepare(`
      UPDATE creative_session_rounds
      SET round_kind = 'locked_planning', status = 'completed'
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
    `).run(firstSessionId, scope.ownerId, scope.bookId);
    context.database.prepare(`
      UPDATE book_planning_states
      SET stage = 'chapter_outline_ready'
      WHERE owner_id = ? AND book_id = ?
    `).run(scope.ownerId, scope.bookId);
    new CreativeSessionRepository(context.database).updateStatus(scope, {
      sessionId: firstSessionId,
      expectedStatus: 'exploring',
      status: 'awaiting_plan',
      mode: 'formal_production',
      now: clock.now().toISOString()
    });

    const next = service.sendBossMessage(scope, '讨论并规划第4—6章，只规划这三章');

    expect(next.action).toMatchObject({
      kind: 'creative_session_started',
      roundKind: 'initial_exploration'
    });
    expect(String(next.action.sessionId)).not.toBe(firstSessionId);
    expect(context.database.prepare(`
      SELECT status FROM creative_sessions
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
    `).get(firstSessionId, scope.ownerId, scope.bookId)).toEqual({ status: 'closed' });
    const task = context.database.prepare(`
      SELECT task_brief_json FROM tasks
      WHERE task_id = ? AND owner_id = ? AND book_id = ?
    `).get(String(next.action.taskId), scope.ownerId, scope.bookId) as { task_brief_json: string };
    expect(JSON.parse(task.task_brief_json)).toMatchObject({ requestedChapterCount: 3 });
  });
});
