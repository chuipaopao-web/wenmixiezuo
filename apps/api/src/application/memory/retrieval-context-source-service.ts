import type { RetrievalMode } from '../../contracts/retrieval-plan.js';
import type { BookScope } from '../../domain/scope.js';
import type { ContextSource } from './context-pack-service.js';
import type { HybridRetrievalService } from './hybrid-retrieval-service.js';

export interface RetrievalContextInput {
  query: string;
  roleKey: string;
  mode: RetrievalMode;
  canonRevision: number;
  taskId: string;
  sourceTypes: string[];
  limit: number;
}

export class RetrievalContextSourceService {
  public constructor(private readonly retrieval: HybridRetrievalService) {}

  public async collect(scope: BookScope, input: RetrievalContextInput): Promise<{
    hardSources: ContextSource[];
    optionalSources: ContextSource[];
    planId: string;
  }> {
    const result = await this.retrieval.search(scope, input);
    const hardSources: ContextSource[] = [];
    const optionalSources: ContextSource[] = [];
    for (const hit of result.hits) {
      const source: ContextSource = {
        sourceType: `retrieval:${hit.sourceType}`,
        sourceId: `${hit.sourceId}:${hit.clusterId}`,
        ...(hit.sourceVersion === null ? {} : { version: hit.sourceVersion }),
        content: hit.content,
        reason: `混合检索 ${hit.lane} 车道；证据闭环=${hit.closure}；通道=${hit.channels.join('+')}`,
        priority: hit.lane === 'H' ? 96 - hit.rank : hit.lane === 'E' ? 74 - hit.rank : 54 - hit.rank
      };
      if (hit.lane === 'H' && hit.closure === 'closed') hardSources.push(source);
      else optionalSources.push(source);
    }
    return { hardSources, optionalSources, planId: result.plan.planId };
  }
}
