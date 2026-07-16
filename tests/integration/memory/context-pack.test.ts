import { afterEach, describe, expect, it } from 'vitest';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { ContextPackService, estimateTokens } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { DomainError, errorCodes } from '../../../apps/api/src/domain/errors.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('不可变上下文包', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('完整保留硬来源并显式记录低优先级排除原因', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const hardContent = '老板决定：正文不可静默覆盖。当前正文：林澈抵达北塔。';
    const hardTokens = estimateTokens(hardContent);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: hardTokens + 2,
      hardSources: [{ sourceType: 'boss_decision', sourceId: 'decision-1', content: hardContent, reason: '老板已确认决定与当前正文', priority: 100 }],
      optionalSources: [
        { sourceType: 'expert_note', sourceId: 'low-note', content: '这是很长的低优先级专家建议，不应挤掉硬来源。', reason: '可选建议', priority: 1 },
        { sourceType: 'hint', sourceId: 'short-hint', content: '提示', reason: '短提示', priority: 10 }
      ]
    });
    expect(pack.sources[0]?.content).toBe(hardContent);
    expect(pack.sources[0]?.hard).toBe(true);
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'low-note', reason: 'token_budget_lower_priority' }));
    const stored = context.database.prepare(`SELECT source_manifest_json, content_hash FROM context_packs WHERE context_pack_id = ?`)
      .get(pack.contextPackId) as { source_manifest_json: string; content_hash: string };
    expect(JSON.parse(stored.source_manifest_json)[0].content).toBe(hardContent);
    expect(stored.content_hash).toBe(pack.contentHash);
  });

  it('硬来源超预算时暂停而不是截断', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const database = context.database;
    expect(() => new ContextPackService(database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1,
      hardSources: [{ sourceType: 'current_manuscript', sourceId: 'current', content: '不可截断的当前完整正文', reason: '当前正文', priority: 100 }],
      optionalSources: []
    })).toThrowError(expect.objectContaining<Partial<DomainError>>({ code: errorCodes.operationIncomplete }));
  });

  it('正史变化只使旧版本派生上下文失效', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const contextPacks = new ContextPackService(context.database, ids, clock);
    const oldPack = contextPacks.build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 100,
      hardSources: [{ sourceType: 'rule', sourceId: 'rule', content: '服从正史', reason: '硬规则', priority: 100 }], optionalSources: []
    });
    const canon = new CanonService(context.database, ids, clock);
    const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈' });
    canon.proposeFact(fixture.scope, {
      subjectEntityId: entityId, relationKey: 'location', value: '北塔', evidence: [{ quote: '抵达北塔' }], grade: 'B',
      sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
    });
    canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, { location: '北塔' });
    expect(context.database.prepare(`SELECT status FROM context_packs WHERE context_pack_id = ?`).get(oldPack.contextPackId)).toEqual({ status: 'invalidated' });
  });
});
