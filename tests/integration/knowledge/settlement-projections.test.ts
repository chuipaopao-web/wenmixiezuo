import { afterEach, describe, expect, it } from 'vitest';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { KnowledgeConsistencyService } from '../../../apps/api/src/application/knowledge/knowledge-consistency-service.js';
import { addApprovedChapter, createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('正史投影与冲突', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('从正式事实确定性重建人物、时间线和关系投影', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const canon = new CanonService(context.database, ids, clock);
    const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈' });
    canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '顾衡' });
    const compositeEntityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈与顾衡' });
    for (const fact of [
      { relationKey: 'location', value: '北塔', storyTimeStart: '第一夜' },
      { relationKey: 'relationship:mentor', value: '顾衡', storyTimeStart: '第一夜' },
      { relationKey: 'relationship.temporary_alliance', value: '顾衡', storyTimeStart: '第一夜' },
      { relationKey: 'alive', value: true, storyTimeStart: '第一夜' }
    ]) {
      canon.proposeFact(fixture.scope, {
        subjectEntityId: entityId, ...fact, evidence: [{ quote: '正文证据' }], grade: 'B',
        sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
      });
    }
    canon.proposeFact(fixture.scope, {
      subjectEntityId: compositeEntityId,
      relationKey: 'relationship.temporary_alliance',
      value: '共同守住北塔后形成临时同盟',
      evidence: [{ quote: '二人并肩守住北塔' }],
      grade: 'B',
      sourceChapterId: fixture.chapterId,
      sourceManuscriptVersionId: fixture.manuscriptVersionId
    });
    canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, { location: '北塔' });
    context.database.prepare(`DELETE FROM character_state_projection WHERE owner_id = ? AND book_id = ?`).run(fixture.scope.ownerId, fixture.scope.bookId);
    context.database.prepare(`DELETE FROM timeline_projection WHERE owner_id = ? AND book_id = ?`).run(fixture.scope.ownerId, fixture.scope.bookId);
    context.database.prepare(`DELETE FROM relationship_projection WHERE owner_id = ? AND book_id = ?`).run(fixture.scope.ownerId, fixture.scope.bookId);
    canon.rebuildProjections(fixture.scope);
    expect(new KnowledgeConsistencyService(context.database).inspect(fixture.scope)).toEqual([]);
    const character = context.database.prepare(`SELECT state_json FROM character_state_projection WHERE owner_id = ? AND book_id = ? AND entity_id = ?`)
      .get(fixture.scope.ownerId, fixture.scope.bookId, entityId) as { state_json: string };
    expect(JSON.parse(character.state_json)).toEqual({
      alive: true,
      location: '北塔',
      'relationship:mentor': '顾衡',
      'relationship.temporary_alliance': '顾衡'
    });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM timeline_projection WHERE owner_id = ? AND book_id = ?`).get(fixture.scope.ownerId, fixture.scope.bookId)).toEqual({ count: 4 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM relationship_projection WHERE owner_id = ? AND book_id = ?`).get(fixture.scope.ownerId, fixture.scope.bookId)).toEqual({ count: 3 });
    const normalizedRelationship = context.database.prepare(`
      SELECT e.canonical_name AS from_name, r.to_value_json
      FROM relationship_projection r
      JOIN entities e ON e.entity_id = r.from_entity_id
      WHERE r.owner_id = ? AND r.book_id = ? AND r.source_fact_id = (
        SELECT fact_id FROM fact_assertions
        WHERE owner_id = ? AND book_id = ? AND subject_entity_id = ?
      )
    `).get(
      fixture.scope.ownerId, fixture.scope.bookId,
      fixture.scope.ownerId, fixture.scope.bookId, compositeEntityId
    ) as { from_name: string; to_value_json: string };
    expect(normalizedRelationship.from_name).toBe('林澈');
    expect(JSON.parse(normalizedRelationship.to_value_json)).toEqual({
      name: '顾衡',
      summary: '共同守住北塔后形成临时同盟'
    });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_revisions
      WHERE owner_id = ? AND book_id = ? AND lifecycle_layer = 'canon' AND status = 'active'
    `).get(fixture.scope.ownerId, fixture.scope.bookId)).toEqual({ count: 5 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM canon_source_bindings WHERE owner_id = ? AND book_id = ? AND binding_status = 'active'`)
      .get(fixture.scope.ownerId, fixture.scope.bookId)).toEqual({ count: 5 });
  });

  it('冲突B级事实转主编复核，选中新值后旧事实被替代', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const canon = new CanonService(context.database, ids, clock);
    const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈' });
    const first = canon.proposeFact(fixture.scope, {
      subjectEntityId: entityId, relationKey: 'location', value: '旧城', evidence: [{ quote: '旧城' }], grade: 'B',
      sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
    });
    canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, { location: '旧城' });
    const secondChapter = addApprovedChapter(context, ids, clock, fixture, 2);
    const second = canon.proposeFact(fixture.scope, {
      subjectEntityId: entityId, relationKey: 'location', value: '北塔', evidence: [{ quote: '抵达北塔' }], grade: 'B',
      sourceChapterId: secondChapter.chapterId, sourceManuscriptVersionId: secondChapter.manuscriptVersionId
    });
    expect(second.status).toBe('awaiting_editor');
    expect(second.conflictId).not.toBeNull();
    canon.reviewFact(fixture.scope, second.factId, true);
    canon.settleChapter(fixture.scope, secondChapter.chapterId, secondChapter.manuscriptVersionId, { location: '北塔' });
    expect(context.database.prepare(`SELECT status FROM fact_assertions WHERE fact_id = ?`).get(first.factId)).toEqual({ status: 'superseded' });
    expect(context.database.prepare(`SELECT status FROM fact_assertions WHERE fact_id = ?`).get(second.factId)).toEqual({ status: 'active' });
  });
});
