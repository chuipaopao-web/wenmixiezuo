import { afterEach, describe, expect, it } from 'vitest';
import { BookOnboardingService } from '../../../apps/api/src/application/books/book-onboarding-service.js';
import { ExpressionProfileService } from '../../../apps/api/src/application/books/expression-profile-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import { TaxonomyService } from '../../../apps/api/src/application/knowledge/taxonomy-service.js';
import { TechniqueCatalogService } from '../../../apps/api/src/application/knowledge/technique-catalog-service.js';
import { ExpressionProfileRepository } from '../../../apps/api/src/infrastructure/db/repositories/expression-profile-repository.js';
import { TaxonomyRepository } from '../../../apps/api/src/infrastructure/db/repositories/taxonomy-repository.js';
import { TechniqueCardRepository } from '../../../apps/api/src/infrastructure/db/repositories/technique-card-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('开书表达基线与资料治理', () => {
  it('开书只固化最小卡，视角保持待首个正式工单确认', () => {
    context = createTestContext('wenmi-expression-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const draft = new PositioningService(context.database, ids, clock).createDraft({ ownerId: 'owner-one' }, {
      title: '长河夜航', text: '主角在长河诸城追查失踪案', category: '悬疑', classification: '东方奇幻',
      targetAudience: '成年网文读者', expectedScaleChars: 5_000_000, initialExpressionBaseline: '克制、人物对话自然'
    });
    const result = new BookOnboardingService(context.database, ids, clock).confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version);
    expect(context.database.prepare(`
      SELECT genre, classification, target_audience, expected_scale_chars, initial_expression_baseline, status
      FROM book_onboarding_profiles WHERE onboarding_profile_id = ?
    `).get(result.onboardingProfileId)).toEqual({
      genre: '悬疑', classification: '东方奇幻', target_audience: '成年网文读者',
      expected_scale_chars: 5_000_000, initial_expression_baseline: '克制、人物对话自然', status: 'provisional'
    });
    expect(context.database.prepare(`
      SELECT narrative_person, viewpoint_distance, status FROM book_expression_profiles
      WHERE expression_profile_id = ?
    `).get(result.expressionProfileId)).toEqual({ narrative_person: null, viewpoint_distance: null, status: 'provisional' });

    const profiles = new ExpressionProfileService(
      new ExpressionProfileRepository(context.database), new UnitOfWork(context.database), ids, clock
    );
    const confirmed = profiles.revise({ ownerId: 'owner-one', bookId: result.bookId }, {
      narrativePerson: 'third', viewpointDistance: 'close', languageTone: ['克制', '细腻'],
      voiceEvidence: [{ sample: '老板确认样文' }], confirm: true
    });
    expect(confirmed).toMatchObject({ version: 2, narrativePerson: 'third', viewpointDistance: 'close', status: 'confirmed' });
    expect(context.database.prepare(`SELECT status FROM book_expression_profiles WHERE expression_profile_id = ?`).get(result.expressionProfileId))
      .toEqual({ status: 'superseded' });
  });

  it('主编可增标签但不能把候选标注冒充正史，并且跨书标签不可复用', () => {
    context = createTestContext('wenmi-taxonomy-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const positioning = new PositioningService(context.database, ids, clock);
    const firstDraft = positioning.createDraft({ ownerId: 'owner-one' }, { title: '甲书', text: '一部悬疑长篇' });
    const first = new BookOnboardingService(context.database, ids, clock).confirmDraft({ ownerId: 'owner-one' }, firstDraft.draftId, firstDraft.version);
    const secondDraft = positioning.createDraft({ ownerId: 'owner-one' }, { title: '乙书', text: '一部仙侠长篇' });
    const second = new BookOnboardingService(context.database, ids, clock).confirmDraft({ ownerId: 'owner-one' }, secondDraft.draftId, secondDraft.version);
    const service = new TaxonomyService(new TaxonomyRepository(context.database), ids, clock);
    const tag = service.createTag({ ownerId: 'owner-one', bookId: first.bookId }, {
      namespace: '角色', name: '关键证人', appliesTo: ['character'], createdSource: 'chief_editor'
    });
    expect(tag.status).toBe('active');
    service.addAlias({ ownerId: 'owner-one', bookId: first.bookId }, tag.tagId, '证人', 'abbreviation');
    expect(() => service.assign({ ownerId: 'owner-one', bookId: second.bookId }, {
      tagId: tag.tagId, targetType: 'character', targetId: 'zhangsan', authorityLayer: 'candidate', sourceType: 'discussion', sourceId: 'd1'
    })).toThrow('标签不存在或越权');
    expect(() => service.annotate({ ownerId: 'owner-one', bookId: first.bookId }, {
      targetType: 'character', targetId: 'zhangsan', annotationType: 'emotion', value: '恐惧',
      authorityLayer: 'canon', sourceType: 'agent_guess', sourceId: 'guess-1'
    })).toThrow('候选语义标注不能冒充正史');
    const assignment = service.assign({ ownerId: 'owner-one', bookId: first.bookId }, {
      tagId: tag.tagId, targetType: 'character', targetId: 'zhangsan', authorityLayer: 'canon',
      sourceType: 'boss_confirmation', sourceId: 'confirm-1'
    });
    expect(assignment).toBeTruthy();
    expect(new TaxonomyRepository(context.database).listAssignments({ ownerId: 'owner-one', bookId: first.bookId }, 'character', 'zhangsan'))
      .toEqual([expect.objectContaining({ name: '关键证人', authority_layer: 'canon' })]);

    const schema = service.createEntitySchema({ ownerId: 'owner-one', bookId: first.bookId }, {
      entityTypeKey: 'emotion-arc', displayName: '情绪弧', fields: [{ key: 'state', type: 'string' }],
      createdSource: 'chief_editor', changesExistingMeaning: true
    });
    expect(schema).toMatchObject({ version: 1, status: 'proposed' });
    service.reportGap({ ownerId: 'owner-one', bookId: first.bookId }, {
      targetType: 'character', targetId: 'zhangsan', gapType: 'motivation', diagnosis: '动机有意保持未知',
      severity: 'observation', intentionalUnknown: true
    });
    expect(new TaxonomyRepository(context.database).listOpenGaps({ ownerId: 'owner-one', bookId: first.bookId }))
      .toEqual([expect.objectContaining({ status: 'accepted_unknown', intentional_unknown: 1 })]);
    expect(() => service.createTag({ ownerId: 'owner-one', bookId: first.bookId }, {
      namespace: '角色', name: '无效', appliesTo: [], createdSource: 'chief_editor'
    })).toThrow('至少需要一个适用对象');
  });

  it('写作手法卡只提供可选抽象方法，不自动绑定书籍或模仿作品', () => {
    context = createTestContext('wenmi-techniques-');
    const service = new TechniqueCatalogService(new TechniqueCardRepository(context.database), new SequenceIds(), new FixedClock());
    expect(service.seedAbstractCatalog()).toBe(6);
    expect(service.seedAbstractCatalog()).toBe(0);
    expect(service.list()).toHaveLength(6);
    expect(service.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ technique_key: 'dialogue-subtext', applicability: { selection: 'per_scene', mandatory: false } })
    ]));
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tag_assignments`).get()).toEqual({ count: 0 });
  });
});
