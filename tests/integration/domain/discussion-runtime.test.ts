import { afterEach, describe, expect, it } from 'vitest';
import { ConversationService } from '../../../apps/api/src/application/chat/conversation-service.js';
import { DiscussionPipelineService } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('自然语言讨论运行闭环', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('按问题激活相关岗位，经Worker执行真实模型调用并由老板明确确认方案', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '讨论闭环测试书', text: '雾城悬疑长篇' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, '讨论 下一章的读者情绪和结尾钩子');
    expect(scheduled.action).toMatchObject({ kind: 'discussion_scheduled' });
    const taskId = String(scheduled.action.taskId);
    const discussionId = String(scheduled.action.discussionId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    expect(tasks.claimNext('worker-discussion')?.taskId).toBe(taskId);

    const result = await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, taskId, 'worker-discussion');
    expect(result).toMatchObject({ discussionId, opinionCount: 2 });
    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    const discussion = context.database.prepare(`SELECT status, calls_used FROM discussions WHERE discussion_id = ?`).get(discussionId);
    expect(discussion).toEqual({ status: 'awaiting_boss', calls_used: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_participants WHERE discussion_id = ? AND responded = 1`).get(discussionId)).toEqual({ count: 2 });
    expect(context.database.prepare(`SELECT activation_state FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = 'reader_experience'`)
      .get(scope.ownerId, scope.bookId)).toEqual({ activation_state: 'standby' });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ? AND state = 'succeeded' AND context_pack_id IS NOT NULL`).get(taskId)).toEqual({ count: 2 });
    const messages = conversations.listMessages(scope) as Array<{ sender_type: string; content: string; model_provider: string | null; model_id: string | null }>;
    const summary = messages.find((message) => message.sender_type === 'agent');
    expect(summary).toMatchObject({ model_provider: 'local-deterministic', model_id: 'wenmai-fixture-v1' });
    expect(summary?.content).toContain(`确认方案 ${result.decisionId}`);

    const callsBeforeConfirmation = (context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE book_id = ?`).get(scope.bookId) as { count: number }).count;
    expect(conversations.sendBossMessage(scope, `确认方案 ${result.decisionId}`).action).toMatchObject({ kind: 'discussion_confirmed', decisionId: result.decisionId });
    expect(context.database.prepare(`SELECT status FROM discussions WHERE discussion_id = ?`).get(discussionId)).toEqual({ status: 'confirmed' });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE book_id = ?`).get(scope.bookId)).toEqual({ count: callsBeforeConfirmation });
  });
});
