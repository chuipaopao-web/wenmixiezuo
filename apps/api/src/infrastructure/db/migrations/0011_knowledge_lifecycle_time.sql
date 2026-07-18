CREATE TABLE temporal_scopes (
  temporal_scope_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  world_time_start TEXT,
  world_time_end TEXT,
  knowledge_subject_type TEXT,
  knowledge_subject_id TEXT,
  knowledge_time_start TEXT,
  knowledge_time_end TEXT,
  recorded_at TEXT NOT NULL,
  superseded_at TEXT,
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  narrative_chapter_start INTEGER CHECK (narrative_chapter_start IS NULL OR narrative_chapter_start >= 1),
  narrative_chapter_end INTEGER CHECK (narrative_chapter_end IS NULL OR narrative_chapter_end >= 1),
  calendar_key TEXT,
  temporal_completeness TEXT NOT NULL CHECK (temporal_completeness IN ('complete', 'partial', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, temporal_scope_id)
) STRICT;

CREATE INDEX temporal_scopes_query_idx
ON temporal_scopes(owner_id, book_id, canon_revision, knowledge_subject_id, status);

CREATE TABLE knowledge_items (
  knowledge_item_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  knowledge_type TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  current_revision_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'merged', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (owner_id, book_id, current_revision_id) REFERENCES knowledge_revisions(owner_id, book_id, knowledge_revision_id),
  UNIQUE(owner_id, book_id, knowledge_type, canonical_key),
  UNIQUE(owner_id, book_id, knowledge_item_id)
) STRICT;

CREATE TABLE knowledge_revisions (
  knowledge_revision_id TEXT PRIMARY KEY,
  knowledge_item_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  parent_revision_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  lifecycle_layer TEXT NOT NULL CHECK (lifecycle_layer IN ('temporary', 'candidate', 'canon', 'derived')),
  authority_grade TEXT NOT NULL CHECK (authority_grade IN ('A', 'B', 'C', 'D')),
  epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('objective', 'claim', 'belief', 'lie', 'dream', 'plan', 'counterfactual', 'ambiguous', 'conflicted')),
  negated INTEGER NOT NULL DEFAULT 0 CHECK (negated IN (0, 1)),
  viewpoint_entity_id TEXT,
  temporal_scope_id TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_hash TEXT CHECK (source_hash IS NULL OR length(source_hash) = 64),
  source_locator_json TEXT NOT NULL CHECK (json_valid(source_locator_json)),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  extractor_version TEXT,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('boss', 'agent', 'system', 'migration')),
  created_by_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'dormant', 'promoted', 'rejected', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (owner_id, book_id, knowledge_item_id) REFERENCES knowledge_items(owner_id, book_id, knowledge_item_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (owner_id, book_id, parent_revision_id) REFERENCES knowledge_revisions(owner_id, book_id, knowledge_revision_id),
  FOREIGN KEY (owner_id, book_id, temporal_scope_id) REFERENCES temporal_scopes(owner_id, book_id, temporal_scope_id),
  UNIQUE(knowledge_item_id, revision),
  UNIQUE(owner_id, book_id, knowledge_revision_id)
) STRICT;

CREATE INDEX knowledge_revisions_scope_layer_idx
ON knowledge_revisions(owner_id, book_id, lifecycle_layer, status, canon_revision);

CREATE INDEX knowledge_revisions_source_idx
ON knowledge_revisions(owner_id, book_id, source_type, source_id);

CREATE TABLE knowledge_promotions (
  knowledge_promotion_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  knowledge_item_id TEXT NOT NULL,
  source_temporary_revision_id TEXT,
  candidate_revision_id TEXT NOT NULL,
  promoted_canon_revision_id TEXT,
  checks_json TEXT NOT NULL CHECK (json_valid(checks_json)),
  decision_type TEXT NOT NULL CHECK (decision_type IN ('boss_confirmed', 'graded_settlement', 'chief_editor_approved')),
  decision_source_type TEXT NOT NULL,
  decision_source_id TEXT NOT NULL,
  projection_job_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'failed', 'rolled_back')),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (owner_id, book_id, knowledge_item_id) REFERENCES knowledge_items(owner_id, book_id, knowledge_item_id),
  FOREIGN KEY (owner_id, book_id, source_temporary_revision_id) REFERENCES knowledge_revisions(owner_id, book_id, knowledge_revision_id),
  FOREIGN KEY (owner_id, book_id, candidate_revision_id) REFERENCES knowledge_revisions(owner_id, book_id, knowledge_revision_id),
  FOREIGN KEY (owner_id, book_id, promoted_canon_revision_id) REFERENCES knowledge_revisions(owner_id, book_id, knowledge_revision_id)
) STRICT;

CREATE INDEX knowledge_promotions_scope_idx
ON knowledge_promotions(owner_id, book_id, status, created_at);

CREATE TABLE retention_records (
  retention_record_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  retention_class TEXT NOT NULL CHECK (retention_class IN ('hot', 'archive', 'grace', 'rebuildable')),
  archive_reference TEXT,
  checksum TEXT CHECK (checksum IS NULL OR length(checksum) = 64),
  grace_expires_at TEXT,
  reason TEXT NOT NULL,
  execution_status TEXT NOT NULL CHECK (execution_status IN ('planned', 'archived', 'cleanup_eligible', 'cleaned', 'restored', 'failed')),
  restore_result_json TEXT CHECK (restore_result_json IS NULL OR json_valid(restore_result_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, object_type, object_id)
) STRICT;

CREATE TABLE canon_source_bindings (
  canon_source_binding_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  knowledge_revision_id TEXT NOT NULL,
  canon_revision_id TEXT,
  canon_source_type TEXT NOT NULL,
  canon_source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  source_locator_json TEXT NOT NULL CHECK (json_valid(source_locator_json)),
  evidence_checked_at TEXT NOT NULL,
  binding_status TEXT NOT NULL CHECK (binding_status IN ('active', 'quarantined', 'superseded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (owner_id, book_id, knowledge_revision_id) REFERENCES knowledge_revisions(owner_id, book_id, knowledge_revision_id),
  FOREIGN KEY (canon_revision_id) REFERENCES canon_revisions(canon_revision_id),
  UNIQUE(owner_id, book_id, knowledge_revision_id, canon_source_type, canon_source_id)
) STRICT;

CREATE INDEX canon_source_bindings_scope_idx
ON canon_source_bindings(owner_id, book_id, binding_status, canon_source_type, canon_source_id);
