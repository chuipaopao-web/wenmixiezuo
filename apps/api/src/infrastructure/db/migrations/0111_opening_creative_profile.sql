ALTER TABLE v7_opening_agent_tasks ADD COLUMN creative_profile_json TEXT;
CREATE TABLE book_creative_profiles (
 owner_id TEXT NOT NULL,
 book_id TEXT NOT NULL,
 profile_json TEXT NOT NULL,
 source_task_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,book_id),
 FOREIGN KEY(book_id) REFERENCES books(book_id) ON DELETE CASCADE
);
