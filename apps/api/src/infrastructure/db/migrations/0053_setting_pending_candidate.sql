ALTER TABLE setting_outline_workspace ADD COLUMN pending_candidate_text TEXT;
ALTER TABLE setting_outline_workspace ADD COLUMN pending_candidate_at TEXT;
ALTER TABLE setting_outline_workspace ADD COLUMN pending_source_discussion_id TEXT;
ALTER TABLE setting_outline_workspace ADD COLUMN pending_source_decision_id TEXT;

CREATE INDEX idx_setting_outline_workspace_pending_discussion
  ON setting_outline_workspace (owner_id, book_id, pending_source_discussion_id);
