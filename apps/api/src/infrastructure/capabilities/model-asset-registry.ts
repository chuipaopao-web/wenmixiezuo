import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

interface AssetManifest {
  assetId: string;
  kind: 'embedding' | 'reranker' | 'local-utility';
  modelId: string;
  revision: string;
  license: string;
  capabilities: string[];
  files: Array<{ path: string; sha256: string }>;
}

export interface ModelAssetStatus {
  assetId: string;
  kind: AssetManifest['kind'] | 'unknown';
  modelId: string;
  revision: string;
  license: string;
  capabilities: string[];
  status: 'verified' | 'missing' | 'invalid';
  filesVerified: number;
  problem?: 'manifest_invalid' | 'file_missing' | 'hash_mismatch' | 'path_rejected';
}

export class ModelAssetRegistry {
  readonly #root: string;

  public constructor(dataDirectory: string) {
    this.#root = resolve(dataDirectory, 'cache', 'models');
  }

  public async inspect(): Promise<ModelAssetStatus[]> {
    if (!existsSync(this.#root)) return [];
    const manifests = findManifestFiles(this.#root);
    const results: ModelAssetStatus[] = [];
    for (const manifestPath of manifests) results.push(await this.inspectManifest(manifestPath));
    return results.sort((left, right) => left.assetId.localeCompare(right.assetId));
  }

  private async inspectManifest(manifestPath: string): Promise<ModelAssetStatus> {
    let manifest: AssetManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetManifest;
      if (!isManifest(manifest)) throw new Error('invalid manifest');
    } catch {
      return { assetId: `invalid-${shortHash(relative(this.#root, manifestPath))}`, kind: 'unknown', modelId: '', revision: '', license: '', capabilities: [], status: 'invalid', filesVerified: 0, problem: 'manifest_invalid' };
    }

    const base = resolve(manifestPath, '..');
    let filesVerified = 0;
    for (const file of manifest.files) {
      if (isAbsolute(file.path)) return result(manifest, 'invalid', filesVerified, 'path_rejected');
      const target = resolve(base, file.path);
      const pathFromBase = relative(base, target);
      if (pathFromBase === '..' || pathFromBase.startsWith(`..\\`) || pathFromBase.startsWith('../')) {
        return result(manifest, 'invalid', filesVerified, 'path_rejected');
      }
      if (!existsSync(target) || !statSync(target).isFile()) return result(manifest, 'missing', filesVerified, 'file_missing');
      if (await sha256File(target) !== file.sha256.toLowerCase()) return result(manifest, 'invalid', filesVerified, 'hash_mismatch');
      filesVerified += 1;
    }
    return result(manifest, 'verified', filesVerified);
  }
}

function result(manifest: AssetManifest, status: ModelAssetStatus['status'], filesVerified: number, problem?: ModelAssetStatus['problem']): ModelAssetStatus {
  const value: ModelAssetStatus = {
    assetId: manifest.assetId,
    kind: manifest.kind,
    modelId: manifest.modelId,
    revision: manifest.revision,
    license: manifest.license,
    capabilities: [...manifest.capabilities],
    status,
    filesVerified
  };
  if (problem !== undefined) value.problem = problem;
  return value;
}

function isManifest(value: AssetManifest): boolean {
  return typeof value.assetId === 'string' && value.assetId.length > 0
    && ['embedding', 'reranker', 'local-utility'].includes(value.kind)
    && typeof value.modelId === 'string' && typeof value.revision === 'string' && typeof value.license === 'string'
    && Array.isArray(value.capabilities) && value.capabilities.every((item) => typeof item === 'string')
    && Array.isArray(value.files) && value.files.length > 0
    && value.files.every((file) => typeof file.path === 'string' && /^[a-f0-9]{64}$/u.test(file.sha256));
}

function findManifestFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name === 'asset.json') found.push(target);
    }
  };
  visit(root);
  return found;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
