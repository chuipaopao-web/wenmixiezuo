import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { RetentionRecord, RetentionRepository } from '../../infrastructure/db/repositories/retention-repository.js';

const AUTHOR_VISIBLE = new Set(['chat_message', 'manuscript_version', 'outline', 'setting', 'research_source']);
const REBUILDABLE = new Set(['temporary_vector_snapshot', 'chunk_projection', 'fts_projection', 'wiki_projection', 'summary_projection', 'cache']);

export class RetentionService {
  public constructor(
    private readonly repository: RetentionRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public planArchive(scope: BookScope, input: {
    objectType: string; objectId: string; archiveReference: string; checksum: string; reason: string;
  }): RetentionRecord {
    if (!/^[a-f0-9]{64}$/u.test(input.checksum)) throw new Error('归档必须携带64位校验哈希');
    if (input.archiveReference.trim().length === 0) throw new Error('归档位置不能为空');
    return this.repository.plan(scope, {
      retentionRecordId: this.ids.next(), objectType: input.objectType, objectId: input.objectId,
      retentionClass: 'archive', archiveReference: input.archiveReference, checksum: input.checksum,
      reason: input.reason, status: 'planned', now: this.clock.now().toISOString()
    });
  }

  public markArchived(scope: BookScope, objectType: string, objectId: string): RetentionRecord {
    const record = this.repository.require(scope, objectType, objectId);
    if (record.archiveReference === null || record.checksum === null) throw new Error('归档校验信息不完整');
    return this.repository.transition(scope, objectType, objectId, 'planned', 'archived', this.clock.now().toISOString());
  }

  public planTemporaryProjectionCleanup(scope: BookScope, input: { objectType: string; objectId: string; taskEndedAt: Date; reason: string }): RetentionRecord {
    if (!REBUILDABLE.has(input.objectType)) throw new Error('只有明确可重建投影可以自动进入清理宽限期');
    const graceExpiresAt = new Date(input.taskEndedAt.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    return this.repository.plan(scope, {
      retentionRecordId: this.ids.next(), objectType: input.objectType, objectId: input.objectId,
      retentionClass: 'grace', graceExpiresAt, reason: input.reason, status: 'planned',
      now: this.clock.now().toISOString()
    });
  }

  public markCleanupEligible(scope: BookScope, objectType: string, objectId: string): RetentionRecord {
    if (AUTHOR_VISIBLE.has(objectType) || !REBUILDABLE.has(objectType)) throw new Error('作者原始资料不能自动永久清理');
    const record = this.repository.require(scope, objectType, objectId);
    if (record.graceExpiresAt === null || Date.parse(record.graceExpiresAt) > this.clock.now().getTime()) {
      throw new Error('清理宽限期尚未结束');
    }
    if (record.executionStatus === 'cleanup_eligible' || record.executionStatus === 'cleaned') return record;
    return this.repository.transition(scope, objectType, objectId, 'planned', 'cleanup_eligible', this.clock.now().toISOString());
  }

  public markCleaned(scope: BookScope, objectType: string, objectId: string): RetentionRecord {
    if (!REBUILDABLE.has(objectType)) throw new Error('只有可重建投影可以标记为已清理');
    const record = this.repository.require(scope, objectType, objectId);
    if (record.executionStatus === 'cleaned') return record;
    return this.repository.transition(scope, objectType, objectId, 'cleanup_eligible', 'cleaned', this.clock.now().toISOString());
  }

  public restoreArchive(scope: BookScope, objectType: string, objectId: string, result: { checksumVerified: boolean; restoredReference: string }): RetentionRecord {
    if (!result.checksumVerified) throw new Error('恢复校验失败，原归档保持不变');
    const record = this.repository.require(scope, objectType, objectId);
    if (record.executionStatus !== 'archived') throw new Error('只有已归档对象可以恢复');
    return this.repository.transition(scope, objectType, objectId, 'archived', 'restored', this.clock.now().toISOString(), result);
  }
}
