import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export class RetrievalRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public record(scope: BookScope, input: {
    retrievalId: string; taskId?: string | null; queryText: string; filtersJson: string;
    resultsJson: string; adoptedSourceIdsJson: string; canonRevision: number; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO retrieval_records (
        retrieval_id, owner_id, book_id, task_id, query_text, filters_json,
        results_json, adopted_source_ids_json, canon_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.retrievalId, scope.ownerId, scope.bookId, input.taskId ?? null,
      input.queryText, input.filtersJson, input.resultsJson,
      input.adoptedSourceIdsJson, input.canonRevision, input.now
    );
  }
}
