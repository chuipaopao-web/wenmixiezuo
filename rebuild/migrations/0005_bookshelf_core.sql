CREATE TABLE IF NOT EXISTS bookshelf_books (
  book_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES account_users(owner_id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  engine text NOT NULL CHECK (engine = 'rebuild'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  idempotency_input_hash text NOT NULL CHECK (length(idempotency_input_hash) = 64),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS bookshelf_books_owner_status_created_idx
  ON bookshelf_books (owner_id, status, created_at DESC, book_id DESC);

CREATE INDEX IF NOT EXISTS bookshelf_books_owner_created_idx
  ON bookshelf_books (owner_id, created_at DESC, book_id DESC);

CREATE TABLE IF NOT EXISTS bookshelf_book_audit_events (
  audit_id uuid PRIMARY KEY,
  book_id uuid REFERENCES bookshelf_books(book_id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL,
  actor_user_id uuid REFERENCES account_users(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  result text NOT NULL CHECK (result IN ('succeeded', 'failed', 'rejected')),
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (detail::text !~* '(password|cookie|token|secret|database_url|authorization)')
);

CREATE INDEX IF NOT EXISTS bookshelf_book_audit_owner_time_idx
  ON bookshelf_book_audit_events (owner_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS bookshelf_book_audit_book_time_idx
  ON bookshelf_book_audit_events (book_id, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE ON TABLE bookshelf_books TO "wenmi_rebuild_app";
GRANT SELECT, INSERT ON TABLE bookshelf_book_audit_events TO "wenmi_rebuild_app";
