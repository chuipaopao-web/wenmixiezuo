-- Current author attachments belong to workflow objects rather than message sessions.
-- Rename in place so every existing attachment and its historical provenance is preserved.

ALTER TABLE chat_attachments RENAME TO author_attachments;
ALTER TABLE author_attachments RENAME COLUMN message_id TO origin_record_id;
ALTER TABLE author_attachments RENAME COLUMN attached_at TO origin_attached_at;

DROP INDEX chat_attachments_scope_status_idx;
DROP INDEX chat_attachments_message_idx;

CREATE INDEX author_attachments_scope_status_idx
  ON author_attachments(owner_id, book_id, parse_status, created_at);

CREATE INDEX author_attachments_origin_idx
  ON author_attachments(owner_id, book_id, origin_record_id);

UPDATE author_planning_input_links
SET target_type = 'author_attachment'
WHERE link_type = 'attachment' AND target_type = 'chat_attachment';