import { describe, expect, it } from 'vitest';
import { API_VERSION, SCHEMA_VERSION, success, type EventEnvelope } from '../../apps/api/src/contracts/api.js';
import { errorCodes } from '../../apps/api/src/domain/errors.js';

describe('公共契约', () => {
  it('返回固定API与Schema版本', () => {
    expect(API_VERSION).toBe('v1');
    expect(SCHEMA_VERSION).toBe(25);
  });

  it('生成统一成功信封', () => {
    expect(success({ ok: true }, 'request-1')).toEqual({
      data: { ok: true },
      meta: { requestId: 'request-1', version: 1 }
    });
  });

  it('事件信封包含隔离键和递增序号字段', () => {
    const event: EventEnvelope = {
      eventSeq: 1,
      eventId: 'event-1',
      eventType: 'task.created',
      ownerId: 'owner-1',
      bookId: 'book-1',
      occurredAt: '2026-07-16T00:00:00.000Z',
      data: {}
    };
    expect(event.bookId).toBe('book-1');
    expect(errorCodes.bookScopeViolation).toBe('BOOK_SCOPE_VIOLATION');
  });
});
