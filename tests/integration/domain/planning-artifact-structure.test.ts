import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import {
  mergeArcItems,
  mergeNumberedItems,
  parseMasterOutlineDepositOutput,
  parseVolumeOutlineDepositOutput,
  PlanningArtifactService
} from '../../../apps/api/src/application/artifacts/planning-artifact-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('structured rolling chapter plans', () => {
  let context: TestContext | undefined;
  afterEach(() => {
    context?.close();
    context = undefined;
  });

  it('promotes distinct chapter goals, beats and hooks instead of repeating the discussion summary', () => {
    context = createTestContext('wenmi-planning-structure-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '灰塔零号领主', text: '领地经营与灾潮谜案' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const agents = context.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id, r.role_key FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'lead_screenwriter')
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; model_snapshot_id: string; role_key: string }>;
    const agent = agents.find((item) => item.role_key === 'chief_editor')!;
    const writer = agents.find((item) => item.role_key === 'lead_screenwriter')!;
    const discussions = new DiscussionService(context.database, ids, clock);
    const discussion = discussions.create(scope, {
      type: 'quick', scopeText: '规划灰塔前三章', createdByAgentId: agent.agent_id,
      participants: [{ agentId: agent.agent_id, reason: '主编汇总' }, { agentId: writer.agent_id, reason: '编剧规划' }]
    });
    const planning = {
      arcTitle: '灰塔开机', arcGoal: '主角取得灰塔控制权并拒绝以居民献祭', endingState: '灰塔获得第一块合法领地',
      chapters: [
        { title: '灰塔醒来', goal: '林砚在坠塔现场确认自己能读取零号账簿', beats: ['坠塔', '账簿亮起'], hook: '账簿显示第一名欠债者已经死亡' },
        { title: '第一次审计', goal: '林砚用废料账目换取难民的三天信任', beats: ['清点废料', '公开账目'], hook: '城门外出现王都税官' },
        { title: '拒绝献祭', goal: '林砚公开否决灰塔以居民生命换能源的旧规则', beats: ['能源告急', '寻找替代源'], hook: '替代能源来自即将爆发的灾潮' }
      ]
    };
    const output = JSON.stringify({
      version: 1, format: 'json_object', fields: {
        answer: '采用经营数据服务人物选择的方案。', keyPoints: [], alternatives: [], risks: [], questions: [],
        nextStep: '确认后逐章创作', details: `规划落库 ${JSON.stringify(planning)}`
      }
    });
    discussions.addOpinion(scope, discussion.discussionId, {
      agentId: agent.agent_id, modelSnapshotId: agent.model_snapshot_id, phase: 'independent',
      content: { recommendation: output }, tokens: 200
    });
    discussions.setStage(scope, discussion.discussionId, 'collecting', 'synthesizing');
    const decisionId = discussions.synthesize(scope, discussion.discussionId, {
      recommendation: { summary: output }, alternatives: [], disagreements: [],
      impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
    });
    discussions.confirm(scope, discussion.discussionId, decisionId);

    new PlanningArtifactService(context.database, ids, clock)
      .promoteConfirmedDecision(scope, discussion.discussionId, decisionId, 3);
    const outlines = context.database.prepare(`
      SELECT v.content_json FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
      ORDER BY CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER)
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ content_json: string }>;
    const contents = outlines.map((row) => JSON.parse(row.content_json) as Record<string, unknown>);
    expect(contents.map((item) => item.goal)).toEqual(planning.chapters.map((item) => item.goal));
    expect(contents.map((item) => item.hook)).toEqual(planning.chapters.map((item) => item.hook));
    expect(new Set(contents.map((item) => item.goal)).size).toBe(3);
  });

  it('promotes every requested chapter when a rolling plan contains four chapters', () => {
    context = createTestContext('wenmi-planning-four-chapters-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '四章滚动规划', text: '验证四章规划不会被截断' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const agents = context.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id, r.role_key FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'lead_screenwriter')
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; model_snapshot_id: string; role_key: string }>;
    const agent = agents.find((item) => item.role_key === 'chief_editor')!;
    const writer = agents.find((item) => item.role_key === 'lead_screenwriter')!;
    const discussions = new DiscussionService(context.database, ids, clock);
    const discussion = discussions.create(scope, {
      type: 'quick', scopeText: '规划未来四章', createdByAgentId: agent.agent_id,
      participants: [
        { agentId: agent.agent_id, reason: '主编汇总' },
        { agentId: writer.agent_id, reason: '编剧规划' }
      ]
    });
    const chapters = [1, 2, 3, 4].map((number) => ({
      title: `第${number}章`,
      goal: `完成互不重复的目标${number}`,
      beats: [`推进${number}A`, `推进${number}B`],
      hook: `留下钩子${number}`
    }));
    const output = JSON.stringify({
      version: 1, format: 'json_object', fields: {
        answer: '形成四章连续规划', keyPoints: [], alternatives: [], risks: [], questions: [],
        nextStep: '确认后逐章创作',
        details: `规划落库 ${JSON.stringify({
          arcTitle: '四章短弧', arcGoal: '连续推进四章', endingState: '完成阶段结算',
          estimatedChapterRange: { minimum: 4, recommended: 4, maximum: 4 }, chapters
        })}`
      }
    });
    discussions.addOpinion(scope, discussion.discussionId, {
      agentId: agent.agent_id, modelSnapshotId: agent.model_snapshot_id, phase: 'independent',
      content: { recommendation: output }, tokens: 200
    });
    discussions.setStage(scope, discussion.discussionId, 'collecting', 'synthesizing');
    const decisionId = discussions.synthesize(scope, discussion.discussionId, {
      recommendation: { summary: output }, alternatives: [], disagreements: [],
      impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
    });
    discussions.confirm(scope, discussion.discussionId, decisionId);

    const promoted = new PlanningArtifactService(context.database, ids, clock)
      .promoteConfirmedDecision(scope, discussion.discussionId, decisionId, 4);

    expect(promoted.chapterOutlineVersionIds).toHaveLength(4);
    const outlines = context.database.prepare(`
      SELECT v.content_json FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
      ORDER BY CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER)
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ content_json: string }>;
    expect(outlines.map((row) => JSON.parse(row.content_json).goal)).toEqual(chapters.map((chapter) => chapter.goal));
  });

  it('merges later rolling plans without dropping earlier chapter and arc coverage', () => {
    expect(mergeNumberedItems(
      [
        { chapterNumber: 1, title: '开端' },
        { chapterNumber: 2, title: '旧标题' }
      ],
      [
        { chapterNumber: 2, title: '修订标题' },
        { chapterNumber: 3, title: '转折' }
      ],
      'chapterNumber'
    )).toEqual([
      { chapterNumber: 1, title: '开端' },
      { chapterNumber: 2, title: '修订标题' },
      { chapterNumber: 3, title: '转折' }
    ]);
    expect(mergeArcItems(
      [{ title: '第一段', chapterStart: 1, chapterEnd: 3 }],
      { title: '第二段', chapterStart: 4, chapterEnd: 6 }
    )).toEqual([
      { title: '第一段', chapterStart: 1, chapterEnd: 3 },
      { title: '第二段', chapterStart: 4, chapterEnd: 6 }
    ]);
  });

  it('keeps the whole-book master outline structurally distinct from a volume outline', () => {
    const master = parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify({
      premise: '被抄袭的策划进入自己设计的历史游戏世界',
      coreConflict: '主角必须在平台规则与真实历史代价之间争夺规则解释权',
      protagonistArc: '从只想证明自己，成长为愿意承担规则后果的秩序建立者',
      majorStages: [
        { title: '夺回身份', goal: '证明游戏规则与历史世界存在真实关联', turningPoint: '首个冠军奖励在现实兑现' },
        { title: '重建规则', goal: '联合被平台牺牲的玩家重写竞赛秩序', turningPoint: '最终对手掌握历史世界入口' }
      ],
      endingDirection: '主角公开规则来源并选择共同治理',
      storyPromises: ['游戏机制与历史选择互相改变'],
      openQuestions: ['最终是否保留职业联赛']
    })}`);
    const volume = parseVolumeOutlineDepositOutput(`卷纲落库 ${JSON.stringify({
      title: '被夺走的首胜',
      goal: '取得第一份可公开核验的原创证据',
      startingState: '主角刚被公司解约，只有未公开的旧版本记录',
      arcs: [{
        title: '匿名重返赛场',
        objective: '进入历史副本并逼出抄袭者的规则漏洞',
        turningPoints: ['原队友认出主角习惯', '副本奖励在现实到账'],
        payoff: '主角拿到带时间戳的规则证据'
      }],
      climax: '主角在决赛中迫使对手公开使用抄袭机制',
      endingState: '主角有了盟友和证据，但身份暴露给平台',
      openQuestions: ['原队友是否公开站队']
    })}`);

    expect(master?.majorStages).toHaveLength(2);
    expect(master?.coreConflict).toContain('规则解释权');
    expect(volume?.arcs).toHaveLength(1);
    expect(volume?.goal).toContain('原创证据');
    expect(JSON.stringify(volume)).not.toContain(master?.endingDirection);
  });

  it('rejects generic summaries and repeated stage goals instead of silently creating fake outlines', () => {
    expect(parseMasterOutlineDepositOutput('主编建议继续讨论。')).toBeNull();
    expect(parseVolumeOutlineDepositOutput('主编建议继续讨论。')).toBeNull();
    expect(() => parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify({
      premise: '前提',
      coreConflict: '冲突',
      protagonistArc: '成长',
      majorStages: [
        { title: '一', goal: '同一目标', turningPoint: '转折一' },
        { title: '二', goal: '同一目标', turningPoint: '转折二' }
      ],
      endingDirection: '结局'
    })}`)).toThrow('推进阶段目标不能重复');
  });
});
