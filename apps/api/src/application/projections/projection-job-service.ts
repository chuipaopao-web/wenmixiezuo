import type { ProjectionType } from '../../contracts/projections.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { ProjectionRepository } from '../../infrastructure/db/repositories/projection-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export class ProjectionJobService {
  public constructor(
    private readonly repository: ProjectionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public enqueue(scope: BookScope, input: {
    projectionType: ProjectionType; sourceSnapshotId: string; requiredCanonRevision: number;
    idempotencyKey: string; payload?: Record<string, unknown>;
  }): { outboxId: string; created: boolean } {
    if (input.idempotencyKey.trim().length === 0) throw new Error('投影幂等键不能为空');
    return this.repository.enqueue(scope, {
      outboxId: this.ids.next(), ...input, payloadJson: JSON.stringify(input.payload ?? {}),
      now: this.clock.now().toISOString()
    });
  }

  public run(scope: BookScope, outboxId: string, workerId: string, executor: () => Record<string, unknown>): { jobId: string; status: 'ready' | 'failed' } {
    const jobId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.unitOfWork.run(() => this.repository.claim(scope, outboxId, jobId, workerId, now));
    try {
      const probes = executor();
      this.unitOfWork.run(() => this.repository.complete(scope, outboxId, jobId, JSON.stringify(probes), this.clock.now().toISOString()));
      return { jobId, status: 'ready' };
    } catch (error) {
      const code = error instanceof Error ? error.name : 'UNKNOWN_PROJECTION_FAILURE';
      this.unitOfWork.run(() => this.repository.fail(scope, outboxId, jobId, code, this.clock.now().toISOString()));
      return { jobId, status: 'failed' };
    }
  }
}
