CREATE TABLE owners (
  owner_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE books (
  book_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'archived', 'restoring', 'purging', 'purged')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  positioning_version INTEGER NOT NULL DEFAULT 0 CHECK (positioning_version >= 0),
  canon_revision INTEGER NOT NULL DEFAULT 0 CHECK (canon_revision >= 0),
  active_editor_agent_id TEXT,
  editor_epoch INTEGER NOT NULL DEFAULT 0 CHECK (editor_epoch >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES owners(owner_id)
) STRICT;

CREATE UNIQUE INDEX books_owner_book_idx ON books(owner_id, book_id);
CREATE INDEX books_owner_status_idx ON books(owner_id, status, updated_at);

CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'working', 'incomplete', 'succeeded', 'failed')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX operations_scope_status_idx ON operations(owner_id, book_id, status);

CREATE TABLE recovery_log (
  recovery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES operations(operation_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE file_registry (
  file_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT,
  version_id TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'quarantined', 'missing')),
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (operation_id) REFERENCES operations(operation_id),
  UNIQUE(owner_id, book_id, version_id)
) STRICT;

CREATE INDEX file_registry_scope_status_idx ON file_registry(owner_id, book_id, status);

CREATE TABLE quarantine_items (
  quarantine_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  intended_book_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('import', 'restore')),
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('pending', 'validated', 'rejected', 'promoted')),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners(owner_id)
) STRICT;

CREATE TABLE backups (
  backup_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('creating', 'complete', 'verified', 'invalid')),
  backup_path TEXT NOT NULL UNIQUE,
  database_hash TEXT,
  manifest_hash TEXT,
  file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  created_at TEXT NOT NULL,
  verified_at TEXT,
  verification_json TEXT CHECK (verification_json IS NULL OR json_valid(verification_json)),
  FOREIGN KEY (release_id) REFERENCES release_runs(release_id)
) STRICT;

CREATE TABLE backup_files (
  backup_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  source_relative_path TEXT NOT NULL,
  backup_relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  PRIMARY KEY (backup_id, file_id),
  FOREIGN KEY (backup_id) REFERENCES backups(backup_id)
) STRICT;

CREATE TABLE deletion_tombstones (
  tombstone_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  deleted_book_id TEXT NOT NULL,
  deleted_book_title TEXT NOT NULL,
  deletion_operation_id TEXT NOT NULL,
  confirmation_text_hash TEXT NOT NULL CHECK (length(confirmation_text_hash) = 64),
  deleted_at TEXT NOT NULL,
  UNIQUE(owner_id, deleted_book_id)
) STRICT;

