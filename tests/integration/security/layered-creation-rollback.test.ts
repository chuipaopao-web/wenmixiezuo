import { describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { AuthorCollaborationService } from '../../../apps/api/src/application/planning/author-collaboration-service.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { StageSettlementService } from '../../../apps/api/src/application/continuity/stage-settlement-service.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { AuthorPlanningInputRepository } from '../../../apps/api/src/infrastructure/db/repositories/author-planning-input-repository.js';
import { LongformContinuityRepository } from '../../../apps/api/src/infrastructure/db/repositories/longform-continuity-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds } from '../../helpers/test-context.js';

describe('layered creation read-only rollback', () => {
  it('keeps author words, finalized manuscript, settlement, versions, and model evidence byte-for-byte unchanged', async () => {
    const context = createTestContext('wenmi-layered-rollback-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock, {
      title: '回滚保护书',
      content: '这是已经定稿且绝不能被回滚覆盖的正文。'
    });
    try {
      const collaboration = new AuthorCollaborationService(
        new AuthorPlanningInputRepository(context.database),
        new UnitOfWork(context.database),
        ids,
        clock
      );
      collaboration.create(fixture.scope, {
        surface: 'volume_plan',
        subjectType: 'volume_plan',
        subjectId: 'volume-plan-protected',
        intentStrength: 'must',
        originalText: '作者原话：这一卷必须保留人物主动选择的代价。',
        attachmentRefs: [],
        mentionedAgentIds: [],
        scopeNotes: '只约束本卷',
        idempotencyKey: 'rollback-protected-author-input'
      });

      const artifact = new ArtifactService(context.database, ids, clock).create(
        fixture.scope,
        'story_bible',
        '回滚保护版本',
        {
          title: '回滚保护设定',
          positioning: {},
          worldRules: ['任何能力都必须付出已知代价'],
          characters: [],
          mainPlot: {}
        },
        'candidate'
      );

      const manuscript = context.database.prepare(
        'SELECT content_hash FROM manuscript_versions WHERE manuscript_version_id = ?'
      ).get(fixture.manuscriptVersionId) as { content_hash: string };
      const settlement = new StageSettlementService(
        new LongformContinuityRepository(context.database),
        new UnitOfWork(context.database),
        ids,
        clock
      ).build(fixture.scope, {
        stageType: 'chapter',
        stageKey: fixture.chapterId,
        chapterStart: 1,
        chapterEnd: 1,
        canonRevision: 1,
        payload: {
          irreversibleResults: ['主角承担了公开选择的代价'],
          entityStates: { 主角: '已经作出不可撤回的选择' },
          closedThreads: [],
          openThreads: ['选择带来的后果'],
          relationshipChanges: [],
          knowledgeChanges: [],
          resourceChanges: [],
          ruleChanges: [],
          exclusions: ['未写入正文的计划']
        },
        sources: [{
          sourceType: 'canon_manuscript',
          sourceId: fixture.manuscriptVersionId,
          sourceHash: manuscript.content_hash,
          locator: { chapterNumber: 1 }
        }],
        probes: [{ type: 'source', expected: 1, actual: 1, passed: true }]
      });
      expect(settlement.activated).toBe(true);
      context.database.prepare(
        "UPDATE chapters SET settlement_status = 'settled', canon_manuscript_version_id = current_manuscript_version_id WHERE owner_id = ? AND book_id = ? AND chapter_id = ?"
      ).run(fixture.scope.ownerId, fixture.scope.bookId, fixture.chapterId);

      const model = context.database.prepare(
        'SELECT a.model_snapshot_id, m.provider, m.model_id FROM agent_instances a JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id WHERE a.owner_id = ? AND a.book_id = ? AND a.agent_id = ?'
      ).get(fixture.scope.ownerId, fixture.scope.bookId, fixture.agentId) as {
        model_snapshot_id: string;
        provider: string;
        model_id: string;
      };
      const budgets = new BudgetService(context.database, ids, clock);
      const budget = budgets.create(fixture.scope, 'standard', 1000, 0);
      const requestId = ids.next();
      const reservationId = budgets.reserve(fixture.scope, budget.budgetId, requestId, 100, 0);
      new ModelCallService(context.database, clock, budgets).begin(fixture.scope, {
        requestId,
        taskId: fixture.taskId,
        phaseKey: 'rollback-proof',
        agentId: fixture.agentId,
        modelSnapshotId: model.model_snapshot_id,
        provider: model.provider,
        modelId: model.model_id,
        input: '必须保留的调用输入证据',
        parameters: '{}',
        reservationId
      });

      const before = protectedSnapshot(context.database, fixture.scope.ownerId, fixture.scope.bookId);
      expect(before.artifactVersions).toEqual(expect.arrayContaining([
        expect.objectContaining({ artifact_version_id: artifact.artifactVersionId })
      ]));

      const app = await createServer(context.config, context.database, {
        trustedTest: true,
        layeredCreationWrites: 'read_only'
      });
      try {
        const blocked = await app.inject({
          method: 'POST',
          url: '/api/v1/books/' + fixture.scope.bookId + '/volume-plans',
          payload: {
            expectedWorkflowVersion: 0,
            planNumber: 1,
            idempotencyKey: 'must-not-be-written'
          }
        });
        expect(blocked.statusCode).toBe(409);
        expect(blocked.json()).toMatchObject({
          error: {
            code: 'LAYERED_CREATION_READ_ONLY',
            retryable: true
          }
        });
        expect(blocked.json().error.message).toContain('已有想法、方案、版本、正文和结算都已保留');

        const readable = await app.inject({
          method: 'GET',
          url: '/api/v1/books/' + fixture.scope.bookId + '/author-planning-inputs'
        });
        expect(readable.statusCode).toBe(200);
        expect(readable.json().data[0].originalText).toContain('作者原话');

        const plans = await app.inject({
          method: 'GET',
          url: '/api/v1/books/' + fixture.scope.bookId + '/volume-plans'
        });
        expect(plans.statusCode).toBe(200);
      } finally {
        await app.close();
      }

      expect(protectedSnapshot(context.database, fixture.scope.ownerId, fixture.scope.bookId)).toEqual(before);
      expect(context.database.prepare(
        'SELECT COUNT(*) AS count FROM volume_plans WHERE owner_id = ? AND book_id = ?'
      ).get(fixture.scope.ownerId, fixture.scope.bookId)).toEqual({ count: 0 });
    } finally {
      context.close();
    }
  });
});

function protectedSnapshot(database: import('node:sqlite').DatabaseSync, ownerId: string, bookId: string) {
  return {
    authorInputs: database.prepare(
      'SELECT author_input_id, original_text, original_text_hash, status, handling_reason FROM author_planning_inputs WHERE owner_id = ? AND book_id = ? ORDER BY author_input_id'
    ).all(ownerId, bookId),
    manuscripts: database.prepare(
      'SELECT manuscript_version_id, chapter_id, file_id, content_hash, status FROM manuscript_versions WHERE owner_id = ? AND book_id = ? ORDER BY manuscript_version_id'
    ).all(ownerId, bookId),
    chapterCanon: database.prepare(
      'SELECT chapter_id, current_manuscript_version_id, canon_manuscript_version_id, settlement_status FROM chapters WHERE owner_id = ? AND book_id = ? ORDER BY chapter_id'
    ).all(ownerId, bookId),
    settlements: database.prepare(
      'SELECT stage_settlement_id, stage_type, stage_key, version, canon_revision, irreversible_results_json, status, activated_at FROM stage_settlements WHERE owner_id = ? AND book_id = ? ORDER BY stage_settlement_id'
    ).all(ownerId, bookId),
    artifactVersions: database.prepare(
      'SELECT artifact_version_id, artifact_id, version, content_hash, status FROM artifact_versions WHERE owner_id = ? AND book_id = ? ORDER BY artifact_version_id'
    ).all(ownerId, bookId),
    modelCalls: database.prepare(
      'SELECT request_id, task_id, phase_key, provider, model_id, model_snapshot_id, input_hash, parameters_hash, reservation_id, state FROM model_calls WHERE owner_id = ? AND book_id = ? ORDER BY request_id'
    ).all(ownerId, bookId)
  };
}