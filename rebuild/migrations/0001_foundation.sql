CREATE TABLE IF NOT EXISTS foundation_probe (
  id text PRIMARY KEY,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation_audit_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_role text NOT NULL,
  action text NOT NULL,
  result text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
