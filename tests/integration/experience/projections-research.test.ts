import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { NarrativeProjectionService } from '../../../apps/api/src/application/projections/narrative-projection-service.js';
import { ResearchService } from '../../../apps/api/src/application/research/research-service.js';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { LongformContinuityRepository } from '../../../apps/api/src/infrastructure/db/repositories/longform-continuity-repository.js';
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('叙事投影与研究候选边界', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('把阶段式剧情总纲投影为每阶段一条简洁主线', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '阶段总纲投影书',
      text: '游戏竞技与历史经营'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const artifacts = new ArtifactService(context.database, ids, clock);
    const master = artifacts.create(scope, 'master_outline', '剧情总纲', {
      outlineSchema: 'stage_master_v2',
      premise: '夏炎进入历史游戏世界争夺公开竞赛规则。',
      coreConflict: '个人求生与平台垄断规则冲突。',
      protagonistArc: '从独行选手成长为规则维护者。',
      majorStages: [{
        stageNumber: 1,
        title: '夺回身份',
        chapterRange: { start: 1, end: 50 },
        mainline: {
          encounter: '夏炎被抄袭者夺走参赛身份。',
          resolution: '夏炎用冠军记录和队友证词建立证据链。',
          result: '夏炎夺回身份并建立独立队伍。'
        },
        structure: {
          setup: '匿名参赛',
          development: '连续夺冠',
          turn: '现实奖励到账',
          conclusion: '拒绝垄断合同'
        },
        stageSummary: '夏炎拥有队伍、证据和继续调查平台的资格。',
        pendingThreads: ['历史入口由谁控制'],
        followUpDirection: '追查平台控制历史入口的方式。'
      }, {
        stageNumber: 2,
        title: '公开规则',
        chapterRange: { start: 51, end: 100 },
        mainline: {
          encounter: '平台利用历史入口制造不公平赛事。',
          resolution: '夏炎联合不同赛区公开规则证据。',
          result: '赛事规则改为公开审计。'
        },
        structure: {
          setup: '独立队伍进入联赛',
          development: '追查异常判罚',
          turn: '内部证人出现',
          conclusion: '公开审计机制落地'
        },
        stageSummary: '夏炎从参赛者成长为能推动规则改变的组织者。',
        pendingThreads: [],
        followUpDirection: '验证新规则能否在更大范围持续运转。'
      }],
      endingDirection: '公开规则来源。',
      storyPromises: ['胜利必须付出代价'],
      openQuestions: []
    }, 'candidate');
    artifacts.select(scope, master.artifactId, master.artifactVersionId);

    const projections = new NarrativeProjectionService(context.database, ids, clock);
    expect(projections.rebuild(scope)).toBe(2);
    const row = context.database.prepare(`
      SELECT content_json FROM narrative_projections
      WHERE owner_id = ? AND book_id = ? AND projection_type = 'mainline'
      ORDER BY chapter_number
      LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { content_json: string };
    expect(JSON.parse(row.content_json)).toEqual(expect.objectContaining({
      scopeLabel: '夺回身份',
      summary: expect.stringContaining('夺回身份'),
      chapterStart: 1,
      chapterEnd: 50,
      result: '夏炎拥有队伍、证据和继续调查平台的资格。'
    }));
  });

  it('只按真实来源和正确粒度生成简洁叙事图谱并可重建', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '投影测试书', text: '测试五类叙事投影' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 2);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1);
    await batches.run(scope, batch.batchId);
    approvePendingManuscript(context, scope, ids, clock);
    const chapter = context.database.prepare(`
      SELECT chapter_id FROM chapters WHERE owner_id = ? AND book_id = ? AND chapter_number = 1
    `).get(scope.ownerId, scope.bookId) as { chapter_id: string };
    context.database.prepare(`
      UPDATE chapter_quality_metrics SET scores_json = ? WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
    `).run(JSON.stringify({
      experience: {
        summary: '本章情绪曲线呈「惊讶-失落-愤怒-平静」，整体兑现为爽。',
        emotionFlow: ['惊讶', '失落', '愤怒', '平静'],
        baseline: '爽',
        scores: { emotionalFulfillment: 86, hookStrength: 91, overallExperience: 88 },
        issues: [{ issueType: '信息差留白', severity: 'minor', evidence: '陌生脚步的主人尚未揭晓' }]
      },
      fact: {
        summary: '主角完成取水，同行者的立场开始变化。',
        factCandidates: [
          { subjectName: '同行者', entityType: 'character', relationKey: 'attitude', value: '从戒备转为观望' },
          { subjectName: '营地', entityType: 'location', relationKey: 'resource', value: '获得少量饮水' }
        ]
      },
      literary: { summary: '语言简洁，动作推进清楚。', issues: [] }
    }), scope.ownerId, scope.bookId, chapter.chapter_id);
    const outlineRow = context.database.prepare(`
      SELECT v.artifact_version_id, v.content_json
      FROM artifact_versions v JOIN artifacts a ON a.artifact_id = v.artifact_id
      WHERE v.owner_id = ? AND v.book_id = ? AND a.artifact_type = 'chapter_outline' AND v.status = 'selected'
      ORDER BY CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER) LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { artifact_version_id: string; content_json: string };
    const outline = JSON.parse(outlineRow.content_json) as Record<string, unknown>;
    context.database.prepare(`UPDATE artifact_versions SET content_json = ? WHERE artifact_version_id = ?`)
      .run(JSON.stringify({
        ...outline,
        emotionalArc: ['压抑', '警觉', '获得微弱希望'],
        baseline: '虐转爽',
        subplots: ['同行者暗中寻找失散家人'],
        informationGaps: [{
          summary: '周老六知道追兵来自北营，夏炎尚不知情。',
          knowers: ['周老六'],
          unaware: ['夏炎'],
          readerState: '读者已知'
        }]
      }), outlineRow.artifact_version_id);
    const masterRow = context.database.prepare(`
      SELECT v.artifact_version_id, v.content_json
      FROM artifact_versions v JOIN artifacts a ON a.artifact_id = v.artifact_id
      WHERE v.owner_id = ? AND v.book_id = ? AND a.artifact_type = 'master_outline' AND v.status = 'selected'
      LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { artifact_version_id: string; content_json: string };
    context.database.prepare(`UPDATE artifact_versions SET content_json = ? WHERE artifact_version_id = ?`)
      .run(JSON.stringify({
        outlineSchema: 'stage_master_v2',
        premise: '夏炎必须在荒原追兵逼近前建立可持续的生存秩序。',
        coreConflict: '生存资源、北营追捕与队伍互信之间的冲突。',
        protagonistArc: '夏炎从独行求生者成长为能够分配任务的组织者。',
        majorStages: [{
          stageNumber: 1,
          title: '临时营地',
          chapterRange: { start: 1, end: 50 },
          mainline: {
            encounter: '夏炎与同伴缺水且遭北营追兵逼近。',
            resolution: '夏炎整合情报、分配任务并建立临时营地。',
            result: '众人取得第一批补给并暂时站稳脚跟。'
          },
          structure: {
            setup: '荒原缺水',
            development: '寻找水源',
            turn: '发现北营追兵',
            conclusion: '建立临时营地'
          },
          stageSummary: '夏炎带领同伴建成临时营地并取得第一批补给。',
          pendingThreads: ['北营为何追捕周老六'],
          followUpDirection: '追查北营并巩固营地。'
        }],
        endingDirection: '建立可持续的生存秩序。',
        storyPromises: ['北营追捕的真相最终会揭开'],
        openQuestions: []
      }), masterRow.artifact_version_id);
    const continuity = new LongformContinuityRepository(context.database);
    continuity.insertCommitment(scope, {
      id: ids.next(), type: 'foreshadowing', title: '北营旧徽记',
      description: '周老六认出了追兵身上的北营旧徽记。',
      entityIds: [], openedChapter: 1, sourceType: 'chapter', sourceId: chapter.chapter_id,
      sourceHash: 'a'.repeat(64), sourceLocator: { chapterNumber: 1 }, authorityGrade: 'A',
      now: clock.now().toISOString()
    });
    const commitment = context.database.prepare(`
      SELECT narrative_commitment_id FROM narrative_commitments WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { narrative_commitment_id: string };
    continuity.updateCommitmentStatus(scope, commitment.narrative_commitment_id, 'fulfilled', chapter.chapter_id, clock.now().toISOString());
    const canon = context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number };
    const settlementId = ids.next();
    continuity.insertSettlement(scope, {
      id: settlementId, stageType: 'story_arc', stageKey: 'temporary-camp', version: 1,
      chapterStart: 1, chapterEnd: 1, canonRevision: canon.canon_revision, status: 'building',
      payload: {
        irreversibleResults: ['夏炎带领同伴建成临时营地并取得第一批补给。'],
        entityStates: [], closedThreads: [],
        openThreads: [{ kind: 'subplot', summary: '同行者继续寻找失散家人。' }],
        relationshipChanges: [],
        knowledgeChanges: [{
          summary: '北营正在追捕周老六。',
          knowers: ['周老六'], unaware: ['夏炎'], readerState: '读者已知'
        }],
        resourceChanges: [], ruleChanges: [], exclusions: []
      },
      now: clock.now().toISOString()
    });
    continuity.activateSettlement(scope, settlementId, 'story_arc', 'temporary-camp', clock.now().toISOString());
    const projections = new NarrativeProjectionService(context.database, ids, clock);
    expect(projections.rebuild(scope)).toBe(11);
    const firstSnapshot = context.database.prepare(`
      SELECT projection_type, track, chapter_number, canon_revision, content_json
      FROM narrative_projections WHERE owner_id = ? AND book_id = ? ORDER BY projection_type, track
    `).all(scope.ownerId, scope.bookId);
    expect(firstSnapshot).toHaveLength(11);
    expect(new Set((firstSnapshot as Array<{ projection_type: string }>).map((row) => row.projection_type))).toEqual(new Set(['emotion', 'mainline', 'subplot', 'hook', 'information_gap']));
    const contents = (firstSnapshot as Array<{ projection_type: string; track: string; content_json: string }>).map((row) => ({
      ...row,
      content: JSON.parse(row.content_json) as Record<string, unknown>
    }));
    expect(contents.every((row) => !String(row.content.status ?? '').includes('待补充'))).toBe(true);
    expect(contents.filter((row) => row.projection_type === 'mainline' && row.track === 'planned')).toHaveLength(1);
    expect(contents.find((row) => row.projection_type === 'mainline' && row.track === 'planned')?.content)
      .toEqual(expect.objectContaining({
        scopeLabel: '临时营地',
        summary: expect.stringContaining('建立临时营地')
      }));
    expect(contents.find((row) => row.projection_type === 'emotion' && row.track === 'planned')?.content)
      .toEqual(expect.objectContaining({ emotionFlow: ['压抑', '警觉', '获得微弱希望'], baseline: '虐转爽' }));
    expect(contents.find((row) => row.projection_type === 'emotion' && row.track === 'actual')?.content)
      .toEqual(expect.objectContaining({ emotionFlow: ['惊讶', '失落', '愤怒', '平静'], baseline: '爽' }));
    expect(contents.find((row) => row.projection_type === 'subplot' && row.track === 'actual')?.content)
      .toEqual(expect.objectContaining({ summary: '同行者继续寻找失散家人。' }));
    expect(contents.find((row) => row.projection_type === 'information_gap' && row.track === 'actual')?.content)
      .toEqual(expect.objectContaining({
        items: [expect.objectContaining({ knowers: ['周老六'], unaware: ['夏炎'], readerState: '读者已知' })]
      }));
    expect(contents.find((row) => row.projection_type === 'hook' && row.track === 'actual')?.content)
      .toEqual(expect.objectContaining({
        items: [expect.objectContaining({ kind: '伏笔', status: '已回收', summary: '周老六认出了追兵身上的北营旧徽记。' })]
      }));
    expect(contents.filter((row) => row.projection_type === 'emotion')).toHaveLength(2);
    expect(contents.filter((row) => row.projection_type === 'subplot' && row.track === 'actual')).toHaveLength(1);
    expect(JSON.stringify(contents)).not.toContain('陌生脚步的主人尚未揭晓');
    expect(JSON.stringify(contents)).not.toContain('endingExcerpt');
    expect(JSON.stringify(contents)).not.toContain('modelSnapshotId');
    expect(JSON.stringify(contents)).not.toContain('reviewerRole');
    context.database.prepare(`DELETE FROM narrative_projections WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    projections.rebuild(scope);
    expect(context.database.prepare(`
      SELECT projection_type, track, chapter_number, canon_revision, content_json
      FROM narrative_projections WHERE owner_id = ? AND book_id = ? ORDER BY projection_type, track
    `).all(scope.ownerId, scope.bookId)).toEqual(firstSnapshot);
  });

  it('离线研究诚实返回不可用，来源主张只进入候选而不修改正史', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '研究甲书', text: '研究候选边界' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '研究乙书', text: '隔离研究来源' });
    const firstScope = { ownerId: context.config.ownerId, bookId: first.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: second.bookId };
    const research = new ResearchService(context.database, ids, clock);
    expect(research.offlineStatus('本周热门题材')).toEqual(expect.objectContaining({ status: 'offline_unavailable', claimsApplied: false }));
    const sourceId = research.addProvidedSource(firstScope, {
      title: '老板提供的历史资料', content: '某地旧制在特定年代发生变化', language: 'zh-CN', credibility: 80, region: 'CN'
    });
    research.addCandidateClaim(firstScope, sourceId, '旧制可能影响人物行动', '老板提供资料中的年代说明');
    expect(context.database.prepare(`SELECT candidate_status FROM research_claims WHERE owner_id = ? AND book_id = ?`).all(firstScope.ownerId, firstScope.bookId)).toEqual([{ candidate_status: 'candidate' }]);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM research_claims WHERE owner_id = ? AND book_id = ?`).get(secondScope.ownerId, secondScope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(firstScope.ownerId, firstScope.bookId)).toEqual({ canon_revision: 0 });
  });
});
