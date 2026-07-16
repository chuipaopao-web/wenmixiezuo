import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface FileRecord {
  fileId: string;
  ownerId: string;
  bookId: string;
  chapterId: string | null;
  versionId: string;
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
  status: 'active' | 'archived' | 'quarantined' | 'missing';
  operationId: string;
}

interface FileRow {
  file_id: string;
  owner_id: string;
  book_id: string;
  chapter_id: string | null;
  version_id: string;
  relative_path: string;
  content_hash: string;
  size_bytes: number;
  status: FileRecord['status'];
  operation_id: string;
}

function mapFile(row: FileRow): FileRecord {
  return {
    fileId: row.file_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    versionId: row.version_id,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    status: row.status,
    operationId: row.operation_id
  };
}

export class FileRegistryRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly scope: BookScope
  ) {
    assertBookScope(scope);
  }

  public list(): FileRecord[] {
    const rows = this.database.prepare(`
      SELECT file_id, owner_id, book_id, chapter_id, version_id, relative_path,
             content_hash, size_bytes, status, operation_id
      FROM file_registry WHERE owner_id = ? AND book_id = ? ORDER BY created_at, file_id
    `).all(this.scope.ownerId, this.scope.bookId) as unknown as FileRow[];
    return rows.map(mapFile);
  }

  public findByVersion(versionId: string): FileRecord | null {
    const row = this.database.prepare(`
      SELECT file_id, owner_id, book_id, chapter_id, version_id, relative_path,
             content_hash, size_bytes, status, operation_id
      FROM file_registry WHERE owner_id = ? AND book_id = ? AND version_id = ?
    `).get(this.scope.ownerId, this.scope.bookId, versionId) as FileRow | undefined;
    return row === undefined ? null : mapFile(row);
  }
}

