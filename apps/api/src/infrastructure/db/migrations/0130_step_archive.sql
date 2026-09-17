-- 625cc3f7集中复核①：步骤版本重建的完整归档（禁止删除或前80字冒充归档）。
-- 输入版本变化的旧步骤行、全部attempt与输出完整引用保留，供审计与对照；重建走同id新版本。

CREATE TABLE tm2_step_archive(
  owner TEXT NOT NULL,
  book TEXT NOT NULL,
  id TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  row_json TEXT NOT NULL,
  attempts_json TEXT NOT NULL,
  output_json TEXT,
  PRIMARY KEY(owner,book,id,archived_at)
) STRICT;
CREATE INDEX tm2_step_archive_book ON tm2_step_archive(book,id);
