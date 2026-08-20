import { describe, expect, it } from 'vitest';
import { projectAuthorApiValue, shouldProjectAuthorResponse } from '../../apps/api/src/http/author-api-projection.js';

describe('作者API投影门', () => {
  it('递归改名恢复键并删除模型、方法、调用和错误原件', () => {
    const value = projectAuthorApiValue({ taskId: 'task-1', discussionId: 'discussion-1', agentId: 'agent-1',
      errorMessage: 'SQL C:\\secret\\db.sqlite', provider: 'hidden', modelId: 'hidden-model', methodKey: 'three_act',
      nested: { sourceTaskId: 'source', checkpoint: { workerId: 'worker', done: true } },
      modelCalls: [{ error_detail: 'stack' }] }) as Record<string, unknown>;
    expect(value).toMatchObject({ recoveryKey: 'task-1', collaborationKey: 'discussion-1', memberKey: 'agent-1',
      recoveryMessage: expect.stringContaining('可以重试'), nested: { recoveryProgress: { done: true } } });
    expect(JSON.stringify(value)).not.toMatch(/taskId|discussionId|agentId|provider|modelId|methodKey|sourceTaskId|workerId|modelCalls|SQL|secret|sqlite/iu);
  });

  it('仅对新版普通作者成功响应生效，管理员和内部路由保留原件', () => {
    const headers = { 'x-wenmi-author-projection': 'clean-v1' };
    expect(shouldProjectAuthorResponse('/api/v1/books/book-1/workspace', 200, headers)).toBe(true);
    expect(shouldProjectAuthorResponse('/api/v1/admin/usage', 200, headers)).toBe(false);
    expect(shouldProjectAuthorResponse('/api/v1/internal/worker/tasks/t/execute', 200, headers)).toBe(false);
    expect(shouldProjectAuthorResponse('/api/v1/books/book-1/workspace', 500, headers)).toBe(true);
    expect(shouldProjectAuthorResponse('/api/v1/books/book-1/workspace', 200, {})).toBe(false);
  });
  it('把新版作者失败响应改成大白话业务动作，不返回错误代码、详情或原始路径', () => {
    const projected = projectAuthorApiValue({
      error: {
        code: 'PROVIDER_DATABASE_FAILURE',
        message: 'SQL C:\\private\\wenmi.sqlite provider modelId stack',
        details: { table: 'model_calls', workerId: 'worker-secret' },
        retryable: true
      },
      meta: { requestId: 'request-recovery-1' }
    }) as Record<string, unknown>;
    expect(projected).toEqual({
      error: {
        message: expect.stringContaining('已经保存'),
        action: 'retry_later',
        retryable: true
      },
      meta: { recoveryKey: 'request-recovery-1' }
    });
    expect(JSON.stringify(projected)).not.toMatch(/code|details|SQL|sqlite|provider|modelId|stack|worker/iu);
  });

});