import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DomainError, errorCodes } from '../domain/errors.js';
import { findProjectRoot, readReleaseId } from './project-root.js';
import { loadModelRuntimeConfig, type ModelRuntimeConfig } from './models/model-runtime-config.js';

export interface RuntimeConfig {
  apiHost: '127.0.0.1';
  apiPort: number;
  dataDir: string;
  databasePath: string;
  projectRoot: string;
  releaseId: string;
  ownerId: string;
  webOrigin: string;
  modelRuntime: ModelRuntimeConfig;
}

function parsePort(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new DomainError(errorCodes.validation, '端口必须是1024至65535之间的整数');
  }
  return value;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const projectRoot = findProjectRoot(env.WENMI_PROJECT_ROOT ?? process.cwd());
  const apiHost = env.WENMI_API_HOST ?? '127.0.0.1';
  if (apiHost !== '127.0.0.1') {
    throw new DomainError(errorCodes.validation, '首版API只允许监听127.0.0.1');
  }
  const dataDir = resolve(env.WENMI_DATA_DIR ?? resolve(projectRoot, 'data'));
  const databaseDir = resolve(dataDir, 'database');
  mkdirSync(databaseDir, { recursive: true });
  for (const directory of ['books', 'staging', 'archives', 'imports', 'exports', 'backups', 'quarantine', 'logs', 'cache', 'indexes', 'control']) {
    mkdirSync(resolve(dataDir, directory), { recursive: true });
  }
  return {
    apiHost,
    apiPort: parsePort(env.WENMI_API_PORT, 43111),
    dataDir,
    databasePath: resolve(databaseDir, 'wenmi.sqlite'),
    projectRoot,
    releaseId: readReleaseId(projectRoot),
    ownerId: env.WENMI_OWNER_ID ?? 'owner-local-boss',
    webOrigin: env.WENMI_WEB_ORIGIN ?? 'http://127.0.0.1:43110',
    modelRuntime: loadModelRuntimeConfig(env, { codexWorkingDirectory: resolve(dataDir, 'cache', 'codex-runtime') })
  };
}
