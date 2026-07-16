import { afterEach, describe, expect, it } from 'vitest';
import { CanonService } from '../../apps/api/src/application/knowledge/canon-service.js';
import { createKnowledgeFixture } from '../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../helpers/test-context.js';

describe('正史结算故障恢复', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it.each(['after_fact_activation', 'after_revision'] as const)('故障点 %s 整体回滚', (fault) => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const canon = new CanonService(context.database, ids, clock);
    const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈' });
    const fact = canon.proposeFact(fixture.scope, {
      subjectEntityId: entityId, relationKey: 'location', value: '旧城', evidence: [{ quote: '身在旧城' }],
      grade: 'B', sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
    });
    expect(() => canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, { location: '旧城' }, fault))
      .toThrow('simulated-settlement-failure');
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE book_id = ?`).get(fixture.scope.bookId)).toEqual({ canon_revision: 0 });
    expect(context.database.prepare(`SELECT status FROM fact_assertions WHERE fact_id = ?`).get(fact.factId)).toEqual({ status: 'approved' });
    expect(context.database.prepare(`SELECT settlement_status FROM chapters WHERE chapter_id = ?`).get(fixture.chapterId)).toEqual({ settlement_status: 'unsettled' });
    expect(context.database.prepare(`SELECT status FROM manuscript_versions WHERE manuscript_version_id = ?`).get(fixture.manuscriptVersionId)).toEqual({ status: 'approved' });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM canon_revisions WHERE owner_id = ? AND book_id = ? AND revision = 1`).get(fixture.scope.ownerId, fixture.scope.bookId)).toEqual({ count: 0 });
  });
});
