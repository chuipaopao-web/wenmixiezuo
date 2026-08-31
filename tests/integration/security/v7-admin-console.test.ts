import { afterEach, describe, expect, it } from 'vitest';
import { createV7Server } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { V7TaskAuditRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-task-audit-repository.js';

const HEADERS = {
  host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site', 'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

describe('V7 独立后台当前接口白名单', () => {
  it('当前后台接口保持管理员门禁，已退役后台接口不再注册', async () => {
    context = createTestContext('wenmi-v7-admin-console-');
    const app = await createV7Server(context.config, context.database);
    try {
      const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const author = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'author@example.com', password: 'strong-pass-456', displayName: '作者' } });
      const adminCookie = cookieFrom(admin);
      const authorCookie = cookieFrom(author);
      for (const url of [
        '/api/v1/admin/dashboard', '/api/v1/admin/user-operations', '/api/v1/admin/usage',
        '/api/v1/admin/issues?limit=10', '/api/v1/admin/membership-stats', '/api/v1/admin/feature-capabilities'
      ]) {
        expect((await app.inject({ method: 'GET', url, headers: { host: HEADERS.host, cookie: authorCookie } })).statusCode, url)
          .toBe(403);
        expect((await app.inject({ method: 'GET', url, headers: { host: HEADERS.host, cookie: adminCookie } })).statusCode, url)
          .toBe(200);
      }
      const feedback = await app.inject({ method: 'POST', url: '/api/v1/feedback',
        headers: { ...HEADERS, cookie: authorCookie }, payload: { category: 'experience', message: '当前页面需要改进' } });
      expect(feedback.statusCode).toBe(200);
      for (const url of [
        '/api/v1/admin/model-scheme', '/api/v1/admin/ai-governance',
        '/api/v1/admin/narrative-methods', '/api/v1/admin/prompt-catalog', '/api/v1/capabilities'
      ]) {
        expect((await app.inject({ method: 'GET', url, headers: { host: HEADERS.host, cookie: adminCookie } })).statusCode, url)
          .toBe(404);
      }
    } finally {
      await app.close();
    }
  });

  it('仪表盘和用户操作只读投影统计 V7 失败任务，不依赖旧团队任务表', async () => {
    context = createTestContext('wenmi-v7-admin-task-audit-');
    const app = await createV7Server(context.config, context.database);
    try {
      const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin-audit@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'author-audit@example.com', password: 'strong-pass-456', displayName: '审计作者' } });
      const account = context.database.prepare(`SELECT owner_id FROM user_accounts WHERE email_normalized=?`)
        .get('author-audit@example.com') as { owner_id: string };
      const now = new Date().toISOString();
      const bookId = 'v7-admin-audit-book';
      new BookRepository(context.database).create({ ownerId: account.owner_id, bookId }, 'V7审计书', now, 'active');
      context.database.prepare(`INSERT INTO v7_book_title_design_calls(
        design_id,owner_id,book_id,idempotency_key,request_hash,source_version,member_key,state,
        prompt_hash,options_json,failure_message,created_at,updated_at
      ) VALUES(?,?,?,?,?,1,'chief-deepseek-v4-pro','failed',?,'[]','模型没有返回有效书名',?,?)`).run(
        'v7-title-failed-1', account.owner_id, bookId, 'title-audit-0001', 'a'.repeat(64), 'b'.repeat(64), now, now
      );
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id=?`).get(account.owner_id))
        .toEqual({ count: 0 });

      const headers = { host: HEADERS.host, cookie: cookieFrom(admin) };
      const dashboard = (await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers })).json() as {
        data: { overview: { failedTasksToday: number; openIssues: number } };
      };
      expect(dashboard.data.overview.failedTasksToday).toBe(1);
      expect(dashboard.data.overview.openIssues).toBe(1);
      const issues = (await app.inject({ method: 'GET', url: '/api/v1/admin/issues?source=failed_task', headers })).json() as {
        data: { items: Array<Record<string, unknown>> };
      };
      expect(issues.data.items).toEqual([expect.objectContaining({
        sourceId: 'title:v7-title-failed-1', taskId: 'v7-title-failed-1',
        category: 'title_design', detail: '模型没有返回有效书名'
      })]);
      const resolved = await app.inject({
        method: 'PATCH', url: '/api/v1/admin/issues/failed_task/title%3Av7-title-failed-1',
        headers: { ...HEADERS, cookie: cookieFrom(admin) },
        payload: { status: 'resolved', severity: 'high', note: '已核实' }
      });
      expect(resolved.statusCode).toBe(200);
      const resolvedDashboard = (await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers })).json() as {
        data: { overview: { openIssues: number } };
      };
      expect(resolvedDashboard.data.overview.openIssues).toBe(0);
      const operations = (await app.inject({ method: 'GET', url: '/api/v1/admin/user-operations', headers })).json() as {
        data: { items: Array<{ email: string; failures: Array<Record<string, unknown>>; books: Array<Record<string, unknown>> }> };
      };
      const author = operations.data.items.find((item) => item.email === 'author-audit@example.com');
      expect(author?.failures).toEqual([expect.objectContaining({
        taskId: 'v7-title-failed-1', bookId, taskType: 'title_design', errorSummary: '模型没有返回有效书名'
      })]);
      expect(author?.books[0]).toEqual(expect.objectContaining({
        bookId, latestTaskId: 'v7-title-failed-1', latestTaskStatus: 'failed'
      }));
      const resolvedAt = String((resolved.json() as { data: { updatedAt: string } }).data.updatedAt);
      const failedAgainAt = new Date(Date.parse(resolvedAt) + 1_000).toISOString();
      context.database.prepare(`UPDATE v7_book_title_design_calls
        SET failure_message='重试后再次失败',updated_at=? WHERE design_id='v7-title-failed-1'`).run(failedAgainAt);
      const reopenedDashboard = (await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers })).json() as {
        data: { overview: { openIssues: number } };
      };
      expect(reopenedDashboard.data.overview.openIssues).toBe(1);
      const reopened = (await app.inject({
        method: 'GET',
        url: `/api/v1/admin/issues?source=failed_task&status=open&query=${encodeURIComponent('重试后再次失败')}`,
        headers
      })).json() as { data: { total: number; items: Array<Record<string, unknown>> } };
      expect(reopened.data.total).toBe(1);
      expect(reopened.data.items).toEqual([expect.objectContaining({
        sourceId: 'title:v7-title-failed-1', status: 'open', severity: 'high', note: '已核实',
        detail: '重试后再次失败', occurredAt: failedAgainAt
      })]);
      expect(context.database.prepare(`SELECT status,severity,admin_note FROM admin_issue_records
        WHERE source_type='failed_task' AND source_id='title:v7-title-failed-1'`).get())
        .toEqual({ status: 'resolved', severity: 'high', admin_note: '已核实' });
    } finally {
      await app.close();
    }
  });

  it('设定审计覆盖普通条目和没有 job 的推荐、总审、重设计、融合与作者修订任务', async () => {
    context = createTestContext('wenmi-v7-admin-setting-audit-');
    const app = await createV7Server(context.config, context.database);
    try {
      const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin-setting-audit@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const author = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'author-setting-audit@example.com', password: 'strong-pass-456', displayName: '设定审计作者' } });
      const account = context.database.prepare(`SELECT owner_id FROM user_accounts WHERE email_normalized=?`)
        .get('author-setting-audit@example.com') as { owner_id: string };
      const now = new Date().toISOString();
      const bookId = 'v7-admin-setting-audit-book';
      new BookRepository(context.database).create({ ownerId: account.owner_id, bookId }, 'V7设定审计书', now, 'active');
      const insertBatch = context.database.prepare(`INSERT INTO v7_setting_batches(
        batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,
        opening_version,opening_hash,roster_json,error_message,error_code,failure_stage,retry_safety,created_at,updated_at
      ) VALUES(?,?,?,?,?,'partially_failed',?,?,?,?,?,?,?,?,?,?,?)`);
      const insertJob = context.database.prepare(`INSERT INTO v7_setting_item_jobs(
        job_id,owner_id,book_id,batch_id,item_key,item_label,group_title,item_prompt,state,
        attempted_members_json,author_note,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,'failed','[]','',?,?)`);
      insertBatch.run(
        'setting-item-batch', account.owner_id, bookId, 'setting-item-audit', 'a'.repeat(64),
        JSON.stringify(['world']), '[]', 1, 'b'.repeat(64), '[]', '会员算力不足，尚未发送模型',
        'MEMBERSHIP_QUOTA_EXHAUSTED', 'pre_dispatch', 'safe_after_precondition', now, now
      );
      insertJob.run(
        'setting-item-job', account.owner_id, bookId, 'setting-item-batch', 'world', '世界设定', '世界', '设计世界', now, now
      );
      const syntheticTasks: Array<{
        id: string;
        key: string;
        taskKind: 'catalog_recommendation' | 'batch_final_review' | 'item_redesign' | 'item_fusion' | 'item_revision';
        phase?: string;
        itemKey?: string;
        code: string;
      }> = [
        { id: 'setting-catalog-task', key: 'catalog-audit-key', taskKind: 'catalog_recommendation',
          phase: 'failed', code: 'CATALOG_FAILED' },
        { id: 'setting-final-task', key: 'final-review-audit', taskKind: 'batch_final_review',
          phase: 'failed', code: 'FINAL_REVIEW_FAILED' },
        { id: 'setting-redesign-task', key: 'redesign-audit-key', taskKind: 'item_redesign',
          itemKey: 'world', code: 'REDESIGN_FAILED' },
        { id: 'setting-fusion-task', key: 'fusion-audit-key', taskKind: 'item_fusion',
          itemKey: 'world', code: 'FUSION_FAILED' },
        { id: 'setting-revision-task', key: 'author-audit-key', taskKind: 'item_revision',
          itemKey: 'world', code: 'REVISION_FAILED' }
      ];
      for (const [index, task] of syntheticTasks.entries()) {
        insertBatch.run(
          task.id, account.owner_id, bookId, task.key, String(index + 1).repeat(64),
          JSON.stringify([task.itemKey ?? '__setting_catalog__']),
          JSON.stringify({ taskKind: task.taskKind, phase: task.phase, itemKey: task.itemKey, assignedMemberKey: 'chief-audit' }),
          1, String(index + 2).repeat(64), '[]', `${task.taskKind}没有完成`, task.code,
          'post_dispatch', 'manual_redesign', now, now
        );
      }
      const jobTasks = [
        { batchId: 'setting-fusion-job-batch', jobId: 'setting-fusion-job', key: 'fusion-job-audit',
          taskKind: 'item_fusion', errorCode: 'FUSION_JOB_FAILED' },
        { batchId: 'setting-review-job-batch', jobId: 'setting-review-job', key: 'review-job-audit',
          taskKind: 'item_review', errorCode: 'REVIEW_JOB_FAILED' },
        { batchId: 'setting-revision-job-batch', jobId: 'setting-revision-job', key: 'revision-job-audit',
          taskKind: 'item_revision', errorCode: 'REVISION_JOB_FAILED' }
      ] as const;
      for (const [index, task] of jobTasks.entries()) {
        insertBatch.run(
          task.batchId, account.owner_id, bookId, task.key, String(index + 6).repeat(64),
          JSON.stringify(['world']), JSON.stringify({ taskKind: task.taskKind, itemKey: 'world' }),
          1, String(index + 7).repeat(64), '[]', `${task.taskKind}有 job 但没有完成`, task.errorCode,
          'post_dispatch', 'technical_retry', now, now
        );
        insertJob.run(
          task.jobId, account.owner_id, bookId, task.batchId, 'world', '世界设定', '世界', '重新核查世界设定', now, now
        );
      }
      context.database.prepare(`INSERT INTO v7_opening_agent_tasks(
        task_id,owner_id,idempotency_key,request_hash,idea_text,idea_version,idea_hash,
        status,phase,error_code,error_message,created_at,updated_at
      ) VALUES(?,?,?,?,?,1,?,'failed','archived','archived_by_author',NULL,?,?)`).run(
        'opening-archived-task', account.owner_id, 'opening-archived-audit', 'c'.repeat(64),
        '作者已经主动放弃这次开书任务。', 'd'.repeat(64), now, now
      );
      expect(new V7TaskAuditRepository(context.database).bySourceId('opening:opening-archived-task'))
        .toEqual(expect.objectContaining({ status: 'archived', errorCode: 'archived_by_author' }));

      const headers = { host: HEADERS.host, cookie: cookieFrom(admin) };
      const dashboard = (await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers })).json() as {
        data: { overview: { failedTasksToday: number; openIssues: number } };
      };
      expect(dashboard.data.overview).toEqual(expect.objectContaining({ failedTasksToday: 9, openIssues: 9 }));
      const issues = (await app.inject({ method: 'GET', url: '/api/v1/admin/issues?source=failed_task&limit=20', headers })).json() as {
        data: { items: Array<Record<string, unknown>> };
      };
      expect(issues.data.items).toHaveLength(9);
      expect(issues.data.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'setting:setting-item-job', taskId: 'setting-item-job', category: 'setting_item',
          errorCode: 'MEMBERSHIP_QUOTA_EXHAUSTED', failureStage: 'pre_dispatch', retrySafety: 'safe_after_precondition'
        }),
        expect.objectContaining({ sourceId: 'setting-batch:setting-catalog-task', category: 'setting_catalog_recommendation' }),
        expect.objectContaining({ sourceId: 'setting-batch:setting-final-task', category: 'setting_final_review' }),
        expect.objectContaining({ sourceId: 'setting-batch:setting-redesign-task', category: 'setting_item_redesign' }),
        expect.objectContaining({ sourceId: 'setting-batch:setting-fusion-task', category: 'setting_item_fusion' }),
        expect.objectContaining({ sourceId: 'setting:setting-fusion-job', category: 'setting_item_fusion' }),
        expect.objectContaining({ sourceId: 'setting:setting-review-job', category: 'setting_item_review' }),
        expect.objectContaining({ sourceId: 'setting:setting-revision-job', category: 'setting_item_review' }),
        expect.objectContaining({
          sourceId: 'setting-batch:setting-revision-task', category: 'setting_item_revision',
          failureStage: 'post_dispatch', retrySafety: 'manual_redesign'
        })
      ]));
      const operations = (await app.inject({ method: 'GET', url: '/api/v1/admin/user-operations', headers })).json() as {
        data: { items: Array<{
          email: string;
          failures: Array<Record<string, unknown>>;
          today: { taskCount: number; failureCount: number };
        }> };
      };
      const auditedAuthor = operations.data.items.find((item) => item.email === 'author-setting-audit@example.com');
      expect(auditedAuthor?.today).toEqual(expect.objectContaining({ taskCount: 10, failureCount: 9 }));
      expect(auditedAuthor?.failures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          taskId: 'setting-item-job', errorCode: 'MEMBERSHIP_QUOTA_EXHAUSTED',
          failureStage: 'pre_dispatch', retrySafety: 'safe_after_precondition'
        }),
        expect.objectContaining({ taskId: 'setting-redesign-task', taskType: 'setting_item_redesign' }),
        expect.objectContaining({ taskId: 'setting-fusion-job', taskType: 'setting_item_fusion' }),
        expect.objectContaining({ taskId: 'setting-review-job', taskType: 'setting_item_review' })
      ]));
      const feedback = await app.inject({ method: 'POST', url: '/api/v1/feedback',
        headers: { ...HEADERS, cookie: cookieFrom(author) },
        payload: { bookId, taskId: 'setting-fusion-task', category: 'bug', message: '融合任务失败需要核查' } });
      expect(feedback.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('问题筛选在完整数据集上统计和分页，不会丢掉五百条之后的待处理记录', async () => {
    context = createTestContext('wenmi-v7-admin-issue-page-');
    const app = await createV7Server(context.config, context.database);
    try {
      const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin-issue-page@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'author-issue-page@example.com', password: 'strong-pass-456', displayName: '分页作者' } });
      const administrator = context.database.prepare(`SELECT user_id FROM user_accounts WHERE email_normalized=?`)
        .get('admin-issue-page@example.com') as { user_id: string };
      const author = context.database.prepare(`SELECT user_id,owner_id FROM user_accounts WHERE email_normalized=?`)
        .get('author-issue-page@example.com') as { user_id: string; owner_id: string };
      const insertFeedback = context.database.prepare(`INSERT INTO user_feedback(
        feedback_id,user_id,owner_id,category,message,page_path,recovery_key,created_at,updated_at
      ) VALUES(?,?,?,'bug',?,'/audit-page','',?,?)`);
      const insertRecord = context.database.prepare(`INSERT INTO admin_issue_records(
        issue_record_id,source_type,source_id,status,severity,admin_note,updated_by_user_id,created_at,updated_at
      ) VALUES(?,'feedback',?,'resolved','low','批量已处理',?,?,?)`);
      const base = Date.parse('2026-08-01T00:00:00.000Z');
      const handledAt = '2026-09-01T00:00:00.000Z';
      context.database.exec('BEGIN IMMEDIATE');
      try {
        for (let index = 0; index <= 500; index += 1) {
          const id = `feedback-page-${String(index).padStart(3, '0')}`;
          const createdAt = new Date(base + index * 1_000).toISOString();
          insertFeedback.run(
            id, author.user_id, author.owner_id,
            index === 0 ? '更早开放针记录' : `批量问题记录 ${index}`,
            createdAt, createdAt
          );
          if (index > 0) insertRecord.run(`issue-page-${index}`, id, administrator.user_id, handledAt, handledAt);
        }
        context.database.exec('COMMIT');
      } catch (error) {
        context.database.exec('ROLLBACK');
        throw error;
      }

      const headers = { host: HEADERS.host, cookie: cookieFrom(admin) };
      const olderOpen = (await app.inject({
        method: 'GET',
        url: `/api/v1/admin/issues?source=feedback&status=open&query=${encodeURIComponent('更早开放针')}&limit=1`,
        headers
      })).json() as { data: { total: number; items: Array<Record<string, unknown>> } };
      expect(olderOpen.data.total).toBe(1);
      expect(olderOpen.data.items).toEqual([expect.objectContaining({
        sourceType: 'feedback', sourceId: 'feedback-page-000', status: 'open', detail: '更早开放针记录'
      })]);
      const resolvedPage = (await app.inject({
        method: 'GET',
        url: `/api/v1/admin/issues?source=feedback&status=resolved&query=${encodeURIComponent('批量问题记录')}&offset=123&limit=2`,
        headers
      })).json() as { data: { total: number; items: Array<Record<string, unknown>> } };
      expect(resolvedPage.data.total).toBe(500);
      expect(resolvedPage.data.items).toHaveLength(2);
      expect(resolvedPage.data.items.every((item) => item.status === 'resolved' && item.sourceType === 'feedback')).toBe(true);
    } finally {
      await app.close();
    }
  });
});
