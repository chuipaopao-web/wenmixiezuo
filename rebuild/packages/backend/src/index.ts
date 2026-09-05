export { createFoundationStatus } from "./application/foundation-status.js";
export {
  ENVIRONMENT_MARKER,
  type PostgresRuntimeConfig,
  loadPostgresRuntimeConfig
} from "./infrastructure/config.js";
export { createLogger, redactLogValue, type Logger } from "./infrastructure/logger.js";
export { toSafeErrorResponse } from "./infrastructure/safe-error.js";
export { DomainError, type DomainErrorCode } from "./domain/errors.js";
export {
  AccountCoreService,
  REBUILD_SESSION_COOKIE,
  createAccountCoreService,
  type AccountServiceOptions,
  type CreateInternalAccountInput,
  type LoginInput,
  type PasswordChangeInput
} from "./application/accounts/index.js";
export {
  hashNewPassword,
  hashVerifiedPassword,
  hashToken,
  isSupportedPasswordRecord,
  legacyScryptRecord,
  readCookie,
  shouldUpgradePassword,
  validateNewPassword,
  verifyPassword,
  verifyUnknownAccountPassword,
  type AccountRecord,
  type AuthContext,
  type IssuedOneTimeToken,
  type IssuedSession,
  type PasswordRecord
} from "./domain/accounts/index.js";
export { hashSyntheticTaskPayload, normalizeSyntheticJson } from "./domain/synthetic-tasks/index.js";
export { createSyntheticTaskService, type SyntheticTaskRepository, type SyntheticTaskService } from "./application/synthetic-tasks/index.js";
export type {
  ClaimedSyntheticTask,
  ExternalResolution,
  SyntheticTaskEvent,
  SyntheticTaskLease,
  SyntheticTaskRecord,
  SyntheticTaskRequest,
  SyntheticTaskScope,
  SyntheticTaskStatus
} from "./domain/synthetic-tasks/index.js";
export { createPostgresPool, withTransaction, type PgPool } from "./infrastructure/postgres/client.js";
export { runMigrations, verifyRuntimeDatabase, type MigrationResult } from "./infrastructure/postgres/migrations.js";
export { PostgresSyntheticTaskRepository } from "./infrastructure/postgres/repositories/synthetic-task-repository.js";
export { PostgresAccountRepository } from "./infrastructure/postgres/repositories/account-repository.js";
