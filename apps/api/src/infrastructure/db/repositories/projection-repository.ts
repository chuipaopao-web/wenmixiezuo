import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export class ProjectionRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public clearLegacyDerived(scope: BookScope): void {
    assertBookScope(scope);
    this.database.prepare('DELETE FROM character_state_projection WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
    this.database.prepare('DELETE FROM timeline_projection WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
    this.database.prepare('DELETE FROM relationship_projection WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
  }
}
