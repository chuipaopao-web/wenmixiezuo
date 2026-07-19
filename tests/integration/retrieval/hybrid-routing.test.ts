import { describe, expect, it } from 'vitest';
import { EvidenceClusterer } from '../../../apps/api/src/application/memory/evidence-clusterer.js';
import { LaneFusionService } from '../../../apps/api/src/application/memory/lane-fusion-service.js';
import { RetrievalRouter, type RetrievalChannelProvider } from '../../../apps/api/src/application/memory/retrieval-router.js';
import type { RetrievalCandidate, RetrievalPlan } from '../../../apps/api/src/contracts/retrieval-plan.js';
import { SequenceIds } from '../../helpers/test-context.js';

const hash = 'a'.repeat(64);
const plan: RetrievalPlan = {
  planId: 'plan-1', roleKey: 'lead_screenwriter', mode: 'open_discussion', originalQuery: '张三宣战天安城', normalizedQuery: '张三宣战天安城',
  intents: ['war_feasibility'], entitySeeds: [{ entityId: 'zhang', entityType: 'character', canonicalName: '张三', matchedText: '张三', verified: true }],
  ambiguities: [], channels: ['structured', 'fts', 'vector', 'relation'], canonRevision: 5, worldTime: '0030', knowledgeTime: null,
  viewpointEntityId: null, policyVersion: 'v1', blocked: false, blockReason: null
};

describe('四通道路由、同源聚类和H/E/I融合', () => {
  it('向量缺失显式降级，同一原文的FTS/关系副本只形成一个证据簇', async () => {
    const base = candidate({ candidateId: 'c1', channel: 'fts', channelRank: 1, lane: 'E', provenanceKey: 'chapter-9:10-30' });
    const providers: RetrievalChannelProvider[] = [
      provider('structured', [candidate({ candidateId: 'hard', channel: 'structured', channelRank: 1, lane: 'H', provenanceKey: 'fact:war-rule', content: '宣战需要领主权限' })]),
      provider('fts', [base]),
      { channel: 'vector', available: false, degradationReason: 'EMBEDDING_ASSET_MISSING', async retrieve() { return []; } },
      provider('relation', [candidate({ ...base, candidateId: 'c2', channel: 'relation', channelRank: 2 })])
    ];
    const runs = await new RetrievalRouter(providers).run(plan);
    expect(runs.find((run) => run.channel === 'vector')).toMatchObject({ status: 'degraded', reason: 'EMBEDDING_ASSET_MISSING' });
    const clusters = new EvidenceClusterer(new SequenceIds()).cluster(runs.flatMap((run) => run.candidates));
    expect(clusters).toHaveLength(2);
    const fused = new LaneFusionService().fuse(clusters, 'open_discussion');
    expect(fused[0]).toMatchObject({ lane: 'H', rrfScore: 0, adopted: true, adoptionReason: 'hard_authority_lane' });
    expect(fused.find((cluster) => cluster.lane === 'E')!.candidates).toHaveLength(2);
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
