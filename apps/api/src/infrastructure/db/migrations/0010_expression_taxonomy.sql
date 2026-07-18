CREATE TABLE book_onboarding_profiles (
  onboarding_profile_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  genre TEXT,
  classification TEXT,
  target_audience TEXT,
  expected_scale_chars INTEGER CHECK (expected_scale_chars IS NULL OR expected_scale_chars BETWEEN 1000 AND 10000000),
  initial_expression_baseline TEXT,
  field_sources_json TEXT NOT NULL CHECK (json_valid(field_sources_json)),
  status TEXT NOT NULL CHECK (status IN ('provisional', 'confirmed', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE TABLE book_expression_profiles (
  expression_profile_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  narrative_person TEXT CHECK (narrative_person IS NULL OR narrative_person IN ('first', 'third', 'mixed')),
  viewpoint_distance TEXT CHECK (viewpoint_distance IS NULL OR viewpoint_distance IN ('close', 'medium', 'distant', 'adaptive')),
  language_tone_json TEXT NOT NULL CHECK (json_valid(language_tone_json)),
  text_density TEXT CHECK (text_density IS NULL OR text_density IN ('light', 'balanced', 'dense', 'adaptive')),
  target_audience TEXT,
  content_boundaries_json TEXT NOT NULL CHECK (json_valid(content_boundaries_json)),
  humor_seriousness TEXT CHECK (humor_seriousness IS NULL OR humor_seriousness IN ('humorous', 'balanced', 'serious', 'adaptive')),
  voice_evidence_json TEXT NOT NULL CHECK (json_valid(voice_evidence_json)),
  impact_scope_json TEXT NOT NULL CHECK (json_valid(impact_scope_json)),
  status TEXT NOT NULL CHECK (status IN ('provisional', 'confirmed', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE UNIQUE INDEX book_expression_profiles_active_idx
ON book_expression_profiles(owner_id, book_id)
WHERE status IN ('provisional', 'confirmed');

CREATE TABLE technique_cards (
  technique_card_id TEXT PRIMARY KEY,
  technique_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  display_name TEXT NOT NULL,
  narrative_goals_json TEXT NOT NULL CHECK (json_valid(narrative_goals_json)),
  optional_methods_json TEXT NOT NULL CHECK (json_valid(optional_methods_json)),
  risks_json TEXT NOT NULL CHECK (json_valid(risks_json)),
  counterexamples_json TEXT NOT NULL CHECK (json_valid(counterexamples_json)),
  mechanization_warning TEXT NOT NULL,
  copyright_isolation_status TEXT NOT NULL CHECK (copyright_isolation_status IN ('cleared', 'restricted', 'unknown')),
  applicability_json TEXT NOT NULL CHECK (json_valid(applicability_json)),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  UNIQUE(technique_key, version)
) STRICT;

CREATE TABLE entity_schemas (
  entity_schema_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  entity_type_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  fields_json TEXT NOT NULL CHECK (json_valid(fields_json)),
  applicability_json TEXT NOT NULL CHECK (json_valid(applicability_json)),
  created_source TEXT NOT NULL CHECK (created_source IN ('system', 'chief_editor', 'boss')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'deprecated', 'merged', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, entity_type_key, version)
) STRICT;

CREATE TABLE tag_definitions (
  tag_definition_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  applies_to_json TEXT NOT NULL CHECK (json_valid(applies_to_json)),
  color TEXT,
  icon TEXT,
  created_source TEXT NOT NULL CHECK (created_source IN ('system', 'chief_editor', 'boss')),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'deprecated', 'merged', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, namespace, name, version),
  UNIQUE(owner_id, book_id, tag_definition_id)
) STRICT;

CREATE UNIQUE INDEX tag_definitions_active_name_idx
ON tag_definitions(owner_id, book_id, namespace, name)
WHERE status IN ('proposed', 'active');

CREATE TABLE tag_aliases (
  tag_alias_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tag_definition_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('synonym', 'abbreviation', 'historical')),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (owner_id, book_id, tag_definition_id) REFERENCES tag_definitions(owner_id, book_id, tag_definition_id),
  UNIQUE(owner_id, book_id, alias)
) STRICT;

CREATE TABLE tag_assignments (
  tag_assignment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  tag_definition_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  authority_layer TEXT NOT NULL CHECK (authority_layer IN ('temporary', 'candidate', 'canon', 'derived')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'superseded')),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (owner_id, book_id, tag_definition_id) REFERENCES tag_definitions(owner_id, book_id, tag_definition_id),
  UNIQUE(owner_id, book_id, tag_definition_id, target_type, target_id, version)
) STRICT;

CREATE INDEX tag_assignments_target_idx
ON tag_assignments(owner_id, book_id, target_type, target_id, status);

CREATE TABLE semantic_annotations (
  semantic_annotation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  annotation_type TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0.0 AND 1.0),
  authority_layer TEXT NOT NULL CHECK (authority_layer IN ('temporary', 'candidate', 'canon', 'derived')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'rejected', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX semantic_annotations_target_idx
ON semantic_annotations(owner_id, book_id, target_type, target_id, status);

CREATE TABLE knowledge_gap_findings (
  knowledge_gap_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  narrative_goal TEXT,
  gap_type TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('blocking', 'important', 'optional', 'observation')),
  intentional_unknown INTEGER NOT NULL DEFAULT 0 CHECK (intentional_unknown IN (0, 1)),
  source_task_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'accepted_unknown', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id)
) STRICT;

CREATE INDEX knowledge_gap_findings_scope_idx
ON knowledge_gap_findings(owner_id, book_id, status, severity);
