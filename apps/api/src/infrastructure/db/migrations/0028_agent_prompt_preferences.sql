CREATE TABLE agent_prompt_preferences (
  prompt_preference_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  content TEXT NOT NULL CHECK (length(content) <= 4000),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  UNIQUE(owner_id, book_id, agent_id, version)
) STRICT;

CREATE UNIQUE INDEX agent_prompt_preferences_active_idx
  ON agent_prompt_preferences(owner_id, book_id, agent_id)
  WHERE status = 'active';

CREATE INDEX agent_prompt_preferences_history_idx
  ON agent_prompt_preferences(owner_id, book_id, agent_id, version DESC);

ALTER TABLE model_calls ADD COLUMN prompt_preference_id TEXT
  REFERENCES agent_prompt_preferences(prompt_preference_id);
