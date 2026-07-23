import { describe, expect, it } from 'vitest';
import type { RetrievalPlan } from '../../apps/api/src/contracts/retrieval-plan.js';
import type { IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { ChunkSnapshotRepository } from '../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import { FtsChunkProvider } from '../../apps/api/src/infrastructure/retrieval/retrieval-channel-providers.js';

describe('实体聚焦全文检索', () => {
  it('长章宽查询未召回人物后续真相时，用已消歧的人物局部语句补回证据', async () => {
    const calls: string[] = [];
    const oldClaim = hit('old-claim', '陈渡两年前就死了，贺铸曾经验尸。');
    const laterResolution = hit('later-resolution', '当年那具尸体是照着陈渡的伤伪造的，陈渡本人已经归队。');
    const repository = {
      searchFts(_scope: unknown, _snapshotId: string, query: string) {
        calls.push(query);
        if (query.includes('后来人活着归队')) return [laterResolution, oldClaim];
        return [oldClaim];
      }
    } as unknown as ChunkSnapshotRepository;
    let sequence = 0;
    const ids = { next: () => `candidate-${++sequence}` } as IdGenerator;
    const provider = new FtsChunkProvider(
      { ownerId: 'owner', bookId: 'book' }, 'snapshot', repository, ids
    );
    const plan = {
      originalQuery: '陈渡，归队。陈渡早死过一次。失踪时名册报了阵亡，后来人活着归队，那一笔却没销。',
      normalizedQuery: '一段包含大量常见词元的长章查询',
      entitySeeds: [{ entityId: 'chendu', entityType: 'character', canonicalName: '陈渡', matchedText: '陈渡', verified: true }]
    } as RetrievalPlan;

    const results = await provider.retrieve(plan, 6);

    expect(calls).toEqual(expect.arrayContaining([
      expect.stringContaining('后来人活着归队')
    ]));
    expect(results.map((result) => result.sourceId)).toEqual(expect.arrayContaining([
      'later-resolution', 'old-claim'
    ]));
  });
});

function hit(chunkId: string, text: string) {
  return {
    chunkId,
    rank: -1,
    text,
    sourceType: 'manuscript',
    sourceId: chunkId,
    sourceVersion: 'v1',
    sourceHash: `hash-${chunkId}`,
    contentHash: `content-${chunkId}`,
    byteStart: 0,
    byteEnd: text.length,
    lifecycleLayer: 'canon' as const,
    matchedTerms: 2,
    queryTerms: 4
  };
}
