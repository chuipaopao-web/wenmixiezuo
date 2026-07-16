import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function resolveInside(root: string, relativePath: string): string {
  const rootPath = resolve(root);
  const target = resolve(rootPath, relativePath);
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) {
    throw new Error(`路径越界：${relativePath}`);
  }
  return target;
}

export function portableRelative(root: string, path: string): string {
  return relative(resolve(root), resolve(path)).split(sep).join('/');
}

export function safeSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/.test(value)) {
    throw new Error(`${label}格式无效`);
  }
  return value;
}

