-- 滚动生长的故事线：作者边界、开放问题、卷末提炼候选、主编下一段推荐和幂等投影。
-- PRE-DR: next-platform-rolling-storyline-pre-20260823。
-- 只向前追加；既有拓扑、故事线版本、正文、结算、任务和调用审计保持原样。

CREATE TABLE storyline_settlement_projection_receipts_v6 (
  projection_receipt_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  storyline_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('event_settlement','volume_settlement')),
  source_version_id TEXT NOT NULL,
  ledger_entry_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (owner_id,book_id,storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  FOREIGN KEY (ledger_entry_id) REFERENCES creative_ledger_entries(ledger_entry_id),
  UNIQUE(owner_id,book_id,storyline_id,source_kind,source_version_id)
) STRICT;
CREATE INDEX storyline_projection_receipts_scope_idx
  ON storyline_settlement_projection_receipts_v6(owner_id,book_id,created_at DESC);

CREATE TABLE storyline_frontier_versions (
  frontier_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  storyline_id TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded','archived')),
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  target_volume_number INTEGER CHECK (target_volume_number IS NULL OR target_volume_number > 0),
  stage_ending TEXT,
  full_book_ending_known INTEGER NOT NULL DEFAULT 0 CHECK (full_book_ending_known IN (0,1)),
  parent_version_id TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('author','legacy_migration','accepted_recommendation')),
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (owner_id,book_id,storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  FOREIGN KEY (parent_version_id) REFERENCES storyline_frontier_versions(frontier_version_id),
  UNIQUE(owner_id,book_id,storyline_id,version)
) STRICT;
CREATE UNIQUE INDEX storyline_frontier_active_idx
  ON storyline_frontier_versions(owner_id,book_id,COALESCE(storyline_id,'')) WHERE status='active';

CREATE TABLE storyline_open_questions_v6 (
  open_question_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  storyline_id TEXT,
  question TEXT NOT NULL CHECK (length(trim(question)) > 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('author','settlement','accepted_candidate')),
  source_version_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','resolved','archived')),
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (owner_id,book_id,storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  UNIQUE(owner_id,book_id,open_question_id)
) STRICT;
CREATE INDEX storyline_open_questions_scope_idx
  ON storyline_open_questions_v6(owner_id,book_id,status,updated_at DESC);

CREATE TABLE storyline_growth_rounds_v6 (
  growth_round_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('author_request','event_settlement','volume_settlement')),
  trigger_object_id TEXT NOT NULL,
  trigger_version_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','partial_success','failed','stale')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE(owner_id,book_id,idempotency_key)
) STRICT;

CREATE TABLE storyline_growth_candidates_v6 (
  candidate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  growth_round_id TEXT NOT NULL,
  candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('emerging_line','next_direction')),
  storyline_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('candidate','accepted','rejected','observing','stale')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  source_batch_id TEXT,
  source_batch_member_id TEXT,
  based_on_version_ids_json TEXT NOT NULL CHECK (json_valid(based_on_version_ids_json)),
  stale_reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (growth_round_id) REFERENCES storyline_growth_rounds_v6(growth_round_id),
  FOREIGN KEY (owner_id,book_id,storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  FOREIGN KEY (source_batch_id) REFERENCES ai_node_batches_v6(batch_id),
  FOREIGN KEY (source_batch_member_id) REFERENCES ai_node_batch_members_v6(batch_member_id),
  UNIQUE(owner_id,book_id,growth_round_id,candidate_kind,evidence_hash,title)
) STRICT;
CREATE INDEX storyline_growth_candidates_scope_idx
  ON storyline_growth_candidates_v6(owner_id,book_id,status,candidate_kind,created_at DESC);

CREATE TABLE storyline_growth_decisions_v6 (
  decision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected','observing')),
  edited_content_json TEXT CHECK (edited_content_json IS NULL OR json_valid(edited_content_json)),
  created_storyline_id TEXT,
  created_frontier_version_id TEXT,
  expected_candidate_status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (candidate_id) REFERENCES storyline_growth_candidates_v6(candidate_id),
  FOREIGN KEY (owner_id,book_id,created_storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  FOREIGN KEY (created_frontier_version_id) REFERENCES storyline_frontier_versions(frontier_version_id),
  UNIQUE(owner_id,book_id,idempotency_key),
  UNIQUE(candidate_id)
) STRICT;

CREATE TABLE creative_template_versions_v6 (
  template_version_id TEXT PRIMARY KEY,
  template_key TEXT NOT NULL,
  target_object TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  schema_json TEXT NOT NULL CHECK (json_valid(schema_json)),
  prompt_contract_json TEXT NOT NULL CHECK (json_valid(prompt_contract_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  status TEXT NOT NULL CHECK (status IN ('active','superseded','archived')),
  rollout_percent INTEGER NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  UNIQUE(template_key,version)
) STRICT;
CREATE UNIQUE INDEX creative_template_versions_v6_active_idx
  ON creative_template_versions_v6(template_key) WHERE status='active';
-- 新批次冻结模板版本与哈希；历史批次保持 NULL，继续按原冻结 template_version 只读执行。
ALTER TABLE ai_node_batches_v6 ADD COLUMN template_version_id TEXT REFERENCES creative_template_versions_v6(template_version_id);
ALTER TABLE ai_node_batches_v6 ADD COLUMN template_hash TEXT CHECK (template_hash IS NULL OR length(template_hash)=64);
CREATE INDEX ai_node_batches_v6_template_idx ON ai_node_batches_v6(template_version_id);
