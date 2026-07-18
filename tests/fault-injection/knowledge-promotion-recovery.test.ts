import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeLifecycleService } from '../../apps/api/src/application/knowledge/knowledge-lifecycle-service.js';
import { KnowledgeRepository } from '../../apps/api/src/infrastructure/db/repositories/knowledge-repository.js';
import { UnitOfWork } from '../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeRuntimeBook } from '../helpers/runtime-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('知识提升故障恢复', () => {
  it('正史版本写入后崩溃会整体回滚并可安全重试', () => {
    context = createTestContext('wenmi-knowledge-recovery-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-recovery' };
    initializeRuntimeBook(context, scope, ids, clock, '恢复书');
    const repository = new KnowledgeRepository(context.database);
    const service = new KnowledgeLifecycleService(repository, new UnitOfWork(context.database), ids, clock);
    const candidate = service.create(scope, {
      knowledgeType: 'fact', canonicalKey: 'recoverable', layer: 'candidate', authorityGrade: 'B', epistemicStatus: 'objective',
      temporal: { worldTimeStart: '0010', canonRevision: 0, completeness: 'complete' },
      content: { value: 1 }, contentText: '可恢复事实', evidence: [{ range: [1, 2] }],
      sourceType: 'confirmed_manuscript', sourceId: 'm1',
      sourceHash: createHash('sha256').update('m1').digest('hex'), sourceLocator: { start: 1, end: 2 }, createdByType: 'system'
    });
    expect(() => service.promote(scope, candidate.knowledgeRevisionId, {
      decisionType: 'graded_settlement', decisionSourceType: 'settlement', decisionSourceId: 's1', canonRevision: 1,
      failAt: 'after_canon_revision'
    })).toThrow('simulated-knowledge-promotion-failure');
    expect(repository.requireRevision(scope, candidate.knowledgeRevisionId).status).toBe('active');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM knowledge_revisions WHERE lifecycle_layer = 'canon' AND owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId))
      .toEqual({ count: 0 });
    expect(service.promote(scope, candidate.knowledgeRevisionId, {
      decisionType: 'graded_settlement', decisionSourceType: 'settlement', decisionSourceId: 's1', canonRevision: 1
    }).status).toBe('committed');
  });
});
