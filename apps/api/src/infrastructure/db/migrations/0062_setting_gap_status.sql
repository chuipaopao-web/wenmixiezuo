-- DR-20260820-layered-design-contract-v1: a discovered gap waits for the author before its stored fallback is applied.
ALTER TABLE setting_gap_decisions ADD COLUMN decision_status TEXT NOT NULL DEFAULT 'decided'
  CHECK (decision_status IN ('pending','needs_setting','decided'));
ALTER TABLE setting_gap_decisions ADD COLUMN applied_at TEXT;