ALTER TABLE setting_outline_workspace ADD COLUMN content_text TEXT;
ALTER TABLE setting_outline_workspace ADD COLUMN source_discussion_id TEXT;
ALTER TABLE setting_outline_workspace ADD COLUMN source_decision_id TEXT;
ALTER TABLE setting_outline_workspace ADD COLUMN candidate_at TEXT;
ALTER TABLE setting_outline_workspace ADD COLUMN confirmed_at TEXT;

CREATE INDEX idx_setting_outline_workspace_discussion
  ON setting_outline_workspace (owner_id, book_id, source_discussion_id);
