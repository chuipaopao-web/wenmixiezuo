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
    expect(result).toMatchObject({ discussionId, opinionCount: 3 });
    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    const discussion = context.database.prepare(`SELECT status, calls_used FROM discussions WHERE discussion_id = ?`).get(discussionId);
    expect(discussion).toEqual({ status: 'awaiting_boss', calls_used: 3 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_participants WHERE discussion_id = ? AND responded = 1`).get(discussionId)).toEqual({ count: 3 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ? AND state = 'succeeded' AND context_pack_id IS NOT NULL`).get(taskId)).toEqual({ count: 3 });
    expect(context.database.prepare(`SELECT COUNT(DISTINCT model_snapshot_id) AS count FROM plot_span_estimates WHERE discussion_id = ? AND independence_attested = 1`).get(discussionId)).toEqual({ count: 2 });
    const messages = conversations.listMessages(scope) as Array<{ sender_type: string; content: string; model_provider: string | null; model_id: string | null }>;
    const summary = messages.find((message) => message.sender_type === 'agent');
    expect(summary).toMatchObject({ model_provider: 'local-deterministic', model_id: 'wenmi-fixture-v2-chief_editor' });
    expect(summary?.content).toContain(`确认方案 ${result.decisionId}`);

    const callsBeforeConfirmation = (context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE book_id = ?`).get(scope.bookId) as { count: number }).count;
    expect(conversations.sendBossMessage(scope, `确认方案 ${result.decisionId}`).action).toMatchObject({ kind: 'discussion_confirmed', decisionId: result.decisionId });
    expect(context.database.prepare(`SELECT status FROM discussions WHERE discussion_id = ?`).get(discussionId)).toEqual({ status: 'confirmed' });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE book_id = ?`).get(scope.bookId)).toEqual({ count: callsBeforeConfirmation });
  });

  it('自然创作讨论经老板确认后形成可追溯资料，主笔门禁才会放行', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '规划落地书', text: '玩家进入历史战役副本并改变失败结局' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, '我想先讨论主角进入背水一战副本后的第一章剧情');
    const taskId = String(scheduled.action.taskId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    expect(tasks.claimNext('worker-planning')?.taskId).toBe(taskId);
    const result = await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, taskId, 'worker-planning');

    const confirmed = conversations.sendBossMessage(scope, `确认方案 ${result.decisionId}`);
    expect(confirmed.action).toMatchObject({ kind: 'discussion_confirmed', planningPrepared: true, chapterOutlineCount: 1 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM artifacts
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
        AND artifact_type IN ('creative_plan','story_bible','master_outline','chapter_outline')
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 4 });

    const write = conversations.sendBossMessage(scope, '写一章');
    expect(write.action).toMatchObject({ kind: 'chapter_batch_scheduled', count: 1 });
    const outline = context.database.prepare(`
      SELECT v.content_json FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline' AND a.status = 'active'
    `).get(scope.ownerId, scope.bookId) as { content_json: string };
    expect(JSON.parse(outline.content_json)).toMatchObject({ sourceDiscussionId: String(scheduled.action.discussionId), sourceDecisionId: result.decisionId });
  });
});
