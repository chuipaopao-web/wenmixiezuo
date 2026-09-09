CREATE TABLE tm2_design_runs (
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,book_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('recommend','design')),
 request_key TEXT NOT NULL,input_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','working','failed','succeeded')),
 result_json TEXT,error_code TEXT,error_message TEXT,phase TEXT NOT NULL DEFAULT 'queued',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(owner_id,book_id,kind,request_key),FOREIGN KEY(owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;
CREATE INDEX tm2_design_runs_queue ON tm2_design_runs(state,created_at);
CREATE TABLE tm2_context_cards(owner TEXT NOT NULL,book TEXT NOT NULL,source_key TEXT NOT NULL,fields_json TEXT NOT NULL,PRIMARY KEY(owner,book,source_key),FOREIGN KEY(owner,book) REFERENCES tm2_books(owner,book)) STRICT;
