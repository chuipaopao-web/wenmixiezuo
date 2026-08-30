-- Real local V7 evidence on 2026-08-29: Kimi K3 completed bounded chapters in
-- 8-11 minutes and one call reached the 15-minute unknown-result boundary;
-- DeepSeek V4 Pro completed the same chapter in 94 seconds. Keep both members
-- enabled and selectable, but use the faster proven strong model for new
-- unattended manuscript work.

-- Clear the old default first.  SQLite checks the partial unique index after
-- every affected row, so swapping both defaults in one UPDATE can transiently
-- produce two defaults even though the final CASE result is valid.
UPDATE v7_agent_governance_member_settings
SET default_for_role = 0,
    fallback_priority = 2,
    revision = revision + 1,
    updated_by = 'system-speed-evidence',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE member_key = 'writer-kimi-k3';

UPDATE v7_agent_governance_member_settings
SET default_for_role = 1,
    fallback_priority = 1,
    revision = revision + 1,
    updated_by = 'system-speed-evidence',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE member_key = 'writer-deepseek-v4-pro';
