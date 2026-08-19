import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { ChapterPipelineService, containsExplicitPlaceholder, containsInternalWorkflowPayload, containsMarkdownChapterHeading, productionReviewContextBudget } from '../../../apps/api/src/application/creation/chapter-pipeline-service.js';
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, MutableClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { ChapterApprovalService } from '../../../apps/api/src/application/creation/chapter-approval-service.js';
import { ProductionWorkflowRepository } from '../../../apps/api/src/infrastructure/db/repositories/production-workflow-repository.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { ModelAdapterError, type ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { countNovelCharacters } from '../../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../../../apps/api/src/contracts/opening-blueprint.js';
import { WRITER_CONTEXT_POLICY } from '../../../apps/api/src/application/memory/writer-context-policy.js';

describe('单章完整创作流水线', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('事实审查在安全上限内扩容硬来源，文学和体验审查仍保持小资料包', () => {
    const source = (sourceId: string, length: number) => ({
      sourceType: 'test', sourceId, content: '甲'.repeat(length), reason: '测试硬来源', priority: 100
    });
    expect(productionReviewContextBudget('fact', [source('a', 15_437)])).toEqual({
      tokenBudget: 15_437,
      characterBudget: 15_437
    });
    expect(productionReviewContextBudget('fact', [source('a', 19_000)])).toEqual({
      tokenBudget: 18_000,
      characterBudget: 18_000
    });
    expect(productionReviewContextBudget('literary', [source('a', 15_437)])).toEqual({
      tokenBudget: 8_500,
      characterBudget: 8_500
    });
  });

  it('只拦截明确占位标记，不把游戏面板方括号误判成占位内容', () => {
    expect(containsExplicitPlaceholder('【身份：无籍流民】\n【可提现收益：0元】')).toBe(false);
    expect(containsExplicitPlaceholder('正文\n【TODO】\n正文')).toBe(true);
    expect(containsExplicitPlaceholder('正文\n[待补]\n正文')).toBe(true);
    expect(containsExplicitPlaceholder('正文\n占位\n正文')).toBe(true);
  });

  it('拒绝正文内重复输出Markdown章节标题', () => {
    expect(containsMarkdownChapterHeading('# 第九章 可移送的重量\n正文开始。')).toBe(true);
    expect(containsMarkdownChapterHeading('正文开始。\n# 可移送的重量\n继续正文。')).toBe(true);
    expect(containsMarkdownChapterHeading('正文开始。\n## 场景切换\n继续正文。')).toBe(false);
    expect(containsMarkdownChapterHeading('正文里的#号不是标题。')).toBe(false);
  });

  it('拒绝正文暴露JSON字段、上下文来源或工作流载荷', () => {
    expect(containsInternalWorkflowPayload('前章她已经把路线全部改成实线。')).toBe(true);
    expect(containsInternalWorkflowPayload('本章完成了两人的第一次正面冲突。')).toBe(true);
    expect(containsInternalWorkflowPayload('薄雾压城。{"chapterNumber":2,"continuityAnchors":{}}，她继续追查。')).toBe(true);
    expect(containsInternalWorkflowPayload('正文\n\`\`\`json\n{}\n\`\`\`')).toBe(true);
    expect(containsInternalWorkflowPayload('ContextPack已编译，随后执行质量门禁。')).toBe(true);
    expect(containsInternalWorkflowPayload('她在纸上写下“chapter number”两个英文单词，然后合上本子。')).toBe(false);
  });

  it('把老板确认的开书方向和人物作为主笔硬来源，但保持资料包在4800字内', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain', targetAudience: '',
      protagonists: [{ role: 'female_lead', name: '林澄', age: '二十七岁', background: '失物招领中心档案员', personalities: ['敏锐'] }],
      storyDirection: '林澄在失物招领中心追查一张日期来自明天的归还单。',
      worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '',
      mainTags: ['现言', '悬疑'], auxiliaryTags: ['青春校园'], storyTraits: ['打脸'], customTags: [],
      initialMap: '', mustFollow: ['机构名称固定为失物招领中心']
    };
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '开书资料入包测试', text: openingBlueprint.storyDirection, openingBlueprint
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1);
    await batches.run(scope, batch.batchId);
    const draftCall = context.database.prepare(`SELECT context_pack_id FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND phase_key LIKE 'draft:%' AND state = 'succeeded'
      ORDER BY created_at LIMIT 1`).get(scope.ownerId, scope.bookId, batch.taskIds[0]!) as { context_pack_id: string };
    const pack = context.database.prepare(`SELECT source_manifest_json FROM context_packs WHERE context_pack_id = ?`)
      .get(draftCall.context_pack_id) as { source_manifest_json: string };
    const sources = JSON.parse(pack.source_manifest_json) as Array<{ sourceType: string; content: string }>;
    const profile = sources.find((source) => source.sourceType === 'opening_profile');
    expect(profile?.content).toContain('失物招领中心');
    expect(WRITER_CONTEXT_POLICY.draft.characterBudget).toBe(9_000);
    expect(WRITER_CONTEXT_POLICY.ownerRewrite.characterBudget).toBe(12_000);
    expect(sources.reduce((total, source) => total + source.content.length, 0)).toBeLessThanOrEqual(9_000);
  });

  it('结算时保存前章全文锚点，并在下一章写作与审校资料包中强制携带', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '跨章锚点测试书', text: '旧城档案追踪' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 3);
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const anchorFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'novel_writer') {
          return {
            provider, modelId,
            async generate(request) {
              const envelope = JSON.parse(request.prompt) as { chapterNumber?: number; taskInput?: { chapterNumber?: number } };
              const chapterNumber = envelope.taskInput?.chapterNumber ?? envelope.chapterNumber ?? 1;
              const output = buildDistinctAnchorNovel(chapterNumber);
              return { provider, modelId, output, inputTokens: 400, outputTokens: 1_600, cashCostCny: 0, state: 'succeeded' };
            }
          };
        }
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock, anchorFactory);
    const batch = batches.scheduleNewChapters(scope, 3);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');
    approvePendingManuscript(context, scope, ids, clock);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');

    const state = context.database.prepare(`SELECT e.state_json FROM chapters c JOIN chapter_end_states e
      ON e.chapter_end_state_id = c.chapter_end_state_id WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number = 1`)
      .get(scope.ownerId, scope.bookId) as { state_json: string };
    expect(JSON.parse(state.state_json)).toHaveProperty('continuityAnchors');
    const calls = context.database.prepare(`SELECT p.source_manifest_json FROM model_calls m JOIN context_packs p
      ON p.context_pack_id = m.context_pack_id WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ?
      AND m.state = 'succeeded' AND (m.phase_key LIKE 'draft:%' OR m.phase_key LIKE 'review-%')`)
      .all(scope.ownerId, scope.bookId, batch.taskIds[1]!) as unknown as Array<{ source_manifest_json: string }>;
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      const sourceTypes = (JSON.parse(call.source_manifest_json) as Array<{ sourceType: string }>).map((source) => source.sourceType);
      expect(sourceTypes.some((sourceType) => ['previous_chapter_anchors', 'previous_chapter_full'].includes(sourceType))).toBe(true);
    }
    const reviewCalls = context.database.prepare(`SELECT m.phase_key, p.policy_version, p.source_manifest_json
      FROM model_calls m JOIN context_packs p ON p.context_pack_id = m.context_pack_id
      WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ? AND m.state = 'succeeded'
        AND m.phase_key LIKE 'review-%'`)
      .all(scope.ownerId, scope.bookId, batch.taskIds[1]!) as unknown as Array<{
        phase_key: string; policy_version: string; source_manifest_json: string;
      }>;
    const factReview = reviewCalls.find((call) => call.phase_key.includes('-fact-'));
    expect(factReview?.policy_version).toBe('production-review-fact-context-v6-adaptive-15000-18000chars');
    const factSources = JSON.parse(factReview?.source_manifest_json ?? '[]') as Array<{ sourceType: string; content: string }>;
    expect(factSources.map((source) => source.sourceType)).toContain('previous_chapter_full');
    expect(factSources.find((source) => source.sourceType === 'previous_chapter_full')?.content.length).toBeGreaterThan(800);
    for (const reviewCall of reviewCalls.filter((call) => !call.phase_key.includes('-fact-'))) {
      const sourceTypes = (JSON.parse(reviewCall.source_manifest_json) as Array<{ sourceType: string }>).map((source) => source.sourceType);
      expect(sourceTypes).not.toContain('previous_chapter_full');
    }
  });

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
    const rewriteCall = context.database.prepare(`SELECT context_pack_id FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND phase_key LIKE 'rewrite-%' AND state = 'succeeded'
      ORDER BY created_at DESC LIMIT 1`).get(scope.ownerId, scope.bookId, batch.taskIds[0]!) as { context_pack_id: string };
    const draftCall = context.database.prepare(`SELECT context_pack_id FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND phase_key LIKE 'draft:%' AND state = 'succeeded'
      ORDER BY created_at LIMIT 1`).get(scope.ownerId, scope.bookId, batch.taskIds[0]!) as { context_pack_id: string };
    const draftPack = context.database.prepare(`
      SELECT policy_version, total_tokens, source_manifest_json
      FROM context_packs WHERE context_pack_id = ?
    `).get(draftCall.context_pack_id) as {
      policy_version: string;
      total_tokens: number;
      source_manifest_json: string;
    };
    const draftSources = JSON.parse(draftPack.source_manifest_json) as Array<{
      sourceType: string;
      content: string;
    }>;
    expect(draftPack.policy_version).toBe('writer-draft-context-v6-full-current-outline-9000chars');
    expect(draftPack.total_tokens).toBeLessThanOrEqual(9_000);
    expect(draftSources.reduce((total, source) => total + source.content.length, 0)).toBeLessThanOrEqual(9_000);
    expect(draftSources.map((source) => source.sourceType)).not.toContain('creative_plan');
    const rewritePack = context.database.prepare(`SELECT policy_version, source_manifest_json FROM context_packs WHERE context_pack_id = ?`)
      .get(rewriteCall.context_pack_id) as { policy_version: string; source_manifest_json: string };
    const rewriteSources = JSON.parse(rewritePack.source_manifest_json) as Array<{ sourceType: string; content: string }>;
    const rewriteSourceTypes = rewriteSources.map((source) => source.sourceType);
    expect(rewriteSourceTypes).toEqual(expect.arrayContaining(['current_manuscript', 'review_issues', 'chapter_work_order']));
    expect(rewriteSourceTypes).not.toEqual(expect.arrayContaining([
      'stage_settlement_context', 'previous_chapter_end', 'previous_chapter_tail', 'retrieval:fact', 'retrieval:manuscript'
    ]));
    expect(rewritePack.policy_version).toBe('writer-targeted-rewrite-context-v3-12000chars');
    expect(rewriteSources.reduce((total, source) => total + source.content.length, 0))
      .toBeLessThanOrEqual(12_000);
    const reviewCall = context.database.prepare(`SELECT context_pack_id FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND phase_key LIKE 'review-%' AND state = 'succeeded'
      ORDER BY created_at DESC LIMIT 1`).get(scope.ownerId, scope.bookId, batch.taskIds[0]!) as { context_pack_id: string };
    const reviewPack = context.database.prepare(`SELECT source_manifest_json FROM context_packs WHERE context_pack_id = ?`)
      .get(reviewCall.context_pack_id) as { source_manifest_json: string };
    const reviewSourceTypes = (JSON.parse(reviewPack.source_manifest_json) as Array<{ sourceType: string }>).map((source) => source.sourceType);
    expect(reviewSourceTypes).toEqual(expect.arrayContaining([
      'current_manuscript', 'chapter_outline', 'writing_contract'
    ]));
    const chapterId = batch.chapterIds[0]!;
    expect(context.database.prepare(`SELECT settlement_status, generation_status FROM chapters WHERE chapter_id = ?`).get(chapterId))
      .toEqual({ settlement_status: 'awaiting_confirmation', generation_status: 'completed' });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
    expect(context.database.prepare(`SELECT status FROM tasks WHERE task_id = ?`).get(batch.taskIds[0]!)).toEqual({ status: 'waiting_confirmation' });
    const confirmation = context.database.prepare(`SELECT confirmation_id, expected_canon_revision FROM confirmations
      WHERE owner_id = ? AND book_id = ? AND target_type = 'manuscript' AND status = 'pending'`).get(scope.ownerId, scope.bookId) as { confirmation_id: string; expected_canon_revision: number };
    const factReport = context.database.prepare(`SELECT review_report_id, report_json FROM review_reports
      WHERE owner_id = ? AND book_id = ? AND reviewer_role = 'fact' AND status = 'submitted'
      ORDER BY created_at DESC, review_report_id DESC LIMIT 1`).get(scope.ownerId, scope.bookId) as { review_report_id: string; report_json: string };
    const malformedFactReport = JSON.parse(factReport.report_json) as { factCandidates: unknown[] };
    const validFactTemplate = malformedFactReport.factCandidates[0] as Record<string, unknown>;
    malformedFactReport.factCandidates.push({
      ...validFactTemplate,
      relationKey: 'identity:uncertain',
      value: '导师失踪线索仍有两种解释',
      epistemicStatus: 'ambiguous'
    });
    malformedFactReport.factCandidates.push({
      ...validFactTemplate,
      relationKey: 'claim:unscoped',
      value: '来源不明的角色说法',
      epistemicStatus: 'claim',
      viewpointName: null,
      knowledgeSubjectName: null
    });
    malformedFactReport.factCandidates.push({
      entityType: 'character', subjectName: '林澈', relationKey: 'invalid_projection', value: '不得晋升',
      evidenceQuote: '这段由模型改写的证据并不在正文中', evidenceLocation: '正文', storyTimeStart: null,
      storyTimeEnd: null, epistemicStatus: 'objective', negated: false, viewpointName: null,
      knowledgeSubjectName: null, knowledgeTimeStart: null, knowledgeTimeEnd: null
    });
    context.database.prepare(`UPDATE review_reports SET report_json = ? WHERE review_report_id = ?`)
      .run(JSON.stringify(malformedFactReport), factReport.review_report_id);
    const unrelatedOlderReport = context.database.prepare(`SELECT review_report_id, manuscript_version_id FROM review_reports
      WHERE owner_id = ? AND book_id = ? AND manuscript_version_id <> ? ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId, String((context.database.prepare(`SELECT manuscript_version_id FROM chapter_approval_gates
        WHERE confirmation_id = ?`).get(confirmation.confirmation_id) as { manuscript_version_id: string }).manuscript_version_id)) as {
          review_report_id: string; manuscript_version_id: string;
        };
    const gateManuscriptId = (context.database.prepare(`SELECT manuscript_version_id FROM chapter_approval_gates
      WHERE confirmation_id = ?`).get(confirmation.confirmation_id) as { manuscript_version_id: string }).manuscript_version_id;
    context.database.prepare(`UPDATE review_reports SET manuscript_version_id = ? WHERE review_report_id = ?`)
      .run(gateManuscriptId, unrelatedOlderReport.review_report_id);
    const approval = new ChapterApprovalService(
      new ProductionWorkflowRepository(context.database), context.dataDir, context.config.releaseId, ids, clock,
      new ChapterCatalogService(context.database, ids, clock), new CanonService(context.database, ids, clock),
      new TaskService(context.database, context.config.releaseId, clock)
    );
    expect(approval.resolve(scope, confirmation.confirmation_id, confirmation.expected_canon_revision, true)).toEqual({ status: 'settled', canonRevision: 1 });
    expect(context.database.prepare(`SELECT settlement_status, generation_status FROM chapters WHERE chapter_id = ?`).get(chapterId))
      .toEqual({ settlement_status: 'settled', generation_status: 'completed' });
    context.database.prepare(`UPDATE review_reports SET manuscript_version_id = ? WHERE review_report_id = ?`)
      .run(unrelatedOlderReport.manuscript_version_id, unrelatedOlderReport.review_report_id);
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
    expect(canonFacts.some((fact) => fact.relation_key === 'invalid_projection')).toBe(false);
    const ambiguousLifecycle = context.database.prepare(`
      SELECT f.status AS fact_status, f.epistemic_status, r.lifecycle_layer AS layer, r.status AS knowledge_status
      FROM fact_assertions f JOIN knowledge_items i
        ON i.owner_id = f.owner_id AND i.book_id = f.book_id
        AND i.knowledge_type = 'fact_assertion' AND i.canonical_key = f.fact_id
      JOIN knowledge_revisions r ON r.knowledge_item_id = i.knowledge_item_id
        AND r.owner_id = i.owner_id AND r.book_id = i.book_id
      WHERE f.owner_id = ? AND f.book_id = ? AND f.source_chapter_id = ?
        AND f.relation_key = 'identity:uncertain'
      ORDER BY r.revision DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapterId);
    expect(ambiguousLifecycle).toEqual({
      fact_status: 'active', epistemic_status: 'ambiguous', layer: 'candidate', knowledge_status: 'active'
    });
    const unscopedLifecycle = context.database.prepare(`
      SELECT f.status AS fact_status, f.epistemic_status, r.lifecycle_layer AS layer, r.status AS knowledge_status
      FROM fact_assertions f JOIN knowledge_items i
        ON i.owner_id = f.owner_id AND i.book_id = f.book_id
        AND i.knowledge_type = 'fact_assertion' AND i.canonical_key = f.fact_id
      JOIN knowledge_revisions r ON r.knowledge_item_id = i.knowledge_item_id
        AND r.owner_id = i.owner_id AND r.book_id = i.book_id
      WHERE f.owner_id = ? AND f.book_id = ? AND f.source_chapter_id = ?
        AND f.relation_key = 'claim:unscoped'
      ORDER BY r.revision DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapterId);
    expect(unscopedLifecycle).toEqual({
      fact_status: 'active', epistemic_status: 'claim', layer: 'candidate', knowledge_status: 'active'
    });
    const rejectedProjectionEvent = context.database.prepare(`SELECT data_json FROM persistent_events
      WHERE owner_id = ? AND book_id = ? AND event_type = 'fact_candidate.rejected'`).get(scope.ownerId, scope.bookId) as { data_json: string };
    expect(JSON.parse(rejectedProjectionEvent.data_json)).toEqual(expect.objectContaining({
      chapterId, relationKey: 'invalid_projection', reason: 'evidence_quote_not_found'
    }));
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
      SELECT COUNT(*) AS count FROM stage_settlements
      WHERE owner_id = ? AND book_id = ? AND stage_type = 'story_arc'
        AND chapter_start = 1 AND chapter_end = 1 AND status = 'active'
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM agent_focus_snapshots
      WHERE owner_id = ? AND book_id = ? AND canon_revision = 1 AND status = 'active'
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });

    const panels = context.database.prepare(`SELECT review_round, status, manuscript_version_id FROM review_panels
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY review_round`).all(scope.ownerId, scope.bookId, chapterId);
    expect(panels).toEqual([
      expect.objectContaining({ review_round: 1, status: 'complete' }),
      expect.objectContaining({ review_round: 1, status: 'complete' })
    ]);
    expect(new Set(panels.map((panel) => panel.manuscript_version_id)).size).toBe(2);
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
    const qualitySnapshots = context.database.prepare(`
      SELECT manuscript_version_id, dimensions_json, hard_blocked, is_best
      FROM manuscript_quality_snapshots
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
      ORDER BY created_at, manuscript_quality_snapshot_id
    `).all(scope.ownerId, scope.bookId, chapterId) as unknown as Array<{
      manuscript_version_id: string;
      dimensions_json: string;
      hard_blocked: number;
      is_best: number;
    }>;
    expect(qualitySnapshots).toHaveLength(2);
    expect(qualitySnapshots.filter((snapshot) => snapshot.is_best === 1)).toHaveLength(1);
    expect(qualitySnapshots.every((snapshot) => {
      const dimensions = Object.keys(JSON.parse(snapshot.dimensions_json) as Record<string, number>);
      return dimensions.some((dimension) => dimension.startsWith('fact:'))
        && dimensions.some((dimension) => dimension.startsWith('literary:'))
        && dimensions.some((dimension) => dimension.startsWith('experience:'));
    })).toBe(true);
    expect(qualitySnapshots.find((snapshot) => snapshot.is_best === 1)?.manuscript_version_id)
      .toBe((context.database.prepare(`SELECT current_manuscript_version_id FROM chapters WHERE chapter_id = ?`)
        .get(chapterId) as { current_manuscript_version_id: string }).current_manuscript_version_id);
    const retrievalPlans = context.database.prepare(`
      SELECT mode, role_key FROM retrieval_query_plans
      WHERE owner_id = ? AND book_id = ? AND task_id = ? ORDER BY created_at, retrieval_query_plan_id
    `).all(scope.ownerId, scope.bookId, batch.taskIds[0]!) as unknown as Array<{ mode: string; role_key: string }>;
    expect(retrievalPlans.some((plan) => plan.mode === 'drafting' && plan.role_key === 'lead_writer')).toBe(true);
    expect(new Set(retrievalPlans.filter((plan) => plan.mode === 'review').map((plan) => plan.role_key)))
      .toEqual(new Set(['fact_reviewer', 'literary_reviewer', 'experience_reviewer']));
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 1 });

    const sourcePanel = context.database.prepare(`SELECT * FROM review_panels
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
      ORDER BY created_at DESC, review_panel_id DESC LIMIT 1`).get(scope.ownerId, scope.bookId, chapterId) as Record<string, string | number>;
    const sourcePanelId = sourcePanel.review_panel_id as string;
    const incompletePanelId = ids.next();
    context.database.prepare(`INSERT INTO review_panels (
      review_panel_id, owner_id, book_id, manuscript_version_id, writer_model_snapshot_id,
      fact_agent_id, fact_model_snapshot_id, literary_agent_id, literary_model_snapshot_id,
      experience_agent_id, experience_model_snapshot_id, selection_reason_json, status, created_at,
      chapter_id, review_round, manuscript_hash, writer_epoch, binding_revision_id, writing_order_id, canon_revision, token_budget
    ) SELECT ?, owner_id, book_id, manuscript_version_id, writer_model_snapshot_id,
      fact_agent_id, fact_model_snapshot_id, literary_agent_id, literary_model_snapshot_id,
      experience_agent_id, experience_model_snapshot_id, selection_reason_json, 'blocked', ?,
      chapter_id, 3, manuscript_hash, writer_epoch, binding_revision_id, writing_order_id, canon_revision, token_budget
      FROM review_panels WHERE review_panel_id = ?`).run(incompletePanelId, clock.now().toISOString(), sourcePanelId);
    const sourceReports = context.database.prepare(`SELECT * FROM review_reports
      WHERE review_panel_id = ? AND reviewer_role IN ('fact', 'literary') ORDER BY reviewer_role`).all(sourcePanelId) as Array<{
        manuscript_version_id: string; reviewer_role: string; agent_id: string; model_snapshot_id: string;
        report_json: string; report_hash: string; input_tokens: number;
      }>;
    for (const report of sourceReports) {
      context.database.prepare(`INSERT INTO review_reports (
        review_report_id, owner_id, book_id, review_panel_id, manuscript_version_id, reviewer_role,
        agent_id, model_snapshot_id, report_json, report_hash, input_tokens, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`)
        .run(ids.next(), scope.ownerId, scope.bookId, incompletePanelId, report.manuscript_version_id,
          report.reviewer_role, report.agent_id, report.model_snapshot_id, report.report_json,
          report.report_hash, report.input_tokens, clock.now().toISOString());
    }
    const recovered = new ProductionWorkflowRepository(context.database).resumeIncompleteReviewPanel(scope, {
      manuscriptVersionId: sourcePanel.manuscript_version_id as string,
      manuscriptHash: sourcePanel.manuscript_hash as string,
      writerModelSnapshotId: sourcePanel.writer_model_snapshot_id as string,
      canonRevision: Number(sourcePanel.canon_revision),
      bindingRevisionId: sourcePanel.binding_revision_id as string
    });
    expect(recovered).toMatchObject({ reviewPanelId: incompletePanelId, reviewRound: 3, status: 'working' });
    expect(context.database.prepare(`SELECT status FROM review_panels WHERE review_panel_id = ?`).get(incompletePanelId))
      .toEqual({ status: 'working' });
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

  it('老板阅读超过租约时限后退回正文，仍精确恢复同一写手工单完成定点重写', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '过期租约退回书', text: '旧城阵纹与人物抉择' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');
    clock.advance(16 * 60_000);
    expect(approvePendingManuscript(context, scope, ids, clock, false)).toEqual({ status: 'rejected' });
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');
    const lease = context.database.prepare(`SELECT active_writer_agent_id, writer_epoch, writing_order_id, lease_expires_at
      FROM writer_leases WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId) as {
        active_writer_agent_id: string; writer_epoch: number; writing_order_id: string; lease_expires_at: string;
      };
    const run = context.database.prepare(`SELECT writer_agent_id, writer_epoch, writing_order_id, rewrite_count
      FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, batch.chapterIds[0]!) as {
        writer_agent_id: string; writer_epoch: number; writing_order_id: string; rewrite_count: number;
      };
    expect(lease).toMatchObject({
      active_writer_agent_id: run.writer_agent_id,
      writer_epoch: run.writer_epoch,
      writing_order_id: run.writing_order_id
    });
    expect(Date.parse(lease.lease_expires_at)).toBeGreaterThan(clock.now().getTime());
    expect(run.rewrite_count).toBeGreaterThanOrEqual(1);
    expect(run.rewrite_count).toBeLessThanOrEqual(2);
  });

  it('已结算章节通过正式修订任务产生不可变新版本，作者确认后才替换当前正史', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '已结算章节正式修订测试书', text: '雨夜失物招领处的时间谜案'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1);
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('paused');
    expect(approvePendingManuscript(context, scope, ids, clock)).toEqual({ status: 'settled', canonRevision: 1 });
    expect((await batches.run(scope, batch.batchId)).batch.status).toBe('completed');

    const chapterId = batch.chapterIds[0]!;
    const before = context.database.prepare(`
      SELECT canon_manuscript_version_id, settlement_status, generation_status
      FROM chapters WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
    `).get(scope.ownerId, scope.bookId, chapterId) as {
      canon_manuscript_version_id: string; settlement_status: string; generation_status: string;
    };
    const scheduled = batches.scheduleExistingRevision(
      scope, chapterId, before.canon_manuscript_version_id, 'rewrite_existing',
      '删除任何内部工作流字段或JSON载荷，保留剧情事实并自然重写。'
    );
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const claimed = tasks.claimNext('settled-revision-worker', 120_000)!;
    expect(claimed.taskId).toBe(scheduled.taskId);
    const revised = await new ChapterPipelineService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    ).executeClaimed(scope, scheduled.taskId, 'settled-revision-worker', undefined, {
      leaseToken: claimed.leaseToken!, attemptNo: claimed.currentAttemptNo
    });
    expect(revised.status).toBe('awaiting_confirmation');
    expect(revised.manuscriptVersionId).not.toBe(before.canon_manuscript_version_id);
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 1 });
    expect(context.database.prepare(`SELECT canon_manuscript_version_id, settlement_status FROM chapters WHERE chapter_id = ?`)
      .get(chapterId)).toEqual({ canon_manuscript_version_id: before.canon_manuscript_version_id, settlement_status: 'settled' });

    expect(approvePendingManuscript(context, scope, ids, clock, false)).toEqual({ status: 'rejected' });
    expect(context.database.prepare(`SELECT canon_manuscript_version_id, settlement_status FROM chapters WHERE chapter_id = ?`)
      .get(chapterId)).toEqual({ canon_manuscript_version_id: before.canon_manuscript_version_id, settlement_status: 'settled' });
    tasks.queue(scope, scheduled.taskId);
    const retryClaim = tasks.claimNext('settled-revision-worker', 120_000)!;
    const revisedAfterRejection = await new ChapterPipelineService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    ).executeClaimed(scope, scheduled.taskId, 'settled-revision-worker', undefined, {
      leaseToken: retryClaim.leaseToken!, attemptNo: retryClaim.currentAttemptNo
    });
    expect(revisedAfterRejection.status).toBe('awaiting_confirmation');

    expect(approvePendingManuscript(context, scope, ids, clock)).toEqual({ status: 'settled', canonRevision: 2 });
    const after = context.database.prepare(`
      SELECT canon_manuscript_version_id, settlement_status, generation_status
      FROM chapters WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
    `).get(scope.ownerId, scope.bookId, chapterId) as {
      canon_manuscript_version_id: string; settlement_status: string; generation_status: string;
    };
    expect(after).toEqual({
      canon_manuscript_version_id: revisedAfterRejection.manuscriptVersionId,
      settlement_status: 'settled', generation_status: 'completed'
    });
    expect(context.database.prepare(`SELECT parent_version_id, status FROM manuscript_versions WHERE manuscript_version_id = ?`)
      .get(revisedAfterRejection.manuscriptVersionId)).toEqual({ parent_version_id: revised.manuscriptVersionId, status: 'canon' });
    expect(context.database.prepare(`SELECT status FROM manuscript_versions WHERE manuscript_version_id = ?`)
      .get(before.canon_manuscript_version_id)).toEqual({ status: 'canon' });
    expect(context.database.prepare(`SELECT status FROM tasks WHERE task_id = ?`).get(scheduled.taskId))
      .toEqual({ status: 'succeeded' });
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

    const chapterId = batch.chapterIds[0]!;
    const manuscript = context.database.prepare(`SELECT manuscript_version_id, author_agent_id, model_id
      FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(scope.ownerId, scope.bookId, chapterId) as { manuscript_version_id: string; author_agent_id: string; model_id: string };
    expect(approvePendingManuscript(context, scope, ids, clock, false)).toEqual({ status: 'rejected' });
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.requestCancel(scope, batch.taskIds[0]!);
    const scheduled = batches.scheduleExistingRevision(scope, chapterId, manuscript.manuscript_version_id, 'review_existing');
    const claimed = tasks.claimNext('review-existing-worker', 120_000)!;
    expect(claimed.taskId).toBe(scheduled.taskId);
    const reviewed = await new ChapterPipelineService(
      context.database, context.dataDir, context.config.releaseId, ids, clock, takeoverFactory
    ).executeClaimed(scope, scheduled.taskId, 'review-existing-worker', undefined, {
      leaseToken: claimed.leaseToken!, attemptNo: claimed.currentAttemptNo
    });
    expect(reviewed.status).toBe('awaiting_confirmation');
    const frozen = context.database.prepare(`SELECT writer_model_snapshot_id, fact_model_snapshot_id
      FROM review_panels WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ?
      ORDER BY created_at DESC LIMIT 1`).get(scope.ownerId, scope.bookId, manuscript.manuscript_version_id) as {
        writer_model_snapshot_id: string; fact_model_snapshot_id: string;
      };
    const author = context.database.prepare(`SELECT model_snapshot_id FROM agent_instances WHERE agent_id = ?`)
      .get(manuscript.author_agent_id) as { model_snapshot_id: string };
    expect(manuscript.model_id).toContain('backup_writer');
    expect(frozen.writer_model_snapshot_id).toBe(author.model_snapshot_id);
    expect(frozen.fact_model_snapshot_id).not.toBe(frozen.writer_model_snapshot_id);
  });

  it('主笔调用结果状态未知时不盲目重试原模型，改由副笔从安全检查点接管', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '结果未知接管测试书', text: '雨夜失物招领处' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const takeoverFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'novel_writer' && provider === 'local-deterministic-writer') {
          return {
            provider, modelId,
            async generate() {
              throw new ModelAdapterError('模拟订阅通道退出但结果状态未知', 'technical_failure', false, undefined, true);
            }
          };
        }
        if (purpose === 'novel_writer' && modelId.includes('backup_writer')) {
          return {
            provider, modelId,
            async generate() {
              return { provider, modelId, output: buildTakeoverNovel(), inputTokens: 400, outputTokens: 1_600, cashCostCny: 0, state: 'succeeded' };
            }
          };
        }
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock, takeoverFactory);
    const batch = batches.scheduleNewChapters(scope, 1, { firstChapterTitle: '未知结果后的接管' });

    const result = await batches.run(scope, batch.batchId);

    expect(result.batch.status).toBe('paused');
    const run = context.database.prepare(`SELECT writer_takeover_count, writer_takeover_reason FROM chapter_pipeline_runs
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, batch.chapterIds[0]!) as { writer_takeover_count: number; writer_takeover_reason: string };
    expect(run.writer_takeover_count).toBe(1);
    expect(run.writer_takeover_reason).toContain('结果状态未知');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE owner_id = ? AND book_id = ?
      AND task_id = ? AND state = 'interrupted' AND error_class = 'provider_result_unknown'`)
      .get(scope.ownerId, scope.bookId, batch.taskIds[0]!)).toEqual({ count: 1 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE owner_id = ? AND book_id = ?
      AND chapter_id = ?`).get(scope.ownerId, scope.bookId, batch.chapterIds[0]!)).toEqual({ count: 1 });
  });

  it('硬检查发现初稿超出有界容差时自动定点补写，而不是让整章任务失败', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '长度修复测试书', text: '灰塔生存危机' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    let rewritePrompt = '';
    const repairFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'novel_writer') {
          return {
            provider, modelId,
            async generate(request) {
              const operation = (JSON.parse(request.prompt) as { operation: string }).operation;
              if (operation === 'rewrite') rewritePrompt = request.prompt;
              const output = '林'.repeat(operation === 'draft' ? 2_299 : 2_700);
              return { provider, modelId, output, inputTokens: 100, outputTokens: output.length, cashCostCny: 0, state: 'succeeded' };
            }
          };
        }
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock, repairFactory);
    const batch = batches.scheduleNewChapters(scope, 1);

    const result = await batches.run(scope, batch.batchId);
    expect(result.results[0]).toEqual(expect.objectContaining({ status: 'awaiting_confirmation', rewriteCount: 1 }));
    expect(context.database.prepare(`SELECT passed FROM hard_check_results WHERE owner_id = ? AND book_id = ? ORDER BY created_at, hard_check_id`)
      .all(scope.ownerId, scope.bookId)).toEqual([{ passed: 0 }, { passed: 1 }]);
    expect(context.database.prepare(`SELECT word_count FROM manuscript_versions WHERE owner_id = ? AND book_id = ? ORDER BY created_at, manuscript_version_id`)
      .all(scope.ownerId, scope.bookId)).toEqual([{ word_count: 2299 }, { word_count: 2700 }]);
    expect(rewritePrompt).toContain('2700至3200个汉字、字母或数字有效字符（不计标点和空白）');
    expect(JSON.parse(rewritePrompt)).toMatchObject({
      lengthContract: {
        generationAimMinimum: 2700,
        generationAimMaximum: 3200,
        acceptedMaximum: 3650
      }
    });
  });

  it('目标区间附近的完整稿记录告警但不为字数机械重写', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '长度容差测试书', text: '灰塔生存危机' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
    const toleranceFactory = {
      resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
        if (purpose === 'novel_writer') return {
          provider, modelId,
          async generate() {
            const output = '林'.repeat(2_479);
            return { provider, modelId, output, inputTokens: 100, outputTokens: output.length, cashCostCny: 0, state: 'succeeded' };
          }
        };
        return baseFactory.resolve(provider, modelId, purpose, roleKey);
      }
    } as ModelAdapterFactory;
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock, toleranceFactory);
    const batch = batches.scheduleNewChapters(scope, 1);

    const result = await batches.run(scope, batch.batchId);
    expect(result.results[0]).toEqual(expect.objectContaining({ phase: 'completed', status: 'awaiting_confirmation', rewriteCount: 0 }));
    const row = context.database.prepare(`SELECT passed, checks_json FROM hard_check_results
      WHERE owner_id = ? AND book_id = ? ORDER BY created_at DESC LIMIT 1`).get(scope.ownerId, scope.bookId) as { passed: number; checks_json: string };
    expect(row.passed).toBe(1);
    expect(JSON.parse(row.checks_json).length).toMatchObject({ passed: true, targetMet: false, minimum: 2350, maximum: 3650, targetMinimum: 2700, targetMaximum: 3200 });
  });
  it('作者可重试因审校报告缺席而技术阻断的章节，但不能绕过完整点评门禁', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '审校中断恢复测试书', text: '林澈在旧城追查导师失踪之谜'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1, { firstChapterTitle: '缺席的报告' });
    await batches.run(scope, batch.batchId);
    const taskId = batch.taskIds[0]!;
    const panel = context.database.prepare(`
      SELECT review_panel_id FROM chapter_pipeline_runs
      WHERE owner_id = ? AND book_id = ? AND task_id = ?
    `).get(scope.ownerId, scope.bookId, taskId) as { review_panel_id: string };
    context.database.prepare(`DELETE FROM review_reports
      WHERE review_panel_id = ? AND reviewer_role = 'fact'`).run(panel.review_panel_id);
    context.database.prepare(`UPDATE tasks SET status = 'blocked', error_code = 'QUALITY_BLOCKED', current_phase = 'review'
      WHERE owner_id = ? AND book_id = ? AND task_id = ?`).run(scope.ownerId, scope.bookId, taskId);

    expect(new TaskService(context.database, context.config.releaseId, clock).retryFailed(scope, taskId))
      .toMatchObject({ status: 'queued', errorCode: null, currentPhase: 'review' });
  });
});

function buildDistinctAnchorNovel(chapterNumber: number): string {
  const scenes = [
    ['冰窖失火后，林澈沿着熏黑砖缝寻找被移走的账册。', '守窖人抱着烫伤的手臂挡住门口，坚持先把困在暗格里的孩子救出来。', '梁上的冰柱忽然断裂，逼两人放弃最近的出口，从积水漫过的运盐道撤离。'],
    ['渡船离岸时，林澈发现昨夜留下的绳结被人换成水手才懂的反扣。', '摆渡姑娘不肯替他隐瞒行踪，只答应在追兵靠岸前多绕一次芦苇荡。', '河心浮起一只没有灯火的空船，船舱里却传来导师惯用的三短一长敲击声。'],
    ['钟楼封门后，林澈顺着齿轮转动的间隙爬进夹层，寻找被藏起的报时簿。', '修钟匠承认自己改过一刻钟，却拒绝说出雇主，因为家人仍被关在南城仓房。', '第一声钟响震落墙灰，露出一张指向北塔地下室的旧城排水图。']
  ][Math.max(0, Math.min(2, chapterNumber - 1))]!;
  const paragraphs: string[] = [];
  let round = 0;
  while (countNovelCharacters(paragraphs.join('\n\n')) < 2_700) {
    const seed = scenes[round % scenes.length]!;
    const consequence = chapterNumber === 1
      ? '烟火让每次呼吸都带着苦味，他必须在屋梁塌落前决定先保证据还是先救人。'
      : chapterNumber === 2
        ? '水流不断改变船身方向，他只能依靠岸边灯影判断追兵是否已经分成两路。'
        : '齿轮每转一圈都缩短夹层里的安全时间，他只能让同伴在楼下制造一次短暂误会。';
    paragraphs.push(`${seed}${consequence}第${round + 1}次尝试带来新的动作后果，同伴也依照自己的判断调整位置，场景因此继续向前而不是回到原点。`);
    round += 1;
  }
  paragraphs.push(chapterNumber === 1
    ? '孩子获救后，烧焦账页上显出渡口编号，林澈带着仍在流血的手赶往河岸。'
    : chapterNumber === 2
      ? '空船撞上旧码头时，舱底滚出一枚钟楼铜齿，导师留下的敲击声却从城内再次响起。'
      : '钟声停下，排水图背面浮出导师亲笔留下的日期，而那一天正是明日。');
  return paragraphs.join('\n\n');
}

function buildTakeoverNovel(): string {
  const paragraphs: string[] = [];
  const sentence = '林澈沿着旧城石阶核对每一道刻痕，也让同伴守住退路；他没有接受陌生人的解释，而是用行动验证线索与时间。';
  while (countNovelCharacters(paragraphs.join('\n\n')) < 2_700) paragraphs.push(sentence);
  paragraphs.push('钟楼骤然亮起，窗后的人举起导师失踪前留下的钥匙，逼他在追击与救人之间立刻选择。');
  return paragraphs.join('\n\n');
}
