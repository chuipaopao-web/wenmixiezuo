CREATE TABLE user_accounts (
  user_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES owners(owner_id)
) STRICT;

CREATE INDEX user_accounts_status_created_idx
  ON user_accounts(status, created_at);

CREATE TABLE auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user_accounts(user_id)
) STRICT;

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions(user_id, revoked_at, expires_at);

CREATE TABLE auth_audit_events (
  audit_id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'register', 'login_success', 'login_failed', 'logout',
    'user_suspended', 'user_reactivated'
  )),
  email_normalized TEXT,
  actor_user_id TEXT,
  recorded_at TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  FOREIGN KEY (user_id) REFERENCES user_accounts(user_id),
  FOREIGN KEY (actor_user_id) REFERENCES user_accounts(user_id)
) STRICT;

CREATE INDEX auth_audit_recorded_idx
  ON auth_audit_events(recorded_at DESC);