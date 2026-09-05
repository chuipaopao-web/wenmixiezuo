CREATE TABLE IF NOT EXISTS account_users (
  user_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL UNIQUE,
  email_normalized text NOT NULL UNIQUE CHECK (email_normalized = lower(btrim(email_normalized))),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role IN ('user', 'admin')),
  status text NOT NULL CHECK (status IN ('active', 'suspended')),
  email_verified_at timestamptz,
  password_format text NOT NULL CHECK (password_format IN ('scrypt-v2', 'scrypt-v1-legacy')),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_n integer NOT NULL CHECK (password_n > 1),
  password_r integer NOT NULL CHECK (password_r > 0),
  password_p integer NOT NULL CHECK (password_p > 0),
  password_key_length integer NOT NULL CHECK (password_key_length = 64),
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_login_at timestamptz
);

CREATE INDEX IF NOT EXISTS account_users_status_idx
  ON account_users (status, created_at);

CREATE TABLE IF NOT EXISTS account_sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES account_users(user_id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  credential_version integer NOT NULL CHECK (credential_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS account_sessions_user_active_idx
  ON account_sessions (user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS account_one_time_tokens (
  token_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES account_users(user_id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  credential_version integer NOT NULL CHECK (credential_version > 0),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  superseded_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS account_one_time_tokens_user_purpose_idx
  ON account_one_time_tokens (user_id, purpose, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS account_one_time_tokens_one_active_idx
  ON account_one_time_tokens (user_id, purpose)
  WHERE consumed_at IS NULL AND superseded_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS account_rate_limits (
  scope_kind text NOT NULL CHECK (scope_kind IN ('email', 'ip', 'session')),
  scope_hash text NOT NULL CHECK (length(scope_hash) = 64),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  blocked_until timestamptz,
  PRIMARY KEY (scope_kind, scope_hash, action)
);

CREATE INDEX IF NOT EXISTS account_rate_limits_cleanup_idx
  ON account_rate_limits (window_started_at, blocked_until);

CREATE TABLE IF NOT EXISTS account_security_audit_events (
  audit_id uuid PRIMARY KEY,
  user_id uuid REFERENCES account_users(user_id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES account_users(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  result text NOT NULL CHECK (result IN ('succeeded', 'failed', 'rejected')),
  email_normalized text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (detail::text !~* '(password|cookie|token|secret|database_url|authorization)')
);

CREATE INDEX IF NOT EXISTS account_security_audit_user_time_idx
  ON account_security_audit_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS account_security_audit_event_time_idx
  ON account_security_audit_events (event_type, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE ON TABLE account_users TO "wenmi_rebuild_app";
GRANT SELECT, INSERT, UPDATE ON TABLE account_sessions TO "wenmi_rebuild_app";
GRANT SELECT, INSERT, UPDATE ON TABLE account_one_time_tokens TO "wenmi_rebuild_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE account_rate_limits TO "wenmi_rebuild_app";
GRANT SELECT, INSERT ON TABLE account_security_audit_events TO "wenmi_rebuild_app";
