import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function findProjectRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, 'RELEASE_ID'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`无法从 ${start} 找到 RELEASE_ID`);
    }
    current = parent;
  }
}

export function readReleaseId(projectRoot: string): string {
  const releaseId = readFileSync(resolve(projectRoot, 'RELEASE_ID'), 'utf8').trim();
  if (!/^wm-v1-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$/.test(releaseId)) {
    throw new Error('RELEASE_ID 格式无效');
  }
  return releaseId;
}

