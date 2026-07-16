import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function findProjectRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (!existsSync(resolve(current, 'RELEASE_ID'))) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error('无法找到文脉写作项目根目录');
    }
    current = parent;
  }
  return current;
}

export interface WorkerConfig {
  databasePath: string;
  releaseId: string;
  workerId: string;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const projectRoot = findProjectRoot(env.WENMAI_PROJECT_ROOT ?? process.cwd());
  const dataDir = resolve(env.WENMAI_DATA_DIR ?? resolve(projectRoot, 'data'));
  mkdirSync(resolve(dataDir, 'database'), { recursive: true });
  return {
    databasePath: resolve(dataDir, 'database', 'wenmai.sqlite'),
    releaseId: readFileSync(resolve(projectRoot, 'RELEASE_ID'), 'utf8').trim(),
    workerId: env.WENMAI_WORKER_ID ?? 'local-worker-1'
  };
}

