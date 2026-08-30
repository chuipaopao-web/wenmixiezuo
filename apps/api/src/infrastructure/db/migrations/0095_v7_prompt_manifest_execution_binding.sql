-- Freeze the concrete model endpoint and output ceiling used by every saved
-- PromptManifest. Existing immutable snapshots are backfilled from the
-- canonical V7 profile mapping without rewriting their compiled prompt.

ALTER TABLE v7_prompt_manifests ADD COLUMN provider TEXT;
ALTER TABLE v7_prompt_manifests ADD COLUMN model_id TEXT;
ALTER TABLE v7_prompt_manifests ADD COLUMN plan TEXT;
ALTER TABLE v7_prompt_manifests ADD COLUMN max_output_tokens INTEGER;

UPDATE v7_prompt_manifests
SET provider = CASE model_profile_key
      WHEN 'doubao-seedream' THEN 'volcengine-ark-image'
      WHEN 'kimi-k3' THEN 'volcengine-ark-agent-plan'
      ELSE 'volcengine-ark-coding-plan'
    END,
    model_id = CASE model_profile_key
      WHEN 'doubao-seedream' THEN 'doubao-seedream-5-0-260128'
      ELSE model_profile_key
    END,
    plan = CASE model_profile_key
      WHEN 'doubao-seedream' THEN 'image'
      WHEN 'kimi-k3' THEN 'agent'
      ELSE 'coding'
    END,
    max_output_tokens = CASE task_kind
      WHEN 'opening_design' THEN 6000
      WHEN 'opening_review' THEN 3000
      WHEN 'title_design' THEN 1200
      WHEN 'setting_recommendation' THEN 4500
      WHEN 'setting_design' THEN 6000
      WHEN 'setting_review' THEN 4000
      WHEN 'planning_context' THEN 4500
      WHEN 'planning_recipe' THEN 7000
      WHEN 'planning_tree' THEN 12000
      WHEN 'planning_review' THEN 5000
      WHEN 'planning_maintenance' THEN 6000
      WHEN 'chapter_outline' THEN 12000
      WHEN 'manuscript' THEN 18000
      WHEN 'manuscript_review' THEN 6000
      WHEN 'settlement' THEN 8000
      WHEN 'character_context' THEN 3000
      WHEN 'character_maintenance' THEN 6000
      WHEN 'cover_brief' THEN 1600
      WHEN 'cover_render' THEN 1024
      ELSE 6000
    END;

CREATE INDEX v7_prompt_manifest_model_binding_idx
  ON v7_prompt_manifests(provider,model_id,plan,created_at DESC);

CREATE TRIGGER v7_prompt_manifests_execution_binding_required
BEFORE INSERT ON v7_prompt_manifests
WHEN NEW.provider IS NULL OR length(trim(NEW.provider))=0
  OR NEW.model_id IS NULL OR length(trim(NEW.model_id))=0
  OR NEW.plan IS NULL OR NEW.plan NOT IN ('coding','agent','image')
  OR NEW.max_output_tokens IS NULL OR NEW.max_output_tokens < 1 OR NEW.max_output_tokens > 200000
BEGIN
  SELECT RAISE(ABORT,'V7 prompt manifest execution binding is required');
END;

CREATE TRIGGER v7_prompt_manifests_execution_binding_immutable
BEFORE UPDATE OF provider,model_id,plan,max_output_tokens ON v7_prompt_manifests
BEGIN
  SELECT RAISE(ABORT,'V7 prompt manifest execution binding is immutable');
END;
