import type { RetrievalCandidate, RetrievalPlan } from '../../contracts/retrieval-plan.js';
import type { IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { RetrievalChannelProvider } from '../../application/memory/retrieval-router.js';
import type { KnowledgeRepository } from '../db/repositories/knowledge-repository.js';
import type { ChunkSnapshotRepository } from '../db/repositories/chunk-snapshot-repository.js';
import type { RetrievalOrchestrationRepository } from '../db/repositories/retrieval-orchestration-repository.js';
import type { EmbeddingAdapter } from './embedding-adapter.js';
import type { VectorStore } from './vector-store.js';

// BGE向量已归一化，LanceDB默认L2返回平方距离。该保守门槛等价于余弦相似度约0.55；
// 它是版本化起始安全线而非“最佳参数”，独立金标校准前宁可漏掉I灵感，也不强填无答案查询。
export const VECTOR_MAX_SQUARED_L2_DISTANCE = 0.9;

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
    const ranked = this.repository.listCanonAt(this.scope, filters)
      .map((revision) => ({ revision, relevance: structuredRelevance(plan, revision.contentText) }))
      .filter((item) => item.relevance > 0)
      .sort((left, right) => right.relevance - left.relevance
        || right.revision.canonRevision - left.revision.canonRevision
        || left.revision.knowledgeRevisionId.localeCompare(right.revision.knowledgeRevisionId))
      .slice(0, limit);
    return ranked.map(({ revision, relevance }, index) => ({
      candidateId: this.ids.next(), channel: this.channel, channelRank: index + 1,
      lane: ['A', 'B'].includes(revision.authorityGrade) && revision.epistemicStatus === 'objective' ? 'H' : 'E',
      sourceType: revision.sourceType, sourceId: revision.sourceId, sourceVersion: String(revision.revision),
      sourceHash: revision.sourceHash, sourceLocator: revision.sourceLocator,
      provenanceKey: `${revision.sourceType}:${revision.sourceId}:${JSON.stringify(revision.sourceLocator)}`,
      assertionKey: revision.knowledgeItemId, content: revision.contentText, authorityGrade: revision.authorityGrade,
      lifecycleLayer: revision.layer, epistemicStatus: revision.epistemicStatus, negated: revision.negated,
      conflictGroup: revision.epistemicStatus === 'conflicted' ? revision.knowledgeItemId : null,
      metadata: { temporalMatch: true, viewpointMatch: true, canonRevision: revision.canonRevision, relevance }
    }));
  }
}

function structuredRelevance(plan: RetrievalPlan, content: string): number {
  let score = 0;
  for (const seed of plan.entitySeeds) {
    if (content.includes(seed.canonicalName)) score += 8;
    if (seed.matchedText !== seed.canonicalName && content.includes(seed.matchedText)) score += 5;
  }
  const intentTerms: Record<string, string[]> = {
    war_feasibility: ['宣战', '战争', '战力', '兵力', '军队', '攻城', '守军', '粮草', '权限', '规则'],
    rule_check: ['规则', '允许', '禁止', '权限', '条件', '代价'],
    historical_cause: ['曾经', '此前', '历史', '原因', '承诺', '冲突'],
    open_thread: ['伏笔', '承诺', '约定', '未决', '债务'],
    character_voice: ['说话', '语气', '口吻', '习惯', '声音']
  };
  for (const intent of plan.intents) for (const term of intentTerms[intent] ?? []) if (content.includes(term)) score += 2;
  for (const token of plan.normalizedQuery.match(/[\p{Script=Han}]{2}|[\p{L}\p{N}_]{2,}/gu) ?? []) if (content.includes(token)) score += 1;
  return score;
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
      metadata: { lexicalMatchedTerms: hit.matchedTerms, lexicalQueryTerms: hit.queryTerms,
        temporalMatch: plan.worldTime === null, viewpointMatch: plan.viewpointEntityId === null }
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
    const hits = (await this.store.search(this.scope, this.tableName, this.snapshotId, vector, limit))
      .filter((hit) => Number.isFinite(hit.distance) && hit.distance <= VECTOR_MAX_SQUARED_L2_DISTANCE);
    return hits.map((hit, index) => {
      const chunk = this.repository.requireChunk(this.scope, this.snapshotId, hit.chunkId);
      return {
        candidateId: this.ids.next(), channel: this.channel, channelRank: index + 1, lane: 'I' as const,
        sourceType: chunk.sourceType, sourceId: chunk.sourceId, sourceVersion: chunk.sourceVersion,
        sourceHash: chunk.sourceHash, sourceLocator: { chunkId: chunk.chunkId, byteStart: chunk.byteStart, byteEnd: chunk.byteEnd },
        provenanceKey: `${chunk.sourceType}:${chunk.sourceId}:${chunk.byteStart}-${chunk.byteEnd}`, assertionKey: null,
        content: chunk.text, authorityGrade: chunk.authorityGrade, lifecycleLayer: chunk.lifecycleLayer,
        epistemicStatus: chunk.narrativeMode === 'current' ? 'objective' : chunk.narrativeMode,
        negated: false, conflictGroup: null, metadata: { distance: hit.distance,
          similarity: 1 - hit.distance / 2, thresholdPolicy: 'bge-normalized-l2-v1',
          temporalMatch: plan.worldTime === null, viewpointMatch: plan.viewpointEntityId === null }
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
