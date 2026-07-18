import { mkdirSync } from 'node:fs';
import { connect, type Connection } from '@lancedb/lancedb';
import type { BookScope } from '../../domain/scope.js';
import { assertBookScope } from '../../domain/scope.js';
import type { VectorRecord, VectorSearchResult, VectorStore } from './vector-store.js';

export class LanceDbVectorStore implements VectorStore {
  public readonly available = true;
  public readonly degradationReason = null;
  #connection: Connection | null = null;

  public constructor(private readonly databasePath: string) { mkdirSync(databasePath, { recursive: true }); }

  public async rebuild(scope: BookScope, tableName: string, records: VectorRecord[]): Promise<void> {
    assertBookScope(scope);
    validateTableName(tableName);
    if (records.length === 0) throw new Error('向量重建不能创建空表');
    const connection = await this.connection();
    await connection.createTable(tableName, records.map((record) => ({
      chunk_id: record.chunkId, owner_id: scope.ownerId, book_id: scope.bookId,
      snapshot_id: record.snapshotId, text: record.text, vector: record.vector
    })), { mode: 'overwrite' });
  }

  public async search(scope: BookScope, tableName: string, snapshotId: string, vector: number[], limit: number): Promise<VectorSearchResult[]> {
    assertBookScope(scope);
    validateTableName(tableName);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('向量返回数量无效');
    const table = await (await this.connection()).openTable(tableName);
    const rows = await table.vectorSearch(vector)
      .where(`owner_id = '${escapeFilter(scope.ownerId)}' AND book_id = '${escapeFilter(scope.bookId)}' AND snapshot_id = '${escapeFilter(snapshotId)}'`)
      .limit(limit).toArray() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ chunkId: String(row.chunk_id), text: String(row.text), distance: Number(row._distance) }));
  }

  private async connection(): Promise<Connection> {
    this.#connection ??= await connect(this.databasePath);
    return this.#connection;
  }
}

function validateTableName(value: string): void {
  if (!/^[a-z][a-z0-9_]{2,62}$/u.test(value)) throw new Error('LanceDB表名无效');
}
function escapeFilter(value: string): string { return value.replaceAll("'", "''"); }
