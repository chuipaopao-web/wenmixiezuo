import { afterEach, describe, expect, it } from 'vitest';
import { MemoryService, type MemoryLayer } from '../../../apps/api/src/application/memory/memory-service.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('当前记忆层与书籍隔离', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('按书籍、层级、Agent和正史版本读取活动记忆', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const memory = new MemoryService(context.database, ids, clock);
    const layers: MemoryLayer[] = [
      'system_rules', 'story_bible', 'canon_fact', 'chapter_end',
      'manuscript_index', 'book_working', 'agent_private', 'task_temporary'
    ];
    for (const layer of layers) {
      memory.remember(fixture.scope, {
        layer,
        content: `${layer}的可追溯内容`,
        sourceType: 'test',
        sourceId: layer,
        canonRevision: layer === 'system_rules' ? 0 : 1,
        positioningVersion: 1,
        ...(layer === 'agent_private' ? { agentId: fixture.agentId } : {})
      });
    }
    expect(memory.listActive(fixture.scope, { agentId: fixture.agentId, canonRevision: 1 })).toHaveLength(8);
    expect(memory.listActive(fixture.scope, { layer: 'story_bible', canonRevision: 1 }).map((item) => item.layer))
      .toEqual(['story_bible']);
  });
});
