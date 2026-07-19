-- Stage 7: auditable portable book packages and local operations records.

CREATE TABLE portable_operations (
  portable_operation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('export', 'copy_import', 'restore_preview', 'restore_apply')),
  status TEXT NOT NULL CHECK (status IN ('preparing', 'validated', 'completed', 'rejected', 'failed')),
  package_name TEXT,
  source_book_id TEXT,
  target_book_id TEXT,
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES owners(owner_id)
) STRICT;

CREATE TABLE portable_manifests (
  portable_manifest_id TEXT PRIMARY KEY,
  portable_operation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT,
  format_version INTEGER NOT NULL CHECK (format_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64),
  table_count INTEGER NOT NULL CHECK (table_count >= 0),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (portable_operation_id) REFERENCES portable_operations(portable_operation_id),
  FOREIGN KEY (owner_id) REFERENCES owners(owner_id)
) STRICT;

CREATE TABLE portable_files (
  portable_file_id TEXT PRIMARY KEY,
  portable_manifest_id TEXT NOT NULL,
  source_file_id TEXT,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  media_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (portable_manifest_id) REFERENCES portable_manifests(portable_manifest_id)
) STRICT;

CREATE TABLE import_quarantine_checks (
  import_quarantine_check_id TEXT PRIMARY KEY,
  portable_operation_id TEXT NOT NULL,
  check_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'warning')),
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (portable_operation_id) REFERENCES portable_operations(portable_operation_id)
) STRICT;

CREATE TABLE restore_impact_reports (
  restore_impact_report_id TEXT PRIMARY KEY,
  portable_operation_id TEXT NOT NULL,
  target_book_id TEXT,
  current_schema_version INTEGER NOT NULL,
  package_schema_version INTEGER NOT NULL,
  affected_json TEXT NOT NULL CHECK (json_valid(affected_json)),
  confirmation_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('preview', 'confirmed', 'applied', 'rejected')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (portable_operation_id) REFERENCES portable_operations(portable_operation_id)
) STRICT;

CREATE INDEX portable_operation_book_idx ON portable_operations(owner_id, book_id, created_at);
CREATE INDEX portable_manifest_operation_idx ON portable_manifests(portable_operation_id);
CREATE INDEX import_check_operation_idx ON import_quarantine_checks(portable_operation_id, status);
