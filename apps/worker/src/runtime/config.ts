import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function findProjectRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (!existsSync(resolve(current, 'RELEASE_ID'))) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error('无法找到文秘写作项目根目录');
    }
    current = parent;
  }
  return current;
}

export interface WorkerConfig {
  dataDir: string;
  databasePath: string;
  releaseId: string;
  workerId: string;
  apiBaseUrl: string;
  workerToken: string;
  /** 同时执行的 AI 任务数上限（默认8，1-32，WENMI_WORKER_MAX_CONCURRENCY 可调），配合"同一本书只跑一个任务"实现全用户跨书并行。 */
  maxConcurrency?: number;
}

function parseConcurrency(raw: string | undefined): number {
  const value = raw === undefined ? 8 : Number(raw);
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 32)) : 8;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const projectRoot = findProjectRoot(env.WENMI_PROJECT_ROOT ?? process.cwd());
  const dataDir = resolve(env.WENMI_DATA_DIR ?? resolve(projectRoot, 'data'));
  mkdirSync(resolve(dataDir, 'database'), { recursive: true });
  return {
    dataDir,
    databasePath: resolve(dataDir, 'database', 'wenmi.sqlite'),
    releaseId: readFileSync(resolve(projectRoot, 'RELEASE_ID'), 'utf8').trim(),
    workerId: env.WENMI_WORKER_ID ?? 'local-worker-1',
    apiBaseUrl: env.WENMI_API_BASE_URL ?? 'http://127.0.0.1:43111',
    workerToken: env.WENMI_WORKER_TOKEN ?? '',
    maxConcurrency: parseConcurrency(env.WENMI_WORKER_MAX_CONCURRENCY)
  };
}
