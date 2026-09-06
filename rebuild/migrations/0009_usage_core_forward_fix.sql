DROP INDEX IF EXISTS usage_reservations_owner_external_call_idx;

CREATE UNIQUE INDEX IF NOT EXISTS usage_reservations_provider_external_call_idx
  ON usage_reservations (provider, external_call_id)
  WHERE provider IS NOT NULL AND external_call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS usage_reservations_owner_operation_idx
  ON usage_reservations (owner_id, operation_kind, operation_id);

ALTER TABLE usage_reservations ADD CONSTRAINT usage_reservations_book_scope_check
  CHECK ((operation_kind = 'prebook_opening' AND book_id IS NULL)
    OR (operation_kind = 'book_workflow' AND book_id IS NOT NULL));

ALTER TABLE usage_reservations ADD CONSTRAINT usage_reservations_call_scope_check
  CHECK (external_call_id IS NULL OR provider IS NOT NULL);

ALTER TABLE usage_reservation_events
  DROP CONSTRAINT IF EXISTS usage_reservation_events_payload_check;

ALTER TABLE usage_reservation_events
  ADD CONSTRAINT usage_reservation_events_payload_check
  CHECK (payload::text !~* '"(password|cookie|token|secret|database_url|authorization)"[[:space:]]*:');

GRANT SELECT, INSERT ON TABLE usage_entitlement_snapshots TO "wenmi_rebuild_app";
GRANT SELECT, INSERT, UPDATE ON TABLE usage_reservations TO "wenmi_rebuild_app";
GRANT SELECT, INSERT ON TABLE usage_reservation_events TO "wenmi_rebuild_app";
