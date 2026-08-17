import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { ContextPackService } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { CreationWorkflowProgressService } from '../../../apps/api/src/application/creation/creation-workflow-progress-service.js';
import { StageSettlementService } from '../../../apps/api/src/application/continuity/stage-settlement-service.js';
import { CreationSettlementService } from '../../../apps/api/src/application/planning/creation-settlement-service.js';
import { EventChapterOutlineService } from '../../../apps/api/src/application/planning/event-chapter-outline-service.js';
import {
  parsePacingOutput,
  parseSummaryOutput,
  SettlementFollowUpPipelineService
} from '../../../apps/api/src/application/planning/settlement-follow-up-pipeline-service.js';
import { SettlementFollowUpService } from '../../../apps/api/src/application/planning/settlement-follow-up-service.js';
import { StoryEventService } from '../../../apps/api/src/application/planning/story-event-service.js';
import { VolumePlanService } from '../../../apps/api/src/application/planning/volume-plan-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { CreationSettlementRepository } from '../../../apps/api/src/infrastructure/db/repositories/creation-settlement-repository.js';
import { EventChapterOutlineRepository } from '../../../apps/api/src/infrastructure/db/repositories/event-chapter-outline-repository.js';
import { LongformContinuityRepository } from '../../../apps/api/src/infrastructure/db/repositories/longform-continuity-repository.js';
import { OpeningBlueprintRepository } from '../../../apps/api/src/infrastructure/db/repositories/opening-blueprint-repository.js';
import { SettlementFollowUpRepository } from '../../../apps/api/src/infrastructure/db/repositories/settlement-follow-up-repository.js';
import { StoryEventRepository } from '../../../apps/api/src/infrastructure/db/repositories/story-event-repository.js';
import { VolumePlanGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-generation-repository.js';
import { VolumePlanRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('结算后续：主编节奏体检与副编摘要', () => {
  let context: TestContext | undefined;
  afterEach(() => { context?.close(); context = undefined; });

  it('事件结算后由主编出节奏体检、副编写大白话摘要，并可经接口读取', async () => {
    context = createTestContext('wenmi-settlement-follow-up-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const unitOfWork = new UnitOfWork(context.database);
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '结算后续测试书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepare(context, scope, ids, clock);
    const eventId = settleOneEvent(context, scope, ids, clock, unitOfWork);

    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const budgets = new BudgetService(context.database, ids, clock);
    const repository = new SettlementFollowUpRepository(context.database);
    const service = new SettlementFollowUpService(
      repository,
      new CreationSettlementRepository(context.database),
      new OpeningBlueprintRepository(context.database),
      new VolumePlanGenerationRepository(context.database),
      tasks,
      unitOfWork,
      ids,
      clock
    );

    const scheduled = service.start(scope, 'event', eventId);
    expect(scheduled.status).toBe('queued');
    expect(scheduled.pacingReport).toBeNull();
    expect(scheduled.summary).toBeNull();
    // 同一结算对象重复发起保持幂等
    expect(service.start(scope, 'event', eventId).taskId).toBe(scheduled.taskId);

    const claim = tasks.claimNext('worker-settlement-follow-up', 120_000);
    expect(claim?.taskId).toBe(scheduled.taskId);
    const pipeline = new SettlementFollowUpPipelineService(
      repository,
      tasks,
      budgets,
      new ModelCallService(context.database, clock, budgets),
      new ContextPackService(context.database, ids, clock),
      ids,
      clock,
      new ModelAdapterFactory(context.config.modelRuntime)
    );
    const result = await pipeline.executeClaimed(scope, scheduled.taskId, 'worker-settlement-follow-up', {
      leaseToken: claim!.leaseToken!,
      attemptNo: claim!.currentAttemptNo
    });
    expect(result).toMatchObject({ status: 'succeeded', pacingReady: true, summaryReady: true });

    const view = service.view(scope, 'event', eventId);
    expect(view?.status).toBe('succeeded');
    expect(view?.pacingReport).toMatchObject({
      overallAssessment: expect.any(String),
      payoffPlacement: expect.any(String),
      climaxSpacing: expect.any(String),
      pressureDuration: expect.any(String),
      recoveryBeats: expect.any(String)
    });
    expect((view?.pacingReport as { risks: string[] }).risks.length).toBeGreaterThan(0);
    expect(typeof view?.summary).toBe('string');
    expect(view?.summary).toContain('公开选择');
    expect(view?.pacingBy?.displayName).toContain('貂蝉');
    expect(view?.summaryBy?.displayName).toContain('西施');

    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/books/${book.bookId}/story-events/${eventId}/settlement/follow-up`
      });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.pacingReport.overallAssessment).toEqual(expect.any(String));
      expect(data.summary).toContain('公开选择');
      const missing = await app.inject({
        method: 'GET',
        url: `/api/v1/books/${book.bookId}/story-events/not-exist/settlement/follow-up`
      });
      expect(missing.statusCode).toBe(200);
      expect(missing.json().data).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('结算未完成时不能发起后续任务', () => {
    context = createTestContext('wenmi-settlement-follow-up-guard-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '后续守卫书' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettlementFollowUpService(
      new SettlementFollowUpRepository(context.database),
      new CreationSettlementRepository(context.database),
      new OpeningBlueprintRepository(context.database),
      new VolumePlanGenerationRepository(context.database),
      new TaskService(context.database, context.config.releaseId, clock),
      new UnitOfWork(context.database),
      ids,
      clock
    );
    expect(() => service.start(scope, 'event', 'no-such-event')).toThrowError(/结算尚未完成/);
  });

  it('节奏体检与摘要输出解析器拒绝缺字段的JSON', () => {
    expect(() => parsePacingOutput(JSON.stringify({ overallAssessment: '只有总评' }))).toThrow();
    const pacing = parsePacingOutput(JSON.stringify({
      overallAssessment: '总评', payoffPlacement: '爽点', climaxSpacing: '高潮',
      pressureDuration: '压抑', recoveryBeats: '恢复', risks: ['风险'], suggestions: ['建议']
    }));
    expect(pacing.risks).toEqual(['风险']);
    expect(() => parseSummaryOutput(JSON.stringify({ note: '没有摘要字段' }))).toThrow();
    expect(parseSummaryOutput(JSON.stringify({ summary: ' 大白话摘要 ' })).summary).toBe('大白话摘要');
  });
});

function settleOneEvent(
  context: TestContext,
  scope: { ownerId: string; bookId: string },
  ids: SequenceIds,
  clock: FixedClock,
  unitOfWork: UnitOfWork
): string {
  const volumeRepo = new VolumePlanRepository(context.database);
  const volumes = new VolumePlanService(volumeRepo, unitOfWork, ids, clock);
  const plan = volumes.create(scope, {
    expectedWorkflowVersion: volumes.workflow(scope).planningVersion,
    planNumber: 1,
    idempotencyKey: 'follow-up-volume'
  });
  const volumeVersion = volumes.addVersion(scope, plan.volumePlanId, {
    expectedPlanRevision: plan.revision,
    candidateKind: 'author_edit',
    template: noTemplate('volume'),
    content: volumeContent(),
    idempotencyKey: 'follow-up-volume-v1'
  });
  volumes.confirm(scope, plan.volumePlanId, {
    volumePlanVersionId: volumeVersion.volumePlanVersionId,
    expectedPlanRevision: plan.revision,
    expectedActiveVersionId: null,
    expectedWorkflowVersion: volumes.workflow(scope).planningVersion
  });
  const events = new StoryEventService(new StoryEventRepository(context.database), unitOfWork, ids, clock);
  const chain = events.initialize(scope, plan.volumePlanId, {
    expectedWorkflowVersion: volumes.workflow(scope).planningVersion,
    idempotencyKey: 'follow-up-events'
  });
  const event = chain.events[0]!;
  const eventVersion = events.addVersion(scope, event.eventId, {
    expectedEventRevision: event.revision,
    candidateKind: 'author_edit',
    template: noTemplate('event'),
    content: eventContent(),
    idempotencyKey: 'follow-up-event-v1'
  });
  events.confirm(scope, event.eventId, {
    versionId: eventVersion.storyEventVersionId,
    expectedEventRevision: event.revision,
    expectedWorkflowVersion: volumes.workflow(scope).planningVersion
  });
  const outlines = new EventChapterOutlineService(
    new EventChapterOutlineRepository(context.database), unitOfWork,
    new ArtifactService(context.database, ids, clock), ids, clock
  );
  const sequence = outlines.initialize(scope, event.eventId, {
    expectedWorkflowVersion: volumes.workflow(scope).planningVersion,
    idempotencyKey: 'follow-up-sequence'
  });
  const sequenceVersion = outlines.addSequenceVersion(scope, event.eventId, {
    expectedSequenceRevision: sequence.revision,
    content: sequenceContent(),
    idempotencyKey: 'follow-up-sequence-v1'
  });
  const confirmed = outlines.confirmSequence(scope, event.eventId, {
    sequenceVersionId: sequenceVersion.sequenceVersionId,
    expectedSequenceRevision: sequence.revision,
    expectedWorkflowVersion: volumes.workflow(scope).planningVersion
  });
  const versions = confirmed.outlines.map((outline, index) => outlines.addOutlineVersion(scope, outline.outlineId, {
    expectedOutlineRevision: outline.revision,
    content: detailedContent(outline.chapterNumber, index === 2),
    idempotencyKey: 'follow-up-outline-' + outline.chapterNumber
  }));
  const latest = outlines.get(scope, event.eventId)!;
  outlines.freezeRecent(scope, event.eventId, {
    items: latest.outlines.map((outline, index) => ({
      outlineId: outline.outlineId,
      outlineVersionId: versions[index]!.outlineVersionId,
      expectedOutlineRevision: outline.revision
    })),
    expectedWorkflowVersion: volumes.workflow(scope).planningVersion
  });
  const continuity = new LongformContinuityRepository(context.database);
  const stageService = new StageSettlementService(continuity, unitOfWork, ids, clock);
  for (const chapterNumber of [1, 2, 3]) {
    const built = stageService.build(scope, {
      stageType: 'chapter',
      stageKey: 'chapter-' + chapterNumber,
      chapterStart: chapterNumber,
      chapterEnd: chapterNumber,
      canonRevision: 0,
      payload: {
        irreversibleResults: [`第${chapterNumber}章实际结果`],
        entityStates: { 主角: `状态${chapterNumber}` },
        closedThreads: chapterNumber === 3 ? ['本事件问题'] : [],
        openThreads: chapterNumber === 3 ? ['下一事件追查'] : ['本事件问题'],
        relationshipChanges: [],
        knowledgeChanges: [`获得线索${chapterNumber}`],
        resourceChanges: [],
        ruleChanges: [],
        exclusions: ['未定稿内容']
      },
      sources: [{
        sourceType: 'canon_manuscript',
        sourceId: 'manuscript-' + chapterNumber,
        sourceHash: String(chapterNumber).repeat(64),
        locator: { chapterNumber }
      }],
      probes: [{ type: 'source', expected: 1, actual: 1, passed: true }]
    });
    expect(built.activated).toBe(true);
  }
  const progress = new CreationWorkflowProgressService(context.database);
  progress.markChapterSettled(scope, 1);
  progress.markChapterSettled(scope, 2);
  expect(progress.markChapterSettled(scope, 3).stage).toBe('event_settlement_in_progress');
  const settlements = new CreationSettlementService(
    new CreationSettlementRepository(context.database), continuity, stageService, ids, clock
  );
  const settled = settlements.settleEvent(scope, event.eventId, volumes.workflow(scope).planningVersion);
  expect(settled.stageKind).toBe('event');
  return event.eventId;
}

function prepare(context: TestContext, scope: { ownerId: string; bookId: string }, ids: SequenceIds, clock: FixedClock) {
  context.database.prepare("INSERT INTO book_opening_blueprints(opening_blueprint_id,owner_id,book_id,version,taxonomy_version,channel,category_key,category_name,blueprint_json,content_hash,status,created_at) VALUES(?,?,?,1,'test','male','fantasy','玄幻','{}',?,'active',?)")
    .run(ids.next(), scope.ownerId, scope.bookId, '0'.repeat(64), clock.now().toISOString());
  const artifacts = new ArtifactService(context.database, ids, clock);
  const bible = artifacts.create(scope, 'story_bible', '设定大纲', {
    title: '设定', positioning: {}, worldRules: ['能力有来源和代价'], characters: [], mainPlot: {}
  }, 'candidate');
  artifacts.select(scope, bible.artifactId, bible.artifactVersionId);
  context.database.prepare("UPDATE book_planning_states SET version=version+1,stage='setting_ready',setting_baseline_version_id=?,updated_at=? WHERE owner_id=? AND book_id=?")
    .run(bible.artifactVersionId, clock.now().toISOString(), scope.ownerId, scope.bookId);
}
function noTemplate(scope: 'volume' | 'event') {
  return { selectionMode: 'none', templateKey: null, templateVersion: null, templateHash: null, scope, beats: [], customDirection: null };
}
function volumeContent() {
  return {
    title: '第一卷', openingState: '主角失去退路', coreGoal: '取得行动资格', coreConflict: '与旧规则冲突',
    failureCost: '盟友受损', characterChanges: ['学会承担选择'],
    eventSequence: [{
      eventId: 'seed-1', order: 1, title: '公开选择',
      responsibility: '建立卷冲突', entryState: '只有线索', trigger: '同伴受损', action: '公开行动', result: '取得有限资格',
      leadsToNext: null, estimatedChapterRange: { minimum: 3, likely: 3, maximum: 5 }
    }],
    informationPlan: ['揭示规则由人操纵'], escalationAndRecovery: ['进展引发反制'], endingState: '站稳脚跟',
    openThreads: ['幕后人'], nextVolumeTrigger: '幕后人出手',
    boundaries: { mustAchieve: ['主角行动改变局面'], mustNotViolate: ['不能无代价变强'], creativeFreedom: ['对白与场景自由'], openQuestions: [] }
  };
}
function eventContent() {
  return {
    title: '公开选择', volumeResponsibility: '把卷冲突变成现实问题', startingState: '事件开始状态',
    trigger: '同伴受损', participants: ['主角', '盟友'], characterGoals: ['守住行动资格'], obstacles: ['证据不足'],
    choicesAndCosts: ['公开行动并承担身份暴露'], informationMoves: ['确认规则由人操纵'], localProgression: ['试探', '受阻', '选择'],
    requiredResult: '主角取得有限资格并留下可追查证据', flexibleExecution: ['场景、对白和局部解法自由'],
    endingConditions: ['主角取得能被下一事件承接的证据'], nextEventImpact: '对手开始追查主角',
    characterArcImpact: '主角开始承担后果', volumeClimaxImpact: '积累卷末证据',
    estimatedChapterRange: { minimum: 3, likely: 3, maximum: 5 }, uncertaintyNotes: ['幕后人的身份仍未知']
  };
}
function sequenceContent() {
  return {
    eventTitle: '公开选择', startChapterNumber: 1, eventEndingConditions: ['主角取得能被下一事件承接的证据'],
    closureCoverage: [{ endingCondition: '主角取得能被下一事件承接的证据', evidenceChapterNumber: 3 }],
    flexibilityNotes: ['未冻结部分可滚动调整'],
    chapters: [
      coarse(1, '第一次违令', '事件开始状态', '第一章结束状态'),
      coarse(2, '问责中的证据', '第一章结束状态', '第二章结束状态'),
      coarse(3, '承担公开代价', '第二章结束状态', '主角取得能被下一事件承接的证据')
    ]
  };
}
function coarse(chapterNumber: number, title: string, openingState: string, endingState: string) {
  return {
    chapterNumber, title,
    eventResponsibility: '推进事件并改变状态', openingState, characterGoals: ['保护证据'], conflicts: ['规则阻拦'],
    choicesAndCosts: ['行动会暴露身份'], informationChanges: ['危机不是偶然'], storyBeats: ['后果', '受阻', '选择'], endingState,
    nextChapterInterface: endingState, softSuggestions: ['保持自然'], creativeFreedom: ['对白与动作自由']
  };
}
function detailedContent(chapterNumber: number, last: boolean) {
  return {
    outlineSchema: 'chapter_outline_v2', chapterNumber, title: '第' + chapterNumber + '章',
    sourceStage: { stageNumber: 1, title: '服务端覆盖', chapterRange: { start: 1, end: 3 } }, chapterFunction: '服务端覆盖',
    openingState: '服务端覆盖', requiredEndingState: '服务端覆盖',
    cast: [{ name: '主角', objective: '保护证据', knowledgeBoundary: '不知道幕后人', chapterRole: '作出选择', stateChange: '承担后果' }],
    conflict: { surface: '规则阻拦', failureCost: '证据丢失', successCost: '身份暴露' },
    plotBeats: [
      { order: 1, trigger: '后果出现', action: '核验证据', result: '确认问题' },
      { order: 2, trigger: '受阻', action: '改变方案', turn: '承担责任', result: '获得支持' },
      { order: 3, trigger: '封锁', action: '付出代价', result: '局面改变' }
    ],
    experience: { primaryTone: '紧张', emotionalCurve: ['压迫', '决断'], payoffPoints: ['选择见效'], pressurePoints: ['关系受损'], readerEffect: '期待后果' },
    descriptionFocus: { primary: ['人物选择'], secondary: ['环境压力'], compress: ['重复解释'] },
    informationControl: { reveals: ['危机有人推动'], concealed: ['幕后人身份'], gaps: ['信息差'] },
    threadActions: last ? [{ action: 'advance', summary: '幕后人开始反制' }] : [],
    ending: { result: '状态改变', stateChanges: ['承担代价'], hook: '新问题逼近', nextChapterInterface: '服务端覆盖' },
    mustImplement: ['体现选择与代价'], mustNotViolate: ['不能新增无来源能力'], allowedCandidates: ['局部误判'],
    creativeFreedom: ['对白、动作、意象和场景调度自由']
  };
}
