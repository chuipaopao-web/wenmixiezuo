-- V7 链/卷正式结算可靠任务。对应工单 V7-COMMERCIAL-CREATION-CLOSURE-20260827-39。
-- 只新增独立任务表；不改写既有正文、章节结算或 V6 数据。

CREATE TABLE v7_creation_stage_jobs (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  settlement_kind TEXT NOT NULL CHECK (settlement_kind IN ('chain','volume')),
  scope_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint)=64),
  status TEXT NOT NULL CHECK (status IN ('pending','working','completed','failed','unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  lease_token TEXT,
  lease_expires_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  UNIQUE (owner_id,book_id,settlement_kind,scope_id)
) STRICT;

CREATE INDEX v7_creation_stage_jobs_pending_idx
  ON v7_creation_stage_jobs(status,created_at);
CREATE INDEX v7_creation_stage_jobs_workflow_idx
  ON v7_creation_stage_jobs(owner_id,book_id,workflow_id,updated_at DESC);
