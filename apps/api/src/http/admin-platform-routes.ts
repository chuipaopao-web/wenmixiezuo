import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { success } from '../contracts/api.js';
import { requireAdministrator } from '../infrastructure/security/auth-context.js';
import type { NovelRoleKey, RoleModelProfile } from '../infrastructure/models/model-runtime-config.js';
import type { PlatformModelSchemeService } from '../application/agents/platform-model-scheme-service.js';
import { toCreativeProfiles } from '../application/agents/model-binding-service.js';

/** 管理后台平台级接口：全局算力消耗与全员模型方案管理，全部要求管理员身份。 */
export async function registerAdminPlatformRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  roleProfiles: Record<NovelRoleKey, RoleModelProfile>,
  schemes: PlatformModelSchemeService
): Promise<void> {
  app.get('/api/v1/admin/usage', async (request) => {
    requireAdministrator(request);
    const totals = database.prepare(`
      SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
             COALESCE(SUM(cash_micros), 0) AS total_cash_micros,
             COUNT(*) AS total_calls
      FROM usage_ledger
    `).get() as { total_tokens: number; total_cash_micros: number; total_calls: number };
    const perUser = database.prepare(`
      SELECT a.user_id AS userId, a.email_normalized AS email, a.display_name AS displayName,
             a.role, a.status, a.created_at AS createdAt, a.last_login_at AS lastLoginAt,
             (SELECT COUNT(*) FROM books b WHERE b.owner_id = a.owner_id AND b.status <> 'purged') AS books,
             COALESCE((SELECT SUM(l.input_tokens + l.output_tokens) FROM usage_ledger l WHERE l.owner_id = a.owner_id), 0) AS tokens,
             COALESCE((SELECT COUNT(*) FROM usage_ledger l WHERE l.owner_id = a.owner_id), 0) AS calls
      FROM user_accounts a
      ORDER BY tokens DESC, a.created_at DESC
    `).all();
    const perModel = database.prepare(`
      SELECT provider, model_id AS modelId, COUNT(*) AS calls,
             SUM(input_tokens + output_tokens) AS tokens
      FROM usage_ledger
      GROUP BY provider, model_id
      ORDER BY tokens DESC
    `).all();
    const daily = database.prepare(`
      SELECT substr(recorded_at, 1, 10) AS day,
             SUM(input_tokens + output_tokens) AS tokens,
             COUNT(*) AS calls
      FROM usage_ledger
      GROUP BY day
      ORDER BY day DESC
      LIMIT 30
    `).all();
    return success({
      totalTokens: Number(totals.total_tokens),
      totalCashMicros: Number(totals.total_cash_micros),
      totalCalls: Number(totals.total_calls),
      perUser, perModel, daily
    }, request.id);
  });

  app.get('/api/v1/admin/model-scheme', async (request) => {
    requireAdministrator(request);
    return success(schemes.describe(roleProfiles, toCreativeProfiles(roleProfiles)), request.id);
  });

  app.post<{ Body: { profiles?: unknown; reason?: string } }>('/api/v1/admin/model-scheme', async (request) => {
    const administrator = requireAdministrator(request);
    return success(schemes.save(administrator.userId, request.body?.profiles, roleProfiles, request.body?.reason), request.id);
  });
}
