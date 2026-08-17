import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { BookBrandingDesignService } from '../../../apps/api/src/application/books/book-branding-design-service.js';
import {
  BookBrandingDesignPipelineService,
  parseBrandingOptions
} from '../../../apps/api/src/application/books/book-branding-pipeline-service.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { ContextPackService } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { VolumePlanService } from '../../../apps/api/src/application/planning/volume-plan-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { BookBrandingDesignRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-branding-design-repository.js';
import { VolumePlanGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-generation-repository.js';
import { VolumePlanRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-repository.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('主编设计书名与简介', () => {
  let context: TestContext | undefined;

  afterEach(() => {
    context?.close();
    context = undefined;
  });

  it('第一卷方案未确认时提示先设计第一卷', () => {
    context = createTestContext('wenmi-branding-gate-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '我要举报，这里有人谋反'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareSetting(context, scope, ids, clock);
    const service = brandingService(context, ids, clock);

    expect(() => service.start(scope, { kind: 'title', idempotencyKey: 'gate-check-1' }))
      .toThrow('请先在「卷设计」里确认第一卷方案');

    const volumePlans = new VolumePlanService(new VolumePlanRepository(context.database), new UnitOfWork(context.database), ids, clock);
    volumePlans.create(scope, {
      expectedWorkflowVersion: volumePlans.workflow(scope).planningVersion,
      planNumber: 1,
      idempotencyKey: 'gate-volume-1'
    });
    expect(() => service.start(scope, { kind: 'synopsis', idempotencyKey: 'gate-check-2' }))
      .toThrow('请先在「卷设计」里确认第一卷方案');
  });

  it('第一卷确认后由主编一次产出多套候选，作者可直接采用', async () => {
    context = createTestContext('wenmi-branding-flow-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '我要举报，这里有人谋反'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareSetting(context, scope, ids, clock);
    const unitOfWork = new UnitOfWork(context.database);
    const volumePlans = new VolumePlanService(new VolumePlanRepository(context.database), unitOfWork, ids, clock);
    let plan = volumePlans.create(scope, {
      expectedWorkflowVersion: volumePlans.workflow(scope).planningVersion,
      planNumber: 1,
      idempotencyKey: 'flow-volume-1'
    });
    const candidate = volumePlans.addVersion(scope, plan.volumePlanId, {
      expectedPlanRevision: plan.revision,
      candidateKind: 'author_edit',
      template: noTemplate(),
      content: volumeContent(),
      idempotencyKey: 'flow-volume-1-version'
    });
    plan = volumePlans.get(scope, plan.volumePlanId);
    const confirmed = volumePlans.confirm(scope, plan.volumePlanId, {
      volumePlanVersionId: candidate.volumePlanVersionId,
      expectedPlanRevision: plan.revision,
      expectedActiveVersionId: plan.activeVersionId,
      expectedWorkflowVersion: volumePlans.workflow(scope).planningVersion
    });
    expect(confirmed).toMatchObject({ status: 'active' });
    expect(confirmed.activeVersionId).not.toBeNull();

    const repository = new BookBrandingDesignRepository(context.database);
    const generationRepository = new VolumePlanGenerationRepository(context.database);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const budgets = new BudgetService(context.database, ids, clock);
    const service = new BookBrandingDesignService(
      repository, generationRepository, tasks, unitOfWork, ids, clock
    );

    const scheduled = service.start(scope, { kind: 'title', idempotencyKey: 'branding-title-1' });
    expect(scheduled).toMatchObject({ kind: 'title', status: 'working', taskStatus: 'queued' });
    expect(scheduled.member?.roleKey).toBe('chief_editor');
    // 同类型进行中的设计直接复用，不重复起任务。
    expect(service.start(scope, { kind: 'title', idempotencyKey: 'branding-title-2' }).taskId)
      .toBe(scheduled.taskId);

    const claim = tasks.claimNext('worker-branding', 120_000);
    expect(claim?.taskId).toBe(scheduled.taskId);
    const pipeline = new BookBrandingDesignPipelineService(
      repository,
      generationRepository,
      tasks,
      budgets,
      new ModelCallService(context.database, clock, budgets),
      new ContextPackService(context.database, ids, clock),
      ids,
      clock,
      new ModelAdapterFactory(context.config.modelRuntime)
    );
    const result = await pipeline.executeClaimed(scope, scheduled.taskId, 'worker-branding', {
      leaseToken: claim!.leaseToken!,
      attemptNo: claim!.currentAttemptNo
    });

    expect(result).toMatchObject({ status: 'succeeded', designId: scheduled.designId });
    expect(result.optionCount).toBeGreaterThanOrEqual(3);
    const latest = service.latest(scope, 'title');
    expect(latest).toMatchObject({ status: 'succeeded', taskStatus: 'succeeded' });
    expect(latest?.options.length).toBe(result.optionCount);
    expect(latest?.options.every((option) => option.text.length > 0 && option.note.length > 0)).toBe(true);

    const calls = context.database.prepare(`
      SELECT phase_key, context_pack_id FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'succeeded'
    `).all(scope.ownerId, scope.bookId, scheduled.taskId) as unknown as Array<{
      phase_key: string;
      context_pack_id: string;
    }>;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.phase_key).toContain('title:chief_editor');
    const manifest = JSON.parse((context.database.prepare(`
      SELECT source_manifest_json FROM context_packs
      WHERE owner_id = ? AND book_id = ? AND context_pack_id = ?
    `).get(scope.ownerId, scope.bookId, calls[0]!.context_pack_id) as { source_manifest_json: string })
      .source_manifest_json) as Array<{ sourceType: string; content: string }>;
    expect(manifest.map((source) => source.sourceType)).toEqual([
      'planning:opening_blueprint',
      'planning:setting_baseline',
      'planning:first_volume_plan'
    ]);
    expect(manifest.find((source) => source.sourceType === 'planning:first_volume_plan')?.content)
      .toContain('承担代价');
  });

  it('能从带说明的模型回复中提取主编候选，并拒绝过少的方案', () => {
    const options = [1, 2, 3].map((index) => ({ text: `书名${index}`, note: `说明${index}` }));
    expect(parseBrandingOptions(`以下供参考：\n\`\`\`json\n${JSON.stringify({ options })}\n\`\`\``, 'title'))
      .toEqual(options);
    expect(() => parseBrandingOptions(JSON.stringify({ options: options.slice(0, 2) }), 'title'))
      .toThrow('主编设计JSON');
    expect(() => parseBrandingOptions(JSON.stringify({ options: [{ text: '一', note: '太短' }, ...options] }), 'title')
    ).not.toThrow();
  });
});

function brandingService(context: TestContext, ids: SequenceIds, clock: FixedClock): BookBrandingDesignService {
  return new BookBrandingDesignService(
    new BookBrandingDesignRepository(context.database),
    new VolumePlanGenerationRepository(context.database),
    new TaskService(context.database, context.config.releaseId, clock),
    new UnitOfWork(context.database),
    ids,
    clock
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
      ) VALUES (?, ?, ?, 1, 'test-v1', 'male', 'fantasy', '玄幻奇幻', ?, ?, 'active', ?)
    `).run(
      ids.next(),
      scope.ownerId,
      scope.bookId,
      JSON.stringify({ premise: '旧规则失效后，主角必须为自己的选择承担后果' }),
      '0'.repeat(64),
      clock.now().toISOString()
    );
  }
  const artifacts = new ArtifactService(context.database, ids, clock);
  const storyBible = artifacts.create(scope, 'story_bible', '设定大纲', {
    title: '设定基线',
    positioning: {},
    worldRules: ['任何能力都要有来源和代价'],
    characters: [{ name: '主角', desire: '取得自主选择权' }],
    mainPlot: { premise: '旧规则失效后，人必须为自己的选择承担后果' }
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
    selectionMode: 'none' as const,
    templateKey: null,
    templateVersion: null,
    templateHash: null,
    scope: 'volume' as const,
    beats: [],
    customDirection: null
  };
}

function volumeContent() {
  return {
    title: '承担代价',
    stylePrimary: null,
    styleSecondary: null,
    openingState: '主角刚失去旧有退路，只掌握有限线索',
    coreGoal: '让主角取得继续追查真相的资格',
    coreConflict: '主角的生存目标与旧规则维护者正面冲突',
    failureCost: '主角失去行动资格，盟友也会承担连带代价',
    characterChanges: ['主角从被动求生转向主动承担选择后果'],
    eventSequence: [{
      eventId: 'event-1',
      order: 1,
      title: '第一次公开选择',
      responsibility: '把本卷核心冲突变成主角必须处理的现实问题',
      entryState: '主角只有线索，没有公开行动资格',
      trigger: '旧规则开始伤害与主角有关的普通人',
      action: '主角验证线索并作出有代价的选择',
      result: '主角取得有限资格，也失去盟友的部分信任',
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
