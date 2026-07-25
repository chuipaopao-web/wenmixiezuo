import { afterEach, describe, expect, it } from 'vitest';
import { ConversationService } from '../../../apps/api/src/application/chat/conversation-service.js';
import { ConversationReplyPipelineService } from '../../../apps/api/src/application/chat/conversation-reply-pipeline-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import type { ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('开放式主创对话', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('需要判断的普通消息由主编真实回复且不会写入长期记忆', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '开放对话测试书', text: '玩家进入历史战役副本改变命运'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    const scheduled = conversations.sendBossMessage(scope, '请告诉我现在还缺哪些准备信息');
    expect(scheduled.action).toMatchObject({ kind: 'conversation_reply_scheduled' });
    const taskId = String(scheduled.action.taskId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    expect(tasks.claimNext('worker-chat')?.taskId).toBe(taskId);

    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, taskId, 'worker-chat');

    const messages = conversations.listMessages(scope) as Array<{ sender_type: string; role_key: string | null; content: string; model_provider: string | null }>;
    expect(messages.some((message) => message.sender_type === 'agent' && message.role_key === 'chief_editor')).toBe(true);
    expect(messages.find((message) => message.sender_type === 'agent')).toMatchObject({ model_provider: 'local-deterministic' });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ? AND context_pack_id IS NOT NULL AND state = 'succeeded'`).get(taskId)).toEqual({ count: 1 });

    const followup = conversations.sendBossMessage(scope, '补充一句：只说明缺口，不要写正文');
    const followupTaskId = String(followup.action.taskId);
    expect(tasks.claimNext('worker-chat')?.taskId).toBe(followupTaskId);
    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, followupTaskId, 'worker-chat');
    const pack = context.database.prepare(`SELECT source_manifest_json FROM context_packs WHERE task_id = ?`)
      .get(followupTaskId) as { source_manifest_json: string };
    expect(pack.source_manifest_json).toContain('请告诉我现在还缺哪些准备信息');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM memories WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
  });

  it('岗位回复在同一次模型调用中生成有效内容并可展开完整依据', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '有效回复测试书', text: '张三准备向天安城宣战'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, '张三现在是否应该直接宣战？');
    const taskId = String(scheduled.action.taskId);
    expect(new TaskService(context.database, context.config.releaseId, clock).claimNext('worker-effective')?.taskId).toBe(taskId);

    let capturedPrompt = '';
    const structuredFactory = {
      resolve: () => ({
        provider: 'local-deterministic', modelId: 'wenmi-fixture-v2-chief_editor',
        generate: async (request: { prompt: string }) => {
          capturedPrompt = request.prompt;
          const output = JSON.stringify({
            answer: '不建议立即宣战。', keyPoints: ['双方实力尚未核实'], alternatives: [],
            risks: ['旧盟约可能触发援军'], questions: ['宣战是否需要公开？'],
            nextStep: '先让两名编剧分别推演。', details: '完整依据包含张三旧伤和天安城盟约记录。'
          });
          return { provider: 'local-deterministic', modelId: 'wenmi-fixture-v2-chief_editor', output,
            inputTokens: 120, outputTokens: 60, cashCostCny: 0, state: 'succeeded' as const };
        }
      })
    } as unknown as ModelAdapterFactory;
    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock, structuredFactory)
      .executeClaimed(scope, taskId, 'worker-effective');

    const reply = (conversations.listMessages(scope) as Array<{ sender_type: string; content: string; references_json: string }>)
      .find((message) => message.sender_type === 'agent');
    expect(reply?.content).toContain('不建议立即宣战');
    expect(reply?.content).toContain('旧盟约可能触发援军');
    expect(reply?.content).not.toContain('完整依据包含张三旧伤');
    expect(JSON.parse(reply?.references_json ?? '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'effective_output', version: 1, fullContent: expect.stringContaining('完整依据包含张三旧伤') })
    ]));
    expect(capturedPrompt).toContain('outputContract');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?`).get(taskId)).toEqual({ count: 1 });
  });

  it('未点名的主编开放回复连续技术失败后由副编接管并从原任务恢复', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '副编接管对话书', text: '旧城剧情讨论'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, '请判断下一步还缺什么资料');
    const taskId = String(scheduled.action.taskId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const firstClaim = tasks.claimNext('worker-chief')!;
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const takeoverFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'discussion' && roleKey === 'chief_editor') {
          return { provider, modelId, async generate() { throw new Error('模拟主编回复Endpoint不可用'); } };
        }
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;

    await expect(new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock, takeoverFactory)
      .executeClaimed(scope, taskId, 'worker-chief', { leaseToken: firstClaim.leaseToken!, attemptNo: firstClaim.currentAttemptNo }))
      .rejects.toThrow('已由');
    expect(tasks.require(scope, taskId)).toMatchObject({ status: 'queued', requiredEditorEpoch: 2 });

    const secondClaim = tasks.claimNext('worker-deputy')!;
    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock, takeoverFactory)
      .executeClaimed(scope, taskId, 'worker-deputy', { leaseToken: secondClaim.leaseToken!, attemptNo: secondClaim.currentAttemptNo });
    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    expect((conversations.listMessages(scope) as Array<{ sender_type: string; role_key: string | null }>)
      .some((message) => message.sender_type === 'agent' && message.role_key === 'deputy_editor')).toBe(true);
  });

  it('问候、身份说明和任务查看由小文秘书本地完成且不创建模型任务', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '秘书本地对话书', text: '一部待讨论的小说' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    expect(conversations.sendBossMessage(scope, '你好啊').action).toMatchObject({ kind: 'local_assistant_reply', topic: 'greeting' });
    expect(conversations.sendBossMessage(scope, '小文秘书，你是做什么的？').action).toMatchObject({ kind: 'local_assistant_reply', topic: 'identity' });
    expect(conversations.sendBossMessage(scope, '查看任务').action).toMatchObject({ kind: 'task_overview', activeCount: 0 });
    expect(conversations.sendBossMessage(scope, '暂停。').action).toMatchObject({ kind: 'pause_requested', taskIds: [] });

    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    const notices = conversations.listMessages(scope) as Array<{ sender_type: string; message_type: string; content: string }>;
    expect(notices.filter((message) => message.message_type === 'local_assistant_notice')).toHaveLength(4);
    expect(notices.some((message) => message.content.includes('目前没有进行中的任务'))).toBe(true);
    expect(notices.at(-1)?.content).toContain('不需要暂停');
    expect(notices.some((message) => /明确控制命令已执行|内部错误/u.test(message.content))).toBe(false);
  });

  it('聊天发出取消时只中止当前书籍的活动任务', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const firstBook = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '取消命令测试书', text: '一部待讨论的小说' });
    const secondBook = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '隔离书', text: '不应被取消' });
    const firstScope = { ownerId: context.config.ownerId, bookId: firstBook.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: secondBook.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    const first = conversations.sendBossMessage(firstScope, '讨论下一章的冲突');
    const second = conversations.sendBossMessage(secondScope, '讨论另一章的冲突');
    const cancelled = conversations.sendBossMessage(firstScope, '取消');

    expect(cancelled.action).toMatchObject({ kind: 'cancel_requested', taskIds: [first.action.taskId] });
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    expect(tasks.require(firstScope, String(first.action.taskId))).toMatchObject({ status: 'cancelled', cancelRequested: true });
    expect(tasks.require(secondScope, String(second.action.taskId))).toMatchObject({ status: 'queued', cancelRequested: false });
  });

  it('自然创作意图自动进入相关岗位讨论而不要求命令前缀', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '自然讨论书', text: '一部待讨论的游戏小说' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const result = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock)
      .sendBossMessage(scope, '我想写一本游戏文');

    expect(result.action).toMatchObject({
      kind: 'creative_session_started',
      purpose: 'creative_exploration',
      roundKind: 'initial_exploration'
    });
    const task = new TaskService(context.database, context.config.releaseId, clock).require(scope, String(result.action.taskId));
    expect(task.brief).toMatchObject({
      purpose: 'creative_exploration',
      requestedChapterCount: null,
      roundKind: 'initial_exploration'
    });
  });

  it('未准备好时写一章只发起规划讨论，不创建章节或正文任务', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '门禁测试书', text: '游戏副本题材，但尚未讨论角色与第一章' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const result = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock)
      .sendBossMessage(scope, '写一章');

    expect(result.action).toMatchObject({ kind: 'planning_discussion_scheduled', requestedChapterCount: null });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ? AND task_type = 'chapter_creation'`).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
  });

  it('连续问候由秘书本地回应，表达创意再要求写作时只排队讨论，绝不抢跑主笔', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '真实复现书', text: '玩家进入历史战役副本' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    expect(conversations.sendBossMessage(scope, '你好啊').action.kind).toBe('local_assistant_reply');
    expect(conversations.sendBossMessage(scope, '没人在吗').action.kind).toBe('local_assistant_reply');
    const planning = conversations.sendBossMessage(scope, '我想写一本游戏文');
    expect(planning.action).toMatchObject({ kind: 'creative_session_started', purpose: 'creative_exploration' });
    expect(conversations.sendBossMessage(scope, '写一章').action).toMatchObject({
      kind: 'planning_discussion_existing', discussionId: planning.action.discussionId
    });

    const taskCounts = context.database.prepare(`
      SELECT task_type, COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ? GROUP BY task_type ORDER BY task_type
    `).all(scope.ownerId, scope.bookId);
    expect(taskCounts).toEqual([{ task_type: 'discussion', count: 1 }]);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
  });
});
