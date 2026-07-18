CREATE TABLE chunk_snapshots (
  chunk_snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  embedding_text_policy_version TEXT NOT NULL,
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  node_count INTEGER NOT NULL DEFAULT 0 CHECK (node_count >= 0),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  coverage_json TEXT NOT NULL CHECK (json_valid(coverage_json)),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  status TEXT NOT NULL CHECK (status IN ('building', 'validated', 'ready', 'failed', 'stale', 'superseded')),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  validated_at TEXT,
  ready_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, chunk_snapshot_id)
) STRICT;

CREATE INDEX chunk_snapshots_scope_idx ON chunk_snapshots(owner_id, book_id, status, canon_revision);

CREATE TABLE chunk_snapshot_sources (
  chunk_snapshot_source_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chunk_snapshot_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  source_bytes INTEGER NOT NULL CHECK (source_bytes >= 0),
  source_locator_json TEXT NOT NULL CHECK (json_valid(source_locator_json)),
  lifecycle_layer TEXT NOT NULL CHECK (lifecycle_layer IN ('temporary', 'candidate', 'canon', 'derived')),
  authority_grade TEXT NOT NULL CHECK (authority_grade IN ('A', 'B', 'C', 'D')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id, chunk_snapshot_id) REFERENCES chunk_snapshots(owner_id, book_id, chunk_snapshot_id),
  UNIQUE(owner_id, book_id, chunk_snapshot_id, source_type, source_id, source_version)
) STRICT;

CREATE TABLE content_nodes (
  content_node_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chunk_snapshot_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  parent_node_id TEXT,
  node_type TEXT NOT NULL CHECK (node_type IN ('document', 'volume', 'chapter', 'scene_root', 'scene_beat', 'setting_section', 'outline_section', 'fact_group')),
  title TEXT,
  byte_start INTEGER NOT NULL CHECK (byte_start >= 0),
  byte_end INTEGER NOT NULL CHECK (byte_end >= byte_start),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id, chunk_snapshot_id) REFERENCES chunk_snapshots(owner_id, book_id, chunk_snapshot_id),
  FOREIGN KEY (owner_id, book_id, parent_node_id) REFERENCES content_nodes(owner_id, book_id, content_node_id),
  UNIQUE(owner_id, book_id, content_node_id)
) STRICT;

CREATE TABLE content_chunks (
  content_chunk_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chunk_snapshot_id TEXT NOT NULL,
  content_node_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  index_text_hash TEXT NOT NULL CHECK (length(index_text_hash) = 64),
  index_text TEXT NOT NULL,
  embedding_text TEXT NOT NULL,
  byte_start INTEGER NOT NULL CHECK (byte_start >= 0),
  byte_end INTEGER NOT NULL CHECK (byte_end >= byte_start),
  paragraph_start INTEGER NOT NULL CHECK (paragraph_start >= 0),
  paragraph_end INTEGER NOT NULL CHECK (paragraph_end >= paragraph_start),
  previous_chunk_id TEXT,
  next_chunk_id TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  chunk_type TEXT NOT NULL,
  retrieval_granularity TEXT NOT NULL CHECK (retrieval_granularity IN ('leaf', 'parent', 'summary')),
  fts_eligible INTEGER NOT NULL CHECK (fts_eligible IN (0, 1)),
  vector_eligible INTEGER NOT NULL CHECK (vector_eligible IN (0, 1)),
  direct_injection_eligible INTEGER NOT NULL CHECK (direct_injection_eligible IN (0, 1)),
  lifecycle_layer TEXT NOT NULL CHECK (lifecycle_layer IN ('temporary', 'candidate', 'canon', 'derived')),
  authority_grade TEXT NOT NULL CHECK (authority_grade IN ('A', 'B', 'C', 'D')),
  story_time_start TEXT,
  story_time_end TEXT,
  viewpoint_entity_id TEXT,
  speaker_entity_id TEXT,
  location_entity_id TEXT,
  narrative_mode TEXT NOT NULL,
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  chunk_policy_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  embedding_text_policy_version TEXT NOT NULL,
  boundary_confidence REAL NOT NULL CHECK (boundary_confidence BETWEEN 0 AND 1),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  retention_status TEXT NOT NULL CHECK (retention_status IN ('hot', 'archive', 'grace', 'rebuildable')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id, chunk_snapshot_id) REFERENCES chunk_snapshots(owner_id, book_id, chunk_snapshot_id),
  FOREIGN KEY (owner_id, book_id, content_node_id) REFERENCES content_nodes(owner_id, book_id, content_node_id),
  UNIQUE(owner_id, book_id, content_chunk_id)
) STRICT;

CREATE INDEX content_chunks_filter_idx ON content_chunks(owner_id, book_id, chunk_snapshot_id, lifecycle_layer, canon_revision, validation_status);
CREATE INDEX content_chunks_source_idx ON content_chunks(owner_id, book_id, source_type, source_id, source_version, ordinal);

CREATE VIRTUAL TABLE content_chunks_fts USING fts5(
  content_chunk_id UNINDEXED,
  owner_id UNINDEXED,
  book_id UNINDEXED,
  chunk_snapshot_id UNINDEXED,
  index_text,
  tokenize='unicode61'
);

CREATE TABLE chunk_entities (
  chunk_entity_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  content_chunk_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  mention_text TEXT NOT NULL,
  mention_byte_start INTEGER NOT NULL CHECK (mention_byte_start >= 0),
  mention_byte_end INTEGER NOT NULL CHECK (mention_byte_end >= mention_byte_start),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source TEXT NOT NULL CHECK (source IN ('structured', 'dictionary', 'local_model', 'boss')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id, content_chunk_id) REFERENCES content_chunks(owner_id, book_id, content_chunk_id),
  FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
) STRICT;

CREATE TABLE projection_outbox (
  projection_outbox_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  projection_type TEXT NOT NULL CHECK (projection_type IN ('fts', 'vector', 'wiki', 'relation', 'summary')),
  source_snapshot_id TEXT NOT NULL,
  required_canon_revision INTEGER NOT NULL CHECK (required_canon_revision >= 0),
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, idempotency_key)
) STRICT;

CREATE TABLE projection_jobs (
  projection_job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  projection_outbox_id TEXT NOT NULL,
  projection_type TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  worker_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'building', 'validating', 'ready', 'failed', 'cancelled')),
  probe_result_json TEXT CHECK (probe_result_json IS NULL OR json_valid(probe_result_json)),
  error_code TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (projection_outbox_id) REFERENCES projection_outbox(projection_outbox_id)
) STRICT;

CREATE TABLE projection_watermarks (
  projection_watermark_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  projection_type TEXT NOT NULL,
  active_snapshot_id TEXT,
  previous_snapshot_id TEXT,
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  completed_source_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (completed_source_ordinal >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'building', 'ready', 'failed', 'stale', 'degraded')),
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, projection_type)
) STRICT;

CREATE TABLE embedding_model_snapshots (
  embedding_model_snapshot_id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  source TEXT NOT NULL,
  license TEXT NOT NULL,
  local_path TEXT NOT NULL,
  files_json TEXT NOT NULL CHECK (json_valid(files_json)),
  tokenizer_id TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  normalized INTEGER NOT NULL CHECK (normalized IN (0, 1)),
  query_instruction TEXT NOT NULL,
  quantization TEXT,
  asset_hash TEXT NOT NULL CHECK (length(asset_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('available', 'invalid', 'disabled')),
  verified_at TEXT NOT NULL,
  UNIQUE(model_id, model_version, asset_hash)
) STRICT;

CREATE TABLE vector_index_manifests (
  vector_index_manifest_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chunk_snapshot_id TEXT NOT NULL,
  embedding_model_snapshot_id TEXT NOT NULL,
  index_path TEXT NOT NULL,
  table_name TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  chunk_policy_version TEXT NOT NULL,
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  manifest_hash TEXT CHECK (manifest_hash IS NULL OR length(manifest_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('building', 'ready', 'failed', 'stale', 'superseded')),
  created_at TEXT NOT NULL,
  ready_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (embedding_model_snapshot_id) REFERENCES embedding_model_snapshots(embedding_model_snapshot_id),
  UNIQUE(owner_id, book_id, chunk_snapshot_id, embedding_model_snapshot_id)
) STRICT;

CREATE TABLE book_capability_states (
  book_capability_state_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  capability_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'degraded', 'disabled', 'building', 'failed')),
  reason_code TEXT,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  checked_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, capability_key)
) STRICT;
