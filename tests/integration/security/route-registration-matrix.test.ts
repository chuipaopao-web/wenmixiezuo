/**
 * AUTH-TAKEOVER-01 返工1：路由注册授权矩阵。
 * 用真实登录cookie + 有权限请求 + 预期业务响应结构证明路由已注册并接通业务服务
 * （匿名401可由全局策略拦截未知路径产生，不构成注册证据）。
 */
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../helpers/test-context.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';

const HEADERS = { host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };

describe('AUTH-TAKEOVER-01 路由注册授权矩阵', () => {
  it('管理员与作者代表路由：有权限请求返回预期业务响应结构', async () => {
    const c = createTestContext('route-matrix-');
    const app = await createAppServer(c.config, c.database);
    try {
      const adminRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email: 'matrix-admin@example.com', displayName: '管理员', password: 'Strong-test-pass-123!' } });
      expect(adminRegister.statusCode).toBe(200);
      const adminCookie = String(adminRegister.headers['set-cookie']).split(';')[0]!;
      const userRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email: 'matrix-user@example.com', displayName: '作者', password: 'Strong-user-pass-123!' } });
      expect(userRegister.statusCode).toBe(200);
      const userCookie = String(userRegister.headers['set-cookie']).split(';')[0]!;
      const admin = { ...HEADERS, cookie: adminCookie };
      const user = { ...HEADERS, cookie: userCookie };

      // 管理员面：账号/平台/创作库/时光机/Agent治理/功能台账
      const overview = await app.inject({ url: '/api/v1/admin/overview', headers: admin });
      expect(overview.statusCode).toBe(200);
      expect(typeof (overview.json().data as { totalUsers: number }).totalUsers).toBe('number');
      const platform = await app.inject({ url: '/api/v1/admin/dashboard', headers: admin });
      expect(platform.statusCode).toBe(200);
      expect((platform.json().data as { overview: unknown }).overview).toBeDefined();
      const creative = await app.inject({ url: '/api/v1/admin/creative-reference/cards', headers: admin });
      expect(creative.statusCode).toBe(200);
      expect(Array.isArray((creative.json().data as { items: unknown[] }).items)).toBe(true);
      const timeMachine = await app.inject({ url: '/api/v1/admin/time-machine/runs', headers: admin });
      expect(timeMachine.statusCode).toBe(200);
      expect(Array.isArray((timeMachine.json().data as { runs: unknown[] }).runs)).toBe(true);
      const governance = await app.inject({ url: '/api/v1/admin/v7/agent-governance', headers: admin });
      expect(governance.statusCode).toBe(200);
      expect((governance.json().data as { summary: unknown }).summary).toBeDefined();
      const capabilities = await app.inject({ url: '/api/v1/admin/feature-capabilities', headers: admin });
      expect(capabilities.statusCode).toBe(200);
      expect((capabilities.json().data as { modules: unknown[] }).modules.length).toBeGreaterThan(10);

      // 作者面：会员/开书任务/设定任务（owner来自会话）
      const membership = await app.inject({ url: '/api/v1/membership/me', headers: user });
      expect(membership.statusCode).toBe(200);
      expect((membership.json().data as { plans: unknown[] }).plans.length).toBeGreaterThan(0);
      const openingTasks = await app.inject({ url: '/api/v1/v7/opening-agent/tasks?limit=5', headers: user });
      expect(openingTasks.statusCode).toBe(200);
      expect(Array.isArray(openingTasks.json().data)).toBe(true);
      const settingTasks = await app.inject({ url: '/api/v1/v7/setting-tasks?limit=5', headers: user });
      expect(settingTasks.statusCode).toBe(200);
      const taxonomy = await app.inject({ url: '/api/v1/v7/opening-taxonomy', headers: user });
      expect(taxonomy.statusCode).toBe(200);
      expect((taxonomy.json().data as Record<string, unknown>)).toBeDefined();

      // 同一批路由对普通用户的管理面保持403（权限矩阵另一侧）
      for (const url of ['/api/v1/admin/overview', '/api/v1/admin/creative-reference/cards', '/api/v1/admin/time-machine/runs']) {
        expect((await app.inject({ url, headers: user })).statusCode, url).toBe(403);
      }
    } finally {
      await app.close();
      c.close();
    }
  }, 120_000);
});
