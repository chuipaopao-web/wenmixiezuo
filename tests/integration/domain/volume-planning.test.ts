import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { StageSettlementService } from '../../../apps/api/src/application/continuity/stage-settlement-service.js';
import { VolumePlanService } from '../../../apps/api/src/application/planning/volume-plan-service.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { LongformContinuityRepository } from '../../../apps/api/src/infrastructure/db/repositories/longform-continuity-repository.js';
import { VolumePlanRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-repository.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('版本化卷规划', () => {
  let context: TestContext | undefined;

  afterEach(() => context?.close());

  it('要求已确认设定，并让两个独立候选并存后以CAS确认和切回', () => {
    context = createTestContext('wenmi-volume-plan-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '卷规划测试书', text: '主角在旧秩序失效后寻找新的生存方式'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = createService(context, ids, clock);
    const beforeSetting = service.workflow(scope);
    expect(() => service.create(scope, {
      expectedWorkflowVersion: beforeSetting.planningVersion,
      planNumber: 1,
      idempotencyKey: 'create-volume-before-setting'
    })).toThrow('请先确认开书资料和设定');

    prepareSetting(context, scope, ids, clock);
    const ready = service.workflow(scope);
    expect(ready.stage).toBe('setting_confirmed');
    const plan = service.create(scope, {
      expectedWorkflowVersion: ready.planningVersion,
      planNumber: 1,
      idempotencyKey: 'create-volume-one'
    });
    expect(plan).toMatchObject({ planNumber: 1, revision: 1, status: 'planning', activeVersionId: null });
    expect(service.create(scope, {
      expectedWorkflowVersion: ready.planningVersion,
      planNumber: 1,
      idempotencyKey: 'create-volume-one'
    }).volumePlanId).toBe(plan.volumePlanId);

    const candidateA = service.addVersion(scope, plan.volumePlanId, {
      expectedPlanRevision: 1,
      candidateKind: 'candidate_a',
      template: noTemplate(),
      content: volumeContent('主动破局', '主角公开挑战旧规则'),
      idempotencyKey: 'volume-one-candidate-a'
    });
    const candidateB = service.addVersion(scope, plan.volumePlanId, {
      expectedPlanRevision: 1,
      candidateKind: 'candidate_b',
      template: noTemplate(),
      content: volumeContent('暗中布局', '主角先联合受损者再挑战旧规则'),
      idempotencyKey: 'volume-one-candidate-b'
    });
    expect([candidateA.version, candidateB.version]).toEqual([1, 2]);
    expect(service.listVersions(scope, plan.volumePlanId)).toHaveLength(2);
    expect(service.impactPreview(scope, plan.volumePlanId, candidateA.volumePlanVersionId))
      .toMatchObject({ activeVersionId: null, downstreamDependencyCount: 0 });

    const planning = service.workflow(scope);
    const confirmedA = service.confirm(scope, plan.volumePlanId, {
      volumePlanVersionId: candidateA.volumePlanVersionId,
      expectedPlanRevision: 1,
      expectedActiveVersionId: null,
      expectedWorkflowVersion: planning.planningVersion
    });
    expect(confirmedA).toMatchObject({ revision: 2, activeVersionId: candidateA.volumePlanVersionId });
    expect(service.workflow(scope).stage).toBe('volume_plan_confirmed');

    expect(() => service.confirm(scope, plan.volumePlanId, {
      volumePlanVersionId: candidateB.volumePlanVersionId,
      expectedPlanRevision: 1,
      expectedActiveVersionId: null,
      expectedWorkflowVersion: planning.planningVersion
    })).toThrow('卷规划确认版已经变化');

    const authorEdit = service.addVersion(scope, plan.volumePlanId, {
      expectedPlanRevision: 2,
      candidateKind: 'author_edit',
      parentVersionId: candidateA.volumePlanVersionId,
      template: noTemplate(),
      content: volumeContent('主动破局', '主角公开挑战旧规则，但保住普通人的退路'),
      idempotencyKey: 'volume-one-author-edit'
    });
    const confirmedEdit = service.confirm(scope, plan.volumePlanId, {
      volumePlanVersionId: authorEdit.volumePlanVersionId,
      expectedPlanRevision: 2,
      expectedActiveVersionId: candidateA.volumePlanVersionId,
      expectedWorkflowVersion: service.workflow(scope).planningVersion
    });
    expect(confirmedEdit.activeVersionId).toBe(authorEdit.volumePlanVersionId);
    const switchedBack = service.confirm(scope, plan.volumePlanId, {
      volumePlanVersionId: candidateA.volumePlanVersionId,
      expectedPlanRevision: 3,
      expectedActiveVersionId: authorEdit.volumePlanVersionId,
      expectedWorkflowVersion: service.workflow(scope).planningVersion
    });
    expect(switchedBack).toMatchObject({ revision: 4, activeVersionId: candidateA.volumePlanVersionId });
  });

  it('下一卷必须引用上一卷确认版和真实卷结算，且跨书无法读取', () => {
    context = createTestContext('wenmi-next-volume-plan-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const firstBook = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '第一本书' });
    const secondBook = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '第二本书' });
    const firstScope = { ownerId: context.config.ownerId, bookId: firstBook.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: secondBook.bookId };
    prepareSetting(context, firstScope, ids, clock);
    const service = createService(context, ids, clock);
    const firstPlan = service.create(firstScope, {
      expectedWorkflowVersion: service.workflow(firstScope).planningVersion,
      planNumber: 1,
      idempotencyKey: 'next-volume-first-plan'
    });
    const firstCandidate = service.addVersion(firstScope, firstPlan.volumePlanId, {
      expectedPlanRevision: 1,
      candidateKind: 'candidate_a', template: noTemplate(),
      content: volumeContent('站稳脚跟', '主角取得第一个可验证成果'),
      idempotencyKey: 'next-volume-first-candidate'
    });
    service.confirm(firstScope, firstPlan.volumePlanId, {
      volumePlanVersionId: firstCandidate.volumePlanVersionId,
      expectedPlanRevision: 1,
      expectedActiveVersionId: null,
      expectedWorkflowVersion: service.workflow(firstScope).planningVersion
    });
    context.database.prepare(`
      UPDATE creation_workflow_states SET stage = 'ready_for_next_volume'
      WHERE owner_id = ? AND book_id = ?
    `).run(firstScope.ownerId, firstScope.bookId);
    expect(() => service.create(firstScope, {
      expectedWorkflowVersion: service.workflow(firstScope).planningVersion,
      planNumber: 2,
      idempotencyKey: 'next-volume-without-settlement'
    })).toThrow('请先完成上一卷结算');

    new StageSettlementService(
      new LongformContinuityRepository(context.database), new UnitOfWork(context.database), ids, clock
    ).build(firstScope, {
      stageType: 'volume',
      stageKey: firstPlan.volumePlanId,
      chapterStart: 1,
      chapterEnd: 60,
      canonRevision: 12,
      payload: {
        irreversibleResults: ['主角取得公开行动资格'], entityStates: [], closedThreads: [],
        openThreads: ['旧规则幕后操纵者尚未现身'], relationshipChanges: [], knowledgeChanges: [],
        resourceChanges: [], ruleChanges: [], exclusions: []
      },
      sources: [{
        sourceType: 'canon_volume', sourceId: firstPlan.volumePlanId,
        sourceHash: 'a'.repeat(64), locator: { chapters: [1, 60] }
      }],
      probes: [{ type: 'fact', expected: true, actual: true, passed: true }]
    });
    const secondPlan = service.create(firstScope, {
      expectedWorkflowVersion: service.workflow(firstScope).planningVersion,
      planNumber: 2,
      idempotencyKey: 'next-volume-after-settlement'
    });
    expect(secondPlan).toMatchObject({
      planNumber: 2,
      previousVolumePlanId: firstPlan.volumePlanId
    });
    expect(secondPlan.previousSettlementId).not.toBeNull();
    expect(() => service.get(secondScope, firstPlan.volumePlanId)).toThrow('当前书籍中没有这个卷规划');
  });
});

function createService(context: TestContext, ids: SequenceIds, clock: FixedClock): VolumePlanService {
  return new VolumePlanService(
    new VolumePlanRepository(context.database), new UnitOfWork(context.database), ids, clock
  );
}

function prepareSetting(
  context: TestContext,
  scope: { ownerId: string; bookId: string },
  ids: SequenceIds,
  clock: FixedClock
): void {
  const opening = context.database.prepare(`
    SELECT 1 FROM book_opening_blueprints
    WHERE owner_id = ? AND book_id = ? AND status = 'active'
  `).get(scope.ownerId, scope.bookId);
  if (opening === undefined) {
    context.database.prepare(`
      INSERT INTO book_opening_blueprints (
        opening_blueprint_id, owner_id, book_id, version, taxonomy_version, channel,
        category_key, category_name, blueprint_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, 1, 'test-v1', 'male', 'fantasy', '玄幻奇幻', '{}', ?, 'active', ?)
    `).run(ids.next(), scope.ownerId, scope.bookId, '0'.repeat(64), clock.now().toISOString());
  }
  const artifacts = new ArtifactService(context.database, ids, clock);
  const storyBible = artifacts.create(scope, 'story_bible', '设定大纲', {
    title: '设定基线',
    positioning: {},
    worldRules: ['任何能力都要有来源和代价'],
    characters: [],
    mainPlot: {}
  }, 'candidate');
  artifacts.select(scope, storyBible.artifactId, storyBible.artifactVersionId);
  context.database.prepare(`
    UPDATE book_planning_states
    SET version = version + 1, stage = 'setting_ready', setting_baseline_version_id = ?, updated_at = ?
    WHERE owner_id = ? AND book_id = ?
  `).run(storyBible.artifactVersionId, clock.now().toISOString(), scope.ownerId, scope.bookId);
}

function noTemplate() {
  return {
    selectionMode: 'none', templateKey: null, templateVersion: null, templateHash: null,
    scope: 'volume', beats: [], customDirection: null
  };
}

function volumeContent(title: string, result: string) {
  return {
    title,
    openingState: '主角刚失去旧有退路，只掌握有限线索',
    coreGoal: '让主角取得继续追查真相的资格',
    coreConflict: '主角的生存目标与旧规则维护者正面冲突',
    failureCost: '主角失去行动资格，盟友也会承担连带代价',
    characterChanges: ['主角从被动求生转向主动承担选择后果'],
    eventSequence: [{
      eventId: 'event-1', order: 1, title: '第一次公开选择',
      responsibility: '把本卷核心冲突变成主角必须处理的现实问题',
      entryState: '主角只有线索，没有公开行动资格',
      trigger: '旧规则开始伤害与主角有关的普通人',
      action: '主角验证线索并作出有代价的选择',
      result,
      leadsToNext: null,
      estimatedChapterRange: { minimum: 6, likely: 8, maximum: 10 }
    }],
    informationPlan: ['确认旧规则并非自然形成'],
    escalationAndRecovery: ['每次局部胜利都暴露更深一层阻力'],
    endingState: '主角取得有限资格，同时被更强对手注意',
    openThreads: ['幕后操纵者的真实目的'],
    nextVolumeTrigger: '局部胜利触发更大范围的规则反扑',
    boundaries: {
      mustAchieve: ['主角必须通过自己的行动改变局面'],
      mustNotViolate: ['不能无代价获得压倒性力量'],
      creativeFreedom: ['具体场景、对话、局部反转由编剧自由设计'],
      openQuestions: ['盟友会以何种方式承担选择后果']
    }
  };
}
