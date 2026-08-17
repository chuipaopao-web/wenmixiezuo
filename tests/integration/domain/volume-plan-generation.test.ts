import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { ContextPackService } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { AuthorCollaborationService } from '../../../apps/api/src/application/planning/author-collaboration-service.js';
import {
  parseVolumePlanModelOutput,
  isVolumePlanOutputCapped,
  selectEditorTechnicalSubstitute,
  volumePlanExpressionBudget,
  volumePlanOutputTokenLimit,
  VolumePlanGenerationPipelineService
} from '../../../apps/api/src/application/planning/volume-plan-generation-pipeline-service.js';
import { VolumePlanGenerationService } from '../../../apps/api/src/application/planning/volume-plan-generation-service.js';
import { VolumePlanService } from '../../../apps/api/src/application/planning/volume-plan-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { AuthorPlanningInputRepository } from '../../../apps/api/src/infrastructure/db/repositories/author-planning-input-repository.js';
import { VolumePlanGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-generation-repository.js';
import { VolumePlanRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-repository.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { ModelAdapterError } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('卷规划团队生成', () => {
  let context: TestContext | undefined;

  afterEach(() => {
    context?.close();
    context = undefined;
  });

  it('冻结当前卷资料和作者原话，让两位编剧独立生成后才交给主编融合', async () => {
    context = createTestContext('wenmi-volume-generation-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '双编剧卷规划书',
      text: '主角必须在旧规则崩塌后作出有代价的选择'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareSetting(context, scope, ids, clock);

    const unitOfWork = new UnitOfWork(context.database);
    const volumePlans = new VolumePlanService(
      new VolumePlanRepository(context.database), unitOfWork, ids, clock
    );
    const plan = volumePlans.create(scope, {
      expectedWorkflowVersion: volumePlans.workflow(scope).planningVersion,
      planNumber: 1,
      idempotencyKey: 'create-volume-for-team'
    });
    const idea = new AuthorCollaborationService(
      new AuthorPlanningInputRepository(context.database), unitOfWork, ids, clock
    ).create(scope, {
      surface: 'volume_plan',
      subjectType: 'volume_plan',
      subjectId: plan.volumePlanId,
      intentStrength: 'preference',
      originalText: '希望主角不是靠突然变强，而是主动承担一次会伤害盟友关系的选择。',
      attachmentRefs: [],
      mentionedAgentIds: [],
      scopeNotes: '只影响第一卷的主要选择与代价',
      idempotencyKey: 'volume-author-idea'
    });
    const repository = new VolumePlanGenerationRepository(context.database);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const budgets = new BudgetService(context.database, ids, clock);
    const generations = new VolumePlanGenerationService(
      repository, volumePlans, tasks, unitOfWork, ids, clock
    );
    const startInput = {
      expectedPlanRevision: plan.revision,
      expectedActiveVersionId: plan.activeVersionId,
      expectedWorkflowVersion: volumePlans.workflow(scope).planningVersion,
      template: noTemplate(),
      authorInputRefs: [idea.authorInputId],
      idempotencyKey: 'team-volume-generation'
    };

    const scheduled = generations.start(scope, plan.volumePlanId, startInput);
    expect(scheduled).toMatchObject({ status: 'queued', modelDiversityVerified: false });
    expect(generations.start(scope, plan.volumePlanId, startInput).taskId).toBe(scheduled.taskId);
    expect(volumePlans.workflow(scope)).toMatchObject({
      stage: 'volume_plan_in_progress', waitingTaskId: scheduled.taskId
    });

    const claim = tasks.claimNext('worker-volume-generation', 120_000);
    expect(claim?.taskId).toBe(scheduled.taskId);
    const defaultAdapters = new ModelAdapterFactory(context.config.modelRuntime);
    const fallbackAwareAdapters = {
      resolve(...args: Parameters<ModelAdapterFactory['resolve']>) {
        const [provider, modelId, , roleKey] = args;
        if (roleKey === 'lead_screenwriter') {
          return {
            provider,
            modelId,
            async generate() {
              throw new ModelAdapterError('test provider 500', 'technical_failure', true, 500, false);
            }
          };
        }
        return defaultAdapters.resolve(...args);
      }
    } as ModelAdapterFactory;
    const pipeline = new VolumePlanGenerationPipelineService(
      repository,
      volumePlans,
      tasks,
      budgets,
      new ModelCallService(context.database, clock, budgets),
      new ContextPackService(context.database, ids, clock),
      ids,
      clock,
      fallbackAwareAdapters
    );
    const result = await pipeline.executeClaimed(scope, scheduled.taskId, 'worker-volume-generation', {
      leaseToken: claim!.leaseToken!,
      attemptNo: claim!.currentAttemptNo
    });

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(result.candidateAId).not.toBeNull();
    expect(result.candidateBId).not.toBeNull();
    expect(result.fusionId).not.toBeNull();
    const versions = volumePlans.listVersions(scope, plan.volumePlanId);
    expect(versions.map((version) => version.candidateKind).sort()).toEqual([
      'candidate_a', 'candidate_b', 'fusion'
    ].sort());
    const fusionVersion = versions.find((version) => version.candidateKind === 'fusion')!;
    expect(fusionVersion.content.fusionNotes).toMatchObject({
      payoffDesign: expect.any(String),
      logicChain: expect.any(String),
      freshness: expect.any(String)
    });
    expect(versions.filter((version) => version.candidateKind !== 'fusion')
      .every((version) => version.content.fusionNotes === null || version.content.fusionNotes === undefined)).toBe(true);
    expect(new Set(versions.map((version) => version.contentHash)).size).toBe(3);
    expect(versions.every((version) => version.sourceTaskId === scheduled.taskId)).toBe(true);
    expect(volumePlans.get(scope, plan.volumePlanId).activeVersionId).toBeNull();
    expect(generations.latest(scope, plan.volumePlanId)).toMatchObject({
      status: 'succeeded',
      currentPhase: 'fusion_complete',
      checkpoint: {
        candidateAProducedBy: {
          roleKey: 'backup_writer',
          technicalSubstitute: true
        },
        candidateBProducedBy: {
          roleKey: 'second_screenwriter',
          technicalSubstitute: false
        }
      },
      candidateVersionIds: {
        candidateA: result.candidateAId,
        candidateB: result.candidateBId,
        fusion: result.fusionId
      }
    });
    expect(volumePlans.workflow(scope).waitingTaskId).toBeNull();

    const calls = context.database.prepare(`
      SELECT phase_key, context_pack_id
      FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'succeeded'
      ORDER BY phase_key
    `).all(scope.ownerId, scope.bookId, scheduled.taskId) as unknown as Array<{
      phase_key: string;
      context_pack_id: string;
    }>;
    expect(calls).toHaveLength(3);
    const manifests = new Map(calls.map((call) => {
      const row = context!.database.prepare(`
        SELECT source_manifest_json FROM context_packs
        WHERE owner_id = ? AND book_id = ? AND context_pack_id = ?
      `).get(scope.ownerId, scope.bookId, call.context_pack_id) as { source_manifest_json: string };
      return [call.phase_key, JSON.parse(row.source_manifest_json) as Array<{
        sourceType: string;
        content: string;
      }>];
    }));
    const independentPacks = [...manifests.entries()].filter(([phase]) =>
      phase.startsWith('candidate_a:') || phase.startsWith('candidate_b:')
    );
    expect(independentPacks).toHaveLength(2);
    for (const [, manifest] of independentPacks) {
      expect(manifest.map((source) => source.sourceType)).not.toContain('planning:independent_volume_candidates');
      expect(manifest.find((source) => source.sourceType === 'owner:volume_ideas')?.content)
        .toContain('主动承担一次会伤害盟友关系的选择');
      expect(manifest.find((source) => source.sourceType === 'owner:volume_ideas')?.content)
        .toContain('只影响第一卷的主要选择与代价');
    }
    const fusionManifest = [...manifests.entries()].find(([phase]) => phase.startsWith('fusion:'))?.[1];
    const fusedCandidates = fusionManifest?.find(
      (source) => source.sourceType === 'planning:independent_volume_candidates'
    );
    const candidateA = versions.find((version) => version.candidateKind === 'candidate_a')!;
    const candidateB = versions.find((version) => version.candidateKind === 'candidate_b')!;
    expect(fusedCandidates?.content).toContain(candidateA.content.title);
    expect(fusedCandidates?.content).toContain(candidateB.content.title);

    // A terminal generation must not be permanently returned for the same author action.
    // The new task receives a retry lineage key while preserving the frozen request hash.
    context.database.prepare(`UPDATE tasks SET status = 'failed', error_code = 'TEST_FAILURE' WHERE task_id = ?`)
      .run(scheduled.taskId);
    const retry = generations.start(scope, plan.volumePlanId, startInput);
    expect(retry.taskId).not.toBe(scheduled.taskId);
    expect(retry.status).toBe('queued');
  });

  it('能从带说明的模型回复中提取完整卷规划JSON', () => {
    const content = volumeContent();
    expect(parseVolumePlanModelOutput(`以下是候选：\n\`\`\`json\n${JSON.stringify(content)}\n\`\`\``))
      .toEqual(content);
  });

  it('为十事件真实卷纲保留完整JSON输出空间', () => {
    expect(volumePlanOutputTokenLimit('candidate_a')).toBe(12_000);
    expect(volumePlanOutputTokenLimit('candidate_b')).toBe(12_000);
    expect(volumePlanOutputTokenLimit('fusion')).toBe(12_000);
    expect(isVolumePlanOutputCapped(12_001, 12_000)).toBe(true);
    expect(isVolumePlanOutputCapped(5_493, 12_000)).toBe(false);
    expect(volumePlanExpressionBudget('fusion')).toContain(
      'The complete fusion JSON must stay within 7,500 Chinese characters.'
    );
    expect(volumePlanExpressionBudget('candidate_a')).toContain(
      'The complete candidate JSON must stay within 9,000 Chinese characters.'
    );
  });

  it('主编结果未知时由独立研究席优先接管融合，而不盲目重试原模型', () => {
    const seat = (roleKey: string, editor = false) => ({
      roleKey,
      agentId: `agent-${roleKey}`,
      displayName: roleKey,
      modelSnapshotId: `snapshot-${roleKey}`,
      provider: 'test-provider',
      modelId: `model-${roleKey}`,
      editor
    });
    const chief = seat('chief_editor', true);
    const lead = seat('lead_screenwriter');
    const second = seat('second_screenwriter');
    const backup = seat('backup_writer');
    const deputy = seat('deputy_editor');
    const researcher = seat('researcher');
    expect(selectEditorTechnicalSubstitute(
      [chief, lead, second, backup, deputy, researcher], [chief, lead, second]
    )?.roleKey).toBe('researcher');
  });
});

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
