/**
 * R209-B2 创作库管理路由（返修版）：路由只做认证、参数解析与错误映射；
 * 全部管理写入（状态+意见+审计+发布请求）由CreativeReferenceAdminService在同一事务内完成。
 * 只管理创作参考库全局编辑资产；不导入旧库内容、不接AI检索、不触作者数据。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { success } from '../contracts/api.js';
import { DomainError, errorCodes } from '../domain/errors.js';
import { requireAdministrator } from '../infrastructure/security/auth-context.js';
import { SqliteCreativeReferenceRepository } from '../infrastructure/db/repositories/creative-reference-repository.js';
import { CreativeReferenceAdminRepository } from '../infrastructure/db/repositories/creative-reference-admin-repository.js';
import { CreativeReferenceAdminService } from '../application/creative-reference/admin-service.js';
import { CreativeReferenceService } from '../application/creative-reference/service.js';
// 领域公共面统一走桶导出（types/errors/validation/service），保持该面在运行闭包内。
import {
  AmbiguityError, AuthorizationError, ConflictError, CreativeReferenceError, CursorInvalidError,
  NotFoundError, ValidationError, validatePayload,
  type CardPayload, type LegacyRef
} from '../application/creative-reference/index.js';

const ASSET_KINDS = ['method', 'reference'] as const;
const AVAILABILITIES = ['draft', 'reviewed', 'published', 'retired'] as const;

function httpError(error: unknown): DomainError {
  if (error instanceof ValidationError) return new DomainError(errorCodes.validation, error.message, {}, false, 400);
  if (error instanceof AuthorizationError) return new DomainError('FORBIDDEN', error.message, {}, false, 403);
  if (error instanceof NotFoundError) return new DomainError('NOT_FOUND', error.message, {}, false, 404);
  if (error instanceof AmbiguityError) return new DomainError('AMBIGUOUS_LOOKUP', error.message, { candidates: error.candidates }, false, 409);
  if (error instanceof ConflictError) return new DomainError('CONFLICT', error.message, {}, false, 409);
  if (error instanceof CursorInvalidError) return new DomainError('CURSOR_INVALID', error.message, {}, false, 400);
  if (error instanceof CreativeReferenceError) return new DomainError(errorCodes.validation, error.message, {}, false, 400);
  if (error instanceof DomainError) return error;
  const message = error instanceof Error && error.message.includes('database is locked') ? '数据库正忙，请稍后重试。' : '这次没有完成，请稍后重试。';
  const retryable = error instanceof Error && error.message.includes('database is locked');
  return new DomainError(retryable ? 'DATABASE_BUSY' : 'INTERNAL_ERROR', message, {}, retryable, retryable ? 503 : 500);
}

async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) { throw httpError(error); }
}

function bodyRecord(request: { body: unknown }): Record<string, unknown> {
  if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
    throw new DomainError(errorCodes.validation, '请求体必须是JSON对象。', {}, false, 400);
  }
  return request.body as Record<string, unknown>;
}

function requireString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DomainError(errorCodes.validation, `${label}不能为空。`, {}, false, 400);
  if (value.length > max) throw new DomainError(errorCodes.validation, `${label}过长。`, {}, false, 400);
  return value;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new DomainError(errorCodes.validation, `${label}无效。`, {}, false, 400);
  }
  return value as T;
}

function optionalStringArray(value: unknown, label: string, max: number): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new DomainError(errorCodes.validation, `${label}必须是至多${max}个非空字符串。`, {}, false, 400);
  }
  return value.map(String);
}

function parseCursor(raw: unknown): { fingerprint: string; lastInternalId: string } | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new DomainError(errorCodes.validation, '游标格式无效。', {}, false, 400);
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { fingerprint?: unknown; lastInternalId?: unknown };
    if (typeof parsed.fingerprint !== 'string' || typeof parsed.lastInternalId !== 'string') throw new Error('bad');
    return { fingerprint: parsed.fingerprint, lastInternalId: parsed.lastInternalId };
  } catch { throw new DomainError(errorCodes.validation, '游标格式无效或损坏，请重置筛选。', {}, false, 400); }
}

function encodeCursor(cursor: { fingerprint: string; lastInternalId: string } | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** 冻结release条目游标：与B1 ReleaseEntriesCursor同形；编码不是安全验证，服务端校验releaseId绑定。 */
function parseReleaseEntriesCursor(raw: unknown): { releaseId: string; lastInternalId: string; filterFingerprint: string | null } | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new DomainError(errorCodes.validation, '游标格式无效。', {}, false, 400);
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { releaseId?: unknown; lastInternalId?: unknown; filterFingerprint?: unknown };
    if (typeof parsed.releaseId !== 'string' || typeof parsed.lastInternalId !== 'string') throw new Error('bad');
    return { releaseId: parsed.releaseId, lastInternalId: parsed.lastInternalId, filterFingerprint: typeof parsed.filterFingerprint === 'string' ? parsed.filterFingerprint : null };
  } catch { throw new DomainError(errorCodes.validation, '游标格式无效或损坏，请重新查询。', {}, false, 400); }
}

function encodeReleaseEntriesCursor(cursor: { releaseId: string; lastInternalId: string; filterFingerprint?: string | null } | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function parseLimit(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new DomainError(errorCodes.validation, '页大小必须在1至100之间。', {}, false, 400);
  return value;
}

function parsePayload(raw: unknown): CardPayload {
  const body = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  validatePayload(body as CardPayload);
  return body as CardPayload;
}

function parseLegacy(raw: unknown): LegacyRef | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') throw new DomainError(errorCodes.validation, 'legacy必须是对象。', {}, false, 400);
  const record = raw as Record<string, unknown>;
  const namespace = typeof record.namespace === 'string' ? record.namespace : undefined;
  const key = typeof record.key === 'string' ? record.key : undefined;
  if (namespace === undefined || key === undefined) throw new DomainError(errorCodes.validation, 'legacy必须含namespace与key。', {}, false, 400);
  let version: number | undefined;
  if (record.version !== undefined && record.version !== null) {
    if (typeof record.version !== 'number' || !Number.isSafeInteger(record.version) || record.version < 1) {
      throw new DomainError(errorCodes.validation, 'legacy版本必须为正整数。', {}, false, 400);
    }
    version = record.version;
  }
  return version === undefined ? { namespace, key } : { namespace, key, version };
}

export async function registerCreativeReferenceAdminRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const repository = new SqliteCreativeReferenceRepository(database);
  const admin = new CreativeReferenceAdminRepository(database);
  const authorization = {
    canManage: () => true,
    canReadAsMember: () => false
  };
  // 读走B1领域服务；写走管理应用服务（同步事务单元+审计+应用层授权）。
  const domainService = new CreativeReferenceService(repository, authorization);
  // 组合根授权策略：HTTP层已requireAdministrator的上下文即管理本库；服务层仍校验角色与actor。
  const service = new CreativeReferenceAdminService(repository, admin, { canManage: () => true });

  const actorOf = (request: Parameters<typeof requireAdministrator>[0]): { role: 'manager'; actorId: string } => {
    const account = requireAdministrator(request);
    return { role: 'manager', actorId: account.userId };
  };
  const noStore = (reply: { header: (k: string, v: string) => unknown }) => { reply.header('Cache-Control', 'no-store'); };

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/v1/admin/creative-reference/cards', async (request, reply) => {
    actorOf(request);
    noStore(reply);
    return guard(() => {
      const q = request.query;
      const limit = parseLimit(q.limit, 20);
      // exactOptionalPropertyTypes：仅写入已定义键，undefined不作为值传入。
      const kind = optionalEnum(q.assetKind, ASSET_KINDS, '类型');
      const keyword = q.keyword === undefined || q.keyword === '' ? undefined : requireString(q.keyword, '关键词', 100);
      const usageTree = q.usageTree === undefined || q.usageTree === '' ? undefined : requireString(q.usageTree, '用途', 60);
      const layers = optionalStringArray(q.layers === undefined ? undefined : String(q.layers).split(',').filter(Boolean), '层级', 10);
      const availabilities = optionalStringArray(q.status === undefined ? undefined : String(q.status).split(',').filter(Boolean), '状态', 4)?.filter((s): s is typeof AVAILABILITIES[number] => (AVAILABILITIES as readonly string[]).includes(s));
      const genre = q.genre === undefined || q.genre === '' ? undefined : requireString(q.genre, '题材', 40);
      const mechanism = q.mechanism === undefined || q.mechanism === '' ? undefined : requireString(q.mechanism, '机制', 40);
      const experience = q.experience === undefined || q.experience === '' ? undefined : requireString(q.experience, '体验', 40);
      const page = admin.listSummaries({
        ...(kind !== undefined ? { assetKind: kind } : {}),
        ...(keyword !== undefined ? { keyword } : {}),
        ...(usageTree !== undefined ? { usageTree } : {}),
        ...(layers !== undefined ? { layers } : {}),
        ...(availabilities !== undefined ? { availabilities } : {}),
        ...(genre !== undefined ? { genre } : {}),
        ...(mechanism !== undefined ? { mechanism } : {}),
        ...(experience !== undefined ? { experience } : {}),
        cursor: parseCursor(q.cursor), limit
      });
      return success({ items: page.items, nextCursor: encodeCursor(page.nextCursor) }, request.id);
    });
  });

  app.get<{ Querystring: { by?: string; displayCode?: string; namespace?: string; key?: string; version?: string } }>('/api/v1/admin/creative-reference/lookup', async (request, reply) => {
    const actor = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const q = request.query;
      const manager = { role: 'manager' as const, actorId: actor.actorId };
      const respond = async (key: Parameters<typeof domainService.adminReadExact>[0]) => {
        const result = await domainService.adminReadExact(key, {}, manager);
        if (result.outcome === 'found') return success({ outcome: 'found', card: result.card, revision: result.revision }, request.id);
        if (result.outcome === 'notFound') throw new NotFoundError(result.reason);
        throw new DomainError('AMBIGUOUS_LOOKUP', result.reason, { candidates: result.candidates }, false, 409);
      };
      if (q.by === 'displayCode') {
        return respond({ by: 'displayCode', displayCode: requireString(q.displayCode, 'displayCode', 20) });
      }
      if (q.by === 'legacy') {
        const legacy = parseLegacy({ namespace: q.namespace, key: q.key, version: q.version === undefined ? undefined : Number(q.version) });
        if (legacy === null) throw new DomainError(errorCodes.validation, 'legacy查询必须含namespace与key。', {}, false, 400);
        return respond({ by: 'legacy', legacy });
      }
      throw new DomainError(errorCodes.validation, 'by必须是displayCode或legacy。', {}, false, 400);
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/creative-reference/cards/:id', async (request, reply) => {
    const actor = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const manager = { role: 'manager' as const, actorId: actor.actorId };
      const result = await domainService.adminReadExact({ by: 'internalId', internalId: request.params.id }, {}, manager);
      if (result.outcome !== 'found') throw new NotFoundError(result.reason);
      const aliases = await repository.listAliases(request.params.id);
      const audit = admin.listAudit(request.params.id, 50);
      return success({ card: result.card, revision: result.revision, aliases, audit }, request.id);
    });
  });

  app.post<{ Body: unknown }>('/api/v1/admin/creative-reference/cards', async (request, reply) => {
    const actor = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const payload = parsePayload(body.payload);
      const legacy = parseLegacy(body.legacy);
      const idempotencyKey = requireString(body.idempotencyKey, '创建幂等键', 200);
      const outcome = service.createCardWithAudit({ payload, legacy, idempotencyKey }, actor, new Date().toISOString());
      return success({ card: outcome.card }, request.id);
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/creative-reference/cards/:id/revisions', async (request, reply) => {
    const actor = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const payload = parsePayload(body.payload);
      const expectedRevisionRaw = body.expectedRevision;
      if (!Number.isSafeInteger(expectedRevisionRaw) || (expectedRevisionRaw as number) < 1) {
        throw new DomainError(errorCodes.validation, 'expectedRevision必须为正整数。', {}, false, 400);
      }
      const revision = service.updateCardWithAudit(
        { internalId: request.params.id, expectedRevision: expectedRevisionRaw as number, payload },
        actor, new Date().toISOString()
      );
      return success({ revision: { revision: revision.revision, status: revision.status } }, request.id);
    });
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/api/v1/admin/creative-reference/cards/:id/revisions', async (request, reply) => {
    actorOf(request);
    noStore(reply);
    return guard(() => {
      admin.requireCardOrThrow(request.params.id);
      const limit = parseLimit(request.query.limit, 20);
      const offsetRaw = request.query.offset === undefined || request.query.offset === '' ? 0 : Number(request.query.offset);
      if (!Number.isSafeInteger(offsetRaw) || offsetRaw < 0) throw new DomainError(errorCodes.validation, 'offset必须为非负整数。', {}, false, 400);
      const items = admin.listRevisionSummaries(request.params.id, limit, offsetRaw).map((item) => ({ ...item, reviewOpinion: admin.latestReviewOpinion(request.params.id, item.revision) }));
      return success({ items, total: admin.countRevisions(request.params.id), nextOffset: offsetRaw + items.length < admin.countRevisions(request.params.id) ? offsetRaw + items.length : null }, request.id);
    });
  });

  app.get<{ Params: { id: string; revision: string } }>('/api/v1/admin/creative-reference/cards/:id/revisions/:revision', async (request, reply) => {
    const actor = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const revisionNum = Number(request.params.revision);
      if (!Number.isSafeInteger(revisionNum) || revisionNum < 1) throw new DomainError(errorCodes.validation, 'revision必须为正整数。', {}, false, 400);
      const manager = { role: 'manager' as const, actorId: actor.actorId };
      const result = await domainService.adminReadExact({ by: 'internalId', internalId: request.params.id }, { revision: revisionNum }, manager);
      if (result.outcome !== 'found') throw new NotFoundError(result.reason);
      return success({ revision: result.revision, reviewOpinion: admin.latestReviewOpinion(request.params.id, revisionNum) }, request.id);
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/creative-reference/cards/:id/review', async (request, reply) => {
    const actor = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const expectedRevisionRaw = body.expectedRevision;
      if (!Number.isSafeInteger(expectedRevisionRaw) || (expectedRevisionRaw as number) < 1) {
        throw new DomainError(errorCodes.validation, 'expectedRevision必须为正整数。', {}, false, 400);
      }
      const opinion = body.opinion === undefined || body.opinion === null || body.opinion === '' ? null : requireString(body.opinion, '审核意见', 500);
      const outcome = service.reviewWithOpinion(request.params.id, expectedRevisionRaw as number, opinion, actor, new Date().toISOString());
      return success({ revision: { revision: outcome.revision.revision, status: outcome.revision.status }, reviewOpinion: outcome.reviewOpinion }, request.id);
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/creative-reference/cards/:id/availability', async (request, reply) => {
    const actor = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const action = body.action;
      if (action !== 'retire' && action !== 'restore') {
        throw new DomainError(errorCodes.validation, 'action只能是retire或restore。', {}, false, 400);
      }
      // 所见状态与版本必传：服务层在事务内原子校验，防并发覆盖。
      const seenAvailability = optionalEnum(body.seenAvailability, AVAILABILITIES, '所见状态');
      if (seenAvailability === undefined) throw new DomainError(errorCodes.validation, 'seenAvailability必传（当前所见可用状态）。', {}, false, 400);
      if (!Number.isSafeInteger(body.seenRevision) || (body.seenRevision as number) < 1) {
        throw new DomainError(errorCodes.validation, 'seenRevision必传（当前所见版本，正整数）。', {}, false, 400);
      }
      const reason = body.reason === undefined || body.reason === null || body.reason === '' ? null : requireString(body.reason, '原因', 500);
      const card = service.setAvailabilityWithAudit({
        internalId: request.params.id, action: action as 'retire' | 'restore',
        seenAvailability, seenRevision: body.seenRevision as number, reason
      }, actor, new Date().toISOString());
      return success({ card }, request.id);
    });
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/v1/admin/creative-reference/releases', async (request, reply) => {
    actorOf(request);
    noStore(reply);
    return guard(async () => {
      const limit = parseLimit(request.query.limit, 20);
      const offsetRaw = request.query.offset === undefined || request.query.offset === '' ? 0 : Number(request.query.offset);
      if (!Number.isSafeInteger(offsetRaw) || offsetRaw < 0) throw new DomainError(errorCodes.validation, 'offset必须为非负整数。', {}, false, 400);
      const items = admin.listReleaseSummaries(limit, offsetRaw);
      const total = admin.countReleases();
      const active = await repository.getActiveRelease();
      return success({ items, total, activeReleaseId: active === null ? null : active.releaseId, nextOffset: offsetRaw + items.length < total ? offsetRaw + items.length : null }, request.id);
    });
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/api/v1/admin/creative-reference/releases/:id', async (request, reply) => {
    actorOf(request);
    noStore(reply);
    return guard(async () => {
      const release = await repository.getRelease(request.params.id);
      if (release === null) throw new NotFoundError('release不存在。');
      const relations = await repository.listRelationsInRelease(request.params.id);
      return success({ release: { ...release, entries: [] }, relations }, request.id);
    });
  });

  /** 冻结清单条目：B1绑定release分页；游标校验releaseId绑定与畸形，跨release/带指纹游标拒绝。 */
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/api/v1/admin/creative-reference/releases/:id/entries', async (request, reply) => {
    actorOf(request);
    noStore(reply);
    return guard(async () => {
      const limit = parseLimit(request.query.limit, 20);
      const cursor = parseReleaseEntriesCursor(request.query.cursor);
      const page = await repository.listReleaseEntries(request.params.id, cursor, limit);
      return success({ items: page.items, nextCursor: encodeReleaseEntriesCursor(page.nextCursor) }, request.id);
    });
  });

  app.post<{ Body: unknown }>('/api/v1/admin/creative-reference/releases', async (request, reply) => {
    const actor = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const entriesRaw = body.entries;
      if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) throw new DomainError(errorCodes.validation, 'entries必须为非空数组。', {}, false, 400);
      const entries = entriesRaw.map((entry) => {
        if (typeof entry !== 'object' || entry === null) throw new DomainError(errorCodes.validation, 'entries项必须是对象。', {}, false, 400);
        const record = entry as Record<string, unknown>;
        if (typeof record.internalId !== 'string' || !Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
          throw new DomainError(errorCodes.validation, 'entries项必须含internalId与正整数revision。', {}, false, 400);
        }
        return { internalId: record.internalId, revision: record.revision as number };
      });
      const relationsRaw = body.relations;
      let relationItems: unknown[];
      if (relationsRaw === undefined || relationsRaw === null) relationItems = [];
      else if (!Array.isArray(relationsRaw)) throw new DomainError(errorCodes.validation, 'relations必须是数组。', {}, false, 400);
      else relationItems = relationsRaw;
      const relations = relationItems.map((rel) => {
        if (typeof rel !== 'object' || rel === null) throw new DomainError(errorCodes.validation, 'relations项必须是对象。', {}, false, 400);
        const record = rel as Record<string, unknown>;
        if (typeof record.fromId !== 'string' || typeof record.toId !== 'string' ||
          !Number.isSafeInteger(record.fromRevision) || !Number.isSafeInteger(record.toRevision) ||
          typeof record.relationType !== 'string') {
          throw new DomainError(errorCodes.validation, 'relations项必须含fromId/fromRevision/toId/toRevision/relationType。', {}, false, 400);
        }
        return record as unknown as { fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: 'supplement' | 'fusion' | 'synonym' | 'replacement' | 'related_method' };
      });
      const expectedActive = body.expectedActiveReleaseId;
      if (expectedActive !== null && expectedActive !== undefined && typeof expectedActive !== 'string') {
        throw new DomainError(errorCodes.validation, 'expectedActiveReleaseId必须是字符串或null。', {}, false, 400);
      }
      const requestKey = requireString(body.idempotencyKey, '发布幂等键', 200);
      const outcome = service.publishWithRequestAndAudit({
        entries, relations,
        expectedActiveReleaseId: expectedActive === undefined ? null : expectedActive as string | null,
        idempotencyKey: requestKey
      }, actor, new Date().toISOString());
      return success({ release: outcome.release, replayed: outcome.replayed }, request.id);
    });
  });
}
