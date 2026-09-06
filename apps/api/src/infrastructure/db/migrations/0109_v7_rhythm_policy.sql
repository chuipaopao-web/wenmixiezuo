-- Additive shared configuration only. Author content and old tasks are untouched.
CREATE TABLE v7_rhythm_policy_versions (
  version INTEGER PRIMARY KEY,
  policy_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE v7_rhythm_task_policies (
  task_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL REFERENCES v7_rhythm_policy_versions(version),
  created_at TEXT NOT NULL
);
