import { afterEach, describe, expect, it } from 'vitest';
import { RetentionService } from '../../../apps/api/src/application/knowledge/retention-service.js';
import { RetentionRepository } from '../../../apps/api/src/infrastructure/db/repositories/retention-repository.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { MutableClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('资料保留、宽限清理与恢复', () => {
  it('作者原始资料只能归档恢复，可重建临时投影需经过七天宽限并支持幂等清理', () => {
    context = createTestContext('wenmi-retention-');
    const ids = new SequenceIds();
    const clock = new MutableClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    initializeRuntimeBook(context, scope, ids, clock, '保留测试');
    const service = new RetentionService(new RetentionRepository(context.database), ids, clock);

    service.planArchive(scope, {
      objectType: 'manuscript_version', objectId: 'draft-1', archiveReference: 'archive/draft-1.zst',
      checksum: 'a'.repeat(64), reason: '超过热版本窗口'
    });
    expect(service.markArchived(scope, 'manuscript_version', 'draft-1').executionStatus).toBe('archived');
    expect(() => service.markCleanupEligible(scope, 'manuscript_version', 'draft-1')).toThrow('作者原始资料不能自动永久清理');
    expect(() => service.restoreArchive(scope, 'manuscript_version', 'draft-1', {
      checksumVerified: false, restoredReference: 'restore/draft-1'
    })).toThrow('恢复校验失败');
    expect(service.restoreArchive(scope, 'manuscript_version', 'draft-1', {
      checksumVerified: true, restoredReference: 'restore/draft-1'
    }).executionStatus).toBe('restored');

    service.planTemporaryProjectionCleanup(scope, {
      objectType: 'temporary_vector_snapshot', objectId: 'task-index-1', taskEndedAt: clock.now(), reason: '任务结束'
    });
    expect(() => service.markCleanupEligible(scope, 'temporary_vector_snapshot', 'task-index-1')).toThrow('宽限期尚未结束');
    clock.advance(7 * 24 * 60 * 60 * 1_000 + 1);
    expect(service.markCleanupEligible(scope, 'temporary_vector_snapshot', 'task-index-1').executionStatus).toBe('cleanup_eligible');
    expect(service.markCleaned(scope, 'temporary_vector_snapshot', 'task-index-1').executionStatus).toBe('cleaned');
    expect(service.markCleaned(scope, 'temporary_vector_snapshot', 'task-index-1').executionStatus).toBe('cleaned');
  });
});
