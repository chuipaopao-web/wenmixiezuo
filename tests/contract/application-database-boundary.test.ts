import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CURRENT_SQL_APPLICATION_FILES = new Set([
  'books/book-onboarding-service.ts',
  'books/positioning-service.ts',
  'knowledge/canon-service.ts',
  'projections/narrative-projection-service.ts'
]);

describe('应用层数据库边界', () => {
  it('禁止长篇新增应用服务直接编写SQL', () => {
    const root = resolve(process.cwd(), 'apps/api/src/application');
    const violations = sourceFiles(root)
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => /\.prepare\s*\(|\.exec\s*\(/u.test(source))
      .map(({ path }) => relative(root, path).replaceAll('\\', '/'))
      .filter((path) => !CURRENT_SQL_APPLICATION_FILES.has(path));
    expect(violations).toEqual([]);
  });
});

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
    }
  };
  visit(root);
  return files;
}
