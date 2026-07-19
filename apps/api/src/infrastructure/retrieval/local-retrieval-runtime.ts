import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RetrievalVectorRuntime } from '../../application/memory/hybrid-retrieval-service.js';
import { LocalTransformersEmbedding } from './local-transformers-embedding.js';
import { LanceDbVectorStore } from './lancedb-vector-store.js';

interface AssetManifest {
  assetId: string; kind: string; modelId: string; revision: string; license: string;
  dimension: number; assetHash: string; capabilities: string[];
  queryInstruction?: string;
}

export function loadLocalRetrievalRuntime(dataDir: string): RetrievalVectorRuntime | undefined {
  const root = resolve(dataDir, 'cache', 'models');
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const modelPath = resolve(root, entry.name);
    const manifestPath = resolve(modelPath, 'asset.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: AssetManifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetManifest; }
    catch { continue; }
    if (manifest.kind !== 'embedding' || !manifest.capabilities?.includes('embedding') || !/^[a-f0-9]{64}$/u.test(manifest.assetHash)) continue;
    const embedding = new LocalTransformersEmbedding({
      modelSnapshotId: `${manifest.assetId}:${manifest.revision}`, modelPath,
      expectedAssetHash: manifest.assetHash, dimension: manifest.dimension,
      cacheDir: resolve(dataDir, 'cache', 'transformers-api'),
      queryInstruction: manifest.queryInstruction ?? ''
    });
    if (!embedding.available) continue;
    return {
      embedding,
      store: new LanceDbVectorStore(resolve(dataDir, 'indexes', 'lancedb')),
      model: { modelId: manifest.modelId, modelVersion: manifest.revision, assetHash: manifest.assetHash }
    };
  }
  return undefined;
}
