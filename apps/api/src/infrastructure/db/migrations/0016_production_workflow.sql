CREATE TABLE writing_orders (
  writing_order_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  source_decision_id TEXT NOT NULL,
  chapter_outline_version_id TEXT NOT NULL,
  writing_contract_version_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  hard_constraints_json TEXT NOT NULL CHECK (json_valid(hard_constraints_json)),
  creative_freedom_json TEXT NOT NULL CHECK (json_valid(creative_freedom_json)),
  review_thresholds_json TEXT NOT NULL CHECK (json_valid(review_thresholds_json)),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  positioning_version INTEGER NOT NULL CHECK (positioning_version >= 1),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'superseded', 'cancelled')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (chapter_outline_version_id) REFERENCES artifact_versions(artifact_version_id),
  FOREIGN KEY (writing_contract_version_id) REFERENCES artifact_versions(artifact_version_id),
  UNIQUE(owner_id, book_id, chapter_id, version)
) STRICT;

CREATE TABLE writing_order_sources (
  writing_order_source_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  writing_order_id TEXT NOT NULL,
  source_class TEXT NOT NULL CHECK (source_class IN ('hard', 'focused', 'optional')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  character_count INTEGER NOT NULL CHECK (character_count >= 0),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (writing_order_id) REFERENCES writing_orders(writing_order_id),
  UNIQUE(writing_order_id, source_type, source_id)
) STRICT;

CREATE TABLE chapter_approval_gates (
  chapter_approval_gate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  review_panel_id TEXT NOT NULL,
  confirmation_id TEXT NOT NULL,
  expected_canon_revision INTEGER NOT NULL CHECK (expected_canon_revision >= 0),
  decision_note TEXT,
  status TEXT NOT NULL CHECK (status IN ('awaiting_owner', 'accepted', 'rejected', 'settled', 'settlement_failed', 'superseded')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  FOREIGN KEY (review_panel_id) REFERENCES review_panels(review_panel_id),
  FOREIGN KEY (confirmation_id) REFERENCES confirmations(confirmation_id),
  UNIQUE(owner_id, book_id, chapter_id, manuscript_version_id)
) STRICT;

ALTER TABLE chapter_pipeline_runs ADD COLUMN writing_order_id TEXT REFERENCES writing_orders(writing_order_id);
ALTER TABLE chapter_pipeline_runs ADD COLUMN writer_epoch INTEGER CHECK (writer_epoch IS NULL OR writer_epoch >= 1);
ALTER TABLE chapter_pipeline_runs ADD COLUMN review_panel_id TEXT REFERENCES review_panels(review_panel_id);
ALTER TABLE chapter_pipeline_runs ADD COLUMN confirmation_id TEXT REFERENCES confirmations(confirmation_id);

ALTER TABLE review_panels ADD COLUMN chapter_id TEXT REFERENCES chapters(chapter_id);
ALTER TABLE review_panels ADD COLUMN review_round INTEGER NOT NULL DEFAULT 1 CHECK (review_round BETWEEN 1 AND 3);
ALTER TABLE review_panels ADD COLUMN manuscript_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' CHECK (length(manuscript_hash) = 64);
ALTER TABLE review_panels ADD COLUMN writer_epoch INTEGER NOT NULL DEFAULT 1 CHECK (writer_epoch >= 1);
ALTER TABLE review_panels ADD COLUMN binding_revision_id TEXT;
ALTER TABLE review_panels ADD COLUMN writing_order_id TEXT REFERENCES writing_orders(writing_order_id);
ALTER TABLE review_panels ADD COLUMN canon_revision INTEGER NOT NULL DEFAULT 0 CHECK (canon_revision >= 0);
ALTER TABLE review_panels ADD COLUMN token_budget INTEGER NOT NULL DEFAULT 30000 CHECK (token_budget > 0);

CREATE UNIQUE INDEX review_panel_version_round_idx
  ON review_panels(owner_id, book_id, manuscript_version_id, review_round);
CREATE INDEX writing_orders_scope_idx ON writing_orders(owner_id, book_id, chapter_id, status, version);
CREATE INDEX approval_gates_scope_idx ON chapter_approval_gates(owner_id, book_id, status, created_at);
