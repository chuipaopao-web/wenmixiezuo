import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export interface SettlementProbe { type: 'fact' | 'state' | 'commitment' | 'causality' | 'source' | 'negative'; expected: unknown; actual: unknown; passed: boolean }
export interface SettlementSource { sourceType: string; sourceId: string; sourceHash: string; locator: Record<string, unknown> }

export class StageSettlementService {
  public constructor(private readonly repository: LongformContinuityRepository, private readonly unitOfWork: UnitOfWork, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  public build(scope: BookScope, input: {
    stageType: 'chapter' | 'story_arc' | 'volume' | 'book'; stageKey: string; chapterStart: number; chapterEnd: number;
    canonRevision: number; payload: Record<string, unknown>; sources: SettlementSource[]; probes: SettlementProbe[];
  }): { settlementId: string; activated: boolean; retainedPreviousId: string | null } {
    if (input.sources.length === 0) throw new Error('阶段结算不能没有正史来源');
    if (input.sources.some((source) => source.sourceHash.length !== 64)) throw new Error('阶段结算来源哈希无效');
    if (input.probes.length === 0) throw new Error('阶段结算必须包含至少一个可验证探针');
    const previous = this.repository.activeSettlement(scope, input.stageType, input.stageKey);
    const id = this.ids.next();
    const now = this.clock.now().toISOString();
    const allPassed = input.probes.every((probe) => probe.passed);
    this.unitOfWork.run(() => {
      this.repository.insertSettlement(scope, { id, stageType: input.stageType, stageKey: input.stageKey,
        version: this.repository.nextSettlementVersion(scope, input.stageType, input.stageKey), chapterStart: input.chapterStart,
        chapterEnd: input.chapterEnd, canonRevision: input.canonRevision, payload: input.payload, status: 'building', now });
      for (const source of input.sources) this.repository.insertSettlementSource(scope, { id: this.ids.next(), settlementId: id, ...source, now });
      for (const probe of input.probes) this.repository.insertProbe(scope, { id: this.ids.next(), settlementId: id, ...probe, now });
      if (allPassed) this.repository.activateSettlement(scope, id, input.stageType, input.stageKey, now);
      else this.repository.failSettlement(scope, id);
    });
    return { settlementId: id, activated: allPassed, retainedPreviousId: allPassed ? null : previous?.id ?? null };
  }
}
