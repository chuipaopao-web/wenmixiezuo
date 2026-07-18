import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LEGACY_SQL_APPLICATION_FILES = new Set([
  'agents/agent-team-service.ts', 'agents/model-binding-service.ts', 'agents/presence-service.ts',
  'artifacts/artifact-service.ts', 'artifacts/planning-artifact-service.ts',
  'books/adaptation-service.ts', 'books/book-lifecycle-service.ts', 'books/book-onboarding-service.ts', 'books/positioning-service.ts',
  'budget/budget-service.ts', 'calls/model-call-service.ts', 'calls/tool-call-service.ts',
  'chapters/chapter-catalog-service.ts', 'chat/conversation-reply-pipeline-service.ts', 'chat/conversation-service.ts',
  'copyright/copyright-service.ts', 'creation/chapter-batch-service.ts', 'creation/chapter-pipeline-service.ts',
  'creation/chapter-state-recovery-service.ts', 'creation/writer-selection-service.ts', 'creation/writing-readiness-service.ts',
  'discussions/discussion-pipeline-service.ts', 'discussions/discussion-service.ts', 'editors/editor-lease-service.ts',
  'events/event-store.ts', 'imports/quarantine-service.ts', 'knowledge/canon-service.ts', 'knowledge/knowledge-consistency-service.ts',
  'memory/context-pack-service.ts', 'memory/memory-service.ts', 'memory/retrieval-service.ts',
  'projections/narrative-projection-service.ts', 'research/research-service.ts', 'tasks/task-service.ts'
]);

describe('应用层数据库边界', () => {
  it('禁止长篇新增应用服务直接编写SQL', () => {
    const root = resolve(process.cwd(), 'apps/api/src/application');
    const violations = sourceFiles(root)
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => /\.prepare\s*\(|\.exec\s*\(/u.test(source))
      .map(({ path }) => relative(root, path).replaceAll('\\', '/'))
      .filter((path) => !LEGACY_SQL_APPLICATION_FILES.has(path));
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
