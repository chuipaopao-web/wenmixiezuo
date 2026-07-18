import { createRequire } from 'node:module';
import { cpus, freemem, totalmem } from 'node:os';
import { statfsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export interface RuntimeCapabilitySnapshot {
  runtime: {
    platform: NodeJS.Platform;
    architecture: string;
    nodeVersion: string;
    logicalCpuCount: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    dataVolumeFreeBytes: number;
  };
  sqlite: {
    version: string;
    foreignKeys: boolean;
    trustedSchema: boolean;
    json: boolean;
    fts5: boolean;
  };
  dependencies: Array<{
    capability: 'vector-store' | 'embedding-runtime' | 'local-inference';
    packageName: string;
    status: 'available' | 'missing';
  }>;
}

const OPTIONAL_DEPENDENCIES: RuntimeCapabilitySnapshot['dependencies'] = [
  { capability: 'vector-store', packageName: '@lancedb/lancedb', status: 'missing' },
  { capability: 'embedding-runtime', packageName: '@huggingface/transformers', status: 'missing' },
  { capability: 'local-inference', packageName: 'onnxruntime-node', status: 'missing' }
];

export class RuntimeCapabilityProbe {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDirectory: string
  ) {}

  public snapshot(): RuntimeCapabilitySnapshot {
    const volume = statfsSync(this.dataDirectory);
    const sqliteVersion = this.database.prepare('SELECT sqlite_version() AS version').get() as { version: string };
    const foreignKeys = firstPragmaValue(this.database.prepare('PRAGMA foreign_keys').get()) === 1;
    const trustedSchema = firstPragmaValue(this.database.prepare('PRAGMA trusted_schema').get()) === 1;
    const json = (this.database.prepare(`SELECT json_valid('{}') AS available`).get() as { available: number }).available === 1;
    let fts5 = false;
    try {
      this.database.exec('CREATE VIRTUAL TABLE temp.__wenmi_fts5_probe USING fts5(content)');
      fts5 = true;
    } catch {
      fts5 = false;
    } finally {
      try { this.database.exec('DROP TABLE IF EXISTS temp.__wenmi_fts5_probe'); } catch { /* probe cleanup is best-effort */ }
    }

    const require = createRequire(import.meta.url);
    const dependencies = OPTIONAL_DEPENDENCIES.map((dependency) => {
      try {
        require.resolve(dependency.packageName);
        return { ...dependency, status: 'available' as const };
      } catch {
        return { ...dependency, status: 'missing' as const };
      }
    });

    return {
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        freeMemoryBytes: freemem(),
        dataVolumeFreeBytes: Number(volume.bavail) * Number(volume.bsize)
      },
      sqlite: { version: sqliteVersion.version, foreignKeys, trustedSchema, json, fts5 },
      dependencies
    };
  }
}

function firstPragmaValue(row: unknown): number | undefined {
  if (row === null || typeof row !== 'object') return undefined;
  const value = Object.values(row)[0];
  return typeof value === 'number' ? value : undefined;
}
