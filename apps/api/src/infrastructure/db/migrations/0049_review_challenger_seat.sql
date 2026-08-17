-- 批2：审查第四席（挑剔读者）接入审查面板。
-- 11人旧书没有挑剔读者岗位时，challenger 两列保持 NULL，面板按三席运行；
-- 14人团队创建的新面板冻结第四席。

ALTER TABLE review_panels ADD COLUMN challenger_agent_id TEXT;
ALTER TABLE review_panels ADD COLUMN challenger_model_snapshot_id TEXT;

CREATE TABLE review_reports_0049 (
  review_report_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  review_panel_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('fact', 'literary', 'experience', 'challenger')),
  agent_id TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  report_json TEXT NOT NULL CHECK (json_valid(report_json)),
  report_hash TEXT NOT NULL CHECK (length(report_hash) = 64),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'invalid', 'superseded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (review_panel_id) REFERENCES review_panels(review_panel_id),
  UNIQUE(review_panel_id, reviewer_role)
) STRICT;

INSERT INTO review_reports_0049 SELECT * FROM review_reports;
DROP TABLE review_reports;
ALTER TABLE review_reports_0049 RENAME TO review_reports;
