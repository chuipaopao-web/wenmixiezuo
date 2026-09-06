-- Candidate identities are separate from the legacy executable roster.
-- Old releases ignore these rows; no author data or task snapshot is rewritten.
CREATE TABLE v7_agent_member_slots (
  member_key TEXT PRIMARY KEY,
  role_key TEXT NOT NULL,
  model_profile_key TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE v7_agent_slot_events (
  event_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  member_key TEXT NOT NULL REFERENCES v7_agent_member_slots(member_key),
  before_model_profile_key TEXT,
  after_model_profile_key TEXT,
  revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
