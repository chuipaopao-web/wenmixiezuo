-- V7创作闭环加法迁移。设计审查：DR-V7-CREATION-PIPELINE-20260827-38。
-- 老板已于2026-08-27明确批准V7核心创作数据库变更。
-- 不改变V6或既有V7表语义；作者定稿正文只追加版本。

CREATE TABLE v7_creation_workflows (
  workflow_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  volume_scope_id TEXT NOT NULL, chain_scope_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('context_selection','volume_options','volume_decision','volume_tree_confirmation','chain_options','chain_decision','chain_tree_confirmation','chapter_outlines','chapter_outline_confirmation','manuscript','manuscript_confirmation','settlement','completed')),
  status TEXT NOT NULL CHECK (status IN ('queued','working','awaiting_author','completed','partially_failed','failed','unknown','cancelled')),
  first_volume INTEGER NOT NULL CHECK (first_volume IN (0,1)), author_goal TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)), error_message TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE (owner_id,book_id,idempotency_key)
) STRICT;
CREATE INDEX v7_creation_workflows_scope_idx ON v7_creation_workflows(owner_id,book_id,updated_at DESC);

CREATE TABLE v7_creation_context_packs (
  context_pack_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  task_kind TEXT NOT NULL CHECK (task_kind IN ('volume','chain','outline','manuscript','review','settlement')),
  task_id TEXT NOT NULL, task_brief TEXT NOT NULL,
  candidate_sources_json TEXT NOT NULL CHECK (json_valid(candidate_sources_json)),
  selection_json TEXT CHECK (selection_json IS NULL OR json_valid(selection_json)),
  content_json TEXT CHECK (content_json IS NULL OR json_valid(content_json)),
  content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash)=64),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint)=64),
  status TEXT NOT NULL CHECK (status IN ('queued','working','active','failed','unknown','invalidated')),
  assigned_member_key TEXT NOT NULL, request_id TEXT, error_message TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  UNIQUE (owner_id,book_id,workflow_id,task_kind,task_id,source_fingerprint)
) STRICT;
CREATE INDEX v7_creation_context_packs_task_idx ON v7_creation_context_packs(owner_id,book_id,workflow_id,task_kind,created_at DESC);

CREATE TABLE v7_creation_options (
  option_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL, option_kind TEXT NOT NULL CHECK (option_kind IN ('volume','chain')),
  scope_id TEXT NOT NULL, seat_key TEXT NOT NULL CHECK (seat_key IN ('structure','commercial','character')),
  member_key TEXT NOT NULL, member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  context_pack_id TEXT NOT NULL, option_json TEXT NOT NULL CHECK (json_valid(option_json)),
  option_hash TEXT NOT NULL CHECK (length(option_hash)=64), request_id TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  FOREIGN KEY (context_pack_id) REFERENCES v7_creation_context_packs(context_pack_id),
  UNIQUE (owner_id,book_id,workflow_id,option_kind,scope_id,seat_key)
) STRICT;

CREATE TABLE v7_creation_option_reviews (
  review_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL, option_kind TEXT NOT NULL CHECK (option_kind IN ('volume','chain')),
  scope_id TEXT NOT NULL, option_ids_json TEXT NOT NULL CHECK (json_valid(option_ids_json)),
  member_key TEXT NOT NULL, member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  review_json TEXT NOT NULL CHECK (json_valid(review_json)), review_hash TEXT NOT NULL CHECK (length(review_hash)=64),
  request_id TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  UNIQUE (owner_id,book_id,workflow_id,option_kind,scope_id)
) STRICT;

CREATE TABLE v7_creation_decisions (
  decision_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  decision_kind TEXT NOT NULL CHECK (decision_kind IN ('volume_option','chain_option','outline','manuscript')),
  target_id TEXT NOT NULL, author_note TEXT, decision_json TEXT NOT NULL CHECK (json_valid(decision_json)),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64), created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  UNIQUE (owner_id,book_id,idempotency_key),
  UNIQUE (owner_id,book_id,workflow_id,decision_kind)
) STRICT;

CREATE TABLE v7_chapter_outline_sequences (
  sequence_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL, chain_scope_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision>=1),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('candidate','confirmed','superseded')),
  context_pack_id TEXT NOT NULL, content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64), member_key TEXT NOT NULL,
  request_id TEXT NOT NULL, created_at TEXT NOT NULL, confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  FOREIGN KEY (context_pack_id) REFERENCES v7_creation_context_packs(context_pack_id),
  UNIQUE (owner_id,book_id,chain_scope_id,revision)
) STRICT;
CREATE UNIQUE INDEX v7_chapter_outlines_one_candidate_idx ON v7_chapter_outline_sequences(owner_id,book_id,chain_scope_id) WHERE lifecycle='candidate';
CREATE UNIQUE INDEX v7_chapter_outlines_one_confirmed_idx ON v7_chapter_outline_sequences(owner_id,book_id,chain_scope_id) WHERE lifecycle='confirmed';

CREATE TABLE v7_manuscript_versions (
  manuscript_version_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL, sequence_id TEXT NOT NULL, chapter_number INTEGER NOT NULL CHECK (chapter_number>=1),
  outline_revision INTEGER NOT NULL CHECK (outline_revision>=1), revision INTEGER NOT NULL CHECK (revision>=1),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('draft','reviewed','final')),
  content_text TEXT NOT NULL, content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  context_pack_id TEXT NOT NULL, member_key TEXT NOT NULL, based_on_version_id TEXT,
  request_id TEXT NOT NULL, created_at TEXT NOT NULL, finalized_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  FOREIGN KEY (sequence_id) REFERENCES v7_chapter_outline_sequences(sequence_id),
  FOREIGN KEY (context_pack_id) REFERENCES v7_creation_context_packs(context_pack_id),
  FOREIGN KEY (based_on_version_id) REFERENCES v7_manuscript_versions(manuscript_version_id),
  UNIQUE (owner_id,book_id,chapter_number,revision)
) STRICT;
CREATE UNIQUE INDEX v7_manuscripts_one_final_idx ON v7_manuscript_versions(owner_id,book_id,chapter_number) WHERE lifecycle='final';

CREATE TABLE v7_manuscript_reviews (
  review_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL, manuscript_version_id TEXT NOT NULL,
  member_key TEXT NOT NULL, member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  review_json TEXT NOT NULL CHECK (json_valid(review_json)), review_hash TEXT NOT NULL CHECK (length(review_hash)=64),
  request_id TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES v7_manuscript_versions(manuscript_version_id),
  UNIQUE (owner_id,book_id,manuscript_version_id)
) STRICT;

CREATE TABLE v7_chapter_settlements (
  settlement_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL, manuscript_version_id TEXT NOT NULL,
  manuscript_hash TEXT NOT NULL CHECK (length(manuscript_hash)=64),
  settlement_json TEXT NOT NULL CHECK (json_valid(settlement_json)), settlement_hash TEXT NOT NULL CHECK (length(settlement_hash)=64),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)), member_key TEXT NOT NULL,
  request_id TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES v7_manuscript_versions(manuscript_version_id),
  UNIQUE (owner_id,book_id,manuscript_version_id)
) STRICT;

CREATE TABLE v7_story_state_items (
  item_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('story_line','foreshadowing','open_question')),
  stable_key TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, active_version_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE (owner_id,book_id,item_kind,stable_key)
) STRICT;

CREATE TABLE v7_story_state_versions (
  state_version_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  item_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision>=1),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)), content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  source_settlement_id TEXT NOT NULL, evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (item_id) REFERENCES v7_story_state_items(item_id),
  FOREIGN KEY (source_settlement_id) REFERENCES v7_chapter_settlements(settlement_id),
  UNIQUE (owner_id,book_id,item_id,revision),
  UNIQUE (owner_id,book_id,item_id,source_settlement_id)
) STRICT;

CREATE TABLE v7_formalization_outbox (
  event_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL, source_kind TEXT NOT NULL CHECK (source_kind IN ('final_manuscript','chapter_settlement')),
  source_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('settle_chapter','maintain_characters','maintain_planning','maintain_story_state')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL CHECK (status IN ('pending','working','completed','failed','unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0), lease_token TEXT, lease_expires_at TEXT,
  error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  UNIQUE (owner_id,book_id,source_kind,source_id,event_kind)
) STRICT;
CREATE INDEX v7_formalization_outbox_pending_idx ON v7_formalization_outbox(status,created_at);

CREATE TABLE v7_creation_model_calls (
  request_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('context','option','option_review','outline','manuscript','review','settlement')),
  node_key TEXT NOT NULL, member_key TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('coding','agent')),
  purpose TEXT NOT NULL CHECK (purpose IN ('structured_planning','novel_writer','novel_reviewer')),
  state TEXT NOT NULL CHECK (state IN ('working','succeeded','failed','unknown')),
  prompt_hash TEXT NOT NULL CHECK (length(prompt_hash)=64), reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens>=0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens>=0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens>=0),
  cash_micros INTEGER CHECK (cash_micros IS NULL OR cash_micros>=0),
  output_text TEXT, failure_message TEXT, started_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id)
) STRICT;
CREATE INDEX v7_creation_model_calls_workflow_idx ON v7_creation_model_calls(owner_id,book_id,workflow_id,state,started_at);
