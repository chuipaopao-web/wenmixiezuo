import { describe, expect, it } from 'vitest';
import { EvidenceClusterer } from '../../../apps/api/src/application/memory/evidence-clusterer.js';
import { LaneFusionService } from '../../../apps/api/src/application/memory/lane-fusion-service.js';
import { RetrievalRouter, type RetrievalChannelProvider } from '../../../apps/api/src/application/memory/retrieval-router.js';
import type { RetrievalCandidate, RetrievalPlan } from '../../../apps/api/src/contracts/retrieval-plan.js';
import { VectorChunkProvider, VECTOR_MAX_SQUARED_L2_DISTANCE } from '../../../apps/api/src/infrastructure/retrieval/retrieval-channel-providers.js';
import type { ChunkSnapshotRepository } from '../../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import type { EmbeddingAdapter } from '../../../apps/api/src/infrastructure/retrieval/embedding-adapter.js';
import type { VectorStore } from '../../../apps/api/src/infrastructure/retrieval/vector-store.js';
import { SequenceIds } from '../../helpers/test-context.js';

const hash = 'a'.repeat(64);
const plan: RetrievalPlan = {
  planId: 'plan-1', roleKey: 'lead_screenwriter', mode: 'open_discussion', originalQuery: '张三宣战天安城', normalizedQuery: '张三宣战天安城',
  intents: ['war_feasibility'], entitySeeds: [{ entityId: 'zhang', entityType: 'character', canonicalName: '张三', matchedText: '张三', verified: true }],
  ambiguities: [], channels: ['structured', 'fts', 'vector', 'relation'], canonRevision: 5, worldTime: '0030', knowledgeTime: null,
  viewpointEntityId: null, policyVersion: 'v1', blocked: false, blockReason: null
};

describe('四通道路由、同源聚类和H/E/I融合', () => {
  it('同一原文的FTS、向量和关系副本只形成一个证据簇并采用更强车道', async () => {
    const base = candidate({ candidateId: 'c1', channel: 'fts', channelRank: 1, lane: 'E', provenanceKey: 'chapter-9:10-30' });
    const providers: RetrievalChannelProvider[] = [
      provider('structured', [candidate({ candidateId: 'hard', channel: 'structured', channelRank: 1, lane: 'H', provenanceKey: 'fact:war-rule', content: '宣战需要领主权限' })]),
      provider('fts', [base]),
      provider('vector', [candidate({ ...base, candidateId: 'c-vector', channel: 'vector', lane: 'I', channelRank: 1 })]),
      provider('relation', [candidate({ ...base, candidateId: 'c2', channel: 'relation', channelRank: 2 })])
    ];
    const runs = await new RetrievalRouter(providers).run(plan);
    const clusters = new EvidenceClusterer(new SequenceIds()).cluster(runs.flatMap((run) => run.candidates));
    expect(clusters).toHaveLength(2);
    const fused = new LaneFusionService().fuse(clusters, 'open_discussion');
    expect(fused[0]).toMatchObject({ lane: 'H', rrfScore: 0, adopted: true, adoptionReason: 'hard_authority_lane' });
    expect(fused.find((cluster) => cluster.lane === 'E')!.candidates).toHaveLength(3);
  });

  it('向量运行时缺失时只降级该通道', async () => {
    const runs = await new RetrievalRouter([
      { channel: 'vector', available: false, degradationReason: 'EMBEDDING_ASSET_MISSING', async retrieve() { return []; } }
    ]).run(plan);
    expect(runs.find((run) => run.channel === 'vector')).toMatchObject({
      channel: 'vector', status: 'degraded', reason: 'EMBEDDING_ASSET_MISSING'
    });
  });

  it('互斥硬事实不会被RRF或多数票平均', () => {
    const clusters = new EvidenceClusterer(new SequenceIds()).cluster([
      candidate({ candidateId: 'yes', channel: 'structured', channelRank: 1, lane: 'H', provenanceKey: 'fact-yes', content: '张三拥有宣战权', conflictGroup: 'war-right' }),
      candidate({ candidateId: 'no', channel: 'structured', channelRank: 2, lane: 'H', provenanceKey: 'fact-no', content: '张三没有宣战权', conflictGroup: 'war-right', negated: true })
    ]);
    expect(new LaneFusionService().fuse(clusters, 'formal_production')).toEqual(expect.arrayContaining([
      expect.objectContaining({ adopted: false, adoptionReason: 'hard_conflict_requires_resolution', rrfScore: 0 })
    ]));
  });

  it('向量距离超过保守门槛时返回无答案而不是强填最像片段', async () => {
    const repository = {
      requireChunk() { throw new Error('超过门槛的候选不得解引用'); }
    } as unknown as ChunkSnapshotRepository;
    const embedding = {
      modelSnapshotId: 'normalized-fixture', dimension: 3, available: true, degradationReason: null,
      async embedDocuments() { return [[1, 0, 0]]; }, async embedQuery() { return [1, 0, 0]; }
    } satisfies EmbeddingAdapter;
    const store = {
      available: true, degradationReason: null, async rebuild() {},
      async search() { return [{ chunkId: 'unrelated', text: '无关资料', distance: VECTOR_MAX_SQUARED_L2_DISTANCE + 0.01 }]; }
    } satisfies VectorStore;
    const provider = new VectorChunkProvider({ ownerId: 'owner', bookId: 'book' }, 'snapshot', 'vector_table', repository, embedding, store, new SequenceIds());
    await expect(provider.retrieve(plan, 8)).resolves.toEqual([]);
  });
});

function provider(channel: RetrievalChannelProvider['channel'], values: RetrievalCandidate[]): RetrievalChannelProvider {
  return { channel, available: true, degradationReason: null, async retrieve(_plan, limit) { return values.slice(0, limit); } };
}
function candidate(patch: Partial<RetrievalCandidate>): RetrievalCandidate {
  return {
    candidateId: 'candidate', channel: 'fts', channelRank: 1, lane: 'E', sourceType: 'manuscript', sourceId: 'chapter-9',
    sourceVersion: 'canon-v1', sourceHash: hash, sourceLocator: { byteStart: 10, byteEnd: 30 }, provenanceKey: 'chapter-9:10-30',
    assertionKey: 'war-history', content: '张三曾在城下发出最后通牒', authorityGrade: 'A', lifecycleLayer: 'canon',
    epistemicStatus: 'objective', negated: false, conflictGroup: null, metadata: { temporalMatch: true, viewpointMatch: true }, ...patch
  };
}
