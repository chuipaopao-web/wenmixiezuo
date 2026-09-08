-- Preserve account usage when an explicitly authorized book purge removes task data.
-- No author prose or context is stored here; original source IDs/times remain auditable.
CREATE TABLE account_usage_purge_archive (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  book_id TEXT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  source_state TEXT NOT NULL,
  usage_state TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  consumed_tokens INTEGER NOT NULL,
  reserved_tokens INTEGER NOT NULL,
  cash_micros INTEGER NOT NULL,
  consumed_units INTEGER NOT NULL,
  reserved_units INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  completed_at TEXT,
  purge_operation_id TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  PRIMARY KEY(source_kind, source_id)
) STRICT;
CREATE INDEX account_usage_purge_archive_owner_time_idx
  ON account_usage_purge_archive(owner_id, recorded_at);

CREATE VIEW account_usage_live_projection AS
SELECT
  source_kind,
  source_id,
  owner_id,
  book_id,
  provider,
  model_id,
  state AS source_state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state IN ('working','unknown') THEN 'reserved'
       ELSE 'failed' END AS usage_state,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) ELSE 0 END AS input_tokens,
  CASE WHEN state = 'succeeded' THEN COALESCE(output_tokens, 0) ELSE 0 END AS output_tokens,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) ELSE 0 END AS consumed_tokens,
  CASE WHEN state IN ('working','unknown') THEN reserved_tokens ELSE 0 END AS reserved_tokens,
  CASE WHEN state = 'succeeded' THEN COALESCE(cash_micros, 0) ELSE 0 END AS cash_micros,
  CASE WHEN state = 'succeeded' THEN consumed_units ELSE 0 END AS consumed_units,
  CASE WHEN state IN ('working','unknown') THEN reserved_units ELSE 0 END AS reserved_units,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, started_at) ELSE started_at END AS recorded_at,
  completed_at
FROM account_usage_supplemental_calls

UNION ALL

SELECT
  'usage_ledger',
  CAST(usage_id AS TEXT),
  owner_id,
  book_id,
  provider,
  model_id,
  'succeeded',
  'consumed',
  input_tokens,
  output_tokens,
  input_tokens + output_tokens,
  0,
  cash_micros,
  0,
  0,
  recorded_at,
  recorded_at
FROM usage_ledger

UNION ALL

SELECT
  'prebook_opening',
  call_id,
  owner_id,
  NULL,
  provider,
  model_id,
  state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state IN ('working','interrupted') THEN 'reserved'
       ELSE 'failed' END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state IN ('working','interrupted') THEN reserved_tokens ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(cash_micros, 0) ELSE 0 END,
  0,
  0,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, started_at) ELSE started_at END,
  completed_at
FROM prebook_opening_design_calls

UNION ALL

SELECT
  'v7_opening',
  request_id,
  owner_id,
  NULL,
  provider,
  model_id,
  state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state IN ('working','unknown') THEN 'reserved'
       ELSE 'failed' END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state IN ('working','unknown') THEN reserved_tokens ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(cash_micros, 0) ELSE 0 END,
  0,
  0,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, started_at) ELSE started_at END,
  completed_at
FROM v7_opening_agent_model_calls

UNION ALL

SELECT
  'v7_setting',
  request_id,
  owner_id,
  book_id,
  provider,
  model_id,
  state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state IN ('working','unknown') THEN 'reserved'
       ELSE 'failed' END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state IN ('working','unknown') THEN reserved_tokens ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(cash_micros, 0) ELSE 0 END,
  0,
  0,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, started_at) ELSE started_at END,
  completed_at
FROM v7_setting_model_calls

UNION ALL

SELECT
  'v7_title',
  design_id,
  owner_id,
  book_id,
  COALESCE(provider, 'unknown'),
  COALESCE(model_id, 'unknown'),
  state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state = 'working' THEN 'reserved'
       ELSE 'failed' END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) ELSE 0 END,
  0,
  CASE WHEN state = 'succeeded' THEN COALESCE(cash_micros, 0) ELSE 0 END,
  0,
  0,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, created_at) ELSE created_at END,
  completed_at
FROM v7_book_title_design_calls native_title
WHERE NOT EXISTS (
  SELECT 1 FROM account_usage_supplemental_calls supplemental
  WHERE supplemental.source_kind = 'v7_title' AND supplemental.source_id = native_title.design_id
)

UNION ALL

SELECT
  'v7_planning',
  request_id,
  owner_id,
  book_id,
  provider,
  model_id,
  state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state IN ('working','unknown') THEN 'reserved'
       ELSE 'failed' END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state IN ('working','unknown') THEN reserved_tokens ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(cash_micros, 0) ELSE 0 END,
  0,
  0,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, started_at) ELSE started_at END,
  completed_at
FROM v7_planning_model_calls

UNION ALL

SELECT
  'v7_character',
  request_id,
  owner_id,
  book_id,
  provider,
  model_id,
  state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state IN ('working','unknown') THEN 'reserved'
       ELSE 'failed' END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state IN ('working','unknown') THEN reserved_tokens ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(cash_micros, 0) ELSE 0 END,
  0,
  0,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, started_at) ELSE started_at END,
  completed_at
FROM v7_character_model_calls

UNION ALL

SELECT
  'v7_creation',
  request_id,
  owner_id,
  book_id,
  provider,
  model_id,
  state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state IN ('working','unknown') THEN 'reserved'
       ELSE 'failed' END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) ELSE 0 END,
  CASE WHEN state IN ('working','unknown') THEN reserved_tokens ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(cash_micros, 0) ELSE 0 END,
  0,
  0,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, started_at) ELSE started_at END,
  completed_at
FROM v7_creation_model_calls

UNION ALL

SELECT
  'v7_cover_image',
  design_id,
  owner_id,
  book_id,
  COALESCE(provider, 'volcengine-ark-image'),
  COALESCE(model_id, 'unknown'),
  state,
  CASE WHEN state = 'succeeded' THEN 'consumed'
       WHEN state = 'working' THEN 'reserved'
       ELSE 'failed' END,
  0,
  0,
  0,
  0,
  0,
  CASE WHEN state = 'succeeded' THEN 1 ELSE 0 END,
  CASE WHEN state = 'working' THEN 1 ELSE 0 END,
  CASE WHEN state = 'succeeded' THEN COALESCE(completed_at, created_at) ELSE created_at END,
  completed_at
FROM v7_book_cover_designs native_cover
WHERE NOT EXISTS (
  SELECT 1 FROM account_usage_supplemental_calls supplemental
  WHERE supplemental.source_kind = 'v7_cover_image' AND supplemental.source_id = native_cover.design_id
);

DROP VIEW account_usage_projection;
CREATE VIEW account_usage_projection AS
SELECT * FROM account_usage_live_projection
UNION ALL
SELECT source_kind, source_id, owner_id, book_id, provider, model_id,
  source_state, usage_state, input_tokens, output_tokens, consumed_tokens,
  reserved_tokens, cash_micros, consumed_units, reserved_units, recorded_at, completed_at
FROM account_usage_purge_archive;
