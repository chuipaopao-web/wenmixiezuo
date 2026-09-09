-- Rebuildable projections only; original opening/settings and task snapshots stay immutable.
CREATE TABLE v7_book_design_cards (
 owner_id TEXT NOT NULL,
 book_id TEXT NOT NULL,
 source_key TEXT NOT NULL,
 stage_key TEXT NOT NULL,
 card_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,book_id,source_key,stage_key)
);
