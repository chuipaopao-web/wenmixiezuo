ALTER TABLE opening_tasks ADD COLUMN engine_state jsonb;
CREATE TABLE opening_workflow_candidates (
  task_id uuid NOT NULL REFERENCES opening_tasks(task_id),
  candidate_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('opening_package','opening_review','work_order')),
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  member_key text NOT NULL,
  model_request_id text NOT NULL,
  source_candidate_ids jsonb NOT NULL,
  PRIMARY KEY (task_id,candidate_id),
  UNIQUE (task_id,kind,version),
  UNIQUE (task_id,model_request_id)
);
CREATE TABLE opening_workflow_prompts (
  task_id uuid NOT NULL REFERENCES opening_tasks(task_id),
  request_id text NOT NULL,
  request_hash text NOT NULL,
  request jsonb NOT NULL,
  compilation jsonb NOT NULL,
  PRIMARY KEY (task_id,request_id)
);
GRANT SELECT, INSERT ON opening_workflow_candidates, opening_workflow_prompts TO "wenmi_rebuild_app";
