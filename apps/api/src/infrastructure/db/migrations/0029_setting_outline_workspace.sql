CREATE TABLE setting_outline_workspace (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  group_title TEXT NOT NULL,
  label TEXT NOT NULL,
  prompt TEXT NOT NULL,
  source_label TEXT NOT NULL,
  item_status TEXT NOT NULL CHECK (item_status IN (
    '待讨论', '讨论中', '候选待确认', '已确认', '稍后补充', '刻意留白', '不适用'
  )),
  is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id, item_key),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_setting_outline_workspace_book
  ON setting_outline_workspace (owner_id, book_id, is_custom, sort_order, item_key);
