CREATE TABLE chat_attachments (
  attachment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  message_id TEXT,
  original_name TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'text', 'pdf', 'docx')),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 20971520),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  source_relative_path TEXT NOT NULL UNIQUE,
  extracted_relative_path TEXT,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed', 'truncated', 'preview_only', 'no_text', 'failed', 'discarded')),
  parsed_char_count INTEGER NOT NULL DEFAULT 0 CHECK (parsed_char_count >= 0),
  context_excerpt TEXT NOT NULL DEFAULT '',
  parse_error TEXT,
  lifecycle_layer TEXT NOT NULL DEFAULT 'temporary' CHECK (lifecycle_layer = 'temporary'),
  created_at TEXT NOT NULL,
  attached_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (message_id) REFERENCES messages(message_id)
) STRICT;

CREATE INDEX chat_attachments_scope_status_idx
  ON chat_attachments(owner_id, book_id, parse_status, created_at);

CREATE INDEX chat_attachments_message_idx
  ON chat_attachments(owner_id, book_id, message_id);
