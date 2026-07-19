import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { connect, type Connection } from '@lancedb/lancedb';
import type { VectorProjectionRuntime } from '../executors/projection-task-executor.js';

interface AssetManifest {
  assetId: string;
  kind: string;
  modelId: string;
  revision: string;
  license: string;
  dimension: number;
  normalized: boolean;
  quantization: string | null;
  queryInstruction: string;
  capabilities: string[];
  assetHash: string;
  files: Array<{ path: string; sha256: string; bytes?: number }>;
}

type FeatureExtractor = (text: string, options: { pooling: 'mean'; normalize: true }) => Promise<{ data: ArrayLike<number> }>;

class WorkerLocalEmbedding {
  public readonly available = true;
  public readonly degradationReason = null;
  public readonly modelSnapshotId: string;
  public readonly dimension: number;
  #extractor: FeatureExtractor | null = null;

  public constructor(private readonly modelPath: string, manifest: AssetManifest, private readonly cacheDir: string) {
    this.modelSnapshotId = `${manifest.assetId}:${manifest.revision}`;
    this.dimension = manifest.dimension;
  }

  public async embedDocuments(texts: string[]): Promise<number[][]> {
    const extractor = await this.extractor();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data);
      if (vector.length !== this.dimension) throw new Error('LOCAL_EMBEDDING_DIMENSION_MISMATCH');
      results.push(vector);
    }
    return results;
  }

  private async extractor(): Promise<FeatureExtractor> {
    if (this.#extractor === null) {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = resolve(this.modelPath, '..');
      env.cacheDir = this.cacheDir;
      const create = pipeline as unknown as (
        task: 'feature-extraction', model: string, options: { local_files_only: true; dtype: 'q8' }
      ) => Promise<FeatureExtractor>;
      this.#extractor = await create('feature-extraction', this.modelPath, { local_files_only: true, dtype: 'q8' });
    }
    return this.#extractor;
  }
}

class WorkerLanceDbStore {
  public readonly available = true;
  public readonly degradationReason = null;
  #connection: Connection | null = null;
  public constructor(private readonly databasePath: string) {}

  public async rebuild(scope: { ownerId: string; bookId: string }, tableName: string, records: Array<{
    chunkId: string; snapshotId: string; text: string; vector: number[];
  }>): Promise<void> {
    validateTableName(tableName);
    if (records.length === 0) throw new Error('VECTOR_SOURCE_EMPTY');
    await (await this.connection()).createTable(tableName, records.map((record) => ({
      chunk_id: record.chunkId, owner_id: scope.ownerId, book_id: scope.bookId,
      snapshot_id: record.snapshotId, text: record.text, vector: record.vector
    })), { mode: 'overwrite' });
  }

  public async search(scope: { ownerId: string; bookId: string }, tableName: string, snapshotId: string,
    vector: number[], limit: number): Promise<Array<{ chunkId: string; text: string; distance: number }>> {
    validateTableName(tableName);
    const table = await (await this.connection()).openTable(tableName);
    const rows = await table.vectorSearch(vector)
      .where(`owner_id = '${escapeFilter(scope.ownerId)}' AND book_id = '${escapeFilter(scope.bookId)}' AND snapshot_id = '${escapeFilter(snapshotId)}'`)
      .limit(limit).toArray() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ chunkId: String(row.chunk_id), text: String(row.text), distance: Number(row._distance) }));
  }

  private async connection(): Promise<Connection> {
    this.#connection ??= await connect(this.databasePath);
    return this.#connection;
  }
}

export async function loadLocalVectorRuntime(dataDir: string): Promise<VectorProjectionRuntime | undefined> {
  const root = resolve(dataDir, 'cache', 'models');
  if (!existsSync(root)) return undefined;
  for (const directory of modelDirectories(root)) {
    const manifestPath = resolve(directory, 'asset.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: AssetManifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetManifest; }
    catch { continue; }
    if (manifest.kind !== 'embedding' || !manifest.capabilities?.includes('embedding') || !manifest.capabilities.includes('local-utility')) continue;
    if (!await verifyAsset(directory, manifest)) continue;
    const indexPath = resolve(dataDir, 'indexes', 'lancedb');
    return {
      embedding: new WorkerLocalEmbedding(directory, manifest, resolve(dataDir, 'cache', 'transformers-worker')),
      store: new WorkerLanceDbStore(indexPath),
      model: {
        modelId: manifest.modelId, modelVersion: manifest.revision, source: 'huggingface-local-explicit',
        license: manifest.license, localPath: relative(dataDir, directory).replaceAll('\\', '/'),
        filesJson: JSON.stringify(manifest.files), tokenizerId: manifest.modelId,
        normalized: manifest.normalized, queryInstruction: manifest.queryInstruction,
        quantization: manifest.quantization, assetHash: manifest.assetHash
      },
      indexPath: relative(dataDir, indexPath).replaceAll('\\', '/'),
      batchSize: 32
    };
  }
  return undefined;
}

async function verifyAsset(directory: string, manifest: AssetManifest): Promise<boolean> {
  if (!Number.isInteger(manifest.dimension) || manifest.dimension < 8 || !/^[a-f0-9]{64}$/u.test(manifest.assetHash)
    || !Array.isArray(manifest.files) || manifest.files.length === 0) return false;
  const aggregate = createHash('sha256');
  for (const file of [...manifest.files].sort((left, right) => left.path.localeCompare(right.path))) {
    const target = resolve(directory, file.path);
    if (relative(directory, target).startsWith('..') || !existsSync(target) || !statSync(target).isFile()) return false;
    const sha256 = await sha256File(target);
    if (sha256 !== file.sha256) return false;
    aggregate.update(file.path.replaceAll('\\', '/'));
    aggregate.update(sha256);
  }
  return aggregate.digest('hex') === manifest.assetHash;
}

function modelDirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => resolve(root, entry.name)).sort((left, right) => left.localeCompare(right));
}
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
function validateTableName(value: string): void { if (!/^[a-z][a-z0-9_]{2,62}$/u.test(value)) throw new Error('VECTOR_TABLE_NAME_INVALID'); }
function escapeFilter(value: string): string { return value.replaceAll("'", "''"); }
