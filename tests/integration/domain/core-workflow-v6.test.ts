import { afterEach, describe, expect, it } from 'vitest';
import { BookLifecycleService } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { CoreWorkflowV6Service } from '../../../apps/api/src/application/planning/core-workflow-v6-service.js';
import { hiddenNarrativeMethodVersions } from '../../../apps/api/src/application/planning/hidden-narrative-methods.js';
import { VolumePlanGenerationRepository } from '../../../apps/api/src/infrastructure/db/repositories/volume-plan-generation-repository.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('V6 核心工作流底座', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('隔离双账号双书，并完成候选确认、关系、角色、草稿冲突、重开和计划/实际账本', () => {
    context = createTestContext('wenmi-core-v6-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, ids, clock);
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    lifecycle.ensureOwner({ ownerId: 'owner-two' });
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-alpha' }, '同名书');
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-beta' }, '同名书');
    lifecycle.createDraft({ ownerId: 'owner-two', bookId: 'book-alpha-two' }, '同名书');
    const service = new CoreWorkflowV6Service(context.database, ids, clock);
    const alpha = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const beta = { ownerId: 'owner-one', bookId: 'book-beta' };
    const other = { ownerId: 'owner-two', bookId: 'book-alpha-two' };

    const topologyId = service.saveTopology(alpha, { content: {
      topologyType: 'core_with_branches', plainLanguageReason: '一条核心线承载总目标，两条支线承担代价与关系变化。',
      lineResponsibilities: ['核心线推动目标', '关系线检验选择'], authorNotes: '保留作者结局意图'
    }, authorInputRefs: ['author-input-1'] });
    service.confirmTopology(alpha, topologyId, null);
    const betaTopology = service.saveTopology(beta, { content: {
      topologyType: 'unit_stories', plainLanguageReason: '同名对象也必须按书隔离。',
      lineResponsibilities: ['单元闭环'], authorNotes: null
    } });
    service.confirmTopology(beta, betaTopology, null);
    const otherTopology = service.saveTopology(other, { content: {
      topologyType: 'dual_core', plainLanguageReason: '另一账号独立。', lineResponsibilities: ['甲线', '乙线'], authorNotes: null
    } });
    service.confirmTopology(other, otherTopology, null);

    const lineA = service.createStoryline(alpha, { content: storyline('寻找真相', '谁改写了档案？') });
    const lineB = service.createStoryline(alpha, { content: storyline('关系代价', '盟友愿意付出什么？') });
    service.confirmStoryline(alpha, lineA.storylineId, lineA.versionId, null);
    service.confirmStoryline(alpha, lineB.storylineId, lineB.versionId, null);
    service.upsertRelation(alpha, {
      fromStorylineId: lineB.storylineId, toStorylineId: lineA.storylineId,
      relationType: 'serves', description: '关系抉择改变核心调查路径'
    });
    service.updateStorylineLifecycle(alpha, lineB.storylineId, 'paused');
    service.createCharacter(alpha, {
      characterKind: 'existing', content: {
        name: '林岚', roleSummary: '调查者', desire: '找回真实记忆', currentState: '尚未信任盟友',
        boundaries: ['不伤害无辜'], storylineInfluences: [{ storylineId: lineA.storylineId, influence: '推动调查选择' }]
      }
    });

    const firstDraft = service.saveDraft(alpha, {
      objectType: 'storyline', objectId: 'local-new-line', baseVersion: 0, expectedDraftRevision: 0,
      draft: { title: '设备甲草稿' }
    });
    expect(firstDraft.draftRevision).toBe(1);
    expect(() => service.saveDraft(alpha, {
      objectType: 'storyline', objectId: 'local-new-line', baseVersion: 0, expectedDraftRevision: 0,
      draft: { title: '设备乙静默覆盖' }
    })).toThrow(/草稿已被其他编辑更新/u);
    const reopened = service.reopenStoryline(alpha, lineA.storylineId, lineA.versionId);
    expect(reopened.impactPreview.effect).toContain('不会被自动覆盖');

    const plannedId = service.writeLedger(alpha, {
      ledgerType: 'storyline', truthStatus: 'planned', scopeType: 'book', scopeId: alpha.bookId,
      subjectKey: lineA.storylineId, entryStatus: 'planned', content: { next: '调查旧档案馆' },
      sourceKind: 'storyline', sourceVersionId: lineA.versionId
    });
    expect(plannedId).toMatch(/^generated-/u);
    expect(() => service.writeLedger(alpha, {
      ledgerType: 'settlement', truthStatus: 'actual', scopeType: 'book', scopeId: alpha.bookId,
      subjectKey: 'fake', entryStatus: 'active', content: { falseFact: true },
      sourceKind: 'storyline', sourceVersionId: lineA.versionId
    })).toThrow(/计划或模型产物不能写入实际账本/u);
    insertSettlement(context.database, alpha.ownerId, alpha.bookId, 'settlement-alpha');
    service.writeLedger(alpha, {
      ledgerType: 'settlement', truthStatus: 'actual', scopeType: 'chapter', scopeId: 'chapter-alpha',
      subjectKey: 'chapter-alpha', entryStatus: 'active', content: { result: '正文确认后实际发生' },
      sourceKind: 'chapter_settlement', sourceVersionId: 'settlement-alpha'
    });
    expect(() => service.writeLedger(beta, {
      ledgerType: 'settlement', truthStatus: 'actual', scopeType: 'chapter', scopeId: 'chapter-alpha',
      subjectKey: 'cross-book', entryStatus: 'active', content: { result: '不应写入' },
      sourceKind: 'chapter_settlement', sourceVersionId: 'settlement-alpha'
    })).toThrow(/不是当前书籍的有效结算/u);

    const alphaView = service.view(alpha);
    expect(alphaView.topology.active?.topologyVersionId).toBe(topologyId);
    expect(alphaView.storylines).toHaveLength(2);
    expect(alphaView.characters).toHaveLength(1);
    expect(alphaView.ledgers.storyline.planned).toHaveLength(1);
    expect(alphaView.ledgers.settlement.actual).toHaveLength(1);
    expect(service.view(beta).storylines).toEqual([]);
    expect(service.view(other).topology.active?.topologyVersionId).toBe(otherTopology);
    expect(() => service.view({ ownerId: 'owner-two', bookId: 'book-alpha' })).toThrow(/不属于当前账号/u);
  });

  it('确认新故事线版本只标记下游失效，保留旧正式版本，并记录 22 种方法作用域', () => {
    context = createTestContext('wenmi-core-v6-invalidation-');
    const ids = new SequenceIds(); const clock = new FixedClock();
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, ids, clock);
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-alpha' }, '甲书');
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const service = new CoreWorkflowV6Service(context.database, ids, clock);
    const created = service.createStoryline(scope, { content: storyline('主线', '第一次问题') });
    service.confirmStoryline(scope, created.storylineId, created.versionId, null);
    insertVolumePlan(context.database, scope.ownerId, scope.bookId, 'volume-plan-1');
    service.upsertVolumeParticipation(scope, {
      storylineId: created.storylineId, volumePlanId: 'volume-plan-1', participationStatus: 'leading', responsibility: '主导本卷目标'
    });
    const nextVersion = service.saveStorylineVersion(scope, created.storylineId, {
      baseVersion: 1, parentVersionId: created.versionId, content: storyline('主线', '第二次问题')
    });
    expect(() => service.confirmStoryline(scope, created.storylineId, nextVersion, null)).toThrow(/基线已经变化/u);
    service.confirmStoryline(scope, created.storylineId, nextVersion, created.versionId);
    const view = service.view(scope);
    expect(view.storylines[0]?.versions.map((item) => item.status)).toEqual(['active', 'superseded']);
    expect(view.volumeParticipations[0]?.status).toBe('stale');
    expect(view.invalidations[0]?.resolution).toBe('review_required');

    const repository = new VolumePlanGenerationRepository(context.database);
    repository.syncInternalStructureMethods(hiddenNarrativeMethodVersions(), clock.now().toISOString());
    const scopes = context.database.prepare(`SELECT m.method_key,s.primary_scope,s.applicable_scopes_json
      FROM internal_structure_method_versions m JOIN internal_structure_method_scopes s
      ON s.internal_structure_method_version_id=m.internal_structure_method_version_id ORDER BY m.method_key`).all() as Array<{
        method_key: string; primary_scope: string; applicable_scopes_json: string;
      }>;
    expect(scopes).toHaveLength(22);
    expect(scopes.find((item) => item.method_key === 'multi-line')).toMatchObject({
      primary_scope: 'book_topology', applicable_scopes_json: '["book_topology"]'
    });
    expect(JSON.parse(scopes.find((item) => item.method_key === 'three-act')!.applicable_scopes_json)).toContain('event_rhythm');
  });

  it('阶段状态按书隔离、使用乐观锁并禁止跨级开放', () => {
    context = createTestContext('wenmi-core-v6-stage-');
    const ids = new SequenceIds(); const clock = new FixedClock();
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, ids, clock);
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-alpha' }, '甲书');
    lifecycle.createDraft({ ownerId: 'owner-one', bookId: 'book-beta' }, '乙书');
    const service = new CoreWorkflowV6Service(context.database, ids, clock);
    const alpha = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const beta = { ownerId: 'owner-one', bookId: 'book-beta' };

    expect(service.view(alpha)).toMatchObject({ stage: 'setting', stateVersion: 0 });
    expect(() => service.setWorkflowStage(alpha, { stage: 'chapter', expectedStateVersion: 0 })).toThrow(/不能跨级/u);
    expect(service.setWorkflowStage(alpha, { stage: 'storyline', expectedStateVersion: 0 })).toBe(1);
    expect(() => service.setWorkflowStage(alpha, { stage: 'volume', expectedStateVersion: 0 })).toThrow(/基线已经变化/u);
    expect(service.setWorkflowStage(alpha, { stage: 'volume', expectedStateVersion: 1 })).toBe(2);
    expect(service.setWorkflowStage(alpha, { stage: 'setting', expectedStateVersion: 2 })).toBe(3);
    expect(service.view(alpha)).toMatchObject({ stage: 'setting', stateVersion: 3 });
    expect(service.view(beta)).toMatchObject({ stage: 'setting', stateVersion: 0 });
  });
});

function storyline(title: string, coreQuestion: string) {
  return {
    title, lineKind: 'core' as const, coreQuestion, stageGoal: '让人物用行动改变局面', expectedStages: ['发现', '选择'],
    associatedCharacterIds: [], foreshadowingKeys: [], rhythmMethodVersionId: 'structure-method:three-act:1.0.0'
  };
}

function insertVolumePlan(database: TestContext['database'], ownerId: string, bookId: string, volumePlanId: string): void {
  database.prepare(`INSERT INTO volume_plans (volume_plan_id,owner_id,book_id,plan_number,status,revision,
    create_idempotency_key,request_hash,created_at,updated_at) VALUES (?,?,?,1,'planning',1,?,?,?,?)`).run(
      volumePlanId, ownerId, bookId, `create-${volumePlanId}`, 'a'.repeat(64),
      '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'
    );
}

function insertSettlement(database: TestContext['database'], ownerId: string, bookId: string, settlementId: string): void {
  database.prepare(`INSERT INTO stage_settlements (stage_settlement_id,owner_id,book_id,stage_type,stage_key,version,
    chapter_start,chapter_end,canon_revision,irreversible_results_json,entity_states_json,closed_threads_json,
    open_threads_json,relationship_changes_json,knowledge_changes_json,resource_changes_json,rule_changes_json,
    exclusions_json,status,created_at,activated_at) VALUES (?,?,?,'chapter','chapter-alpha',1,1,1,1,'[]','{}','[]','[]',
    '[]','[]','[]','[]','[]','active',?,?)`).run(settlementId, ownerId, bookId,
      '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z');
}
