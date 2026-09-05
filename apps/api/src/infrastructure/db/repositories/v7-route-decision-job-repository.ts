import type { DatabaseSync } from 'node:sqlite';

export interface RouteDecisionInput {
  mode: 'adjust' | 'merge'; routeIds: string[]; authorNote: string; idempotencyKey: string;
}
export interface RouteDecisionJob {
  job_id: string; owner_id: string; book_id: string; run_id: string; request_hash: string;
  input_json: string; status: 'queued' | 'working' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  attempt: number; lease_token: string | null; lease_expires_at: string | null;
  error_message: string | null; created_at: string; updated_at: string;
}

export class V7RouteDecisionJobRepository {
  public constructor(private readonly database: DatabaseSync) {}
  public latest(ownerId: string, bookId: string, runId: string): RouteDecisionJob | undefined {
    return this.database.prepare(`SELECT * FROM v7_route_decision_jobs WHERE owner_id=? AND book_id=? AND run_id=?
      ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(ownerId, bookId, runId) as RouteDecisionJob | undefined;
  }
  public get(ownerId: string, bookId: string, jobId: string): RouteDecisionJob | undefined {
    return this.database.prepare('SELECT * FROM v7_route_decision_jobs WHERE owner_id=? AND book_id=? AND job_id=?')
      .get(ownerId, bookId, jobId) as RouteDecisionJob | undefined;
  }
  public enqueue(jobId: string, ownerId: string, bookId: string, runId: string, hash: string, input: RouteDecisionInput, now: string): RouteDecisionJob {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const active = this.database.prepare(`SELECT * FROM v7_route_decision_jobs WHERE owner_id=? AND book_id=? AND run_id=?
        AND (request_hash=? OR json_extract(input_json,'$.idempotencyKey')=? OR status IN ('queued','working','unknown')) ORDER BY rowid DESC LIMIT 1`)
        .get(ownerId, bookId, runId, hash, input.idempotencyKey) as RouteDecisionJob | undefined;
      if (active !== undefined) { this.database.exec('COMMIT'); return active; }
      this.database.prepare(`INSERT INTO v7_route_decision_jobs
        (job_id,owner_id,book_id,run_id,request_hash,input_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'queued',?,?)`).run(jobId, ownerId, bookId, runId, hash, JSON.stringify(input), now, now);
      this.database.exec('COMMIT');
      return this.get(ownerId, bookId, jobId)!;
    } catch (error) { if (this.database.isTransaction) this.database.exec('ROLLBACK'); throw error; }
  }
  public resumable(now: string): RouteDecisionJob[] {
    return this.database.prepare(`SELECT * FROM v7_route_decision_jobs WHERE status IN ('queued','working')
      AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY created_at LIMIT 20`).all(now) as unknown as RouteDecisionJob[];
  }
  public claim(job: RouteDecisionJob, token: string, now: string, until: string): boolean {
    return this.database.prepare(`UPDATE v7_route_decision_jobs SET status='working',lease_token=?,lease_expires_at=?,updated_at=?
      WHERE job_id=? AND owner_id=? AND book_id=? AND status IN ('queued','working')
      AND (lease_expires_at IS NULL OR lease_expires_at<=?)`).run(token, until, now, job.job_id, job.owner_id, job.book_id, now).changes === 1;
  }
  public renew(job: RouteDecisionJob, token: string, until: string): boolean {
    return this.database.prepare(`UPDATE v7_route_decision_jobs SET lease_expires_at=? WHERE job_id=? AND owner_id=? AND book_id=?
      AND status='working' AND lease_token=?`).run(until, job.job_id, job.owner_id, job.book_id, token).changes === 1;
  }
  public finish(job: RouteDecisionJob, token: string, status: RouteDecisionJob['status'], error: string | null, now: string): void {
    this.database.prepare(`UPDATE v7_route_decision_jobs SET status=?,error_message=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE job_id=? AND owner_id=? AND book_id=? AND status='working' AND lease_token=?`)
      .run(status, error, now, job.job_id, job.owner_id, job.book_id, token);
  }
  public retry(job: RouteDecisionJob, now: string): void {
    this.database.prepare(`UPDATE v7_route_decision_jobs SET status='queued',attempt=attempt+1,error_message=NULL,
      lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND book_id=? AND status IN ('failed','cancelled')`)
      .run(now, job.job_id, job.owner_id, job.book_id);
  }
  public cancel(job: RouteDecisionJob, now: string): void {
    this.database.prepare(`UPDATE v7_route_decision_jobs SET status='cancelled',lease_token=NULL,lease_expires_at=NULL,
      error_message='这次调整已停止，原路线和您的意见都已保留。',updated_at=?
      WHERE job_id=? AND owner_id=? AND book_id=? AND status IN ('queued','working','failed')`)
      .run(now, job.job_id, job.owner_id, job.book_id);
  }
}
