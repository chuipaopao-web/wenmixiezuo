import { afterEach, describe, expect, it } from 'vitest';
import { requiredPermanentDeleteText } from '../../../apps/api/src/domain/permanent-delete.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { prepareBookForWriting } from '../../helpers/domain-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('生命周期、任务审计与备份REST入口', () => {
  it('归档/恢复遵守版本，任务可追溯，备份可在隔离目录真实验证', async () => {
    context = createTestContext();
    const app = await createServer(context.config, context.database);
    try {
      const draft = (await app.inject({
        method: 'POST', url: '/api/v1/books/drafts', payload: { title: '运维入口测试书', text: '验证本地安全运维入口' }
      })).json().data as { draftId: string; version: number };
      const created = (await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, payload: { expectedVersion: draft.version }
      })).json().data as { bookId: string };
      const initial = (await app.inject({ method: 'GET', url: `/api/v1/books/${created.bookId}` })).json().data as { version: number };

      const archivedResponse = await app.inject({
        method: 'POST', url: `/api/v1/books/${created.bookId}/archive`, payload: { expectedVersion: initial.version }
      });
      expect(archivedResponse.statusCode).toBe(200);
      const archived = archivedResponse.json().data as { version: number; status: string };
      expect(archived.status).toBe('archived');
      const staleRestore = await app.inject({
        method: 'POST', url: `/api/v1/books/${created.bookId}/restore`, payload: { expectedVersion: initial.version }
      });
      expect(staleRestore.statusCode).toBe(409);
      const restored = await app.inject({
        method: 'POST', url: `/api/v1/books/${created.bookId}/restore`, payload: { expectedVersion: archived.version }
      });
      expect(restored.json().data).toMatchObject({ status: 'active', version: archived.version + 1 });
      prepareBookForWriting(
        context,
        { ownerId: context.config.ownerId, bookId: created.bookId },
        new SequenceIds(),
        new FixedClock(),
        1
      );

      const batch = (await app.inject({
        method: 'POST', url: `/api/v1/books/${created.bookId}/chapter-batches`, payload: { count: 1 }
      })).json().data as { taskIds: string[] };
      const taskDetail = await app.inject({ method: 'GET', url: `/api/v1/books/${created.bookId}/tasks/${batch.taskIds[0]!}` });
      expect(taskDetail.statusCode).toBe(200);
      expect(taskDetail.json().data).toMatchObject({ task: { taskId: batch.taskIds[0] }, phases: [], modelCalls: [], toolCalls: [] });
      expect(((await app.inject({ method: 'GET', url: `/api/v1/books/${created.bookId}/budgets` })).json().data as unknown[])).toHaveLength(1);

      const backup = (await app.inject({ method: 'POST', url: '/api/v1/backups' })).json().data as { backupId: string };
      const verified = await app.inject({ method: 'POST', url: `/api/v1/backups/${backup.backupId}/verify` });
      expect(verified.statusCode).toBe(200);
      expect(verified.json().data).toMatchObject({ verified: true });
      expect(((await app.inject({ method: 'GET', url: '/api/v1/backups' })).json().data as Array<{ status: string }>)[0]?.status).toBe('verified');

      const invalidPurge = await app.inject({
        method: 'POST', url: `/api/v1/books/${created.bookId}/purge`, payload: { confirmationText: '继续' }
      });
      expect(invalidPurge.statusCode).toBe(409);
      expect(invalidPurge.json().error.code).toBe('PERMANENT_DELETE_CONFIRMATION_INVALID');
      expect(requiredPermanentDeleteText('运维入口测试书', created.bookId)).toMatch(/^YES 运维入口测试书 [A-Za-z0-9]{6}$/u);
    } finally {
      await app.close();
    }
  });
});
