import type { DatabaseSync } from 'node:sqlite';

export interface OpeningDraftRow {
  owner_id: string;
  payload: string;
  updated_at: string;
}

export class OpeningDraftRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public get(ownerId: string): OpeningDraftRow | undefined {
    return this.database.prepare(`
      SELECT owner_id, payload, updated_at FROM opening_drafts WHERE owner_id = ?
    `).get(ownerId) as OpeningDraftRow | undefined;
  }

  public upsert(ownerId: string, payload: string, now: string): void {
    this.database.prepare(`
      INSERT INTO opening_drafts (owner_id, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(ownerId, payload, now);
  }

  public clear(ownerId: string): void {
    this.database.prepare(`DELETE FROM opening_drafts WHERE owner_id = ?`).run(ownerId);
  }
}
