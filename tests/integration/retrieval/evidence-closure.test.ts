import { describe, expect, it } from 'vitest';
import { EvidenceClosureService } from '../../../apps/api/src/application/memory/evidence-closure-service.js';
import type { EvidenceCluster, RetrievalPlan } from '../../../apps/api/src/contracts/retrieval-plan.js';

describe('确定性结论证据闭环', () => {
  it('H必须解引用当前正史、来源哈希、时间和观点；候选或错时间返回未知', () => {
    const plan = { worldTime: '0030', viewpointEntityId: 'zhang' } as RetrievalPlan;
    const base = {
      clusterId: 'cluster-1', lane: 'H', adopted: true, adoptionReason: 'hard_authority_lane', conflictGroup: null,
      primary: {
        sourceId: 'fact-1', sourceHash: 'a'.repeat(64), sourceLocator: { factId: 'fact-1' }, lifecycleLayer: 'canon',
        metadata: { temporalMatch: true, viewpointMatch: true }, negated: false, epistemicStatus: 'objective'
      }
    } as unknown as EvidenceCluster;
    expect(new EvidenceClosureService().check(plan, base)).toMatchObject({ result: 'closed', canonVerified: true, timeVerified: true });
    expect(new EvidenceClosureService().check(plan, {
      ...base, clusterId: 'cluster-2', primary: { ...base.primary, lifecycleLayer: 'candidate', metadata: { temporalMatch: false, viewpointMatch: true } }
    })).toMatchObject({ result: 'unknown', canonVerified: false, timeVerified: false });
  });
});
