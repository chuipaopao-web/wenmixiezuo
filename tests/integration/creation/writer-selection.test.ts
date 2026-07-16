import { afterEach, describe, expect, it } from 'vitest';
import { WriterSelectionService } from '../../../apps/api/src/application/creation/writer-selection-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('主笔选择与真实模型来源', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('标准模式保存匿名候选评分并配置异模型审校', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '盲测选笔书', text: '比较两个确定性假模型样章' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const selections = new WriterSelectionService(context.database, ids, clock);
    const selected = selections.select(scope, 'standard_blind');
    expect(selected.candidates.map((candidate) => candidate.blindLabel)).toEqual(['A', 'B']);
    expect(selected.candidates.every((candidate) => candidate.provider.startsWith('local-deterministic'))).toBe(true);
    expect(new Set(selected.candidates.map((candidate) => candidate.equalContextHash)).size).toBe(1);
    expect(selected.candidates.every((candidate) => candidate.sampleText.length === 700 && candidate.sampleHash.length === 64 && candidate.revisionOpportunity === 1)).toBe(true);
    expect(() => selections.assertDistinctModels(scope, selected)).not.toThrow();
    const agents = context.database.prepare(`
      SELECT r.role_key, m.provider, m.model_id FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('writer', 'reviewer') ORDER BY r.role_key
    `).all(scope.ownerId, scope.bookId);
    expect(agents).toEqual([
      { role_key: 'reviewer', provider: 'local-deterministic-reviewer', model_id: 'wenmai-novel-reviewer-v1' },
      { role_key: 'writer', provider: 'local-deterministic-writer', model_id: 'wenmai-novel-writer-v1' }
    ]);
  });
});
