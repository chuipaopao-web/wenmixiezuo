-- design_review_id: DR-V7-PLANNING-ROUTE-SELECTION-20260826-36
-- 方法只做小范围检索；三套故事路线独立保存；作者确认后才允许生成正式全书树。

CREATE TABLE v7_planning_method_searches (
  search_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seat_key TEXT NOT NULL CHECK (seat_key IN ('chief_editor','structure_deputy','commercial_deputy')),
  member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  source_snapshot_id TEXT NOT NULL,
  search_request_json TEXT NOT NULL CHECK (json_valid(search_request_json)),
  candidate_methods_json TEXT NOT NULL CHECK (json_valid(candidate_methods_json)),
  search_hash TEXT NOT NULL CHECK (length(search_hash)=64),
  retrieval_version TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (run_id) REFERENCES v7_planning_recipe_runs(run_id),
  FOREIGN KEY (source_snapshot_id) REFERENCES v7_planning_source_snapshots(snapshot_id),
  UNIQUE (owner_id, book_id, run_id, seat_key),
  UNIQUE (owner_id, book_id, request_id)
) STRICT;
CREATE INDEX v7_planning_method_searches_run_idx
  ON v7_planning_method_searches(owner_id, book_id, run_id, created_at);

CREATE TABLE v7_planning_route_candidates (
  route_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  recipe_proposal_id TEXT NOT NULL,
  method_search_id TEXT NOT NULL,
  member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  route_json TEXT NOT NULL CHECK (json_valid(route_json)),
  route_hash TEXT NOT NULL CHECK (length(route_hash)=64),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (run_id) REFERENCES v7_planning_recipe_runs(run_id),
  FOREIGN KEY (recipe_proposal_id) REFERENCES v7_planning_recipe_proposals(proposal_id),
  FOREIGN KEY (method_search_id) REFERENCES v7_planning_method_searches(search_id),
  UNIQUE (owner_id, book_id, run_id, recipe_proposal_id),
  UNIQUE (owner_id, book_id, request_id)
) STRICT;
CREATE INDEX v7_planning_route_candidates_run_idx
  ON v7_planning_route_candidates(owner_id, book_id, run_id, created_at);

CREATE TABLE v7_planning_route_reviews (
  review_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  route_ids_json TEXT NOT NULL CHECK (json_valid(route_ids_json)),
  review_json TEXT NOT NULL CHECK (json_valid(review_json)),
  review_hash TEXT NOT NULL CHECK (length(review_hash)=64),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (run_id) REFERENCES v7_planning_recipe_runs(run_id),
  UNIQUE (owner_id, book_id, run_id),
  UNIQUE (owner_id, book_id, request_id)
) STRICT;

CREATE TABLE v7_planning_route_versions (
  route_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('candidate','confirmed','superseded')),
  route_json TEXT NOT NULL CHECK (json_valid(route_json)),
  route_hash TEXT NOT NULL CHECK (length(route_hash)=64),
  recipe_version_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  source_route_ids_json TEXT NOT NULL CHECK (json_valid(source_route_ids_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (recipe_version_id) REFERENCES v7_planning_recipe_versions(recipe_version_id),
  FOREIGN KEY (source_snapshot_id) REFERENCES v7_planning_source_snapshots(snapshot_id),
  UNIQUE (owner_id, book_id, revision)
) STRICT;
CREATE UNIQUE INDEX v7_planning_route_one_candidate_idx
  ON v7_planning_route_versions(owner_id, book_id) WHERE lifecycle='candidate';
CREATE UNIQUE INDEX v7_planning_route_one_confirmed_idx
  ON v7_planning_route_versions(owner_id, book_id) WHERE lifecycle='confirmed';

CREATE TABLE v7_planning_route_decisions (
  decision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  route_version_id TEXT NOT NULL,
  recipe_version_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  decision_kind TEXT NOT NULL CHECK (decision_kind IN ('select','adjust','merge')),
  source_route_ids_json TEXT NOT NULL CHECK (json_valid(source_route_ids_json)),
  author_note TEXT NOT NULL DEFAULT '' CHECK (length(author_note) <= 2000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (run_id) REFERENCES v7_planning_recipe_runs(run_id),
  FOREIGN KEY (route_version_id) REFERENCES v7_planning_route_versions(route_version_id),
  FOREIGN KEY (recipe_version_id) REFERENCES v7_planning_recipe_versions(recipe_version_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;

ALTER TABLE v7_planning_generation_runs ADD COLUMN route_version_id TEXT;
