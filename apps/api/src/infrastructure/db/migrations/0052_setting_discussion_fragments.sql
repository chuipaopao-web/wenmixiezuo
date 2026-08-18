-- 批5：设定类目讨论的碎片化结构。
-- 三席提案（编剧A强冲突、编剧B重因果、设定规则严谨）除了方案正文，
-- 还必须给出好处、代价和可勾选碎片；作者按碎片勾选后，主编融合稿
-- 逐段标注来源（fragment=作者勾选碎片，stitch=主编补写的衔接）。
-- setting_proposal_fragments：每份提案的可勾选碎片，解析失败时以整份方案
--   作为 single 兜底碎片并标记 implicit=1，绝不伪装成结构化成功。
-- setting_fusion_drafts：主编融合稿的段级来源标记与勾选快照；同一任务只留一份。

CREATE TABLE setting_proposal_fragments (
  fragment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  role_key TEXT,
  fragment_no INTEGER NOT NULL,
  fragment_text TEXT NOT NULL,
  implicit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, proposal_id, fragment_no)
) STRICT;

CREATE INDEX setting_proposal_fragments_item_idx
  ON setting_proposal_fragments(owner_id, book_id, item_key, discussion_id);

CREATE TABLE setting_fusion_drafts (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  selected_fragment_ids_json TEXT NOT NULL,
  segments_json TEXT NOT NULL,
  content_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id, item_key, task_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX setting_fusion_drafts_item_idx
  ON setting_fusion_drafts(owner_id, book_id, item_key, created_at);
