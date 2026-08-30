-- V7 商业创作闭环加法迁移。对应工单 V7-COMMERCIAL-CREATION-CLOSURE-20260827-39。
-- 不修改 V6；不覆盖既有定稿正文、结算或规划树。

CREATE TABLE v7_manuscript_finalize_receipts (
  receipt_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES v7_manuscript_versions(manuscript_version_id),
  UNIQUE (owner_id,book_id,idempotency_key),
  UNIQUE (owner_id,book_id,manuscript_version_id)
) STRICT;
CREATE INDEX v7_finalize_receipts_workflow_idx
  ON v7_manuscript_finalize_receipts(owner_id,book_id,workflow_id,created_at);

CREATE TABLE v7_creation_member_preferences (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK (role_key IN (
    'context_editor','chief_editor','structure_writer','commercial_writer','character_writer',
    'outline_writer','lead_writer','independent_reviewer','settlement_editor'
  )),
  member_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id,book_id,workflow_id,role_key),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id)
) STRICT;

CREATE TABLE v7_creation_task_controls (
  control_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('cancel','handoff','resume')),
  role_key TEXT,
  from_member_key TEXT,
  to_member_key TEXT,
  public_reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  UNIQUE (owner_id,book_id,idempotency_key)
) STRICT;
CREATE INDEX v7_creation_task_controls_workflow_idx
  ON v7_creation_task_controls(owner_id,book_id,workflow_id,created_at DESC);

CREATE TABLE v7_creation_stage_settlements (
  stage_settlement_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  settlement_kind TEXT NOT NULL CHECK (settlement_kind IN ('chain','volume')),
  scope_id TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  member_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  UNIQUE (owner_id,book_id,settlement_kind,scope_id)
) STRICT;
