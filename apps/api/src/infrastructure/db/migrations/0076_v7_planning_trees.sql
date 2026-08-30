-- design_review_id: DR-V7-PLANNING-TREES-20260826-34
-- V7三棵综合规划树独立数据域。只新增，不读取或改写V6卷/事件链表。

CREATE TABLE v7_planning_tree_heads (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tree_kind TEXT NOT NULL CHECK (tree_kind IN ('book','volume','chain')),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  candidate_version_id TEXT,
  confirmed_version_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id, tree_kind, scope_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE v7_planning_tree_versions (
  tree_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tree_kind TEXT NOT NULL CHECK (tree_kind IN ('book','volume','chain')),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('candidate','confirmed','superseded')),
  parent_version_id TEXT,
  schema_version TEXT NOT NULL CHECK (schema_version='v7-planning-tree-v1'),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),
  created_by TEXT NOT NULL CHECK (length(trim(created_by)) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (parent_version_id) REFERENCES v7_planning_tree_versions(tree_version_id),
  UNIQUE (owner_id, book_id, tree_kind, scope_id, revision)
) STRICT;
CREATE INDEX v7_planning_tree_versions_history_idx
  ON v7_planning_tree_versions(owner_id, book_id, tree_kind, scope_id, revision DESC);
CREATE UNIQUE INDEX v7_planning_tree_one_candidate_idx
  ON v7_planning_tree_versions(owner_id, book_id, tree_kind, scope_id) WHERE lifecycle='candidate';
CREATE UNIQUE INDEX v7_planning_tree_one_confirmed_idx
  ON v7_planning_tree_versions(owner_id, book_id, tree_kind, scope_id) WHERE lifecycle='confirmed';

CREATE TABLE v7_planning_tree_actions (
  action_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tree_kind TEXT NOT NULL CHECK (tree_kind IN ('book','volume','chain')),
  scope_id TEXT NOT NULL,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('create_candidate','revise_candidate','confirm_candidate','record_actual')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;
CREATE INDEX v7_planning_tree_actions_scope_idx
  ON v7_planning_tree_actions(owner_id, book_id, tree_kind, scope_id, created_at DESC);

CREATE TABLE v7_planning_node_actuals (
  actual_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tree_kind TEXT NOT NULL CHECK (tree_kind IN ('book','volume','chain')),
  scope_id TEXT NOT NULL,
  node_key TEXT NOT NULL CHECK (length(trim(node_key)) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  state TEXT NOT NULL CHECK (state IN ('partial','completed','deviated')),
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  emotion_result TEXT NOT NULL,
  experience_result TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (length(trim(outcome)) > 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('chapter_settlement','event_settlement','volume_settlement')),
  source_version_id TEXT NOT NULL CHECK (length(trim(source_version_id)) > 0),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, tree_kind, scope_id, node_key, revision),
  UNIQUE (owner_id, book_id, tree_kind, scope_id, node_key, source_kind, source_version_id)
) STRICT;
CREATE INDEX v7_planning_node_actuals_latest_idx
  ON v7_planning_node_actuals(owner_id, book_id, tree_kind, scope_id, node_key, revision DESC);

