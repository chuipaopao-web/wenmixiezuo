ALTER TABLE tm2_design_runs ADD COLUMN scheme TEXT NOT NULL DEFAULT '';
ALTER TABLE tm2_design_runs ADD COLUMN round_key TEXT NOT NULL DEFAULT '';
CREATE INDEX tm2_design_runs_round ON tm2_design_runs(owner_id,book_id,round_key,scheme);
