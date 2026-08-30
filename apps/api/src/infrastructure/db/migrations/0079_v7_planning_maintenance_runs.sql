CREATE TABLE v7_planning_maintenance_runs (
  maintenance_run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('chapter_settlement','event_settlement','volume_settlement')),
  source_version_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash)=64),
  source_snapshot_json TEXT NOT NULL CHECK (json_valid(source_snapshot_json)),
  confirmed_tree_refs_json TEXT NOT NULL CHECK (json_valid(confirmed_tree_refs_json)),
  assigned_member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  status TEXT NOT NULL CHECK (status IN ('queued','working','succeeded','failed','unknown')),
  request_id TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, source_kind, source_version_id)
) STRICT;

CREATE INDEX v7_planning_maintenance_runs_scope_idx
  ON v7_planning_maintenance_runs(owner_id, book_id, updated_at DESC);
