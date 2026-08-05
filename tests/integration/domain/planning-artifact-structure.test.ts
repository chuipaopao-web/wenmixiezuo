import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import {
  mergeNumberedItems,
  nextChapterPlanningNumber,
  parseMasterOutlineDepositOutput,
  parsePlanningDepositOutput,
  PlanningArtifactService
} from '../../../apps/api/src/application/artifacts/planning-artifact-service.js';
import { compactPlanningArtifactForDiscussion } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { WritingReadinessService } from '../../../apps/api/src/application/creation/writing-readiness-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

function stageMasterPayload(): Record<string, unknown> {
  return {
    outlineSchema: 'stage_master_v2',
    premise: '被抄袭的策划进入自己设计的历史游戏世界',
    coreConflict: '主角必须在平台规则与真实历史代价之间争夺规则解释权',
    protagonistArc: '从只想证明自己，成长为愿意承担规则后果的秩序建立者',
    majorStages: [
      {
        stageNumber: 1,
        title: '夺回身份',
        chapterRange: { start: 1, end: 50 },
        mainline: {
          encounter: '夏炎被夺走署名后进入历史游戏世界，发现冠军结算会影响现实。',
          resolution: '夏炎以公开战绩、队友证词和规则漏洞逐步建立原创证据链。',
          result: '夏炎夺回参赛身份，并确认平台背后仍有人操纵历史入口。'
        },
        structure: {
          setup: '失业与抄袭逼迫夏炎匿名参赛。',
          development: '夏炎连续赢下副本并建立自己的队伍。',
          turn: '首个冠军奖励在现实兑现，同时暴露数据所有权陷阱。',
          conclusion: '夏炎拒绝控制性合同，带队独立。'
        },
        stageSummary: '夏炎从孤立求生者变成拥有队伍和证据的独立选手。',
        pendingThreads: ['历史入口由谁控制', '原队友是否公开作证'],
        followUpDirection: '追查平台如何利用历史入口垄断赛事。'
      },
      {
        stageNumber: 2,
        title: '重建规则',
        chapterRange: { start: 51, end: 100 },
        mainline: {
          encounter: '平台封锁独立队伍的结算渠道，并利用历史副本逼迫夏炎妥协。',
          resolution: '夏炎联合被牺牲的玩家公开账本，争取退出权与数据权。',
          result: '旧平台垄断被打破，但夏炎发现最终对手掌握历史入口源头。'
        },
        structure: {
          setup: '独立队伍遭遇结算封锁。',
          development: '受害玩家组成联盟并验证公开账本。',
          turn: '联盟内部有人用新规则谋取私利。',
          conclusion: '夏炎公开规则来源并拒绝成为新垄断者。'
        },
        stageSummary: '赛事规则由平台私产转为可监督的公共协议，主角承担治理责任。',
        pendingThreads: ['历史入口的最终归属'],
        followUpDirection: '进入终局，决定入口和新规则由谁维护。'
      }
    ],
    endingDirection: '主角公开规则来源并选择共同治理',
    storyPromises: ['游戏机制与历史选择互相改变'],
    openQuestions: ['最终是否保留职业联赛']
  };
}

function chapterOutlineV2Plan(chapterNumber: number): Record<string, unknown> {
  return {
    chapterNumber,
    title: `第${chapterNumber}章`,
    chapterFunction: `完成互不重复的章节功能${chapterNumber}`,
    openingState: `第${chapterNumber}章开场局面已经成立`,
    requiredEndingState: `第${chapterNumber}章必须形成可承接的新局面`,
    cast: [{
      name: '林砚',
      objective: '取得第一笔合法收益',
      knowledgeBoundary: '只知道已经公开的账目信息',
      chapterRole: '主动核验规则并作出选择'
    }],
    conflict: {
      surface: '旧规则阻止主角取得合法结算',
      failureCost: '失去继续参赛资格'
    },
    plotBeats: [
      { order: 1, trigger: '结算被拒', action: '林砚核对规则', result: '发现账目矛盾' },
      { order: 2, trigger: '对手施压', action: '林砚公开证据', resistance: '旧势力封锁记录', result: '迫使对方回应' },
      { order: 3, trigger: '新证据出现', action: '林砚完成核验', turn: '收益到账但暴露新问题', result: '获得继续参赛资格' }
    ],
    ending: {
      result: '当前结算争议形成可验证结果',
      stateChanges: ['主角取得继续参赛资格'],
      hook: `留下具体钩子${chapterNumber}`,
      nextChapterInterface: '下一章继续核验异常账目'
    },
    mustImplement: ['规则结论必须由证据推动'],
    mustNotViolate: ['不得把未知幕后指使写成主角已知'],
    allowedCandidates: [],
    creativeFreedom: ['对白、动作、意象和局部调度由主笔创造']
  };
}

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
  });

  it('starts after selected chapter outlines and rejects a model artifact with shifted absolute chapter numbers', () => {
    context = createTestContext('wenmi-planning-absolute-range-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '绝对章位测试书',
      text: '验证滚动规划不会把第5至7章写进第4至6章'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const artifacts = new ArtifactService(context.database, ids, clock);
    for (const chapterNumber of [1, 2, 3]) {
      const version = artifacts.create(scope, 'chapter_outline', `第${chapterNumber}章章纲`, {
        chapterNumber,
        goal: `完成第${chapterNumber}章目标`,
        beats: [`推进第${chapterNumber}章`],
        hook: `第${chapterNumber}章钩子`
      });
      artifacts.select(scope, version.artifactId, version.artifactVersionId);
    }
    expect(nextChapterPlanningNumber(context.database, scope)).toBe(4);

    const agents = context.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id, r.role_key FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'lead_screenwriter')
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      agent_id: string;
      model_snapshot_id: string;
      role_key: string;
    }>;
    const editor = agents.find((item) => item.role_key === 'chief_editor')!;
    const writer = agents.find((item) => item.role_key === 'lead_screenwriter')!;
    const discussions = new DiscussionService(context.database, ids, clock);
    const discussion = discussions.create(scope, {
      type: 'quick',
      scopeText: '规划第4至6章',
      createdByAgentId: editor.agent_id,
      participants: [
        { agentId: editor.agent_id, reason: '主编汇总' },
        { agentId: writer.agent_id, reason: '编剧规划' }
      ]
    });
    const shiftedOutput = JSON.stringify({
      answer: '错误地从第5章开始。',
      keyPoints: [],
      alternatives: [],
      risks: [],
      questions: [],
      nextStep: '不得确认。',
      details: null,
      workflowArtifact: {
        type: 'chapter_outline',
        payload: {
          arcTitle: '错位短弧',
          arcGoal: '验证拒绝错位',
          endingState: '不应落库',
          estimatedChapterRange: { minimum: 3, recommended: 3, maximum: 3 },
          chapters: [5, 6, 7].map((chapterNumber) => ({
            chapterNumber,
            title: `第${chapterNumber}章 错位`,
            goal: `错误目标${chapterNumber}`,
            beats: [`错误推进${chapterNumber}`],
            hook: `错误钩子${chapterNumber}`
          }))
        }
      }
    });
    discussions.addOpinion(scope, discussion.discussionId, {
      agentId: editor.agent_id,
      modelSnapshotId: editor.model_snapshot_id,
      phase: 'independent',
      content: { recommendation: shiftedOutput },
      tokens: 200
    });
    discussions.setStage(scope, discussion.discussionId, 'collecting', 'synthesizing');
    const decisionId = discussions.synthesize(scope, discussion.discussionId, {
      recommendation: { summary: shiftedOutput },
      alternatives: [],
      disagreements: [],
      impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
    });
    discussions.confirm(scope, discussion.discussionId, decisionId);

    expect(() => new PlanningArtifactService(context!.database, ids, clock)
      .promoteConfirmedDecision(scope, discussion.discussionId, decisionId, 3))
      .toThrow('当前必须从第4章连续规划，但收到第5章');
    expect(nextChapterPlanningNumber(context.database, scope)).toBe(4);
  });

  it('keeps the whole-book master outline stage-based instead of introducing an independent volume layer', () => {
    const master = parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify(stageMasterPayload())}`);

    expect(master?.majorStages).toHaveLength(2);
    expect(master?.outlineSchema).toBe('stage_master_v2');
    expect(master?.majorStages[0]?.chapterRange).toEqual({ start: 1, end: 50 });
    expect(master?.majorStages[0]?.mainline.result).toContain('参赛身份');
    expect(master?.coreConflict).toContain('规则解释权');
    expect(JSON.stringify(master)).not.toContain('volumeNumber');
  });

  it('accepts planning artifacts embedded in the single structured reply object', () => {
    const master = parseMasterOutlineDepositOutput(JSON.stringify({
      answer: '建议采用四阶段推进。',
      keyPoints: [],
      alternatives: [],
      risks: [],
      questions: [],
      nextStep: '确认后滚动规划未来三章。',
      details: null,
      workflowArtifact: {
        type: 'master_outline',
        payload: stageMasterPayload()
      }
    }));
    expect(master?.majorStages).toHaveLength(2);
    expect(master?.premise).toContain('历史游戏世界');
  });

  it('accepts a planning artifact returned as the top-level workflow envelope', () => {
    const master = parseMasterOutlineDepositOutput(JSON.stringify({
      type: 'master_outline',
      payload: stageMasterPayload()
    }));

    expect(master?.outlineSchema).toBe('stage_master_v2');
    expect(master?.majorStages).toHaveLength(2);
    expect(master?.majorStages[0]?.chapterRange).toEqual({ start: 1, end: 50 });
  });

  it('accepts rolling chapter outlines embedded in workflowArtifact instead of falling back to repeated summaries', () => {
    const chapters = [
      { title: '穷途末路的入口', goal: '夏炎为支付舱位费接下第一项采集任务', beats: ['确认余额', '接受任务'], hook: '结算页出现完成度折扣' },
      { title: '第一笔血汗钱', goal: '夏炎完成采集并确认游戏收入真实到账', beats: ['体力透支', '银行卡到账'], hook: '连续登录会降低设备状态' },
      { title: '摔在同一个坑里', goal: '夏炎因忽略设备状态再次损失并开始记录规则', beats: ['收益下降', '建立规则表'], hook: '榜单上出现同类异常记录' }
    ];
    const output = JSON.stringify({
      answer: '前三章只完成生存闭环与规则意识建立。',
      keyPoints: [],
      alternatives: [],
      risks: [],
      questions: [],
      nextStep: '确认后逐章创作。',
      details: null,
      workflowArtifact: {
        type: 'chapter_outline',
        payload: {
          arcTitle: '活过第一天',
          arcGoal: '证明游戏收入可以缓解现实生存压力',
          endingState: '夏炎开始主动记录规则',
          estimatedChapterRange: { minimum: 3, recommended: 3, maximum: 3 },
          chapters
        }
      }
    });

    const parsed = parsePlanningDepositOutput(output);

    expect(parsed?.chapters).toEqual(chapters);
    expect(new Set(parsed?.chapters.map((chapter) => chapter.goal)).size).toBe(3);
  });

  it('stores the current master-outline contract instead of requiring the retired acts field', () => {
    context = createTestContext('wenmi-current-master-contract-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '自由竞技书',
      text: '失业青年靠公开竞技结算收入'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };

    expect(() => new ArtifactService(context!.database, ids, clock).create(
      scope,
      'master_outline',
      '剧情总纲',
      {
        ...stageMasterPayload()
      },
      'candidate'
    )).not.toThrow();
  });

  it('closes the staged planning gate after confirmed rolling outlines without requiring a legacy creative plan', () => {
    context = createTestContext('wenmi-staged-writing-readiness-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '分阶段写作门禁测试',
      text: '游戏竞技与历史经营融合的长篇小说'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const artifacts = new ArtifactService(context.database, ids, clock);
    const storyBible = artifacts.create(scope, 'story_bible', '设定大纲', {
      title: '分阶段写作门禁测试',
      positioning: {},
      worldRules: ['所有收益必须有可核验来源'],
      characters: [],
      mainPlot: {}
    }, 'candidate');
    artifacts.select(scope, storyBible.artifactId, storyBible.artifactVersionId);
    const master = artifacts.create(scope, 'master_outline', '剧情总纲', {
      ...stageMasterPayload()
    }, 'candidate');
    artifacts.select(scope, master.artifactId, master.artifactVersionId);
    let style = context.database.prepare(`
      SELECT style_version_id FROM book_style_versions
      WHERE owner_id = ? AND book_id = ? AND status = 'selected' LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { style_version_id: string } | undefined;
    if (style === undefined) {
      style = { style_version_id: ids.next() };
      context.database.prepare(`
        INSERT INTO book_style_versions (
          style_version_id, owner_id, book_id, version, content_json,
          source_kind, status, created_at
        ) VALUES (?, ?, ?, 1, '{}', 'owner', 'selected', ?)
      `).run(style.style_version_id, scope.ownerId, scope.bookId, clock.now().toISOString());
    }
    context.database.prepare(`
      UPDATE book_planning_states
      SET version = 20, stage = 'master_outline_ready', active_style_version_id = ?,
        setting_baseline_version_id = ?, master_outline_version_id = ?,
        volume_outline_version_id = NULL
      WHERE owner_id = ? AND book_id = ?
    `).run(
      style.style_version_id, storyBible.artifactVersionId, master.artifactVersionId,
      scope.ownerId, scope.bookId
    );
    const hasOpening = context.database.prepare(`
      SELECT 1 FROM book_opening_blueprints WHERE owner_id = ? AND book_id = ? AND status = 'active'
    `).get(scope.ownerId, scope.bookId);
    if (hasOpening === undefined) {
      context.database.prepare(`
        INSERT INTO book_opening_blueprints (
          opening_blueprint_id, owner_id, book_id, version, taxonomy_version, channel,
          category_key, category_name, blueprint_json, content_hash, status, created_at
        ) VALUES (?, ?, ?, 1, 'test-v1', 'male', 'game', '游戏体育', '{}', ?, 'active', ?)
      `).run(ids.next(), scope.ownerId, scope.bookId, '0'.repeat(64), clock.now().toISOString());
    }
    const agents = context.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id, r.role_key FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'lead_screenwriter')
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      agent_id: string; model_snapshot_id: string; role_key: string;
    }>;
    const editor = agents.find((item) => item.role_key === 'chief_editor')!;
    const writer = agents.find((item) => item.role_key === 'lead_screenwriter')!;
    const discussions = new DiscussionService(context.database, ids, clock);
    const discussion = discussions.create(scope, {
      type: 'quick',
      scopeText: '规划前三章',
      createdByAgentId: editor.agent_id,
      participants: [
        { agentId: editor.agent_id, reason: '主编汇总' },
        { agentId: writer.agent_id, reason: '编剧规划' }
      ]
    });
    const chapters = [1, 2, 3].map(chapterOutlineV2Plan);
    const output = JSON.stringify({
      answer: '形成前三章滚动计划',
      keyPoints: [],
      alternatives: [],
      risks: [],
      questions: [],
      nextStep: '确认后开始写作',
      details: null,
      workflowArtifact: {
        type: 'chapter_outline',
        payload: {
          outlineSchema: 'chapter_outline_v2',
          arcTitle: '首次结算',
          arcGoal: '取得第一笔合法收益',
          endingState: '主角获得继续参赛资格',
          estimatedChapterRange: { minimum: 3, recommended: 3, maximum: 3 },
          chapters
        }
      }
    });
    discussions.addOpinion(scope, discussion.discussionId, {
      agentId: editor.agent_id,
      modelSnapshotId: editor.model_snapshot_id,
      phase: 'independent',
      content: { recommendation: output },
      tokens: 200
    });
    discussions.setStage(scope, discussion.discussionId, 'collecting', 'synthesizing');
    const decisionId = discussions.synthesize(scope, discussion.discussionId, {
      recommendation: { summary: output },
      alternatives: [],
      disagreements: [],
      impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
    });
    discussions.confirm(scope, discussion.discussionId, decisionId);
    new TaskService(context.database, context.config.releaseId, clock).create(scope, {
      taskId: ids.next(),
      taskType: 'discussion',
      idempotencyKey: `locked-planning:${discussion.discussionId}`,
      initialPhase: 'planning',
      brief: {
        purpose: 'locked_planning',
        discussionId: discussion.discussionId,
        requestedChapterCount: 3
      }
    });

    const promoted = new PlanningArtifactService(context.database, ids, clock)
      .promoteIfPlanningTask(scope, discussion.discussionId, decisionId);

    expect(promoted?.chapterOutlineVersionIds).toHaveLength(3);
    expect(context.database.prepare(`
      SELECT stage FROM book_planning_states WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ stage: 'chapter_outline_ready' });
    expect(context.database.prepare(`
      SELECT status, narrative_person, viewpoint_distance FROM book_expression_profiles
      WHERE owner_id = ? AND book_id = ? ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId)).toMatchObject({
      status: 'confirmed',
      narrative_person: 'third',
      viewpoint_distance: 'close'
    });
    expect(new WritingReadinessService(context.database).inspect(scope, 1)).toMatchObject({
      ready: true,
      missing: []
    });
  });

  it('replaces a confirmed master outline after downstream chapter planning without creating a volume layer', () => {
    context = createTestContext('wenmi-master-outline-replacement-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '剧情总纲替换测试',
      text: '已经做过章纲，但老板要求重做剧情总纲'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    context.database.prepare(`
      INSERT INTO book_opening_blueprints (
        opening_blueprint_id, owner_id, book_id, version, taxonomy_version, channel,
        category_key, category_name, blueprint_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, 1, 'test-v1', 'male', 'game', '游戏体育', '{}', ?, 'active', ?)
    `).run(ids.next(), scope.ownerId, scope.bookId, '0'.repeat(64), clock.now().toISOString());
    const artifacts = new ArtifactService(context.database, ids, clock);
    const storyBible = artifacts.create(scope, 'story_bible', '设定大纲', {
      title: '剧情总纲替换测试',
      positioning: {},
      worldRules: ['公开任务必须可核验'],
      characters: [],
      mainPlot: {}
    }, 'candidate');
    artifacts.select(scope, storyBible.artifactId, storyBible.artifactVersionId);
    const oldMaster = artifacts.create(scope, 'master_outline', '剧情总纲', {
      premise: '旧版前提',
      coreConflict: '旧版冲突',
      protagonistArc: '旧版成长线',
      majorStages: [{ title: '旧阶段', goal: '旧目标', turningPoint: '旧转折' }],
      endingDirection: '旧版方向'
    }, 'candidate');
    artifacts.select(scope, oldMaster.artifactId, oldMaster.artifactVersionId);
    context.database.prepare(`
      UPDATE book_planning_states
      SET version = 20, stage = 'chapter_outline_ready',
        setting_baseline_version_id = ?, master_outline_version_id = ?,
        volume_outline_version_id = NULL
      WHERE owner_id = ? AND book_id = ?
    `).run(
      storyBible.artifactVersionId,
      oldMaster.artifactVersionId,
      scope.ownerId,
      scope.bookId
    );

    const agents = context.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id, r.role_key FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'lead_screenwriter')
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      agent_id: string; model_snapshot_id: string; role_key: string;
    }>;
    const editor = agents.find((item) => item.role_key === 'chief_editor')!;
    const writer = agents.find((item) => item.role_key === 'lead_screenwriter')!;
    const discussions = new DiscussionService(context.database, ids, clock);
    const discussion = discussions.create(scope, {
      type: 'quick',
      scopeText: '按老板新约束完整替换剧情总纲',
      createdByAgentId: editor.agent_id,
      participants: [
        { agentId: editor.agent_id, reason: '主编汇总' },
        { agentId: writer.agent_id, reason: '编剧规划' }
      ]
    });
    const replacement = stageMasterPayload();
    replacement.premise = '新版阶段式前提';
    const output = JSON.stringify({
      answer: '已形成新版阶段式剧情总纲',
      keyPoints: [],
      alternatives: [],
      risks: [],
      questions: [],
      nextStep: '确认后重新滚动规划未来三章',
      details: null,
      workflowArtifact: {
        type: 'master_outline',
        payload: replacement
      }
    });
    discussions.addOpinion(scope, discussion.discussionId, {
      agentId: editor.agent_id,
      modelSnapshotId: editor.model_snapshot_id,
      phase: 'independent',
      content: { recommendation: output },
      tokens: 200
    });
    discussions.setStage(scope, discussion.discussionId, 'collecting', 'synthesizing');
    const decisionId = discussions.synthesize(scope, discussion.discussionId, {
      recommendation: { summary: output },
      alternatives: [],
      disagreements: [],
      impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
    });
    discussions.confirm(scope, discussion.discussionId, decisionId);

    const promoted = new PlanningArtifactService(context.database, ids, clock)
      .promoteCurrentPlanningStage(scope, discussion.discussionId, decisionId);
    const state = context.database.prepare(`
      SELECT stage, master_outline_version_id, volume_outline_version_id
      FROM book_planning_states WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as {
      stage: string; master_outline_version_id: string; volume_outline_version_id: string | null;
    };
    const active = context.database.prepare(`
      SELECT v.content_json FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'master_outline'
    `).get(scope.ownerId, scope.bookId) as { content_json: string };

    expect(promoted).toMatchObject({
      artifactType: 'master_outline',
      artifactVersionId: state.master_outline_version_id,
      stage: 'master_outline_ready'
    });
    expect(state.master_outline_version_id).not.toBe(oldMaster.artifactVersionId);
    expect(state.volume_outline_version_id).toBeNull();
    expect(JSON.parse(active.content_json)).toMatchObject({
      outlineSchema: 'stage_master_v2',
      premise: '新版阶段式前提'
    });
  });

  it('compacts long setting prose while retaining every setting key and owner boundary', () => {
    const compacted = compactPlanningArtifactForDiscussion('setting', JSON.stringify({
      title: 'Long setting',
      positioning: { genre: { value: 'game' } },
      tags: [{ name: 'competition', category: 'dynamic' }],
      characters: [{ name: 'Xia Yan', role: 'male_lead' }],
      openingReference: { mustFollow: ['no multi-romance'] },
      settingOutline: {
        items: [
          { itemKey: 'economy', groupTitle: 'rules', label: 'economy', content: 'rule '.repeat(2_000) },
          { itemKey: 'competition', groupTitle: 'rules', label: 'competition', content: 'fair play' }
        ]
      }
    }));

    expect(compacted).toContain('"itemKey":"economy"');
    expect(compacted).toContain('"itemKey":"competition"');
    expect(compacted).toContain('no multi-romance');
    expect(compacted).toContain('competition');
    expect(compacted.length).toBeLessThan(3_000);
  });

  it('rejects generic summaries and repeated stage goals instead of silently creating fake outlines', () => {
    expect(parseMasterOutlineDepositOutput('主编建议继续讨论。')).toBeNull();
    const missingResult = stageMasterPayload();
    const stages = missingResult.majorStages as Array<Record<string, unknown>>;
    stages[0] = { ...stages[0], mainline: { encounter: '遇到问题', resolution: '解决问题' } };
    expect(() => parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify(missingResult)}`))
      .toThrow('主线遭遇、解决方式或阶段结果');

    const gapped = stageMasterPayload();
    const gappedStages = gapped.majorStages as Array<Record<string, unknown>>;
    gappedStages[1] = { ...gappedStages[1], chapterRange: { start: 52, end: 100 } };
    expect(() => parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify(gapped)}`))
      .toThrow('必须紧接上一阶段');
  });

  it('accepts one complete current stage and rejects a stage longer than fifty chapters', () => {
    const singleStage = stageMasterPayload();
    singleStage.majorStages = (singleStage.majorStages as Array<Record<string, unknown>>).slice(0, 1);

    const parsed = parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify(singleStage)}`);
    expect(parsed?.majorStages).toHaveLength(1);
    expect(parsed?.majorStages[0]?.chapterRange).toEqual({ start: 1, end: 50 });

    const oversized = stageMasterPayload();
    const oversizedStages = (oversized.majorStages as Array<Record<string, unknown>>).slice(0, 1);
    oversizedStages[0] = { ...oversizedStages[0], chapterRange: { start: 1, end: 51 } };
    oversized.majorStages = oversizedStages;

    expect(() => parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify(oversized)}`))
      .toThrow('不能超过50章');
  });

  it('preserves the detailed first-stage writing contract for continuation books', () => {
    const detailed = stageMasterPayload();
    const stage = (detailed.majorStages as Array<Record<string, unknown>>)[0];
    detailed.majorStages = [{
      ...stage,
      detailSchema: 'stage_detail_v1',
      cast: [
        { name: '王怡', stageRole: '主动调查者', objective: '确认实验笔记的真实来源', stateChange: '从被动怀疑转为主动取证' },
        { name: '夏炎', stageRole: '被调查者与共同解谜者', objective: '证明自己并非操控者' }
      ],
      chapterBlocks: [
        { start: 1, end: 10, summary: '建立人物关系、笔记疑点和现实压力。', estimatedWords: 30000 },
        { start: 11, end: 25, summary: '两人各自调查并因证据冲突分裂。', estimatedWords: 45000 },
        { start: 26, end: 40, summary: '共同验证关键证据并识别幕后误导。', estimatedWords: 45000 },
        { start: 41, end: 50, summary: '完成阶段对抗并留下下一阶段入口。', estimatedWords: 30000 }
      ],
      estimatedWords: 150000,
      experience: {
        emotionalArc: ['不安', '怀疑', '决裂', '并肩', '释然'],
        payoffPoints: ['证据反转', '人物主动选择'],
        pressurePoints: ['信任破裂', '现实代价']
      },
      turningPoints: ['笔记内容被证明并非伪造', '两人发现共同误判'],
      foreshadowing: [
        { summary: '笔记缺失的最后一页', action: 'plant', releaseWindow: '第41—50章' }
      ]
    }];

    const parsed = parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify(detailed)}`);
    const parsedStage = parsed?.majorStages[0];
    expect(parsedStage).toMatchObject({
      detailSchema: 'stage_detail_v1',
      estimatedWords: 150000,
      experience: { emotionalArc: ['不安', '怀疑', '决裂', '并肩', '释然'] },
      foreshadowing: [{ action: 'plant', releaseWindow: '第41—50章' }]
    });
    expect(parsedStage?.cast).toHaveLength(2);
    expect(parsedStage?.cast?.[0]).toMatchObject({ name: '王怡', stageRole: '主动调查者' });
    expect(parsedStage?.chapterBlocks).toHaveLength(4);
    expect(parsedStage?.chapterBlocks?.[0]).toMatchObject({ start: 1, end: 10, estimatedWords: 30000 });
    expect(parsedStage?.chapterBlocks?.[1]).toMatchObject({ start: 11, end: 25, estimatedWords: 45000 });

    const invalid = structuredClone(detailed);
    const invalidStage = (invalid.majorStages as Array<Record<string, unknown>>)[0]!;
    const blocks = invalidStage.chapterBlocks as Array<Record<string, unknown>>;
    blocks[1] = { ...blocks[1], start: 12 };
    expect(() => parseMasterOutlineDepositOutput(`剧情总纲落库 ${JSON.stringify(invalid)}`))
      .toThrow('章节内容安排必须连续');
  });
});
