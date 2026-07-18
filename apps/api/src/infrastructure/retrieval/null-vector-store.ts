import type { BookScope } from '../../domain/scope.js';
import type { VectorRecord, VectorSearchResult, VectorStore } from './vector-store.js';

export class NullVectorStore implements VectorStore {
  public readonly available = false;
  public constructor(public readonly degradationReason = 'VECTOR_RUNTIME_UNAVAILABLE') {}
  public async rebuild(_scope: BookScope, _tableName: string, _records: VectorRecord[]): Promise<void> { throw new Error(this.degradationReason); }
  public async search(_scope: BookScope, _tableName: string, _snapshotId: string, _vector: number[], _limit: number): Promise<VectorSearchResult[]> { return []; }
}
