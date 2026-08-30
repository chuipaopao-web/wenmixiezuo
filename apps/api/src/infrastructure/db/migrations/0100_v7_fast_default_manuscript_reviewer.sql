-- A bounded chapter-8 review on 2026-08-29 returned in 17.8 seconds with
-- Kimi K3 thinking disabled. The former GLM default consumed 18,400 output
-- tokens in hidden reasoning and returned no report. Move only the untouched
-- system seed to the proven default; administrator-edited rows keep their
-- configured order and default.

UPDATE v7_agent_governance_member_settings
SET default_for_role = 0,
    fallback_priority = 2,
    revision = revision + 1,
    updated_by = 'system-review-evidence',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE member_key = 'review-glm-5-3'
  AND fixed_role_key = 'independent_reviewer'
  AND default_for_role = 1
  AND fallback_priority = 1
  AND updated_by = 'system';

UPDATE v7_agent_governance_member_settings
SET fallback_priority = 3,
    revision = revision + 1,
    updated_by = 'system-review-evidence',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE member_key = 'review-deepseek-v4-pro'
  AND fixed_role_key = 'independent_reviewer'
  AND default_for_role = 0
  AND fallback_priority = 2
  AND updated_by = 'system';

UPDATE v7_agent_governance_member_settings
SET default_for_role = 1,
    fallback_priority = 1,
    revision = revision + 1,
    updated_by = 'system-review-evidence',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE member_key = 'review-kimi-k3'
  AND fixed_role_key = 'independent_reviewer'
  AND default_for_role = 0
  AND fallback_priority = 4
  AND updated_by = 'system';

UPDATE v7_agent_governance_meta
SET revision = revision + 1,
    updated_by = 'system-review-evidence',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE singleton = 1
  AND EXISTS (
    SELECT 1 FROM v7_agent_governance_member_settings
    WHERE member_key = 'review-kimi-k3'
      AND default_for_role = 1
      AND fallback_priority = 1
      AND updated_by = 'system-review-evidence'
  );
