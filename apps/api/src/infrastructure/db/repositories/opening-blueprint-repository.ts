import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface OpeningBlueprintRow {
  opening_blueprint_id: string;
  version: number;
  taxonomy_version: string;
  channel: 'male' | 'female';
  category_key: string;
  category_name: string;
  blueprint_json: string;
  content_hash: string;
  status: 'active' | 'superseded' | 'archived';
  created_at: string;
}

export class OpeningBlueprintRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public active(scope: BookScope): OpeningBlueprintRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT opening_blueprint_id, version, taxonomy_version, channel, category_key,
        category_name, blueprint_json, content_hash, status, created_at
      FROM book_opening_blueprints
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
      ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as OpeningBlueprintRow | undefined;
  }

  public nextVersion(scope: BookScope): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM book_opening_blueprints WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { version: number };
    return row.version;
  }

  public supersedeActive(scope: BookScope, expectedVersion: number): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      UPDATE book_opening_blueprints SET status = 'superseded'
      WHERE owner_id = ? AND book_id = ? AND status = 'active' AND version = ?
    `).run(scope.ownerId, scope.bookId, expectedVersion).changes === 1;
  }

  public insert(scope: BookScope, input: {
    openingBlueprintId: string;
    version: number;
    taxonomyVersion: string;
    channel: 'male' | 'female';
    categoryKey: string;
    categoryName: string;
    blueprintJson: string;
    contentHash: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO book_opening_blueprints (
        opening_blueprint_id, owner_id, book_id, version, taxonomy_version,
        channel, category_key, category_name, blueprint_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      input.openingBlueprintId, scope.ownerId, scope.bookId, input.version,
      input.taxonomyVersion, input.channel, input.categoryKey, input.categoryName,
      input.blueprintJson, input.contentHash, input.now
    );
  }
}
