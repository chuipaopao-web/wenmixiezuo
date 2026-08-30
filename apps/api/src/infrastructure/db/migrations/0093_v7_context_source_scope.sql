-- 0091 freezes source rows. Temporarily remove only the UPDATE guard while
-- backfilling the new scope columns, then restore the same immutable boundary.
DROP TRIGGER IF EXISTS v7_context_source_traces_no_update;

ALTER TABLE v7_context_source_traces ADD COLUMN owner_id TEXT;
ALTER TABLE v7_context_source_traces ADD COLUMN book_id TEXT;

UPDATE v7_context_source_traces
SET owner_id = (
      SELECT owner_id FROM v7_context_pack_traces
      WHERE v7_context_pack_traces.context_pack_id = v7_context_source_traces.context_pack_id
    ),
    book_id = (
      SELECT book_id FROM v7_context_pack_traces
      WHERE v7_context_pack_traces.context_pack_id = v7_context_source_traces.context_pack_id
    );

CREATE INDEX v7_context_source_scope_lookup_idx
  ON v7_context_source_traces(owner_id,book_id,source_type,source_id,source_version);

CREATE TRIGGER v7_context_source_traces_scope_insert
BEFORE INSERT ON v7_context_source_traces
WHEN NEW.owner_id IS NULL OR NEW.book_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM v7_context_pack_traces p
  WHERE p.context_pack_id=NEW.context_pack_id
    AND p.owner_id=NEW.owner_id
    AND p.book_id=NEW.book_id
)
BEGIN
  SELECT RAISE(ABORT,'V7 context source scope mismatch');
END;

CREATE TRIGGER v7_context_source_traces_scope_immutable
BEFORE UPDATE OF owner_id,book_id ON v7_context_source_traces
BEGIN
  SELECT RAISE(ABORT,'V7 context source scope is immutable');
END;

CREATE TRIGGER v7_context_source_traces_no_update
BEFORE UPDATE ON v7_context_source_traces
BEGIN
  SELECT RAISE(ABORT,'V7 context source trace is immutable');
END;
