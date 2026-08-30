-- design_review_id: DR-V7-PLANNING-EDITORIAL-RUNTIME-20260826-35
-- V7规划编辑部运行闭环。只新增V7对象，不读取或改写V6卷、事件链产品表。

CREATE TABLE v7_planning_source_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tree_kind TEXT NOT NULL CHECK (tree_kind IN ('book','volume','chain')),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) BETWEEN 1 AND 128),
  purpose TEXT NOT NULL CHECK (purpose IN ('recipe_design','tree_generation','settlement_maintenance')),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint)=64),
  compiled_content_json TEXT NOT NULL CHECK (json_valid(compiled_content_json)),
  excluded_sources_json TEXT NOT NULL CHECK (json_valid(excluded_sources_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, tree_kind, scope_id, purpose, source_fingerprint)
) STRICT;
CREATE INDEX v7_planning_source_snapshots_scope_idx
  ON v7_planning_source_snapshots(owner_id, book_id, tree_kind, scope_id, created_at DESC);

CREATE TABLE v7_planning_source_items (
  source_item_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('opening','setting','author_goal','confirmed_tree','settlement')),
  source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
  source_version TEXT NOT NULL CHECK (length(trim(source_version)) > 0),
  authority TEXT NOT NULL CHECK (authority IN ('formal','goal','actual')),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  included_reason TEXT NOT NULL CHECK (length(trim(included_reason)) > 0),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  created_at TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES v7_planning_source_snapshots(snapshot_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (snapshot_id, sequence),
  UNIQUE (snapshot_id, source_kind, source_id, source_version)
) STRICT;
CREATE INDEX v7_planning_source_items_snapshot_idx
  ON v7_planning_source_items(owner_id, book_id, snapshot_id, sequence);

CREATE TABLE v7_planning_recipe_runs (
  run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  status TEXT NOT NULL CHECK (status IN ('queued','working','awaiting_author','completed','partially_failed','failed','cancelled')),
  current_phase TEXT NOT NULL,
  roster_json TEXT NOT NULL CHECK (json_valid(roster_json)),
  lease_token TEXT,
  lease_expires_at TEXT,
  error_message TEXT,
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (snapshot_id) REFERENCES v7_planning_source_snapshots(snapshot_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;
CREATE INDEX v7_planning_recipe_runs_scope_idx
  ON v7_planning_recipe_runs(owner_id, book_id, updated_at DESC);

CREATE TABLE v7_planning_recipe_proposals (
  proposal_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seat_key TEXT NOT NULL CHECK (seat_key IN ('chief_editor','structure_deputy','commercial_deputy','chief_comparison')),
  member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  source_snapshot_id TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  proposal_hash TEXT NOT NULL CHECK (length(proposal_hash)=64),
  source_proposal_ids_json TEXT NOT NULL CHECK (json_valid(source_proposal_ids_json)),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (run_id) REFERENCES v7_planning_recipe_runs(run_id),
  FOREIGN KEY (source_snapshot_id) REFERENCES v7_planning_source_snapshots(snapshot_id),
  UNIQUE (owner_id, book_id, run_id, seat_key),
  UNIQUE (owner_id, book_id, request_id)
) STRICT;
CREATE INDEX v7_planning_recipe_proposals_run_idx
  ON v7_planning_recipe_proposals(owner_id, book_id, run_id, created_at);

CREATE TABLE v7_planning_recipe_versions (
  recipe_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('candidate','confirmed','superseded')),
  recipe_json TEXT NOT NULL CHECK (json_valid(recipe_json)),
  recipe_hash TEXT NOT NULL CHECK (length(recipe_hash)=64),
  source_snapshot_id TEXT NOT NULL,
  source_proposal_ids_json TEXT NOT NULL CHECK (json_valid(source_proposal_ids_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (source_snapshot_id) REFERENCES v7_planning_source_snapshots(snapshot_id),
  UNIQUE (owner_id, book_id, revision)
) STRICT;
CREATE UNIQUE INDEX v7_planning_recipe_one_candidate_idx
  ON v7_planning_recipe_versions(owner_id, book_id) WHERE lifecycle='candidate';
CREATE UNIQUE INDEX v7_planning_recipe_one_confirmed_idx
  ON v7_planning_recipe_versions(owner_id, book_id) WHERE lifecycle='confirmed';

CREATE TABLE v7_planning_recipe_decisions (
  decision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  recipe_version_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  decision_kind TEXT NOT NULL CHECK (decision_kind IN ('accept_chief','accept_structure','accept_commercial','accept_comparison')),
  author_note TEXT NOT NULL DEFAULT '' CHECK (length(author_note) <= 2000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (run_id) REFERENCES v7_planning_recipe_runs(run_id),
  FOREIGN KEY (recipe_version_id) REFERENCES v7_planning_recipe_versions(recipe_version_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;

CREATE TABLE v7_planning_generation_runs (
  generation_run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tree_kind TEXT NOT NULL CHECK (tree_kind IN ('book','volume','chain')),
  scope_id TEXT NOT NULL,
  recipe_version_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  parent_tree_version_id TEXT,
  assigned_member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  status TEXT NOT NULL CHECK (status IN ('queued','working','succeeded','failed','unknown','cancelled')),
  request_id TEXT,
  candidate_tree_version_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (recipe_version_id) REFERENCES v7_planning_recipe_versions(recipe_version_id),
  FOREIGN KEY (source_snapshot_id) REFERENCES v7_planning_source_snapshots(snapshot_id),
  FOREIGN KEY (parent_tree_version_id) REFERENCES v7_planning_tree_versions(tree_version_id),
  FOREIGN KEY (candidate_tree_version_id) REFERENCES v7_planning_tree_versions(tree_version_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;
CREATE INDEX v7_planning_generation_runs_scope_idx
  ON v7_planning_generation_runs(owner_id, book_id, tree_kind, scope_id, updated_at DESC);

CREATE TABLE v7_planning_adjustment_suggestions (
  suggestion_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tree_kind TEXT NOT NULL CHECK (tree_kind IN ('book','volume','chain')),
  scope_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('chapter_settlement','event_settlement','volume_settlement')),
  source_version_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','accepted','dismissed','superseded')),
  public_summary TEXT NOT NULL,
  suggestion_json TEXT NOT NULL CHECK (json_valid(suggestion_json)),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, tree_kind, scope_id, node_key, source_kind, source_version_id)
) STRICT;

CREATE TABLE v7_planning_model_calls (
  request_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('recipe','tree','maintenance')),
  node_key TEXT NOT NULL,
  member_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('coding','agent')),
  state TEXT NOT NULL CHECK (state IN ('working','succeeded','failed','unknown')),
  prompt_hash TEXT NOT NULL CHECK (length(prompt_hash)=64),
  reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cash_micros INTEGER CHECK (cash_micros IS NULL OR cash_micros >= 0),
  output_text TEXT,
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;
CREATE INDEX v7_planning_model_calls_scope_idx
  ON v7_planning_model_calls(owner_id, book_id, run_id, state);
