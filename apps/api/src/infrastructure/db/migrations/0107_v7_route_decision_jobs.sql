CREATE TABLE v7_route_decision_jobs (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  status TEXT NOT NULL CHECK (status IN ('queued','working','succeeded','failed','unknown','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt>=0),
  lease_token TEXT,
  lease_expires_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (run_id) REFERENCES v7_planning_recipe_runs(run_id),
  UNIQUE(owner_id,book_id,run_id,request_hash)
) STRICT;
CREATE UNIQUE INDEX v7_route_decision_jobs_active_idx ON v7_route_decision_jobs(owner_id,book_id,run_id)
  WHERE status IN ('queued','working','unknown');
CREATE INDEX v7_route_decision_jobs_resume_idx ON v7_route_decision_jobs(status,lease_expires_at);
CREATE UNIQUE INDEX v7_route_decision_jobs_request_key_idx ON v7_route_decision_jobs(owner_id,book_id,run_id,json_extract(input_json,'$.idempotencyKey'));
