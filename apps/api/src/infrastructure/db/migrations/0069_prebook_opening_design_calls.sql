-- 建书前还没有 book_id，不能把 AI 开书设计伪装成书内 task/model_call。
-- 单独记录账号级调用，既保留幂等与失败证据，也让会员算力按真实 token 汇总。
CREATE TABLE prebook_opening_design_calls (
  call_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  role_key TEXT NOT NULL CHECK (role_key = 'chief_editor'),
  member_name TEXT NOT NULL CHECK (length(member_name) BETWEEN 1 AND 80),
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('working', 'succeeded', 'failed', 'interrupted')),
  reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cash_micros INTEGER CHECK (cash_micros IS NULL OR cash_micros >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_class TEXT,
  error_detail TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id),
  UNIQUE (owner_id, idempotency_key, attempt_no)
) STRICT;

CREATE INDEX prebook_opening_design_calls_owner_state_idx
  ON prebook_opening_design_calls(owner_id, state, updated_at);
