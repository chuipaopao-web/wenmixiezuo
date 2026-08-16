import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { DomainError, errorCodes } from '../domain/errors.js';
import { findProjectRoot, readReleaseId } from './project-root.js';
import { loadModelRuntimeConfig, type ModelRuntimeConfig } from './models/model-runtime-config.js';

export interface RuntimeConfig {
  apiHost: string;
  apiPort: number;
  dataDir: string;
  databasePath: string;
  projectRoot: string;
  releaseId: string;
  ownerId: string;
  webOrigin: string;
  workerToken: string;
  promptViewPassword: string | null;
  modelRuntime: ModelRuntimeConfig;
  /** 公网部署时的外部域名，如 https://wenmixiezuo.com。仅用于安全校验和 Cookie 域。 */
  publicOrigin: string | null;
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
  const publicOrigin = env.WENMI_PUBLIC_ORIGIN?.trim() || null;
  if (publicOrigin !== null) {
    let parsed: URL;
    try { parsed = new URL(publicOrigin); } catch {
      throw new DomainError(errorCodes.validation, 'WENMI_PUBLIC_ORIGIN 必须是完整的 URL（如 https://wenmixiezuo.com）');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new DomainError(errorCodes.validation, 'WENMI_PUBLIC_ORIGIN 必须是 http/https 协议的 URL');
    }
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
    workerToken: env.WENMI_WORKER_TOKEN?.trim() || randomBytes(32).toString('base64url'),
    promptViewPassword: env.WENMI_PROMPT_VIEW_PASSWORD?.trim() || null,
    publicOrigin,
    modelRuntime: loadModelRuntimeConfig(env, { codexWorkingDirectory: resolve(dataDir, 'cache', 'codex-runtime') })
  };
}
