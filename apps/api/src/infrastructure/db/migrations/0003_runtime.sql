CREATE TABLE role_templates (
  role_template_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  role_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('core', 'specialist')),
  responsibilities_json TEXT NOT NULL CHECK (json_valid(responsibilities_json)),
  required_capabilities_json TEXT NOT NULL CHECK (json_valid(required_capabilities_json)),
  default_activation TEXT NOT NULL CHECK (default_activation IN ('resident', 'standby')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (role_template_id, version),
  UNIQUE(role_key, version)
) STRICT;

CREATE TABLE model_config_snapshots (
  model_snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  validated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE agent_instances (
  agent_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  role_template_id TEXT NOT NULL,
  role_template_version INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  activation_state TEXT NOT NULL CHECK (activation_state IN ('idle', 'standby', 'paused', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (role_template_id, role_template_version) REFERENCES role_templates(role_template_id, version),
  FOREIGN KEY (model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  UNIQUE(owner_id, book_id, role_template_id)
) STRICT;

CREATE INDEX agent_instances_scope_idx ON agent_instances(owner_id, book_id, activation_state);

CREATE TABLE budgets (
  budget_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('saving', 'standard', 'detailed')),
  token_limit INTEGER NOT NULL CHECK (token_limit >= 0),
  cash_limit_micros INTEGER NOT NULL CHECK (cash_limit_micros >= 0),
  reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  reserved_cash_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cash_micros >= 0),
  spent_tokens INTEGER NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  spent_cash_micros INTEGER NOT NULL DEFAULT 0 CHECK (spent_cash_micros >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'exhausted', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE budget_reservations (
  reservation_id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  frozen_tokens INTEGER NOT NULL CHECK (frozen_tokens >= 0),
  frozen_cash_micros INTEGER NOT NULL CHECK (frozen_cash_micros >= 0),
  actual_tokens INTEGER,
  actual_cash_micros INTEGER,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  created_at TEXT NOT NULL,
  settled_at TEXT,
  FOREIGN KEY (budget_id) REFERENCES budgets(budget_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE usage_ledger (
  usage_id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT,
  request_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  cash_micros INTEGER NOT NULL CHECK (cash_micros >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (budget_id) REFERENCES budgets(budget_id),
  FOREIGN KEY (reservation_id) REFERENCES budget_reservations(reservation_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT,
  task_type TEXT NOT NULL,
  assigned_agent_id TEXT,
  task_brief_json TEXT NOT NULL CHECK (json_valid(task_brief_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'working', 'waiting_confirmation', 'paused', 'blocked', 'interrupted', 'failed', 'cancelled', 'succeeded')),
  current_phase TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  budget_id TEXT,
  required_editor_epoch INTEGER NOT NULL DEFAULT 0 CHECK (required_editor_epoch >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)),
  pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0, 1)),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (release_id) REFERENCES release_runs(release_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (assigned_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (budget_id) REFERENCES budgets(budget_id),
  UNIQUE(owner_id, book_id, idempotency_key)
) STRICT;

CREATE INDEX tasks_scheduler_idx ON tasks(status, lease_expires_at, created_at);
CREATE INDEX tasks_scope_idx ON tasks(owner_id, book_id, status, updated_at);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  CHECK (task_id <> depends_on_task_id)
) STRICT;

CREATE TABLE task_phases (
  phase_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'working', 'paused', 'interrupted', 'failed', 'succeeded')),
  input_version_json TEXT NOT NULL CHECK (json_valid(input_version_json)),
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)),
  artifact_json TEXT NOT NULL CHECK (json_valid(artifact_json)),
  entered_at TEXT NOT NULL,
  heartbeat_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(task_id, phase_key)
) STRICT;

CREATE TABLE model_calls (
  request_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  context_pack_id TEXT,
  reservation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'working', 'succeeded', 'failed', 'interrupted')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cash_micros INTEGER,
  duration_ms INTEGER,
  result_reference TEXT,
  error_class TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  FOREIGN KEY (reservation_id) REFERENCES budget_reservations(reservation_id),
  UNIQUE(task_id, phase_key, model_snapshot_id, input_hash)
) STRICT;

CREATE TABLE tool_calls (
  tool_call_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'working', 'succeeded', 'failed', 'interrupted', 'cancelled')),
  result_reference TEXT,
  error_class TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  UNIQUE(owner_id, book_id, idempotency_key)
) STRICT;

CREATE TABLE editor_leases (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  active_editor_agent_id TEXT NOT NULL,
  candidate_editor_agent_id TEXT,
  editor_epoch INTEGER NOT NULL CHECK (editor_epoch >= 1),
  lease_expires_at TEXT NOT NULL,
  takeover_state TEXT NOT NULL CHECK (takeover_state IN ('stable', 'preparing', 'ready')),
  takeover_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (active_editor_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (candidate_editor_agent_id) REFERENCES agent_instances(agent_id)
) STRICT;

CREATE TABLE takeover_packages (
  takeover_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  from_editor_agent_id TEXT NOT NULL,
  to_editor_agent_id TEXT NOT NULL,
  from_epoch INTEGER NOT NULL,
  to_epoch INTEGER,
  package_json TEXT NOT NULL CHECK (json_valid(package_json)),
  status TEXT NOT NULL CHECK (status IN ('preparing', 'ready', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (from_editor_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (to_editor_agent_id) REFERENCES agent_instances(agent_id)
) STRICT;

