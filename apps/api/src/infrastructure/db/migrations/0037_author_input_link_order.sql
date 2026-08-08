-- DEC-107: preserve the author's attachment, mention and application order.

ALTER TABLE author_planning_input_links
  ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0);