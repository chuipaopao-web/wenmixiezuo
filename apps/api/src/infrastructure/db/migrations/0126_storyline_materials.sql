-- S1-A阶段二（TIMEMACHINE_STORY_DESIGN第25节）：故事线资料正式版本、作者草稿与失效标记。纯增量，不改旧数据。
CREATE TABLE tm2_storyline_materials(owner TEXT NOT NULL,book TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),content_json TEXT NOT NULL,content_hash TEXT NOT NULL,created_by TEXT NOT NULL CHECK(created_by IN ('selection-confirm','author-edit')),idempotency_key TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,book,id),UNIQUE(owner,book,revision),UNIQUE(owner,book,idempotency_key)) STRICT;
CREATE TABLE tm2_storyline_material_drafts(owner TEXT NOT NULL,book TEXT NOT NULL,content_json TEXT NOT NULL,base_revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,book)) STRICT;
ALTER TABLE tm2_design_runs ADD COLUMN needs_redesign INTEGER NOT NULL DEFAULT 0;
