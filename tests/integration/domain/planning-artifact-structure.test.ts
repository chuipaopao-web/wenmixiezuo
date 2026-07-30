import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import {
  mergeArcItems,
  mergeNumberedItems,
  nextChapterPlanningNumber,
  parseMasterOutlineDepositOutput,
  parsePlanningDepositOutput,
  parseVolumeOutlineDepositOutput,
  PlanningArtifactService
} from '../../../apps/api/src/application/artifacts/planning-artifact-service.js';
import { compactPlanningArtifactForDiscussion } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { WritingReadinessService } from '../../../apps/api/src/application/creation/writing-readiness-service.js';
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

  it('accepts planning artifacts embedded in the single structured reply object', () => {
    const master = parseMasterOutlineDepositOutput(JSON.stringify({
      answer: '建议采用四阶段推进。',
      keyPoints: [],
      alternatives: [],
      risks: [],
      questions: [],
      nextStep: '确认后讨论第一卷。',
      details: null,
      workflowArtifact: {
        type: 'master_outline',
        payload: {
          premise: '失业青年进入竞技表现可结算收入的游戏。',
          coreConflict: '个人生存与资本垄断游戏定价权的冲突。',
          protagonistArc: '从为钱参赛成长为维护竞技自由定价的人。',
          majorStages: [
            { title: '活下去', goal: '证明竞技可以带来真实收入', turningPoint: '拒绝第一份控制性合同' },
            { title: '建队伍', goal: '建立不受财阀控制的队伍', turningPoint: '公开数据所有权问题' }
          ],
          endingDirection: '在冠军赛兑现竞技自由与数据权利。',
          storyPromises: ['竞技成长', '经营兑现'],
          openQuestions: []
        }
      }
    }));
    expect(master?.majorStages).toHaveLength(2);
    expect(master?.premise).toContain('竞技表现');
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
        premise: '失业青年进入竞技表现可结算收入的游戏。',
        coreConflict: '自由选手与垄断合同争夺退出权。',
        protagonistArc: '从求生选手成长为公开规则的维护者。',
        majorStages: [
          { title: '求生', goal: '靠竞技取得收入', turningPoint: '拒绝控制性合同' },
          { title: '重构', goal: '推动数据权与退出权公开化', turningPoint: '放弃成为新垄断者' }
        ],
        endingDirection: '成为顶尖选手并建立开放的独立俱乐部。',
        storyPromises: ['即时收入兑现', '竞技与经营并重'],
        openQuestions: []
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
      premise: '主角在历史竞技世界中用公开规则重建秩序',
      coreConflict: '个人生存与平台垄断规则冲突',
      protagonistArc: '从求生者成长为规则维护者',
      majorStages: [{ title: '求生', goal: '取得第一份合法收益', turningPoint: '拒绝垄断合同' }],
      endingDirection: '建立公开透明的竞技秩序'
    }, 'candidate');
    artifacts.select(scope, master.artifactId, master.artifactVersionId);
    const volume = artifacts.create(scope, 'volume_outline', '第一卷卷纲', {
      volumeNumber: 1,
      goal: '完成第一轮生存与规则验证',
      arcs: [{ title: '首次结算', objective: '证明游戏收益可以到账', turningPoints: ['第一次结算'], payoff: '保住住处' }],
      endingState: '主角取得继续参赛资格'
    }, 'candidate');
    artifacts.select(scope, volume.artifactId, volume.artifactVersionId);
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
      SET version = 20, stage = 'volume_outline_ready', active_style_version_id = ?,
        setting_baseline_version_id = ?, master_outline_version_id = ?,
        volume_outline_version_id = ?
      WHERE owner_id = ? AND book_id = ?
    `).run(
      style.style_version_id, storyBible.artifactVersionId, master.artifactVersionId,
      volume.artifactVersionId, scope.ownerId, scope.bookId
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
    const chapters = [1, 2, 3].map((chapterNumber) => ({
      chapterNumber,
      title: `第${chapterNumber}章`,
      goal: `完成互不重复的章节目标${chapterNumber}`,
      beats: [`推进节点${chapterNumber}A`, `推进节点${chapterNumber}B`],
      hook: `留下具体钩子${chapterNumber}`
    }));
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
