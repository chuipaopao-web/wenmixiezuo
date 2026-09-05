CREATE TABLE IF NOT EXISTS synthetic_tasks (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  book_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  request_payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN (
    'queued',
    'running',
    'waiting_external_check',
    'completed',
    'failed',
    'canceled'
  )),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  lease_token bigint NOT NULL DEFAULT 0 CHECK (lease_token >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  error_payload jsonb,
  cancellation_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  UNIQUE (owner_id, book_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS synthetic_tasks_claim_idx
  ON synthetic_tasks (status, created_at, id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS synthetic_tasks_scope_idx
  ON synthetic_tasks (owner_id, book_id, id);

CREATE TABLE IF NOT EXISTS synthetic_external_calls (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES synthetic_tasks(id) ON DELETE RESTRICT,
  call_key text NOT NULL,
  lease_token bigint NOT NULL CHECK (lease_token > 0),
  status text NOT NULL CHECK (status IN (
    'inflight',
    'unknown',
    'completed',
    'confirmed_not_started'
  )),
  result_payload jsonb,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (task_id, call_key, lease_token)
);

CREATE INDEX IF NOT EXISTS synthetic_external_calls_task_status_idx
  ON synthetic_external_calls (task_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS synthetic_external_calls_one_unresolved_idx
  ON synthetic_external_calls (task_id)
  WHERE status IN ('inflight', 'unknown');

CREATE TABLE IF NOT EXISTS synthetic_task_events (
  task_id uuid NOT NULL REFERENCES synthetic_tasks(id) ON DELETE RESTRICT,
  owner_id text NOT NULL,
  book_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (task_id, revision)
);

CREATE INDEX IF NOT EXISTS synthetic_task_events_scope_replay_idx
  ON synthetic_task_events (owner_id, book_id, task_id, revision);

GRANT SELECT, INSERT, UPDATE ON TABLE synthetic_tasks TO "wenmi_rebuild_app";
GRANT SELECT, INSERT, UPDATE ON TABLE synthetic_external_calls TO "wenmi_rebuild_app";
GRANT SELECT, INSERT ON TABLE synthetic_task_events TO "wenmi_rebuild_app";
