import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('卷规划REST流程', () => {
  let context: TestContext | undefined;
  afterEach(() => { context?.close(); context = undefined; });

  it('通过原页接口创建、追加候选并确认当前版本', async () => {
    context = createTestContext('wenmi-volume-plan-api-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '接口卷规划测试' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    preparePrerequisites(context, scope, ids, clock);
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const workflowResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/workflow` });
      expect(workflowResponse.statusCode).toBe(200);
      const workflow = workflowResponse.json().data as { planningVersion: number; stage: string };
      expect(workflow.stage).toBe('setting_confirmed');

      const planResponse = await app.inject({
        method: 'POST', url: `/api/v1/books/${book.bookId}/volume-plans`,
        payload: {
          expectedWorkflowVersion: workflow.planningVersion,
          planNumber: 1,
          idempotencyKey: 'api-create-volume-one'
        }
      });
      expect(planResponse.statusCode).toBe(200);
      const plan = planResponse.json().data as { volumePlanId: string; revision: number };

      const candidateResponse = await app.inject({
        method: 'POST', url: `/api/v1/books/${book.bookId}/volume-plans/${plan.volumePlanId}/versions`,
        payload: {
          expectedPlanRevision: plan.revision,
          candidateKind: 'candidate_a',
          template: {
            selectionMode: 'none', templateKey: null, templateVersion: null, templateHash: null,
            scope: 'volume', beats: [], customDirection: null
          },
          content: volumeContent(),
          idempotencyKey: 'api-volume-candidate-a'
        }
      });
      expect(candidateResponse.statusCode).toBe(200);
      const candidate = candidateResponse.json().data as { volumePlanVersionId: string };

      const planningResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/workflow` });
      const planning = planningResponse.json().data as { planningVersion: number };
      const confirmedResponse = await app.inject({
        method: 'POST', url: `/api/v1/books/${book.bookId}/volume-plans/${plan.volumePlanId}/confirm`,
        payload: {
          volumePlanVersionId: candidate.volumePlanVersionId,
          expectedPlanRevision: 1,
          expectedActiveVersionId: null,
          expectedWorkflowVersion: planning.planningVersion
        }
      });
      expect(confirmedResponse.statusCode).toBe(200);
      expect(confirmedResponse.json().data).toMatchObject({
        revision: 2,
        activeVersionId: candidate.volumePlanVersionId,
        activeVersion: { content: { coreGoal: '让主角取得继续行动的资格' } }
      });

      const listResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/volume-plans` });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().data).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

function preparePrerequisites(
  context: TestContext,
  scope: { ownerId: string; bookId: string },
  ids: SequenceIds,
  clock: FixedClock
): void {
  context.database.prepare(`
    INSERT INTO book_opening_blueprints (
      opening_blueprint_id, owner_id, book_id, version, taxonomy_version, channel,
      category_key, category_name, blueprint_json, content_hash, status, created_at
    ) VALUES (?, ?, ?, 1, 'test-v1', 'male', 'fantasy', '玄幻奇幻', '{}', ?, 'active', ?)
  `).run(ids.next(), scope.ownerId, scope.bookId, '0'.repeat(64), clock.now().toISOString());
  const artifacts = new ArtifactService(context.database, ids, clock);
  const storyBible = artifacts.create(scope, 'story_bible', '设定大纲', {
    title: '设定基线', positioning: {}, worldRules: ['能力必须有来源和代价'], characters: [], mainPlot: {}
  }, 'candidate');
  artifacts.select(scope, storyBible.artifactId, storyBible.artifactVersionId);
  context.database.prepare(`
    UPDATE book_planning_states
    SET version = version + 1, stage = 'setting_ready', setting_baseline_version_id = ?, updated_at = ?
    WHERE owner_id = ? AND book_id = ?
  `).run(storyBible.artifactVersionId, clock.now().toISOString(), scope.ownerId, scope.bookId);
}

function volumeContent() {
  return {
    title: '第一卷·取得资格',
    openingState: '主角刚失去原有退路',
    coreGoal: '让主角取得继续行动的资格',
    coreConflict: '主角的目标与旧规则维护者冲突',
    failureCost: '主角和盟友都会失去退路',
    characterChanges: ['主角从被动求生转向主动选择'],
    eventSequence: [{
      eventId: 'event-1', order: 1, title: '公开选择', responsibility: '建立本卷冲突',
      entryState: '只有线索没有资格', trigger: '普通人因旧规则受损',
      action: '主角验证线索并行动', result: '取得有限资格', leadsToNext: null,
      estimatedChapterRange: { minimum: 6, likely: 8, maximum: 10 }
    }],
    informationPlan: ['确认规则有人操纵'],
    escalationAndRecovery: ['胜利会带来更强反制'],
    endingState: '主角取得资格并被更强对手注意',
    openThreads: ['幕后操纵者是谁'],
    nextVolumeTrigger: '更大范围的反扑开始',
    boundaries: {
      mustAchieve: ['由主角行动改变局面'], mustNotViolate: ['不能无代价变强'],
      creativeFreedom: ['对话与局部反转自由发挥'], openQuestions: ['盟友如何承担代价']
    }
  };
}
