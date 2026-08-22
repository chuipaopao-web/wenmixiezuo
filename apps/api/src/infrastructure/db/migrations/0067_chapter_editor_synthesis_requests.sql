CREATE TABLE chapter_editor_synthesis_requests (
  chapter_editor_synthesis_request_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  review_panel_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (review_panel_id) REFERENCES review_panels(review_panel_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  UNIQUE(owner_id, book_id, review_panel_id)
) STRICT;

CREATE INDEX chapter_editor_synthesis_requests_chapter_idx
  ON chapter_editor_synthesis_requests(owner_id, book_id, chapter_id, requested_at);
