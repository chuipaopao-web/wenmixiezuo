CREATE TABLE setting_quality_reports (
  report_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT,
  content_hash TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'warn', 'fail')),
  summary_text TEXT NOT NULL,
  issues_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_setting_quality_reports_book
  ON setting_quality_reports (owner_id, book_id, created_at);
