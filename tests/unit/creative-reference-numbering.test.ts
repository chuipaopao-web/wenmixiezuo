/** B1-1：稳定编号、幂等、并发创建、legacy映射。 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { SqliteCreativeReferenceRepository } from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import { ConflictError } from '../../apps/api/src/application/creative-reference/errors.js';
import type { CreativeReferenceAuthorization, CreateCardCommand } from '../../apps/api/src/application/creative-reference/service.js';
import { CreativeReferenceService } from '../../apps/api/src/application/creative-reference/service.js';
import { legacyFourAct, legacyFourActComplete, methodPayload, referencePayload } from '../fixtures/creative-reference/samples.js';
import type { CardRecord } from '../../apps/api/src/application/creative-reference/types.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
const NOW = '2026-09-13T00:00:00.000Z';

const allowAll: CreativeReferenceAuthorization = {
  canManage: () => true,
  canReadAsMember: () => true
};
const denyAll: CreativeReferenceAuthorization = {
  canManage: () => false,
  canReadAsMember: () => false
};

interface Ctx { database: DatabaseSync; repository: SqliteCreativeReferenceRepository; service: CreativeReferenceService; root: string }
const contexts: Ctx[] = [];
function setup(authorization: CreativeReferenceAuthorization = allowAll): Ctx {
  const root = mkdtempSync(resolve(tmpdir(), 'b1-numbering-'));
  const database = new DatabaseSync(resolve(root, 'wenmi.sqlite'));
  runMigrations(database, MIGRATIONS_DIR);
  const repository = new SqliteCreativeReferenceRepository(database);
  const ctx: Ctx = { database, repository, root, service: new CreativeReferenceService(repository, authorization) };
  contexts.push(ctx);
  return ctx;
}
afterEach(() => { contexts.splice(0).forEach((c) => { c.database.close(); rmSync(c.root, { force: true, recursive: true }); }); });

const manager = { role: 'manager' as const, actorId: 'manager-actor-1' };
const member = { role: 'member' as const, actorId: 'member-actor-1' };

describe('B1-1 稳定编号与幂等', () => {
  it('法/参编号各自递增，格式为前缀+至少三位；不用数组下标', async () => {
    const { service } = setup();
    const m1 = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'k-m1' }, manager, NOW);
    const m2 = await service.createCard({ payload: methodPayload({ name: '三幕式' }), legacy: null, idempotencyKey: 'k-m2' }, manager, NOW);
    const r1 = await service.createCard({ payload: referencePayload(), legacy: null, idempotencyKey: 'k-r1' }, manager, NOW);
    expect(m1.displayCode).toBe('法001');
    expect(m2.displayCode).toBe('法002');
    expect(r1.displayCode).toBe('参001');
  });

  it('同幂等键同内容重放返回同一卡；同键不同内容报冲突', async () => {
    const { service } = setup();
    const first = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'idem-1' }, manager, NOW);
    const replay = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'idem-1' }, manager, NOW);
    expect(replay.internalId).toBe(first.internalId);
    await expect(service.createCard({ payload: methodPayload({ name: '六阶段推进' }), legacy: null, idempotencyKey: 'idem-1' }, manager, NOW))
      .rejects.toThrow(ConflictError);
  });

  it('两个数据库连接竞争创建：编号无重号（数据库约束兜底）', async () => {
    const ctx = setup();
    // 第二连接直接打开同库文件，模拟并发写者
    const secondDb = new DatabaseSync(resolve(ctx.root, 'wenmi.sqlite'));
    try {
      const repo2 = new SqliteCreativeReferenceRepository(secondDb);
      const results = await Promise.allSettled([
        ctx.repository.createCard({ assetKind: 'method', payload: methodPayload(), legacy: null, idempotencyKey: 'race-a', authorActor: 'manager-actor-1' }, NOW),
        repo2.createCard({ assetKind: 'method', payload: methodPayload({ name: '三幕式' }), legacy: null, idempotencyKey: 'race-b', authorActor: 'manager-actor-1' }, NOW)
      ]);
      const codes = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<CardRecord>).value.displayCode);
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
      // SQLITE_BUSY等竞争失败可接受；只要成功者编号唯一且能落库
      const all = ctx.database.prepare('SELECT display_code FROM creative_reference_cards ORDER BY display_code').all() as Array<{ display_code: string }>;
      const allCodes = all.map((r) => r.display_code);
      expect(new Set(allCodes).size).toBe(allCodes.length);
    } finally {
      secondDb.close();
    }
  });

  it('改名/换分类不改号；退役不回收编号且不可再改', async () => {
    const { service } = setup();
    const card = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'stable-1' }, manager, NOW);
    const updated = await service.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '起承转合（修订）', usageTree: '故事与因果' }) }, manager, NOW);
    expect(updated.displayCode).toBe(card.displayCode);
    expect(updated.revision).toBe(2);
    await service.setStatus(card.internalId, 'published', manager, NOW);
    const retired = await service.setStatus(card.internalId, 'retired', manager, NOW);
    expect(retired.displayCode).toBe(card.displayCode);
    await expect(service.updateCard({ internalId: card.internalId, expectedRevision: retired.currentRevision!, payload: methodPayload({ name: '再改' }) }, manager, NOW))
      .rejects.toThrow(/退役/);
    // 退役后新卡不复用其号
    const next = await service.createCard({ payload: methodPayload({ name: '新方法' }), legacy: null, idempotencyKey: 'stable-2' }, manager, NOW);
    expect(next.displayCode).not.toBe(card.displayCode);
  });

  it('complete-v3/audited-v4同实体别名多视图一致：同命名空间区分导入', async () => {
    const { service } = setup();
    const cards = await service.importLegacyMapping([
      { legacy: legacyFourAct, payload: methodPayload(), sourceView: 'audited-v4' },
      { legacy: legacyFourActComplete, payload: methodPayload(), sourceView: 'complete-v3' }
    ], 'legacy-import-1', manager, NOW);
    expect(cards).toHaveLength(2);
    // 不同命名空间同key：两视图并存可分别精确读回
    const byAudited = await service.adminReadExact({ by: 'legacy', legacy: legacyFourAct }, {}, manager);
    const byComplete = await service.adminReadExact({ by: 'legacy', legacy: legacyFourActComplete }, {}, manager);
    expect(byAudited.outcome).toBe('found');
    expect(byComplete.outcome).toBe('found');
    if (byAudited.outcome === 'found' && byComplete.outcome === 'found') {
      expect(byAudited.card.internalId).not.toBe(byComplete.card.internalId);
    }
    // 同键重放幂等：再次导入不产生重复
    const again = await service.importLegacyMapping([
      { legacy: legacyFourAct, payload: methodPayload(), sourceView: 'audited-v4' }
    ], 'legacy-import-1', manager, NOW);
    expect(again[0]!.internalId).toBe(cards[0]!.internalId);
  });

  it('不同含义不因同名合并：同名payload不同namespace的legacy各自独立', async () => {
    const { service } = setup();
    await service.importLegacyMapping([
      { legacy: { namespace: 'view-a', key: 'shared-name' }, payload: methodPayload({ name: '含义A' }), sourceView: 'a' },
      { legacy: { namespace: 'view-b', key: 'shared-name' }, payload: methodPayload({ name: '含义B' }), sourceView: 'b' }
    ], 'legacy-import-2', manager, NOW);
    const count = setup_count();
    expect(count).toBe(2);
    function setup_count(): number {
      return (ctx_database_count());
    }
    function ctx_database_count(): number {
      return 2; // 由下方直接断言替代
    }
    const rows = contexts[0]!.database.prepare('SELECT COUNT(*) c FROM creative_reference_cards WHERE legacy_key=?').get('shared-name') as { c: number };
    expect(rows.c).toBe(2);
  });

  it('写操作拒绝：无管理者上下文/授权替身拒绝', async () => {
    const denied = setup(denyAll);
    await expect(denied.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'deny-1' }, manager, NOW))
      .rejects.toThrow(/权限/);
    const allowed = setup();
    await expect(allowed.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'deny-2' }, member, NOW))
      .rejects.toThrow(/管理者/);
    await expect(allowed.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'deny-3' }, { role: 'manager', actorId: ' ' }, NOW))
      .rejects.toThrow(/管理者/);
  });
});
