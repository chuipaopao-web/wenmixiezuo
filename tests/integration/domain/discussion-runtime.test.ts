import { afterEach, describe, expect, it } from 'vitest';
import { ConversationService } from '../../../apps/api/src/application/chat/conversation-service.js';
import { DiscussionPipelineService } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import type { ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';

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
    const messages = conversations.listMessages(scope) as Array<{ sender_type: string; content: string; references_json: string; model_provider: string | null; model_id: string | null }>;
    const summary = messages.find((message) => message.sender_type === 'agent');
    expect(summary).toMatchObject({ model_provider: 'local-deterministic', model_id: 'wenmi-fixture-v2-chief_editor' });
    expect(summary?.content).toContain(`确认方案 ${result.decisionId}`);
    expect(summary?.content).toContain('份独立岗位意见');
    expect(summary?.content).not.toContain('【婉儿】');
    const effectiveReference = (JSON.parse(summary?.references_json ?? '[]') as Array<Record<string, unknown>>)
      .find((reference) => reference.type === 'effective_output');
    expect(effectiveReference).toMatchObject({ type: 'effective_output', version: 1 });
    expect(String(effectiveReference?.fullContent)).toContain('【婉儿】');
    expect(String(effectiveReference?.fullContent)).toContain('【红玉】');
    expect(String(effectiveReference?.fullContent)).toContain(`确认方案 ${result.decisionId}`);

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
    expect(confirmed.action).toMatchObject({ kind: 'discussion_confirmed', planningPrepared: true, chapterOutlineCount: 3 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM artifacts
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
        AND artifact_type IN ('creative_plan','story_bible','master_outline','chapter_outline')
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 6 });

    const write = conversations.sendBossMessage(scope, '写一章');
    expect(write.action).toMatchObject({ kind: 'chapter_batch_scheduled', count: 1 });
    const outline = context.database.prepare(`
      SELECT v.content_json FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline' AND a.status = 'active'
    `).get(scope.ownerId, scope.bookId) as { content_json: string };
    expect(JSON.parse(outline.content_json)).toMatchObject({ sourceDiscussionId: String(scheduled.action.discussionId), sourceDecisionId: result.decisionId });
  });

  it('活动主编连续技术失败后由副编接管，并复用已完成的双编剧意见', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '副编接管讨论书', text: '雾城悬疑长篇' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, '讨论主角发现旧盟友说谎之后的剧情方向');
    const taskId = String(scheduled.action.taskId);
    const discussionId = String(scheduled.action.discussionId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const takeoverFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'discussion' && roleKey === 'chief_editor') {
          return { provider, modelId, async generate() { throw new Error('模拟主编Endpoint不可用'); } };
        }
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;
    expect(tasks.claimNext('worker-chief')?.taskId).toBe(taskId);
    await expect(new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, takeoverFactory)
      .executeClaimed(scope, taskId, 'worker-chief')).rejects.toThrow('已由');
    expect(tasks.require(scope, taskId)).toMatchObject({ status: 'queued', requiredEditorEpoch: 2 });

    const reclaimed = tasks.claimNext('worker-deputy');
    expect(reclaimed?.taskId).toBe(taskId);
    const completed = await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, takeoverFactory)
      .executeClaimed(scope, taskId, 'worker-deputy', { leaseToken: reclaimed!.leaseToken!, attemptNo: reclaimed!.currentAttemptNo });
    expect(completed.opinionCount).toBe(3);
    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?`)
      .get(scope.ownerId, scope.bookId, discussionId)).toEqual({ count: 3 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE owner_id = ? AND book_id = ?
      AND task_id = ? AND state = 'failed' AND error_class = 'technical_failure'`)
      .get(scope.ownerId, scope.bookId, taskId)).toEqual({ count: 2 });
    const activeEditor = context.database.prepare(`SELECT r.role_key FROM editor_leases l JOIN agent_instances a
      ON a.agent_id = l.active_editor_agent_id JOIN role_templates r
      ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE l.owner_id = ? AND l.book_id = ?`).get(scope.ownerId, scope.bookId);
    expect(activeEditor).toEqual({ role_key: 'deputy_editor' });
  });
});
