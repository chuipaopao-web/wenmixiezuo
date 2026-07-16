import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { FileRegistryRepository } from '../db/repositories/file-registry-repository.js';
import { portableRelative, resolveInside, sha256File } from '../files/file-utils.js';

export interface ConsistencyIssue {
  kind: 'missing' | 'hash_mismatch' | 'orphan';
  relativePath: string;
  fileId?: string;
}

export interface ConsistencyReport {
  scope: BookScope;
  checkedFiles: number;
  issues: ConsistencyIssue[];
  ok: boolean;
}

export class ConsistencyService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string
  ) {}

  public checkBook(scope: BookScope): ConsistencyReport {
    assertBookScope(scope);
    const registered = new FileRegistryRepository(this.database, scope).list();
    const issues: ConsistencyIssue[] = [];
    const knownPaths = new Set(registered.map((file) => file.relativePath));
    for (const file of registered) {
      const path = resolveInside(this.dataDir, file.relativePath);
      if (!existsSync(path)) {
        issues.push({ kind: 'missing', relativePath: file.relativePath, fileId: file.fileId });
      } else if (sha256File(path) !== file.contentHash) {
        issues.push({ kind: 'hash_mismatch', relativePath: file.relativePath, fileId: file.fileId });
      }
    }
    const bookRoot = resolveInside(this.dataDir, `books/${scope.bookId}`);
    if (existsSync(bookRoot)) {
      for (const path of walkFiles(bookRoot)) {
        const relativePath = portableRelative(this.dataDir, path);
        if (!knownPaths.has(relativePath) && !relativePath.endsWith('.tmp')) {
          issues.push({ kind: 'orphan', relativePath });
        }
      }
    }
    return { scope, checkedFiles: registered.length, issues, ok: issues.length === 0 };
  }
}

function walkFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(path));
    else if (entry.isFile() && statSync(path).isFile()) result.push(path);
  }
  return result;
}

