ALTER TABLE v7_chapter_outline_sequences ADD COLUMN review_json TEXT
  CHECK (review_json IS NULL OR json_valid(review_json));
ALTER TABLE v7_chapter_outline_sequences ADD COLUMN review_member_key TEXT;
ALTER TABLE v7_chapter_outline_sequences ADD COLUMN review_member_snapshot_json TEXT
  CHECK (review_member_snapshot_json IS NULL OR json_valid(review_member_snapshot_json));
ALTER TABLE v7_chapter_outline_sequences ADD COLUMN review_request_id TEXT;
ALTER TABLE v7_chapter_outline_sequences ADD COLUMN reviewed_at TEXT;

CREATE UNIQUE INDEX v7_chapter_outline_review_request_unique
  ON v7_chapter_outline_sequences(owner_id, book_id, review_request_id)
  WHERE review_request_id IS NOT NULL;
