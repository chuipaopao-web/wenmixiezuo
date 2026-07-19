import type { EntityAmbiguity, EntitySeed } from '../../contracts/retrieval-plan.js';
import type { BookScope } from '../../domain/scope.js';
import type { RetrievalOrchestrationRepository } from '../../infrastructure/db/repositories/retrieval-orchestration-repository.js';

export class EntityDisambiguationService {
  public constructor(private readonly repository: RetrievalOrchestrationRepository) {}

  public resolve(scope: BookScope, query: string): { seeds: EntitySeed[]; ambiguities: EntityAmbiguity[] } {
    const matches = this.repository.findEntityMatches(scope, query);
    const byMention = new Map<string, typeof matches>();
    for (const match of matches) byMention.set(match.matchedText, [...(byMention.get(match.matchedText) ?? []), match]);
    const seeds: EntitySeed[] = [];
    const ambiguities: EntityAmbiguity[] = [];
    for (const [matchedText, candidates] of byMention) {
      if (candidates.length === 1) {
        const candidate = candidates[0]!;
        seeds.push({ entityId: candidate.entityId, entityType: candidate.entityType, canonicalName: candidate.canonicalName, matchedText, verified: true });
      } else {
        ambiguities.push({ matchedText, candidates: candidates.map((candidate) => ({ entityId: candidate.entityId, entityType: candidate.entityType, canonicalName: candidate.canonicalName })) });
      }
    }
    return { seeds, ambiguities };
  }
}
