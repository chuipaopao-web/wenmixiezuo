import { afterEach, describe, expect, it } from 'vitest';
import { ConversationService } from '../../../apps/api/src/application/chat/conversation-service.js';
import { ConversationReplyPipelineService } from '../../../apps/api/src/application/chat/conversation-reply-pipeline-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { ModelAdapterError, type ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { DomainError } from '../../../apps/api/src/domain/errors.js';
import { ModelBindingService } from '../../../apps/api/src/application/agents/model-binding-service.js';
import { EditorLeaseService } from '../../../apps/api/src/application/editors/editor-lease-service.js';
import { createHash } from 'node:crypto';
import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../../../apps/api/src/contracts/opening-blueprint.js';
import { SettingGuidanceService } from '../../../apps/api/src/application/knowledge/setting-guidance-service.js';
import { DiscussionPipelineService } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';

describe('开放式主创对话', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('进入对话只补建一次接待任务，再次进入只观察进度', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会改变现实记录的实验笔记，她必须查清真相并守住自己的记忆。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [],
      initialMap: '', mustFollow: ['重要设定必须由作者确认后生效']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '对话接待测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const before = (context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel')`)
      .get(scope.ownerId, scope.bookId) as { count: number }).count;

    const first = conversations.enterConversation(scope);
    const second = conversations.enterConversation(scope);

    expect(first).toMatchObject({ kind: 'guidance_scheduled', settingItemKey: 'creative-concept' });
    expect(second).toMatchObject({ kind: 'guidance_in_progress', taskId: first.taskId });
    expect((context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel')`)
      .get(scope.ownerId, scope.bookId) as { count: number }).count).toBe(before + 1);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'conversation_entry_trigger'`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
  });

  it('旧书没有当前设定接待任务时只补建一次，并隐藏内部触发消息', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会改变现实记录的实验笔记，她必须查清真相并守住自己的记忆。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [],
      initialMap: '', mustFollow: ['重要设定必须由作者确认后生效']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '旧书接待测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    context.database.prepare(`DELETE FROM tasks WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
      AND json_extract(task_brief_json, '$.purpose') = 'creative_concept_panel'`)
      .run(scope.ownerId, scope.bookId);
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    const first = conversations.enterConversation(scope);
    const second = conversations.enterConversation(scope);

    expect(first).toMatchObject({ kind: 'guidance_scheduled', settingItemKey: 'creative-concept' });
    expect(second).toMatchObject({ kind: 'guidance_in_progress', taskId: first.taskId });
    expect((context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel')`)
      .get(scope.ownerId, scope.bookId) as { count: number }).count).toBe(1);
    expect(conversations.listMessages(scope)).toEqual([]);
  });

  it('接待任务失败后只报告真实故障，不自动重复调用模型', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会改变现实记录的实验笔记，她必须查清真相并守住自己的记忆。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [],
      initialMap: '', mustFollow: ['重要设定必须由作者确认后生效']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '故障接待测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    context.database.prepare(`DELETE FROM tasks WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
      AND json_extract(task_brief_json, '$.purpose') = 'creative_concept_panel'`)
      .run(scope.ownerId, scope.bookId);
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    const first = conversations.enterConversation(scope);
    context.database.prepare(`UPDATE tasks SET status = 'failed', error_code = 'MODEL_UNAVAILABLE'
      WHERE owner_id = ? AND book_id = ? AND task_id = ?`)
      .run(scope.ownerId, scope.bookId, first.taskId!);
    const reopened = conversations.enterConversation(scope);

    expect(reopened).toMatchObject({
      kind: 'guidance_failed', taskId: first.taskId, taskStatus: 'failed'
    });
    expect(reopened.message).toContain('不会自动重复调用模型');
    expect((context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel')`)
      .get(scope.ownerId, scope.bookId) as { count: number }).count).toBe(1);
  });

  it('接待派单失败时原子回滚隐藏触发消息', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会改变现实记录的实验笔记，她必须查清真相并守住自己的记忆。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [],
      initialMap: '', mustFollow: ['重要设定必须由作者确认后生效']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '接待事务测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    context.database.prepare(`DELETE FROM tasks WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
      AND json_extract(task_brief_json, '$.purpose') = 'creative_concept_panel'`)
      .run(scope.ownerId, scope.bookId);
    context.database.prepare(`DELETE FROM budgets WHERE owner_id = ? AND book_id = ?`)
      .run(scope.ownerId, scope.bookId);
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    expect(() => conversations.enterConversation(scope)).toThrow('当前书籍没有活动预算');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'conversation_entry_trigger'`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
  });

  it('新书按设定清单逐项引导，确认后推进下一项且剧情请求不能越级', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female',
      categoryKey: 'female-modern-brain',
      targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '刚进入大学。', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会改变现实记录的实验笔记，她必须查清老师操控实验的目的，同时守住自己的真实记忆。',
      worldBackground: '', openingBackground: '',
      stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [],
      initialMap: '', mustFollow: ['实验笔记的能力必须有代价']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '少女的实验笔记', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);

    const answer = conversations.sendBossMessage(scope, '我想写人在记录和真实记忆发生冲突时，怎样守住自我。');
    expect(answer.action).toMatchObject({
      kind: 'discussion_scheduled'
    });
    const answerTaskId = String(answer.action.taskId);
    expect(tasks.claimNext('worker-setting-answer')?.taskId).toBe(answerTaskId);
    await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, answerTaskId, 'worker-setting-answer');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'setting_proposal'`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 3 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'succeeded'`)
      .get(scope.ownerId, scope.bookId, answerTaskId)).toEqual({ count: 3 });
    expect(context.database.prepare(`SELECT phase, COUNT(*) AS count FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ? GROUP BY phase`)
      .all(scope.ownerId, scope.bookId, String(answer.action.discussionId)))
      .toEqual([{ phase: 'independent', count: 3 }]);
    expect(context.database.prepare(`SELECT role_key FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'setting_proposal'
      ORDER BY role_key`).all(scope.ownerId, scope.bookId)).toEqual([
        { role_key: 'chief_editor' },
        { role_key: 'lead_screenwriter' },
        { role_key: 'second_screenwriter' }
      ]);
    const numberedProposals = context.database.prepare(`SELECT content, references_json FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'setting_proposal'
      ORDER BY created_at, message_id`).all(scope.ownerId, scope.bookId) as Array<{
        content: string; references_json: string;
      }>;
    expect(numberedProposals.map((row) => row.content.split('\n', 1)[0])).toEqual([
      expect.stringMatching(/^方案1｜/),
      expect.stringMatching(/^方案2｜/),
      expect.stringMatching(/^方案3｜/)
    ]);
    expect(numberedProposals.map((row) => JSON.parse(row.references_json)[0].proposalNumber)).toEqual([1, 2, 3]);
    expect(context.database.prepare(`SELECT item_status, content_text FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND item_key = 'creative-concept'`).get(scope.ownerId, scope.bookId))
      .toEqual({ item_status: '讨论中', content_text: null });

    const largeProposalSuffix = '保留现实约束、人物自主性、因果证据与可逆选择；避免复述剧情梗概。'.repeat(60);
    const proposalRows = context.database.prepare(`SELECT message_id, content FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'setting_proposal'
      ORDER BY created_at, message_id`).all(scope.ownerId, scope.bookId) as Array<{
        message_id: string; content: string;
      }>;
    const enlargeProposal = context.database.prepare(`UPDATE messages SET content = ? WHERE message_id = ?`);
    for (const proposal of proposalRows) {
      enlargeProposal.run(`${proposal.content}\n${largeProposalSuffix}`, proposal.message_id);
    }

    const selected = conversations.sendBossMessage(scope, '123');
    expect(selected.action).toMatchObject({
      kind: 'setting_guidance_scheduled',
      settingItemKey: 'creative-concept',
      settingPhase: 'revise'
    });
    const selectedTaskId = String(selected.action.taskId);
    const selectedBrief = JSON.parse((context.database.prepare(`SELECT task_brief_json FROM tasks WHERE task_id = ?`)
      .get(selectedTaskId) as { task_brief_json: string }).task_brief_json) as Record<string, any>;
    expect(selectedBrief.settingGuidance).toMatchObject({
      feedbackMode: 'numeric_selection',
      selectionNumbers: [1, 2, 3]
    });
    expect(selectedBrief.settingGuidance.proposalOptions).toHaveLength(3);
    expect(selectedBrief.settingGuidance.proposalOptions.map((option: { number: number }) => option.number))
      .toEqual([1, 2, 3]);
    expect(tasks.claimNext('worker-setting-selection')?.taskId).toBe(selectedTaskId);
    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, selectedTaskId, 'worker-setting-selection');
    expect(context.database.prepare(`SELECT policy_version FROM context_packs WHERE task_id = ?`)
      .get(selectedTaskId)).toEqual({ policy_version: 'setting-guidance-v2-4500chars' });
    expect(context.database.prepare(`SELECT item_status FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND item_key = 'creative-concept'`).get(scope.ownerId, scope.bookId))
      .toEqual({ item_status: '候选待确认' });

    const confirmed = conversations.sendBossMessage(scope, '确定');
    expect(confirmed.action).toMatchObject({
      kind: 'discussion_scheduled',
      purpose: 'setting_proposal_panel',
      confirmedSettingItemKey: 'creative-concept',
    });
    expect(context.database.prepare(`SELECT item_status FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND item_key = 'creative-concept'`).get(scope.ownerId, scope.bookId))
      .toEqual({ item_status: '已确认' });

    const readerPromiseTaskId = String(confirmed.action.taskId);
    expect(tasks.claimNext('worker-reader-promise')?.taskId).toBe(readerPromiseTaskId);
    await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, readerPromiseTaskId, 'worker-reader-promise');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'setting_proposal'`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 6 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'succeeded'`)
      .get(scope.ownerId, scope.bookId, readerPromiseTaskId)).toEqual({ count: 3 });

    const blocked = conversations.sendBossMessage(scope, '讨论剧情总纲');
    expect(blocked.action).toMatchObject({
      kind: 'setting_guidance_scheduled',
      settingItemKey: 'reader-promise',
      settingPhase: 'ask',
      blockedBy: 'setting_baseline_not_confirmed'
    });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM discussions WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') NOT IN ('creative_concept_panel', 'setting_proposal_panel')`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });

    const settingAnswerMentioningFutureArtifacts = conversations.sendBossMessage(scope,
      '这项设定采用现实程序和公平线索。剧情简介只是方向参考，后续具体情节以逐阶段确认的总纲和章纲为准。');
    expect(settingAnswerMentioningFutureArtifacts.action).toMatchObject({
      kind: 'setting_guidance_scheduled',
      settingItemKey: 'reader-promise',
      settingPhase: 'collect'
    });
    expect(settingAnswerMentioningFutureArtifacts.action).not.toHaveProperty('blockedBy');
  });

  it('设定还没有候选时不能用一句确认跳过当前项', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '她在入学第一天发现一本会改变现实记录的笔记，必须在老师清除记忆前查明真相并守住自己。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [], initialMap: '', mustFollow: ['重要设定必须由作者确认后生效']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '不能空确认', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const result = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    ).sendBossMessage(scope, '确认');

    expect(result.action).toMatchObject({
      kind: 'setting_guidance_scheduled',
      settingItemKey: 'creative-concept',
      settingPhase: 'ask'
    });
    expect(context.database.prepare(`SELECT item_status, content_text FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND item_key = 'creative-concept'`).get(scope.ownerId, scope.bookId))
      .toEqual({ item_status: '讨论中', content_text: null });
  });

  it('作者不满意时按反馈类型确定性修订，不把原因继续盘问给作者', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会改变现实记录的实验笔记，必须守住自己的真实记忆。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [], initialMap: '',
      mustFollow: ['重要设定必须由作者确认后生效']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '不满意收敛测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    guidance.recordCandidate(scope, 'creative-concept', JSON.stringify({
      workflowArtifact: { type: 'setting_outline', payload: { items: [{
        itemKey: 'creative-concept', content: '旧候选只笼统强调记忆与身份。'
      }] } }
    }));
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);

    const first = conversations.sendBossMessage(scope, '不满意');
    expect(first.action).toMatchObject({ kind: 'setting_guidance_scheduled', settingPhase: 'revise' });
    const firstTaskId = String(first.action.taskId);
    const firstBrief = JSON.parse((context.database.prepare(`SELECT task_brief_json FROM tasks WHERE task_id = ?`)
      .get(firstTaskId) as { task_brief_json: string }).task_brief_json) as Record<string, any>;
    expect(firstBrief.settingGuidance).toMatchObject({
      feedbackMode: 'vague_dissatisfaction', dissatisfactionRound: 1,
      previousCandidate: '旧候选只笼统强调记忆与身份。'
    });
    expect(tasks.claimNext('worker-dislike-1')?.taskId).toBe(firstTaskId);
    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, firstTaskId, 'worker-dislike-1');
    const firstReply = context.database.prepare(`SELECT content FROM messages
      WHERE owner_id = ? AND book_id = ? AND sender_type = 'agent' ORDER BY created_at DESC, message_id DESC LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { content: string };
    expect(firstReply.content).toContain('直接收紧重点');
    expect(firstReply.content).not.toContain('为什么不满意');

    const second = conversations.sendBossMessage(scope, '还是不满意');
    const secondBrief = JSON.parse((context.database.prepare(`SELECT task_brief_json FROM tasks WHERE task_id = ?`)
      .get(String(second.action.taskId)) as { task_brief_json: string }).task_brief_json) as Record<string, any>;
    expect(secondBrief.settingGuidance).toMatchObject({
      feedbackMode: 'vague_dissatisfaction', dissatisfactionRound: 2
    });

    const specific = conversations.sendBossMessage(scope, '悬疑太重，救赎感再强一点');
    const specificBrief = JSON.parse((context.database.prepare(`SELECT task_brief_json FROM tasks WHERE task_id = ?`)
      .get(String(specific.action.taskId)) as { task_brief_json: string }).task_brief_json) as Record<string, any>;
    expect(specificBrief.settingGuidance).toMatchObject({ feedbackMode: 'specific_revision', dissatisfactionRound: 0 });
  });

  it('已有一轮候选后再次明确讨论同一设定项时重新启动三席独立提案', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会改变现实记录的实验笔记，必须守住自己的真实记忆。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [], initialMap: '',
      mustFollow: ['重要设定必须由作者确认后生效']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '重新讨论设定测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const pipeline = new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock);

    const first = conversations.sendBossMessage(scope, '请为策划理念提出三份独立方案。');
    expect(first.action).toMatchObject({ kind: 'discussion_scheduled', purpose: 'setting_proposal_panel' });
    const firstTaskId = String(first.action.taskId);
    expect(tasks.claimNext('worker-first-setting-panel')?.taskId).toBe(firstTaskId);
    await pipeline.executeClaimed(scope, firstTaskId, 'worker-first-setting-panel');
    new SettingGuidanceService(context.database, ids, clock).recordCandidate(scope, 'creative-concept', JSON.stringify({
      workflowArtifact: {
        type: 'setting_outline',
        payload: { items: [{ itemKey: 'creative-concept', content: '上一轮整理出的候选方案。' }] }
      }
    }));

    const repeated = conversations.sendBossMessage(scope, '请讨论设定：策划理念。');
    expect(repeated.action).toMatchObject({ kind: 'discussion_scheduled', purpose: 'setting_proposal_panel' });
    expect(String(repeated.action.taskId)).not.toBe(firstTaskId);
    expect(repeated.action.participants).toHaveLength(3);

    const repeatedTaskId = String(repeated.action.taskId);
    expect(tasks.claimNext('worker-repeated-setting-panel')?.taskId).toBe(repeatedTaskId);
    await pipeline.executeClaimed(scope, repeatedTaskId, 'worker-repeated-setting-panel');
    expect(context.database.prepare(`SELECT role_key FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'setting_proposal'
      ORDER BY created_at DESC, message_id DESC LIMIT 3`).all(scope.ownerId, scope.bookId)
      .map((row) => (row as { role_key: string }).role_key).sort()).toEqual([
        'chief_editor', 'lead_screenwriter', 'second_screenwriter'
      ]);
  });

  it('逐项确认全部必备设定后才开放剧情总纲讨论', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会修改现实记录的笔记，希望查明老师操控实验的目的并守住真实记忆。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [], initialMap: '',
      mustFollow: ['实验笔记的能力必须付出代价']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '逐项设定测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const guidance = new SettingGuidanceService(context.database, ids, clock);
    const confirmedKeys: string[] = [];

    for (;;) {
      const current = guidance.current(scope);
      if (current === null) break;
      guidance.recordCandidate(scope, current.itemKey, JSON.stringify({
        fields: {
          workflowArtifact: {
            type: 'setting_outline',
            payload: {
              items: [{
                itemKey: current.itemKey,
                content: `${current.label}采用与本书定位一致、可验证且不提前规定具体剧情结果的方案。`
              }]
            }
          }
        }
      }));
      const result = conversations.sendBossMessage(scope, '确认');
      confirmedKeys.push(current.itemKey);
      if (result.action.kind === 'setting_guidance_completed') break;
      expect(result.action).toMatchObject({
        kind: 'discussion_scheduled',
        purpose: 'setting_proposal_panel',
        confirmedSettingItemKey: current.itemKey
      });
    }

    const planning = context.database.prepare(`SELECT stage, setting_baseline_version_id
      FROM book_planning_states WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId) as {
        stage: string; setting_baseline_version_id: string | null;
      };
    expect(confirmedKeys[0]).toBe('creative-concept');
    expect(confirmedKeys.length).toBeGreaterThan(5);
    expect(planning.stage).toBe('setting_ready');
    expect(planning.setting_baseline_version_id).not.toBeNull();
    expect(guidance.current(scope)).toBeNull();

    const plot = conversations.sendBossMessage(scope, '讨论剧情总纲');
    expect(plot.action).toMatchObject({ kind: 'discussion_scheduled', purpose: 'open_discussion' });
    expect(plot.action).not.toHaveProperty('blockedBy');
  });

  it('最后一项结算失败时回滚确认状态，恢复依赖后可以原地重试', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '苏念', age: '二十岁', background: '大学新生', personalities: ['敏锐'] }],
      storyDirection: '苏念发现一本会修改现实记录的笔记，希望查明老师操控实验的目的并守住真实记忆。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['成长'], customTags: [], initialMap: '',
      mustFollow: ['实验笔记的能力必须付出代价']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '设定结算恢复测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const guidance = new SettingGuidanceService(context.database, ids, clock);

    for (;;) {
      const current = guidance.current(scope);
      expect(current).not.toBeNull();
      guidance.recordCandidate(scope, current!.itemKey, JSON.stringify({
        workflowArtifact: {
          type: 'setting_outline',
          payload: { items: [{ itemKey: current!.itemKey, content: `${current!.label}的有效候选。` }] }
        }
      }));
      if (current!.requiredIndex === current!.requiredCount) break;
      expect(guidance.confirmCurrent(scope).completed).toBe(false);
    }

    const storyBible = context.database.prepare(`SELECT artifact_id, active_version_id FROM artifacts
      WHERE owner_id = ? AND book_id = ? AND artifact_type = 'story_bible'`).get(scope.ownerId, scope.bookId) as {
        artifact_id: string; active_version_id: string;
      };
    context.database.prepare(`UPDATE artifacts SET active_version_id = NULL
      WHERE artifact_id = ? AND owner_id = ? AND book_id = ?`).run(storyBible.artifact_id, scope.ownerId, scope.bookId);

    expect(() => guidance.confirmCurrent(scope)).toThrow('缺少设定资料版本');
    const afterFailure = guidance.current(scope);
    expect(afterFailure).toMatchObject({ phase: 'revise', status: '候选待确认' });
    expect(context.database.prepare(`SELECT setting_baseline_version_id FROM book_planning_states
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId))
      .toEqual({ setting_baseline_version_id: null });

    context.database.prepare(`UPDATE artifacts SET active_version_id = ?
      WHERE artifact_id = ? AND owner_id = ? AND book_id = ?`)
      .run(storyBible.active_version_id, storyBible.artifact_id, scope.ownerId, scope.bookId);
    expect(guidance.confirmCurrent(scope)).toMatchObject({ completed: true });
    expect(guidance.current(scope)).toBeNull();
  });

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
    expect(capturedPrompt).toContain('当前设定大纲');
    expect(capturedPrompt).toContain('规划参考，不是正史');
    expect(capturedPrompt).not.toContain('story_bible');
    expect(capturedPrompt).not.toContain('confirmed_decisions');
    expect(capturedPrompt).not.toContain('sourceId');
    expect(capturedPrompt).not.toContain('contextPackHash');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?`).get(taskId)).toEqual({ count: 1 });

    const stored = context.database.prepare(`SELECT message_id FROM messages WHERE owner_id = ? AND book_id = ? AND sender_type = 'agent' LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { message_id: string };
    const legacyFull = '故事圣经sourceId:077f3110的premise原文与老板说明不同；confirmed_decisions为空。';
    context.database.prepare(`UPDATE messages SET content = ?, references_json = ? WHERE message_id = ?`).run(
      '故事圣经premise需要更新。',
      JSON.stringify([{ type: 'effective_output', version: 1, format: 'structured', fullContent: legacyFull,
        contentHash: createHash('sha256').update(legacyFull).digest('hex') }]),
      stored.message_id
    );
    const projected = (conversations.listMessages(scope) as Array<{ message_id: string; content: string; references_json: string }>)
      .find((message) => message.message_id === stored.message_id)!;
    expect(projected.content).toBe('设定大纲中的核心前提需要更新。');
    const projectedReference = JSON.parse(projected.references_json)[0] as { fullContent: string; contentHash: string };
    expect(projectedReference.fullContent).toContain('现有设定大纲中的核心前提');
    expect(projectedReference.fullContent).toContain('目前还没有正式确认的讨论结论');
    expect(projectedReference.fullContent).not.toMatch(/故事圣经|premise|sourceId|077f3110|confirmed_decisions/u);
    expect(projectedReference.contentHash).toBe(createHash('sha256').update(projectedReference.fullContent).digest('hex'));
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
    const deputySnapshot = context.database.prepare(`
      SELECT model_snapshot_id AS modelSnapshotId
      FROM agent_instances
      WHERE agent_id = ?
    `).get(tasks.require(scope, taskId).assignedAgentId) as { modelSnapshotId: string };
    expect(tasks.require(scope, taskId).brief).toMatchObject({ modelSnapshotId: deputySnapshot.modelSnapshotId });

    const secondClaim = tasks.claimNext('worker-deputy')!;
    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock, takeoverFactory)
      .executeClaimed(scope, taskId, 'worker-deputy', { leaseToken: secondClaim.leaseToken!, attemptNo: secondClaim.currentAttemptNo });
    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    const finalMessages = conversations.listMessages(scope) as Array<{ sender_type: string; role_key: string | null; message_type: string; content: string }>;
    expect(finalMessages
      .some((message) => message.sender_type === 'agent' && message.role_key === 'deputy_editor')).toBe(true);
    conversations.sendBossMessage(scope, '请继续说明下一步');
    const latestNotice = (conversations.listMessages(scope) as Array<{ message_type: string; content: string }>)
      .filter((message) => message.message_type === 'local_assistant_notice').at(-1);
    expect(latestNotice?.content).toContain('西施');
    expect(latestNotice?.content).not.toContain('貂蝉');
  });

  it('provider result unknown hands the same reply task to the deputy editor', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: 'Onboarding takeover book', text: 'A new book waiting for setting guidance'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks();
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, 'Please guide me through the setting');
    const taskId = String(scheduled.action.taskId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const firstClaim = tasks.claimNext('worker-chief-unknown')!;
    const takeoverFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'discussion' && roleKey === 'chief_editor') {
          return {
            provider,
            modelId,
            async generate() {
              throw new ModelAdapterError('provider output state is unknown', 'technical_failure', false, undefined, true);
            }
          };
        }
        if (purpose === 'discussion' && roleKey === 'deputy_editor') {
          return {
            provider,
            modelId,
            async generate() {
              return {
                provider,
                modelId,
                output: '我已经接过这次开书引导。我们先确认您最想写出的核心体验，再按顺序完善设定。',
                inputTokens: 120,
                outputTokens: 45,
                cashCostCny: 0,
                state: 'succeeded' as const
              };
            }
          };
        }
        throw new Error(`测试不应调用其他岗位：${String(roleKey)}`);
      }
    } as ModelAdapterFactory;

    await expect(new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock, takeoverFactory)
      .executeClaimed(scope, taskId, 'worker-chief-unknown', {
        leaseToken: firstClaim.leaseToken!,
        attemptNo: firstClaim.currentAttemptNo
      })).rejects.toThrow('已由');

    expect(tasks.require(scope, taskId)).toMatchObject({ status: 'queued', requiredEditorEpoch: 2 });
    const secondClaim = tasks.claimNext('worker-deputy-after-unknown')!;
    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock, takeoverFactory)
      .executeClaimed(scope, taskId, 'worker-deputy-after-unknown', {
        leaseToken: secondClaim.leaseToken!,
        attemptNo: secondClaim.currentAttemptNo
      });

    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    expect((conversations.listMessages(scope) as Array<{ sender_type: string; role_key: string | null }>)
      .filter((message) => message.sender_type === 'agent')).toEqual([
        expect.objectContaining({ role_key: 'deputy_editor' })
      ]);
  });

  it('历史失败的非点名回复在重试时对齐当前活动副编和模型快照', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '历史开场恢复书', text: '等待副编恢复开场引导'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, '请告诉我现在还缺哪些准备信息');
    const taskId = String(scheduled.action.taskId);
    const original = new TaskService(context.database, context.config.releaseId, clock).require(scope, taskId);
    context.database.prepare(`UPDATE tasks SET status = 'failed', error_code = 'CONVERSATION_REPLY_FAILED' WHERE task_id = ?`)
      .run(taskId);
    const deputy = context.database.prepare(`
      SELECT a.agent_id FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key = 'deputy_editor'
    `).get(scope.ownerId, scope.bookId) as { agent_id: string };
    const editors = new EditorLeaseService(context.database, ids, clock);
    const prepared = editors.prepareTakeover(scope, deputy.agent_id);
    editors.completeTakeover(scope, prepared.takeoverId);

    const retried = new TaskService(context.database, context.config.releaseId, clock).retryFailed(scope, taskId);
    const deputySnapshot = context.database.prepare(`SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?`)
      .get(deputy.agent_id) as { model_snapshot_id: string };
    expect(retried).toMatchObject({
      status: 'queued',
      assignedAgentId: deputy.agent_id,
      requiredEditorEpoch: 2,
      brief: { modelSnapshotId: deputySnapshot.model_snapshot_id }
    });
    expect(retried.assignedAgentId).not.toBe(original.assignedAgentId);
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

  it('锁定方向可以携带作者补充说明而不被误判为普通续聊', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '自然锁定测试书', text: '主角发现旧账与迁城资格有关'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const started = conversations.sendBossMessage(scope, '讨论并规划第1—3章：主角核验旧账后的剧情方向');
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const taskId = String(started.action.taskId);
    expect(tasks.claimNext('worker-lock-intent')?.taskId).toBe(taskId);
    await new (await import('../../../apps/api/src/application/discussions/discussion-pipeline-service.js')).DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock
    ).executeClaimed(scope, taskId, 'worker-lock-intent');

    const locked = conversations.sendBossMessage(scope, '锁定当前方向，保留旧账证据链，不要提前迁城');
    expect(locked.action).toMatchObject({ kind: 'creative_direction_locked' });
    const lockedBrief = tasks.require(scope, String(locked.action.taskId)).brief;
    expect(lockedBrief).toMatchObject({ purpose: 'locked_planning', requestedChapterCount: 3 });
    expect(String(lockedBrief.scopeText)).toContain('保留旧账证据链，不要提前迁城');
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

  it('尚无主编方向时锁定请求返回可理解的业务错误而不是内部错误', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '尚未讨论书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);

    try {
      conversations.sendBossMessage(scope, '锁定当前方向');
      throw new Error('预期锁定门禁拒绝请求');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).statusCode).toBe(409);
      expect((error as Error).message).toContain('先让主编和编剧完成');
    }
  });
});
