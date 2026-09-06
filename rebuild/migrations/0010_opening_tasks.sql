CREATE TABLE opening_tasks (
  task_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES account_users(owner_id),
  command_key text NOT NULL CHECK (length(command_key) BETWEEN 1 AND 160),
  request_hash text NOT NULL,
  request jsonb NOT NULL,
  reservation_id uuid NOT NULL UNIQUE REFERENCES usage_reservations(reservation_id),
  status text NOT NULL CHECK (status IN ('queued','running','reconciling','awaiting_author','failed','cancelled')),
  total_tokens bigint NOT NULL CHECK (total_tokens > 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  attempts integer NOT NULL DEFAULT 0,
  deadline timestamptz NOT NULL,
  retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  worker_id text,
  lease_token integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  active_call_id uuid,
  cancel_requested boolean NOT NULL DEFAULT false,
  checkpoint jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, command_key)
);
CREATE INDEX opening_tasks_queue_idx ON opening_tasks (retry_at, created_at) WHERE status IN ('queued','running');
CREATE TABLE opening_task_calls (
  call_id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES opening_tasks(task_id),
  step text NOT NULL CHECK (length(step) BETWEEN 1 AND 80),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  model_id text NOT NULL CHECK (length(model_id) BETWEEN 1 AND 120),
  token_limit bigint NOT NULL CHECK (token_limit > 0),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT, INSERT, UPDATE ON opening_tasks, opening_task_calls TO "wenmi_rebuild_app";

CREATE FUNCTION protect_opening_task_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'opening_tasks' THEN
    IF ROW(OLD.task_id,OLD.owner_id,OLD.command_key,OLD.request_hash,OLD.request,OLD.reservation_id,OLD.total_tokens,OLD.max_attempts,OLD.deadline)
       IS DISTINCT FROM ROW(NEW.task_id,NEW.owner_id,NEW.command_key,NEW.request_hash,NEW.request,NEW.reservation_id,NEW.total_tokens,NEW.max_attempts,NEW.deadline) THEN
      RAISE EXCEPTION 'opening task input is immutable';
    END IF;
  ELSE
    IF ROW(OLD.call_id,OLD.task_id,OLD.step,OLD.provider,OLD.model_id,OLD.token_limit) IS DISTINCT FROM ROW(NEW.call_id,NEW.task_id,NEW.step,NEW.provider,NEW.model_id,NEW.token_limit)
       OR (OLD.receipt IS NOT NULL AND OLD.receipt IS DISTINCT FROM NEW.receipt) THEN
      RAISE EXCEPTION 'opening call evidence is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER opening_task_evidence BEFORE UPDATE ON opening_tasks FOR EACH ROW EXECUTE FUNCTION protect_opening_task_evidence();
CREATE TRIGGER opening_call_evidence BEFORE UPDATE ON opening_task_calls FOR EACH ROW EXECUTE FUNCTION protect_opening_task_evidence();
