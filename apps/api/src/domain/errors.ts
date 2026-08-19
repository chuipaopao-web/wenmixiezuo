export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly retryable = false,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const errorCodes = {
  agentCapabilityUnavailable: 'AGENT_CAPABILITY_UNAVAILABLE',
  backupNotVerified: 'BACKUP_NOT_VERIFIED',
  bookNotFound: 'BOOK_NOT_FOUND',
  bookScopeViolation: 'BOOK_SCOPE_VIOLATION',
  bookStatusConflict: 'BOOK_STATUS_CONFLICT',
  bookVersionConflict: 'BOOK_VERSION_CONFLICT',
  budgetExhausted: 'BUDGET_EXHAUSTED',
  canonRevisionConflict: 'CANON_REVISION_CONFLICT',
  chapterDependencyUnsettled: 'CHAPTER_DEPENDENCY_UNSETTLED',
  confirmationMismatch: 'CONFIRMATION_MISMATCH',
  confirmationRequired: 'CONFIRMATION_REQUIRED',
  copyrightBlocked: 'COPYRIGHT_BLOCKED',
  editorEpochConflict: 'EDITOR_EPOCH_CONFLICT',
  independentReviewRequired: 'INDEPENDENT_REVIEW_REQUIRED',
  membershipExpired: 'MEMBERSHIP_EXPIRED',
  membershipQuotaExhausted: 'MEMBERSHIP_QUOTA_EXHAUSTED',
  membershipRequired: 'MEMBERSHIP_REQUIRED',
  modelCallInterrupted: 'MODEL_CALL_INTERRUPTED',
  modelRequestRejected: 'MODEL_REQUEST_REJECTED',
  operationIncomplete: 'OPERATION_INCOMPLETE',
  permanentDeleteConfirmationInvalid: 'PERMANENT_DELETE_CONFIRMATION_INVALID',
  settingQualityAuditRequired: 'SETTING_QUALITY_AUDIT_REQUIRED',
  settingQualityIssuesUnacknowledged: 'SETTING_QUALITY_ISSUES_UNACKNOWLEDGED',
  taskAlreadyRunning: 'TASK_ALREADY_RUNNING',
  validation: 'VALIDATION_ERROR'
} as const;
