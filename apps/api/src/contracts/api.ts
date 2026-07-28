export const API_VERSION = 'v1' as const;
export const SCHEMA_VERSION = 30 as const;

export interface ApiMeta {
  requestId: string;
  version: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
    retryable: boolean;
  };
  meta: Pick<ApiMeta, 'requestId'>;
}

export interface EventEnvelope<T = Record<string, unknown>> {
  eventSeq: number;
  eventId: string;
  eventType: string;
  ownerId: string;
  bookId: string | null;
  occurredAt: string;
  data: T;
}

export function success<T>(data: T, requestId: string, version = 1): ApiSuccess<T> {
  return { data, meta: { requestId, version } };
}
