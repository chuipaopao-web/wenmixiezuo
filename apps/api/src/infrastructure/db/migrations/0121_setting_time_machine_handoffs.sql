CREATE TABLE setting_time_machine_handoffs (
 owner_id TEXT NOT NULL, book_id TEXT NOT NULL, source_version TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','dispatched','obsolete','failed')),
 run_id TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,book_id,source_version),
 FOREIGN KEY(owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;
CREATE INDEX setting_time_machine_handoffs_pending ON setting_time_machine_handoffs(state,created_at);
