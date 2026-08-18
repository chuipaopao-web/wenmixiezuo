import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ContinuationAnalysisPipelineService } from '../../../apps/api/src/application/continuation/continuation-analysis-pipeline-service.js';
import { ExistingManuscriptContinuationService } from '../../../apps/api/src/application/continuation/existing-manuscript-continuation-service.js';
import { SettingCollaborationCommandService } from '../../../apps/api/src/application/knowledge/setting-collaboration-command-service.js';
import { SettingBaselineService } from '../../../apps/api/src/application/knowledge/setting-baseline-service.js';
import { SettingGuidanceService } from '../../../apps/api/src/application/knowledge/setting-guidance-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import type { ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import type { OpeningBlueprintInput } from '../../../apps/api/src/contracts/opening-blueprint.js';

describe('已有正文续写导入', () => {
  let context: TestContext | null = null;
  afterEach(() => { context?.close(); context = null; });

  it('预览不写业务章节，作者确认后逐章结算且可以安全重试', () => {
    context = createTestContext('wenmi-continuation-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '已有三万字' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new ExistingManuscriptContinuationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const source = '作者说明\n\n第一章 雨夜归来\n林昭推开旧门。\n\n第二章 缺页账本\n账本少了一页。';

    const preview = service.preview(scope, { sourceName: '旧稿.txt', text: source });
    expect(preview).toMatchObject({ status: 'parsed', sourceName: '旧稿.txt' });
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual(['前言', '第一章 雨夜归来', '第二章 缺页账本']);
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare('SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 0 });
    const persistedSource = context.database.prepare(`SELECT source_relative_path FROM continuation_imports
      WHERE owner_id = ? AND book_id = ? AND continuation_import_id = ?`)
      .get(scope.ownerId, scope.bookId, preview.importId) as { source_relative_path: string };
    expect(persistedSource.source_relative_path).toMatch(new RegExp(`^books/${scope.bookId}/continuation-imports/`));
    expect(existsSync(resolve(context.dataDir, persistedSource.source_relative_path))).toBe(true);
    const resumed = new ExistingManuscriptContinuationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    ).latest(scope);
    expect(resumed).toEqual(preview);

    const confirmation = preview.chapters.map((chapter) => ({
      importChapterId: chapter.importChapterId,
      title: chapter.title,
      included: chapter.title !== '前言'
    }));
    const ready = service.confirm(scope, preview.importId, { chapters: confirmation });
    expect(ready).toMatchObject({ status: 'ready', includedChapterCount: 2, importedChapterCount: 2, lastCompletedOrdinal: 3 });
    expect(ready.chapters.map((chapter) => ({ title: chapter.title, included: chapter.included, status: chapter.status }))).toEqual([
      { title: '前言', included: false, status: 'excluded' },
      { title: '第一章 雨夜归来', included: true, status: 'imported' },
      { title: '第二章 缺页账本', included: true, status: 'imported' }
    ]);
    expect(context.database.prepare(`SELECT chapter_number, title, settlement_status FROM chapters
      WHERE owner_id = ? AND book_id = ? ORDER BY chapter_number`).all(scope.ownerId, scope.bookId)).toEqual([
      { chapter_number: 1, title: '第一章 雨夜归来', settlement_status: 'settled' },
      { chapter_number: 2, title: '第二章 缺页账本', settlement_status: 'settled' }
    ]);
    expect(context.database.prepare(`SELECT creator_kind, model_provider, model_id, status, word_count
      FROM manuscript_versions WHERE owner_id = ? AND book_id = ? ORDER BY created_at, manuscript_version_id`)
      .all(scope.ownerId, scope.bookId)).toEqual([
        { creator_kind: 'import', model_provider: 'import', model_id: 'author-existing-manuscript', status: 'canon', word_count: 7 },
        { creator_kind: 'import', model_provider: 'import', model_id: 'author-existing-manuscript', status: 'canon', word_count: 7 }
      ]);
    expect(context.database.prepare('SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ canon_revision: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM canon_index_requests
      WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });

    const retried = service.confirm(scope, preview.importId, { chapters: confirmation });
    expect(retried).toEqual(ready);
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM chapters WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
  });

  it('禁止向已有章节的书再次导入整本前文', () => {
    context = createTestContext('wenmi-continuation-existing-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '已有章节的书' });
    const scope = { ownerId: context.config.ownerId, bookId: first.bookId };
    context.database.prepare(`INSERT INTO volumes (
      volume_id, owner_id, book_id, volume_number, title, status, created_at, updated_at
    ) VALUES ('manual-volume', ?, ?, 1, '正文', 'active', ?, ?)`)
      .run(scope.ownerId, scope.bookId, clock.now().toISOString(), clock.now().toISOString());
    context.database.prepare(`INSERT INTO chapters (
      chapter_id, owner_id, book_id, volume_id, chapter_number, title, plan_status,
      generation_status, settlement_status, created_at, updated_at
    ) VALUES ('manual-chapter', ?, ?, 'manual-volume', 1, '旧章', 'planned', 'not_started', 'unsettled', ?, ?)`)
      .run(scope.ownerId, scope.bookId, clock.now().toISOString(), clock.now().toISOString());
    const service = new ExistingManuscriptContinuationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    expect(() => service.preview(scope, { sourceName: '重复.txt', text: '第一章\n正文' }))
      .toThrow('不能再导入整本前文基线');
  });

  it('确认已有正文后逐章提炼续写基线，分析结果可恢复且不改写原文', async () => {
    context = createTestContext('wenmi-continuation-analysis-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '已有正文分析' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    context.database.prepare(`
      UPDATE tasks SET status = 'cancelled', cancel_requested = 1
      WHERE owner_id = ? AND book_id = ? AND status IN ('pending', 'queued')
    `).run(scope.ownerId, scope.bookId);
    const service = new ExistingManuscriptContinuationService(
      context.database, context.dataDir, context.config.releaseId, ids, clock
    );
    const preview = service.preview(scope, {
      sourceName: '前文.txt',
      text: '第一章 雨夜归来\n林昭推开旧门，发现失踪多年的账本。\n\n第二章 缺页账本\n账本少了一页，门外却留下陌生脚印。'
    });
    const ready = service.confirm(scope, preview.importId, {
      chapters: preview.chapters.map((chapter) => ({
        importChapterId: chapter.importChapterId,
        title: chapter.title,
        included: true
      }))
    });
    expect(ready.analysis).toMatchObject({ status: 'pending', analyzedChapterCount: 0, totalChapterCount: 2 });

    let modelCallCount = 0;
    const compactAnalysis = JSON.stringify({
      summary: '章节事实摘要',
      reverseOutline: {
        chapterGoal: '找回失踪账本',
        openingState: '人物回到旧居',
        plotBeats: ['发现账本线索'],
        cast: ['林昕'],
        centralConflict: '账本缺页且来源不明',
        emotionalArc: ['警觉', '疑惑'],
        payoffOrPressure: ['确认线索仍在'],
        threadActions: ['继续追查缺页'],
        descriptionFocus: ['旧居环境'],
        ending: { result: '发现新线索', hook: '门外脚印', nextChapterInterface: '追查来访者' }
      },
      characters: [],
      events: [],
      locations: [],
      relations: [],
      rules: [],
      resources: [],
      openThreads: [],
      resolvedThreads: [],
      styleEvidence: [],
      endingState: '人物掌握账本线索',
      conflicts: [],
      unknowns: []
    });
    const modelAdapters = {
      resolve(provider: string, modelId: string): ModelAdapter {
        return {
          provider,
          modelId,
          async generate() {
            modelCallCount += 1;
            return {
              provider,
              modelId,
              output: modelCallCount === 1 ? '{"summary":"truncated"' : compactAnalysis,
              inputTokens: 100,
              outputTokens: 100,
              cashCostCny: 0,
              state: 'succeeded'
            };
          }
        };
      }
    } as unknown as ModelAdapterFactory;
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const claim = tasks.claimNext('worker-continuation-analysis');
    expect(claim).toMatchObject({ taskType: 'continuation_analysis', assignedAgentId: expect.any(String) });
    await new ContinuationAnalysisPipelineService(
      context.database, context.dataDir, context.config.releaseId, ids, clock, modelAdapters
    ).executeClaimed(scope, claim!.taskId, 'worker-continuation-analysis', {
      leaseToken: claim!.leaseToken!,
      attemptNo: claim!.currentAttemptNo
    });
    expect(modelCallCount).toBe(3);

    const analyzed = service.get(scope, preview.importId);
    expect(analyzed.analysis).toMatchObject({
      status: 'ready',
      analyzedChapterCount: 2,
      totalChapterCount: 2,
      summary: expect.any(String),
      activeTaskId: null,
      errorMessage: null
    });
    expect(analyzed.analysis.structuredData).toMatchObject({
      sourceKind: 'author_existing_manuscript',
      authority: 'derived_from_confirmed_manuscript',
      chapterCount: 2,
      chapterSummaries: expect.arrayContaining([
        expect.objectContaining({ chapterNumber: 1, title: expect.stringContaining('第一章') }),
        expect.objectContaining({ chapterNumber: 2, title: expect.stringContaining('第二章') })
      ]),
      chapterOutlines: [
        expect.objectContaining({
          chapterNumber: 1,
          title: expect.stringContaining('第一章'),
          chapterGoal: expect.any(String),
          openingState: expect.any(String),
          plotBeats: expect.any(Array),
          cast: expect.any(Array),
          centralConflict: expect.any(String),
          emotionalArc: expect.any(Array),
          threadActions: expect.any(Array),
          ending: expect.objectContaining({
            result: expect.any(String),
            hook: expect.any(String),
            nextChapterInterface: expect.any(String)
          })
        }),
        expect.objectContaining({ chapterNumber: 2, title: expect.stringContaining('第二章') })
      ]
    });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM continuation_chapter_analyses
      WHERE owner_id = ? AND book_id = ? AND continuation_import_id = ? AND status = 'ready'`)
      .get(scope.ownerId, scope.bookId, preview.importId)).toEqual({ count: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions
      WHERE owner_id = ? AND book_id = ? AND creator_kind = 'import' AND status = 'canon'`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
    const importedHashes = context.database.prepare(`
      SELECT c.chapter_number, mv.content_hash, cic.content_hash AS imported_content_hash
      FROM manuscript_versions mv
      JOIN chapters c ON c.chapter_id = mv.chapter_id AND c.owner_id = mv.owner_id AND c.book_id = mv.book_id
      JOIN continuation_import_chapters cic ON cic.target_manuscript_version_id = mv.manuscript_version_id
      WHERE mv.owner_id = ? AND mv.book_id = ? AND mv.creator_kind = 'import'
      ORDER BY c.chapter_number
    `).all(scope.ownerId, scope.bookId) as Array<{ chapter_number: number; content_hash: string; imported_content_hash: string }>;
    expect(importedHashes.map((row) => row.chapter_number)).toEqual([1, 2]);
    expect(importedHashes.every((row) => row.content_hash === row.imported_content_hash)).toBe(true);

    const reverseOutlineArtifacts = context.database.prepare(`
      SELECT a.title, a.status, v.status AS version_status, v.content_json
      FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
      ORDER BY json_extract(v.content_json, '$.chapterNumber')
    `).all(scope.ownerId, scope.bookId) as Array<{
      title: string;
      status: string;
      version_status: string;
      content_json: string;
    }>;
    expect(reverseOutlineArtifacts).toHaveLength(2);
    expect(reverseOutlineArtifacts.map((row) => ({
      status: row.status,
      versionStatus: row.version_status,
      content: JSON.parse(row.content_json) as Record<string, unknown>
    }))).toEqual([
      expect.objectContaining({
        status: 'active',
        versionStatus: 'selected',
        content: expect.objectContaining({
          chapterNumber: 1,
          reverseOutlineSchema: 'reverse_chapter_outline_v1',
          sourceKind: 'author_existing_manuscript',
          planningAuthority: 'derived_reference',
          goal: expect.any(String),
          beats: expect.any(Array),
          hook: expect.any(String),
          cast: expect.any(Array),
          emotionalArc: expect.any(Array)
        })
      }),
      expect.objectContaining({
        status: 'active',
        versionStatus: 'selected',
        content: expect.objectContaining({
          chapterNumber: 2,
          reverseOutlineSchema: 'reverse_chapter_outline_v1'
        })
      })
    ]);

    const handoff = new SettingCollaborationCommandService(
      context.database, context.config.releaseId, ids, clock
    ).start(scope, 'story-kernel', { idempotencyKey: 'continuation-setting-start' });
    expect(handoff).toMatchObject({ status: 'queued', reused: false });
    const handoffBrief = JSON.parse((context.database.prepare(`SELECT task_brief_json FROM tasks WHERE task_id = ?`)
      .get(handoff.taskId) as { task_brief_json: string }).task_brief_json) as { scopeText: string };
    expect(handoffBrief.scopeText).toContain('作品定位摘要：创作方式：已有正文续写');
    expect(handoffBrief.scopeText).toContain('正文分析：已完成 2/2 章');
    expect(handoffBrief.scopeText).toContain('第一章');

    const guidance = new SettingGuidanceService(context.database, ids, clock).current(scope);
    expect(guidance).toMatchObject({
      itemKey: 'story-kernel',
      positioningSummary: expect.stringContaining('已有正文续写'),
      storyDirectionReference: expect.any(String)
    });
    const continuationBlueprint: OpeningBlueprintInput = {
      creationMode: 'continuation',
      taxonomyVersion: 'continuation-authority-test',
      channel: 'female',
      categoryKey: 'female-real-life',
      auxiliaryCategoryKeys: [],
      targetAudience: '',
      protagonists: [{
        role: 'female_lead',
        name: '林昭',
        age: '二十二岁',
        background: '开书时填写的软定位',
        personalities: ['冷静']
      }],
      storyDirection: '开书简介只作为后续方向参考',
      worldBackground: '',
      openingBackground: '',
      stageOne: { start: '', development: '', end: '' },
      fullBookOutline: '',
      mainTags: ['现实'],
      auxiliaryTags: ['悬疑恋爱'],
      storyTraits: [],
      customTags: [],
      initialMap: '',
      mustFollow: ['不得改写已发生正文']
    };
    const continuationGuidance = new SettingGuidanceService(context.database, ids, clock)
      .current(scope, continuationBlueprint);
    expect(continuationGuidance).toMatchObject({
      positioningSummary: expect.stringContaining('正文分析：已完成'),
      storyDirectionReference: expect.stringContaining('正文反向分析')
    });
    expect(continuationGuidance?.positioningSummary).toContain('已导入正文和反向章纲优先');
    expect(continuationGuidance?.storyDirectionReference).toContain('开书简介只作为后续方向参考');
    const readiness = new SettingBaselineService(context.database, ids, clock).inspect(scope);
    expect(readiness).toMatchObject({
      profileKey: 'continuation-reverse',
      ready: false,
      required: expect.arrayContaining(['story-kernel', 'world-stage', 'protagonist-situation', 'opposition', 'rules-costs', 'boundaries-blanks'])
    });

    const guidanceWorkflow = new SettingGuidanceService(context.database, ids, clock);
    let settingCompleted = false;
    for (let round = 0; round < 20; round += 1) {
      const current = guidanceWorkflow.current(scope);
      if (current === null) break;
      guidanceWorkflow.recordCandidate(scope, current.itemKey, JSON.stringify({
        fields: {
          workflowArtifact: {
            type: 'setting_outline',
            payload: {
              items: [{
                itemKey: current.itemKey,
                content: `${current.label}以已导入正文和逐章反向章纲为依据，不新增原文外事实。`
              }]
            }
          }
        }
      }));
      const confirmation = guidanceWorkflow.confirmCurrent(scope);
      if (confirmation.completed) {
        settingCompleted = true;
        break;
      }
    }
    expect(settingCompleted).toBe(true);
    expect(new SettingBaselineService(context.database, ids, clock).inspect(scope).ready).toBe(true);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type IN ('stage_outline_generation', 'conversation_reply')`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
  });

  it('HTTP入口完成预览和确认，反向整理未完成时不提前启动设定讨论', async () => {
    context = createTestContext('wenmi-continuation-api-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '接口续写书' });
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const previewResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${book.bookId}/continuation-imports/preview`,
        payload: { sourceName: '正文.txt', text: '第一章 开门\n门外有人。\n第二章 来客\n来客递上旧信。' }
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = previewResponse.json().data as {
        importId: string;
        chapters: Array<{ importChapterId: string; title: string; included: boolean }>;
      };
      const latestResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/books/${book.bookId}/continuation-imports/latest`
      });
      expect(latestResponse.statusCode).toBe(200);
      expect(latestResponse.json().data).toMatchObject({ importId: preview.importId, status: 'parsed' });
      const confirmResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${book.bookId}/continuation-imports/${preview.importId}/confirm`,
        payload: { chapters: preview.chapters.map((chapter) => ({ ...chapter, title: chapter.title })) }
      });
      expect(confirmResponse.statusCode).toBe(200);
      expect(confirmResponse.json().data).toMatchObject({ status: 'ready', importedChapterCount: 2 });
      const firstChapter = context.database.prepare(`SELECT chapter_id FROM chapters
        WHERE owner_id = ? AND book_id = ? AND chapter_number = 1`).get(context.config.ownerId, book.bookId) as { chapter_id: string };
      const content = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/chapters/${firstChapter.chapter_id}/content` });
      expect(content.statusCode).toBe(200);
      expect(content.json().data.content).toBe('门外有人。');

      const prematureStart = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${book.bookId}/setting-outline-workspace/story-kernel/collaboration/start`,
        payload: { idempotencyKey: 'continuation-premature-setting-start' }
      });
      expect(prematureStart.statusCode).toBe(409);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
        WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'`).get(context.config.ownerId, book.bookId)).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });
});
