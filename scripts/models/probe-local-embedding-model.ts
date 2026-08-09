import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LocalTransformersEmbedding, hashDirectory } from '../../apps/api/src/infrastructure/retrieval/local-transformers-embedding.js';

const projectRoot = process.cwd();
const dataDir = resolve(process.env.WENMI_DATA_DIR ?? resolve(projectRoot, 'data'));
const modelsDir = resolve(dataDir, 'cache', 'models');
const modelPath = readdirSync(modelsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(modelsDir, entry.name))
  .find((directory) => {
    if (!existsSync(resolve(directory, 'asset.json'))) return false;
    const manifest = JSON.parse(readFileSync(resolve(directory, 'asset.json'), 'utf8')) as { modelId?: string; revision?: string };
    return manifest.modelId === 'Xenova/bge-small-zh-v1.5' && manifest.revision === '75c43b069aac4d136ba6bc1122f995fedcfd2781';
  });
if (modelPath === undefined) throw new Error('LOCAL_EMBEDDING_MODEL_NOT_INSTALLED');
const manifest = JSON.parse(readFileSync(resolve(modelPath, 'asset.json'), 'utf8')) as {
  assetId: string; assetHash: string; dimension: number; revision: string;
};
if (hashDirectory(modelPath) !== manifest.assetHash) throw new Error('LOCAL_EMBEDDING_MODEL_HASH_MISMATCH');

const started = performance.now();
const memoryBefore = process.memoryUsage().rss;
const embedding = new LocalTransformersEmbedding({
  modelSnapshotId: `${manifest.assetId}:${manifest.revision}`,
  modelPath,
  expectedAssetHash: manifest.assetHash,
  dimension: manifest.dimension,
  cacheDir: resolve(dataDir, 'cache', 'transformers')
});
const query = await embedding.embedQuery('张三打算向天安城发起战争');
const documents = await embedding.embedDocuments([
  '张三准备对天安城宣战',
  '李四在河岸清点粮草',
  '今夜月色很安静'
]);
const scores = documents.map((vector) => dot(query, vector));
if (query.length !== 512 || scores[0]! <= scores[1]! || scores[0]! <= scores[2]!) {
  throw new Error('LOCAL_EMBEDDING_PROBE_FAILED');
}
process.stdout.write(`${JSON.stringify({
  ok: true,
  modelSnapshotId: embedding.modelSnapshotId,
  dimension: query.length,
  semanticScores: scores.map((score) => Number(score.toFixed(6))),
  durationMs: Math.ceil(performance.now() - started),
  rssDeltaBytes: Math.max(0, process.memoryUsage().rss - memoryBefore),
  remoteModelsAllowed: false
})}\n`);

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}