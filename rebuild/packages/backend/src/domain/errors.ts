export type DomainErrorCode =
  | "CONFIGURATION_INVALID"
  | "DATABASE_GUARD_FAILED"
  | "MIGRATION_FAILED"
  | "FOUNDATION_NOT_IMPLEMENTED";

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
