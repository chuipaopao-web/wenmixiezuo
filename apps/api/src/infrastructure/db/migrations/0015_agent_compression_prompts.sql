CREATE TABLE team_template_snapshots (
  team_template_snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  member_contracts_json TEXT NOT NULL CHECK (json_valid(member_contracts_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE TABLE model_capability_snapshots (
  model_capability_snapshot_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('deterministic', 'codex', 'coding', 'agent', 'local')),
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  context_tokens INTEGER NOT NULL CHECK (context_tokens > 0),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens > 0),
  structured_output INTEGER NOT NULL CHECK (structured_output IN (0, 1)),
  streaming INTEGER NOT NULL CHECK (streaming IN (0, 1)),
  cancellation INTEGER NOT NULL CHECK (cancellation IN (0, 1)),
  cash_fallback_allowed INTEGER NOT NULL CHECK (cash_fallback_allowed IN (0, 1)),
  credential_configured INTEGER NOT NULL CHECK (credential_configured IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('verified', 'unavailable', 'invalid')),
  validated_at TEXT NOT NULL,
  UNIQUE(provider, model_id, plan_type, validated_at)
) STRICT;

CREATE TABLE agent_model_binding_revisions (
  agent_model_binding_revision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  effective_from TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'rolled_back')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE TABLE agent_model_bindings (
  agent_model_binding_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  agent_model_binding_revision_id TEXT NOT NULL,
  role_key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  purpose_json TEXT NOT NULL CHECK (json_valid(purpose_json)),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (agent_model_binding_revision_id) REFERENCES agent_model_binding_revisions(agent_model_binding_revision_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  UNIQUE(owner_id, book_id, agent_model_binding_revision_id, role_key)
) STRICT;

CREATE TABLE prompt_template_snapshots (
  prompt_template_snapshot_id TEXT PRIMARY KEY,
  role_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  public_contract_json TEXT NOT NULL CHECK (json_valid(public_contract_json)),
  hard_rules_json TEXT NOT NULL CHECK (json_valid(hard_rules_json)),
  output_schema_json TEXT NOT NULL CHECK (json_valid(output_schema_json)),
  retrieval_profile_json TEXT NOT NULL CHECK (json_valid(retrieval_profile_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  UNIQUE(role_key, version)
) STRICT;

CREATE TABLE agent_continuity_journals (
  agent_continuity_journal_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('step', 'evidence', 'objection', 'conclusion', 'handoff', 'failure')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  source_ids_json TEXT NOT NULL CHECK (json_valid(source_ids_json)),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id)
) STRICT;

CREATE TABLE agent_focus_snapshots (
  agent_focus_snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  current_focus_json TEXT NOT NULL CHECK (json_valid(current_focus_json)),
  unresolved_json TEXT NOT NULL CHECK (json_valid(unresolved_json)),
  last_contribution_json TEXT NOT NULL CHECK (json_valid(last_contribution_json)),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  UNIQUE(owner_id, book_id, agent_id, version)
) STRICT;

CREATE UNIQUE INDEX agent_focus_active_idx ON agent_focus_snapshots(owner_id, book_id, agent_id) WHERE status = 'active';

CREATE TABLE writer_leases (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  active_writer_agent_id TEXT NOT NULL,
  writer_epoch INTEGER NOT NULL CHECK (writer_epoch >= 1),
  writing_order_id TEXT,
  lease_expires_at TEXT NOT NULL,
  takeover_state TEXT NOT NULL CHECK (takeover_state IN ('stable', 'preparing', 'ready')),
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (active_writer_agent_id) REFERENCES agent_instances(agent_id)
) STRICT;

CREATE TABLE review_panels (
  review_panel_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  writer_model_snapshot_id TEXT NOT NULL,
  fact_agent_id TEXT NOT NULL,
  fact_model_snapshot_id TEXT NOT NULL,
  literary_agent_id TEXT NOT NULL,
  literary_model_snapshot_id TEXT NOT NULL,
  experience_agent_id TEXT NOT NULL,
  experience_model_snapshot_id TEXT NOT NULL,
  selection_reason_json TEXT NOT NULL CHECK (json_valid(selection_reason_json)),
  status TEXT NOT NULL CHECK (status IN ('frozen', 'working', 'complete', 'blocked')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id)
) STRICT;

CREATE TABLE review_reports (
  review_report_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  review_panel_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('fact', 'literary', 'experience')),
  agent_id TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  report_json TEXT NOT NULL CHECK (json_valid(report_json)),
  report_hash TEXT NOT NULL CHECK (length(report_hash) = 64),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'invalid', 'superseded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (review_panel_id) REFERENCES review_panels(review_panel_id),
  UNIQUE(review_panel_id, reviewer_role)
) STRICT;

CREATE TABLE revision_orders (
  revision_order_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  review_panel_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  revision_round INTEGER NOT NULL CHECK (revision_round BETWEEN 1 AND 2),
  hard_actions_json TEXT NOT NULL CHECK (json_valid(hard_actions_json)),
  soft_actions_json TEXT NOT NULL CHECK (json_valid(soft_actions_json)),
  disagreements_json TEXT NOT NULL CHECK (json_valid(disagreements_json)),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (review_panel_id) REFERENCES review_panels(review_panel_id)
) STRICT;

CREATE TABLE local_assistant_sessions (
  local_assistant_session_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  active_discussion_id TEXT,
  last_message_id TEXT,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, conversation_id)
) STRICT;

CREATE TABLE message_routing_decisions (
  message_routing_decision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  local_assistant_session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  original_message_hash TEXT NOT NULL CHECK (length(original_message_hash) = 64),
  route_class TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'irreversible')),
  confidence_band TEXT NOT NULL CHECK (confidence_band IN ('high', 'medium', 'low')),
  entities_json TEXT NOT NULL CHECK (json_valid(entities_json)),
  source_pointers_json TEXT NOT NULL CHECK (json_valid(source_pointers_json)),
  selected_action TEXT NOT NULL,
  selected_roles_json TEXT NOT NULL CHECK (json_valid(selected_roles_json)),
  excluded_actions_json TEXT NOT NULL CHECK (json_valid(excluded_actions_json)),
  receipt_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (local_assistant_session_id) REFERENCES local_assistant_sessions(local_assistant_session_id)
) STRICT;

CREATE TABLE utility_experience_candidates (
  utility_experience_candidate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('tool', 'routing', 'failure_recovery')),
  rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  counterexamples_json TEXT NOT NULL CHECK (json_valid(counterexamples_json)),
  applicability_json TEXT NOT NULL CHECK (json_valid(applicability_json)),
  expires_at TEXT NOT NULL,
  rollback_condition TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'validated', 'rejected', 'expired')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE utility_experience_revisions (
  utility_experience_revision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  utility_experience_candidate_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'rolled_back')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (utility_experience_candidate_id) REFERENCES utility_experience_candidates(utility_experience_candidate_id),
  UNIQUE(owner_id, book_id, utility_experience_candidate_id, version)
) STRICT;
