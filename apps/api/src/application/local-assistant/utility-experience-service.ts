import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { LocalAssistantRepository } from '../../infrastructure/db/repositories/local-assistant-repository.js';

export class UtilityExperienceService {
  public constructor(private readonly repository: LocalAssistantRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  public propose(scope: BookScope, input: { type: 'tool' | 'routing' | 'failure_recovery'; rule: unknown; evidence: unknown[]; counterexamples: unknown[]; applicability: unknown; rollbackCondition: string }): string {
    if (input.evidence.length === 0 || input.counterexamples.length === 0) throw new Error('经验候选必须同时包含证据和反例');
    const id = this.ids.next(); const now = this.clock.now();
    this.repository.insertExperience(scope, { id, ...input, expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(), now: now.toISOString() }); return id;
  }
}
