-- DR-20260820-layered-design-contract-v1: stable author-facing thread keys for planned/actual lifecycle links.
ALTER TABLE story_thread_records ADD COLUMN thread_key TEXT;
CREATE UNIQUE INDEX story_thread_key_idx
  ON story_thread_records(owner_id,book_id,thread_key)
  WHERE thread_key IS NOT NULL;