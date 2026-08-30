-- V7 干净切换的窄维护门禁。
-- 不删除不可变触发器；只有一次性清理器在同一写事务内写入一条
-- 绑定“强预览 + 已验证备份 + 双确认”的临时授权，触发器才允许删除。

CREATE TABLE clean_cutover_operations (
  operation_id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL CHECK (length(preview_id) = 64),
  backup_id TEXT NOT NULL REFERENCES backups(backup_id),
  backup_database_hash TEXT NOT NULL CHECK (length(backup_database_hash) = 64),
  first_confirmation_hash TEXT NOT NULL CHECK (length(first_confirmation_hash) = 64),
  second_confirmation_hash TEXT NOT NULL CHECK (length(second_confirmation_hash) = 64),
  file_manifest_json TEXT NOT NULL CHECK (json_valid(file_manifest_json)),
  file_manifest_hash TEXT NOT NULL CHECK (length(file_manifest_hash) = 64),
  file_cleanup_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(file_cleanup_json)),
  status TEXT NOT NULL CHECK (status IN (
    'prepared', 'database_cleared', 'file_cleanup_failed', 'completed'
  )),
  deleted_books INTEGER NOT NULL DEFAULT 0 CHECK (deleted_books >= 0),
  deleted_rows INTEGER NOT NULL DEFAULT 0 CHECK (deleted_rows >= 0),
  removed_existing_paths INTEGER NOT NULL DEFAULT 0 CHECK (removed_existing_paths >= 0),
  already_missing_paths INTEGER NOT NULL DEFAULT 0 CHECK (already_missing_paths >= 0),
  error_message TEXT,
  created_at TEXT NOT NULL,
  database_cleared_at TEXT,
  completed_at TEXT
) STRICT;

CREATE UNIQUE INDEX clean_cutover_operations_preview_idx
  ON clean_cutover_operations(preview_id);

CREATE TABLE clean_cutover_delete_guard (
  guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1),
  operation_id TEXT NOT NULL UNIQUE REFERENCES clean_cutover_operations(operation_id),
  authorization_hash TEXT NOT NULL CHECK (length(authorization_hash) = 64),
  created_at TEXT NOT NULL
) STRICT;

DROP TRIGGER v7_book_genre_profiles_no_delete;
CREATE TRIGGER v7_book_genre_profiles_no_delete
BEFORE DELETE ON v7_book_genre_profiles
WHEN NOT EXISTS (
  SELECT 1 FROM clean_cutover_delete_guard guard
  INNER JOIN clean_cutover_operations operation ON operation.operation_id=guard.operation_id
  INNER JOIN backups backup ON backup.backup_id=operation.backup_id
  WHERE guard.guard_id=1 AND operation.status='prepared' AND backup.status='verified'
)
BEGIN
  SELECT RAISE(ABORT,'V7 genre profile history is immutable');
END;

DROP TRIGGER v7_task_contracts_no_delete;
CREATE TRIGGER v7_task_contracts_no_delete
BEFORE DELETE ON v7_task_contracts
WHEN NOT EXISTS (
  SELECT 1 FROM clean_cutover_delete_guard guard
  INNER JOIN clean_cutover_operations operation ON operation.operation_id=guard.operation_id
  INNER JOIN backups backup ON backup.backup_id=operation.backup_id
  WHERE guard.guard_id=1 AND operation.status='prepared' AND backup.status='verified'
)
BEGIN
  SELECT RAISE(ABORT,'V7 task contract history is immutable');
END;

DROP TRIGGER v7_context_pack_traces_no_delete;
CREATE TRIGGER v7_context_pack_traces_no_delete
BEFORE DELETE ON v7_context_pack_traces
WHEN NOT EXISTS (
  SELECT 1 FROM clean_cutover_delete_guard guard
  INNER JOIN clean_cutover_operations operation ON operation.operation_id=guard.operation_id
  INNER JOIN backups backup ON backup.backup_id=operation.backup_id
  WHERE guard.guard_id=1 AND operation.status='prepared' AND backup.status='verified'
)
BEGIN
  SELECT RAISE(ABORT,'V7 context pack history is immutable');
END;

DROP TRIGGER v7_context_source_traces_no_delete;
CREATE TRIGGER v7_context_source_traces_no_delete
BEFORE DELETE ON v7_context_source_traces
WHEN NOT EXISTS (
  SELECT 1 FROM clean_cutover_delete_guard guard
  INNER JOIN clean_cutover_operations operation ON operation.operation_id=guard.operation_id
  INNER JOIN backups backup ON backup.backup_id=operation.backup_id
  WHERE guard.guard_id=1 AND operation.status='prepared' AND backup.status='verified'
)
BEGIN
  SELECT RAISE(ABORT,'V7 context source trace is immutable');
END;

DROP TRIGGER v7_prompt_manifests_no_delete;
CREATE TRIGGER v7_prompt_manifests_no_delete
BEFORE DELETE ON v7_prompt_manifests
WHEN NOT EXISTS (
  SELECT 1 FROM clean_cutover_delete_guard guard
  INNER JOIN clean_cutover_operations operation ON operation.operation_id=guard.operation_id
  INNER JOIN backups backup ON backup.backup_id=operation.backup_id
  WHERE guard.guard_id=1 AND operation.status='prepared' AND backup.status='verified'
)
BEGIN
  SELECT RAISE(ABORT,'V7 prompt manifest history is immutable');
END;
