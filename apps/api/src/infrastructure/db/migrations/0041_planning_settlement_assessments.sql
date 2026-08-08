-- DEC-107 P12: keep plan-versus-actual assessment separate from canon-derived stage settlements.

CREATE TABLE planning_settlement_assessments (
  planning_settlement_assessment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  stage_kind TEXT NOT NULL CHECK (stage_kind IN ('event','volume')),
  stage_object_id TEXT NOT NULL,
  stage_settlement_id TEXT NOT NULL,
  plan_version_id TEXT NOT NULL,
  planned_json TEXT NOT NULL CHECK (json_valid(planned_json)),
  actual_json TEXT NOT NULL CHECK (json_valid(actual_json)),
  deviation_json TEXT NOT NULL CHECK (json_valid(deviation_json)),
  source_canon_revision INTEGER NOT NULL CHECK (source_canon_revision >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (stage_settlement_id) REFERENCES stage_settlements(stage_settlement_id),
  UNIQUE(owner_id,book_id,stage_settlement_id),
  UNIQUE(owner_id,book_id,stage_kind,stage_object_id,stage_settlement_id)
) STRICT;

CREATE INDEX planning_settlement_assessments_stage_idx
  ON planning_settlement_assessments(owner_id,book_id,stage_kind,stage_object_id,created_at DESC);
