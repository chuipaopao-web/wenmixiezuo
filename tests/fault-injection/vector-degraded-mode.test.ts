import { describe, expect, it } from 'vitest';
import { LocalTransformersEmbedding } from '../../apps/api/src/infrastructure/retrieval/local-transformers-embedding.js';
import { NullVectorStore } from '../../apps/api/src/infrastructure/retrieval/null-vector-store.js';

describe('本地语义降级', () => {
  it('缺少或哈希不符的离线资产禁止远程下载并明确降级', async () => {
    const embedding = new LocalTransformersEmbedding({
      modelSnapshotId: 'missing', modelPath: 'D:/wenmixiezuo/data/models/not-installed',
      expectedAssetHash: '0'.repeat(64), dimension: 1024, cacheDir: 'D:/wenmixiezuo/data/cache/models'
    });
    expect(embedding.available).toBe(false);
    await expect(embedding.embedQuery('不会远程下载')).rejects.toThrow('LOCAL_EMBEDDING_ASSET_MISSING_OR_HASH_MISMATCH');
    const store = new NullVectorStore(embedding.degradationReason!);
    expect(await store.search({ ownerId: 'owner', bookId: 'book' }, 'unused', 'snapshot', [], 5)).toEqual([]);
  });
});
