-- design_review_id: DR-V7-PLANNING-EDITORIAL-RUNTIME-20260826-35
-- 作者对规划维护建议的幂等决定。接受只成为下一轮候选规划的目标来源，不直接改写确认树。

CREATE TABLE v7_planning_adjustment_decisions (
  decision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  suggestion_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  decision TEXT NOT NULL CHECK (decision IN ('accept','dismiss')),
  author_note TEXT NOT NULL DEFAULT '' CHECK (length(author_note) <= 2000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (suggestion_id) REFERENCES v7_planning_adjustment_suggestions(suggestion_id),
  UNIQUE (owner_id, book_id, suggestion_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;

CREATE INDEX v7_planning_adjustment_decisions_scope_idx
  ON v7_planning_adjustment_decisions(owner_id, book_id, created_at DESC);
