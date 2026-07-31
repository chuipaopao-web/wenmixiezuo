-- DEC-070: 独立卷纲退出活动产品。历史成果保留为只读审计记录，
-- 正文目录中的 volumes/volume_id 不受影响。

UPDATE book_planning_states
SET
  version = version + 1,
  stage = CASE
    WHEN master_outline_version_id IS NOT NULL THEN 'master_outline_ready'
    ELSE 'master_outline_in_progress'
  END,
  volume_outline_version_id = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE stage IN ('volume_outline_in_progress', 'volume_outline_ready');

UPDATE book_planning_states
SET
  version = version + 1,
  volume_outline_version_id = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE volume_outline_version_id IS NOT NULL;

UPDATE artifact_versions
SET status = 'superseded'
WHERE status = 'selected'
  AND artifact_id IN (
    SELECT artifact_id FROM artifacts WHERE artifact_type = 'volume_outline'
  );

UPDATE artifacts
SET
  active_version_id = NULL,
  status = 'archived',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE artifact_type = 'volume_outline';
