CREATE TABLE IF NOT EXISTS book_profile_versions (
  profile_version_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  book_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  profile jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, book_id, version),
  FOREIGN KEY (owner_id, book_id) REFERENCES bookshelf_books(owner_id, book_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS book_profile_versions_latest_idx
  ON book_profile_versions (owner_id, book_id, version DESC);

GRANT SELECT, INSERT ON TABLE book_profile_versions TO "wenmi_rebuild_app";
