-- V7开书Agent仍处于正式建书之前：所有数据都绑定账号，不伪装成book内对象。
-- 候选采用追加版本；只有后续作者明确确认时才允许转换成正式书籍资料。
CREATE TABLE v7_opening_agent_tasks (
  task_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  idea_text TEXT NOT NULL CHECK (length(idea_text) BETWEEN 4 AND 800),
  idea_version INTEGER NOT NULL DEFAULT 1 CHECK (idea_version >= 1),
  idea_hash TEXT NOT NULL CHECK (length(idea_hash) = 64),
  selected_chief_member_key TEXT,
  selected_screenwriter_member_key TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'working', 'awaiting_author_confirmation', 'awaiting_author_decision', 'failed', 'interrupted'
  )),
  phase TEXT NOT NULL,
  state_json TEXT CHECK (state_json IS NULL OR json_valid(state_json)),
  lease_token TEXT,
  lease_expires_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id),
  UNIQUE (owner_id, idempotency_key)
) STRICT;

CREATE INDEX v7_opening_agent_tasks_owner_status_idx
  ON v7_opening_agent_tasks(owner_id, status, updated_at);

CREATE TABLE v7_opening_agent_candidates (
  candidate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('work_order', 'opening_package', 'opening_review')),
  version INTEGER NOT NULL CHECK (version >= 1),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  created_by_member_key TEXT NOT NULL,
  model_request_id TEXT NOT NULL,
  source_candidate_ids_json TEXT NOT NULL CHECK (json_valid(source_candidate_ids_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id),
  FOREIGN KEY (task_id) REFERENCES v7_opening_agent_tasks(task_id),
  UNIQUE (owner_id, task_id, kind, version),
  UNIQUE (owner_id, task_id, model_request_id)
) STRICT;

CREATE INDEX v7_opening_agent_candidates_owner_task_idx
  ON v7_opening_agent_candidates(owner_id, task_id, created_at);

CREATE TABLE v7_opening_agent_model_calls (
  request_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  member_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('coding', 'agent')),
  state TEXT NOT NULL CHECK (state IN ('working', 'succeeded', 'failed', 'unknown')),
  prompt_hash TEXT NOT NULL CHECK (length(prompt_hash) = 64),
  reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cash_micros INTEGER CHECK (cash_micros IS NULL OR cash_micros >= 0),
  output_text TEXT,
  failure_class TEXT,
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id),
  FOREIGN KEY (task_id) REFERENCES v7_opening_agent_tasks(task_id)
) STRICT;

CREATE INDEX v7_opening_agent_model_calls_owner_state_idx
  ON v7_opening_agent_model_calls(owner_id, state, updated_at);

CREATE INDEX v7_opening_agent_model_calls_task_idx
  ON v7_opening_agent_model_calls(owner_id, task_id, started_at);
