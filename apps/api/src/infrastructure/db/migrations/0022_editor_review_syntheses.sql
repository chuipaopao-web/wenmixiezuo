CREATE TABLE editor_review_syntheses (
  editor_review_synthesis_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  review_panel_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  editor_agent_id TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  synthesis_json TEXT NOT NULL CHECK (json_valid(synthesis_json)),
  synthesis_hash TEXT NOT NULL CHECK (length(synthesis_hash) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (review_panel_id) REFERENCES review_panels(review_panel_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  FOREIGN KEY (editor_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  UNIQUE(owner_id, book_id, review_panel_id)
) STRICT;

ALTER TABLE chapter_pipeline_runs
  ADD COLUMN writer_takeover_count INTEGER NOT NULL DEFAULT 0 CHECK (writer_takeover_count BETWEEN 0 AND 1);

ALTER TABLE chapter_pipeline_runs
  ADD COLUMN writer_takeover_reason TEXT;

ALTER TABLE fact_assertions
  ADD COLUMN epistemic_status TEXT NOT NULL DEFAULT 'objective'
  CHECK (epistemic_status IN ('objective', 'claim', 'belief', 'lie', 'dream', 'plan', 'counterfactual', 'ambiguous', 'conflicted'));

ALTER TABLE fact_assertions
  ADD COLUMN negated INTEGER NOT NULL DEFAULT 0 CHECK (negated IN (0, 1));

ALTER TABLE fact_assertions ADD COLUMN viewpoint_entity_id TEXT REFERENCES entities(entity_id);
ALTER TABLE fact_assertions ADD COLUMN knowledge_subject_id TEXT REFERENCES entities(entity_id);
ALTER TABLE fact_assertions ADD COLUMN knowledge_time_start TEXT;
ALTER TABLE fact_assertions ADD COLUMN knowledge_time_end TEXT;
ALTER TABLE fact_assertions
  ADD COLUMN temporal_completeness TEXT NOT NULL DEFAULT 'partial'
  CHECK (temporal_completeness IN ('complete', 'partial', 'unknown'));

ALTER TABLE chunk_snapshots
  ADD COLUMN snapshot_kind TEXT NOT NULL DEFAULT 'materialized'
  CHECK (snapshot_kind IN ('materialized', 'fragment', 'manifest'));

CREATE TABLE chunk_snapshot_memberships (
  chunk_snapshot_membership_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  manifest_snapshot_id TEXT NOT NULL,
  member_snapshot_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id, manifest_snapshot_id)
    REFERENCES chunk_snapshots(owner_id, book_id, chunk_snapshot_id),
  FOREIGN KEY (owner_id, book_id, member_snapshot_id)
    REFERENCES chunk_snapshots(owner_id, book_id, chunk_snapshot_id),
  UNIQUE(owner_id, book_id, manifest_snapshot_id, source_type, source_id)
) STRICT;

CREATE INDEX chunk_snapshot_memberships_manifest_idx
  ON chunk_snapshot_memberships(owner_id, book_id, manifest_snapshot_id, source_type, source_id);
CREATE INDEX chunk_snapshot_memberships_member_idx
  ON chunk_snapshot_memberships(owner_id, book_id, member_snapshot_id, source_type, source_id, source_version);

CREATE TABLE embedding_vector_cache (
  embedding_cache_key TEXT NOT NULL,
  embedding_text_hash TEXT NOT NULL CHECK (length(embedding_text_hash) = 64),
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  vector_json TEXT NOT NULL CHECK (json_valid(vector_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (embedding_cache_key, embedding_text_hash)
) STRICT;
