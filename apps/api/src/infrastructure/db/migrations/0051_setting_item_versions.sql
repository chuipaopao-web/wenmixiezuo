-- 批4：设定项版本链。
-- 设定页重构为核心六项（故事内核、世界舞台、主角处境、对立面、规矩与代价、边界与留白）
-- 加题材建议包与完整类目库之后，每个设定项每次被确认都生成一条不可变版本，
-- 旧版本保留用于回溯与对比；当前生效内容仍以 setting_outline_workspace 的行为准。
-- source_kind 记录确认来源：manual（作者直接确认）、guidance（逐项引导确认）、
-- discussion（专项或成组讨论确认）。

CREATE TABLE setting_outline_item_versions (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'guidance', 'discussion')),
  source_discussion_id TEXT,
  source_decision_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id, item_key, version_no),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX setting_outline_item_versions_book_idx
  ON setting_outline_item_versions(owner_id, book_id, item_key);
