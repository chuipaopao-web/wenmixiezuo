/**
 * R209-B2 创作库管理路由：现有后台会话→requireAdministrator→CreativeReferenceService/AdminRepository→现有SQLite。
 * 只管理创作参考库全局编辑资产；不导入旧库内容、不接AI检索、不触作者数据。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { success } from '../contracts/api.js';
import { DomainError, errorCodes } from '../domain/errors.js';
import { requireAdministrator } from '../infrastructure/security/auth-context.js';
import { SqliteCreativeReferenceRepository } from '../infrastructure/db/repositories/creative-reference-repository.js';
import { CreativeReferenceAdminRepository } from '../infrastructure/db/repositories/creative-reference-admin-repository.js';
// 领域公共面统一走桶导出（types/errors/validation/service），保持该面在运行闭包内。
import {
  AmbiguityError, AuthorizationError, ConflictError, CreativeReferenceError, CursorInvalidError,
  NotFoundError, ValidationError, CreativeReferenceService, validatePayload,
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

// service层方法为async签名；guard同时收窄同步与异步主体，统一映射领域错误到HTTP状态。
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

interface RevisionFullRow {
  revision: number; asset_kind: 'method' | 'reference'; schema_version: number; payload_json: string; content_hash: string;
  display_code: string; short_phrase: string; summary: string; status: 'draft' | 'reviewed' | 'published' | 'retired';
  author_actor: string; review_actor: string | null; created_at: string;
}

export async function registerCreativeReferenceAdminRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const repository = new SqliteCreativeReferenceRepository(database);
  const admin = new CreativeReferenceAdminRepository(database);
  const authorization = {
    canManage: () => true,
    canReadAsMember: () => false
  };
  // 服务只做领域校验；HTTP层requireAdministrator已验证身份，actorId取验证后account.userId。
  const service = new CreativeReferenceService(repository, authorization);

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
    const manager = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const q = request.query;
      const respond = async (key: Parameters<typeof service.adminReadExact>[0]) => {
        const result = await service.adminReadExact(key, {}, manager);
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
    const manager = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const result = await service.adminReadExact({ by: 'internalId', internalId: request.params.id }, {}, manager);
      if (result.outcome !== 'found') throw new NotFoundError(result.reason);
      const aliases = await repository.listAliases(request.params.id);
      const audit = admin.listAudit(request.params.id, 50);
      return success({ card: result.card, revision: result.revision, aliases, audit }, request.id);
    });
  });

  app.post<{ Body: unknown }>('/api/v1/admin/creative-reference/cards', async (request, reply) => {
    const manager = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const payload = parsePayload(body.payload);
      const legacy = parseLegacy(body.legacy);
      const idempotencyKey = requireString(body.idempotencyKey, '创建幂等键', 200);
      const now = new Date().toISOString();
      // 幂等重放不重复记审计：先查同键卡是否已存在（服务层事务内仍兜底并发竞态）。
      const prior = await repository.findByIdempotencyKey(payload.assetKind, idempotencyKey);
      const card = await service.createCard({ payload, legacy, idempotencyKey }, manager, now);
      if (prior === null) {
        admin.recordAudit({ action: 'create', targetId: card.internalId, targetRevision: card.currentRevision, actorId: manager.actorId, resultRef: card.displayCode, idempotencyKey }, now);
      }
      return success({ card }, request.id);
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/creative-reference/cards/:id/revisions', async (request, reply) => {
    const manager = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const payload = parsePayload(body.payload);
      const expectedRevisionRaw = body.expectedRevision;
      if (!Number.isSafeInteger(expectedRevisionRaw) || (expectedRevisionRaw as number) < 1) {
        throw new DomainError(errorCodes.validation, 'expectedRevision必须为正整数。', {}, false, 400);
      }
      const now = new Date().toISOString();
      const revision = await service.updateCard({ internalId: request.params.id, expectedRevision: expectedRevisionRaw as number, payload, actor: manager.actorId }, manager, now);
      admin.recordAudit({ action: 'revise', targetId: request.params.id, targetRevision: revision.revision, actorId: manager.actorId, resultRef: revision.displayCode }, now);
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
    const manager = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const revisionNum = Number(request.params.revision);
      if (!Number.isSafeInteger(revisionNum) || revisionNum < 1) throw new DomainError(errorCodes.validation, 'revision必须为正整数。', {}, false, 400);
      const result = await service.adminReadExact({ by: 'internalId', internalId: request.params.id }, { revision: revisionNum }, manager);
      if (result.outcome !== 'found') throw new NotFoundError(result.reason);
      return success({ revision: result.revision, reviewOpinion: admin.latestReviewOpinion(request.params.id, revisionNum) }, request.id);
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/creative-reference/cards/:id/review', async (request, reply) => {
    const manager = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const expectedRevisionRaw = body.expectedRevision;
      if (!Number.isSafeInteger(expectedRevisionRaw) || (expectedRevisionRaw as number) < 1) {
        throw new DomainError(errorCodes.validation, 'expectedRevision必须为正整数。', {}, false, 400);
      }
      const opinion = body.opinion === undefined || body.opinion === null || body.opinion === '' ? null : requireString(body.opinion, '审核意见', 500);
      const now = new Date().toISOString();
      // 状态转换由repository单条UPDATE原子完成；意见随后独立落库（不跨await包事务）。
      const revision = await service.reviewRevision(request.params.id, expectedRevisionRaw as number, manager, now);
      admin.recordReviewOpinion(request.params.id, revision.revision, manager.actorId, opinion ?? '', now);
      return success({ revision: { revision: revision.revision, status: revision.status }, reviewOpinion: opinion }, request.id);
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/creative-reference/cards/:id/availability', async (request, reply) => {
    const manager = actorOf(request);
    noStore(reply);
    return guard(async () => {
      const body = bodyRecord(request);
      const action = body.action;
      if (action !== 'retire' && action !== 'restore') {
        throw new DomainError(errorCodes.validation, 'action只能是retire或restore。', {}, false, 400);
      }
      const seenAvailability = optionalEnum(body.seenAvailability, AVAILABILITIES, '所见状态');
      const reason = body.reason === undefined || body.reason === null || body.reason === '' ? null : requireString(body.reason, '原因', 500);
      const card = await repository.findCardByInternalId(request.params.id);
      if (card === null) throw new NotFoundError('条目不存在。');
      if (seenAvailability !== undefined && card.availability !== seenAvailability) {
        throw new ConflictError(`状态已被并发修改：所见${seenAvailability}，当前${card.availability}。请刷新后重试。`);
      }
      if (action === 'retire' && card.availability === 'retired') throw new ConflictError('条目已退役。');
      if (action === 'restore' && card.availability !== 'retired') throw new ConflictError('条目未退役，无需恢复。');
      const now = new Date().toISOString();
      if (action === 'retire') {
        const updated = await service.setAvailability(request.params.id, 'retired', manager, now);
        admin.recordAudit({ action: 'retire', targetId: request.params.id, targetRevision: updated.currentRevision, actorId: manager.actorId, opinion: reason }, now);
        return success({ card: updated }, request.id);
      }
      admin.setAvailabilityForRestore(request.params.id, now);
      const restored = await repository.findCardByInternalId(request.params.id);
      admin.recordAudit({ action: 'restore', targetId: request.params.id, targetRevision: restored === null ? null : restored.currentRevision, actorId: manager.actorId, opinion: reason }, now);
      return success({ card: restored }, request.id);
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
      return success({ release, relations }, request.id);
    });
  });

  app.post<{ Body: unknown }>('/api/v1/admin/creative-reference/releases', async (request, reply) => {
    const manager = actorOf(request);
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
      const now = new Date().toISOString();
      const requestDigest = admin.digest({ entries, relations, expectedActive });
      // 发布幂等：publishRelease内部自有事务（不可外层再包，否则嵌套BEGIN）。
      // 占位记录（release_id NULL=结果未知防护）→发布→回填；发布失败时补偿删除占位，不留半状态。
      const existing = database.prepare('SELECT request_digest, release_id FROM creative_reference_release_requests WHERE request_key=?').get(requestKey) as { request_digest: string; release_id: string | null } | undefined;
      if (existing !== undefined) {
        if (existing.request_digest !== requestDigest) throw new ConflictError('发布请求键已用于不同内容。');
        if (existing.release_id !== null) {
          const release = await repository.getRelease(existing.release_id);
          if (release !== null) return success({ release, replayed: true }, request.id);
        }
        throw new ConflictError('上次发布结果未知；请勿重复提交，请核对releases列表。');
      }
      try {
        database.prepare('INSERT INTO creative_reference_release_requests(request_key, request_digest, release_id, created_at) VALUES (?,?,NULL,?)').run(requestKey, requestDigest, now);
      } catch (error) {
        // 并发同键：占位唯一约束兜底，落回重放/未知判定，不裸抛500。
        if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed')) throw error;
        const raced = database.prepare('SELECT request_digest, release_id FROM creative_reference_release_requests WHERE request_key=?').get(requestKey) as { request_digest: string; release_id: string | null } | undefined;
        if (raced !== undefined && raced.request_digest === requestDigest && raced.release_id !== null) {
          const release = await repository.getRelease(raced.release_id);
          if (release !== null) return success({ release, replayed: true }, request.id);
        }
        throw new ConflictError('发布请求正在处理或结果未知；请稍后核对releases列表。');
      }
      let release;
      try {
        release = await service.publish(entries, relations, manager, expectedActive === undefined ? null : expectedActive as string | null, now);
      } catch (error) {
        database.prepare('DELETE FROM creative_reference_release_requests WHERE request_key=? AND release_id IS NULL').run(requestKey);
        throw error;
      }
      database.prepare('UPDATE creative_reference_release_requests SET release_id=? WHERE request_key=?').run(release.releaseId, requestKey);
      admin.recordAudit({ action: 'publish', targetId: release.releaseId, targetRevision: null, actorId: manager.actorId, opinion: null, resultRef: release.manifestHash, idempotencyKey: requestKey, requestDigest }, now);
      return success({ release, replayed: false }, request.id);
    });
  });
}
