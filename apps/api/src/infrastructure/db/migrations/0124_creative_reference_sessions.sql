-- Public library snapshots only; author content stays in existing scoped task sources.
CREATE TABLE creative_reference_sessions (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  release_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,book_id,session_id)
) STRICT;
CREATE TABLE creative_reference_session_events (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY(owner_id,book_id,session_id,step),
  FOREIGN KEY(owner_id,book_id,session_id) REFERENCES creative_reference_sessions(owner_id,book_id,session_id)
) STRICT;
