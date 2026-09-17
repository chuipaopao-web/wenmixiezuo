import { describe, it, expect } from 'vitest';
import { createTestContext } from '../../helpers/test-context.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { NodeEvaluationRepository } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';

// S1-FAST-CLOSE定向反例：服务端真实HTTP拒绝排名应用/回滚（不是只藏按钮）。
// 实验预览/未验收阶段，默认构造的V7NodeEvaluationService禁止apply/rollback。
describe('node-evaluations排名应用服务端禁止（S1-FAST-CLOSE）', () => {
  it('管理员POST apply/rollback被拒绝且不写策略；compute与视图仍可用', async () => {
    const c = createTestContext();
    const app = await createAppServer(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'fc-admin-1@example.com', displayName: '测试', password: 'Strong-test-pass-123!' } });
      expect(response.statusCode).toBe(200);
      const adminHeaders = { ...headers, cookie: String(response.headers['set-cookie']).split(';')[0]! };

      // 直接种一个draft排名行（绕过计算，只测应用入口）
      const repo = new NodeEvaluationRepository(c.database);
      const rankingId = repo.insertRanking({
        node_key: 'skeleton', length_band: 'all', config_version: 'cfg-validation-default',
        entries_json: JSON.stringify([{ rank: 1, modelProfileKey: 'deepseek-v4-pro' }]), evidence_json: '{}', created_by: 'seed'
      });

      const apply = await app.inject({ method: 'POST', url: `/api/v1/admin/v7/node-evaluations/rankings/${rankingId}/apply`, headers: adminHeaders, payload: {} });
      expect(apply.statusCode).toBeGreaterThanOrEqual(400);
      expect(apply.body).toContain('实验预览');
      const rollback = await app.inject({ method: 'POST', url: `/api/v1/admin/v7/node-evaluations/rankings/${rankingId}/rollback`, headers: adminHeaders, payload: {} });
      expect(rollback.statusCode).toBeGreaterThanOrEqual(400);
      expect(rollback.body).toContain('实验预览');

      // 未写任何策略、排名仍为draft
      expect(repo.nodePolicies('skeleton')).toHaveLength(0);
      expect(repo.readRanking(rankingId)!.status).toBe('draft');

      // 视图与compute入口仍可用（只读/草稿证据）
      expect((await app.inject({ url: '/api/v1/admin/v7/node-evaluations', headers: adminHeaders })).statusCode).toBe(200);
    } finally {
      await app.close();
      c.close();
    }
  });
});
