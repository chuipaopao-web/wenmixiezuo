ALTER TABLE tasks ADD COLUMN lease_token TEXT;
ALTER TABLE tasks ADD COLUMN current_attempt_no INTEGER NOT NULL DEFAULT 0 CHECK (current_attempt_no >= 0);

CREATE TABLE task_attempts (
  task_attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  worker_id TEXT NOT NULL,
  lease_token TEXT NOT NULL UNIQUE,
  required_editor_epoch INTEGER NOT NULL CHECK (required_editor_epoch >= 0),
  status TEXT NOT NULL CHECK (status IN ('working', 'succeeded', 'paused', 'waiting_confirmation', 'blocked', 'interrupted', 'failed', 'cancelled', 'expired')),
  lease_expires_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(task_id, attempt_no)
) STRICT;

CREATE INDEX task_attempts_active_idx ON task_attempts(status, lease_expires_at, task_id);
CREATE INDEX task_attempts_scope_idx ON task_attempts(owner_id, book_id, task_id, attempt_no);

CREATE TABLE model_call_results (
  model_call_result_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  output_text TEXT NOT NULL,
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  provider_request_id TEXT,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  cash_micros INTEGER NOT NULL CHECK (cash_micros >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES model_calls(request_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE model_call_reconciliations (
  request_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('awaiting_provider', 'reusable', 'retry_safe', 'discarded')),
  reason_code TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (request_id) REFERENCES model_calls(request_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX model_call_reconciliation_state_idx ON model_call_reconciliations(state, created_at);
