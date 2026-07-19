import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';

export class RollingPlanService {
  public constructor(private readonly repository: LongformContinuityRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  public advance(scope: BookScope, input: { currentChapter: number; detailedChapters: number; outlinedChapters: number; spanEstimateId?: string; plan: unknown }): number {
    if (input.detailedChapters < 1 || input.outlinedChapters < input.detailedChapters) throw new Error('滚动规划窗口范围无效');
    const active = this.repository.activeRollingPlan(scope);
    const version = (active?.version ?? 0) + 1;
    this.repository.activateRollingPlan(scope, { id: this.ids.next(), version, currentChapter: input.currentChapter,
      detailedStart: input.currentChapter, detailedEnd: input.currentChapter + input.detailedChapters - 1,
      outlinedEnd: input.currentChapter + input.outlinedChapters - 1, ...(input.spanEstimateId === undefined ? {} : { spanEstimateId: input.spanEstimateId }),
      plan: input.plan, now: this.clock.now().toISOString() });
    return version;
  }
  public invalidateForMaterialChange(scope: BookScope, reason: string, material: boolean): boolean {
    return material ? this.repository.invalidateRollingPlan(scope, reason) : false;
  }
}
