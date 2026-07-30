import { afterEach, describe, expect, it } from 'vitest';
import {
  ConversationService,
  compactLockedDecisionSummary
} from '../../../apps/api/src/application/chat/conversation-service.js';
import {
  DiscussionPipelineService,
  compactOpinionsForEditor,
  compactOpinionsForCrossReview,
  compactRetrievalHardSourcesForEditor,
  compactPlanningArtifactForDiscussion,
  discussionContextTokenBudget,
  discussionOutputTokenLimit,
  discussionRetrievalQuery
} from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import type { ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { ModelAdapterError } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { parseSpanEstimateOutput } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import {
  parseMasterOutlineDepositOutput,
  parsePlanningDepositOutput
} from '../../../apps/api/src/application/artifacts/planning-artifact-service.js';

describe('自然语言讨论运行闭环', () => {
  let context: TestContext | undefined;
  afterEach(() => {
    context?.close();
    context = undefined;
  });

  it('为必须落库的规划结构保留足够输出空间，但不放大普通讨论', () => {
    expect(discussionOutputTokenLimit(
      'deputy_editor', true, 'independent', '【卷纲专项讨论资料包】', 'open_discussion'
    )).toBe(6_000);
    expect(discussionOutputTokenLimit(
      'deputy_editor', true, 'independent', '普通创作讨论', 'open_discussion'
    )).toBe(3_600);
    expect(discussionOutputTokenLimit(
      'deputy_editor', true, 'independent', '未来三章', 'locked_planning'
    )).toBe(6_000);
  });

  it('compacts a locked creative decision before scheduling rolling chapter planning', () => {
    const summary = [
      '已锁定采用采集任务与结算折扣前置，并保留真实体力代价。',
      '',
      '关键依据：',
      '- 首次到账必须兑现书名。',
      '- 损失必须来自同一条完成度规则。',
      '',
      '可选方向：',
      `- 已放弃方向：${'不应继续注入的长篇备选论证'.repeat(600)}`,
      '',
      '方向C（优先推荐）：采集任务、20元到账、完成度折扣和体力代价形成闭环。',
      '',
      '完整依据：',
      '不应重复注入全部编剧原文。'.repeat(600)
    ].join('\n');

    const compacted = compactLockedDecisionSummary(summary);

    expect(compacted).toContain('已锁定采用采集任务');
    expect(compacted).toContain('首次到账必须兑现书名');
    expect(compacted).toContain('方向C（优先推荐）');
    expect(compacted).not.toContain('不应继续注入的长篇备选论证'.repeat(20));
    expect(compacted).not.toContain('不应重复注入全部编剧原文'.repeat(20));
    expect(compacted.length).toBeLessThanOrEqual(900);
  });

  it('keeps the owner lock supplement when the editor summary is longer than the context budget', () => {
    const summary = [
      `主编推荐：${'先解释认证路径与训练成本。'.repeat(80)}`,
      '',
      `关键依据：${'四类职业具有对等但不同的成本。'.repeat(60)}`,
      '',
      '老板锁定时补充：界面和正文只用中文；工程主职保留一项基础战斗技能，代价为额外费用与三天锁定期。'
    ].join('\n');

    const compacted = compactLockedDecisionSummary(summary);

    expect(compacted).toContain('老板锁定时补充');
    expect(compacted).toContain('工程主职保留一项基础战斗技能');
    expect(compacted).toContain('三天锁定期');
    expect(compacted.length).toBeLessThanOrEqual(900);
  });

  it('剧情总纲只给主编注入设定正文，不重复携带每项讨论审计元数据', () => {
    const compacted = compactPlanningArtifactForDiscussion('setting', JSON.stringify({
      schema: 'story-bible-v2',
      title: '测试书',
      positioning: {
        genre: { value: '游戏体育', sourceStatus: 'explicit' }
      },
      characters: [{
        name: '夏炎',
        role: 'male_lead',
        sourceStatus: 'owner_reference'
      }],
      settingOutline: {
        confirmedAt: '2026-07-29T00:00:00.000Z',
        items: [{
          itemKey: 'economy',
          label: '经济规则',
          content: '奖金只按公开竞技表现结算。',
          sourceDiscussionId: 'discussion-1',
          sourceDecisionId: 'decision-1',
          confirmedAt: '2026-07-29T00:00:00.000Z'
        }]
      }
    }));

    expect(compacted).toContain('奖金只按公开竞技表现结算');
    expect(compacted).toContain('夏炎');
    expect(compacted).not.toContain('sourceDiscussionId');
    expect(compacted).not.toContain('sourceDecisionId');
    expect(compacted).not.toContain('sourceStatus');
    expect(compacted).not.toContain('confirmedAt');
  });

  it('主编汇总上下文可容纳老板原话和四份真实岗位意见，编剧单席仍保持精简预算', () => {
    expect(discussionContextTokenBudget(false)).toBe(8_000);
    // 方舟 Plan 的稳定输入边界按 8k 控制；超过该边界时 Kimi 与
    // DeepSeek 的主编汇总都曾在真实任务中连续返回技术失败。
    expect(discussionContextTokenBudget(true)).toBe(7_200);
    const compacted = compactOpinionsForEditor(Array.from({ length: 4 }, (_, index) => ({
      opinionId: `opinion-${index}`,
      agentId: `agent-${index}`,
      role: `编剧${index}`,
      roleKey: index % 2 === 0 ? 'lead_screenwriter' : 'second_screenwriter',
      phase: index < 2 ? 'independent' : 'cross_review',
      output: `核心方案${index}：${'完整论证'.repeat(1_000)}\n最终结论${index}`
    })));
    expect(compacted).toHaveLength(4);
    expect(compacted.every((opinion) => opinion.output.includes('完整原文保存在讨论证据中'))).toBe(true);
    expect(compacted.every((opinion) => opinion.output.includes('最终结论'))).toBe(true);
    expect(compacted.every((opinion) => opinion.output.length < 1_100)).toBe(true);
  });

  it('滚动章纲压缩全书设定并以有界摘要交叉质疑，避免硬来源撑爆上下文', () => {
    const setting = compactPlanningArtifactForDiscussion('setting', JSON.stringify({
      title: '测试书',
      positioning: { genre: { value: '游戏体育' } },
      openingReference: { mustFollow: ['不写多角恋'] },
      settingOutline: {
        items: Array.from({ length: 60 }, (_, index) => ({
          itemKey: `setting-${index}`,
          groupTitle: `分组${index}`,
          label: `设定${index}`,
          content: `这是第${index}项设定的完整说明，包含规则、边界、代价和未知项。`.repeat(20)
        }))
      }
    }), 12);
    const peer = compactOpinionsForCrossReview([{
      opinionId: 'opinion-1',
      agentId: 'agent-1',
      role: '编剧',
      roleKey: 'lead_screenwriter',
      phase: 'independent',
      output: `核心方案：${'完整论证'.repeat(2_000)}\n章节跨度估算 {"minimum":3,"recommended":3,"maximum":4}`
    }]);

    expect(setting.length).toBeLessThan(8_000);
    expect(setting).toContain('不写多角恋');
    expect(peer[0]?.output).toContain('核心方案');
    expect(peer[0]?.output).toContain('章节跨度估算');
    expect(peer[0]?.output.length).toBeLessThan(2_600);
  });

  it('滚动章纲硬来源只保留开书边界，详细设定交给混合检索按需召回', () => {
    const setting = compactPlanningArtifactForDiscussion('setting', JSON.stringify({
      title: '测试书',
      positioning: { genre: { value: '游戏体育' } },
      characters: [{ name: '夏炎', role: 'male_lead' }],
      openingReference: { mustFollow: ['不写多角恋'] },
      settingOutline: {
        items: Array.from({ length: 60 }, (_, index) => ({
          itemKey: `setting-${index}`,
          label: `设定${index}`,
          content: `全书规则${index}`.repeat(100)
        }))
      }
    }), 12, false);

    expect(setting).toContain('夏炎');
    expect(setting).toContain('不写多角恋');
    expect(setting).not.toContain('全书规则');
    expect(setting.length).toBeLessThan(1_000);
  });

  it('bounds editor retrieval evidence without losing source traceability', () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({
      sourceType: 'retrieval:manuscript',
      sourceId: `source-${index}`,
      content: `chapter-${index} ${'full canon prose '.repeat(2_000)}`,
      reason: 'closed canon evidence',
      priority: 96 - index
    }));

    const compacted = compactRetrievalHardSourcesForEditor(sources);

    expect(compacted).toHaveLength(4);
    expect(compacted.map((source) => source.sourceId)).toEqual([
      'source-0',
      'source-1',
      'source-2',
      'source-3'
    ]);
    expect(compacted.every((source) => source.content.length < 2_000)).toBe(true);
    expect(compacted.every((source) => source.content.includes('chapter-'))).toBe(true);
  });

  it('成组设定资料包只用书名和本批设定项检索，不把全部已确认正文送进查询', () => {
    const query = discussionRetrievalQuery([
      '【设定大纲成组讨论资料包】',
      '书籍：这游戏上线就给钱',
      '本批设定项JSON：[{"groupTitle":"势力与组织","label":"主要势力","prompt":"谁制定规则？"}]',
      `已经确认的设定JSON：[{"content":"${'很长的既有设定'.repeat(2_000)}"}]`
    ].join('\n'));
    expect(query).toContain('这游戏上线就给钱');
    expect(query).toContain('主要势力');
    expect(query).toContain('谁制定规则');
    expect(query).not.toContain('很长的既有设定');
  });

  it('失败的讨论任务可以保留既有意见并重新入队续跑', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '失败任务续跑测试书',
      text: '主编汇总前上下文门禁失败'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const task = tasks.create(scope, {
      taskId: ids.next(),
      taskType: 'discussion',
      idempotencyKey: 'failed-discussion-retry',
      initialPhase: 'collecting',
      brief: { discussionId: ids.next() }
    });
    context.database.prepare(`UPDATE tasks SET status = 'failed', error_code = 'DISCUSSION_FAILED' WHERE task_id = ?`)
      .run(task.taskId);

    expect(tasks.retryFailed(scope, task.taskId)).toMatchObject({
      status: 'queued',
      attemptCount: 0
    });
  });

  it('接受真实模型常见的Markdown标题和代码围栏跨度估算', () => {
    expect(parseSpanEstimateOutput([
      '建议先完成证据核验，再进入迁城抉择。',
      '**章节跨度估算**',
      '```json',
      '{"minimum":5,"recommended":8,"maximum":12,"units":[{"unit":"核验账簿","suggestedChapters":3}],"assumptions":["旧账可追溯"],"uncertainty":["邻地领主立场"]}',
      '```'
    ].join('\n'), false)).toMatchObject({
      minimum: 5,
      recommended: 8,
      maximum: 12
    });
  });

  it('供应商只漏掉展示标题时仍接受结尾的结构化跨度估算', () => {
    expect(parseSpanEstimateOutput([
      '锁定方向适合用三章完成滚动规划。',
      '{"minimum":3,"recommended":3,"maximum":3,"units":[{"unit":"制度化压力测试","suggestedChapters":3}],"assumptions":["三天内回报"],"uncertainty":["收粮队规模"]}'
    ].join('\n'), false)).toMatchObject({
      minimum: 3,
      recommended: 3,
      maximum: 3
    });
  });

  it('接受Markdown标题和多行代码围栏中的规划落库', () => {
    expect(parsePlanningDepositOutput([
      '建议把第一弧控制在八章。',
      '**规划落库**',
      '```json',
      '{',
      '  "arcTitle": "灰塔旧账",',
      '  "arcGoal": "核验旧账并决定迁城",',
      '  "endingState": "主角掌握迁城代价",',
      '  "chapters": [{"title":"旧账","goal":"找到可核验账页","beats":["进入账库"],"hook":"账页缺了一角"}]',
      '}',
      '```'
    ].join('\n'))).toMatchObject({
      arcTitle: '灰塔旧账',
      chapters: [expect.objectContaining({ title: '旧账' })]
    });
  });

  it('设定专项讨论固定由主编主持并激活两名异模型编剧', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '设定讨论测试书',
      text: '男频游戏异界与历史脑洞'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(
      scope,
      '讨论设定 【设定大纲成组讨论资料包】\n本批设定项JSON：[{"itemKey":"era"}]\n已确认资料中提到历史背景，但本次必须由两名编剧讨论'
    );

    expect(scheduled.action).toMatchObject({ kind: 'discussion_scheduled', purpose: 'open_discussion' });
    const discussionId = String(scheduled.action.discussionId);
    const participants = context.database.prepare(`
      SELECT r.role_key
      FROM discussion_participants p
      JOIN agent_instances a ON a.agent_id = p.agent_id
      JOIN role_templates r
        ON r.role_template_id = a.role_template_id
       AND r.version = a.role_template_version
      WHERE p.discussion_id = ?
      ORDER BY r.role_key
    `).all(discussionId) as Array<{ role_key: string }>;
    expect(participants.map((item) => item.role_key)).toEqual([
      'chief_editor',
      'lead_screenwriter',
      'second_screenwriter'
    ]);
    expect(context.database.prepare(`SELECT discussion_type, status FROM discussions WHERE discussion_id = ?`).get(discussionId))
      .toEqual({ discussion_type: 'collaborative', status: 'collecting' });
  });

  it('按问题激活相关岗位，经Worker执行真实模型调用并由老板明确确认方案', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '讨论闭环测试书', text: '雾城悬疑长篇' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, '讨论 下一章的读者情绪和结尾钩子');
    expect(scheduled.action).toMatchObject({ kind: 'creative_session_started', roundKind: 'initial_exploration' });
    const taskId = String(scheduled.action.taskId);
    const discussionId = String(scheduled.action.discussionId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    expect(tasks.claimNext('worker-discussion')?.taskId).toBe(taskId);

    const result = await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, taskId, 'worker-discussion');
    expect(result).toMatchObject({ discussionId, opinionCount: 5 });
    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    const discussion = context.database.prepare(`SELECT status, calls_used FROM discussions WHERE discussion_id = ?`).get(discussionId);
    expect(discussion).toEqual({ status: 'awaiting_boss', calls_used: 5 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_participants WHERE discussion_id = ? AND responded = 1`).get(discussionId)).toEqual({ count: 3 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ? AND state = 'succeeded' AND context_pack_id IS NOT NULL`).get(taskId)).toEqual({ count: 5 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_opinions WHERE discussion_id = ? AND phase = 'cross_review'`).get(discussionId)).toEqual({ count: 2 });
    expect(context.database.prepare(`SELECT COUNT(DISTINCT model_snapshot_id) AS count FROM plot_span_estimates WHERE discussion_id = ? AND independence_attested = 1`).get(discussionId)).toEqual({ count: 0 });
    const messages = conversations.listMessages(scope) as Array<{ sender_type: string; content: string; references_json: string; model_provider: string | null; model_id: string | null }>;
    const summary = messages.find((message) => message.sender_type === 'agent');
    expect(summary).toMatchObject({ model_provider: 'local-deterministic', model_id: 'wenmi-fixture-v2-chief_editor' });
    expect(summary?.content).toContain('锁定当前方向');
    expect(summary?.content).not.toContain(result.decisionId);
    expect(summary?.content).not.toContain('份独立方案与交叉质疑');
    expect(summary?.content).not.toContain('【婉儿】');
    const effectiveReference = (JSON.parse(summary?.references_json ?? '[]') as Array<Record<string, unknown>>)
      .find((reference) => reference.type === 'effective_output');
    expect(effectiveReference).toBeUndefined();

    const callsBeforeConfirmation = (context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE book_id = ?`).get(scope.bookId) as { count: number }).count;
    expect(conversations.sendBossMessage(scope, '锁定当前方向').action).toMatchObject({
      kind: 'creative_direction_locked',
      sourceDecisionId: result.decisionId,
      roundKind: 'locked_planning'
    });
    expect(context.database.prepare(`SELECT status FROM discussions WHERE discussion_id = ?`).get(discussionId)).toEqual({ status: 'confirmed' });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE book_id = ?`).get(scope.bookId)).toEqual({ count: callsBeforeConfirmation });
  });

  it('剧情总纲要求两名编剧各自提交完整阶段方案，通过后才交叉并由主编综合', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '阶段总纲讨论书',
      text: '男频游戏竞技与历史经营'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const scheduled = conversations.sendBossMessage(
      scope,
      [
        '讨论剧情总纲 【剧情总纲专项讨论资料包】',
        '主角夏炎必须在游戏竞技与历史经营的冲突中夺回规则解释权。',
        '请由两名编剧分别直接规划阶段，再由主编整理。'
      ].join('\n')
    );
    expect(scheduled.action).toMatchObject({ kind: 'creative_session_started' });
    const taskId = String(scheduled.action.taskId);
    const discussionId = String(scheduled.action.discussionId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    expect(tasks.claimNext('worker-master-outline')?.taskId).toBe(taskId);

    const result = await new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock
    ).executeClaimed(scope, taskId, 'worker-master-outline');

    expect(result).toMatchObject({ discussionId, opinionCount: 5 });
    const opinions = context.database.prepare(`
      SELECT o.phase, o.content_json, r.role_key
      FROM discussion_opinions o
      JOIN agent_instances a ON a.agent_id = o.agent_id
      JOIN role_templates r
        ON r.role_template_id = a.role_template_id
       AND r.version = a.role_template_version
      WHERE o.discussion_id = ?
      ORDER BY o.created_at, o.opinion_id
    `).all(discussionId) as Array<{ phase: string; content_json: string; role_key: string }>;
    const independentWriters = opinions.filter((opinion) =>
      opinion.phase === 'independent'
      && ['lead_screenwriter', 'second_screenwriter'].includes(opinion.role_key)
    );
    expect(independentWriters).toHaveLength(2);
    for (const opinion of independentWriters) {
      const content = JSON.parse(opinion.content_json) as { recommendation: string };
      const parsed = parseMasterOutlineDepositOutput(content.recommendation);
      expect(parsed?.outlineSchema).toBe('stage_master_v2');
      expect(parsed?.majorStages[0]?.mainline.result).toBeTruthy();
    }
    const crossReviews = opinions.filter((opinion) =>
      opinion.phase === 'cross_review'
      && ['lead_screenwriter', 'second_screenwriter'].includes(opinion.role_key)
    );
    expect(crossReviews).toHaveLength(2);
    for (const opinion of crossReviews) {
      const content = JSON.parse(opinion.content_json) as { recommendation: string };
      expect(parseMasterOutlineDepositOutput(content.recommendation)).toBeNull();
    }
    const editor = opinions.find((opinion) =>
      opinion.phase === 'independent' && opinion.role_key === 'chief_editor'
    );
    expect(editor).toBeDefined();
    const editorContent = JSON.parse(editor!.content_json) as { recommendation: string };
    expect(parseMasterOutlineDepositOutput(editorContent.recommendation)?.outlineSchema)
      .toBe('stage_master_v2');
  });

  it('剧情总纲已经确认后仍可显式重新发起新版总纲讨论，而不会误路由到卷纲', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '旧版总纲升级书',
      text: '游戏异界与历史经营'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    context.database.prepare(`
      INSERT INTO book_opening_blueprints (
        opening_blueprint_id, owner_id, book_id, version, taxonomy_version, channel,
        category_key, category_name, blueprint_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, 1, 'test-v1', 'male', 'game', '游戏体育', '{}', ?, 'active', ?)
    `).run(ids.next(), scope.ownerId, scope.bookId, '0'.repeat(64), clock.now().toISOString());
    context.database.prepare(`
      UPDATE book_planning_states
      SET stage = 'master_outline_ready'
      WHERE owner_id = ? AND book_id = ?
    `).run(scope.ownerId, scope.bookId);

    const scheduled = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    ).sendBossMessage(scope, '讨论 剧情总纲升级：按新版阶段格式重新规划');

    expect(scheduled.action).toMatchObject({ kind: 'discussion_scheduled', purpose: 'open_discussion' });
    const discussion = context.database.prepare(`
      SELECT scope_text FROM discussions WHERE discussion_id = ?
    `).get(String(scheduled.action.discussionId)) as { scope_text: string };
    expect(discussion.scope_text).toContain('【剧情总纲专项讨论资料包】');
    expect(discussion.scope_text).not.toContain('【卷纲专项讨论资料包】');
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
    prepareBookForWriting(context, scope, ids, clock, 1);

    const locked = conversations.sendBossMessage(scope, '锁定当前方向');
    expect(locked.action).toMatchObject({ kind: 'creative_direction_locked', sourceDecisionId: result.decisionId });
    const planningTaskId = String(locked.action.taskId);
    expect(tasks.claimNext('worker-rolling-planning')?.taskId).toBe(planningTaskId);
    const planningResult = await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, planningTaskId, 'worker-rolling-planning');
    expect(context.database.prepare(`SELECT COUNT(DISTINCT model_snapshot_id) AS count FROM plot_span_estimates
      WHERE discussion_id = ? AND independence_attested = 1`).get(planningResult.discussionId)).toEqual({ count: 2 });
    const confirmed = conversations.sendBossMessage(scope, '确认当前规划');
    expect(confirmed.action).toMatchObject({ kind: 'discussion_confirmed', planningPrepared: true, chapterOutlineCount: 3 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM artifacts
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
        AND artifact_type IN ('creative_plan','story_bible','master_outline','chapter_outline')
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 7 });

    const write = conversations.sendBossMessage(scope, '写一章');
    expect(write.action).toMatchObject({ kind: 'chapter_batch_scheduled', count: 1 });
    const outline = context.database.prepare(`
      SELECT v.content_json FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline' AND a.status = 'active'
        AND json_extract(v.content_json, '$.sourceDecisionId') = ?
      ORDER BY CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER) LIMIT 1
    `).get(scope.ownerId, scope.bookId, planningResult.decisionId) as { content_json: string };
    expect(JSON.parse(outline.content_json)).toMatchObject({
      sourceDiscussionId: planningResult.discussionId,
      sourceDecisionId: planningResult.decisionId
    });
  });

  it('试写只生成可修改临时稿，不启动三席审校或进入正史', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '试写隔离测试书',
      text: '主角在雨夜发现失踪信使留下的半枚印章'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const conversations = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const trial = conversations.sendBossMessage(scope, '试写看看');
    expect(trial.action).toMatchObject({ kind: 'trial_draft_scheduled', count: 1 });

    const batch = await new ChapterBatchService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    ).run(scope, String(trial.action.batchId));
    expect(batch.batch.status).toBe('completed');
    expect(batch.results).toEqual([
      expect.objectContaining({ status: 'completed', phase: 'completed', rewriteCount: 0 })
    ]);
    expect(context.database.prepare(`
      SELECT settlement_status, generation_status FROM chapters
      WHERE owner_id = ? AND book_id = ? AND chapter_number = 1
    `).get(scope.ownerId, scope.bookId)).toEqual({
      settlement_status: 'unsettled',
      generation_status: 'completed'
    });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM review_reports WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM confirmations WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`
      SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
    const trialChapter = context.database.prepare(`
      SELECT chapter_id, current_manuscript_version_id FROM chapters
      WHERE owner_id = ? AND book_id = ? AND chapter_number = 1
    `).get(scope.ownerId, scope.bookId) as {
      chapter_id: string;
      current_manuscript_version_id: string;
    };
    const formalReview = new ChapterBatchService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    ).scheduleExistingRevision(
      scope,
      trialChapter.chapter_id,
      trialChapter.current_manuscript_version_id,
      'review_existing'
    );
    expect(new TaskService(context.database, context.config.releaseId, clock)
      .require(scope, formalReview.taskId).brief).toMatchObject({
      operation: 'review_existing',
      manuscriptVersionId: trialChapter.current_manuscript_version_id
    });
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
    expect(completed.opinionCount).toBe(5);
    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?`)
      .get(scope.ownerId, scope.bookId, discussionId)).toEqual({ count: 5 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE owner_id = ? AND book_id = ?
      AND task_id = ? AND state = 'failed' AND error_class = 'technical_failure'`)
      .get(scope.ownerId, scope.bookId, taskId)).toEqual({ count: 2 });
    const activeEditor = context.database.prepare(`SELECT r.role_key FROM editor_leases l JOIN agent_instances a
      ON a.agent_id = l.active_editor_agent_id JOIN role_templates r
      ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE l.owner_id = ? AND l.book_id = ?`).get(scope.ownerId, scope.bookId);
    expect(activeEditor).toEqual({ role_key: 'deputy_editor' });
  });

  it('活动主编结果未知时由副编接管同一讨论，并复用已完成的双编剧意见', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '主编结果未知接管讨论书',
      text: '游戏异界与历史架空的世界设定'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const scheduled = conversations.sendBossMessage(
      scope,
      '讨论设定 【设定专项讨论资料包】\n当前设定项：时代与世界类型\n讨论目标：比较现实、架空和多世界方案'
    );
    const taskId = String(scheduled.action.taskId);
    const discussionId = String(scheduled.action.discussionId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const firstClaim = tasks.claimNext('worker-chief-unknown')!;
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const takeoverFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'discussion' && roleKey === 'chief_editor') {
          return {
            provider,
            modelId,
            async generate() {
              throw new ModelAdapterError(
                'provider output state is unknown', 'technical_failure', false, undefined, true
              );
            }
          };
        }
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;

    await expect(new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock, takeoverFactory
    ).executeClaimed(scope, taskId, 'worker-chief-unknown', {
      leaseToken: firstClaim.leaseToken!,
      attemptNo: firstClaim.currentAttemptNo
    })).rejects.toThrow('已由');

    expect(tasks.require(scope, taskId)).toMatchObject({
      status: 'queued',
      requiredEditorEpoch: 2
    });
    const opinionsBeforeResume = context.database.prepare(`
      SELECT COUNT(*) AS count FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?
    `).get(scope.ownerId, scope.bookId, discussionId);
    expect(opinionsBeforeResume).toEqual({ count: 4 });

    const secondClaim = tasks.claimNext('worker-deputy-after-unknown')!;
    await new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock, takeoverFactory
    ).executeClaimed(scope, taskId, 'worker-deputy-after-unknown', {
      leaseToken: secondClaim.leaseToken!,
      attemptNo: secondClaim.currentAttemptNo
    });

    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?
    `).get(scope.ownerId, scope.bookId, discussionId)).toEqual({ count: 5 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ?
        AND state = 'interrupted' AND error_class = 'provider_result_unknown'
    `).get(scope.ownerId, scope.bookId, taskId)).toEqual({ count: 1 });
  });

  it('副编汇总失败时明确通知老板，重试只继续未完成的汇总', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '副编恢复讨论书',
      text: '游戏异界与历史架空的世界设定'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const scheduled = conversations.sendBossMessage(
      scope,
      '讨论设定 【设定专项讨论资料包】\n当前设定项：时代与世界类型\n讨论目标：比较现实、架空和多世界方案'
    );
    const taskId = String(scheduled.action.taskId);
    const discussionId = String(scheduled.action.discussionId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    let deputyFailures = 0;
    const recoveryFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'discussion' && roleKey === 'chief_editor') {
          return { provider, modelId, async generate() { throw new Error('模拟主编模型不可用'); } };
        }
        if (purpose === 'discussion' && roleKey === 'deputy_editor' && deputyFailures < 2) {
          return {
            provider,
            modelId,
            async generate() {
              deputyFailures += 1;
              throw new Error('模拟副编模型暂时不可用');
            }
          };
        }
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;

    const chiefClaim = tasks.claimNext('worker-chief-failure')!;
    await expect(new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock, recoveryFactory
    ).executeClaimed(scope, taskId, 'worker-chief-failure', {
      leaseToken: chiefClaim.leaseToken!,
      attemptNo: chiefClaim.currentAttemptNo
    })).rejects.toThrow('已由');
    expect(tasks.require(scope, taskId).status).toBe('queued');

    const deputyClaim = tasks.claimNext('worker-deputy-failure')!;
    await expect(new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock, recoveryFactory
    ).executeClaimed(scope, taskId, 'worker-deputy-failure', {
      leaseToken: deputyClaim.leaseToken!,
      attemptNo: deputyClaim.currentAttemptNo
    })).rejects.toThrow();
    expect(tasks.require(scope, taskId)).toMatchObject({
      status: 'failed',
      errorCode: 'DISCUSSION_FAILED'
    });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?
    `).get(scope.ownerId, scope.bookId, discussionId)).toEqual({ count: 4 });
    const failureNotice = (conversations.listMessages(scope) as Array<{ message_type: string; content: string }>)
      .find((message) => message.message_type === 'task_failure');
    expect(failureNotice?.content).toContain('已经完成的 4 份成员意见和讨论进度都已保存');
    expect(failureNotice?.content).toContain('继续重试');

    tasks.retryFailed(scope, taskId);
    const retryClaim = tasks.claimNext('worker-deputy-retry')!;
    await new DiscussionPipelineService(
      context.database, context.config.releaseId, ids, clock, recoveryFactory
    ).executeClaimed(scope, taskId, 'worker-deputy-retry', {
      leaseToken: retryClaim.leaseToken!,
      attemptNo: retryClaim.currentAttemptNo
    });

    expect(tasks.require(scope, taskId).status).toBe('succeeded');
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM discussion_opinions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?
    `).get(scope.ownerId, scope.bookId, discussionId)).toEqual({ count: 5 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count
      FROM model_calls m
      JOIN agent_instances a ON a.agent_id = m.agent_id
      JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ?
        AND r.role_key IN ('lead_screenwriter', 'second_screenwriter')
        AND m.state = 'succeeded'
    `).get(scope.ownerId, scope.bookId, taskId)).toEqual({ count: 4 });
  });

  it('汇总不复述老板整段原话，也不添加机械完成标题', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '短标题书', text: '雾城悬疑长篇' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const longScope = '讨论 规划第11至20章共且仅共10章作为地下账库与迁城试验故事弧承接第10章发现的地下封存总账林砚要查清灰塔为何被王都从账面抹除同时把十七人的据点改造成能够移动的领地必须包含总账并非普通纸账岑鸢发现审计印记的第二层用途贺铸训练第一支守备队第一次灰塔升级需在救人和保资源之间选择出现一个立场可信但利益冲突的邻地领主';
    const scheduled = conversations.sendBossMessage(scope, longScope);
    const taskId = String(scheduled.action.taskId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    expect(tasks.claimNext('worker-title')?.taskId).toBe(taskId);
    await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, taskId, 'worker-title');
    const messages = conversations.listMessages(scope) as Array<{ sender_type: string; content: string }>;
    const summary = messages.find((message) => message.sender_type === 'agent');
    expect(summary).toBeDefined();
    expect(summary?.content).not.toContain('讨论“');
    expect(summary?.content).not.toContain('已完成。');
    expect(summary?.content).not.toContain('{"');
    expect(summary?.content).not.toContain('立场可信但利益冲突的邻地领主');
  });
});
