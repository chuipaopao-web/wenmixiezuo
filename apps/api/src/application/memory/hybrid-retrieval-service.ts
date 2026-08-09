import type { EvidenceClosure, RetrievalMode } from '../../contracts/retrieval-plan.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { ChunkSnapshotRepository } from '../../infrastructure/db/repositories/chunk-snapshot-repository.js';
import type { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';
import type { RetrievalOrchestrationRepository } from '../../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import type { EmbeddingAdapter } from '../../infrastructure/retrieval/embedding-adapter.js';
import { FtsChunkProvider, RelationProvider, StructuredKnowledgeProvider, VectorChunkProvider } from '../../infrastructure/retrieval/retrieval-channel-providers.js';
import type { VectorStore } from '../../infrastructure/retrieval/vector-store.js';
import { EntityDisambiguationService } from './entity-disambiguation-service.js';
import { EvidenceClosureService } from './evidence-closure-service.js';
import { EvidenceClusterer } from './evidence-clusterer.js';
import { LaneFusionService } from './lane-fusion-service.js';
import { RetrievalQueryPlanner } from './retrieval-query-planner.js';
import { RetrievalRouter, type RetrievalChannelProvider } from './retrieval-router.js';

export interface RetrievalVectorRuntime {
  embedding: EmbeddingAdapter;
  store: VectorStore;
  model: { modelId: string; modelVersion: string; assetHash: string };
}

export interface HybridRetrievalInput {
  query: string;
  roleKey: string;
  mode: RetrievalMode;
  canonRevision: number;
  taskId?: string | null;
  limit?: number;
  sourceTypes?: string[];
  adoptedSourceIds?: string[];
  worldTime?: string | null;
  knowledgeTime?: string | null;
  viewpointEntityId?: string | null;
}

export class HybridRetrievalService {
  private readonly planner: RetrievalQueryPlanner;
  public constructor(
    private readonly repository: RetrievalOrchestrationRepository,
    private readonly knowledge: KnowledgeRepository,
    private readonly chunks: ChunkSnapshotRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly vectorRuntime?: RetrievalVectorRuntime
  ) {
    this.planner = new RetrievalQueryPlanner(new EntityDisambiguationService(repository), repository, ids, clock);
  }

  public async search(scope: BookScope, input: HybridRetrievalInput) {
    const limit = Math.max(1, Math.min(input.limit ?? 12, 50));
    const plan = this.planner.plan(scope, {
      query: input.query, roleKey: input.roleKey, mode: input.mode, taskId: input.taskId ?? null,
      canonRevision: input.canonRevision, worldTime: input.worldTime ?? null,
      knowledgeTime: input.knowledgeTime ?? null, viewpointEntityId: input.viewpointEntityId ?? null
    });
    if (plan.blocked) return { plan, channels: [], hits: [], closures: [] };
    try {
      const state = this.repository.projectionState(scope);
      const providers = this.providers(scope, input.canonRevision, state);
      const runs = await new RetrievalRouter(providers).run(plan);
      const allCandidates = runs.flatMap((run) => run.candidates);
      const allowedTypes = new Set(input.sourceTypes ?? []);
      const candidates = allowedTypes.size === 0 ? allCandidates : allCandidates.filter((candidate) => allowedTypes.has(candidate.sourceType));
      const clusters = new EvidenceClusterer(this.ids).cluster(candidates);
      const fusionMode = ['open_discussion', 'creative_exploration'].includes(input.mode) ? 'open_discussion' : 'formal_production';
      const fused = new LaneFusionService().fuse(clusters, fusionMode);
      const closureService = new EvidenceClosureService();
      const closures = fused.map((cluster) => closureService.check(plan, cluster));
      const closureByCluster = new Map(closures.map((closure) => [closure.clusterId, closure]));
      const adoptedCandidateIds = new Set(fused.filter((cluster) => cluster.adopted)
        .flatMap((cluster) => cluster.candidates.map((candidate) => candidate.candidateId)));
      const selected = fused.filter((cluster) => cluster.adopted).slice(0, limit);
      const hits = selected.map((cluster, index) => ({
        rank: index + 1, clusterId: cluster.clusterId, lane: cluster.lane, channels: Object.keys(cluster.channelRanks),
        sourceType: cluster.primary.sourceType, sourceId: cluster.primary.sourceId,
        sourceVersion: cluster.primary.sourceVersion, sourceHash: cluster.primary.sourceHash,
        sourceLocator: cluster.primary.sourceLocator, content: cluster.primary.content,
        authorityGrade: cluster.primary.authorityGrade, lifecycleLayer: cluster.primary.lifecycleLayer,
        epistemicStatus: cluster.primary.epistemicStatus, negated: cluster.primary.negated,
        closure: closureByCluster.get(cluster.clusterId)?.result ?? 'unknown', score: cluster.rrfScore
      }));
      const now = this.clock.now().toISOString();
      this.repository.saveExecution(scope, {
        planId: plan.planId,
        runs: runs.map((run) => ({
          runId: this.ids.next(), channel: run.channel,
          snapshotId: run.channel === 'fts' ? state.fts?.snapshotId ?? null : run.channel === 'vector' ? state.vector?.snapshotId ?? null : null,
          canonRevision: run.channel === 'fts' ? state.fts?.canonRevision ?? null : run.channel === 'vector' ? state.vector?.canonRevision ?? null : input.canonRevision,
          candidateCount: run.candidates.length,
          adoptedCount: run.candidates.filter((candidate) => adoptedCandidateIds.has(candidate.candidateId)).length,
          durationMs: run.durationMs, status: run.status, reason: run.reason
        })),
        candidates: allCandidates.map((candidate) => ({
          candidate,
          status: (allowedTypes.size > 0 && !allowedTypes.has(candidate.sourceType)) ? 'excluded'
            : adoptedCandidateIds.has(candidate.candidateId) ? 'adopted' : 'candidate',
          exclusionReason: (allowedTypes.size > 0 && !allowedTypes.has(candidate.sourceType)) ? 'source_type_filter' : null
        })),
        clusters: fused,
        closures: closures.map((closure) => ({ closureId: this.ids.next(), closure })),
        legacyRecord: {
          retrievalId: this.ids.next(), taskId: input.taskId ?? null, queryText: input.query,
          filtersJson: JSON.stringify({ sourceTypes: input.sourceTypes ?? [], limit, roleKey: input.roleKey, mode: input.mode }),
          resultsJson: JSON.stringify(hits.map((hit) => ({ sourceType: hit.sourceType, sourceId: hit.sourceId, rank: hit.rank, lane: hit.lane, closure: hit.closure }))),
          adoptedSourceIdsJson: JSON.stringify(input.adoptedSourceIds ?? []), canonRevision: input.canonRevision
        },
        now
      });
      return {
        plan,
        channels: runs.map((run) => ({ channel: run.channel, status: run.status, reason: run.reason,
          candidateCount: run.candidates.length, adoptedCount: run.candidates.filter((candidate) => adoptedCandidateIds.has(candidate.candidateId)).length,
          durationMs: run.durationMs })),
        hits,
        closures: closures.map(publicClosure)
      };
    } catch (error) {
      this.repository.failPlan(scope, plan.planId);
      throw error;
    }
  }

  private providers(scope: BookScope, canonRevision: number, state: ReturnType<RetrievalOrchestrationRepository['projectionState']>): RetrievalChannelProvider[] {
    const structured = new StructuredKnowledgeProvider(scope, this.knowledge, this.ids);
    const fts = state.fts === null
      ? unavailable('fts', 'FTS_PROJECTION_MISSING')
      : state.fts.canonRevision !== canonRevision
        ? unavailable('fts', 'FTS_PROJECTION_CANON_REVISION_MISMATCH')
        : new FtsChunkProvider(scope, state.fts.snapshotId, this.chunks, this.ids);
    const vectorIdentityMatches = state.vector !== null && this.vectorRuntime !== undefined
      && state.vector.dimension === this.vectorRuntime.embedding.dimension
      && state.vector.modelId === this.vectorRuntime.model.modelId
      && state.vector.modelVersion === this.vectorRuntime.model.modelVersion
      && state.vector.assetHash === this.vectorRuntime.model.assetHash;
    const vector = state.vector === null
      ? unavailable('vector', 'VECTOR_PROJECTION_MISSING')
      : state.vector.canonRevision !== canonRevision
        ? unavailable('vector', 'VECTOR_PROJECTION_CANON_REVISION_MISMATCH')
        : this.vectorRuntime === undefined
          ? unavailable('vector', 'LOCAL_EMBEDDING_RUNTIME_UNAVAILABLE')
          : !vectorIdentityMatches
            ? unavailable('vector', 'VECTOR_EMBEDDING_SNAPSHOT_MISMATCH')
            : new VectorChunkProvider(scope, state.vector.snapshotId, state.vector.tableName, this.chunks,
              this.vectorRuntime.embedding, this.vectorRuntime.store, this.ids);
    return [structured, fts, vector, new RelationProvider(scope, this.repository, this.ids)];
  }
}

function unavailable(channel: RetrievalChannelProvider['channel'], reason: string): RetrievalChannelProvider {
  return { channel, available: false, degradationReason: reason, async retrieve() { return []; } };
}
function publicClosure(closure: EvidenceClosure) {
  return { clusterId: closure.clusterId, result: closure.result, reasons: closure.reasons };
}
