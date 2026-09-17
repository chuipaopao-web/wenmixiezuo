-- 625cc3f7集中复核③：审查回查轨迹与证据持久化。
-- 每次read_source记录来源key+revision+offset+length+内容hash；“相同候选”不再冒充“相同完整输入”，
-- verdict归因按持久化轨迹逐项对照；证据缺失标待补查，不无证据判过/判失败。

CREATE TABLE tm2_review_reads(
  owner TEXT NOT NULL,
  book TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node TEXT NOT NULL,
  seq INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  offset INTEGER NOT NULL CHECK(offset>=0),
  length INTEGER NOT NULL CHECK(length>=0),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner,book,run_id,node,seq)
) STRICT;
CREATE INDEX tm2_review_reads_run ON tm2_review_reads(run_id,node);
