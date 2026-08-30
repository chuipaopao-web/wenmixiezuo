-- design_review_id: DR-V7-SETTING-EDITORIAL-20260825-12
-- V7设定编辑部独立数据域：任务与版本始终同时绑定owner_id和book_id。
CREATE TABLE v7_setting_member_settings (
  member_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE v7_setting_member_events (
  event_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL, batch_id TEXT, item_key TEXT,
  member_key TEXT NOT NULL, event_type TEXT NOT NULL CHECK (event_type IN ('start','complete','leave','handoff','return')),
  handoff_to_member_key TEXT, public_message TEXT NOT NULL, internal_reason TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id), FOREIGN KEY (book_id) REFERENCES books(book_id)
) STRICT;
CREATE INDEX v7_setting_member_events_scope_idx ON v7_setting_member_events(owner_id, book_id, created_at);

CREATE TABLE v7_setting_batches (
  batch_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('queued','working','awaiting_author','completed','partially_failed')),
  selected_items_json TEXT NOT NULL CHECK (json_valid(selected_items_json)), custom_items_json TEXT NOT NULL CHECK (json_valid(custom_items_json)),
  opening_version INTEGER NOT NULL CHECK (opening_version >= 1), opening_hash TEXT NOT NULL CHECK (length(opening_hash) = 64),
  roster_json TEXT NOT NULL CHECK (json_valid(roster_json)), lease_token TEXT, lease_expires_at TEXT, error_message TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id), FOREIGN KEY (book_id) REFERENCES books(book_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;
CREATE INDEX v7_setting_batches_scope_idx ON v7_setting_batches(owner_id, book_id, updated_at);

CREATE TABLE v7_setting_item_jobs (
  job_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL, batch_id TEXT NOT NULL,
  item_key TEXT NOT NULL, item_label TEXT NOT NULL, group_title TEXT NOT NULL, item_prompt TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','working','chief_review','needs_author','confirmed','failed')),
  assigned_member_key TEXT, previous_member_key TEXT, attempted_members_json TEXT NOT NULL CHECK (json_valid(attempted_members_json)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), author_note TEXT NOT NULL DEFAULT '' CHECK (length(author_note) <= 800),
  context_manifest_json TEXT CHECK (context_manifest_json IS NULL OR json_valid(context_manifest_json)), context_hash TEXT,
  active_output_id TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id), FOREIGN KEY (book_id) REFERENCES books(book_id),
  FOREIGN KEY (batch_id) REFERENCES v7_setting_batches(batch_id), UNIQUE (owner_id, book_id, batch_id, item_key)
) STRICT;
CREATE INDEX v7_setting_item_jobs_batch_idx ON v7_setting_item_jobs(owner_id, book_id, batch_id, state);

CREATE TABLE v7_setting_outputs (
  output_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL, batch_id TEXT NOT NULL, item_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deputy_brief','writer_proposal','chief_review','fusion','author_revision')),
  version INTEGER NOT NULL CHECK (version >= 1), member_key TEXT NOT NULL, content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  source_output_ids_json TEXT NOT NULL CHECK (json_valid(source_output_ids_json)), request_id TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id), FOREIGN KEY (book_id) REFERENCES books(book_id),
  FOREIGN KEY (batch_id) REFERENCES v7_setting_batches(batch_id),
  UNIQUE (owner_id, book_id, batch_id, item_key, kind, version), UNIQUE (owner_id, book_id, request_id)
) STRICT;
CREATE INDEX v7_setting_outputs_item_idx ON v7_setting_outputs(owner_id, book_id, item_key, created_at);

CREATE TABLE v7_setting_items (
  owner_id TEXT NOT NULL, book_id TEXT NOT NULL, item_key TEXT NOT NULL, item_label TEXT NOT NULL,
  group_title TEXT NOT NULL, item_prompt TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('candidate','needs_author','confirmed')),
  active_version_id TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0), updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id, item_key), FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id), FOREIGN KEY (book_id) REFERENCES books(book_id)
) STRICT;

CREATE TABLE v7_setting_item_versions (
  version_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL, item_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1), status TEXT NOT NULL CHECK (status IN ('candidate','confirmed')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)), source_output_id TEXT, source_batch_id TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id), FOREIGN KEY (book_id) REFERENCES books(book_id),
  UNIQUE (owner_id, book_id, item_key, revision)
) STRICT;
CREATE INDEX v7_setting_versions_scope_idx ON v7_setting_item_versions(owner_id, book_id, item_key, revision);

CREATE TABLE v7_setting_model_calls (
  request_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL, batch_id TEXT NOT NULL, item_key TEXT NOT NULL,
  node_key TEXT NOT NULL, member_key TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('coding','agent')), state TEXT NOT NULL CHECK (state IN ('working','succeeded','failed','unknown')),
  prompt_hash TEXT NOT NULL CHECK (length(prompt_hash) = 64), reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0), output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cash_micros INTEGER CHECK (cash_micros IS NULL OR cash_micros >= 0), output_text TEXT, failure_message TEXT,
  started_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id), FOREIGN KEY (book_id) REFERENCES books(book_id),
  FOREIGN KEY (batch_id) REFERENCES v7_setting_batches(batch_id)
) STRICT;
CREATE INDEX v7_setting_model_calls_scope_idx ON v7_setting_model_calls(owner_id, book_id, batch_id, state);
