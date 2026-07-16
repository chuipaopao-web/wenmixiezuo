CREATE TABLE writer_selections (
  writer_selection_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('standard_blind', 'quick', 'owner_specified')),
  selected_agent_id TEXT NOT NULL,
  selected_model_snapshot_id TEXT NOT NULL,
  candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
  decision_json TEXT NOT NULL CHECK (json_valid(decision_json)),
  status TEXT NOT NULL CHECK (status IN ('selected', 'superseded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (selected_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (selected_model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id)
) STRICT;

CREATE TABLE chapter_batches (
  batch_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_ids_json TEXT NOT NULL CHECK (json_valid(chapter_ids_json)),
  task_ids_json TEXT NOT NULL CHECK (json_valid(task_ids_json)),
  next_index INTEGER NOT NULL DEFAULT 0 CHECK (next_index >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'working', 'paused', 'failed', 'completed', 'cancelled')),
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE chapter_pipeline_runs (
  pipeline_run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  writer_selection_id TEXT NOT NULL,
  writer_agent_id TEXT NOT NULL,
  writer_model_snapshot_id TEXT NOT NULL,
  reviewer_agent_id TEXT NOT NULL,
  reviewer_model_snapshot_id TEXT NOT NULL,
  outline_version_id TEXT,
  writing_contract_version_id TEXT,
  context_pack_id TEXT,
  current_manuscript_version_id TEXT,
  expected_canon_revision INTEGER NOT NULL,
  expected_positioning_version INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('preflight', 'context', 'draft', 'hard_check', 'review', 'rewrite', 'facts', 'settlement', 'completed')),
  rewrite_count INTEGER NOT NULL DEFAULT 0 CHECK (rewrite_count BETWEEN 0 AND 2),
  status TEXT NOT NULL CHECK (status IN ('pending', 'working', 'paused', 'failed', 'completed')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (writer_selection_id) REFERENCES writer_selections(writer_selection_id),
  FOREIGN KEY (writer_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (writer_model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  FOREIGN KEY (reviewer_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (reviewer_model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  FOREIGN KEY (outline_version_id) REFERENCES artifact_versions(artifact_version_id),
  FOREIGN KEY (writing_contract_version_id) REFERENCES artifact_versions(artifact_version_id),
  FOREIGN KEY (context_pack_id) REFERENCES context_packs(context_pack_id),
  FOREIGN KEY (current_manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  UNIQUE(owner_id, book_id, chapter_id)
) STRICT;

CREATE TABLE hard_check_results (
  hard_check_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  checks_json TEXT NOT NULL CHECK (json_valid(checks_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id)
) STRICT;

CREATE TABLE review_rounds (
  review_round_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  reviewer_agent_id TEXT NOT NULL,
  reviewer_model_snapshot_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 3),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'rewrite', 'blocked')),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  FOREIGN KEY (reviewer_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (reviewer_model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  UNIQUE(owner_id, book_id, chapter_id, round_number)
) STRICT;

CREATE TABLE review_issues (
  review_issue_id TEXT PRIMARY KEY,
  review_round_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  location_text TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('blocker', 'major', 'minor', 'observation')),
  evidence_text TEXT NOT NULL,
  required_action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'accepted')),
  resolved_by_manuscript_version_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (review_round_id) REFERENCES review_rounds(review_round_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (resolved_by_manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id)
) STRICT;

CREATE TABLE chapter_quality_metrics (
  quality_metric_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  scores_json TEXT NOT NULL CHECK (json_valid(scores_json)),
  rewrite_count INTEGER NOT NULL CHECK (rewrite_count BETWEEN 0 AND 2),
  repeated_major_style_issue INTEGER NOT NULL CHECK (repeated_major_style_issue IN (0, 1)),
  switch_writer_suggested INTEGER NOT NULL CHECK (switch_writer_suggested IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id)
) STRICT;

CREATE INDEX creation_runs_scope_idx ON chapter_pipeline_runs(owner_id, book_id, status, updated_at);
CREATE INDEX review_issues_scope_idx ON review_issues(owner_id, book_id, chapter_id, severity, status);
