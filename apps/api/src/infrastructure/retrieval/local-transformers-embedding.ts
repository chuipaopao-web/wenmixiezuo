import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import type { EmbeddingAdapter } from './embedding-adapter.js';

export interface LocalEmbeddingConfig {
  modelSnapshotId: string;
  modelPath: string;
  expectedAssetHash: string;
  dimension: number;
  cacheDir: string;
}

type FeatureExtractor = (text: string, options: { pooling: 'mean'; normalize: true }) => Promise<{ data: ArrayLike<number> }>;

export class LocalTransformersEmbedding implements EmbeddingAdapter {
  public readonly available: boolean;
  public readonly degradationReason: string | null;
  readonly #assetValid: boolean;
  #extractor: FeatureExtractor | null = null;

  public constructor(private readonly config: LocalEmbeddingConfig) {
    this.#assetValid = existsSync(config.modelPath) && /^[a-f0-9]{64}$/u.test(config.expectedAssetHash)
      && hashDirectory(config.modelPath) === config.expectedAssetHash;
    this.available = this.#assetValid;
    this.degradationReason = this.#assetValid ? null : 'LOCAL_EMBEDDING_ASSET_MISSING_OR_HASH_MISMATCH';
  }

  public get modelSnapshotId(): string { return this.config.modelSnapshotId; }
  public get dimension(): number { return this.config.dimension; }

  public async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!this.available) throw new Error(this.degradationReason!);
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  public async embedQuery(text: string): Promise<number[]> {
    if (!this.available) throw new Error(this.degradationReason!);
    return this.embed(text);
  }

  private async embed(text: string): Promise<number[]> {
    if (this.#extractor === null) {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = resolve(this.config.modelPath, '..');
      env.cacheDir = this.config.cacheDir;
      const createFeaturePipeline = pipeline as unknown as (
        task: 'feature-extraction', model: string, options: { local_files_only: true }
      ) => Promise<FeatureExtractor>;
      this.#extractor = await createFeaturePipeline('feature-extraction', this.config.modelPath, { local_files_only: true });
    }
    const output = await this.#extractor(text, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);
    if (vector.length !== this.dimension) throw new Error('LOCAL_EMBEDDING_DIMENSION_MISMATCH');
    return vector;
  }
}

export function hashDirectory(directory: string): string {
  if (!existsSync(directory)) return '';
  const hash = createHash('sha256');
  for (const path of listFiles(directory)) {
    const relative = path.slice(directory.length).replaceAll('\\', '/');
    hash.update(relative);
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

function listFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) result.push(...listFiles(path));
    else result.push(path);
  }
  return result;
}
