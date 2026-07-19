import type { RetrievalCandidate, RetrievalChannel, RetrievalPlan } from '../../contracts/retrieval-plan.js';

export interface RetrievalChannelProvider {
  readonly channel: RetrievalChannel;
  readonly available: boolean;
  readonly degradationReason: string | null;
  retrieve(plan: RetrievalPlan, limit: number): Promise<RetrievalCandidate[]>;
}

export interface RetrievalChannelResult {
  channel: RetrievalChannel;
  status: 'ready' | 'degraded' | 'skipped' | 'failed';
  reason: string | null;
  candidates: RetrievalCandidate[];
  durationMs: number;
}

const LIMITS: Record<RetrievalChannel, number> = { structured: 40, fts: 48, vector: 48, relation: 64 };

export class RetrievalRouter {
  public constructor(private readonly providers: RetrievalChannelProvider[]) {}

  public async run(plan: RetrievalPlan): Promise<RetrievalChannelResult[]> {
    if (plan.blocked) throw new Error(plan.blockReason!);
    return Promise.all(plan.channels.map(async (channel) => {
      const provider = this.providers.find((candidate) => candidate.channel === channel);
      if (provider === undefined) return { channel, status: 'skipped' as const, reason: 'PROVIDER_NOT_REGISTERED', candidates: [], durationMs: 0 };
      if (!provider.available) return { channel, status: 'degraded' as const, reason: provider.degradationReason, candidates: [], durationMs: 0 };
      if (channel === 'relation' && plan.entitySeeds.length === 0) return { channel, status: 'skipped' as const, reason: 'NO_VERIFIED_ENTITY_SEED', candidates: [], durationMs: 0 };
      if (channel === 'relation' && plan.entitySeeds.length > 8) return { channel, status: 'failed' as const, reason: 'RELATION_SEED_LIMIT_EXCEEDED', candidates: [], durationMs: 0 };
      const started = performance.now();
      try {
        const candidates = await provider.retrieve(plan, LIMITS[channel]);
        return { channel, status: 'ready' as const, reason: null, candidates: candidates.slice(0, LIMITS[channel]), durationMs: Math.ceil(performance.now() - started) };
      } catch (error) {
        return { channel, status: 'failed' as const, reason: error instanceof Error ? error.name : 'UNKNOWN_CHANNEL_FAILURE', candidates: [], durationMs: Math.ceil(performance.now() - started) };
      }
    }));
  }
}
