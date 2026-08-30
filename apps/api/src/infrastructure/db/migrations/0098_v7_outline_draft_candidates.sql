-- 多份章纲方案先保存在独立候选区。作者选定且通过审查的方案才进入
-- v7_chapter_outline_sequences，原有“每条链一份正式候选/一份正式稿”门禁保持不变。
CREATE TABLE v7_chapter_outline_draft_candidates (
  candidate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  chain_scope_id TEXT NOT NULL,
  seat_key TEXT NOT NULL CHECK (seat_key IN ('option_1','option_2','option_3')),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('candidate','selected','superseded')),
  context_pack_id TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  request_id TEXT NOT NULL,
  review_json TEXT CHECK (review_json IS NULL OR json_valid(review_json)),
  review_member_key TEXT,
  review_member_snapshot_json TEXT CHECK (review_member_snapshot_json IS NULL OR json_valid(review_member_snapshot_json)),
  review_request_id TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  selected_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id),
  FOREIGN KEY (context_pack_id) REFERENCES v7_creation_context_packs(context_pack_id)
) STRICT;

CREATE UNIQUE INDEX v7_outline_draft_one_active_seat_idx
  ON v7_chapter_outline_draft_candidates(owner_id,book_id,workflow_id,chain_scope_id,seat_key)
  WHERE lifecycle='candidate';
CREATE UNIQUE INDEX v7_outline_draft_request_idx
  ON v7_chapter_outline_draft_candidates(owner_id,book_id,request_id);
CREATE INDEX v7_outline_draft_workflow_idx
  ON v7_chapter_outline_draft_candidates(owner_id,book_id,workflow_id,chain_scope_id,lifecycle,created_at);
