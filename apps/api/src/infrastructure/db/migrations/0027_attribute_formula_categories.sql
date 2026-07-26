ALTER TABLE attribute_formulas ADD COLUMN category TEXT NOT NULL DEFAULT 'uncategorized';

CREATE INDEX attribute_formulas_category_idx
  ON attribute_formulas(owner_id, book_id, category, status, formula_key, version DESC);
