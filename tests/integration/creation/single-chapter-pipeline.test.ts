import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { ChapterApprovalService } from '../../../apps/api/src/application/creation/chapter-approval-service.js';
import { ProductionWorkflowRepository } from '../../../apps/api/src/infrastructure/db/repositories/production-workflow-repository.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import type { ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { countNovelCharacters } from '../../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';

describe('单章完整创作流水线', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('完成工单、三异模型点评和定点重写，老板确认前不入正史，确认后才结算', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '创作闭环测试书', text: '林澈在旧城追查导师失踪之谜' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1, { firstChapterTitle: '雨夜北塔' });
    const result = await batches.run(scope, batch.batchId);

    expect(result.batch.status).toBe('paused');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual(expect.objectContaining({ status: 'awaiting_confirmation', phase: 'completed', rewriteCount: 1 }));
    const chapterId = batch.chapterIds[0]!;
    expect(context.database.prepare(`SELECT settlement_status, generation_status FROM chapters WHERE chapter_id = ?`).get(chapterId))
      .toEqual({ settlement_status: 'awaiting_confirmation', generation_status: 'completed' });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
    expect(context.database.prepare(`SELECT status FROM tasks WHERE task_id = ?`).get(batch.taskIds[0]!)).toEqual({ status: 'waiting_confirmation' });
    const confirmation = context.database.prepare(`SELECT confirmation_id, expected_canon_revision FROM confirmations
      WHERE owner_id = ? AND book_id = ? AND target_type = 'manuscript' AND status = 'pending'`).get(scope.ownerId, scope.bookId) as { confirmation_id: string; expected_canon_revision: number };
    const approval = new ChapterApprovalService(
      new ProductionWorkflowRepository(context.database), context.dataDir, context.config.releaseId, ids, clock,
      new ChapterCatalogService(context.database, ids, clock), new CanonService(context.database, ids, clock),
      new TaskService(context.database, context.config.releaseId, clock)
    );
    expect(approval.resolve(scope, confirmation.confirmation_id, confirmation.expected_canon_revision, true)).toEqual({ status: 'settled', canonRevision: 1 });
    const completed = await batches.run(scope, batch.batchId);
    expect(completed.batch.status).toBe('completed');
    const manuscripts = context.database.prepare(`
      SELECT manuscript_version_id, parent_version_id, word_count, status, content_hash
      FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY created_at, manuscript_version_id
    `).all(scope.ownerId, scope.bookId, chapterId) as unknown as Array<{ manuscript_version_id: string; parent_version_id: string | null; word_count: number; status: string; content_hash: string }>;
    expect(manuscripts).toHaveLength(2);
    expect(manuscripts.every((item) => item.word_count >= 2_500 && item.word_count <= 3_500)).toBe(true);
    expect(manuscripts[1]?.parent_version_id).toBe(manuscripts[0]?.manuscript_version_id);
    expect(manuscripts[1]?.status).toBe('canon');
    expect(new Set(manuscripts.map((item) => item.content_hash)).size).toBe(2);
    const canonFacts = context.database.prepare(`
      SELECT e.canonical_name, f.relation_key, f.evidence_json, f.status, f.epistemic_status,
        viewpoint.canonical_name AS viewpoint_name
      FROM fact_assertions f JOIN entities e ON e.entity_id = f.subject_entity_id
      LEFT JOIN entities viewpoint ON viewpoint.entity_id = f.viewpoint_entity_id
      WHERE f.owner_id = ? AND f.book_id = ? AND f.source_chapter_id = ? ORDER BY f.fact_id
    `).all(scope.ownerId, scope.bookId, chapterId) as unknown as Array<{
      canonical_name: string; relation_key: string; evidence_json: string; status: string;
      epistemic_status: string; viewpoint_name: string | null;
    }>;
    expect(canonFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonical_name: '林澈', relation_key: 'possesses:item', status: 'active' }),
      expect.objectContaining({ canonical_name: '林澈', relation_key: 'believes:item_capability', status: 'active' })
    ]));
    expect(canonFacts.every((fact) => JSON.parse(fact.evidence_json)[0]?.quote.length > 0)).toBe(true);
    expect(canonFacts.find((fact) => fact.relation_key === 'believes:item_capability'))
      .toMatchObject({ epistemic_status: 'belief', viewpoint_name: '林澈' });
    const projectedState = context.database.prepare(`SELECT p.state_json FROM character_state_projection p
      JOIN entities e ON e.entity_id = p.entity_id AND e.owner_id = p.owner_id AND e.book_id = p.book_id
      WHERE p.owner_id = ? AND p.book_id = ? AND e.canonical_name = '林澈'`)
      .get(scope.ownerId, scope.bookId) as { state_json: string };
    expect(JSON.parse(projectedState.state_json)).toHaveProperty('possesses:item');
    expect(JSON.parse(projectedState.state_json)).not.toHaveProperty('believes:item_capability');
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM stage_settlements
      WHERE owner_id = ? AND book_id = ? AND stage_type = 'chapter' AND stage_key = ? AND status = 'active'
    `).get(scope.ownerId, scope.bookId, chapterId)).toEqual({ count: 1 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM agent_focus_snapshots
      WHERE owner_id = ? AND book_id = ? AND canon_revision = 1 AND status = 'active'
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });

    const panels = context.database.prepare(`SELECT review_round, status, manuscript_version_id FROM review_panels
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY review_round`).all(scope.ownerId, scope.bookId, chapterId);
    expect(panels).toEqual([
      expect.objectContaining({ review_round: 1, status: 'complete' }),
      expect.objectContaining({ review_round: 2, status: 'complete' })
    ]);
    const reports = context.database.prepare(`SELECT reviewer_role, model_snapshot_id, manuscript_version_id, report_json
      FROM review_reports WHERE owner_id = ? AND book_id = ? ORDER BY created_at, reviewer_role`).all(scope.ownerId, scope.bookId) as unknown as Array<{ reviewer_role: string; model_snapshot_id: string; manuscript_version_id: string; report_json: string }>;
    expect(reports).toHaveLength(6);
    for (const version of new Set(reports.map((report) => report.manuscript_version_id))) {
      const sameVersion = reports.filter((report) => report.manuscript_version_id === version);
      expect(new Set(sameVersion.map((report) => report.reviewer_role))).toEqual(new Set(['fact', 'literary', 'experience']));
      expect(new Set(sameVersion.map((report) => report.model_snapshot_id)).size).toBe(3);
    }
    const literary = reports.find((report) => report.reviewer_role === 'literary')!;
    expect(JSON.parse(literary.report_json)).toEqual(expect.objectContaining({ aiStyle: expect.objectContaining({ isAuthorshipProbability: false }) }));
    const experience = reports.find((report) => report.reviewer_role === 'experience')!;
    expect(JSON.parse(experience.report_json)).toEqual(expect.objectContaining({ politicalRisk: expect.any(Object), sexualContentRisk: expect.any(Object) }));

    const calls = context.database.prepare(`
      SELECT provider, model_id, context_pack_id, state FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? ORDER BY created_at, request_id
    `).all(scope.ownerId, scope.bookId, batch.taskIds[0]!) as unknown as Array<{ provider: string; model_id: string; context_pack_id: string | null; state: string }>;
    expect(calls).toHaveLength(10);
    expect(calls.every((call) => call.state === 'succeeded' && call.context_pack_id !== null)).toBe(true);
    const writerModels = new Set(calls.filter((call) => call.provider.includes('writer')).map((call) => `${call.provider}/${call.model_id}`));
    const reviewerModels = new Set(calls.filter((call) => !call.provider.includes('writer')).map((call) => `${call.provider}/${call.model_id}`));
    expect(writerModels.size).toBe(1);
    expect(reviewerModels.size).toBeGreaterThanOrEqual(3);
    expect([...writerModels][0]).not.toBe([...reviewerModels][0]);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM budget_reservations WHERE owner_id = ? AND book_id = ? AND status = 'settled'`).get(scope.ownerId, scope.bookId)).toEqual({ count: 10 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM editor_review_syntheses WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId))
      .toEqual({ count: 2 });
    const retrievalPlans = context.database.prepare(`
      SELECT mode, role_key FROM retrieval_query_plans
      WHERE owner_id = ? AND book_id = ? AND task_id = ? ORDER BY created_at, retrieval_query_plan_id
    `).all(scope.ownerId, scope.bookId, batch.taskIds[0]!) as unknown as Array<{ mode: string; role_key: string }>;
    expect(retrievalPlans.some((plan) => plan.mode === 'drafting' && plan.role_key === 'lead_writer')).toBe(true);
    expect(new Set(retrievalPlans.filter((plan) => plan.mode === 'review').map((plan) => plan.role_key)))
      .toEqual(new Set(['setting', 'literary_reviewer', 'experience_reviewer']));
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 1 });
  });

  it('老板拒绝候选正文后沿用同一任务定点重写，不把拒稿写入正史', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '拒稿重写书', text: '旧城追踪与人物抉择' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');
    expect(approvePendingManuscript(context, scope, ids, clock, false)).toEqual({ status: 'rejected' });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
    expect(context.database.prepare(`SELECT status, current_phase FROM tasks WHERE task_id = ?`).get(batch.taskIds[0]!)).toEqual({ status: 'paused', current_phase: 'rewrite' });
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');
    approvePendingManuscript(context, scope, ids, clock);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('completed');
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 1 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`).get(scope.ownerId, scope.bookId, batch.chapterIds[0]!)).toEqual({ count: 3 });
  });

  it('主笔连续两次技术失败后只接管一次，并由副笔从安全检查点生成完整章节', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '副笔接管测试书', text: '旧城追踪与人物抉择' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const takeoverFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'novel_writer' && provider === 'local-deterministic-writer') {
          return {
            provider,
            modelId,
            async generate() { throw new Error('模拟主笔Endpoint不可用'); }
          };
        }
        if (purpose === 'novel_writer' && modelId.includes('backup_writer')) {
          return {
            provider,
            modelId,
            async generate() {
              return { provider, modelId, output: buildTakeoverNovel(), inputTokens: 400, outputTokens: 1_600, cashCostCny: 0, state: 'succeeded' };
            }
          };
        }
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock, takeoverFactory);
    const batch = batches.scheduleNewChapters(scope, 1, { firstChapterTitle: '接管试笔章' });
    const result = await batches.run(scope, batch.batchId);

    expect(result.batch.status).toBe('paused');
    const run = context.database.prepare(`SELECT writer_agent_id, writer_takeover_count, writer_takeover_reason
      FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, batch.chapterIds[0]!) as { writer_agent_id: string; writer_takeover_count: number; writer_takeover_reason: string | null };
    const activeWriter = context.database.prepare(`SELECT r.role_key FROM agent_instances a JOIN role_templates r
      ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version WHERE a.agent_id = ?`)
      .get(run.writer_agent_id);
    expect(activeWriter).toEqual({ role_key: 'backup_writer' });
    expect(run.writer_takeover_count).toBe(1);
    expect(run.writer_takeover_reason).toContain('一次自动重试后仍发生技术失败');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE owner_id = ? AND book_id = ?
      AND task_id = ? AND state = 'failed' AND error_class = 'technical_failure'`)
      .get(scope.ownerId, scope.bookId, batch.taskIds[0]!)).toEqual({ count: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE owner_id = ? AND book_id = ?
      AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, batch.chapterIds[0]!)).toEqual({ count: 1 });
  });
});

function buildTakeoverNovel(): string {
  const paragraphs: string[] = [];
  const sentence = '林澈沿着旧城石阶核对每一道刻痕，也让同伴守住退路；他没有接受陌生人的解释，而是用行动验证线索与时间。';
  while (countNovelCharacters(paragraphs.join('\n\n')) < 2_700) paragraphs.push(sentence);
  paragraphs.push('钟楼骤然亮起，窗后的人举起导师失踪前留下的钥匙，逼他在追击与救人之间立刻选择。');
  return paragraphs.join('\n\n');
}
