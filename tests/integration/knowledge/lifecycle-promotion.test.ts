import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeLifecycleService } from '../../../apps/api/src/application/knowledge/knowledge-lifecycle-service.js';
import { KnowledgeRepository } from '../../../apps/api/src/infrastructure/db/repositories/knowledge-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });
const sourceHash = createHash('sha256').update('confirmed source').digest('hex');

describe('四层知识提升链', () => {
  it('提升产生新不可变正史版本并保留候选来源', () => {
    context = createTestContext('wenmi-knowledge-life-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    initializeRuntimeBook(context, scope, ids, clock, '甲书');
    const service = new KnowledgeLifecycleService(new KnowledgeRepository(context.database), new UnitOfWork(context.database), ids, clock);
    const candidate = service.create(scope, {
      knowledgeType: 'fact', canonicalKey: 'zhangsan:declares-war:tianan', layer: 'candidate',
      authorityGrade: 'B', epistemicStatus: 'objective',
      temporal: { worldTimeStart: '0030-01-01', canonRevision: 0, completeness: 'complete' },
      content: { subject: '张三', relation: '宣战', object: '天安城' }, contentText: '张三向天安城宣战',
      evidence: [{ start: 10, end: 20 }], sourceType: 'confirmed_manuscript', sourceId: 'manuscript-1',
      sourceHash, sourceLocator: { chapterId: 'chapter-1', start: 10, end: 20 }, createdByType: 'system'
    });
    const promoted = service.promote(scope, candidate.knowledgeRevisionId, {
      decisionType: 'graded_settlement', decisionSourceType: 'chapter_settlement', decisionSourceId: 'settlement-1', canonRevision: 1
    });
    const repository = new KnowledgeRepository(context.database);
    expect(repository.requireRevision(scope, candidate.knowledgeRevisionId)).toMatchObject({ status: 'promoted', layer: 'candidate', contentHash: candidate.contentHash });
    expect(repository.requireRevision(scope, promoted.canonRevisionId)).toMatchObject({ status: 'active', layer: 'canon', contentHash: candidate.contentHash });
    expect(context.database.prepare(`SELECT status FROM knowledge_promotions WHERE knowledge_promotion_id = ?`).get(promoted.promotionId)).toEqual({ status: 'committed' });
  });

  it('梦境、冲突、未知时间和D级事项不会被自动结算', () => {
    context = createTestContext('wenmi-knowledge-gates-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-gates' };
    initializeRuntimeBook(context, scope, ids, clock, '门禁书');
    const service = new KnowledgeLifecycleService(new KnowledgeRepository(context.database), new UnitOfWork(context.database), ids, clock);
    const make = (key: string, epistemicStatus: 'dream' | 'conflicted' | 'objective', grade: 'B' | 'D', completeness: 'complete' | 'unknown') => service.create(scope, {
      knowledgeType: 'fact', canonicalKey: key, layer: 'candidate', authorityGrade: grade, epistemicStatus,
      temporal: { canonRevision: 0, completeness }, content: { key }, contentText: key,
      evidence: [{ source: true }], sourceType: 'confirmed_manuscript', sourceId: `m-${key}`,
      sourceHash, sourceLocator: { chapterId: 'chapter-1' }, createdByType: 'system'
    });
    const dream = make('dream', 'dream', 'B', 'complete');
    expect(() => service.promote(scope, dream.knowledgeRevisionId, { decisionType: 'graded_settlement', decisionSourceType: 'settlement', decisionSourceId: 's', canonRevision: 1 })).toThrow('自动结算只接受');
    const conflict = make('conflict', 'conflicted', 'B', 'complete');
    expect(() => service.promote(scope, conflict.knowledgeRevisionId, { decisionType: 'boss_confirmed', decisionSourceType: 'boss', decisionSourceId: 'b', canonRevision: 1 })).toThrow('歧义或冲突');
    const unknown = make('unknown', 'objective', 'B', 'unknown');
    expect(() => service.promote(scope, unknown.knowledgeRevisionId, { decisionType: 'graded_settlement', decisionSourceType: 'settlement', decisionSourceId: 's', canonRevision: 1 })).toThrow('自动结算只接受');
    const gradeD = make('grade-d', 'objective', 'D', 'complete');
    expect(() => service.promote(scope, gradeD.knowledgeRevisionId, { decisionType: 'chief_editor_approved', decisionSourceType: 'editor', decisionSourceId: 'e', canonRevision: 1 })).toThrow('D级知识必须');
  });

  it('旧事实只做显式、可重跑的partial时间映射，不在Schema迁移中猜值', () => {
    context = createTestContext('wenmi-legacy-knowledge-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const entityId = ids.next();
    context.database.prepare(`
      INSERT INTO entities (entity_id, owner_id, book_id, entity_type, canonical_name, aliases_json, status, created_at, updated_at)
      VALUES (?, ?, ?, 'character', '旧角色', '[]', 'active', ?, ?)
    `).run(entityId, fixture.scope.ownerId, fixture.scope.bookId, clock.now().toISOString(), clock.now().toISOString());
    context.database.prepare(`
      INSERT INTO fact_assertions (
        fact_id, owner_id, book_id, subject_entity_id, relation_key, value_json,
        story_time_start, source_chapter_id, source_manuscript_version_id,
        evidence_json, grade, status, created_at
      ) VALUES ('legacy-fact-1', ?, ?, ?, 'location', '"旧城"', NULL, ?, ?, '[{"legacy":true}]', 'B', 'active', ?)
    `).run(fixture.scope.ownerId, fixture.scope.bookId, entityId, fixture.chapterId, fixture.manuscriptVersionId, clock.now().toISOString());
    const service = new KnowledgeLifecycleService(new KnowledgeRepository(context.database), new UnitOfWork(context.database), ids, clock);
    expect(service.migrateLegacyFacts(fixture.scope, 0)).toBe(1);
    expect(service.migrateLegacyFacts(fixture.scope, 0)).toBe(0);
    expect(context.database.prepare(`
      SELECT t.temporal_completeness, r.lifecycle_layer FROM knowledge_revisions r
      JOIN temporal_scopes t ON t.temporal_scope_id = r.temporal_scope_id
      WHERE r.owner_id = ? AND r.book_id = ? AND r.source_id = 'legacy-fact-1'
      ORDER BY r.revision DESC LIMIT 1
    `).get(fixture.scope.ownerId, fixture.scope.bookId)).toEqual({ temporal_completeness: 'partial', lifecycle_layer: 'canon' });
  });
});
