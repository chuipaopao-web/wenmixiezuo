ALTER TABLE manuscript_versions ADD COLUMN creator_kind TEXT NOT NULL DEFAULT 'agent'
  CHECK (creator_kind IN ('agent', 'owner', 'import'));
ALTER TABLE manuscript_versions ADD COLUMN edit_note TEXT;

CREATE TABLE protagonist_profiles (
  protagonist_profile_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  entity_id TEXT,
  display_name TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (entity_id) REFERENCES entities(entity_id),
  UNIQUE(owner_id, book_id, display_name)
) STRICT;

CREATE UNIQUE INDEX protagonist_profiles_primary_idx
  ON protagonist_profiles(owner_id, book_id) WHERE is_primary = 1 AND status = 'active';
CREATE INDEX protagonist_profiles_scope_idx
  ON protagonist_profiles(owner_id, book_id, status, updated_at);

CREATE TABLE protagonist_state_entries (
  protagonist_state_entry_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  protagonist_profile_id TEXT NOT NULL,
  category TEXT NOT NULL,
  logical_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number', 'text', 'enum', 'list', 'resource', 'derived')),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  unit TEXT,
  state_status TEXT NOT NULL CHECK (state_status IN ('active', 'consumed', 'lost', 'dead', 'retired', 'archived')),
  authority_layer TEXT NOT NULL CHECK (authority_layer IN ('candidate', 'canon', 'derived')),
  effective_chapter_number INTEGER CHECK (effective_chapter_number IS NULL OR effective_chapter_number >= 1),
  story_time TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('owner', 'canon_fact', 'formula', 'import')),
  source_id TEXT,
  source_fact_id TEXT,
  source_manuscript_version_id TEXT,
  canon_revision INTEGER NOT NULL DEFAULT 0 CHECK (canon_revision >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  previous_entry_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (protagonist_profile_id) REFERENCES protagonist_profiles(protagonist_profile_id),
  FOREIGN KEY (source_fact_id) REFERENCES fact_assertions(fact_id),
  FOREIGN KEY (source_manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  FOREIGN KEY (previous_entry_id) REFERENCES protagonist_state_entries(protagonist_state_entry_id),
  UNIQUE(owner_id, book_id, protagonist_profile_id, logical_key, revision)
) STRICT;

CREATE INDEX protagonist_state_current_idx
  ON protagonist_state_entries(owner_id, book_id, protagonist_profile_id, logical_key, revision DESC);
CREATE INDEX protagonist_state_category_idx
  ON protagonist_state_entries(owner_id, book_id, protagonist_profile_id, category, authority_layer, state_status);

CREATE TABLE attribute_formulas (
  attribute_formula_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  formula_key TEXT NOT NULL,
  label TEXT NOT NULL,
  expression TEXT NOT NULL,
  variables_json TEXT NOT NULL CHECK (json_valid(variables_json)),
  unit TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived')),
  source_artifact_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (source_artifact_version_id) REFERENCES artifact_versions(artifact_version_id),
  UNIQUE(owner_id, book_id, formula_key, version)
) STRICT;

CREATE UNIQUE INDEX attribute_formulas_active_idx
  ON attribute_formulas(owner_id, book_id, formula_key) WHERE status = 'active';
CREATE INDEX attribute_formulas_scope_idx
  ON attribute_formulas(owner_id, book_id, status, formula_key, version DESC);
