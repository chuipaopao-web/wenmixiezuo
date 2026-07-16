CREATE TABLE narrative_projections (
  projection_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  projection_type TEXT NOT NULL CHECK (projection_type IN ('emotion', 'mainline', 'subplot', 'hook', 'information_gap')),
  track TEXT NOT NULL CHECK (track IN ('planned', 'actual')),
  chapter_number INTEGER NOT NULL CHECK (chapter_number >= 1),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  source_ids_json TEXT NOT NULL CHECK (json_valid(source_ids_json)),
  rebuilt_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, projection_type, track, chapter_number, canon_revision)
) STRICT;

CREATE TABLE copyright_sources (
  copyright_source_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  rights_path TEXT NOT NULL CHECK (rights_path IN ('research', 'quick_reference', 'cleanroom', 'authorized_adaptation')),
  authorization_json TEXT NOT NULL CHECK (json_valid(authorization_json)),
  raw_content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  isolation_status TEXT NOT NULL CHECK (isolation_status IN ('isolated', 'authorized')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE abstract_structure_cards (
  structure_card_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  copyright_source_id TEXT NOT NULL,
  abstraction_json TEXT NOT NULL CHECK (json_valid(abstraction_json)),
  prohibited_terms_json TEXT NOT NULL CHECK (json_valid(prohibited_terms_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (copyright_source_id) REFERENCES copyright_sources(copyright_source_id)
) STRICT;

CREATE TABLE cleanroom_packages (
  cleanroom_package_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  structure_card_id TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK (json_valid(context_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'invalidated')),
  created_at TEXT NOT NULL,
  invalidated_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (structure_card_id) REFERENCES abstract_structure_cards(structure_card_id)
) STRICT;

CREATE TABLE copyright_checks (
  copyright_check_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  copyright_source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_hash TEXT NOT NULL CHECK (length(target_hash) = 64),
  dimensions_json TEXT NOT NULL CHECK (json_valid(dimensions_json)),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'blocked')),
  decision TEXT NOT NULL CHECK (decision IN ('pass', 'redesign', 'authorized')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (copyright_source_id) REFERENCES copyright_sources(copyright_source_id)
) STRICT;

CREATE TABLE research_sources (
  research_source_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  publisher TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  region TEXT,
  language TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  credibility INTEGER NOT NULL CHECK (credibility BETWEEN 0 AND 100),
  source_status TEXT NOT NULL CHECK (source_status IN ('provided', 'cached', 'offline_unavailable')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE research_claims (
  research_claim_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  research_source_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  candidate_status TEXT NOT NULL CHECK (candidate_status IN ('candidate', 'accepted_for_planning', 'rejected')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (research_source_id) REFERENCES research_sources(research_source_id)
) STRICT;

CREATE INDEX narrative_projection_scope_idx ON narrative_projections(owner_id, book_id, projection_type, track, chapter_number);
CREATE INDEX copyright_check_scope_idx ON copyright_checks(owner_id, book_id, risk_level, created_at);
CREATE INDEX research_source_scope_idx ON research_sources(owner_id, book_id, retrieved_at);
