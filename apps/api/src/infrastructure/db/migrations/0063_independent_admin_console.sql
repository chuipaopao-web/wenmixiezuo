-- 独立管理后台：会员流水、用户反馈、问题处理、叙事方法覆盖、提示词覆盖与真实调用提示词快照。

CREATE TABLE membership_transactions (
  transaction_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('grant','renew','revoke')),
  plan TEXT NOT NULL CHECK (plan IN ('bronze','silver','gold','diamond')),
  amount_cash_micros INTEGER NOT NULL DEFAULT 0 CHECK (amount_cash_micros >= 0),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX membership_transactions_time_idx ON membership_transactions(created_at DESC);
CREATE INDEX membership_transactions_user_idx ON membership_transactions(user_id, created_at DESC);

CREATE TABLE user_feedback (
  feedback_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  book_id TEXT,
  task_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('bug','experience','suggestion','other')),
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 2 AND 2000),
  page_path TEXT NOT NULL DEFAULT '',
  recovery_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX user_feedback_time_idx ON user_feedback(created_at DESC);
CREATE INDEX user_feedback_owner_idx ON user_feedback(owner_id, created_at DESC);

CREATE TABLE admin_issue_records (
  issue_record_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('failed_task','feedback')),
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','ignored')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  admin_note TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_type, source_id)
) STRICT;
CREATE INDEX admin_issue_records_status_idx ON admin_issue_records(status, severity, updated_at DESC);

CREATE TABLE platform_prompt_overrides (
  prompt_override_id TEXT PRIMARY KEY,
  trigger_key TEXT NOT NULL CHECK (length(trim(trigger_key)) > 0),
  role_key TEXT NOT NULL CHECK (length(trim(role_key)) > 0),
  phase_key TEXT NOT NULL DEFAULT '*',
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 8000),
  status TEXT NOT NULL CHECK (status IN ('active','superseded','archived')),
  updated_by_user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  created_at TEXT NOT NULL,
  UNIQUE(trigger_key, role_key, phase_key, version)
) STRICT;
CREATE UNIQUE INDEX platform_prompt_override_active_idx
  ON platform_prompt_overrides(trigger_key, role_key, phase_key) WHERE status = 'active';

CREATE TABLE model_call_prompt_snapshots (
  request_id TEXT PRIMARY KEY REFERENCES model_calls(request_id),
  task_type TEXT NOT NULL,
  role_key TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  task_prompt TEXT NOT NULL,
  supplemental_instructions TEXT NOT NULL DEFAULT '',
  prompt_override_id TEXT REFERENCES platform_prompt_overrides(prompt_override_id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX model_call_prompt_snapshots_task_idx ON model_call_prompt_snapshots(task_type, role_key, created_at DESC);

CREATE TABLE narrative_method_overrides (
  narrative_method_override_id TEXT PRIMARY KEY,
  method_key TEXT NOT NULL CHECK (length(trim(method_key)) > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('active','superseded','archived')),
  updated_by_user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  created_at TEXT NOT NULL,
  UNIQUE(method_key, version)
) STRICT;
CREATE UNIQUE INDEX narrative_method_override_active_idx
  ON narrative_method_overrides(method_key) WHERE status = 'active';
