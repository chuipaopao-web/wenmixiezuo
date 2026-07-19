import { afterEach, describe, expect, it } from 'vitest';
import { ContextCompressionService } from '../../apps/api/src/application/memory/context-compression-service.js';
import { ContextCompressionRepository } from '../../apps/api/src/infrastructure/db/repositories/context-compression-repository.js';
import { UnitOfWork } from '../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeRuntimeBook } from '../helpers/runtime-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('锚定式长聊天压缩恢复', () => {
  it('保留老板原话引用、决定和未决；探针失败继续使用上一有效快照', () => {
    context = createTestContext('wenmi-compression-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    initializeRuntimeBook(context, scope, ids, clock, '压缩书');
    const service = new ContextCompressionService(new ContextCompressionRepository(context.database), new UnitOfWork(context.database), ids, clock);
    const first = service.compress(scope, 'conversation-1', [
      { messageId: 'm1', role: 'boss', content: '张三不能背叛同伴。', kind: 'decision' },
      { messageId: 'm2', role: 'agent', content: '仍需确认天安城盟友。', kind: 'commitment' }
    ], () => true);
    expect(first.activated).toBe(true);
    const failed = service.compress(scope, 'conversation-1', [{ messageId: 'm3', role: 'agent', content: '错误压缩' }], () => false);
    expect(failed).toMatchObject({ snapshotId: first.snapshotId, activated: false });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM context_compression_snapshots WHERE status = 'active'`).get()).toEqual({ count: 1 });
    expect(JSON.stringify(failed.summary)).toContain('张三不能背叛同伴');
  });
});
