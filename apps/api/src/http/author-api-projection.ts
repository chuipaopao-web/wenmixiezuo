const AUTHOR_PROJECTION_HEADER = 'clean-v1';

const RENAMED_FIELDS: Readonly<Record<string, string>> = {
  taskId: 'recoveryKey',
  task_id: 'recovery_key',
  taskIds: 'recoveryKeys',
  task_ids: 'recovery_keys',
  requestId: 'recoveryKey',
  request_id: 'recovery_key',
  currentTaskId: 'currentRecoveryKey',
  current_task_id: 'current_recovery_key',
  discussionId: 'collaborationKey',
  discussion_id: 'collaboration_key',
  discussionStatus: 'collaborationStatus',
  discussion_status: 'collaboration_status',
  agentId: 'memberKey',
  agent_id: 'member_key',
  assignedAgentId: 'assignedMemberKey',
  assigned_agent_id: 'assigned_member_key',
  createdByAgentId: 'createdByMemberKey',
  created_by_agent_id: 'created_by_member_key',
  taskType: 'workKind',
  task_type: 'work_kind',
  taskStatus: 'workStatus',
  task_status: 'work_status',
  currentPhase: 'progressStage',
  current_phase: 'progress_stage',
  checkpoint: 'recoveryProgress',
  errorMessage: 'recoveryMessage',
  error_message: 'recovery_message',
  parseError: 'recoveryMessage',
  parse_error: 'recovery_message'
};

const DROPPED_FIELDS = /^(?:ownerId|owner_id|sourceTaskId|source_task_id|sourceDiscussionId|source_discussion_id|sourceDecisionId|source_decision_id|provider|modelId|model_id|modelSnapshotId|model_snapshot_id|modelCalls|model_calls|modelRuntime|model_runtime|modelAssets|model_assets|modelBindings|model_bindings|defaultModel|default_model|toolCalls|tool_calls|phases|errorCode|error_code|errorClass|error_class|errorDetail|error_detail|stack|stackTrace|stack_trace|workerId|worker_id|leaseToken|lease_token|methodKey|method_key|methodVersion|method_version|methodFingerprint|method_fingerprint|contentFingerprint|content_fingerprint)$/u;
const SENSITIVE_KEY = /(?:provider|model.*(?:id|snapshot|fingerprint)|(?:^|_)sql(?:$|_)|stack|worker.*(?:id|token)|lease.*token|method.*(?:key|version|fingerprint))/iu;
const PUBLIC_ERROR_ACTIONS: Readonly<Record<string, string>> = {
  AUTHENTICATION_REQUIRED: 'sign_in',
  INVALID_CREDENTIALS: 'check_account',
  ACCOUNT_SUSPENDED: 'contact_support',
  MEMBERSHIP_REQUIRED: 'open_membership_required',
  MEMBERSHIP_QUOTA_EXHAUSTED: 'open_membership_quota',
  MEMBERSHIP_EXPIRED: 'open_membership_expired',
  SETTING_QUALITY_AUDIT_REQUIRED: 'start_setting_quality_audit',
  SETTING_QUALITY_ISSUES_UNACKNOWLEDGED: 'review_setting_quality_issues',
  RATE_LIMITED: 'retry_later',
  LAYERED_CREATION_READ_ONLY: 'retry_later',
  VALIDATION_ERROR: 'edit_and_retry',
  BOOK_VERSION_CONFLICT: 'refresh_and_retry',
  BOOK_NOT_FOUND: 'return_to_books'
};

const UNSAFE_AUTHOR_ERROR_TEXT = /(?:[A-Za-z]:\\|\/(?:opt|var|home|Users)\/|\b(?:SQL|SQLite|SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|provider|modelId|worker|stack|trace|ContextPack|taskId|discussionId|errorCode)\b|(?:^|\s)[a-z]+_[a-z_]+)/iu;

function publicErrorMessage(code: string, raw: unknown): string {
  const fixed: Readonly<Record<string, string>> = {
    AUTHENTICATION_REQUIRED: '请先登录文秘写作，再继续刚才的操作。',
    MEMBERSHIP_REQUIRED: '当前会员暂不包含这项创作服务，已有内容都已保存。',
    MEMBERSHIP_QUOTA_EXHAUSTED: '本期创作额度已经用完，已有内容都已保存。',
    MEMBERSHIP_EXPIRED: '会员已经到期，已有内容都已保存。',
    SETTING_QUALITY_AUDIT_REQUIRED: '确认前需要先检查整份设定；现有设定已经保存。',
    SETTING_QUALITY_ISSUES_UNACKNOWLEDGED: '设定检查发现需要过目的问题；现有设定已经保存。',
    LAYERED_CREATION_READ_ONLY: '创作设计暂时进入只读保护。已有想法、方案、版本、正文和结算都已保留，请稍后再继续修改。',
    RATE_LIMITED: '请求较多，请稍后重试；已经保存的内容不会丢失。'
  };
  if (fixed[code] !== undefined) return fixed[code];
  if (typeof raw === 'string' && raw.trim().length > 0 && raw.length <= 500 && !UNSAFE_AUTHOR_ERROR_TEXT.test(raw)) {
    return raw.trim();
  }
  return '这一步没有顺利完成。已经保存的作者内容和正式版本不会被覆盖，请返回检查后重试。';
}

function projectAuthorErrorEnvelope(record: Record<string, unknown>): Record<string, unknown> {
  const internal = record.error as Record<string, unknown>;
  const code = typeof internal.code === 'string' ? internal.code : '';
  return {
    error: {
      message: publicErrorMessage(code, internal.message),
      action: PUBLIC_ERROR_ACTIONS[code] ?? (internal.retryable === true ? 'retry_later' : 'return_and_review'),
      retryable: internal.retryable === true
    },
    ...(record.meta === undefined ? {} : { meta: projectAuthorApiValue(record.meta, 1) })
  };
}

export function requestsCleanAuthorProjection(headers: Record<string, unknown>): boolean {
  const raw = headers['x-wenmi-author-projection'];
  return (Array.isArray(raw) ? raw[0] : raw) === AUTHOR_PROJECTION_HEADER;
}

export function shouldProjectAuthorResponse(url: string, _statusCode: number, headers: Record<string, unknown>): boolean {
  if (!requestsCleanAuthorProjection(headers)) return false;
  return url.startsWith('/api/v1/')
    && !url.startsWith('/api/v1/admin/')
    && !url.startsWith('/api/v1/internal/');
}

/** 只改写即将发给新版作者端的副本，数据库、任务恢复键和管理员审计原件均不变。 */
export function projectAuthorApiValue(value: unknown, depth = 0): unknown {
  if (depth > 24 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => projectAuthorApiValue(item, depth + 1));
  if (typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  if (depth === 0 && !('data' in source) && typeof source.error === 'object' && source.error !== null) {
    return projectAuthorErrorEnvelope(source);
  }

  const projected: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_FIELDS.test(key) || SENSITIVE_KEY.test(key)) continue;
    const publicKey = RENAMED_FIELDS[key] ?? key;
    if (publicKey === 'recoveryMessage' || publicKey === 'recovery_message') {
      projected[publicKey] = raw === null || raw === undefined || raw === ''
        ? null
        : '这一步没有完成，已保存的作者内容和正式版本不会被覆盖，可以重试。';
      continue;
    }
    projected[publicKey] = projectAuthorApiValue(raw, depth + 1);
  }
  return projected;
}

export function projectSerializedAuthorResponse(payload: unknown): unknown {
  if (typeof payload === 'string') {
    try {
      return JSON.stringify(projectAuthorApiValue(JSON.parse(payload) as unknown));
    } catch {
      return payload;
    }
  }
  if (Buffer.isBuffer(payload)) {
    try {
      return Buffer.from(JSON.stringify(projectAuthorApiValue(JSON.parse(payload.toString('utf8')) as unknown)));
    } catch {
      return payload;
    }
  }
  return projectAuthorApiValue(payload);
}