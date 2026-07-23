ALTER TABLE positioning_drafts
ADD COLUMN opening_blueprint_json TEXT NOT NULL DEFAULT '{}'
CHECK (json_valid(opening_blueprint_json));

CREATE TABLE book_opening_blueprints (
  opening_blueprint_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  taxonomy_version TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('male', 'female')),
  category_key TEXT NOT NULL,
  category_name TEXT NOT NULL,
  blueprint_json TEXT NOT NULL CHECK (json_valid(blueprint_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE UNIQUE INDEX book_opening_blueprints_active_idx
ON book_opening_blueprints(owner_id, book_id)
WHERE status = 'active';
