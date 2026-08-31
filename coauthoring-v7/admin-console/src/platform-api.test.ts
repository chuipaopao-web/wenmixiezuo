// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ADMIN_AUTHENTICATION_REQUIRED_EVENT,
  fetchCurrentAccount,
  fetchFeatureCapabilities,
  fetchMembershipUsers,
  fetchMembershipStats,
  fetchPlatformDashboard,
  fetchPlatformIssues,
  fetchPlatformUsers,
  fetchPlatformUsage,
  fetchUserOperations,
  fetchV7OpeningAgentGovernance,
  fetchV7PromptAssets,
  fetchV7PromptAssetVersions,
  fetchV7PromptContextSummary,
  fetchV7PromptManifest,
  fetchV7PromptManifests,
  grantMembership,
  loginAccount,
  platformRequest,
  previewV7PromptAssetVersion,
  publishV7PromptAssetVersion,
  revokeMembership,
  restoreV7PromptAssetDraft,
  saveV7PromptAssetDraft,
  setPlatformUserStatus,
  updatePlatformIssue,
  updateV7OpeningAgentMember
} from './platform-api';

describe('V7 管理后台平台 API 适配', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('未登录身份核验返回 null，不伪装管理员', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ error: { message: '请先登录' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCurrentAccount()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/me', expect.objectContaining({ credentials: 'include' }));
  });

  test('登录请求只通过现有认证接口并携带同源 Cookie', async () => {
    const account = { userId: 'admin-1', email: 'admin@example.com', displayName: '老板', role: 'admin', status: 'active' } as const;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: { account, expiresInSeconds: 3600 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loginAccount({ email: account.email, password: 'test-password' })).resolves.toEqual({ account, expiresInSeconds: 3600 });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ email: account.email, password: 'test-password' })
    }));
  });

  test('生产运营页面只调用既有管理员只读接口', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([
      fetchPlatformDashboard(), fetchUserOperations(), fetchPlatformUsage(), fetchPlatformIssues(), fetchMembershipStats()
    ]);
    const paths = fetchMock.mock.calls.map(([path]) => path);
    expect(paths).toEqual([
      '/api/v1/admin/dashboard',
      '/api/v1/admin/user-operations',
      '/api/v1/admin/usage',
      '/api/v1/admin/issues?limit=100',
      '/api/v1/admin/membership-stats'
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
  });

  test('功能台账筛选复用管理员只读接口并正确编码查询', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchFeatureCapabilities({
      baseline: 'previous-production',
      status: 'suspected_missing',
      moduleId: 'author/books',
      query: '归档 恢复'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/feature-capabilities?baseline=previous-production&status=suspected_missing&moduleId=author%2Fbooks&query=%E5%BD%92%E6%A1%A3+%E6%81%A2%E5%A4%8D',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  test('图片已制作与制作中占用保持为清晰的页面数据', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
      const data = String(input).endsWith('/dashboard')
        ? { overview: { imageUnitsToday: 4, reservedImageUnits: 2 }, trend: [{ imageUnits: 1 }], topUsers: [{ imageUnits: 3 }] }
        : { totalImageUnits: 6, totalReservedImageUnits: 2, perUser: [{ imageUnits: 5, reservedImageUnits: 2 }], perModel: [{ imageUnits: 5 }], daily: [{ imageUnits: 5 }] };
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const dashboard = await fetchPlatformDashboard();
    const usage = await fetchPlatformUsage();

    expect(dashboard.overview).toMatchObject({ imageUnitsToday: 4, reservedImageUnits: 2 });
    expect(usage).toMatchObject({ totalImageUnits: 6, totalReservedImageUnits: 2 });
    expect(usage.perUser[0]).toMatchObject({ imageUnits: 5, reservedImageUnits: 2 });
  });

  test('用户、会员和问题写操作复用既有管理员路由与字段', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPlatformUsers();
    await setPlatformUserStatus('user/1', 'suspended');
    await fetchMembershipUsers();
    await grantMembership('user/1', { plan: 'gold', amountCny: 198, note: '线下转账', idempotencyKey: 'membership-grant-0001' });
    await revokeMembership('user/1', 'membership-revoke-0001');
    await updatePlatformIssue({ sourceType: 'feedback', sourceId: 'feedback/1' }, { status: 'resolved', severity: 'high', note: '已修复' });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/admin/users?limit=100',
      '/api/v1/admin/users/user%2F1/status',
      '/api/v1/admin/memberships?limit=100',
      '/api/v1/admin/memberships/user%2F1',
      '/api/v1/admin/memberships/user%2F1/revoke',
      '/api/v1/admin/issues/feedback/feedback%2F1'
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: 'PATCH', credentials: 'include', body: JSON.stringify({ status: 'suspended' })
    }));
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ plan: 'gold', amountCny: 198, note: '线下转账', idempotencyKey: 'membership-grant-0001' })
    }));
    expect(fetchMock.mock.calls[4]?.[1]).toEqual(expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ idempotencyKey: 'membership-revoke-0001' })
    }));
    expect(fetchMock.mock.calls[5]?.[1]).toEqual(expect.objectContaining({
      method: 'PATCH', credentials: 'include', body: JSON.stringify({ status: 'resolved', severity: 'high', note: '已修复' })
    }));
  });

  test('受保护业务请求返回 401 时只派发一次全局认证失效事件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: '请先登录' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })));
    const listener = vi.fn();
    window.addEventListener(ADMIN_AUTHENTICATION_REQUIRED_EVENT, listener);

    await expect(platformRequest('/api/v1/admin/users?limit=100')).rejects.toThrow('请先登录');
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(ADMIN_AUTHENTICATION_REQUIRED_EVENT, listener);
  });

  test('登录凭据错误留在登录表单，不派发业务会话失效事件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: '邮箱或密码不正确' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })));
    const listener = vi.fn();
    window.addEventListener(ADMIN_AUTHENTICATION_REQUIRED_EVENT, listener);

    await expect(loginAccount({ email: 'wrong@example.com', password: 'wrong-password' })).rejects.toThrow('邮箱或密码不正确');
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(ADMIN_AUTHENTICATION_REQUIRED_EVENT, listener);
  });

  test('不把数据库或密钥类内部错误暴露到 V7 页面', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'SQLite node_modules stack sk-secret-12345678' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })));
    await expect(platformRequest('/api/v1/admin/dashboard')).rejects.toThrow('请求没有成功（500）');
  });

  test('AI成员页面使用管理员接口、Cookie和岗位版本更新', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: {
      summary: { roleCount: 2, memberCount: 6, enabledMemberCount: 6, unavailableMemberCount: 0 },
      credentials: { codingPlanConfigured: true, agentPlanConfigured: true },
      roles: []
    } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchV7OpeningAgentGovernance();
    await updateV7OpeningAgentMember('chief-kimi-k3', {
      expectedRevision: 3,
      defaultForRole: true,
      promptInstruction: '优先生成具体、直给、有卖点的商业书名。',
      reason: '切换默认主编'
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/v7/opening-agent/members');
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/v1/admin/v7/opening-agent/members/chief-kimi-k3',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          expectedRevision: 3,
          defaultForRole: true,
          promptInstruction: '优先生成具体、直给、有卖点的商业书名。',
          reason: '切换默认主编'
        })
      })
    ]);
  });

  test('提示词与上下文中心使用独立版本接口并保留并发版本', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchV7PromptContextSummary();
    await fetchV7PromptAssets({ kind: 'workstation_prompt', search: '全书路线' });
    await fetchV7PromptAssetVersions('workstation.full_book_route');
    await saveV7PromptAssetDraft('workstation.full_book_route', {
      expectedRevision: 3,
      basedOnAssetId: 'workstation.full_book_route@3',
      kind: 'workstation_prompt',
      title: '全书路线工位',
      summary: '规划全书粗路线。',
      content: { responsibility: '形成可展开的全书方向' },
      reason: '管理员保存修改草稿'
    });
    await previewV7PromptAssetVersion('workstation.full_book_route', 'workstation.full_book_route@4');
    await publishV7PromptAssetVersion('workstation.full_book_route', {
      assetId: 'workstation.full_book_route@4', expectedRevision: 4
    });
    await restoreV7PromptAssetDraft('workstation.full_book_route', {
      sourceAssetId: 'workstation.full_book_route@2', expectedRevision: 5
    });
    await fetchV7PromptManifests({ ownerId: 'owner-1', bookId: 'book-1', taskId: 'task-1', limit: 20 });
    await fetchV7PromptManifest('manifest-1');

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/admin/v7/prompt-context/summary',
      '/api/v1/admin/v7/prompt-context/assets?kind=workstation_prompt&search=%E5%85%A8%E4%B9%A6%E8%B7%AF%E7%BA%BF',
      '/api/v1/admin/v7/prompt-context/assets/workstation.full_book_route/versions',
      '/api/v1/admin/v7/prompt-context/assets/workstation.full_book_route/drafts',
      '/api/v1/admin/v7/prompt-context/assets/workstation.full_book_route/preview',
      '/api/v1/admin/v7/prompt-context/assets/workstation.full_book_route/publish',
      '/api/v1/admin/v7/prompt-context/assets/workstation.full_book_route/restore-draft',
      '/api/v1/admin/v7/prompt-context/manifests?ownerId=owner-1&bookId=book-1&taskId=task-1&limit=20',
      '/api/v1/admin/v7/prompt-context/manifests/manifest-1'
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      expectedRevision: 3,
      basedOnAssetId: 'workstation.full_book_route@3',
      kind: 'workstation_prompt',
      title: '全书路线工位',
      summary: '规划全书粗路线。',
      content: { responsibility: '形成可展开的全书方向' },
      reason: '管理员保存修改草稿'
    });
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ assetId: 'workstation.full_book_route@4' });
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({
      assetId: 'workstation.full_book_route@4', expectedRevision: 4
    });
    expect(JSON.parse(String(fetchMock.mock.calls[6]?.[1]?.body))).toEqual({
      sourceAssetId: 'workstation.full_book_route@2', expectedRevision: 5
    });
  });
});
