import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { creationFallbackChain, parseVolumeOption, type PlanningTreeDocument, type PlanningTreeNode } from '@wenmi/v7-backend';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { ModelAdapterError } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import { V7CreationModelGateway } from '../../../apps/api/src/infrastructure/models/v7-creation-model-gateway.js';
import { V7CreationRuntimeRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-creation-runtime-repository.js';
import { V7PlanningTreeService } from '../../../apps/api/src/application/planning/v7-planning-tree-service.js';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { v7GenreProfileFixtureResult } from '../../helpers/v7-genre-profile-model-fixture.js';

const HEADERS = {
  host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site', 'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7全链路创作总线', () => {
  it('从确认全书树完成卷、链、章纲、正文定稿和四类写后维护，重复请求不重复生成', async () => {
    context = createTestContext('wenmi-v7-creation-pipeline-');
    const resolver = new CreationResolver(null, 3, true, 1);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'creation-owner@example.com', '创作作者');
      const otherCookie = await register(app, 'creation-other@example.com', '另一作者');
      const bookId = await createBook(app, cookie, '张三北宋行', 'creation-book-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      const trees = new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock());
      seedConfirmedBookTree(trees, ownerId, bookId);

      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '第一卷让张三靠自己的判断在军营站稳脚跟。', candidateCount: 3,
        idempotencyKey: 'creation-workflow-0001'
      });
      expect(created.statusCode).toBe(200);
      const workflowId = created.json().data.workflowId as string;
      const volumeReady = await pollWorkflow(app, cookie, bookId, workflowId, 'volume_decision');
      expect(volumeReady).toMatchObject({ status: 'waiting_for_you', completedOptions: 3, expectedOptions: 3, firstVolume: true });
      expect(volumeReady.options).toHaveLength(3);
      expect(new Set(volumeReady.options.map((item: { name: string }) => item.name)).size).toBe(3);
      expect(new Set(volumeReady.options.map((item: { memberName: string }) => item.memberName)).size).toBe(3);
      expect(volumeReady.options.map((item: { seat: string }) => item.seat)).toEqual(['方案一', '方案二', '方案三']);
      for (const option of volumeReady.options) {
        expect(option).toMatchObject({
          coreConflict: expect.any(String), protagonistChoice: expect.any(String), priceAndChange: expect.any(String)
        });
        expect(option.steps.length).toBeGreaterThan(0);
      }
      expect(volumeReady.chiefReview, JSON.stringify(volumeReady)).not.toBeNull();
      expect(volumeReady.chiefReview.recommendedOptionId).toBe(volumeReady.options[0].optionId);
      expect(JSON.stringify(volumeReady)).not.toMatch(/provider|modelId|prompt|hash|temperature|sourceFingerprint/iu);
      const firstVolumePackRow = context.database.prepare(`SELECT content_json FROM v7_creation_context_packs
        WHERE owner_id=? AND book_id=? AND workflow_id=? AND task_kind='volume' AND status='active'`)
        .get(ownerId, bookId, workflowId) as { content_json: string };
      const firstVolumePack = JSON.parse(firstVolumePackRow.content_json) as {
        contextPolicyVersion: string;
        characterCount: number;
        budgetChars: number;
        selectedSources: Array<{ sourceKey: string; content?: unknown }>;
        excludedSources: Array<{ sourceKey: string }>;
        sourceRefs: Array<{ sourceKind: string; sourceId: string; version: string }>;
      };
      expect(['layered-context-v2', 'layered-context-v3']).toContain(firstVolumePack.contextPolicyVersion);
      expect(firstVolumePack.budgetChars).toBe(12_000);
      expect(firstVolumePack).toMatchObject({
        taskPersona: expect.objectContaining({ workingIdentity: expect.any(String) }),
        taskResponsibilities: expect.arrayContaining([expect.any(String)]),
        creativeSpace: expect.arrayContaining([expect.any(String)]),
        methodPlan: expect.objectContaining({
          mode: 'combined', candidates: expect.arrayContaining([expect.objectContaining({ methodKey: expect.any(String) })])
        })
      });
      expect(firstVolumePack.characterCount).toBeLessThanOrEqual(firstVolumePack.budgetChars);
      expect(firstVolumePack.selectedSources.map((source) => source.sourceKey)).toEqual(expect.arrayContaining([
        'formal:opening', 'formal:setting-ledger', `formal:tree:book:${bookId}`
      ]));
      expect(firstVolumePack.selectedSources.some((source) => source.sourceKey.startsWith('goal:author-input'))).toBe(true);
      const bookDirection = firstVolumePack.selectedSources.find((source) => source.sourceKey === `formal:tree:book:${bookId}`);
      expect(bookDirection?.content).toMatchObject({
        schema: 'v7-planning-tree-context-projection-v2',
        designStrategy: {
          originalStrategies: [expect.objectContaining({ applicationNote: expect.any(String) })]
        }
      });
      expect(JSON.stringify(bookDirection?.content)).toContain('上层伏笔责任');
      expect(JSON.stringify(bookDirection?.content)).toContain('阶段内明确兑现');
      const settingLedger = firstVolumePack.selectedSources.find((source) => source.sourceKey === 'formal:setting-ledger');
      expect(['v7-compact-setting-ledger-v1', 'v7-setting-ledger-context-projection-v1'])
        .toContain((settingLedger?.content as { schema?: string } | undefined)?.schema);
      expect(JSON.stringify(settingLedger?.content)).toContain('world-stage');
      expect(firstVolumePack.excludedSources).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceKey: 'formal:setting:world-stage' })
      ]));
      expect(firstVolumePack.sourceRefs).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'setting', sourceId: expect.any(String), version: expect.any(String) })
      ]));
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_creation_model_calls
        WHERE owner_id=? AND book_id=? AND workflow_id=? AND run_kind='context'`)
        .get(ownerId, bookId, workflowId)).toEqual({ count: 1 });

      const replayCreated = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '第一卷让张三靠自己的判断在军营站稳脚跟。', candidateCount: 3,
        idempotencyKey: 'creation-workflow-0001'
      });
      expect(replayCreated.statusCode).toBe(200);
      expect(replayCreated.json().data.workflowId).toBe(workflowId);
      expect(count(context, 'v7_creation_options', ownerId, bookId)).toBe(3);

      const chosenVolume = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/options/choose`, {
          kind: 'volume', optionId: volumeReady.options[0].optionId, authorNote: '保留小人物主动选择。',
          idempotencyKey: 'creation-volume-choice-0001'
        });
      expect(chosenVolume.statusCode).toBe(200);
      expect(chosenVolume.json().data).toMatchObject({ treeKind: 'volume', scopeId: 'volume-1', nextStep: 'confirm_tree' });
      trees.confirmCandidate(ownerId, bookId, 'volume', 'volume-1', {
        expectedRevision: 1, idempotencyKey: 'creation-volume-tree-confirm-0001'
      });

      const chainStarted = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/continue-to-chain`, { chainScopeId: 'chain-1', candidateCount: 3 });
      expect(chainStarted.statusCode).toBe(200);
      const chainReady = await pollWorkflow(app, cookie, bookId, workflowId, 'chain_decision');
      expect(chainReady).toMatchObject({ status: 'waiting_for_you', chainScopeId: 'chain-1', completedOptions: 3 });
      expect(chainReady.options).toHaveLength(3);
      expect(new Set(chainReady.options.map((item: { memberName: string }) => item.memberName)).size).toBe(3);
      for (const option of chainReady.options) expect(option.steps.length).toBeGreaterThan(0);

      const chosenChain = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/options/choose`, {
          kind: 'chain', optionId: chainReady.options[0].optionId, authorNote: '',
          idempotencyKey: 'creation-chain-choice-0001'
        });
      expect(chosenChain.statusCode).toBe(200);
      trees.confirmCandidate(ownerId, bookId, 'chain', 'chain-1', {
        expectedRevision: 1, idempotencyKey: 'creation-chain-tree-confirm-0001'
      });

      const outlines = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/outlines`, {
          chapterStart: 1, maximumChapters: 4
        });
      expect(outlines.statusCode, JSON.stringify(outlines.json())).toBe(200);
      expect(outlines.json().data.candidates[0].content.chapters).toHaveLength(3);
      expect(outlines.json().data.candidates[0].review, JSON.stringify(outlines.json().data.candidates[0]))
        .toMatchObject({ passed: true });
      const sequenceId = outlines.json().data.candidates[0].candidateId as string;
      const outlineConfirmed = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/outlines/confirm`, {
          sequenceId, idempotencyKey: 'creation-outline-confirm-0001'
        });
      expect(outlineConfirmed.statusCode, JSON.stringify(outlineConfirmed.json())).toBe(200);
      expect(outlineConfirmed.json().data).toMatchObject({ status: 'confirmed', nextStep: 'manuscript' });

      const manuscript = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/manuscripts`, { chapterNumber: 1 });
      expect(manuscript.statusCode).toBe(200);
      expect(manuscript.json().data).toMatchObject({ lifecycle: 'reviewed', review: { passed: true } });
      const manuscriptVersionId = manuscript.json().data.manuscriptVersionId as string;
      const originalText = String((context.database.prepare(`SELECT content_text FROM v7_manuscript_versions
        WHERE owner_id=? AND book_id=? AND manuscript_version_id=?`).get(ownerId, bookId, manuscriptVersionId) as { content_text: string }).content_text);
      expect(Array.from(originalText).length).toBeGreaterThan(500);

      const finalized = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/manuscripts/finalize`, {
          manuscriptVersionId, idempotencyKey: 'creation-manuscript-finalize-0001'
        });
      expect(finalized.statusCode).toBe(200);
      expect(finalized.json().data).toMatchObject({ status: 'final', nextStep: 'settlement' });
      const finalizedAgain = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/manuscripts/finalize`, {
          manuscriptVersionId, idempotencyKey: 'creation-manuscript-finalize-0001'
      });
      expect(finalizedAgain.statusCode).toBe(200);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_formalization_outbox
        WHERE owner_id=? AND book_id=? AND workflow_id=? AND event_kind='settle_chapter'`)
        .get(ownerId, bookId, workflowId)).toEqual({ count: 1 });
      const sequenceLinks = context.database.prepare(`SELECT m.sequence_id AS manuscript_sequence_id,o.sequence_id AS outline_sequence_id
        FROM v7_manuscript_versions m JOIN v7_chapter_outline_sequences o
          ON o.owner_id=m.owner_id AND o.book_id=m.book_id AND o.chain_scope_id='chain-1' AND o.lifecycle='confirmed'
        WHERE m.owner_id=? AND m.book_id=? AND m.manuscript_version_id=?`).get(ownerId, bookId, manuscriptVersionId) as {
          manuscript_sequence_id: string; outline_sequence_id: string;
        };
      expect(sequenceLinks.manuscript_sequence_id).toBe(sequenceLinks.outline_sequence_id);

      const creationLibrary = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/creation-library`);
      expect(creationLibrary.statusCode).toBe(200);
      expect(creationLibrary.json().data.volumes[0]).toMatchObject({
        volumeScopeId: 'volume-1',
        chains: [expect.objectContaining({
          chainScopeId: 'chain-1',
          outline: expect.objectContaining({
            chapters: expect.arrayContaining([expect.objectContaining({
              chapter: expect.objectContaining({ chapterNumber: 1 }),
              manuscript: expect.objectContaining({ manuscriptVersionId, status: 'final' })
            })])
          })
        })]
      });
      expect(JSON.stringify(creationLibrary.json().data)).not.toContain(originalText);

      const readManuscript = await request(app, cookie, 'GET',
        `/api/v1/v7/books/${bookId}/manuscripts/${manuscriptVersionId}`);
      expect(readManuscript.statusCode).toBe(200);
      expect(readManuscript.json().data).toMatchObject({
        manuscriptVersionId, chapterNumber: 1, status: 'final', content: originalText
      });
      const crossOwnerRead = await request(app, otherCookie, 'GET',
        `/api/v1/v7/books/${bookId}/manuscripts/${manuscriptVersionId}`);
      expect(crossOwnerRead.statusCode).toBe(404);

      const writeBack = await pollWriteBack(app, cookie, bookId, workflowId, 4).catch((error: unknown) => {
        const rows = context!.database.prepare(`SELECT event_kind,status,error_message,attempt_count FROM v7_formalization_outbox
          WHERE owner_id=? AND book_id=? AND workflow_id=? ORDER BY created_at,event_kind`)
          .all(ownerId, bookId, workflowId);
        throw new Error(`${error instanceof Error ? error.message : String(error)}；审计：${JSON.stringify(rows)}`);
      });
      expect(writeBack).toMatchObject({ total: 4, completed: 4, failed: 0, unknown: 0 });
      expect(writeBack.tasks.every((item: { status: string }) => item.status === 'completed')).toBe(true);
      const afterFirstChapter = await request(app, cookie, 'GET',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}`);
      expect(afterFirstChapter.json().data).toMatchObject({
        stage: 'manuscript', status: 'waiting_for_you',
        progress: { completedChapters: 1, totalChapters: 3, nextChapterNumber: 2 }
      });

      for (const chapterNumber of [2, 3]) {
        const nextManuscript = await request(app, cookie, 'POST',
          `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/manuscripts`, { chapterNumber });
        expect(nextManuscript.statusCode, JSON.stringify(nextManuscript.json())).toBe(200);
        expect(nextManuscript.json().data).toMatchObject({ lifecycle: 'reviewed', review: { passed: true } });
        const nextVersionId = nextManuscript.json().data.manuscriptVersionId as string;
        const nextFinalized = await request(app, cookie, 'POST',
          `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/manuscripts/finalize`, {
            manuscriptVersionId: nextVersionId,
            idempotencyKey: `creation-manuscript-finalize-000${chapterNumber}`
          });
        expect(nextFinalized.statusCode).toBe(200);
        const nextWriteBack = await pollWriteBack(app, cookie, bookId, workflowId, chapterNumber * 4);
        expect(nextWriteBack).toMatchObject({
          total: chapterNumber * 4,
          completed: chapterNumber * 4,
          failed: 0,
          unknown: 0
        });
      }

      expect(count(context, 'v7_chapter_settlements', ownerId, bookId)).toBe(3);
      expect(count(context, 'v7_formalization_outbox', ownerId, bookId)).toBe(12);
      expect(count(context, 'stage_settlements', ownerId, bookId)).toBe(4);
      expect(count(context, 'v7_creation_stage_settlements', ownerId, bookId)).toBe(1);
      expect(count(context, 'v7_creation_stage_jobs', ownerId, bookId)).toBe(1);
      expect(context.database.prepare(`SELECT settlement_kind,status FROM v7_creation_stage_jobs
        WHERE owner_id=? AND book_id=?`).all(ownerId, bookId))
        .toEqual([{ settlement_kind: 'chain', status: 'completed' }]);
      expect(count(context, 'v7_story_state_items', ownerId, bookId)).toBe(3);
      expect(count(context, 'v7_character_maintenance_runs', ownerId, bookId)).toBe(3);
      expect(count(context, 'v7_planning_maintenance_runs', ownerId, bookId)).toBe(3);
      expect((context.database.prepare(`SELECT count(*) AS count FROM v7_planning_model_calls
        WHERE owner_id=? AND book_id=? AND run_kind='maintenance'`).get(ownerId, bookId) as { count: number }).count).toBe(0);
      expect((context.database.prepare(`SELECT count(*) AS count FROM v7_creation_model_calls
        WHERE owner_id=? AND book_id=? AND run_kind='context' AND node_key LIKE 'settlement:%'`).get(ownerId, bookId) as { count: number }).count).toBe(3);
      const contextTaskKinds = context.database.prepare(`SELECT DISTINCT task_kind FROM v7_creation_context_packs
        WHERE owner_id=? AND book_id=? AND status='active' ORDER BY task_kind`).all(ownerId, bookId) as Array<{ task_kind: string }>;
      expect(contextTaskKinds.map((item) => item.task_kind)).toEqual([
        'chain', 'manuscript', 'outline', 'review', 'settlement', 'volume'
      ]);
      const activeContextPacks = Number((context.database.prepare(`SELECT COUNT(*) AS count FROM v7_creation_context_packs
        WHERE owner_id=? AND book_id=? AND status='active'`).get(ownerId, bookId) as { count: number }).count);
      const successfulContextCalls = Number((context.database.prepare(`SELECT COUNT(*) AS count FROM v7_creation_model_calls
        WHERE owner_id=? AND book_id=? AND run_kind='context' AND state='succeeded'`).get(ownerId, bookId) as { count: number }).count);
      expect(successfulContextCalls).toBe(activeContextPacks);
      expect(context.database.prepare(`SELECT DISTINCT purpose FROM v7_creation_model_calls
        WHERE owner_id=? AND book_id=? AND run_kind='settlement'`).all(ownerId, bookId))
        .toEqual([{ purpose: 'novel_reviewer' }]);
      expect(context.database.prepare(`SELECT lifecycle,content_text FROM v7_manuscript_versions
        WHERE owner_id=? AND book_id=? AND manuscript_version_id=?`).get(ownerId, bookId, manuscriptVersionId))
        .toEqual({ lifecycle: 'final', content_text: originalText });

      const storyState = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/story-state`);
      expect(storyState.statusCode).toBe(200);
      expect(storyState.json().data.map((item: { kind: string }) => item.kind).sort())
        .toEqual(['foreshadowing', 'open_question', 'story_line']);
      expect(JSON.stringify(storyState.json().data)).not.toMatch(/source_settlement|content_json|evidence_refs_json/iu);
      const completedWorkflow = await request(app, cookie, 'GET',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}`);
      expect(completedWorkflow.json().data).toMatchObject({
        stage: 'completed', status: 'completed',
        progress: { completedChapters: 3, totalChapters: 3, nextChapterNumber: null },
        volumeComplete: false
      });
      expect(completedWorkflow.json().data.remainingChains).toEqual([
        expect.objectContaining({ scopeId: 'chain-2' })
      ]);

      const nextChain = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/continue-to-next-chain`, {
          chainScopeId: 'chain-2', candidateCount: 3, idempotencyKey: 'creation-next-chain-0001'
        });
      expect(nextChain.statusCode).toBe(200);
      expect(nextChain.json().data).toMatchObject({ volumeComplete: false, workflow: { chainScopeId: 'chain-2' } });
      const childWorkflowId = nextChain.json().data.workflow.workflowId as string;
      const nextChainReady = await pollWorkflow(app, cookie, bookId, childWorkflowId, 'chain_decision');
      expect(nextChainReady).toMatchObject({ status: 'waiting_for_you', chainScopeId: 'chain-2', completedOptions: 3 });
      const replayNextChain = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/continue-to-next-chain`, {
          chainScopeId: 'chain-2', candidateCount: 3, idempotencyKey: 'creation-next-chain-0001'
        });
      expect(replayNextChain.json().data.workflow.workflowId).toBe(childWorkflowId);

      const chosenSecondChain = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${childWorkflowId}/options/choose`, {
          kind: 'chain', optionId: nextChainReady.options[0].optionId, authorNote: '',
          idempotencyKey: 'creation-chain-choice-0002'
        });
      expect(chosenSecondChain.statusCode).toBe(200);
      trees.confirmCandidate(ownerId, bookId, 'chain', 'chain-2', {
        expectedRevision: 1, idempotencyKey: 'creation-chain-tree-confirm-0002'
      });
      const secondOutlines = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${childWorkflowId}/outlines`, { maximumChapters: 4 });
      expect(secondOutlines.statusCode, secondOutlines.body).toBe(200);
      expect(secondOutlines.json().data.candidates[0].content).toMatchObject({ chapterStart: 4, chapterEnd: 6 });
      const secondSequenceId = secondOutlines.json().data.candidates[0].candidateId as string;
      expect((await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${childWorkflowId}/outlines/confirm`, {
          sequenceId: secondSequenceId, idempotencyKey: 'creation-outline-confirm-0002'
        })).statusCode).toBe(200);
      const managed = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${childWorkflowId}/managed/activate`, {});
      expect(managed.statusCode).toBe(200);
      expect(managed.json().data.execution).toMatchObject({ mode: 'managed', status: 'active' });
      const completedVolume = await pollVolumeCompletion(app, cookie, bookId, childWorkflowId);
      expect(completedVolume).toMatchObject({
        stage: 'completed', status: 'completed', volumeComplete: true,
        execution: { mode: 'managed', status: 'completed' }
      });
      expect(count(context, 'v7_chapter_settlements', ownerId, bookId)).toBe(6);
      expect(count(context, 'stage_settlements', ownerId, bookId)).toBe(9);
      expect(count(context, 'v7_creation_stage_settlements', ownerId, bookId)).toBe(3);
      expect(count(context, 'v7_creation_stage_jobs', ownerId, bookId)).toBe(3);

      const isolated = await request(app, otherCookie, 'GET',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}`);
      expect(isolated.statusCode).toBe(404);
      expect(resolver.prompts.filter((prompt) => prompt.includes('你是文秘写作主笔'))).toHaveLength(7);
      expect(resolver.prompts.filter((prompt) => prompt.includes('你是文秘写作结算编辑'))).toHaveLength(6);
      const creationCallCount = Number((context.database.prepare(`SELECT COUNT(*) AS count
        FROM v7_creation_model_calls WHERE owner_id=? AND book_id=?`).get(ownerId, bookId) as {
          count: number;
        }).count);
      const creationManifests = context.database.prepare(`SELECT manifest.task_kind,COUNT(*) AS count
        FROM v7_prompt_manifests manifest
        INNER JOIN v7_creation_model_calls model_call
          ON model_call.owner_id=manifest.owner_id
          AND model_call.book_id=manifest.book_id
          AND model_call.request_id=manifest.task_id
          AND model_call.prompt_hash=manifest.compiled_prompt_hash
        WHERE manifest.owner_id=? AND manifest.book_id=?
        GROUP BY manifest.task_kind ORDER BY manifest.task_kind`).all(ownerId, bookId) as unknown as Array<{
          task_kind: string;
          count: number;
        }>;
      expect(creationManifests.reduce((total, row) => total + row.count, 0)).toBe(creationCallCount);
      expect(creationManifests.map((row) => row.task_kind)).toEqual(expect.arrayContaining([
        'chapter_outline',
        'manuscript',
        'manuscript_review',
        'planning_review',
        'planning_tree',
        'settlement'
      ]));
      const repairContracts = context.database.prepare(`SELECT contract.task_id,contract.based_on_task_id,
          prior.owner_id AS prior_owner_id,prior.book_id AS prior_book_id,prior.workflow_id AS prior_workflow_id,prior.state AS prior_state
        FROM v7_task_contracts contract
        INNER JOIN v7_creation_model_calls current_call ON current_call.request_id=contract.task_id
        INNER JOIN v7_creation_model_calls prior ON prior.request_id=contract.based_on_task_id
        WHERE contract.owner_id=? AND contract.book_id=? AND current_call.workflow_id=?
          AND current_call.run_kind='manuscript' AND contract.operation_mode='repair'`)
        .all(ownerId, bookId, workflowId) as unknown as Array<Record<string, unknown>>;
      expect(repairContracts).toHaveLength(1);
      expect(repairContracts[0]).toMatchObject({
        prior_owner_id: ownerId, prior_book_id: bookId, prior_workflow_id: workflowId, prior_state: 'succeeded'
      });
      expect(String(repairContracts[0]!.based_on_task_id)).toMatch(/^creation-manuscript:/u);
      const outlinePackRow = context.database.prepare(`SELECT candidate_sources_json,content_json
        FROM v7_creation_context_packs
        WHERE owner_id=? AND book_id=? AND workflow_id=? AND task_kind='outline' AND status='active'
        ORDER BY created_at LIMIT 1`).get(ownerId, bookId, workflowId) as {
          candidate_sources_json: string;
          content_json: string;
        };
      const outlinePack = JSON.parse(outlinePackRow.content_json) as {
        selectedSources: Array<{ sourceKey: string }>;
        excludedSources: Array<{ sourceKey: string }>;
        contextPolicyVersion: string;
        characterCount: number;
        budgetChars: number;
      };
      const outlineCandidates = JSON.parse(outlinePackRow.candidate_sources_json) as Array<{
        sourceKey: string;
        sourceId: string;
        sourceVersion: string;
        contentHash: string;
      }>;
      expect(outlinePack.selectedSources.length).toBeGreaterThan(0);
      expect(outlinePack.excludedSources.length).toBeGreaterThan(0);
      expect(['layered-context-v2', 'layered-context-v3']).toContain(outlinePack.contextPolicyVersion);
      expect(outlinePack.budgetChars).toBe(6_000);
      expect(outlinePack.characterCount).toBeLessThanOrEqual(outlinePack.budgetChars);
      expect(outlinePack.selectedSources.some((source) => source.sourceKey === 'formal:setting-ledger')).toBe(true);
      expect(outlineCandidates.some((source) => source.sourceKey === 'formal:settings')).toBe(false);
      const outlineCall = context.database.prepare(`SELECT request_id FROM v7_creation_model_calls
        WHERE owner_id=? AND book_id=? AND workflow_id=? AND run_kind='outline' AND state='succeeded'
        ORDER BY started_at LIMIT 1`).get(ownerId, bookId, workflowId) as { request_id: string };
      const outlineSourceTraces = context.database.prepare(`SELECT pack.owner_id,pack.book_id,
          source.source_key,source.source_id,source.source_version,source.content_hash,source.decision,source.reason
        FROM v7_context_pack_traces pack
        INNER JOIN v7_context_source_traces source ON source.context_pack_id=pack.context_pack_id
        WHERE pack.task_id=? ORDER BY source.sequence`).all(outlineCall.request_id) as unknown as Array<{
          owner_id: string;
          book_id: string;
          source_key: string;
          source_id: string;
          source_version: string;
          content_hash: string;
          decision: 'included' | 'excluded';
          reason: string;
        }>;
      expect(outlineSourceTraces).toHaveLength(outlineCandidates.length);
      expect(outlineSourceTraces.every((trace) => trace.owner_id === ownerId && trace.book_id === bookId)).toBe(true);
      expect(outlineSourceTraces.filter((trace) => trace.decision === 'included').map((trace) => trace.source_key).sort())
        .toEqual(outlinePack.selectedSources.map((source) => source.sourceKey).sort());
      expect(outlineSourceTraces.filter((trace) => trace.decision === 'excluded').map((trace) => trace.source_key).sort())
        .toEqual(outlinePack.excludedSources.map((source) => source.sourceKey).sort());
      for (const candidate of outlineCandidates) {
        expect(outlineSourceTraces.find((trace) => trace.source_key === candidate.sourceKey)).toMatchObject({
          source_id: candidate.sourceId,
          source_version: candidate.sourceVersion,
          content_hash: candidate.contentHash
        });
      }
      expect(outlineSourceTraces.filter((trace) => trace.decision === 'included')
        .every((trace) => trace.reason.length > 0)).toBe(true);
      expect(outlineSourceTraces.filter((trace) => trace.decision === 'excluded')
        .every((trace) => trace.reason.includes('资料策划'))).toBe(true);
      if (process.env.WENMI_CAPTURE_V7_TEST_BOOK === '1') {
        const outputDirectory = resolve('artifacts/v7-commercial-closure');
        mkdirSync(outputDirectory, { recursive: true });
        const chapters = context.database.prepare(`SELECT chapter_number,content_text,member_key,finalized_at
          FROM v7_manuscript_versions WHERE owner_id=? AND book_id=? AND lifecycle='final' ORDER BY chapter_number`).all(ownerId, bookId);
        writeFileSync(resolve(outputDirectory, 'full-volume-test-book.json'), `${JSON.stringify({
          evidenceKind: 'deterministic-full-volume-integration',
          title: '张三北宋行', volume: '第一卷：小卒立足', chainCount: 2, chapterCount: 6,
          chapterSettlementCount: count(context, 'v7_chapter_settlements', ownerId, bookId),
          formalizationCount: count(context, 'v7_formalization_outbox', ownerId, bookId),
          stageSettlementCount: count(context, 'v7_creation_stage_settlements', ownerId, bookId),
          storyStateCount: count(context, 'v7_story_state_items', ownerId, bookId),
          chapters
        }, null, 2)}\n`, 'utf8');
      }
    } finally {
      await app.close();
    }
  });

  it('一名编剧请假时保留另外两套方案，恢复后只补失败席再交由主编比较', async () => {
    context = createTestContext('wenmi-v7-creation-partial-options-');
    const resolver = new CreationResolver('glm-5.3');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'creation-partial@example.com', '部分方案作者');
      const bookId = await createBook(app, cookie, '张三北宋行', 'creation-book-partial-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      seedConfirmedBookTree(new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock()), ownerId, bookId);

      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '第一卷先让张三立足。', candidateCount: 3, idempotencyKey: 'creation-workflow-partial-0001'
      });
      const workflowId = created.json().data.workflowId as string;
      const partial = await pollIncompleteOptions(app, cookie, bookId, workflowId, 2);
      expect(partial).toMatchObject({ stage: 'volume_options', completedOptions: 2, expectedOptions: 3, status: 'partially_failed' });
      expect(partial.options).toHaveLength(2);
      expect(partial.chiefReview).toBeNull();
      expect(partial.errorMessage).toContain('已完成方案不会重做');
      const preservedOptionIds = partial.options.map((option: { optionId: string }) => option.optionId);

      resolver.resumePromptFailures();
      const retried = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/options/retry`, {});
      expect(retried.statusCode).toBe(200);
      const ready = await pollWorkflow(app, cookie, bookId, workflowId, 'volume_decision');
      expect(ready).toMatchObject({ completedOptions: 3, expectedOptions: 3, status: 'waiting_for_you' });
      expect(ready.options).toHaveLength(3);
      expect(ready.chiefReview).not.toBeNull();
      expect(ready.options.map((option: { optionId: string }) => option.optionId)).toEqual(
        expect.arrayContaining(preservedOptionIds)
      );
      expect(new Set(ready.options.map((item: { memberName: string }) => item.memberName)).size).toBe(3);
      expect(context.database.prepare(`SELECT DISTINCT contract.operation_mode,contract.based_on_task_id
        FROM v7_task_contracts contract
        INNER JOIN v7_creation_model_calls call ON call.request_id=contract.task_id
        WHERE call.owner_id=? AND call.book_id=? AND call.workflow_id=? AND call.run_kind='option'`)
        .all(ownerId, bookId, workflowId)).toEqual([
        { operation_mode: 'fresh', based_on_task_id: null }
      ]);
    } finally {
      await app.close();
    }
  });

  it('方案树结构不合同时只由原编剧低温修复，不让另一名成员重写同一席', async () => {
    context = createTestContext('wenmi-v7-creation-option-repair-');
    const resolver = new CreationResolver(null, 0, false, 0, 1);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'creation-option-repair@example.com', '方案修复作者');
      const bookId = await createBook(app, cookie, '方案结构修复书', 'creation-book-option-repair-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      seedConfirmedBookTree(new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock()), ownerId, bookId);
      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '先让主角活下来。', candidateCount: 3, idempotencyKey: 'creation-option-repair-workflow-0001'
      });
      const workflowId = created.json().data.workflowId as string;
      const ready = await pollWorkflow(app, cookie, bookId, workflowId, 'volume_decision');
      expect(ready.options).toHaveLength(3);
      expect(new Set(ready.options.map((option: { memberName: string }) => option.memberName)).size).toBe(3);
      const lineage = context.database.prepare(`SELECT call.request_id,call.node_key,call.member_key,
          contract.operation_mode,contract.based_on_task_id
        FROM v7_creation_model_calls call
        INNER JOIN v7_task_contracts contract ON contract.task_id=call.request_id
        WHERE call.owner_id=? AND call.book_id=? AND call.workflow_id=? AND call.run_kind='option'
        ORDER BY call.started_at`).all(ownerId, bookId, workflowId) as unknown as Array<{
          request_id: string; node_key: string; member_key: string; operation_mode: string; based_on_task_id: string | null;
        }>;
      const repair = lineage.find((call) => call.operation_mode === 'repair');
      expect(repair).toBeDefined();
      const original = lineage.find((call) => call.request_id === repair!.based_on_task_id);
      expect(original).toBeDefined();
      expect(repair).toMatchObject({ member_key: original!.member_key });
      expect(lineage.filter((call) => call.node_key.includes(':option_1'))
        .every((call) => call.member_key === original!.member_key)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('主编点评使用其他审查格式时只由原主编转换合同', async () => {
    context = createTestContext('wenmi-v7-creation-review-repair-');
    const resolver = new CreationResolver(null, 0, false, 0, 0, 1);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'creation-review-repair@example.com', '点评修复作者');
      const bookId = await createBook(app, cookie, '点评格式修复书', 'creation-book-review-repair-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      seedConfirmedBookTree(new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock()), ownerId, bookId);
      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '第一卷先让主角活下来。', candidateCount: 3, idempotencyKey: 'creation-review-repair-workflow-0001'
      });
      const workflowId = created.json().data.workflowId as string;
      const ready = await pollWorkflow(app, cookie, bookId, workflowId, 'volume_decision');
      expect(ready.chiefReview).not.toBeNull();
      const lineage = context.database.prepare(`SELECT call.request_id,call.member_key,contract.operation_mode,contract.based_on_task_id
        FROM v7_creation_model_calls call INNER JOIN v7_task_contracts contract ON contract.task_id=call.request_id
        WHERE call.owner_id=? AND call.book_id=? AND call.workflow_id=? AND call.run_kind='option_review'
        ORDER BY call.started_at`).all(ownerId, bookId, workflowId) as unknown as Array<{
          request_id: string; member_key: string; operation_mode: string; based_on_task_id: string | null;
        }>;
      expect(lineage).toHaveLength(2);
      expect(lineage[1]).toMatchObject({ operation_mode: 'repair', member_key: lineage[0]!.member_key, based_on_task_id: lineage[0]!.request_id });
    } finally {
      await app.close();
    }
  });

  it('三套方案已齐但主编点评失败时可以原地续跑点评', async () => {
    context = createTestContext('wenmi-v7-creation-review-resume-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new CreationResolver() });
    try {
      const cookie = await register(app, 'creation-review-resume@example.com', '点评续跑作者');
      const bookId = await createBook(app, cookie, '点评续跑书', 'creation-book-review-resume-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      seedConfirmedBookTree(new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock()), ownerId, bookId);
      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '第一卷先让主角活下来。', candidateCount: 3, idempotencyKey: 'creation-review-resume-workflow-0001'
      });
      const workflowId = created.json().data.workflowId as string;
      const ready = await pollWorkflow(app, cookie, bookId, workflowId, 'volume_decision');
      expect(ready.options).toHaveLength(3);
      context.database.prepare('DELETE FROM v7_creation_option_reviews WHERE owner_id=? AND book_id=? AND workflow_id=? AND option_kind=?')
        .run(ownerId, bookId, workflowId, 'volume');
      context.database.prepare(`UPDATE v7_creation_workflows SET stage='volume_options',status='failed',error_message=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND workflow_id=?`)
        .run('对不起，这次没有完成。主编点评格式无效', new FixedClock().now().toISOString(), ownerId, bookId, workflowId);

      const retried = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/options/retry`, {});
      expect(retried.statusCode).toBe(200);
      expect(retried.json().data).toMatchObject({ status: 'waiting', completedOptions: 3, chiefReview: null });
      const resumed = await pollWorkflow(app, cookie, bookId, workflowId, 'volume_decision');
      expect(resumed).toMatchObject({ status: 'waiting_for_you', completedOptions: 3 });
      expect(resumed.chiefReview).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('主编点评格式不合同时只修复点评并保留三套方案', async () => {
    context = createTestContext('wenmi-v7-creation-option-redesign-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new RewriteOnceReviewResolver() });
    try {
      const cookie = await register(app, 'creation-option-redesign@example.com', '方案重做作者');
      const bookId = await createBook(app, cookie, '方案重做书', 'creation-book-option-redesign-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      seedConfirmedBookTree(new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock()), ownerId, bookId);
      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '第一卷先让主角活下来。', candidateCount: 3, idempotencyKey: 'creation-option-redesign-workflow-0001'
      });
      const workflowId = created.json().data.workflowId as string;
      const ready = await pollWorkflow(app, cookie, bookId, workflowId, 'volume_decision');
      expect(ready).toMatchObject({ status: 'waiting_for_you', completedOptions: 3, optionRevision: null });
      expect(ready.options).toHaveLength(3);
      expect(ready.chiefReview).not.toBeNull();
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_creation_options
        WHERE owner_id=? AND book_id=? AND workflow_id=?`).get(ownerId, bookId, workflowId)).toEqual({ count: 3 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_creation_model_calls
        WHERE owner_id=? AND book_id=? AND workflow_id=? AND run_kind='option_review'`)
        .get(ownerId, bookId, workflowId)).toEqual({ count: 2 });
    } finally {
      await app.close();
    }
  });

  it('作者不能把同一位编剧同时安排到两套方案', async () => {
    context = createTestContext('wenmi-v7-creation-distinct-writers-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new CreationResolver() });
    try {
      const cookie = await register(app, 'creation-distinct@example.com', '不同编剧作者');
      const bookId = await createBook(app, cookie, '张三北宋行', 'creation-book-distinct-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      seedConfirmedBookTree(new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock()), ownerId, bookId);
      const rosterResponse = await request(app, cookie, 'GET', '/api/v1/v7/editorial/creation-members');
      expect(rosterResponse.statusCode).toBe(200);
      const roster = rosterResponse.json().data as Array<{ memberKey: string; name: string; roleKey: string }>;
      expect(roster.some((member) => ['structure_writer', 'commercial_writer', 'character_writer'].includes(member.roleKey))).toBe(false);
      expect(roster.some((member) => member.roleKey === 'outline_writer')).toBe(false);
      const planningMembers = roster.filter((member) => member.roleKey === 'planning_writer');
      expect(planningMembers).toHaveLength(3);
      expect(new Set(planningMembers.map((member) => member.memberKey)).size).toBe(3);
      const first = planningMembers[0]!;

      const rejected = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '第一卷先让张三立足。', candidateCount: 3,
        memberPreferences: {
          option_1: first.memberKey,
          option_2: first.memberKey
        },
        idempotencyKey: 'creation-workflow-distinct-0001'
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().error.message).toContain('不同成员');
    } finally {
      await app.close();
    }
  });

  it('方案优势和风险的原义字符串只做无损容器归一', () => {
    const output = JSON.parse(optionOutput('treeKind="volume"\nscopeId="volume-lossless"\n局势递进')) as Record<string, unknown>;
    output.strengths = '开篇抓力强；人物主动选择明确。';
    output.risks = '';
    const parsed = parseVolumeOption(JSON.stringify(output), 'volume-lossless');
    expect(parsed.strengths).toEqual(['开篇抓力强；人物主动选择明确。']);
    expect(parsed.risks).toEqual([]);
  });

  it('强模型技术失败时不让已成功成员伪装成第三套方案', async () => {
    context = createTestContext('wenmi-v7-creation-option-technical-cover-');
    const resolver = new GlmPlanningFailureResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'creation-cover@example.com', '补位测试作者');
      const bookId = await createBook(app, cookie, '强模型补位书', 'creation-book-cover-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      seedConfirmedBookTree(new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock()), ownerId, bookId);

      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '第一卷先让主角活下来。', candidateCount: 3, idempotencyKey: 'creation-cover-workflow-0001'
      });
      expect(created.statusCode).toBe(200);
      const workflowId = created.json().data.workflowId as string;
      const partial = await pollIncompleteOptions(app, cookie, bookId, workflowId, 2);
      expect(partial).toMatchObject({ status: 'partially_failed', completedOptions: 2, expectedOptions: 3 });
      expect(partial.options).toHaveLength(2);
      expect(new Set(partial.options.map((item: { memberKey: string }) => item.memberKey)).size).toBe(2);
      expect(partial.chiefReview).toBeNull();
      expect(context.database.prepare(`SELECT state FROM v7_creation_model_calls
        WHERE owner_id=? AND book_id=? AND workflow_id=? AND model_id='glm-5.3' AND run_kind='option'`)
        .get(ownerId, bookId, workflowId)).toEqual({ state: 'failed' });
      expect(context.database.prepare(`SELECT MAX(member_count) AS count FROM (
        SELECT COUNT(*) AS member_count FROM v7_creation_options
        WHERE owner_id=? AND book_id=? AND workflow_id=? GROUP BY member_key
      )`).get(ownerId, bookId, workflowId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('模型结果未知时保存检查点并阻止相同任务重复下单', async () => {
    context = createTestContext('wenmi-v7-creation-unknown-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'creation-unknown@example.com', '未知结果作者');
      const bookId = await createBook(app, cookie, '未知结果测试书', 'creation-book-unknown-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const workflowId = 'creation-workflow-unknown-0001';
      new V7CreationRuntimeRepository(context.database).createWorkflow({
        workflowId, ownerId, bookId, volumeScopeId: 'volume-1', firstVolume: true, authorGoal: null,
        idempotencyKey: 'creation-unknown-idempotency', requestHash: 'a'.repeat(64), now: new FixedClock().now().toISOString()
      });
      const resolver = new UnknownResolver();
      const gateway = new V7CreationModelGateway(context.database, resolver, new FixedClock());
      const requestInput = {
        requestId: 'creation-unknown-request-0001', ownerId, bookId, workflowId,
        runKind: 'outline' as const, nodeKey: 'chain-1', workstationKey: 'chapter_outline' as const,
        member: creationFallbackChain('outline_writer')[0]!,
        purpose: 'structured_planning' as const, operationMode: 'fresh' as const,
        basedOnTaskId: null, authorInstructionVersion: null, sourceTraces: [],
        prompt: '测试未知结果不得重复下单', maxOutputTokens: 1_000, temperature: 0.2
      };
      await expect(gateway.generate(requestInput)).rejects.toMatchObject({ outcomeUnknown: true });
      await expect(gateway.generate(requestInput)).rejects.toMatchObject({ outcomeUnknown: true });
      expect(requestInput.member.roleKey).toBe('planning_writer');
      expect(resolver.calls).toBe(1);
      expect(context.database.prepare('SELECT state FROM v7_creation_model_calls WHERE request_id=?')
        .get(requestInput.requestId)).toEqual({ state: 'unknown' });
      expect(context.database.prepare(`SELECT operation_mode,based_on_task_id,COUNT(*) AS count
        FROM v7_task_contracts WHERE owner_id=? AND book_id=? AND task_id=?`)
        .get(ownerId, bookId, requestInput.requestId)).toEqual({
        operation_mode: 'fresh', based_on_task_id: null, count: 1
      });

      const explicitDifferentMember = {
        ...requestInput,
        requestId: 'creation-unknown-request-0002',
        member: creationFallbackChain('planning_writer')[1]!,
        acknowledgedUnknownRequestId: requestInput.requestId
      };
      await expect(gateway.generate(explicitDifferentMember)).rejects.toMatchObject({ outcomeUnknown: true });
      expect(resolver.calls).toBe(2);
      expect(context.database.prepare('SELECT state,member_key FROM v7_creation_model_calls WHERE request_id=?')
        .get(explicitDifferentMember.requestId)).toEqual({
        state: 'unknown', member_key: explicitDifferentMember.member.memberKey
      });

      const repository = new V7CreationRuntimeRepository(context.database);
      const recoveredAt = '2026-07-16T00:00:01.000Z';
      repository.beginModelCall({
        requestId: 'creation-unknown-request-0003', ownerId, bookId, workflowId,
        runKind: requestInput.runKind, nodeKey: requestInput.nodeKey,
        memberKey: creationFallbackChain('planning_writer')[2]!.memberKey,
        provider: 'test', modelId: 'recovery-model', plan: 'agent', purpose: 'structured_planning',
        promptHash: 'f'.repeat(64), reservedTokens: 1_000, governanceRevision: 1, temperature: 0.2, now: recoveredAt
      });
      repository.completeModelCall({
        requestId: 'creation-unknown-request-0003', inputTokens: 10, outputTokens: 10,
        cashMicros: 0, outputText: '{"recovered":true}', now: recoveredAt
      });
      await expect(gateway.generate({
        ...requestInput,
        requestId: 'creation-unknown-request-0004',
        member: creationFallbackChain('planning_writer')[0]!
      })).rejects.toMatchObject({ outcomeUnknown: true });
      expect(resolver.calls).toBe(3);
    } finally {
      await app.close();
    }
  });

  it('节点名称不能改写显式操作模式或工位，修复血缘只接受真实模型任务', async () => {
    context = createTestContext('wenmi-v7-creation-explicit-lineage-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'creation-lineage@example.com', '血缘测试作者');
      const bookId = await createBook(app, cookie, '显式创作血缘', 'creation-book-lineage-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const workflowId = 'creation-workflow-lineage-0001';
      new V7CreationRuntimeRepository(context.database).createWorkflow({
        workflowId, ownerId, bookId, volumeScopeId: 'volume-1', firstVolume: true, authorGoal: null,
        idempotencyKey: 'creation-lineage-idempotency', requestHash: 'd'.repeat(64), now: new FixedClock().now().toISOString()
      });
      const resolver = new LineageResolver();
      const gateway = new V7CreationModelGateway(context.database, resolver, new FixedClock());
      const member = creationFallbackChain('planning_writer')[0]!;
      const firstTaskId = 'creation-lineage-fresh-0001';
      await gateway.generate({
        requestId: firstTaskId, ownerId, bookId, workflowId, runKind: 'option',
        nodeKey: 'chain:repair:fusion:revise', workstationKey: 'volume', member,
        purpose: 'structured_planning', operationMode: 'fresh', basedOnTaskId: null,
        authorInstructionVersion: null, sourceTraces: [], prompt: '设计本卷明确方向。',
        maxOutputTokens: 1_000, temperature: 0.2
      });
      const repairTaskId = 'creation-lineage-repair-0001';
      await gateway.generate({
        requestId: repairTaskId, ownerId, bookId, workflowId, runKind: 'option',
        nodeKey: 'ordinary-volume-node', workstationKey: 'chain', member,
        purpose: 'structured_planning', operationMode: 'repair', basedOnTaskId: firstTaskId,
        authorInstructionVersion: null, sourceTraces: [], prompt: '修复上一项任务的结构化输出。',
        maxOutputTokens: 1_000, temperature: 0.2
      });

      const contracts = context.database.prepare(`SELECT task_id,workstation_key,operation_mode,based_on_task_id,author_instruction_version
        FROM v7_task_contracts WHERE owner_id=? AND book_id=? AND task_id IN (?,?) ORDER BY task_id`)
        .all(ownerId, bookId, firstTaskId, repairTaskId);
      expect(contracts).toEqual([
        { task_id: firstTaskId, workstation_key: 'volume', operation_mode: 'fresh', based_on_task_id: null, author_instruction_version: null },
        { task_id: repairTaskId, workstation_key: 'chain', operation_mode: 'repair', based_on_task_id: firstTaskId, author_instruction_version: null }
      ]);
      expect(context.database.prepare(`SELECT source_key,decision FROM v7_context_source_traces source
        INNER JOIN v7_context_pack_traces pack ON pack.context_pack_id=source.context_pack_id
        WHERE pack.task_id=? ORDER BY source.sequence`).all(firstTaskId)).toEqual([
        { source_key: 'stage-task-payload', decision: 'included' }
      ]);

      await expect(gateway.generate({
        requestId: 'creation-lineage-fake-base-0001', ownerId, bookId, workflowId, runKind: 'option',
        nodeKey: 'repair', workstationKey: 'volume', member, purpose: 'structured_planning',
        operationMode: 'repair', basedOnTaskId: 'manuscript-version-is-not-a-task',
        authorInstructionVersion: null, sourceTraces: [], prompt: '不得把版本号伪装成任务号。',
        maxOutputTokens: 1_000, temperature: 0.2
      })).rejects.toThrow('原模型任务不存在');
      await expect(gateway.generate({
        requestId: 'creation-lineage-fake-author-version-0001', ownerId, bookId, workflowId, runKind: 'option',
        nodeKey: 'revise', workstationKey: 'volume', member, purpose: 'structured_planning',
        operationMode: 'revise', basedOnTaskId: firstTaskId,
        authorInstructionVersion: 1, sourceTraces: [], prompt: '没有意见版本记录时不得伪造版本一。',
        maxOutputTokens: 1_000, temperature: 0.2
      })).rejects.toThrow('不能伪造作者意见版本');
      expect(resolver.calls).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('旧章纲岗位选择会转成固定策划编剧岗位', async () => {
    context = createTestContext('wenmi-v7-creation-outline-role-alias-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'creation-outline-alias@example.com', '章纲岗位作者');
      const bookId = await createBook(app, cookie, '章纲岗位测试书', 'creation-book-outline-alias-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const workflowId = 'creation-workflow-outline-alias-0001';
      new V7CreationRuntimeRepository(context.database).createWorkflow({
        workflowId, ownerId, bookId, volumeScopeId: 'volume-1', firstVolume: true, authorGoal: null,
        idempotencyKey: 'creation-outline-alias-idempotency', requestHash: 'c'.repeat(64), now: new FixedClock().now().toISOString()
      });
      const rosterResponse = await request(app, cookie, 'GET', '/api/v1/v7/editorial/creation-members');
      const planner = (rosterResponse.json().data as Array<{ memberKey: string; roleKey: string }>)
        .find((member) => member.roleKey === 'planning_writer');
      expect(planner).toBeDefined();
      const selected = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/member`, {
        roleKey: 'outline_writer', memberKey: planner!.memberKey
      });
      expect(selected.statusCode).toBe(200);
      expect(context.database.prepare(`SELECT role_key,member_key FROM v7_creation_fixed_member_preferences
        WHERE owner_id=? AND book_id=? AND workflow_id=?`).all(ownerId, bookId, workflowId)).toEqual([
        { role_key: 'planning_writer', member_key: planner!.memberKey }
      ]);

      const now = new FixedClock().now().toISOString();
      const repository = new V7CreationRuntimeRepository(context.database);
      context.database.prepare(`INSERT INTO v7_creation_member_preferences(
        owner_id,book_id,workflow_id,role_key,member_key,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?)`).run(
        ownerId, bookId, workflowId, 'outline_writer', 'creation-outline-glm-5-3', now, now
      );
      expect(repository.memberPreference(ownerId, bookId, workflowId, 'planning_writer')).toMatchObject({
        role_key: 'planning_writer', member_key: planner!.memberKey
      });

      const legacyWorkflowId = 'creation-workflow-outline-legacy-0001';
      repository.createWorkflow({
        workflowId: legacyWorkflowId, ownerId, bookId, volumeScopeId: 'volume-1', firstVolume: true, authorGoal: null,
        idempotencyKey: 'creation-outline-legacy-idempotency', requestHash: 'd'.repeat(64), now
      });
      context.database.prepare(`INSERT INTO v7_creation_member_preferences(
        owner_id,book_id,workflow_id,role_key,member_key,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?)`).run(
        ownerId, bookId, legacyWorkflowId, 'outline_writer', 'creation-outline-glm-5-3', now, now
      );
      expect(repository.memberPreference(ownerId, bookId, legacyWorkflowId, 'planning_writer')).toMatchObject({
        role_key: 'planning_writer', member_key: 'creation-outline-glm-5-3'
      });
    } finally {
      await app.close();
    }
  });

  it('作者停止托管任务时生成幂等收据并保留已完成记录', async () => {
    context = createTestContext('wenmi-v7-creation-cancel-');
    const app = await createServer(context.config, context.database, {
      v7OpeningModelAdapters: new CreationResolver()
    });
    try {
      const cookie = await register(app, 'creation-cancel@example.com', '停止任务作者');
      const bookId = await createBook(app, cookie, '停止任务测试书', 'creation-book-cancel-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const workflowId = 'creation-workflow-cancel-0001';
      const repository = new V7CreationRuntimeRepository(context.database);
      repository.createWorkflow({
        workflowId, ownerId, bookId, volumeScopeId: 'volume-1', firstVolume: true, authorGoal: null,
        idempotencyKey: 'creation-cancel-setup', requestHash: 'b'.repeat(64), now: new FixedClock().now().toISOString()
      });
      repository.updateWorkflow({
        ownerId, bookId, workflowId, stage: 'manuscript', status: 'working',
        checkpoint: { completedChapters: 1, preservedResult: '第一章已完成' }, now: new FixedClock().now().toISOString()
      });
      repository.saveManagedRun({
        ownerId, bookId, workflowId, mode: 'managed', writerMemberKey: 'hongyu', reviewerMemberKey: 'zhaojun',
        now: new FixedClock().now().toISOString()
      });

      const stopped = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/cancel`, {
          reason: '先停一下，保留已经完成的内容。', idempotencyKey: 'creation-cancel-action-0001'
        });
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json().data).toMatchObject({
        status: 'cancelled', execution: { mode: 'managed', status: 'cancelled' }
      });
      expect(repository.workflow(ownerId, bookId, workflowId)?.checkpoint_json).toContain('第一章已完成');

      const replay = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/cancel`, {
          reason: '先停一下，保留已经完成的内容。', idempotencyKey: 'creation-cancel-action-0001'
        });
      expect(replay.statusCode).toBe(200);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_creation_task_controls
        WHERE owner_id=? AND book_id=? AND workflow_id=?`).get(ownerId, bookId, workflowId)).toEqual({ count: 1 });

      const resumed = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/managed/activate`, {});
      expect(resumed.statusCode).toBe(200);
      expect(resumed.json().data).toMatchObject({
        status: 'working', execution: { mode: 'managed', status: 'active' }
      });
      expect(repository.workflow(ownerId, bookId, workflowId)?.checkpoint_json).toContain('第一章已完成');
    } finally {
      await app.close();
    }
  });

  it('停止未完成子链后可以从已完成父链重新开始该链', async () => {
    context = createTestContext('wenmi-v7-creation-resume-cancelled-chain-');
    const app = await createServer(context.config, context.database, {
      v7OpeningModelAdapters: new CreationResolver()
    });
    try {
      const cookie = await register(app, 'creation-resume-chain@example.com', '续写单元链作者');
      const bookId = await createBook(app, cookie, '停止后续写测试书', 'creation-book-resume-chain-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      const trees = new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock());
      seedConfirmedBookTree(trees, ownerId, bookId);
      trees.saveGeneratedCandidate({
        ownerId, bookId, treeKind: 'volume', scopeId: 'volume-1', expectedRevision: 0,
        document: planningTree('volume', 'volume-1', [
          planningNode('volume-chain-1', 'chain', 1, '第一链', { treeKind: 'chain', scopeId: 'chain-1' }),
          planningNode('volume-chain-2', 'chain', 2, '第二链', { treeKind: 'chain', scopeId: 'chain-2' })
        ]),
        sourceRefs: [{ sourceKind: 'confirmed_tree', sourceId: bookId, version: '1' }],
        idempotencyKey: 'creation-resume-volume-candidate-0001', createdBy: 'test'
      });
      trees.confirmCandidate(ownerId, bookId, 'volume', 'volume-1', {
        expectedRevision: 1, idempotencyKey: 'creation-resume-volume-confirm-0001'
      });
      const repository = new V7CreationRuntimeRepository(context.database);
      const now = new FixedClock().now().toISOString();
      repository.createWorkflow({
        workflowId: 'creation-resume-parent-0001', ownerId, bookId, volumeScopeId: 'volume-1', firstVolume: true,
        authorGoal: null, idempotencyKey: 'creation-resume-parent-create-0001', requestHash: 'e'.repeat(64), now
      });
      repository.updateWorkflow({
        ownerId, bookId, workflowId: 'creation-resume-parent-0001', stage: 'completed', status: 'completed',
        chainScopeId: 'chain-1', checkpoint: { completedChapters: 6 }, now
      });
      repository.createChainWorkflow({
        workflowId: 'creation-resume-cancelled-0001', ownerId, bookId, volumeScopeId: 'volume-1',
        chainScopeId: 'chain-2', firstVolume: true, authorGoal: null,
        parentWorkflowId: 'creation-resume-parent-0001', idempotencyKey: 'creation-resume-cancelled-create-0001',
        requestHash: 'f'.repeat(64), now
      });
      repository.updateWorkflow({
        ownerId, bookId, workflowId: 'creation-resume-cancelled-0001', stage: 'chain_options', status: 'cancelled',
        checkpoint: { parentWorkflowId: 'creation-resume-parent-0001', requestedCandidateCount: 1 }, now
      });

      const resumed = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/creation-resume-cancelled-0001/continue-to-next-chain`, {
          chainScopeId: 'chain-2', candidateCount: 1, idempotencyKey: 'creation-resume-next-chain-0001'
        });
      expect(resumed.statusCode).toBe(200);
      expect(resumed.json().data.workflow).toMatchObject({
        chainScopeId: 'chain-2', status: expect.stringMatching(/working|waiting|waiting_for_you/u)
      });
      expect(resumed.json().data.workflow.workflowId).not.toBe('creation-resume-cancelled-0001');
      expect(repository.workflow(ownerId, bookId, 'creation-resume-cancelled-0001')?.status).toBe('cancelled');
    } finally {
      await app.close();
    }
  });

  it('正文结果未知时只允许作者明确换一名主笔后恢复，不自动重复原成员', async () => {
    context = createTestContext('wenmi-v7-creation-unknown-writer-recovery-');
    const app = await createServer(context.config, context.database, {
      v7OpeningModelAdapters: new CreationResolver()
    });
    try {
      const cookie = await register(app, 'creation-unknown-writer@example.com', '未知正文恢复作者');
      const bookId = await createBook(app, cookie, '未知正文恢复测试书', 'creation-book-unknown-writer-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const workflowId = 'creation-workflow-unknown-writer-0001';
      const repository = new V7CreationRuntimeRepository(context.database);
      const now = new FixedClock().now().toISOString();
      repository.createWorkflow({
        workflowId, ownerId, bookId, volumeScopeId: 'volume-1', firstVolume: true, authorGoal: null,
        idempotencyKey: 'creation-unknown-writer-setup', requestHash: 'c'.repeat(64), now
      });
      repository.updateWorkflow({
        ownerId, bookId, workflowId, stage: 'manuscript', status: 'unknown',
        checkpoint: { nextChapterNumber: 7 }, errorMessage: '对不起，这次工作结果还不能确认。', now
      });
      repository.beginModelCall({
        requestId: 'creation-unknown-writer-call-0001', ownerId, bookId, workflowId,
        runKind: 'manuscript', nodeKey: 'chapter:7:pass:1', memberKey: 'writer-kimi-k3',
        provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k3', plan: 'agent', purpose: 'novel_writer',
        promptHash: 'd'.repeat(64), reservedTokens: 10_000, governanceRevision: 1, temperature: 0.72, now
      });
      repository.failModelCall('creation-unknown-writer-call-0001', 'unknown', '供应商结果未知', now);

      const sameWriter = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/managed/activate`, {
          writerMemberKey: 'writer-kimi-k3'
        });
      expect(sameWriter.statusCode).toBe(409);
      expect(sameWriter.json().error.message).toContain('明确换一位主笔');

      const changedWriter = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/managed/activate`, {
          writerMemberKey: 'writer-deepseek-v4-pro'
        });
      expect(changedWriter.statusCode).toBe(200);
      expect(changedWriter.json().data).toMatchObject({
        status: 'working',
        execution: { mode: 'managed', status: 'active', writerMemberKey: 'writer-deepseek-v4-pro' }
      });
      expect(repository.modelCall('creation-unknown-writer-call-0001')).toMatchObject({
        state: 'unknown', member_key: 'writer-kimi-k3'
      });
      expect(repository.workflow(ownerId, bookId, workflowId)?.checkpoint_json)
        .toContain('creation-unknown-writer-call-0001');
    } finally {
      await app.close();
    }
  });

  it('作者停止任务后晚到的成员结果不能把取消状态覆盖成失败', async () => {
    context = createTestContext('wenmi-v7-creation-late-cancel-');
    const resolver = new BlockingCreationResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'creation-late-cancel@example.com', '晚到结果作者');
      const bookId = await createBook(app, cookie, '晚到结果测试书', 'creation-book-late-cancel-0001');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      confirmSetting(ownerId, bookId);
      seedConfirmedBookTree(new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock()), ownerId, bookId);
      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/creation-workflows`, {
        volumeScopeId: 'volume-1', authorGoal: '先让主角活下来。', candidateCount: 3, idempotencyKey: 'creation-late-cancel-workflow-0001'
      });
      const workflowId = created.json().data.workflowId as string;
      await resolver.waitUntilStarted();
      const stopped = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/cancel`, {
          reason: '保留成果并停止。', idempotencyKey: 'creation-late-cancel-action-0001'
        });
      expect(stopped.json().data.status).toBe('cancelled');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(resolver.wasAborted()).toBe(true);
      const afterLateResult = await request(app, cookie, 'GET',
        `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}`);
      expect(afterLateResult.json().data).toMatchObject({
        status: 'cancelled', message: '保留成果并停止。'
      });
    } finally {
      resolver.release();
      await app.close();
    }
  });
});

class BlockingCreationResolver implements V7OpeningModelAdapterResolver {
  private releaseGate!: () => void;
  private startedGate!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.releaseGate = resolve; });
  private readonly started = new Promise<void>((resolve) => { this.startedGate = resolve; });
  private aborted = false;

  public release(): void { this.releaseGate(); }
  public waitUntilStarted(): Promise<void> { return this.started; }
  public wasAborted(): boolean { return this.aborted; }

  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> => {
      const genreProfile = v7GenreProfileFixtureResult(provider, modelId, request);
      if (genreProfile !== null) return genreProfile;
      this.startedGate();
      await Promise.race([
        this.gate,
        new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => {
          this.aborted = true;
          reject(signal.reason ?? new DOMException('任务已停止', 'AbortError'));
        }, { once: true }))
      ]);
      const prompt = stageTaskPrompt(request.prompt);
      return {
        provider, modelId, output: outputFor(prompt), inputTokens: 180, outputTokens: 620,
        cashCostCny: 0, state: 'succeeded'
      };
    } };
  }
}

class GlmPlanningFailureResolver implements V7OpeningModelAdapterResolver {
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      const genreProfile = v7GenreProfileFixtureResult(provider, modelId, request);
      if (genreProfile !== null) return genreProfile;
      const prompt = stageTaskPrompt(request.prompt);
      if (modelId === 'glm-5.3' && prompt.includes('规划编剧')) {
        throw new ModelAdapterError('GLM本轮没有形成可见方案', 'technical_failure', true);
      }
      return {
        provider, modelId, output: outputFor(`${prompt}\n测试模型：${modelId}`), inputTokens: 180, outputTokens: 620,
        cashCostCny: 0, state: 'succeeded'
      };
    }};
  }
}

class RewriteOnceReviewResolver implements V7OpeningModelAdapterResolver {
  private rewriteReviewsRemaining = 1;

  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      const genreProfile = v7GenreProfileFixtureResult(provider, modelId, request);
      if (genreProfile !== null) return genreProfile;
      const prompt = stageTaskPrompt(request.prompt);
      if (prompt.includes('比较已经独立保存的方案') && this.rewriteReviewsRemaining > 0) {
        this.rewriteReviewsRemaining -= 1;
        return {
          provider, modelId,
          output: JSON.stringify({
            verdict: 'rewrite', summary: '三套方案的关键事件完全相同，需要真正拉开路径。',
            issues: [{
              location: '三套方案', issueType: 'plot', severity: 'major',
              evidence: '三套都使用了同一条事件链。',
              requiredAction: '下一轮必须改变关键转折、对手反应和主角代价。'
            }],
            scores: { continuity: 70 }
          }),
          inputTokens: 180, outputTokens: 160, cashCostCny: 0, state: 'succeeded'
        };
      }
      return { provider, modelId, output: outputFor(`${prompt}\n测试模型：${modelId}`), inputTokens: 180, outputTokens: 620, cashCostCny: 0, state: 'succeeded' };
    } };
  }
}

class CreationResolver implements V7OpeningModelAdapterResolver {
  public readonly prompts: string[] = [];

  public constructor(
    private alwaysFailPromptPart: string | null = null,
    private planningFailuresRemaining = 0,
    private readonly excludeOneOptionalSource = false,
    private reviewFailuresRemaining = 0,
    private malformedOptionsRemaining = 0,
    private malformedReviewsRemaining = 0
  ) {}

  public resumePromptFailures(): void {
    this.alwaysFailPromptPart = null;
  }

  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      const genreProfile = v7GenreProfileFixtureResult(provider, modelId, request);
      if (genreProfile !== null) return genreProfile;
      const stagePrompt = stageTaskPrompt(request.prompt);
      this.prompts.push(stagePrompt);
      if (this.alwaysFailPromptPart !== null
        && (stagePrompt.includes(this.alwaysFailPromptPart) || modelId === this.alwaysFailPromptPart)) {
        throw new ModelAdapterError('这名编剧本轮没有完成', 'technical_failure', true);
      }
      if (stagePrompt.includes('V7规划维护员') && this.planningFailuresRemaining > 0) {
        this.planningFailuresRemaining -= 1;
        throw new ModelAdapterError('规划维护成员本轮没有完成', 'technical_failure', true);
      }
      if (stagePrompt.includes('独立审校') && this.reviewFailuresRemaining > 0) {
        this.reviewFailuresRemaining -= 1;
        return {
          provider, modelId, output: JSON.stringify({
            schema: 'v7-chapter-review-v1', passed: false, publicSummary: '本章需要一次定点修复。',
            hardConflicts: [], continuityRisks: [{ evidence: '首段承接不足', impact: '读者难以确认连续关系', action: '补足承接' }],
            qualitySuggestions: [], rewriteInstructions: ['只补足首段承接，不改已成立的事件结果。']
          }),
          inputTokens: 180, outputTokens: 120, cashCostCny: 0, state: 'succeeded'
        };
      }
      if (stagePrompt.includes('规划编剧') && this.malformedOptionsRemaining > 0) {
        this.malformedOptionsRemaining -= 1;
        return {
          provider, modelId, output: malformedOptionOutput(stagePrompt), inputTokens: 180, outputTokens: 620,
          cashCostCny: 0, state: 'succeeded'
        };
      }
      if (stagePrompt.includes('比较已经独立保存的方案') && this.malformedReviewsRemaining > 0) {
        this.malformedReviewsRemaining -= 1;
        return {
          provider, modelId, output: JSON.stringify({ verdict: 'pass', summary: '三套都可执行，推荐第一套。', issues: [], scores: { continuity: 90 } }),
          inputTokens: 180, outputTokens: 120, cashCostCny: 0, state: 'succeeded'
        };
      }
      return {
        provider, modelId, output: outputFor(`${stagePrompt}\n测试模型：${modelId}`, this.excludeOneOptionalSource),
        inputTokens: 180, outputTokens: 620, cashCostCny: 0, state: 'succeeded'
      };
    }};
  }
}

function stageTaskPrompt(compiledPrompt: string): string {
  try {
    const manifest = JSON.parse(compiledPrompt) as {
      contextPack?: { content?: { stageTaskPayload?: unknown } };
    };
    const payload = manifest.contextPack?.content?.stageTaskPayload;
    if (payload === undefined) return compiledPrompt;
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  } catch {
    return compiledPrompt;
  }
}

class UnknownResolver implements V7OpeningModelAdapterResolver {
  public calls = 0;

  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      const genreProfile = v7GenreProfileFixtureResult(provider, modelId, request);
      if (genreProfile !== null) return genreProfile;
      this.calls += 1;
      throw new ModelAdapterError('连接中断，结果还不能确认', 'technical_failure', true, undefined, true);
    } };
  }
}

class LineageResolver implements V7OpeningModelAdapterResolver {
  public calls = 0;

  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      const genreProfile = v7GenreProfileFixtureResult(provider, modelId, request);
      if (genreProfile !== null) return genreProfile;
      this.calls += 1;
      return {
        provider, modelId, output: 'lineage-ok', inputTokens: 12, outputTokens: 3,
        cashCostCny: 0, state: 'succeeded'
      };
    } };
  }
}

function outputFor(prompt: string, excludeOneOptionalSource = false): string {
  if (prompt.includes('候选资料：') && (prompt.includes('资料策划') || prompt.includes('资料编辑'))) {
    return contextSelectionOutput(prompt, excludeOneOptionalSource);
  }
  if (prompt.includes('刚才的规划内容已经保留')) return optionOutput(prompt);
  if (prompt.includes('规划编剧')) return optionOutput(prompt);
  if (prompt.includes('比较已经独立保存的方案') || prompt.includes('刚才的主编比较内容已经保留')) return optionReviewOutput(prompt);
  if (prompt.includes('章纲审查主编')) return JSON.stringify({
    schema: 'v7-chapter-review-v1', passed: true, publicSummary: '章纲承接明确，逐章变化和阶段回报完整。',
    hardConflicts: [], continuityRisks: [], qualitySuggestions: [], rewriteInstructions: []
  });
  if (prompt.includes('章纲编剧')) return outlineOutput(prompt);
  if (prompt.includes('独立审校')) return JSON.stringify({
    schema: 'v7-chapter-review-v1', passed: true, publicSummary: '人物选择、因果与本章回报都已成立。',
    hardConflicts: [], continuityRisks: [], qualitySuggestions: [], rewriteInstructions: []
  });
  if (prompt.includes('结算编辑')) return settlementOutput(prompt);
  if (prompt.includes('人物资料维护员')) return characterMaintenanceOutput(prompt);
  if (prompt.includes('V7规划维护员')) return JSON.stringify({
    schema: 'v7-planning-maintenance-v1', publicSummary: '张三已经完成本链第一步。',
    actuals: [{
      treeKind: 'chain', scopeId: 'chain-1', nodeKey: 'chain-event-1', state: 'partial',
      summary: '张三在第一次冲突中保住同袍。', emotionResult: '压迫后得到第一次释放。',
      experienceResult: '读者看到主角主动选择产生回报。', outcome: '张三获得同袍的初步信任。'
    }], suggestions: []
  });
  if (prompt.includes('文秘写作主笔')) return manuscriptText();
  throw new Error(`测试没有覆盖这类成员任务：${prompt.slice(0, 80)}`);
}

function contextSelectionOutput(prompt: string, excludeOneOptionalSource: boolean): string {
  const candidatesText = prompt.split('候选资料：').at(-1) ?? '[]';
  const candidates = JSON.parse(candidatesText.split('\n测试模型：')[0]!) as Array<{
    sourceKey: string;
    required: boolean;
    exactContentCharacters?: number;
    exactPackedCharacters?: number;
  }>;
  const maximum = Number(/最多选择(\d+)项/u.exec(prompt)?.[1] ?? '12');
  const maximumCharacters = Math.max(1_000, Number(/不得超过(\d+)字符/u.exec(prompt)?.[1] ?? '100000') - 3_000);
  const ordered = [
    ...candidates.filter((item) => item.required),
    ...candidates.filter((item) => !item.required)
  ];
  const selected: typeof ordered = [];
  let exactCharacters = 0;
  for (const candidate of ordered) {
    if (selected.length >= maximum) break;
    const nextCharacters = exactCharacters + (candidate.exactPackedCharacters ?? candidate.exactContentCharacters ?? 0);
    if (!candidate.required && nextCharacters > maximumCharacters) continue;
    selected.push(candidate);
    exactCharacters = nextCharacters;
  }
  if (excludeOneOptionalSource) {
    const removable = selected.findLastIndex((item) => !item.required);
    if (removable >= 0) selected.splice(removable, 1);
  }
  const keys = selected.map((item) => item.sourceKey);
  const planningLayers = JSON.parse(/当前任务允许检索的层级只有：(\[[^\n]+\])/u.exec(prompt)?.[1] ?? '["chapter_execution"]') as string[];
  const settlement = prompt.includes('methodStrategy.mode必须为none');
  return JSON.stringify({
    schema: 'v7-creation-context-v1', publicSummary: '只保留本次创作需要的正式资料和当前状态。',
    selectedSourceKeys: keys, selectionReasons: keys.map((sourceKey) => ({ sourceKey, reason: '当前任务需要。' })),
    excludedSourceKeys: candidates.filter((item) => !keys.includes(item.sourceKey)).map((item) => item.sourceKey), openQuestions: [],
    taskPersona: {
      publicLabel: '历史战争融合任务身份',
      workingIdentity: '以历史边界为底，按当前任务设计人物主动选择与连续回报。',
      priorities: ['守住已经确认的时代与人物边界', '让主角行动推动结果'],
      authenticityChecks: ['核对人物知情边界', '核对行动是否符合当前资源'],
      avoidPatterns: ['不让历史名人替主角完成选择', '不机械套用固定节拍']
    },
    taskResponsibilities: ['完成当前层级交付的故事责任', '承接最近正文实际并为下一层留下清楚接口'],
    creativeSpace: ['可组合资产或设计只属于本书的推进方式'],
    methodStrategy: {
      mode: settlement ? 'none' : 'combined',
      publicSummary: settlement ? '事实结算只核对正式正文，不使用叙事方法。' : '先召回当前层级适用的方法，再由执行成员组合或放弃。',
      searchRequest: settlement ? null : {
        schema: 'v7-planning-method-search-v1', publicGoal: '为当前任务找到少量可用的因果与回报方法。',
        searchQueries: ['人物主动选择如何改变局势', '压力升级后怎样自然兑现回报'],
        planningLayers, dimensions: ['causal_dynamics', 'serial_rhythm'], desiredCount: 8,
        scaleHint: '只覆盖当前任务层级。', avoidNotes: ['不机械套模板'], relevantSettingSourceIds: [], missingCriticalInputs: []
      }
    }
  });
}

function optionOutput(prompt: string): string {
  const kind = /treeKind="(volume|chain)"/u.exec(prompt)?.[1] as 'volume' | 'chain';
  const scopeId = /scopeId="([^"]+)"/u.exec(prompt)?.[1] ?? 'unknown';
  const perspective = prompt.includes('局势递进') || prompt.includes('"publicName":"结构递进"') || prompt.includes('deepseek-v4-pro')
    ? '结构递进'
    : prompt.includes('追读兑现') || prompt.includes('"publicName":"强回报"') || prompt.includes('glm-5.3')
      ? '强回报'
      : '人物抉择';
  const tree = kind === 'volume'
    ? planningTree('volume', scopeId, [
        planningNode('volume-chain-1', 'chain', 1, `${perspective}·军营立足链`, { treeKind: 'chain', scopeId: 'chain-1' }),
        planningNode('volume-chain-2', 'chain', 2, `${perspective}·粮册追查链`, { treeKind: 'chain', scopeId: 'chain-2' })
      ])
    : planningTree('chain', scopeId, [planningNode('chain-event-1', 'event', 1, `${perspective}·张三保住同袍`, null)]);
  return JSON.stringify({
    schema: kind === 'volume' ? 'v7-volume-option-v1' : 'v7-chain-option-v1', optionKind: kind,
    publicName: perspective, publicSummary: `${perspective}方案让张三用自己的选择改变处境。`,
    readerExperience: '持续承压后得到一次明确回报。', coreConflict: '小卒求生与军中旧规发生冲突。',
    protagonistChoice: '张三选择冒险保住同袍。', priceAndChange: '暴露能力，也赢得初步信任。',
    payoff: '张三第一次在军营获得立足点。', strengths: ['主角主动', '回报清楚'], risks: ['不能让岳飞替主角完成选择'], tree
  });
}

function malformedOptionOutput(prompt: string): string {
  const value = JSON.parse(optionOutput(prompt)) as Record<string, any>;
  const tree = value.tree as Record<string, any>;
  delete tree.schema;
  delete tree.title;
  const flatten = (node: Record<string, any>): void => {
    node.story = node.story.summary;
    node.emotion = node.emotion.publicSummary;
    node.experience = node.experience.publicSummary;
    node.causality = node.causality.coreConflict;
    node.threads = [];
    for (const child of node.children as Array<Record<string, any>>) flatten(child);
  };
  flatten(tree.root as Record<string, any>);
  return JSON.stringify(value);
}

function optionReviewOutput(prompt: string): string {
  const optionIds = [...prompt.matchAll(/"optionId":"([^"]+)"/gu)]
    .map((match) => match[1]!).filter((id, index, all) => all.indexOf(id) === index);
  return JSON.stringify({
    schema: 'v7-planning-option-review-v1', publicSummary: '三套方向都能成立，第一套因果和容量最稳。',
    recommendedOptionId: optionIds[0],
    differences: optionIds.map((optionId, index) => ({ optionId, difference: `第${index + 1}套的主要抓力不同。` })),
    risks: ['岳飞不能替代张三完成核心选择'], authorDecisions: []
  });
}

function outlineOutput(prompt: string): string {
  const chainScopeId = /chainScopeId固定为([^，\n]+)/u.exec(prompt)?.[1]?.trim() ?? 'chain-1';
  const chapterStart = Number(/chapterStart固定为(\d+)/u.exec(prompt)?.[1] ?? '1');
  const chapters = [chapterStart, chapterStart + 1, chapterStart + 2].map((chapterNumber) => ({
    chapterNumber, title: `第${chapterNumber}章·军营立足`, objective: `完成第${chapterNumber}步求生目标`,
    openingHook: '军法官忽然点名张三。', sceneSetup: '北宋军营与混乱粮仓。',
    protagonistChoice: '张三选择先保住同袍，再说明自己的判断。', opposition: '军法、饥饿与同袍猜疑。',
    turn: '张三发现粮册被人动过。', emotionalMovement: '紧张、承压，再获得小幅释放。',
    payoff: '张三用行动赢得一次具体信任。', continuity: '承接上一章结果，不提前完成整条链。',
    openQuestions: ['谁改了粮册？'], nextChapterInterface: '粮册线索把张三带入更危险的选择。'
  }));
  return JSON.stringify({
    schema: 'v7-chapter-sequence-v1', chainScopeId, publicSummary: '三章完成一次清楚的推进与回报。',
    chapterStart, chapterEnd: chapterStart + 2, chapters, sourceRefs: []
  });
}

function manuscriptText(): string {
  const paragraph = '军法官点到张三名字时，粮仓外的风正卷着碎雪。张三没有急着辩解，只把那本被水浸过的粮册放到火光下，让众人看清新旧墨迹的差别。他知道自己只是最不起眼的小卒，若只说真话，没人会听；所以他先替受罚的同袍扛下半袋粮，又指出守门木栓上的油痕。众人沉默下来，连原本想看笑话的老兵也收起了目光。张三明白，这不是胜利，只是他在这座军营里争来的第一口喘息。';
  return Array.from({ length: 6 }, (_, index) => `${index + 1}。${paragraph}`).join('\n\n');
}

function settlementOutput(prompt: string): string {
  const evidenceRef = /唯一正文证据引用：([^\n]+)/u.exec(prompt)?.[1]?.trim() ?? 'missing';
  return JSON.stringify({
    schema: 'v7-chapter-settlement-v1', publicSummary: '张三通过主动判断保住同袍并获得初步信任。',
    irreversibleResults: [{ result: '张三公开指出粮册异常' }],
    entityStates: [{ entity: '张三', state: '获得同袍初步信任' }], relationshipChanges: [], knowledgeChanges: [],
    resourceChanges: [], ruleChanges: [],
    storyLines: [{ stableKey: 'military-survival', title: '军营求生线', state: 'advancing', summary: '张三取得第一个立足点。', evidenceRefs: [evidenceRef] }],
    foreshadowing: [{ stableKey: 'grain-ledger', title: '粮册疑点', state: 'planted', summary: '粮册被人改动，幕后原因未明。', evidenceRefs: [evidenceRef] }],
    openQuestions: [{ stableKey: 'who-changed-ledger', question: '谁改了粮册？', state: 'open', answer: null, evidenceRefs: [evidenceRef] }],
    treeActuals: [{ treeKind: 'chain', scopeId: 'chain-1', nodeKey: 'chain-event-1', state: 'partial',
      summary: '张三保住同袍。', emotionResult: '压迫后出现第一次释放。', experienceResult: '主角主动选择得到回报。',
      outcome: '张三获得初步信任。', evidenceRefs: [evidenceRef] }]
  });
}

function characterMaintenanceOutput(prompt: string): string {
  const entityId = /"entityId":"([^"]+)"/u.exec(prompt)?.[1] ?? 'missing-character';
  return JSON.stringify({
    schema: 'v7-character-maintenance-v1', publicSummary: '张三的当前关系变化已整理。',
    affectedEntityIds: [entityId], changes: [], issues: []
  });
}

function seedConfirmedBookTree(service: V7PlanningTreeService, ownerId: string, bookId: string): void {
  service.saveGeneratedCandidate({
    ownerId, bookId, treeKind: 'book', scopeId: bookId, expectedRevision: 0,
    document: planningTree('book', bookId, [
      planningNode('book-volume-1', 'volume', 1, '第一卷：小卒立足', { treeKind: 'volume', scopeId: 'volume-1' }),
      planningNode('book-ending', 'ending', 2, '结局：建立新秩序', null)
    ]),
    sourceRefs: [{ sourceKind: 'opening', sourceId: bookId, version: '1' }],
    idempotencyKey: 'creation-book-tree-candidate-0001', createdBy: 'test'
  });
  service.confirmCandidate(ownerId, bookId, 'book', bookId, {
    expectedRevision: 1, idempotencyKey: 'creation-book-tree-confirm-0001'
  });
}

function planningTree(treeKind: 'book' | 'volume' | 'chain', scopeId: string, children: PlanningTreeNode[]): PlanningTreeDocument {
  const root = planningNode(`${treeKind}-root`, treeKind, 1, `${treeKind}方向`, null, children);
  if (treeKind === 'volume') {
    children.forEach((child, index) => {
      child.budget = { wordTarget: 20_000, chapterRange: [index * 6 + 1, index * 6 + 6] };
    });
    root.budget = { wordTarget: children.length * 20_000, chapterRange: [1, children.length * 6] };
  }
  return {
    schema: 'v7-planning-tree-v1', treeKind, scopeId, title: root.title,
    designStrategy: {
      libraryRefs: [],
      originalStrategies: [{ title: '上层阶段推进', applicationNote: '用人物选择产生的后果连接相邻阶段。' }],
      decisionNote: '上层只冻结责任与接口，下层按自己的尺度重新设计。'
    },
    root
  };
}

function planningNode(
  key: string, kind: PlanningTreeNode['kind'], sequence: number, title: string,
  linkedTree: PlanningTreeNode['linkedTree'], children: PlanningTreeNode[] = []
): PlanningTreeNode {
  return {
    key, kind, sequence, title,
    story: { summary: `${title}的故事方向。`, majorEvents: [`完成${title}的核心变化`], protagonistChange: '张三承担更大责任。', outcome: '形成新的局面。', nextStep: '由结果自然引出下一步。' },
    emotion: { publicSummary: '先承压再释放。', openingEmotion: '紧张', pressureMovement: '阻力逐步增强。', releaseEmotion: '目标达成后的释放。', intensity: 'strong' },
    experience: { publicSummary: '主角主动改变命运。', pressureRhythm: '逐步加压。', payoffCadence: '阶段内明确兑现。', informationRhythm: '按行动需要揭示。', contrastWithPrevious: '冲突形态发生变化。', designReason: '避免长篇重复。' },
    causality: { trigger: '处境逼迫主角行动。', causes: ['旧秩序形成阻力。'], coreConflict: '主角选择与旧规则冲突。', turningPoint: '主角承担风险。', consequences: ['获得位置，也面对更大责任。'] },
    threads: { foreshadowing: ['上层伏笔责任'], openQuestions: ['下一步如何承担责任？'] },
    budget: { wordTarget: kind === 'book' ? 3_000_000 : kind === 'volume' ? 360_000 : 20_000, chapterRange: null },
    linkedTree, children
  };
}

async function register(app: Awaited<ReturnType<typeof createServer>>, email: string, displayName: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
    payload: { email, password: 'strong-pass-123', displayName } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function createBook(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, title: string, idempotencyKey: string
): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...HEADERS, cookie }, payload: {
    idempotencyKey,
    openingPackage: {
      title, positioning: {
        publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: ['历史脑洞'], tags: ['历史', '权谋'],
        coreAppeal: '张三改变北宋。', targetReaders: '喜欢历史穿越、成长和权谋的男频读者',
        expectedTotalWords: 3_000_000, volumePlan: { minimum: 6, recommended: 8, maximum: 10 },
        retentionPositioning: '开篇快速进入乱世压力，逐卷兑现身份跃迁、班底扩张和格局变化。'
      },
      backgrounds: { eraAndWorld: '北宋末年', openingSituation: '' },
      protagonists: [{ name: '张三', age: '20岁', identity: '男主', background: '现代人穿越为小卒', familyBackground: '', careerBackground: '', goldenFinger: '', goal: '改变时代', dilemma: '身份低微', personality: ['谨慎'], boundary: '不能靠系统解决问题' }],
      opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
      longTermDirection: { centralConflict: '小人物与旧秩序冲突', progression: '从小卒成长', relationshipDirection: '与岳飞相识并合作', storyPotential: '逐卷扩大影响' },
      possibleEnding: { direction: '建立新秩序', price: '承担损失', openness: '允许调整' }, authorNotes: [],
      mustFollow: ['主角必须是张三', '不使用系统和超凡力量']
    }
  } });
  expect(response.statusCode).toBe(200);
  return response.json().data.bookId as string;
}

function confirmSetting(ownerId: string, bookId: string): void {
  const now = '2026-07-16T00:00:00.000Z';
  context!.database.prepare(`INSERT INTO v7_setting_item_versions
    (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
    VALUES ('creation-setting-version',?,?, 'world-stage',1,'confirmed',?,'author',?)`)
    .run(ownerId, bookId, JSON.stringify({ era: '北宋末年', rule: '写实历史，无超凡体系' }), now);
  context!.database.prepare(`INSERT INTO v7_setting_items
    (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
    VALUES (?,?,'world-stage','世界舞台','核心设定','时代和世界规则','confirmed','creation-setting-version',1,?)`)
    .run(ownerId, bookId, now);
}

async function request(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, method: 'GET' | 'POST', url: string, payload?: unknown
) {
  const headers = { ...HEADERS, cookie };
  return payload === undefined
    ? await app.inject({ method, url, headers })
    : await app.inject({ method, url, headers, payload: payload as object });
}

async function pollWorkflow(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, workflowId: string, stage: string
): Promise<any> {
  for (let index = 0; index < 300; index += 1) {
    const response = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (view.stage === stage && view.status === 'waiting_for_you') return view;
    if (view.status === 'failed') throw new Error(view.errorMessage ?? view.message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`创作任务没有进入${stage}`);
}

async function pollWorkflowStatus(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, workflowId: string, status: string
): Promise<any> {
  for (let index = 0; index < 300; index += 1) {
    const response = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (view.status === status) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`创作任务没有进入${status}`);
}

async function pollIncompleteOptions(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, workflowId: string,
  expectedCompleted: number
): Promise<any> {
  for (let index = 0; index < 300; index += 1) {
    const response = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (['failed', 'partially_failed'].includes(view.status) && view.completedOptions === expectedCompleted) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`创作任务没有停在${expectedCompleted}套待补位状态`);
}

async function pollWriteBack(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, workflowId: string,
  expectedTotal: number
): Promise<any> {
  for (let index = 0; index < 600; index += 1) {
    const response = await request(app, cookie, 'GET',
      `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/write-back`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (view.total === expectedTotal && view.completed === expectedTotal) return view;
    if (view.unknown > 0) throw new Error('写后更新出现未知结果');
    if (view.failed > 0) throw new Error(`写后更新失败：${JSON.stringify(view.tasks)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('写后更新没有完成');
}

async function pollVolumeCompletion(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, workflowId: string
): Promise<any> {
  let lastView: any = null;
  for (let index = 0; index < 600; index += 1) {
    await request(app, cookie, 'GET',
      `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}/write-back`);
    const response = await request(app, cookie, 'GET',
      `/api/v1/v7/books/${bookId}/creation-workflows/${workflowId}`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    lastView = view;
    if (view.status === 'completed' && view.volumeComplete === true) return view;
    if (view.status === 'failed') throw new Error(view.errorMessage ?? view.message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`整卷结算没有完成：${JSON.stringify(lastView)}`);
}

function count(testContext: TestContext, table: string, ownerId: string, bookId: string): number {
  const allowed = new Set([
    'v7_creation_options', 'v7_formalization_outbox', 'v7_chapter_settlements', 'stage_settlements',
    'v7_story_state_items', 'v7_character_maintenance_runs', 'v7_planning_maintenance_runs',
    'v7_creation_stage_settlements', 'v7_creation_stage_jobs'
  ]);
  if (!allowed.has(table)) throw new Error('测试表名不在白名单');
  return Number((testContext.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=? AND book_id=?`)
    .get(ownerId, bookId) as { count: number }).count);
}
