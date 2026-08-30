-- V7作者明确选择后的托管创作任务。默认不启用，不改写历史正文或结算。

CREATE TABLE v7_managed_creation_runs (
  workflow_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('manual','managed')),
  status TEXT NOT NULL CHECK (status IN ('active','paused','completed','failed','unknown','cancelled')),
  writer_member_key TEXT,
  reviewer_member_key TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  lease_token TEXT,
  lease_expires_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id)
) STRICT;

CREATE INDEX v7_managed_creation_pending_idx
  ON v7_managed_creation_runs(mode,status,lease_expires_at,updated_at);
CREATE INDEX v7_managed_creation_book_idx
  ON v7_managed_creation_runs(owner_id,book_id,updated_at DESC);
