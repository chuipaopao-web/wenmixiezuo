CREATE TABLE book_synopsis_versions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
 request_key TEXT NOT NULL, input_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('working','candidate','saved','failed')),
 text TEXT NOT NULL DEFAULT '', source_adoption TEXT, source_profile INTEGER NOT NULL,
 expected_saved TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(owner_id,book_id,request_key),
 FOREIGN KEY(owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;
CREATE INDEX book_synopsis_scope ON book_synopsis_versions(owner_id,book_id,created_at);
