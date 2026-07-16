CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE release_runs (
  release_id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  api_version TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE worker_health (
  worker_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  process_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  current_task_id TEXT,
  FOREIGN KEY (release_id) REFERENCES release_runs(release_id)
) STRICT;

CREATE TABLE persistent_events (
  event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT,
  occurred_at TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json))
) STRICT;

CREATE INDEX persistent_events_scope_seq_idx
ON persistent_events(owner_id, book_id, event_seq);

