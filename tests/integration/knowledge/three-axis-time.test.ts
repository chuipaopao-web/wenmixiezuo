import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeLifecycleService } from '../../../apps/api/src/application/knowledge/knowledge-lifecycle-service.js';
import { TemporalQueryService } from '../../../apps/api/src/application/knowledge/temporal-query-service.js';
import { KnowledgeRepository } from '../../../apps/api/src/infrastructure/db/repositories/knowledge-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });
const hash = createHash('sha256').update('boss source').digest('hex');

describe('世界、知情与记录三轴时间', () => {
  it('按故事时点、观点主体、知情时点和正史版本共同裁决', () => {
    context = createTestContext('wenmi-three-axis-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-time' };
    const other = { ownerId: 'owner-one', bookId: 'book-other' };
    initializeRuntimeBook(context, scope, ids, clock, '时间书');
    initializeRuntimeBook(context, other, ids, clock, '另一本书');
    const repository = new KnowledgeRepository(context.database);
    const lifecycle = new KnowledgeLifecycleService(repository, new UnitOfWork(context.database), ids, clock);
    const addCanon = (target: typeof scope, key: string, temporal: Parameters<typeof lifecycle.create>[1]['temporal']) => {
      const candidate = lifecycle.create(target, {
        knowledgeType: 'fact', canonicalKey: key, layer: 'candidate', authorityGrade: 'B', epistemicStatus: 'objective', temporal,
        content: { key }, contentText: key, evidence: [{ boss: true }], sourceType: 'boss_decision', sourceId: `boss-${key}`,
        sourceHash: hash, sourceLocator: { decisionId: `boss-${key}` }, createdByType: 'boss'
      });
      lifecycle.promote(target, candidate.knowledgeRevisionId, {
        decisionType: 'boss_confirmed', decisionSourceType: 'boss_confirmation', decisionSourceId: `boss-${key}`, canonRevision: temporal.canonRevision
      });
    };
    addCanon(scope, 'public-rule', { worldTimeStart: '0010', canonRevision: 1, completeness: 'complete' });
    addCanon(scope, 'secret-route', {
      worldTimeStart: '0010', knowledgeSubjectType: 'character', knowledgeSubjectId: 'zhangsan',
      knowledgeTimeStart: '0020', canonRevision: 1, completeness: 'complete'
    });
    addCanon(scope, 'unknown-time', { canonRevision: 1, completeness: 'unknown' });
    addCanon(other, 'public-rule', { worldTimeStart: '0010', canonRevision: 1, completeness: 'complete' });
    const query = new TemporalQueryService(repository);
    expect(query.query(scope, { canonRevision: 1, worldTime: '0015', viewpointEntityId: 'zhangsan', knowledgeTime: '0015' }).map((item) => item.contentText))
      .toEqual(['public-rule']);
    expect(new Set(query.query(scope, { canonRevision: 1, worldTime: '0025', viewpointEntityId: 'zhangsan', knowledgeTime: '0025' }).map((item) => item.contentText)))
      .toEqual(new Set(['public-rule', 'secret-route']));
    expect(query.query(scope, { canonRevision: 0, worldTime: '0025', viewpointEntityId: 'zhangsan', knowledgeTime: '0025' })).toEqual([]);
    expect(query.query(scope, { canonRevision: 1, canonicalKey: 'public-rule', worldTime: '0025' })).toHaveLength(1);
  });
});
