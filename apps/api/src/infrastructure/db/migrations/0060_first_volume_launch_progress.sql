-- DR-20260820-first-volume-launch-v1: extend the 0059 launch tracker with chapter-level runtime evidence.
ALTER TABLE first_volume_launch_progress
  ADD COLUMN latest_settled_chapter_number INTEGER NOT NULL DEFAULT 0
  CHECK (latest_settled_chapter_number >= 0);

ALTER TABLE first_volume_launch_progress
  ADD COLUMN climax_completed_at_effective_characters INTEGER
  CHECK (climax_completed_at_effective_characters IS NULL OR climax_completed_at_effective_characters >= 0);

ALTER TABLE first_volume_launch_progress
  ADD COLUMN prediction_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(prediction_json));