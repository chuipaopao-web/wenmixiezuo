import { afterEach, describe, expect, it } from 'vitest';
import { MemoryService, type MemoryLayer } from '../../../apps/api/src/application/memory/memory-service.js';
import { RetrievalService } from '../../../apps/api/src/application/memory/retrieval-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('八层记忆与隔离检索', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('保存并按范围读取八层记忆', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const memory = new MemoryService(context.database, ids, clock);
    const layers: MemoryLayer[] = ['system_rules', 'story_bible', 'canon_fact', 'chapter_end', 'manuscript_index', 'book_working', 'agent_private', 'task_temporary'];
    for (const layer of layers) {
      memory.remember(fixture.scope, {
        layer, content: `${layer}的可靠内容`, sourceType: 'test', sourceId: layer,
        canonRevision: layer === 'system_rules' ? 0 : 1, positioningVersion: 1,
        ...(layer === 'agent_private' ? { agentId: fixture.agentId } : {})
      });
    }
    expect(memory.listActive(fixture.scope, { agentId: fixture.agentId, canonRevision: 1 })).toHaveLength(8);
    expect(memory.listActive(fixture.scope, { layer: 'story_bible', canonRevision: 1 }).map((item) => item.layer)).toEqual(['story_bible']);
  });

  it('FTS损坏后按书重建且严格禁止跨书串线', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = createKnowledgeFixture(context, ids, clock, { title: '甲书' });
    const secondBook = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '乙书', text: '另一部完全隔离的小说' });
    const secondScope = { ownerId: context.config.ownerId, bookId: secondBook.bookId };
    const memory = new MemoryService(context.database, ids, clock);
    const retrieval = new RetrievalService(context.database, ids, clock);
    memory.remember(first.scope, { layer: 'story_bible', content: '甲书锚点 ALPHA-ONLY', sourceType: 'bible', sourceId: 'alpha', canonRevision: 0, positioningVersion: 1 });
    memory.remember(secondScope, { layer: 'story_bible', content: '乙书机密 BETA-SECRET', sourceType: 'bible', sourceId: 'beta', canonRevision: 0, positioningVersion: 1 });
    expect(retrieval.search(first.scope, 'BETA-SECRET', { canonRevision: 0 })).toEqual([]);
    expect(retrieval.search(secondScope, 'BETA-SECRET', { canonRevision: 0 })[0]?.content).toContain('乙书机密');
    context.database.prepare(`DELETE FROM content_fts WHERE owner_id = ? AND book_id = ?`).run(first.scope.ownerId, first.scope.bookId);
    expect(retrieval.search(first.scope, 'ALPHA-ONLY', { canonRevision: 0 })).toEqual([]);
    expect(retrieval.rebuildBook(first.scope)).toBe(1);
    expect(retrieval.search(first.scope, 'ALPHA-ONLY', { canonRevision: 0 })[0]?.content).toContain('甲书锚点');
  });

  it('百万字符语料硬锚点召回率为100%', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock, { title: '百万字压力书' });
    const anchors = Array.from({ length: 100 }, (_, index) => `HARDANCHOR${String(index).padStart(3, '0')}`);
    const prefix = anchors.join(' ') + ' ';
    const corpus = (prefix + '长篇叙事 '.repeat(Math.ceil((1_000_000 - prefix.length) / 5))).slice(0, 1_000_000);
    expect(corpus).toHaveLength(1_000_000);
    new MemoryService(context.database, ids, clock).remember(fixture.scope, {
      layer: 'manuscript_index', content: corpus, sourceType: 'stress_corpus', sourceId: 'million-char-v1',
      canonRevision: 0, positioningVersion: 1, importance: 100
    });
    const retrieval = new RetrievalService(context.database, ids, clock);
    const recalled = anchors.filter((anchor) => retrieval.search(fixture.scope, anchor, { canonRevision: 0, limit: 10 }).length > 0);
    expect(recalled).toHaveLength(anchors.length);
  });

  it('确定性语义扩展评测Recall@10不低于95%', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock, { title: '语义检索评测书' });
    const pairs = [
      ['导师', '师父'], ['死亡', '身亡'], ['位置', '所在地'], ['武器', '兵刃'], ['秘密', '隐情'],
      ['愤怒', '恼怒'], ['害怕', '恐惧'], ['高兴', '欣喜'], ['敌人', '仇敌'], ['朋友', '伙伴'],
      ['逃跑', '撤离'], ['战斗', '交锋'], ['承诺', '誓言'], ['伤势', '创伤'], ['线索', '提示'],
      ['宝物', '秘宝'], ['城镇', '城池'], ['森林', '林地'], ['夜晚', '深夜'], ['早晨', '拂晓']
    ] as const;
    const memory = new MemoryService(context.database, ids, clock);
    for (const [index, pair] of pairs.entries()) {
      memory.remember(fixture.scope, {
        layer: 'canon_fact', content: `语义目标${index} ${pair[1]} 独立证据${index}`,
        sourceType: 'semantic_fixture', sourceId: `semantic-${index}`, canonRevision: 0, positioningVersion: 1
      });
    }
    const retrieval = new RetrievalService(context.database, ids, clock);
    let recalled = 0;
    for (const [index, pair] of pairs.entries()) {
      const hits = retrieval.search(fixture.scope, pair[0], { canonRevision: 0, limit: 10 });
      if (hits.some((hit) => hit.content.includes(`语义目标${index}`))) recalled += 1;
    }
    expect(recalled / pairs.length).toBeGreaterThanOrEqual(0.95);
  });
});
