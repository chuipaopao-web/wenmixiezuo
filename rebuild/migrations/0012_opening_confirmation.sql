CREATE UNIQUE INDEX opening_tasks_owner_task_unique ON opening_tasks(owner_id, task_id);

CREATE TABLE agent_book_opening_sources (
  source_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  book_id uuid NOT NULL,
  task_id uuid NOT NULL UNIQUE,
  candidate_id text NOT NULL,
  review_candidate_id text NOT NULL,
  source_type text NOT NULL DEFAULT 'agent_opening_package' CHECK (source_type='agent_opening_package'),
  source_version integer NOT NULL DEFAULT 1 CHECK (source_version=1),
  opening_idea text NOT NULL,
  opening_package jsonb NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash)=64),
  command_key text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(owner_id, book_id),
  UNIQUE(owner_id, command_key),
  FOREIGN KEY(owner_id, book_id) REFERENCES bookshelf_books(owner_id, book_id),
  FOREIGN KEY(owner_id, task_id) REFERENCES opening_tasks(owner_id, task_id),
  FOREIGN KEY(task_id, candidate_id) REFERENCES opening_workflow_candidates(task_id, candidate_id),
  FOREIGN KEY(task_id, review_candidate_id) REFERENCES opening_workflow_candidates(task_id, candidate_id)
);
GRANT SELECT, INSERT ON agent_book_opening_sources TO "wenmi_rebuild_app";
