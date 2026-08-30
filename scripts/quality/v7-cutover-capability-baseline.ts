/**
 * V7 清理前的只读功能审计快照。
 *
 * 这些 ID 不装配路由、不出现在当前后台台账，也不要求恢复旧功能；只用于证明
 * 本轮清理没有改写历史审计记录。旧运行实现由 Git 追溯，本文件只保留稳定键。
 */
export const V7_CUTOVER_ALL_CAPABILITY_IDS = [
  'account-register','account-login-session','account-personal-center','account-role-gate','book-list-switch','book-create','book-archive','book-permanent-delete-safety',
  'opening-draft','opening-import-analysis','book-profile-edit','existing-manuscript-continuation','setting-catalog','setting-protagonist-personality','setting-ai-collaboration',
  'setting-gap-detection','setting-baseline-versioning','setting-quality-review','storyline-growth-map','storyline-established-facts','storyline-active-threads',
  'storyline-author-horizon','storyline-editor-recommendations','storyline-open-questions','storyline-candidate-ledger','volume-direction','volume-plan-generation',
  'volume-confirmation','volume-expression','volume-settlement','event-chain-view','event-generation','event-confirmation','event-role-orchestration','chapter-chain',
  'chapter-outline-detail','outline-manuscript-alignment','chapter-writing-readiness','chapter-draft-generation','writer-selection','manuscript-versioning','multi-review',
  'editor-synthesis','chapter-approval','chapter-settlement','event-settlement','volume-settlement-followup','next-volume-transition','knowledge-library','story-knowledge',
  'canon-index','narrative-projection','semantic-retrieval','name-generation','name-library','team-roster-25','team-role-categories','team-member-choice',
  'team-parallel-fairness','team-status-cost','task-list','task-detail','task-failure-recovery','retained-partial-results','feedback-submit','feedback-admin-trace',
  'membership-gate','membership-account-summary','admin-operations-overview','admin-paid-rate','admin-recorded-revenue','admin-user-list-status','admin-user-book-inventory',
  'admin-user-failure-location','admin-compute-usage','admin-compute-trend','admin-api-cash-cost','admin-api-call-trend','admin-model-scheme','admin-member-binding',
  'admin-member-expand-26','admin-skill-registry','admin-batch-evidence','admin-issue-center','admin-issue-workflow','admin-narrative-methods',
  'admin-creative-template-versioning','admin-template-rollout','admin-prompt-trigger-catalog','admin-prompt-overrides','admin-runtime-prompt','admin-prompt-call-evidence',
  'admin-membership-grant-revoke','admin-membership-revenue','admin-membership-expiry','context-compiler','context-pack-freeze','retrieval-evidence','longform-continuity',
  'idempotent-tasks','model-call-budget','worker-lease','failure-classification','owner-book-isolation','immutable-manuscripts','immutable-settlements','secret-env-only',
  'safe-delete','portability-backup','api-health','atomic-web-release','queue-safe-service-release','production-rollback','capability-registry','version-comparison',
  'capability-release-guard','admin-capability-page','idea-capture','idea-to-book-context','book-export','book-import','writing-preferences','legacy-information-page',
  'legacy-planning-workspace-shell','legacy-team-workspace','legacy-fixed-15-member-roster','author-protected-role-prompt-viewer','author-agent-prompt-preference-editor',
  'book-branding-title-design','book-branding-synopsis-design'
] as const;

export const V7_CUTOVER_PREVIOUS_PRODUCTION_IDS = [
  'account-register','account-login-session','account-personal-center','account-role-gate','book-list-switch','book-create','book-archive','book-permanent-delete-safety',
  'opening-draft','opening-import-analysis','book-profile-edit','existing-manuscript-continuation','setting-catalog','setting-protagonist-personality','setting-ai-collaboration',
  'setting-gap-detection','setting-baseline-versioning','setting-quality-review','volume-direction','volume-plan-generation','volume-confirmation','volume-expression',
  'volume-settlement','event-chain-view','event-generation','event-confirmation','event-role-orchestration','chapter-chain','chapter-outline-detail','chapter-writing-readiness',
  'chapter-draft-generation','writer-selection','manuscript-versioning','multi-review','chapter-approval','chapter-settlement','event-settlement','knowledge-library','story-knowledge',
  'canon-index','narrative-projection','semantic-retrieval','name-generation','name-library','team-roster-25','team-role-categories','team-member-choice','team-parallel-fairness',
  'team-status-cost','task-list','task-detail','task-failure-recovery','retained-partial-results','feedback-submit','feedback-admin-trace','membership-gate',
  'membership-account-summary','admin-operations-overview','admin-user-list-status','admin-compute-usage','admin-compute-trend','admin-api-cash-cost','admin-api-call-trend',
  'admin-model-scheme','admin-member-binding','admin-issue-center','admin-issue-workflow','admin-narrative-methods','admin-prompt-trigger-catalog','admin-prompt-overrides',
  'admin-runtime-prompt','admin-membership-grant-revoke','admin-membership-revenue','admin-membership-expiry','context-compiler','context-pack-freeze','retrieval-evidence',
  'longform-continuity','idempotent-tasks','model-call-budget','worker-lease','failure-classification','owner-book-isolation','immutable-manuscripts','immutable-settlements',
  'secret-env-only','safe-delete','portability-backup','api-health','atomic-web-release','queue-safe-service-release','production-rollback','idea-capture',
  'idea-to-book-context','book-export','book-import','writing-preferences'
] as const;

export const V7_CUTOVER_STABLE_BASELINE_IDS = [
  'account-register','account-login-session','account-personal-center','book-list-switch','book-create','book-archive','book-permanent-delete-safety','opening-draft',
  'opening-import-analysis','book-profile-edit','existing-manuscript-continuation','setting-catalog','setting-protagonist-personality','setting-ai-collaboration',
  'setting-baseline-versioning','volume-direction','volume-plan-generation','volume-confirmation','event-chain-view','event-generation','event-confirmation','chapter-chain',
  'chapter-outline-detail','chapter-writing-readiness','chapter-draft-generation','writer-selection','manuscript-versioning','multi-review','chapter-approval','chapter-settlement',
  'event-settlement','knowledge-library','story-knowledge','canon-index','narrative-projection','semantic-retrieval','name-generation','name-library','task-list','task-detail',
  'task-failure-recovery','feedback-submit','context-compiler','context-pack-freeze','retrieval-evidence','longform-continuity','idempotent-tasks','model-call-budget','worker-lease',
  'failure-classification','owner-book-isolation','immutable-manuscripts','immutable-settlements','secret-env-only','safe-delete','portability-backup','api-health',
  'atomic-web-release','queue-safe-service-release','production-rollback','idea-capture','idea-to-book-context','book-export','book-import','writing-preferences',
  'legacy-information-page','legacy-planning-workspace-shell','legacy-team-workspace','legacy-fixed-15-member-roster','author-protected-role-prompt-viewer',
  'author-agent-prompt-preference-editor','book-branding-title-design','book-branding-synopsis-design'
] as const;

export const V7_CUTOVER_KNOWN_MISSING_IDS = ['book-branding-title-design','book-branding-synopsis-design'] as const;

export const V7_CUTOVER_BASELINE_HASHES = {
  all: '89ace586396ba7dd31430f821876baacd689072956c40abe3eb8ded96ded1f1b',
  previousProduction: '8fb55ad52b58666c17d3834ac9e41b64778c531e352c3a6cfcbf50bd3729d9ae',
  stableBaseline: 'f28c21a4efd32fa3a186691ec14ee4a8ea4c27498d0a209b6faec2f5410287d0'
} as const;
