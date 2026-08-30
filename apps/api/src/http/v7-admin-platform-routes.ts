import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { success } from '../contracts/api.js';
import { requireAdministrator } from '../infrastructure/security/auth-context.js';
import { accountUsageRelation } from '../infrastructure/security/account-usage-service.js';

/** V7 独立后台当前使用的平台级接口。 */
export async function registerV7AdminPlatformRoutes(
  app: FastifyInstance,
  database: DatabaseSync
): Promise<void> {
  app.get('/api/v1/admin/usage', async (request) => {
    requireAdministrator(request);
    const usageRelation = accountUsageRelation(database);
    const totals = database.prepare(`
      SELECT COALESCE(SUM(CASE WHEN usage_state='consumed' THEN consumed_tokens ELSE 0 END), 0) AS total_tokens,
             COALESCE(SUM(CASE WHEN usage_state='consumed' THEN input_tokens ELSE 0 END), 0) AS total_input_tokens,
             COALESCE(SUM(CASE WHEN usage_state='consumed' THEN output_tokens ELSE 0 END), 0) AS total_output_tokens,
             COALESCE(SUM(CASE WHEN usage_state='consumed' THEN cash_micros ELSE 0 END), 0) AS total_cash_micros,
             COALESCE(SUM(CASE WHEN usage_state='consumed' THEN consumed_units ELSE 0 END), 0) AS total_image_units,
             COALESCE(SUM(CASE WHEN usage_state='reserved' THEN reserved_units ELSE 0 END), 0) AS total_reserved_image_units,
             COALESCE(SUM(CASE WHEN usage_state='consumed' THEN 1 ELSE 0 END), 0) AS total_calls
      FROM ${usageRelation}
    `).get() as {
      total_tokens: number; total_input_tokens: number; total_output_tokens: number;
      total_cash_micros: number; total_image_units: number; total_reserved_image_units: number; total_calls: number;
    };
    const perUser = database.prepare(`
      SELECT a.user_id AS userId, a.email_normalized AS email, a.display_name AS displayName,
             a.role, a.status, a.created_at AS createdAt, a.last_login_at AS lastLoginAt,
             (SELECT COUNT(*) FROM books b WHERE b.owner_id = a.owner_id AND b.status <> 'purged') AS books,
             COALESCE((SELECT SUM(l.consumed_tokens) FROM ${usageRelation} l
               WHERE l.owner_id = a.owner_id AND l.usage_state = 'consumed'), 0) AS tokens,
             COALESCE((SELECT COUNT(*) FROM ${usageRelation} l
               WHERE l.owner_id = a.owner_id AND l.usage_state = 'consumed'), 0) AS calls,
             COALESCE((SELECT SUM(l.cash_micros) FROM ${usageRelation} l
               WHERE l.owner_id = a.owner_id AND l.usage_state = 'consumed'), 0) AS cashMicros,
             COALESCE((SELECT SUM(l.consumed_units) FROM ${usageRelation} l
               WHERE l.owner_id = a.owner_id AND l.usage_state = 'consumed'), 0) AS imageUnits,
             COALESCE((SELECT SUM(l.reserved_units) FROM ${usageRelation} l
               WHERE l.owner_id = a.owner_id AND l.usage_state = 'reserved'), 0) AS reservedImageUnits
      FROM user_accounts a
      ORDER BY tokens DESC, a.created_at DESC
    `).all();
    const perModel = database.prepare(`
      SELECT provider, model_id AS modelId, COUNT(*) AS calls,
             SUM(consumed_tokens) AS tokens,
             SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
             SUM(cash_micros) AS cashMicros, SUM(consumed_units) AS imageUnits
      FROM ${usageRelation}
      WHERE usage_state = 'consumed'
      GROUP BY provider, model_id
      ORDER BY tokens DESC
    `).all();
    const daily = database.prepare(`
      SELECT substr(recorded_at, 1, 10) AS day,
             SUM(input_tokens + output_tokens) AS tokens,
             SUM(cash_micros) AS cashMicros,
             SUM(consumed_units) AS imageUnits,
             COUNT(*) AS calls
      FROM ${usageRelation}
      WHERE usage_state = 'consumed'
      GROUP BY day
      ORDER BY day DESC
      LIMIT 30
    `).all();
    return success({
      totalTokens: Number(totals.total_tokens),
      totalInputTokens: Number(totals.total_input_tokens),
      totalOutputTokens: Number(totals.total_output_tokens),
      totalCashMicros: Number(totals.total_cash_micros),
      totalImageUnits: Number(totals.total_image_units),
      totalReservedImageUnits: Number(totals.total_reserved_image_units),
      totalCalls: Number(totals.total_calls),
      perUser, perModel, daily
    }, request.id);
  });
}
