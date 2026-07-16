import type { DatabaseSync } from 'node:sqlite';
import { assertOwnerScope, type OwnerScope } from '../../../domain/scope.js';

export class OwnerRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public ensure(scope: OwnerScope, displayName: string, now: string): void {
    assertOwnerScope(scope);
    this.database.prepare(`
      INSERT INTO owners (owner_id, display_name, version, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        display_name = excluded.display_name,
        version = owners.version + 1,
        updated_at = excluded.updated_at
    `).run(scope.ownerId, displayName, now, now);
  }

  public exists(scope: OwnerScope): boolean {
    assertOwnerScope(scope);
    return this.database.prepare('SELECT 1 FROM owners WHERE owner_id = ?').get(scope.ownerId) !== undefined;
  }
}

