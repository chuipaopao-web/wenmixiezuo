CREATE TABLE tm2_model_calls (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
 member_id TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL,
 request_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('working','succeeded','failed','unknown')),
 reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>0), input_tokens INTEGER, output_tokens INTEGER,
 cash_micros INTEGER, output_text TEXT, error_class TEXT, started_at TEXT NOT NULL, completed_at TEXT,
 FOREIGN KEY(owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;
CREATE INDEX tm2_model_calls_scope ON tm2_model_calls(owner_id,book_id,started_at);
