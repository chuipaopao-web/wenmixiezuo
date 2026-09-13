-- R209-B1 创作参考库底座：稳定编号、版本、关系与发布快照。
-- 仅全局编辑资产（方法/参考卡），不复制作者数据；不改动既有表。
-- 返修批：补alias表、请求指纹列、release内关系快照与canonical清单列（0122未发布，原位修订）。
CREATE TABLE creative_reference_cards (
  internal_id TEXT PRIMARY KEY,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('method','reference')),
  display_code TEXT NOT NULL,
  legacy_namespace TEXT,
  legacy_key TEXT,
  legacy_version INTEGER,
  current_revision INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft','reviewed','published','retired')),
  idempotency_key TEXT,
  create_request_fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (asset_kind, display_code),
  UNIQUE (asset_kind, idempotency_key)
) STRICT;
CREATE INDEX creative_reference_cards_kind_status ON creative_reference_cards(asset_kind, status);
CREATE TABLE creative_reference_counters (
  asset_kind TEXT PRIMARY KEY CHECK (asset_kind IN ('method','reference')),
  next_number INTEGER NOT NULL CHECK (next_number >= 1)
) STRICT;
-- 同实体多别名：确认同实体后挂到同一canonical卡，多legacy视图/别名共享一个稳定编号。
CREATE TABLE creative_reference_aliases (
  alias_id TEXT PRIMARY KEY,
  internal_id TEXT NOT NULL REFERENCES creative_reference_cards(internal_id),
  namespace TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  alias_version INTEGER,
  source_view TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (namespace, alias_key, alias_version)
) STRICT;
CREATE INDEX creative_reference_aliases_card ON creative_reference_aliases(internal_id);
CREATE TABLE creative_reference_revisions (
  internal_id TEXT NOT NULL REFERENCES creative_reference_cards(internal_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  asset_kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  display_code TEXT NOT NULL,
  short_phrase TEXT NOT NULL,
  summary TEXT NOT NULL,
  -- revision状态是内容生命周期：draft→reviewed（审核证据）→published（发布时打标）。
  status TEXT NOT NULL CHECK (status IN ('draft','reviewed','published','retired')),
  author_actor TEXT NOT NULL,
  review_actor TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (internal_id, revision)
) STRICT;
CREATE INDEX creative_reference_revisions_code ON creative_reference_revisions(display_code);
CREATE INDEX creative_reference_revisions_status ON creative_reference_revisions(asset_kind, status);
-- 卡的当前可选状态独立于revision内容状态：退役只影响新选择，不破坏旧release资格。
CREATE TABLE creative_reference_relations (
  relation_id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  to_id TEXT NOT NULL,
  to_revision INTEGER NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('supplement','fusion','synonym','replacement','related_method')),
  created_at TEXT NOT NULL,
  UNIQUE (from_id, from_revision, to_id, to_revision, relation_type)
) STRICT;
-- release内关系快照：冻结图谱与manifest一致，跨release不串。
CREATE TABLE creative_reference_release_relations (
  release_id TEXT NOT NULL,
  relation_id TEXT NOT NULL,
  PRIMARY KEY (release_id, relation_id)
) STRICT;
CREATE TABLE creative_reference_releases (
  release_id TEXT PRIMARY KEY,
  canonical_manifest TEXT NOT NULL UNIQUE,
  manifest_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  published_by TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX creative_reference_releases_single_active ON creative_reference_releases(active) WHERE active = 1;
