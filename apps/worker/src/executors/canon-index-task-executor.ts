import type { DatabaseSync } from 'node:sqlite';

interface ClaimedCanonIndexRequest {
  requestId: string;
  ownerId: string;
  bookId: string;
  attempts: number;
}

export class CanonIndexTaskExecutor {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly apiBaseUrl: string,
    private readonly workerId: string,
    private readonly workerToken: string
  ) {}

  public async runNext(now = new Date()): Promise<boolean> {
    const request = this.claim(now);
    if (request === null) return false;
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/v1/internal/worker/canon-index/${encodeURIComponent(request.requestId)}/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-wenmi-worker-id': this.workerId,
          'x-wenmi-worker-token': this.workerToken
        },
        body: JSON.stringify({ ownerId: request.ownerId, bookId: request.bookId })
      });
      if (!response.ok) throw new Error(`CANON_INDEX_API_${response.status}`);
      return true;
    } catch (error) {
      const failedAt = now.toISOString();
      const retry = request.attempts < 3;
      const availableAt = new Date(now.getTime() + request.attempts * 5_000).toISOString();
      this.database.prepare(`
        UPDATE canon_index_requests SET status = ?, worker_id = NULL, claimed_at = NULL, error_code = ?,
          available_at = ?, updated_at = ?
        WHERE canon_index_request_id = ? AND owner_id = ? AND book_id = ?
          AND status = 'claimed' AND worker_id = ?
      `).run(retry ? 'pending' : 'failed', errorCode(error), availableAt, failedAt,
        request.requestId, request.ownerId, request.bookId, this.workerId);
      return true;
    }
  }

  private claim(now: Date): ClaimedCanonIndexRequest | null {
    const nowIso = now.toISOString();
    const expiredIso = new Date(now.getTime() - 60_000).toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE canon_index_requests
        SET status = CASE WHEN attempts < 3 THEN 'pending' ELSE 'failed' END,
          worker_id = NULL, claimed_at = NULL, error_code = 'CANON_INDEX_CLAIM_EXPIRED',
          available_at = ?, updated_at = ?
        WHERE status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at < ?
      `).run(nowIso, nowIso, expiredIso);
      const row = this.database.prepare(`
        SELECT canon_index_request_id, owner_id, book_id, attempts
        FROM canon_index_requests
        WHERE status IN ('pending', 'failed') AND attempts < 3 AND available_at <= ?
        ORDER BY created_at, canon_index_request_id LIMIT 1
      `).get(nowIso) as {
        canon_index_request_id: string; owner_id: string; book_id: string; attempts: number;
      } | undefined;
      if (row === undefined) {
        this.database.exec('COMMIT');
        return null;
      }
      const claimed = this.database.prepare(`
        UPDATE canon_index_requests SET status = 'claimed', worker_id = ?, claimed_at = ?,
          attempts = attempts + 1, updated_at = ?
        WHERE canon_index_request_id = ? AND owner_id = ? AND book_id = ?
          AND status IN ('pending', 'failed') AND attempts = ?
      `).run(this.workerId, nowIso, nowIso, row.canon_index_request_id, row.owner_id, row.book_id, row.attempts);
      if (claimed.changes !== 1) {
        this.database.exec('ROLLBACK');
        return null;
      }
      this.database.exec('COMMIT');
      return {
        requestId: row.canon_index_request_id,
        ownerId: row.owner_id,
        bookId: row.book_id,
        attempts: row.attempts + 1
      };
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'CANON_INDEX_UNKNOWN';
  return /^[A-Z][A-Z0-9_:-]{2,120}$/u.test(error.message) ? error.message : error.name.toUpperCase();
}
