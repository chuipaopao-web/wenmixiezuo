-- DEC-107: author ideas live beside workflow objects without becoming canon.

CREATE TABLE author_planning_inputs (
  author_input_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('book_profile', 'setting', 'volume_plan', 'event', 'chapter_outline', 'manuscript')),
  subject_type TEXT NOT NULL CHECK (length(trim(subject_type)) > 0),
  subject_id TEXT,
  intent_strength TEXT NOT NULL CHECK (intent_strength IN ('must', 'preference', 'inspiration', 'question')),
  original_text TEXT NOT NULL CHECK (length(trim(original_text)) > 0),
  original_text_hash TEXT NOT NULL CHECK (length(original_text_hash) = 64),
  scope_notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'adopted', 'adapted', 'parked', 'rejected', 'superseded', 'withdrawn')),
  handling_reason TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, author_input_id),
  UNIQUE(owner_id, book_id, idempotency_key)
) STRICT;

CREATE INDEX author_planning_inputs_subject_idx
  ON author_planning_inputs(owner_id, book_id, surface, subject_type, subject_id, created_at);

CREATE INDEX author_planning_inputs_status_idx
  ON author_planning_inputs(owner_id, book_id, status, updated_at);

CREATE TABLE author_planning_input_decisions (
  decision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  author_input_id TEXT NOT NULL,
  from_status TEXT NOT NULL CHECK (from_status IN ('new', 'adopted', 'adapted', 'parked', 'rejected', 'superseded', 'withdrawn')),
  to_status TEXT NOT NULL CHECK (to_status IN ('adopted', 'adapted', 'parked', 'rejected', 'withdrawn')),
  handling_reason TEXT NOT NULL CHECK (length(trim(handling_reason)) > 0),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id, author_input_id)
    REFERENCES author_planning_inputs(owner_id, book_id, author_input_id),
  UNIQUE(owner_id, book_id, idempotency_key)
) STRICT;

CREATE INDEX author_planning_input_decisions_input_idx
  ON author_planning_input_decisions(owner_id, book_id, author_input_id, created_at);

CREATE TABLE author_planning_input_links (
  link_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  author_input_id TEXT NOT NULL,
  decision_id TEXT,
  link_type TEXT NOT NULL CHECK (link_type IN ('attachment', 'mention', 'application', 'supersedes')),
  target_type TEXT NOT NULL CHECK (length(trim(target_type)) > 0),
  target_id TEXT NOT NULL CHECK (length(trim(target_id)) > 0),
  target_version INTEGER CHECK (target_version IS NULL OR target_version >= 0),
  target_hash TEXT CHECK (target_hash IS NULL OR length(target_hash) = 64 OR target_hash LIKE 'sha256:%'),
  relation TEXT NOT NULL CHECK (relation IN ('attached', 'mentioned', 'adopted', 'adapted', 'supersedes')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id, author_input_id)
    REFERENCES author_planning_inputs(owner_id, book_id, author_input_id),
  FOREIGN KEY (decision_id) REFERENCES author_planning_input_decisions(decision_id),
  UNIQUE(owner_id, book_id, author_input_id, link_type, target_type, target_id, target_version)
) STRICT;

CREATE INDEX author_planning_input_links_target_idx
  ON author_planning_input_links(owner_id, book_id, link_type, target_type, target_id);
