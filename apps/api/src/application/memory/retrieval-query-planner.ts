import type { RetrievalMode, RetrievalPlan } from '../../contracts/retrieval-plan.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { RetrievalOrchestrationRepository } from '../../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import type { EntityDisambiguationService } from './entity-disambiguation-service.js';

export class RetrievalQueryPlanner {
  public constructor(
    private readonly entities: EntityDisambiguationService,
    private readonly repository: RetrievalOrchestrationRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public plan(scope: BookScope, input: {
    query: string; roleKey: string; mode: RetrievalMode; taskId?: string | null; canonRevision: number;
    worldTime?: string | null; knowledgeTime?: string | null; viewpointEntityId?: string | null;
  }): RetrievalPlan {
    const originalQuery = input.query;
    const normalizedQuery = originalQuery.trim().replace(/\s+/gu, ' ');
    if (normalizedQuery.length === 0) throw new Error('检索问题不能为空');
    const entities = this.entities.resolve(scope, normalizedQuery);
    const intents = classifyIntents(normalizedQuery);
    const blocked = input.mode === 'formal_production' && entities.ambiguities.length > 0;
    const plan: RetrievalPlan = {
      planId: this.ids.next(), roleKey: input.roleKey, mode: input.mode, originalQuery, normalizedQuery,
      intents, entitySeeds: entities.seeds, ambiguities: entities.ambiguities,
      channels: chooseChannels(intents), canonRevision: input.canonRevision,
      worldTime: input.worldTime ?? null, knowledgeTime: input.knowledgeTime ?? null,
      viewpointEntityId: input.viewpointEntityId ?? null, policyVersion: 'hybrid-four-channel-v1',
      blocked, blockReason: blocked ? 'AMBIGUOUS_ENTITY_IN_FORMAL_PRODUCTION' : null
    };
    this.repository.savePlan(scope, plan, input.taskId ?? null, this.clock.now().toISOString());
    return plan;
  }
}

function classifyIntents(query: string): string[] {
  const intents: string[] = [];
  if (/宣战|战争|战力|胜算|攻城/u.test(query)) intents.push('war_feasibility');
  if (/规则|允许|能否|权限/u.test(query)) intents.push('rule_check');
  if (/之前|曾经|历史|前文/u.test(query)) intents.push('historical_cause');
  if (/伏笔|承诺|约定/u.test(query)) intents.push('open_thread');
  if (/说话|语气|口吻/u.test(query)) intents.push('character_voice');
  if (intents.length === 0) intents.push('general_relevance');
  return intents.slice(0, 4);
}

function chooseChannels(intents: string[]): RetrievalPlan['channels'] {
  if (intents.every((intent) => intent === 'rule_check')) return ['structured', 'fts', 'relation'];
  return ['structured', 'fts', 'vector', 'relation'];
}
