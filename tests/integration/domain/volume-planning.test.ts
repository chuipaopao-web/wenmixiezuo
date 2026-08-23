import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { ContextPackService } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { CreationWorkflowProgressService } from '../../../apps/api/src/application/creation/creation-workflow-progress-service.js';
import { directionCoverageKeys, eventChainOutputTokenLimit, eventChainValidationRetryInstruction, EventChainGenerationPipelineService, parseEventChainModelOutput, settleEventChainCandidates, shouldAcceptEventChainCandidateCoverageGap, shouldNormalizeMisplacedFirstVolumeResponsibilities, shouldRetryKnownEmptyEventChainOutput } from '../../../apps/api/src/application/planning/event-chain-generation-pipeline-service.js';
import { eventChainCandidateModelPriority, EventChainGenerationService, selectEventChainSecondDesigner } from '../../../apps/api/src/application/planning/event-chain-generation-service.js';
import { AuthorCollaborationService } from '../../../apps/api/src/application/planning/author-collaboration-service.js';
import { StoryEventService } from '../../../apps/api/src/application/planning/story-event-service.js';
import { CoreWorkflowV6Service } from '../../../apps/api/src/application/planning/core-workflow-v6-service.js';
import { StoryThreadService } from '../../../apps/api/src/application/planning/story-thread-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { StageSettlementService } from '../../../apps/api/src/application/continuity/stage-settlement-service.js';
import { LayeredPlanningService } from '../../../apps/api/src/application/planning/layered-planning-service.js';
import { VolumePlanService } from '../../../apps/api/src/application/planning/volume-plan-service.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { LayeredPlanningRepository } from '../../../apps/api/src/infrastructure/db/repositories/layered-planning-repository.js';
import { LongformContinuityRepository } from '../../../apps/api/src/infrastructure/db/repositories/longform-continuity-repository.js';
import { CreationSettlementRepository } from '../../../apps/api/src/infrastructure/db/repositories/creation-settlement-repository.js';
import { VolumePlanRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-repository.js';
import { VolumePlanGenerationRepository, type VolumePlanGenerationSeat } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-generation-repository.js';
import { StoryEventRepository } from '../../../apps/api/src/infrastructure/db/repositories/story-event-repository.js';
import { AuthorPlanningInputRepository } from '../../../apps/api/src/infrastructure/db/repositories/author-planning-input-repository.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { ModelAdapterError } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { PromotionService } from '../../../apps/api/src/infrastructure/recovery/promotion-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('版本化卷规划', () => {
  let context: TestContext | undefined;

  afterEach(() => context?.close());

  it('事件链结构纠错只允许稳定首卷责任键，不放宽硬合同', async () => {
    const instruction = eventChainValidationRetryInstruction('首卷责任无效。');
    expect(instruction).toContain('opening_launch');
    expect(instruction).toContain('major_climax_before_100k');
    expect(instruction).toContain('不得改写成中文标签');
    expect(instruction).toContain('重新输出完整JSON');
    expect(eventChainValidationRetryInstruction('首卷责任无效。', false))
      .toContain('所有firstVolumeResponsibilities都必须是空数组');
    expect(eventChainOutputTokenLimit('glm-5.3')).toBe(24_000);
    expect(eventChainOutputTokenLimit('glm-5.3', true)).toBe(32_000);
    expect(eventChainOutputTokenLimit('deepseek-v4-pro')).toBe(9_000);
    expect(eventChainCandidateModelPriority('glm-5.3')).toBeLessThan(
      eventChainCandidateModelPriority('kimi-k2.7-code')
    );
    const seat = (roleKey: string, modelId: string): VolumePlanGenerationSeat => ({
      roleKey, modelId, agentId: roleKey, displayName: roleKey,
      modelSnapshotId: roleKey + '-snapshot', provider: 'volcengine-ark-agent-plan', editor: false
    });
    expect(selectEventChainSecondDesigner(seat('lead_screenwriter', 'deepseek-v4-pro'), [
      seat('second_screenwriter', 'glm-5.3'), seat('third_screenwriter', 'kimi-k2.7-code')
    ])?.roleKey).toBe('third_screenwriter');
    const knownEmpty = new ModelAdapterError('已执行但没有形成可提交文字', 'technical_failure', true, 200, false);
    expect(shouldRetryKnownEmptyEventChainOutput(knownEmpty, 1)).toBe(true);
    expect(shouldRetryKnownEmptyEventChainOutput(knownEmpty, 2)).toBe(false);
    expect(shouldRetryKnownEmptyEventChainOutput(
      new ModelAdapterError('供应商结果状态未知', 'technical_failure', false, undefined, true), 1
    )).toBe(false);
    const coverageGap = new Error('事件链没有覆盖卷方向责任：escalation_5');
    expect(shouldAcceptEventChainCandidateCoverageGap(coverageGap, 'candidate_a', 2)).toBe(true);
    expect(shouldAcceptEventChainCandidateCoverageGap(coverageGap, 'candidate_a', 1)).toBe(false);
    expect(shouldAcceptEventChainCandidateCoverageGap(coverageGap, 'fusion', 2)).toBe(false);
    const invalidFirstVolumeMapping = new Error('首卷责任无效。');
    expect(shouldNormalizeMisplacedFirstVolumeResponsibilities(
      invalidFirstVolumeMapping, 'candidate_b', 2
    )).toBe(true);
    expect(shouldNormalizeMisplacedFirstVolumeResponsibilities(
      invalidFirstVolumeMapping, 'candidate_b', 1
    )).toBe(false);
    expect(shouldNormalizeMisplacedFirstVolumeResponsibilities(
      invalidFirstVolumeMapping, 'fusion', 2
    )).toBe(false);
    expect(shouldNormalizeMisplacedFirstVolumeResponsibilities(
      invalidFirstVolumeMapping, 'candidate_b', 2, false
    )).toBe(false);
    const direction = directionContent();
    const candidate = eventChainContent('model-supplied-stale-id', directionCoverageKeys(direction));
    (candidate.events[0]!.firstVolumeResponsibilities as string[]).push('major_choice');
    const candidateOutput = JSON.stringify({ eventChain: candidate });
    expect(() => parseEventChainModelOutput(candidateOutput, 1, direction)).toThrow('首卷责任无效');
    const normalized = parseEventChainModelOutput(candidateOutput, 1, direction, {
      normalizeMisplacedFirstVolumeResponsibilities: true,
      directionVersionId: 'active-direction-version'
    });
    expect(normalized.volumeDirectionVersionId).toBe('active-direction-version');
    expect(normalized.events[0]?.firstVolumeResponsibilities).not.toContain('major_choice');
    const zeroStorylineChain = parseEventChainModelOutput(JSON.stringify({ eventChain: eventChainContent('active-direction-version', directionCoverageKeys(direction)) }), 1, direction, { directionVersionId: 'active-direction-version' });
    expect(zeroStorylineChain.events[0]).toMatchObject({ leadingStorylineId: null, supportingStorylineIds: [], intersectionNote: null }); // 零故事线卷的事件链保持线路字段为空
    (candidate.events[0]!.firstVolumeResponsibilities as string[]).push('invented-responsibility');
    expect(() => parseEventChainModelOutput(JSON.stringify({ eventChain: candidate }), 1, direction, {
      normalizeMisplacedFirstVolumeResponsibilities: true
    })).toThrow('首卷责任无效');
    let finishSecond!: (value: string) => void;
    const collected = settleEventChainCandidates(
      Promise.reject(new Error('第一席失败')),
      new Promise<string>((resolve) => { finishSecond = resolve; })
    );
    let collectionSettled = false;
    const observed = collected.catch((error: unknown) => { collectionSettled = true; return error; });
    await Promise.resolve();
    expect(collectionSettled).toBe(false);
    finishSecond('第二席完成');
    await expect(observed).resolves.toMatchObject({ message: '第一席失败' });
    expect(collectionSettled).toBe(true);
  });

  it('要求已确认设定，并让两个独立候选并存后以CAS确认和切回', async () => {
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

    const inheritedVolumeIdea = new AuthorCollaborationService(
      new AuthorPlanningInputRepository(context.database), new UnitOfWork(context.database), ids, clock
    ).create(scope, {
      surface: 'volume_plan', subjectType: 'volume_plan', subjectId: plan.volumePlanId, intentStrength: 'must',
      originalText: '本卷后续事件链必须保留十个阶段，守夜、抢修和掌门试局不能合并。',
      attachmentRefs: [], mentionedAgentIds: [], scopeNotes: '卷方向确认后继续约束事件链',
      idempotencyKey: 'inherited-volume-chain-idea'
    });

    const candidateA = service.addVersion(scope, plan.volumePlanId, {
      expectedPlanRevision: 1,
      candidateKind: 'candidate_a',
      authorInputRefs: [inheritedVolumeIdea.authorInputId],
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
    const layered = createLayered(context, ids, clock);
    const directions = layered.listDirections(scope, plan.volumePlanId);
    expect(directions).toHaveLength(2);
    expect(directions.every((item) => !('eventSequence' in item.content))).toBe(true);
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
    const activeDirection = layered.listDirections(scope, plan.volumePlanId).find((item) => item.status === 'active');
    expect(activeDirection?.legacyVolumePlanVersionId).toBe(candidateA.volumePlanVersionId);
    const preliminaryChain = layered.addEventChain(scope, plan.volumePlanId, {
      planNumber: 1,
      content: eventChainContent(activeDirection!.volumeDirectionVersionId, directionCoverageKeys(activeDirection!.content)),
      idempotencyKey: 'preliminary-chain-before-direction-change'
    });
    layered.confirmEventChain(scope, plan.volumePlanId, preliminaryChain.id);
    expect(layered.activeEventChain(scope, plan.volumePlanId)?.id).toBe(preliminaryChain.id);

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
    expect(layered.activeEventChain(scope, plan.volumePlanId)).toBeNull();
    expect(layered.listEventChains(scope, plan.volumePlanId).find(item=>item.id===preliminaryChain.id)?.status).toBe('superseded');
    const switchedBack = service.confirm(scope, plan.volumePlanId, {
      volumePlanVersionId: candidateA.volumePlanVersionId,
      expectedPlanRevision: 3,
      expectedActiveVersionId: authorEdit.volumePlanVersionId,
      expectedWorkflowVersion: service.workflow(scope).planningVersion
    });
    expect(switchedBack).toMatchObject({ revision: 4, activeVersionId: candidateA.volumePlanVersionId });

    const teamRepository = new VolumePlanGenerationRepository(context.database);
    const taskService = new TaskService(context.database, context.config.releaseId, clock);
    const budgetService = new BudgetService(context.database, ids, clock);
    const chainIdea = new AuthorCollaborationService(
      new AuthorPlanningInputRepository(context.database), new UnitOfWork(context.database), ids, clock
    ).create(scope, {
      surface: 'event', subjectType: 'event_sequence', subjectId: plan.volumePlanId,
      intentStrength: 'must', originalText: '本卷必须拆成十个彼此独立的阶段事件，不能合并守夜、抢修与掌门试局。',
      attachmentRefs: [], mentionedAgentIds: [], scopeNotes: '只约束当前卷事件链的数量和阶段边界',
      idempotencyKey: 'first-independent-event-chain-idea'
    });
    const chainGeneration = new EventChainGenerationService(
      new LayeredPlanningRepository(context.database), teamRepository, layered, service,
      taskService, new UnitOfWork(context.database), ids, clock
    );
    const scheduledChain = chainGeneration.start(scope, plan.volumePlanId, {
      expectedWorkflowVersion: service.workflow(scope).planningVersion,
      authorInputRefs: [chainIdea.authorInputId],
      idempotencyKey: 'first-independent-event-chain'
    });
    expect(scheduledChain).toMatchObject({ status: 'queued', currentPhase: 'preparing_context' });
    expect(scheduledChain.members.map((member) => member.roleKey)).toEqual([
      'lead_screenwriter', 'second_screenwriter', 'chief_editor'
    ]);
    expect(taskService.require(scope, scheduledChain.taskId).brief).toMatchObject({
      authorInputRefs: [inheritedVolumeIdea.authorInputId, chainIdea.authorInputId],
      authorIdeas: [
        expect.objectContaining({ originalText: expect.stringContaining('十个阶段') }),
        expect.objectContaining({ originalText: expect.stringContaining('十个彼此独立') })
      ]
    });
    const chainClaim = taskService.claimNext('worker-event-chain', 120_000)!;
    const chainPipeline = new EventChainGenerationPipelineService(
      teamRepository, layered, taskService, budgetService,
      new ModelCallService(context.database, clock, budgetService),
      new ContextPackService(context.database, ids, clock),
      ids, clock, new ModelAdapterFactory(context.config.modelRuntime)
    );
    const chainResult = await chainPipeline.executeClaimed(
      scope, scheduledChain.taskId, 'worker-event-chain',
      { leaseToken: chainClaim.leaseToken!, attemptNo: chainClaim.currentAttemptNo }
    );
    const chain = layered.listEventChains(scope, plan.volumePlanId)
      .find((item) => item.id === chainResult.eventChainVersionId)!;
    expect(chain.content.volumeDirectionVersionId).toBe(activeDirection?.volumeDirectionVersionId);
    expect(chain.content.events).toHaveLength(5);
    expect(chain.content.coverage.map((item) => item.responsibility))
      .toEqual(directionCoverageKeys(activeDirection!.content));
    expect(new Set(chain.content.events.flatMap((item) => item.firstVolumeResponsibilities))).toEqual(new Set([
      'opening_launch','golden_three','early_payoff','conflict_and_emotion_escalation',
      'major_climax_before_100k','climax_setup','climax_consequence'
    ]));
    expect(chainGeneration.latest(scope, plan.volumePlanId)).toMatchObject({
      status: 'succeeded', currentPhase: 'event_chain_ready',
      candidateEventChainId: chain.id
    });
    const chainCalls = context.database.prepare(`SELECT phase_key,agent_id FROM model_calls
      WHERE owner_id=? AND book_id=? AND task_id=? ORDER BY phase_key`)
      .all(scope.ownerId, scope.bookId, scheduledChain.taskId) as unknown as Array<{phase_key:string;agent_id:string}>;
    expect(chainCalls.map((call) => call.phase_key)).toEqual(expect.arrayContaining([
      expect.stringContaining('candidate_a'), expect.stringContaining('candidate_b'), expect.stringContaining('fusion')
    ]));
    expect(new Set(chainCalls.map((call) => call.agent_id)).size).toBe(3);
    const authorChain = layered.addEventChain(scope, plan.volumePlanId, {
      planNumber: 1,
      content: {...chain.content,events:chain.content.events.map((event,index)=>index===0
        ?{...event,protagonistAction:'主角先核对线索来源，再主动追查',plantThreadIds:['失踪王冠真相'],
          consequenceThreadIds:['公开追查造成的债务'],roleFunctions:[{roleFunctionKey:'witness',roleFunctionLabel:'关键证人',
            requirement:'提供可验证证据并承担公开风险',importance:'core'}]}:index===1?{...event,payoffThreadIds:['失踪王冠真相']}:event)},
      parentVersionId: chain.id,
      sourceVersionIds: [chain.id, chain.content.volumeDirectionVersionId],
      idempotencyKey: 'author-edited-independent-event-chain'
    });
    expect(authorChain.version).toBeGreaterThan(chain.version);
    expect(layered.confirmEventChain(scope, plan.volumePlanId, authorChain.id).status).toBe('active');
    expect(layered.listEventChains(scope, plan.volumePlanId).find(item=>item.id===chain.id)?.status).toBe('superseded');
    const threadService=new StoryThreadService(context.database,new UnitOfWork(context.database),ids,clock);
    expect(threadService.list(scope)).toEqual(expect.arrayContaining([
      expect.objectContaining({threadKey:'失踪王冠真相',status:'planned',actualEvidenceCount:0}),
      expect.objectContaining({threadKey:'公开追查造成的债务',status:'planned',actualEvidenceCount:0})
    ]));

    const eventService = new StoryEventService(
      new StoryEventRepository(context.database), new UnitOfWork(context.database), ids, clock, layered
    );
    expect(() => eventService.initialize(scope, plan.volumePlanId, {
      expectedWorkflowVersion: service.workflow(scope).planningVersion,
      idempotencyKey: 'blocked-before-event-role-assignment'
    })).toThrow(/未绑定角色功能/u);
    const core = new CoreWorkflowV6Service(context.database, ids, clock);
    const witness = core.createCharacter(scope, { characterKind: 'volume_new', content: {
      name: '林岚', roleSummary: '关键证人', desire: '让真相公开', currentState: '被对手追查', boundaries: [], storylineInfluences: []
    } });
    expect(() => core.upsertEventRole(scope, { eventChainVersionId: authorChain.id, eventNodeId: 'not-in-this-chain',
      roleFunctionKey: 'witness', roleFunctionLabel: '关键证人', requirement: { description: '非法事件引用' },
      assignedCharacterId: witness.characterId })).toThrow(/不存在的事件节点/u);
    core.upsertEventRole(scope, { eventChainVersionId: authorChain.id, eventNodeId: authorChain.content.events[0]!.nodeId,
      roleFunctionKey: 'witness', roleFunctionLabel: '关键证人', requirement: { description: '提供可验证证据并承担公开风险' },
      assignedCharacterId: witness.characterId });
    const sequence = eventService.initialize(scope, plan.volumePlanId, {
      expectedWorkflowVersion: service.workflow(scope).planningVersion,
      idempotencyKey: 'initialize-from-confirmed-event-chain'
    });
    expect(sequence.events).toHaveLength(5);
    expect(sequence.events[0]?.latestVersion?.content.title).toBe(authorChain.content.events[0]?.title);
    expect(sequence.events[0]?.latestVersion?.content.localProgression).toContain('主角先核对线索来源，再主动追查');
    expect(sequence.events[0]?.latestVersion?.content.participants).toContain('林岚');
    threadService.applyEventSettlement(scope,sequence.events[0]!.eventId,'settlement-before-canon');
    expect(threadService.list(scope).find(item=>item.threadKey==='失踪王冠真相')?.status).toBe('planned');
    context.database.prepare(`UPDATE story_events SET status='settled' WHERE owner_id=? AND book_id=? AND event_id=?`)
      .run(scope.ownerId,scope.bookId,sequence.events[0]!.eventId);
    threadService.applyEventSettlement(scope,sequence.events[0]!.eventId,'settlement-event-1');
    expect(threadService.list(scope)).toEqual(expect.arrayContaining([
      expect.objectContaining({threadKey:'失踪王冠真相',status:'planted',actualEvidenceCount:1}),
      expect.objectContaining({threadKey:'公开追查造成的债务',status:'advanced',actualEvidenceCount:1})
    ]));
    context.database.prepare(`UPDATE story_events SET status='settled' WHERE owner_id=? AND book_id=? AND event_id=?`)
      .run(scope.ownerId,scope.bookId,sequence.events[1]!.eventId);
    threadService.applyEventSettlement(scope,sequence.events[1]!.eventId,'settlement-event-2');
    expect(threadService.list(scope).find(item=>item.threadKey==='失踪王冠真相')).toMatchObject({status:'resolved',actualEvidenceCount:2});
    const catalog=new ChapterCatalogService(context.database,ids,clock);
    const physicalVolumeId=catalog.createVolume(scope,1,'第一卷');
    const authorAgent=(context.database.prepare(`SELECT agent_id FROM agent_instances
      WHERE owner_id=? AND book_id=? ORDER BY agent_id LIMIT 1`).get(scope.ownerId,scope.bookId) as {agent_id:string}).agent_id;
    const addSettledChapter=(chapterNumber:number,effectiveCharacters:number)=>{
      const chapter=catalog.createChapter(scope,physicalVolumeId,chapterNumber,'第'+chapterNumber+'章');
      const taskId=ids.next();
      new TaskService(context!.database,context!.config.releaseId,clock).create(scope,{
        taskId,taskType:'chapter_write',assignedAgentId:authorAgent,chapterId:chapter.chapterId,
        idempotencyKey:'launch-progress-chapter-'+chapterNumber,initialPhase:'draft',brief:{chapterId:chapter.chapterId}
      });
      const promotion=new PromotionService(context!.database,context!.dataDir,clock);
      const staged=promotion.stageText(taskId,'潮'.repeat(effectiveCharacters));
      const manuscriptVersionId=ids.next(),fileId=ids.next();
      promotion.promote(scope,{...staged,operationId:ids.next(),fileId,chapterId:chapter.chapterId,versionId:manuscriptVersionId});
      catalog.registerManuscript(scope,{manuscriptVersionId,chapterId:chapter.chapterId,authorAgentId:authorAgent,
        modelProvider:'wenmi-deterministic',modelId:'launch-progress-test',sourceTaskId:taskId,fileId,
        contentHash:staged.contentHash,wordCount:effectiveCharacters,status:'approved'});
      context!.database.prepare(`UPDATE manuscript_versions SET status='canon',confirmed_at=?
        WHERE owner_id=? AND book_id=? AND manuscript_version_id=?`).run(clock.now().toISOString(),scope.ownerId,scope.bookId,manuscriptVersionId);
      context!.database.prepare(`UPDATE chapters SET settlement_status='settled',canon_manuscript_version_id=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND chapter_id=?`).run(manuscriptVersionId,clock.now().toISOString(),scope.ownerId,scope.bookId,chapter.chapterId);
    };
    addSettledChapter(1,85_000);
    const launchProgress=new CreationWorkflowProgressService(context.database);
    expect(launchProgress.firstVolumeLaunchProgress(scope)).toMatchObject({
      totalEffectiveCharacters:85_000,latestSettledChapterNumber:1,climaxStatus:'at_risk',actualEvidence:null
    });
    addSettledChapter(2,16_000);
    const overdue=launchProgress.firstVolumeLaunchProgress(scope)!;
    expect(overdue).toMatchObject({
      totalEffectiveCharacters:101_000,latestSettledChapterNumber:2,climaxStatus:'overdue',actualEvidence:null
    });
    expect(overdue.prediction.recommendedAction).toMatch(/停止继续扩写铺垫/);

    const climaxNode=authorChain.content.events.find(item=>item.firstVolumeResponsibilities.includes('major_climax_before_100k'))!;
    const climaxEvent=sequence.events.find(item=>item.order===climaxNode.order)!;
    context.database.prepare(`UPDATE story_events SET status='settled' WHERE owner_id=? AND book_id=? AND event_id=?`)
      .run(scope.ownerId,scope.bookId,climaxEvent.eventId);
    expect(new CreationSettlementRepository(context.database).recordFirstVolumeClimaxCompletion(scope,{
      eventId:climaxEvent.eventId,settlementId:'settlement-climax-late',chapterStart:1,chapterEnd:2,
      actual:{irreversibleResults:['旧规则已经被公开撕开'],costs:['主角永久失去安全身份'],nextStage:['更强势力正式入场']},
      now:clock.now().toISOString()
    })).toBe(true);
    const completedLate=launchProgress.firstVolumeLaunchProgress(scope)!;
    expect(completedLate).toMatchObject({
      totalEffectiveCharacters:101_000,climaxStatus:'completed_late',climaxEventId:climaxEvent.eventId,
      climaxCompletedAtEffectiveCharacters:101_000,
      actualEvidence:{completed:true,late:true,eventNodeId:climaxNode.nodeId,eventOrder:climaxNode.order,
        completedAtEffectiveCharacters:101_000}
    });
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
    new VolumePlanRepository(context.database), new UnitOfWork(context.database), ids, clock,
    createLayered(context, ids, clock)
  );
}

function createLayered(context: TestContext, ids: SequenceIds, clock: FixedClock): LayeredPlanningService {
  return new LayeredPlanningService(
    new LayeredPlanningRepository(context.database), new UnitOfWork(context.database), ids, clock,
    new StoryThreadService(context.database,new UnitOfWork(context.database),ids,clock)
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

function eventChainContent(directionVersionId: string, responsibilities: string[]) {
  const firstVolumeResponsibilities = [
    'opening_launch','golden_three','early_payoff','conflict_and_emotion_escalation',
    'major_climax_before_100k','climax_setup','climax_consequence'
  ];
  return {
    volumeDirectionVersionId: directionVersionId,
    events: [{
      nodeId: 'preliminary-node-1', order: 1, title: '先验证方向依赖',
      volumeResponsibility: responsibilities.join('；'), entryState: '卷方向已经确认',
      protagonistAction: '主角验证第一条可行动线索', oppositionEscalation: '对手让线索变得有代价',
      stagePayoffOrCost: '取得局部结果并承担代价', exitState: '形成下一步明确局面', leadsToNext: null,
      plantThreadIds: [], payoffThreadIds: [], consequenceThreadIds: [], firstVolumeResponsibilities
    }],
    coverage: responsibilities.map(responsibility=>({responsibility,eventNodeIds:['preliminary-node-1'],status:'covered'}))
  };
}
function noTemplate() {
  return {
    selectionMode: 'none', templateKey: null, templateVersion: null, templateHash: null,
    scope: 'volume', beats: [], customDirection: null
  };
}

function directionContent() {
  return {
    title: '测试卷方向', openingSituation: '主角失去旧退路', protagonistDrive: '主动寻找证据',
    volumeGoal: '取得公开调查资格', centralOpposition: '旧规则维护者阻止调查',
    escalationPath: ['线索争夺从个人冲突升级为势力压制'], majorChoices: ['救人还是保全证据'],
    relationshipMovement: ['临时队伍从利用走向有限信任'], expressionFocus: ['选择与代价'],
    climaxResponsibility: '公开证据并承担不可逆后果', costAndConsequence: '主角暴露并付出身体代价',
    closingState: '主角进入更危险的新局面', benefits: ['因果链清楚'], risks: ['避免重复同类冲突'],
    openSpaces: ['具体场景由后续事件设计']
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
