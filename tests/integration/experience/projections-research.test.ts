import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { NarrativeProjectionService } from '../../../apps/api/src/application/projections/narrative-projection-service.js';
import { ResearchService } from '../../../apps/api/src/application/research/research-service.js';
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('叙事投影与研究候选边界', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('情绪、主线、支线、钩子和信息差均分计划轨与实际轨并可重建', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '投影测试书', text: '测试五类叙事投影' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
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
        summary: '开篇压力持续升高，章末留下明确追读悬念。',
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
      LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { artifact_version_id: string; content_json: string };
    const outline = JSON.parse(outlineRow.content_json) as Record<string, unknown>;
    context.database.prepare(`UPDATE artifact_versions SET content_json = ? WHERE artifact_version_id = ?`)
      .run(JSON.stringify({
        ...outline,
        emotionalArc: ['压抑', '警觉', '获得微弱希望'],
        subplots: ['同行者是否值得信任'],
        informationGaps: ['陌生脚步的主人是谁']
      }), outlineRow.artifact_version_id);
    const projections = new NarrativeProjectionService(context.database, ids, clock);
    expect(projections.rebuild(scope)).toBe(10);
    const firstSnapshot = context.database.prepare(`
      SELECT projection_type, track, chapter_number, canon_revision, content_json
      FROM narrative_projections WHERE owner_id = ? AND book_id = ? ORDER BY projection_type, track
    `).all(scope.ownerId, scope.bookId);
    expect(firstSnapshot).toHaveLength(10);
    expect(new Set((firstSnapshot as Array<{ projection_type: string }>).map((row) => row.projection_type))).toEqual(new Set(['emotion', 'mainline', 'subplot', 'hook', 'information_gap']));
    expect(new Set((firstSnapshot as Array<{ track: string }>).map((row) => row.track))).toEqual(new Set(['planned', 'actual']));
    const contents = (firstSnapshot as Array<{ projection_type: string; track: string; content_json: string }>).map((row) => ({
      ...row,
      content: JSON.parse(row.content_json) as Record<string, unknown>
    }));
    expect(contents.every((row) => row.content.status !== 'not_extracted')).toBe(true);
    expect(contents.find((row) => row.projection_type === 'emotion' && row.track === 'planned')?.content)
      .toEqual(expect.objectContaining({ emotionalArc: ['压抑', '警觉', '获得微弱希望'] }));
    expect(contents.find((row) => row.projection_type === 'emotion' && row.track === 'actual')?.content)
      .toEqual(expect.objectContaining({ summary: '开篇压力持续升高，章末留下明确追读悬念。' }));
    expect(contents.find((row) => row.projection_type === 'subplot' && row.track === 'actual')?.content)
      .toEqual(expect.objectContaining({ developments: expect.arrayContaining([expect.objectContaining({ subject: '同行者' })]) }));
    expect(contents.find((row) => row.projection_type === 'information_gap' && row.track === 'actual')?.content)
      .toEqual(expect.objectContaining({ openQuestions: expect.arrayContaining(['陌生脚步的主人尚未揭晓']) }));
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
