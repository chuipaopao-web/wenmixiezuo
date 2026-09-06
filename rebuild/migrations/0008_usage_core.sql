CREATE TABLE IF NOT EXISTS usage_entitlement_snapshots (
  entitlement_snapshot_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES account_users(owner_id) ON DELETE RESTRICT,
  source_kind text NOT NULL CHECK (source_kind IN ('legacy_migration', 'admin_grant', 'internal_test')),
  source_id text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 160),
  plan_key text NOT NULL CHECK (char_length(plan_key) BETWEEN 1 AND 80),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  compute_quota bigint NOT NULL CHECK (compute_quota > 0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CHECK (period_end > period_start),
  UNIQUE (source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS usage_entitlement_owner_period_idx
  ON usage_entitlement_snapshots (owner_id, period_start, period_end, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_reservations (
  reservation_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES account_users(owner_id) ON DELETE RESTRICT,
  book_id uuid REFERENCES bookshelf_books(book_id) ON DELETE RESTRICT,
  operation_kind text NOT NULL CHECK (operation_kind IN ('prebook_opening', 'book_workflow')),
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 1 AND 160),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  idempotency_input_hash text NOT NULL CHECK (length(idempotency_input_hash) = 64),
  entitlement_snapshot_id uuid NOT NULL REFERENCES usage_entitlement_snapshots(entitlement_snapshot_id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('reserved', 'unknown', 'succeeded', 'released')),
  reserved_tokens bigint NOT NULL CHECK (reserved_tokens > 0),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  provider text CHECK (provider IS NULL OR char_length(provider) BETWEEN 1 AND 80),
  model_id text CHECK (model_id IS NULL OR char_length(model_id) BETWEEN 1 AND 120),
  external_call_id text CHECK (external_call_id IS NULL OR char_length(external_call_id) BETWEEN 1 AND 160),
  release_evidence text CHECK (release_evidence IS NULL OR char_length(release_evidence) BETWEEN 1 AND 500),
  started_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz(3),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'succeeded') = (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK ((state = 'released') = (release_evidence IS NOT NULL AND completed_at IS NOT NULL)),
  UNIQUE (owner_id, operation_kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS usage_reservations_owner_state_idx
  ON usage_reservations (owner_id, state, started_at DESC);

CREATE INDEX IF NOT EXISTS usage_reservations_operation_idx
  ON usage_reservations (owner_id, operation_kind, operation_id);

CREATE UNIQUE INDEX IF NOT EXISTS usage_reservations_owner_external_call_idx
  ON usage_reservations (owner_id, external_call_id)
  WHERE external_call_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS usage_reservation_events (
  reservation_id uuid NOT NULL REFERENCES usage_reservations(reservation_id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  owner_id uuid NOT NULL REFERENCES account_users(owner_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (reservation_id, revision),
  CHECK (payload::text !~* '(password|cookie|secret|database_url|authorization)')
);

CREATE INDEX IF NOT EXISTS usage_reservation_events_owner_time_idx
  ON usage_reservation_events (owner_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION usage_immutable_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'usage entitlement snapshots are immutable';
END;
$$;

DROP TRIGGER IF EXISTS usage_entitlement_snapshots_no_update ON usage_entitlement_snapshots;
CREATE TRIGGER usage_entitlement_snapshots_no_update
BEFORE UPDATE ON usage_entitlement_snapshots
FOR EACH ROW EXECUTE FUNCTION usage_immutable_snapshot_guard();

DROP TRIGGER IF EXISTS usage_entitlement_snapshots_no_delete ON usage_entitlement_snapshots;
CREATE TRIGGER usage_entitlement_snapshots_no_delete
BEFORE DELETE ON usage_entitlement_snapshots
FOR EACH ROW EXECUTE FUNCTION usage_immutable_snapshot_guard();

CREATE OR REPLACE FUNCTION usage_immutable_event_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'usage reservation events are immutable';
END;
$$;

DROP TRIGGER IF EXISTS usage_reservation_events_no_update ON usage_reservation_events;
CREATE TRIGGER usage_reservation_events_no_update
BEFORE UPDATE ON usage_reservation_events
FOR EACH ROW EXECUTE FUNCTION usage_immutable_event_guard();

DROP TRIGGER IF EXISTS usage_reservation_events_no_delete ON usage_reservation_events;
CREATE TRIGGER usage_reservation_events_no_delete
BEFORE DELETE ON usage_reservation_events
FOR EACH ROW EXECUTE FUNCTION usage_immutable_event_guard();

GRANT SELECT, INSERT ON TABLE usage_entitlement_snapshots TO "wenmi_rebuild_app";
GRANT SELECT, INSERT, UPDATE ON TABLE usage_reservations TO "wenmi_rebuild_app";
GRANT SELECT, INSERT ON TABLE usage_reservation_events TO "wenmi_rebuild_app";
