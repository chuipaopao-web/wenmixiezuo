import type { KnowledgeRevisionRecord } from '../../contracts/knowledge-lifecycle.js';
import type { BookScope } from '../../domain/scope.js';
import type { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';

export class TemporalQueryService {
  public constructor(private readonly repository: KnowledgeRepository) {}

  public query(scope: BookScope, input: {
    canonRevision: number;
    knowledgeType?: string;
    canonicalKey?: string;
    worldTime?: string;
    viewpointEntityId?: string;
    knowledgeTime?: string;
  }): KnowledgeRevisionRecord[] {
    return this.repository.listCanonAt(scope, input);
  }
}
