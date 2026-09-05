export type DomainErrorCode =
  | "CONFIGURATION_INVALID"
  | "DATABASE_GUARD_FAILED"
  | "MIGRATION_FAILED"
  | "FOUNDATION_NOT_IMPLEMENTED"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORIZATION_REQUIRED"
  | "ACCOUNT_INPUT_INVALID"
  | "ACCOUNT_CREDENTIALS_INVALID"
  | "ACCOUNT_EMAIL_NOT_VERIFIED"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_TOKEN_INVALID"
  | "ACCOUNT_PROFILE_CONFLICT"
  | "ACCOUNT_RATE_LIMITED"
  | "ACCOUNT_PASSWORD_HASH_BUSY"
  | "BOOK_INPUT_INVALID"
  | "BOOK_NOT_FOUND"
  | "BOOK_IDEMPOTENCY_CONFLICT"
  | "BOOK_VERSION_CONFLICT"
  | "REQUEST_ORIGIN_REJECTED"
  | "REQUEST_HOST_REJECTED"
  | "REQUEST_CONTENT_TYPE_REJECTED"
  | "REQUEST_COOKIE_REJECTED"
  | "TASK_REQUEST_INVALID"
  | "TASK_IDEMPOTENCY_CONFLICT"
  | "TASK_SCOPE_DENIED"
  | "TASK_NOT_CLAIMABLE"
  | "TASK_LEASE_INVALID"
  | "TASK_EXTERNAL_CHECK_REQUIRED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly retryable: boolean;

  constructor(code: DomainErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
