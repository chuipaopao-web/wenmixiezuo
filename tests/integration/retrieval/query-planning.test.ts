import { afterEach, describe, expect, it } from 'vitest';
import { EntityDisambiguationService } from '../../../apps/api/src/application/memory/entity-disambiguation-service.js';
import { RetrievalQueryPlanner } from '../../../apps/api/src/application/memory/retrieval-query-planner.js';
import { RetrievalOrchestrationRepository } from '../../../apps/api/src/infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('四路检索计划与实体消歧', () => {
  it('先锁书、正史、三轴和实体；正式生产不静默选择同名对象', () => {
    context = createTestContext('wenmi-query-plan-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    initializeRuntimeBook(context, scope, ids, clock, '检索书');
    const now = clock.now().toISOString();
    for (const [id, type] of [['zhang-character', 'character'], ['zhang-organization', 'organization']] as const) {
      context.database.prepare(`
        INSERT INTO entities (entity_id, owner_id, book_id, entity_type, canonical_name, aliases_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, '张三', '[]', 'active', ?, ?)
      `).run(id, scope.ownerId, scope.bookId, type, now, now);
    }
    const repository = new RetrievalOrchestrationRepository(context.database);
    const planner = new RetrievalQueryPlanner(new EntityDisambiguationService(repository), repository, ids, clock);
    const formal = planner.plan(scope, {
      query: '张三今天要对天安城宣战', roleKey: 'lead_screenwriter', mode: 'formal_production',
      canonRevision: 12, worldTime: '0030-01-01', knowledgeTime: '0030-01-01', viewpointEntityId: 'zhang-character'
    });
    expect(formal).toMatchObject({ intents: ['war_feasibility'], canonRevision: 12, blocked: true, blockReason: 'AMBIGUOUS_ENTITY_IN_FORMAL_PRODUCTION' });
    expect(formal.ambiguities[0]).toMatchObject({ matchedText: '张三' });
    const discussion = planner.plan(scope, {
      query: '张三今天要对天安城宣战', roleKey: 'lead_screenwriter', mode: 'open_discussion', canonRevision: 12
    });
    expect(discussion.blocked).toBe(false);
    expect(context.database.prepare(`SELECT status FROM retrieval_query_plans WHERE retrieval_query_plan_id = ?`).get(formal.planId)).toEqual({ status: 'blocked' });
  });
});
