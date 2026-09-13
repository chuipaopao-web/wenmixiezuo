/** B1返修：编号/幂等/同实体多别名同编号/竞争。 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { SqliteCreativeReferenceRepository } from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import { ConflictError, ValidationError } from '../../apps/api/src/application/creative-reference/errors.js';
import { CreativeReferenceService } from '../../apps/api/src/application/creative-reference/service.js';
import type { CreativeReferenceAuthorization } from '../../apps/api/src/application/creative-reference/service.js';
import { legacyFourAct, legacyFourActComplete, methodPayload, referencePayload } from '../fixtures/creative-reference/samples.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
const NOW = '2026-09-13T00:00:00.000Z';
const allowAll: CreativeReferenceAuthorization = { canManage: () => true, canReadAsMember: () => true };
const denyAll: CreativeReferenceAuthorization = { canManage: () => false, canReadAsMember: () => false };

interface Ctx { database: DatabaseSync; repository: SqliteCreativeReferenceRepository; service: CreativeReferenceService; root: string }
const contexts: Ctx[] = [];
function setup(authorization: CreativeReferenceAuthorization = allowAll): Ctx {
  const root = mkdtempSync(resolve(tmpdir(), 'b1r-num-'));
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

describe('B1r 编号与幂等（返修）', () => {
  it('法/参编号各自递增，格式前缀+至少三位', async () => {
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

  it('P1-5：创建幂等不受后续编辑影响——编辑后重放原create仍返回同一卡', async () => {
    const { service } = setup();
    const card = await service.createCard({ payload: methodPayload(), legacy: legacyFourAct, idempotencyKey: 'idem-stable' }, manager, NOW);
    await service.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '改后' }) }, manager, NOW);
    const replay = await service.createCard({ payload: methodPayload(), legacy: legacyFourAct, idempotencyKey: 'idem-stable' }, manager, NOW);
    expect(replay.internalId).toBe(card.internalId);
  });

  it('P2-7：真实事务竞争——两个独立连接并发创建，编号无重号且至少一个成功', async () => {
    const ctx = setup();
    const secondDb = new DatabaseSync(resolve(ctx.root, 'wenmi.sqlite'));
    try {
      const repo2 = new SqliteCreativeReferenceRepository(secondDb);
      const results = await Promise.allSettled([
        ctx.repository.createCard({ assetKind: 'method', payload: methodPayload(), legacy: null, idempotencyKey: 'race-a', authorActor: 'm1' }, NOW),
        repo2.createCard({ assetKind: 'method', payload: methodPayload({ name: '三幕式' }), legacy: null, idempotencyKey: 'race-b', authorActor: 'm1' }, NOW)
      ]);
      const okCount = results.filter((r) => r.status === 'fulfilled').length;
      expect(okCount).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(String((r as PromiseRejectedResult).reason)).toMatch(/busy|locked|conflict|不同内容/i);
        }
      }
      const all = ctx.database.prepare('SELECT display_code FROM creative_reference_cards').all() as Array<{ display_code: string }>;
      const codes = all.map((r) => r.display_code);
      expect(new Set(codes).size).toBe(codes.length);
      if (okCount === 2) {
        const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<PromiseFulfilledResult<{ displayCode: string }>>;
        expect(fulfilled[0]!.value.displayCode).not.toBe(fulfilled[1]!.value.displayCode);
      }
    } finally {
      secondDb.close();
    }
  });

  it('改名/换分类不改号；退役不回收编号且不可再改', async () => {
    const { service } = setup();
    const card = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'stable-1' }, manager, NOW);
    const updated = await service.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '修订', usageTree: '故事与因果' }) }, manager, NOW);
    expect(updated.displayCode).toBe(card.displayCode);
    await service.setAvailability(card.internalId, 'retired', manager, NOW);
    await expect(service.updateCard({ internalId: card.internalId, expectedRevision: 2, payload: methodPayload({ name: '再改' }) }, manager, NOW))
      .rejects.toThrow(/退役/);
    const next = await service.createCard({ payload: methodPayload({ name: '新方法' }), legacy: null, idempotencyKey: 'stable-2' }, manager, NOW);
    expect(next.displayCode).not.toBe(card.displayCode);
  });

  it('P1-4：同实体多别名同编号——audited-v4与complete-v3确认同实体后共用一张卡一个法号', async () => {
    const { service } = setup();
    const canonical = await service.createCard({ payload: methodPayload(), legacy: legacyFourAct, idempotencyKey: 'ent-1' }, manager, NOW);
    await service.importLegacyMapping([
      { canonicalInternalId: canonical.internalId, legacy: legacyFourActComplete, payload: methodPayload(), sourceView: 'complete-v3' }
    ], 'legacy-1', manager, NOW);
    const byAudited = await service.adminReadExact({ by: 'legacy', legacy: legacyFourAct }, {}, manager);
    const byComplete = await service.adminReadExact({ by: 'legacy', legacy: legacyFourActComplete }, {}, manager);
    expect(byAudited.outcome).toBe('found');
    expect(byComplete.outcome).toBe('found');
    if (byAudited.outcome === 'found' && byComplete.outcome === 'found') {
      // 【原测试错误说明】首轮测试断言internalId不同——那是"各建一张卡"的行为，恰好违反任务书
      // "确认同实体必须一个稳定编号"的要求。返修后同实体canonical+alias共享一张卡，此断言改为相同。
      expect(byComplete.card.internalId).toBe(byAudited.card.internalId);
      expect(byComplete.card.displayCode).toBe(canonical.displayCode);
    }
    const count = contexts[0]!.database.prepare('SELECT COUNT(*) c FROM creative_reference_cards').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('不同含义不因同名合并：未声明canonical的独立导入各建各卡', async () => {
    const { service } = setup();
    await service.importLegacyMapping([
      { legacy: { namespace: 'view-a', key: 'shared-name' }, payload: methodPayload({ name: '含义A' }), sourceView: 'a' },
      { legacy: { namespace: 'view-b', key: 'shared-name' }, payload: methodPayload({ name: '含义B' }), sourceView: 'b' }
    ], 'legacy-2', manager, NOW);
    const total = contexts[0]!.database.prepare('SELECT COUNT(*) c FROM creative_reference_cards').get() as { c: number };
    expect(total.c).toBe(2);
  });

  it('写操作拒绝：非manager上下文/授权替身拒绝/空白actor', async () => {
    const denied = setup(denyAll);
    await expect(denied.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'deny-1' }, manager, NOW)).rejects.toThrow(/权限/);
    const allowed = setup();
    await expect(allowed.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'deny-2' }, member, NOW)).rejects.toThrow(/管理者/);
    await expect(allowed.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'deny-3' }, { role: 'manager', actorId: ' ' }, NOW)).rejects.toThrow(/管理者/);
  });

  it('输入校验：非法legacy与payload.assetKind不一致拒绝', async () => {
    const { service } = setup();
    await expect(service.createCard({ payload: methodPayload(), legacy: { namespace: '', key: 'k' }, idempotencyKey: 'v-1' }, manager, NOW)).rejects.toThrow(ValidationError);
    await expect(service.createCard({ payload: methodPayload(), legacy: { namespace: 'a:b', key: 'k' }, idempotencyKey: 'v-2' }, manager, NOW)).rejects.toThrow(ValidationError);
    await expect(service.createCard({ payload: methodPayload(), legacy: { namespace: 'n', key: 'k', version: 1.5 }, idempotencyKey: 'v-3' }, manager, NOW)).rejects.toThrow(ValidationError);
    const card = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'v-4' }, manager, NOW);
    await expect(service.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: referencePayload() }, manager, NOW)).rejects.toThrow(/assetKind.*不一致/);
  });
});
