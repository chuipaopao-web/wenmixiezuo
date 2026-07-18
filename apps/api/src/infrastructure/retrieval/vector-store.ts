import type { BookScope } from '../../domain/scope.js';

export interface VectorRecord {
  chunkId: string;
  snapshotId: string;
  text: string;
  vector: number[];
}

export interface VectorSearchResult { chunkId: string; text: string; distance: number }

export interface VectorStore {
  readonly available: boolean;
  readonly degradationReason: string | null;
  rebuild(scope: BookScope, tableName: string, records: VectorRecord[]): Promise<void>;
  search(scope: BookScope, tableName: string, snapshotId: string, vector: number[], limit: number): Promise<VectorSearchResult[]>;
}
