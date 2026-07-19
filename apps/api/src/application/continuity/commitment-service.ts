import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { CommitmentRecord, LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';

export class CommitmentService {
  public constructor(private readonly repository: LongformContinuityRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  public open(scope: BookScope, input: Omit<Parameters<LongformContinuityRepository['insertCommitment']>[1], 'id' | 'now'>): CommitmentRecord {
    if (input.sourceHash.length !== 64) throw new Error('承诺必须绑定64位来源哈希');
    const id = this.ids.next();
    this.repository.insertCommitment(scope, { ...input, id, now: this.clock.now().toISOString() });
    return this.repository.listCommitments(scope).find((item) => item.commitmentId === id)!;
  }
  public relevant(scope: BookScope, currentChapter: number): CommitmentRecord[] { return this.repository.listCommitments(scope, currentChapter); }
  public resolve(scope: BookScope, id: string, resolutionSourceId: string): void {
    if (!this.repository.updateCommitmentStatus(scope, id, 'fulfilled', resolutionSourceId, this.clock.now().toISOString())) throw new Error('承诺不存在');
  }
}
