import type { RetrievalCandidate, RetrievalPlan } from '../../contracts/retrieval-plan.js';
import type { IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { RetrievalChannelProvider } from '../../application/memory/retrieval-router.js';
import type { KnowledgeRepository } from '../db/repositories/knowledge-repository.js';
import type { ChunkSnapshotRepository } from '../db/repositories/chunk-snapshot-repository.js';
import type { RetrievalOrchestrationRepository } from '../db/repositories/retrieval-orchestration-repository.js';
import type { EmbeddingAdapter } from './embedding-adapter.js';
import type { VectorStore } from './vector-store.js';

export class StructuredKnowledgeProvider implements RetrievalChannelProvider {
  public readonly channel = 'structured' as const;
  public readonly available = true;
  public readonly degradationReason = null;
  public constructor(private readonly scope: BookScope, private readonly repository: KnowledgeRepository, private readonly ids: IdGenerator) {}
  public async retrieve(plan: RetrievalPlan, limit: number): Promise<RetrievalCandidate[]> {
    const filters: Parameters<KnowledgeRepository['listCanonAt']>[1] = { canonRevision: plan.canonRevision };
    if (plan.worldTime !== null) filters.worldTime = plan.worldTime;
    if (plan.knowledgeTime !== null) filters.knowledgeTime = plan.knowledgeTime;
    if (plan.viewpointEntityId !== null) filters.viewpointEntityId = plan.viewpointEntityId;
    return this.repository.listCanonAt(this.scope, filters).slice(0, limit).map((revision, index) => ({
      candidateId: this.ids.next(), channel: this.channel, channelRank: index + 1,
      lane: ['A', 'B'].includes(revision.authorityGrade) && revision.epistemicStatus === 'objective' ? 'H' : 'E',
      sourceType: revision.sourceType, sourceId: revision.sourceId, sourceVersion: String(revision.revision),
      sourceHash: revision.sourceHash, sourceLocator: revision.sourceLocator,
      provenanceKey: `${revision.sourceType}:${revision.sourceId}:${JSON.stringify(revision.sourceLocator)}`,
      assertionKey: revision.knowledgeItemId, content: revision.contentText, authorityGrade: revision.authorityGrade,
      lifecycleLayer: revision.layer, epistemicStatus: revision.epistemicStatus, negated: revision.negated,
      conflictGroup: revision.epistemicStatus === 'conflicted' ? revision.knowledgeItemId : null,
      metadata: { temporalMatch: true, viewpointMatch: true, canonRevision: revision.canonRevision }
    }));
  }
}

export class FtsChunkProvider implements RetrievalChannelProvider {
  public readonly channel = 'fts' as const;
  public readonly available = true;
  public readonly degradationReason = null;
  public constructor(private readonly scope: BookScope, private readonly snapshotId: string, private readonly repository: ChunkSnapshotRepository, private readonly ids: IdGenerator) {}
  public async retrieve(plan: RetrievalPlan, limit: number): Promise<RetrievalCandidate[]> {
    return this.repository.searchFts(this.scope, this.snapshotId, plan.normalizedQuery, limit).map((hit, index) => ({
      candidateId: this.ids.next(), channel: this.channel, channelRank: index + 1, lane: hit.lifecycleLayer === 'canon' ? 'E' : 'I',
      sourceType: hit.sourceType, sourceId: hit.sourceId, sourceVersion: hit.sourceVersion, sourceHash: hit.sourceHash,
      sourceLocator: { chunkId: hit.chunkId, byteStart: hit.byteStart, byteEnd: hit.byteEnd },
      provenanceKey: `${hit.sourceType}:${hit.sourceId}:${hit.byteStart}-${hit.byteEnd}`,
      assertionKey: null, content: hit.text, authorityGrade: null, lifecycleLayer: hit.lifecycleLayer,
      epistemicStatus: 'unknown', negated: false, conflictGroup: null,
      metadata: { temporalMatch: plan.worldTime === null, viewpointMatch: plan.viewpointEntityId === null }
    }));
  }
}

export class VectorChunkProvider implements RetrievalChannelProvider {
  public readonly channel = 'vector' as const;
  public get available(): boolean { return this.embedding.available && this.store.available; }
  public get degradationReason(): string | null { return this.embedding.degradationReason ?? this.store.degradationReason; }
  public constructor(
    private readonly scope: BookScope, private readonly snapshotId: string, private readonly tableName: string,
    private readonly repository: ChunkSnapshotRepository, private readonly embedding: EmbeddingAdapter,
    private readonly store: VectorStore, private readonly ids: IdGenerator
  ) {}
  public async retrieve(plan: RetrievalPlan, limit: number): Promise<RetrievalCandidate[]> {
    const vector = await this.embedding.embedQuery(plan.normalizedQuery);
    const hits = await this.store.search(this.scope, this.tableName, this.snapshotId, vector, limit);
    return hits.map((hit, index) => {
      const chunk = this.repository.requireChunk(this.scope, this.snapshotId, hit.chunkId);
      return {
        candidateId: this.ids.next(), channel: this.channel, channelRank: index + 1, lane: 'I' as const,
        sourceType: chunk.sourceType, sourceId: chunk.sourceId, sourceVersion: chunk.sourceVersion,
        sourceHash: chunk.sourceHash, sourceLocator: { chunkId: chunk.chunkId, byteStart: chunk.byteStart, byteEnd: chunk.byteEnd },
        provenanceKey: `${chunk.sourceType}:${chunk.sourceId}:${chunk.byteStart}-${chunk.byteEnd}`, assertionKey: null,
        content: chunk.text, authorityGrade: chunk.authorityGrade, lifecycleLayer: chunk.lifecycleLayer,
        epistemicStatus: chunk.narrativeMode === 'current' ? 'objective' : chunk.narrativeMode,
        negated: false, conflictGroup: null, metadata: { distance: hit.distance, temporalMatch: plan.worldTime === null, viewpointMatch: plan.viewpointEntityId === null }
      };
    });
  }
}

export class RelationProvider implements RetrievalChannelProvider {
  public readonly channel = 'relation' as const;
  public readonly available = true;
  public readonly degradationReason = null;
  public constructor(private readonly scope: BookScope, private readonly repository: RetrievalOrchestrationRepository, private readonly ids: IdGenerator) {}
  public async retrieve(plan: RetrievalPlan, limit: number): Promise<RetrievalCandidate[]> {
    return this.repository.expandRelations(this.scope, plan.entitySeeds.map((seed) => seed.entityId), plan.canonRevision)
      .slice(0, limit).map((edge, index) => ({
        candidateId: this.ids.next(), channel: this.channel, channelRank: index + 1, lane: 'E',
        sourceType: 'fact_assertion', sourceId: edge.sourceFactId, sourceVersion: null, sourceHash: edge.sourceHash,
        sourceLocator: { relationshipId: edge.relationshipId }, provenanceKey: `fact:${edge.sourceFactId}`,
        assertionKey: `${edge.fromEntityId}:${edge.relationKey}`, content: `${edge.fromEntityId} ${edge.relationKey} ${JSON.stringify(edge.toValue)}`,
        authorityGrade: null, lifecycleLayer: 'derived', epistemicStatus: 'objective', negated: false,
        conflictGroup: null, metadata: { depth: edge.depth, temporalMatch: true, viewpointMatch: true }
      }));
  }
}
