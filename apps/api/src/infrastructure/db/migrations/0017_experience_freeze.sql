-- Stage 7: freeze model provenance for queued/running work while allowing future binding revisions.

ALTER TABLE discussion_participants
  ADD COLUMN model_snapshot_id TEXT REFERENCES model_config_snapshots(model_snapshot_id);

ALTER TABLE chapter_pipeline_runs
  ADD COLUMN binding_revision_id TEXT REFERENCES agent_model_binding_revisions(agent_model_binding_revision_id);

CREATE INDEX discussion_participant_snapshot_idx
  ON discussion_participants(owner_id, book_id, discussion_id, model_snapshot_id);

CREATE INDEX chapter_pipeline_binding_revision_idx
  ON chapter_pipeline_runs(owner_id, book_id, binding_revision_id);
