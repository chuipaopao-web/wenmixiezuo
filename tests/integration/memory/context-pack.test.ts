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
    expect(pack.sources[0]).toMatchObject({ constraintStrength: 'hard_fact', truthStatus: 'confirmed', scopeType: 'book' });
    expect(pack.sources.find((source) => source.sourceId === 'short-hint')).toMatchObject({ constraintStrength: 'soft_reference' });
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'low-note', reason: 'token_budget_lower_priority' }));
    const stored = context.database.prepare(`SELECT source_manifest_json, content_hash FROM context_packs WHERE context_pack_id = ?`)
      .get(pack.contextPackId) as { source_manifest_json: string; content_hash: string };
    expect(JSON.parse(stored.source_manifest_json)[0].content).toBe(hardContent);
    expect(stored.content_hash).toBe(pack.contentHash);
    expect(JSON.parse(stored.source_manifest_json)[0]).toMatchObject({
      constraintStrength: 'hard_fact', truthStatus: 'confirmed', scopeType: 'book', dependencies: [] });
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

  it('按字符预算构建可追溯资料包并保存策略版本与来源指纹', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId,
      agentId: fixture.agentId,
      chapterId: fixture.chapterId,
      canonRevision: 0,
      positioningVersion: 1,
      tokenBudget: 100,
      characterBudget: 12,
      policyVersion: 'writer-context-test-v2',
      hardSources: [
        { sourceType: 'chapter_work_order', sourceId: 'order-1', content: '本章目标六个字', reason: '硬工单', priority: 100 }
      ],
      optionalSources: [
        { sourceType: 'optional', sourceId: 'fits', content: '补充', reason: '可选', priority: 10 },
        { sourceType: 'optional', sourceId: 'too-long', content: '这是一段超过剩余字符预算的资料', reason: '低优先级', priority: 1 }
      ]
    });
    expect(pack.totalCharacters).toBeLessThanOrEqual(12);
    expect(pack.sources.find((source) => source.sourceId === 'order-1'))
      .toMatchObject({ constraintStrength: 'current_task', truthStatus: 'planned', scopeType: 'chapter' });
    expect(pack.policyVersion).toBe('writer-context-test-v2');
    expect(pack.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(pack.excluded).toContainEqual(expect.objectContaining({
      sourceId: 'too-long',
      reason: 'character_budget_lower_priority'
    }));
    expect(context.database.prepare(`
      SELECT policy_version, source_fingerprint FROM context_packs WHERE context_pack_id = ?
    `).get(pack.contextPackId)).toEqual({
      policy_version: 'writer-context-test-v2',
      source_fingerprint: pack.sourceFingerprint
    });
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

  it('完整前章已硬注入时排除同版本派生检索块并记录duplicate_of_hard_source', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [{ sourceType: 'manuscript', sourceId: 'mv-1', content: '前章完整正文', reason: '完整不可变版本', priority: 100, version: 'mv-1' }],
      optionalSources: [
        { sourceType: 'retrieval:manuscript', sourceId: 'mv-1-chunk-a', content: '前章正文片段A', reason: '同版本检索块', priority: 50, version: 'mv-1' },
        { sourceType: 'retrieval:manuscript', sourceId: 'mv-2-chunk-b', content: '旧版本正文片段', reason: '不同版本检索块', priority: 40, version: 'mv-2' }
      ]
    });
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'mv-1-chunk-a', reason: 'duplicate_of_hard_source' }));
    expect(pack.sources.some((source) => source.sourceId === 'mv-2-chunk-b')).toBe(true);
    expect(pack.sources.some((source) => source.sourceId === 'mv-1-chunk-a')).toBe(false);
    expect(pack.sources.some((source) => source.sourceId === 'mv-1' && source.hard)).toBe(true);
  });

  it('硬前章正文无version时按正文版本ID根排除同源检索块', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    // 真实场景：previous_chapter_manuscript 只带 sourceId(manuscriptVersionId) 无 version，
    // 而 retrieval:manuscript 带 version(contentHash) 且 sourceId 形如 manuscriptVersionId:clusterId。
    // version 不对齐时，必须按 sourceId 根(manuscriptVersionId) 去重，否则同源重复注入。
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [{ sourceType: 'previous_chapter_manuscript', sourceId: 'mv-9', content: '前章完整正史正文', reason: '前章已结算完整正文', priority: 98 }],
      optionalSources: [
        { sourceType: 'retrieval:manuscript', sourceId: 'mv-9:cluster-a', content: '前章正文片段A', reason: '同物理正文的检索子块', priority: 50, version: 'contentHash-9' },
        { sourceType: 'retrieval:manuscript', sourceId: 'mv-10:cluster-b', content: '他章正文片段', reason: '不同正文的检索子块', priority: 40, version: 'contentHash-10' }
      ]
    });
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'mv-9:cluster-a', reason: 'duplicate_of_hard_source' }));
    expect(pack.sources.some((source) => source.sourceId === 'mv-10:cluster-b')).toBe(true);
    expect(pack.sources.some((source) => source.sourceId === 'mv-9:cluster-a')).toBe(false);
  });

  it('按正文内容指纹排除重复硬来源和重复可选来源并保留排除证据', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const duplicateContent = '同一份章纲内容只应进入一次资料包';
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [
        { sourceType: 'chapter_outline', sourceId: 'outline-1', content: duplicateContent, reason: '完整章纲', priority: 100 },
        { sourceType: 'planning:current_chapter', sourceId: 'outline-copy', content: duplicateContent, reason: '规划链副本', priority: 100 }
      ],
      optionalSources: [
        { sourceType: 'retrieval:outline', sourceId: 'outline-retrieval', content: duplicateContent, reason: '检索副本', priority: 50 },
        { sourceType: 'retrieval:fact', sourceId: 'fact-a', content: '独立事实', reason: '相关事实', priority: 40 },
        { sourceType: 'retrieval:fact', sourceId: 'fact-b', content: '独立事实', reason: '重复事实', priority: 30 }
      ]
    });
    expect(pack.sources.map((source) => source.sourceId)).toEqual(['outline-1', 'fact-a']);
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'outline-copy', reason: 'duplicate_of_hard_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'outline-retrieval', reason: 'duplicate_of_included_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'fact-b', reason: 'duplicate_of_included_source' }));
  });

  it('完整前章和完整章纲已经注入时排除其尾段及检索切片', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const fullPreviousChapter = '前章开头。前章中段发生冲突。前章结尾留下钩子。';
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [
        { sourceType: 'chapter_outline', sourceId: 'outline-v1', content: '本章完整章纲内容', reason: '本章章纲', priority: 100 },
        { sourceType: 'previous_chapter_end', sourceId: 'previous:1', content: '前章结尾留下钩子。', reason: '前章结尾', priority: 100 },
        { sourceType: 'previous_chapter_tail', sourceId: 'manuscript-v1', content: '前章中段发生冲突。前章结尾留下钩子。', reason: '前章尾段', priority: 100 },
        { sourceType: 'previous_chapter_full', sourceId: 'manuscript-v1', content: fullPreviousChapter, reason: '前章全文', priority: 100 }
      ],
      optionalSources: [
        { sourceType: 'retrieval:outline', sourceId: 'outline-v1:cluster-a', content: '本章完整章纲内容的一部分', reason: '章纲检索切片', priority: 60 },
        { sourceType: 'retrieval:manuscript', sourceId: 'manuscript-v1:cluster-b', content: '前章中段发生冲突。', reason: '前章检索切片', priority: 50 },
        { sourceType: 'retrieval:fact', sourceId: 'fact-v1:cluster-c', content: '独立正史事实', reason: '相关事实', priority: 40 }
      ]
    });
    expect(pack.sources.map((source) => source.sourceId)).toEqual(['outline-v1', 'manuscript-v1', 'fact-v1:cluster-c']);
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'previous:1', reason: 'duplicate_of_hard_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceType: 'previous_chapter_tail', reason: 'duplicate_of_hard_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'outline-v1:cluster-a', reason: 'duplicate_of_hard_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'manuscript-v1:cluster-b', reason: 'duplicate_of_hard_source' }));
  });

  it('只有前章尾段时不因版本相同误删前章其他位置的检索证据', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [
        { sourceType: 'previous_chapter_tail', sourceId: 'manuscript-v1', content: '前章最后的钩子。', reason: '前章尾段', priority: 100 }
      ],
      optionalSources: [
        { sourceType: 'retrieval:manuscript', sourceId: 'manuscript-v1:cluster-a', content: '前章中段的独立证据。', reason: '前章中段', priority: 50 }
      ]
    });
    expect(pack.sources.map((source) => source.sourceId)).toEqual(['manuscript-v1', 'manuscript-v1:cluster-a']);
  });
});
