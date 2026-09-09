import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CURRENT_SQL_APPLICATION_FILES = new Set([
  'books/book-onboarding-service.ts',
  'books/positioning-service.ts',
  // Existing pre-R164 services; new setting impact queries live in repositories.
  'admin/commercial-summary.ts',
  'planning/v7-rhythm-policy-store.ts',
  // Existing at R189; R190 method runtime uses a repository and is not exempt.
  'agents/book-creative-context.ts',
  'books/v7-opening-book-service.ts',
  'planning/v7-book-design-card-service.ts',
  'planning/v7-planning-route-service.ts',
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
