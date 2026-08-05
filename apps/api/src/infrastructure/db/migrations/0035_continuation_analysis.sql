-- DEC-098: imported manuscripts are analyzed separately from the immutable import.

CREATE TABLE continuation_chapter_analyses (
  analysis_id TEXT PRIMARY KEY,
  continuation_import_id TEXT NOT NULL,
  continuation_import_chapter_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'analyzing', 'ready', 'failed')),
  summary_text TEXT,
  structured_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(structured_json)),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  model_snapshot_id TEXT,
  agent_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (continuation_import_id) REFERENCES continuation_imports(continuation_import_id) ON DELETE CASCADE,
  FOREIGN KEY (continuation_import_chapter_id) REFERENCES continuation_import_chapters(continuation_import_chapter_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  FOREIGN KEY (model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  UNIQUE(owner_id, book_id, continuation_import_id, continuation_import_chapter_id)
) STRICT;

CREATE INDEX continuation_chapter_analyses_scope_idx
  ON continuation_chapter_analyses(owner_id, book_id, continuation_import_id, status);

CREATE TABLE continuation_baselines (
  baseline_id TEXT PRIMARY KEY,
  continuation_import_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'analyzing', 'ready', 'failed')),
  analyzed_chapter_count INTEGER NOT NULL DEFAULT 0 CHECK (analyzed_chapter_count >= 0),
  total_chapter_count INTEGER NOT NULL DEFAULT 0 CHECK (total_chapter_count >= 0),
  summary_text TEXT,
  structured_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(structured_json)),
  active_task_id TEXT,
  canon_revision INTEGER NOT NULL DEFAULT 0 CHECK (canon_revision >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (continuation_import_id) REFERENCES continuation_imports(continuation_import_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (active_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id, book_id, continuation_import_id)
) STRICT;

CREATE INDEX continuation_baselines_scope_idx
  ON continuation_baselines(owner_id, book_id, status, updated_at);
