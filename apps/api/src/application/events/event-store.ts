import { EventEmitter } from 'node:events';
import type { DatabaseSync } from 'node:sqlite';
import type { EventEnvelope } from '../../contracts/api.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertOwnerScope, type BookScope, type OwnerScope } from '../../domain/scope.js';

interface EventRow {
  event_seq: number;
  event_id: string;
  event_type: string;
  owner_id: string;
  book_id: string | null;
  occurred_at: string;
  data_json: string;
}

export class EventStore {
  readonly #emitter = new EventEmitter();

  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public append(scope: OwnerScope & { bookId?: string | null }, eventType: string, data: Record<string, unknown>): EventEnvelope {
    assertOwnerScope(scope);
    const eventId = this.ids.next();
    const occurredAt = this.clock.now().toISOString();
    const result = this.database.prepare(`
      INSERT INTO persistent_events (event_id, event_type, owner_id, book_id, occurred_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(eventId, eventType, scope.ownerId, scope.bookId ?? null, occurredAt, JSON.stringify(data));
    const event: EventEnvelope = {
      eventSeq: Number(result.lastInsertRowid),
      eventId,
      eventType,
      ownerId: scope.ownerId,
      bookId: scope.bookId ?? null,
      occurredAt,
      data
    };
    this.#emitter.emit(this.channel(scope.ownerId, scope.bookId ?? null), event);
    return event;
  }

  public replay(scope: OwnerScope & { bookId?: string | null }, after: number, limit = 1_000): EventEnvelope[] {
    assertOwnerScope(scope);
    const rows = this.database.prepare(`
      SELECT event_seq, event_id, event_type, owner_id, book_id, occurred_at, data_json
      FROM persistent_events
      WHERE owner_id = ? AND event_seq > ? AND (? IS NULL OR book_id = ?)
      ORDER BY event_seq LIMIT ?
    `).all(scope.ownerId, after, scope.bookId ?? null, scope.bookId ?? null, limit) as unknown as EventRow[];
    return rows.map(mapEvent);
  }

  public subscribe(scope: BookScope, listener: (event: EventEnvelope) => void): () => void {
    const channel = this.channel(scope.ownerId, scope.bookId);
    this.#emitter.on(channel, listener);
    return () => this.#emitter.off(channel, listener);
  }

  public compact(): number {
    const sevenDaysAgo = new Date(this.clock.now().getTime() - 7 * 24 * 60 * 60 * 1_000).toISOString();
    const maxRow = this.database.prepare('SELECT COALESCE(MAX(event_seq), 0) AS max_seq FROM persistent_events').get() as { max_seq: number };
    const keepAfterSeq = Math.max(0, maxRow.max_seq - 10_000);
    const result = this.database.prepare('DELETE FROM persistent_events WHERE occurred_at < ? AND event_seq < ?')
      .run(sevenDaysAgo, keepAfterSeq);
    return Number(result.changes);
  }

  private channel(ownerId: string, bookId: string | null): string {
    return `${ownerId}:${bookId ?? '*'}`;
  }
}

function mapEvent(row: EventRow): EventEnvelope {
  return {
    eventSeq: row.event_seq,
    eventId: row.event_id,
    eventType: row.event_type,
    ownerId: row.owner_id,
    bookId: row.book_id,
    occurredAt: row.occurred_at,
    data: JSON.parse(row.data_json) as Record<string, unknown>
  };
}

