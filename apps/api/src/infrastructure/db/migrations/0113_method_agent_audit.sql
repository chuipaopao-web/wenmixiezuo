-- Additive audit; original author content and billing stay unchanged.
CREATE TABLE v7_method_agent_events (
 owner_id TEXT NOT NULL, book_id TEXT NOT NULL, session_id TEXT NOT NULL,
 step INTEGER NOT NULL, run_id TEXT NOT NULL, member_key TEXT NOT NULL,
 layer TEXT NOT NULL, policy_version INTEGER NOT NULL,
 event_json TEXT NOT NULL CHECK(json_valid(event_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,book_id,session_id,step)
) STRICT;
CREATE INDEX v7_method_agent_recent ON v7_method_agent_events(created_at DESC);
