CREATE UNIQUE INDEX IF NOT EXISTS bookshelf_books_owner_book_unique
  ON bookshelf_books (owner_id, book_id);

CREATE TABLE IF NOT EXISTS manual_book_opening_sources (
  source_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  book_id uuid NOT NULL,
  source_version integer NOT NULL DEFAULT 1 CHECK (source_version = 1),
  source_type text NOT NULL DEFAULT 'manual_opening_package' CHECK (source_type = 'manual_opening_package'),
  opening_idea text CHECK (opening_idea IS NULL OR char_length(opening_idea) <= 5000),
  opening_package jsonb NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, book_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES bookshelf_books(owner_id, book_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS manual_book_chapter_directories (
  directory_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  book_id uuid NOT NULL,
  directory_version integer NOT NULL DEFAULT 1 CHECK (directory_version = 1),
  entry_count integer NOT NULL DEFAULT 0 CHECK (entry_count = 0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, book_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES bookshelf_books(owner_id, book_id) ON DELETE RESTRICT
);

GRANT SELECT, INSERT ON TABLE manual_book_opening_sources TO "wenmi_rebuild_app";
GRANT SELECT, INSERT ON TABLE manual_book_chapter_directories TO "wenmi_rebuild_app";
