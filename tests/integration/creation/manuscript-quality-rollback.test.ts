import { afterEach, describe, expect, it } from 'vitest';
import type { ProductionReview, ReviewerRole } from '../../../apps/api/src/contracts/production-review.js';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { hasHardProblem, ManuscriptQualitySnapshotService } from '../../../apps/api/src/application/creation/manuscript-quality-snapshot-service.js';
import { shouldRestorePreviousBest } from '../../../apps/api/src/application/creation/chapter-pipeline-service.js';
import { initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('稿件纵向质量退化保护', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('多项主观维度明显下降且无硬改善时恢复上一最佳稿', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '质量回退测试书',
      text: '主角沿着旧盟约追查失踪的城门守卫'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const batch = batches.scheduleNewChapters(scope, 1);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');

    const chapterId = batch.chapterIds[0]!;
    const pipeline = context.database.prepare(`
      SELECT pipeline_run_id, current_manuscript_version_id
      FROM chapter_pipeline_runs
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
    `).get(scope.ownerId, scope.bookId, chapterId) as {
      pipeline_run_id: string;
      current_manuscript_version_id: string;
    };
    const previousBest = context.database.prepare(`
      SELECT manuscript_quality_snapshot_id, manuscript_version_id, dimensions_json
      FROM manuscript_quality_snapshots
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND is_best = 1
    `).get(scope.ownerId, scope.bookId, chapterId) as {
      manuscript_quality_snapshot_id: string;
      manuscript_version_id: string;
      dimensions_json: string;
    };
    expect(previousBest.manuscript_version_id).toBe(pipeline.current_manuscript_version_id);

    const degradedVersionId = ids.next();
    context.database.prepare(`
      INSERT INTO manuscript_versions (
        manuscript_version_id, owner_id, book_id, chapter_id, parent_version_id,
        author_agent_id, model_provider, model_id, source_task_id, file_id,
        content_hash, word_count, status, created_at, confirmed_at, creator_kind, edit_note
      )
      SELECT ?, owner_id, book_id, chapter_id, manuscript_version_id,
        author_agent_id, model_provider, model_id, source_task_id, file_id,
        ?, word_count, 'candidate', ?, NULL, creator_kind, '质量回退测试'
      FROM manuscript_versions
      WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ?
    `).run(
      degradedVersionId,
      'd'.repeat(64),
      clock.now().toISOString(),
      previousBest.manuscript_version_id,
      scope.ownerId,
      scope.bookId
    );
    context.database.prepare(`
      UPDATE chapters SET current_manuscript_version_id = ?
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
    `).run(degradedVersionId, chapterId, scope.ownerId, scope.bookId);
    context.database.prepare(`
      UPDATE chapter_pipeline_runs SET current_manuscript_version_id = ?
      WHERE pipeline_run_id = ? AND owner_id = ? AND book_id = ?
    `).run(degradedVersionId, pipeline.pipeline_run_id, scope.ownerId, scope.bookId);

    const sourcePanel = context.database.prepare(`
      SELECT * FROM review_panels
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
      ORDER BY created_at DESC, review_panel_id DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapterId) as Record<string, string | number>;
    const degradedPanelId = ids.next();
    context.database.prepare(`
      INSERT INTO review_panels (
        review_panel_id, owner_id, book_id, manuscript_version_id, writer_model_snapshot_id,
        fact_agent_id, fact_model_snapshot_id, literary_agent_id, literary_model_snapshot_id,
        experience_agent_id, experience_model_snapshot_id, selection_reason_json, status, created_at,
        chapter_id, review_round, manuscript_hash, writer_epoch, binding_revision_id,
        writing_order_id, canon_revision, token_budget
      )
      SELECT :panelId, owner_id, book_id, :versionId, writer_model_snapshot_id,
        fact_agent_id, fact_model_snapshot_id, literary_agent_id, literary_model_snapshot_id,
        experience_agent_id, experience_model_snapshot_id, selection_reason_json, 'complete', :createdAt,
        chapter_id, 3, :manuscriptHash, writer_epoch, binding_revision_id,
        writing_order_id, canon_revision, token_budget
      FROM review_panels WHERE review_panel_id = :sourcePanelId
    `).run({
      panelId: degradedPanelId,
      versionId: degradedVersionId,
      createdAt: clock.now().toISOString(),
      manuscriptHash: 'd'.repeat(64),
      sourcePanelId: String(sourcePanel.review_panel_id)
    });

    const baseline = JSON.parse(previousBest.dimensions_json) as Record<string, number>;
    const reports = (['fact', 'literary', 'experience'] as const).map((role) =>
      degradedReport(role, degradedVersionId, baseline)
    );
    const snapshots = new ManuscriptQualitySnapshotService(context.database, ids, clock);
    const decision = snapshots.record(scope, {
      chapterId,
      manuscriptVersionId: degradedVersionId,
      reviewPanelId: degradedPanelId,
      reports
    });
    expect(decision).toMatchObject({
      previousBestVersionId: previousBest.manuscript_version_id,
      bestVersionId: previousBest.manuscript_version_id,
      hardBlocked: false,
      hardImproved: false,
      subjectiveRegression: true,
      retainPreviousBest: true
    });
    expect(decision.regressedDimensions.length).toBeGreaterThanOrEqual(2);

    const revisionOrderId = ids.next();
    context.database.prepare(`
      INSERT INTO revision_orders (
        revision_order_id, owner_id, book_id, review_panel_id, manuscript_version_id,
        revision_round, hard_actions_json, soft_actions_json, disagreements_json,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, '[]', '[]', '[]', 'active', ?)
    `).run(
      revisionOrderId, scope.ownerId, scope.bookId, degradedPanelId,
      degradedVersionId, clock.now().toISOString()
    );
    snapshots.restoreBest(scope, {
      chapterId,
      rejectedVersionId: degradedVersionId,
      bestVersionId: previousBest.manuscript_version_id,
      pipelineRunId: pipeline.pipeline_run_id
    });
    expect(context.database.prepare(`
      SELECT current_manuscript_version_id FROM chapters
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
    `).get(chapterId, scope.ownerId, scope.bookId)).toEqual({
      current_manuscript_version_id: previousBest.manuscript_version_id
    });
    expect(context.database.prepare(`
      SELECT status FROM manuscript_versions
      WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ?
    `).get(degradedVersionId, scope.ownerId, scope.bookId)).toEqual({ status: 'rejected' });
    expect(context.database.prepare(`
      SELECT status FROM revision_orders
      WHERE revision_order_id = ? AND owner_id = ? AND book_id = ?
    `).get(revisionOrderId, scope.ownerId, scope.bookId)).toEqual({ status: 'cancelled' });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM manuscript_quality_snapshots
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND is_best = 1
    `).get(scope.ownerId, scope.bookId, chapterId)).toEqual({ count: 1 });
  });
});

describe('三审等级映射', () => {
  it('事实席major进入有界重写但不冒充blocker，明确blocker仍然停止', () => {
    const versionId = 'version-under-review';
    const reports = (['fact', 'literary', 'experience'] as const).map((role) =>
      degradedReport(role, versionId, {})
    );
    const fact = reports.find((report) => report.reviewerRole === 'fact')!;
    fact.verdict = 'rewrite';
    fact.issues = [{
      location: '灵石数量段',
      issueType: '数量矛盾',
      severity: 'major',
      evidence: '同一批灵石出现两个互斥数量',
      requiredAction: '核对并统一数量'
    }];
    expect(hasHardProblem(reports)).toBe(false);

    fact.verdict = 'blocked';
    fact.issues[0] = { ...fact.issues[0]!, severity: 'blocker' };
    expect(hasHardProblem(reports)).toBe(true);
  });
});
describe('作者定稿版本选择', () => {
  it('不会因为主观评分回落而静默换回旧稿', () => {
    expect(shouldRestorePreviousBest('review_existing', true)).toBe(false);
    expect(shouldRestorePreviousBest('rewrite_existing', true)).toBe(true);
    expect(shouldRestorePreviousBest(undefined, true)).toBe(true);
    expect(shouldRestorePreviousBest('review_existing', false)).toBe(false);
  });
});

function degradedReport(
  role: ReviewerRole,
  manuscriptVersionId: string,
  baseline: Record<string, number>
): ProductionReview {
  const scores = Object.fromEntries(
    Object.entries(baseline)
      .filter(([key]) => key.startsWith(`${role}:`) && key !== 'literary:ai_style_naturalness')
      .map(([key, score]) => [
        key.slice(role.length + 1),
        role === 'fact' ? score : Math.max(0, score - 20)
      ])
  );
  if (Object.keys(scores).length === 0) scores.overall = role === 'fact' ? 90 : 40;
  const base: ProductionReview = {
    reviewerRole: role,
    manuscriptVersionId,
    modelSnapshotId: `snapshot-${role}`,
    verdict: 'pass',
    summary: '构造的分维度退化报告',
    issues: [],
    scores
  };
  if (role === 'fact') base.factCandidates = [];
  if (role === 'literary') {
    const previousNaturalness = baseline['literary:ai_style_naturalness'] ?? 80;
    const naturalness = Math.max(0, previousNaturalness - 20);
    base.aiStyle = {
      riskScore: 100 - naturalness,
      flaggedParagraphCount: 1,
      totalParagraphCount: 10,
      flaggedParagraphRatio: 0.1,
      isAuthorshipProbability: false,
      evidence: ['仅用于确定性回退测试']
    };
  }
  if (role === 'experience') {
    base.politicalRisk = {
      level: 'none',
      locations: [],
      evidence: [],
      recommendedAction: '',
      policyVersion: 'test-v1'
    };
    base.sexualContentRisk = {
      level: 'none',
      locations: [],
      evidence: [],
      recommendedAction: '',
      policyVersion: 'test-v1'
    };
  }
  return base;
}
