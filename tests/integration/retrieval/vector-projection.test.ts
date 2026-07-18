import { afterEach, describe, expect, it } from 'vitest';
import { DeterministicEmbeddingAdapter } from '../../../apps/api/src/infrastructure/retrieval/embedding-adapter.js';
import { LanceDbVectorStore } from '../../../apps/api/src/infrastructure/retrieval/lancedb-vector-store.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('LanceDB本地可重建向量投影', () => {
  it('落盘、重开、按书和快照过滤', async () => {
    context = createTestContext('wenmi-lance-');
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    const embedding = new DeterministicEmbeddingAdapter(32);
    const texts = ['张三准备向天安城宣战', '李四在河岸查看粮草'];
    const vectors = await embedding.embedDocuments(texts);
    const path = `${context.dataDir}/indexes/lance-test`;
    await new LanceDbVectorStore(path).rebuild(scope, 'book_one_vectors', texts.map((text, index) => ({
      chunkId: `chunk-${index}`, snapshotId: 'snapshot-1', text, vector: vectors[index]!
    })));
    const reopened = new LanceDbVectorStore(path);
    const hits = await reopened.search(scope, 'book_one_vectors', 'snapshot-1', await embedding.embedQuery('张三宣战天安城'), 2);
    expect(hits[0]).toMatchObject({ chunkId: 'chunk-0' });
    expect(await reopened.search({ ownerId: 'owner-one', bookId: 'book-two' }, 'book_one_vectors', 'snapshot-1', await embedding.embedQuery('张三'), 2)).toEqual([]);
  });
});
