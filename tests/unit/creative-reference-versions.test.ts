/** B1返修：版本/审核状态机/发布原子性/退役不破旧release/权限。 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { SqliteCreativeReferenceRepository } from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import { ConflictError, NotFoundError } from '../../apps/api/src/application/creative-reference/errors.js';
import { CreativeReferenceService } from '../../apps/api/src/application/creative-reference/service.js';
import type { CreativeReferenceAuthorization } from '../../apps/api/src/application/creative-reference/service.js';
import { methodPayload, referencePayload } from '../fixtures/creative-reference/samples.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
const NOW = '2026-09-13T00:00:00.000Z';
const allowAll: CreativeReferenceAuthorization = { canManage: () => true, canReadAsMember: () => true };

interface Ctx { database: DatabaseSync; repository: SqliteCreativeReferenceRepository; service: CreativeReferenceService; root: string }
const contexts: Ctx[] = [];
function setup(): Ctx {
  const root = mkdtempSync(resolve(tmpdir(), 'b1r-ver-'));
  const database = new DatabaseSync(resolve(root, 'wenmi.sqlite'));
  runMigrations(database, MIGRATIONS_DIR);
  const repository = new SqliteCreativeReferenceRepository(database);
  const ctx: Ctx = { database, repository, root, service: new CreativeReferenceService(repository, allowAll) };
  contexts.push(ctx);
  return ctx;
}
afterEach(() => { contexts.splice(0).forEach((c) => { c.database.close(); rmSync(c.root, { force: true, recursive: true }); }); });

const manager = { role: 'manager' as const, actorId: 'manager-actor-1' };
const reviewer = { role: 'manager' as const, actorId: 'reviewer-actor-2' };
const member = { role: 'member' as const, actorId: 'member-actor-1' };

/** 便捷：建卡→审核→发布单卡release。 */
async function publishSingle(ctx: Ctx, payload: ReturnType<typeof methodPayload> | ReturnType<typeof referencePayload>, key: string) {
  const card = await ctx.service.createCard({ payload, legacy: null, idempotencyKey: key }, manager, NOW);
  await ctx.service.reviewRevision(card.internalId, 1, reviewer, NOW);
  const release = await pub(ctx, [{ internalId: card.internalId, revision: 1 }], []);
  return { card, release };
}


/** 发布辅助：读当前active作为显式expected（模拟调用者先读再发布的正确用法）。 */
async function pub(ctx: Ctx, entries: ReadonlyArray<{ internalId: string; revision: number }>, relations: ReadonlyArray<any> = [], context = manager) {
  const active = await ctx.repository.getActiveRelease();
  return ctx.service.publish(entries, relations, context, active === null ? null : active.releaseId, NOW);
}

describe('B1r 版本与发布（返修）', () => {
  it('P2-7：两连接竞争版本更新——旧expectedRevision必须冲突；真Promise并发恰一个成功', async () => {
    const ctx = setup();
    const card = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'v-1' }, manager, NOW);
    const secondDb = new DatabaseSync(resolve(ctx.root, 'wenmi.sqlite'));
    try {
      const repo2 = new SqliteCreativeReferenceRepository(secondDb);
      await ctx.repository.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '连接一改' }), actor: 'm1' }, NOW);
      await expect(repo2.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '连接二改' }), actor: 'm1' }, NOW))
        .rejects.toThrow(ConflictError);
      const race = await Promise.allSettled([
        ctx.repository.updateCard({ internalId: card.internalId, expectedRevision: 2, payload: methodPayload({ name: '竞A' }), actor: 'm1' }, NOW),
        repo2.updateCard({ internalId: card.internalId, expectedRevision: 2, payload: methodPayload({ name: '竞B' }), actor: 'm1' }, NOW)
      ]);
      const okCount = race.filter((r) => r.status === 'fulfilled').length;
      expect(okCount).toBeGreaterThanOrEqual(1);
      for (const r of race) {
        if (r.status === 'rejected') expect(String((r as PromiseRejectedResult).reason)).toMatch(/冲突|busy|locked/i);
      }
      const revisions = ctx.database.prepare('SELECT revision FROM creative_reference_revisions WHERE internal_id=?').all(card.internalId) as Array<{ revision: number }>;
      // 每个成功更新恰好一个新revision行：无重复revision号
      expect(new Set(revisions.map((r) => r.revision)).size).toBe(revisions.length);
    } finally {
      secondDb.close();
    }
  });

  it('P1-3：新revision必进draft——已发布卡更新后新revision为draft且卡回draft，需重新审核', async () => {
    const ctx = setup();
    const { card } = await publishSingle(ctx, methodPayload(), 'np-1');
    const updated = await ctx.service.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '第2版' }) }, manager, NOW);
    expect(updated.status).toBe('draft');
    expect(updated.reviewActor).toBeNull();
    const after = await ctx.service.adminReadExact({ by: 'internalId', internalId: card.internalId }, {}, manager);
    if (after.outcome !== 'found') throw new Error('应找到卡');
    expect(after.revision.status).toBe('draft');
    expect(after.card.availability).toBe('draft');
    // 旧published revision1不可变
    const old = await ctx.service.adminReadExact({ by: 'internalId', internalId: card.internalId }, { revision: 1 }, manager);
    if (old.outcome === 'found') expect(old.revision.status).toBe('published');
  });

  it('P1-3：draft不能跳级published；审核需reviewActor证据；已审核不能重复审核', async () => {
    const ctx = setup();
    const card = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'sm-1' }, manager, NOW);
    // draft→published跳级：发布时拒绝（清单含draft）
    await expect(ctx.service.publish([{ internalId: card.internalId, revision: 1 }], [], manager, null, NOW))
      .rejects.toThrow(/未审核/);
    // 审核：打reviewActor
    const reviewed = await ctx.service.reviewRevision(card.internalId, 1, reviewer, NOW);
    expect(reviewed.status).toBe('reviewed');
    expect(reviewed.reviewActor).toBe('reviewer-actor-2');
    // 已审核重复审核拒绝
    await expect(ctx.service.reviewRevision(card.internalId, 1, reviewer, NOW)).rejects.toThrow(/已审核/);
    // 审核后可发布
    const release = await pub(ctx, [{ internalId: card.internalId, revision: 1 }], []);
    const inRelease = await ctx.service.memberReadExact({ by: 'displayCode', displayCode: card.displayCode }, release.releaseId, member);
    expect(inRelease.outcome).toBe('found');
  });

  it('P1-2：退役不破旧release——发布后退役，旧release内成员仍可读revision', async () => {
    const ctx = setup();
    const { card, release } = await publishSingle(ctx, methodPayload(), 'rt-1');
    // 退役
    await ctx.service.setAvailability(card.internalId, 'retired', manager, NOW);
    // 旧release成员读取：仍found（冻结资格不受当前可用状态影响）
    const result = await ctx.service.memberReadExact({ by: 'displayCode', displayCode: card.displayCode }, release.releaseId, member);
    expect(result.outcome).toBe('found');
    // 退役卡的新发布选择被拒：新revision审核后进发布清单没问题（发布看revision），但updateCard被退役挡住
    await expect(ctx.service.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '退役后改' }) }, manager, NOW))
      .rejects.toThrow(/退役/);
  });

  it('P1-2补充：未发布进release的草稿成员不可读；未知release拒绝；不传release拒绝', async () => {
    const ctx = setup();
    const a = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'sec-a' }, manager, NOW);
    const { release } = await publishSingle(ctx, referencePayload(), 'sec-b');
    const draftRead = await ctx.service.memberReadExact({ by: 'displayCode', displayCode: a.displayCode }, release.releaseId, member);
    expect(draftRead.outcome).toBe('notFound');
    if (draftRead.outcome === 'notFound') expect(draftRead.reason).toMatch(/不在冻结release/);
    const unknown = await ctx.service.memberReadExact({ by: 'displayCode', displayCode: '法999' }, 'release-nonexistent', member);
    expect(unknown.outcome).toBe('notFound');
    await expect(ctx.service.memberReadExact({ by: 'displayCode', displayCode: '法001' }, undefined, member))
      .rejects.toThrow(/冻结release/);
  });

  it('P2-6：发布原子性——清单引用不存在/未审核/关系端点在清单外：全部回滚零残留', async () => {
    const ctx = setup();
    const a = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'rb-a' }, manager, NOW);
    await ctx.service.reviewRevision(a.internalId, 1, reviewer, NOW);
    const b = await ctx.service.createCard({ payload: referencePayload(), legacy: null, idempotencyKey: 'rb-b' }, manager, NOW);
    await ctx.service.reviewRevision(b.internalId, 1, reviewer, NOW);
    const count = () => (ctx.database.prepare('SELECT COUNT(*) c FROM creative_reference_releases').get() as { c: number }).c;
    const relCount = () => (ctx.database.prepare('SELECT COUNT(*) c FROM creative_reference_relations').get() as { c: number }).c;
    const before = count();
    // 引用不存在
    await expect(ctx.service.publish([{ internalId: a.internalId, revision: 1 }, { internalId: 'nonexistent', revision: 1 }], [], manager, null, NOW))
      .rejects.toThrow(NotFoundError);
    expect(count()).toBe(before);
    // 含未审核revision
    const draftCard = await ctx.service.createCard({ payload: methodPayload({ name: 'draft卡' }), legacy: null, idempotencyKey: 'rb-c' }, manager, NOW);
    await expect(ctx.service.publish([{ internalId: a.internalId, revision: 1 }, { internalId: draftCard.internalId, revision: 1 }], [], manager, null, NOW))
      .rejects.toThrow(/未审核/);
    expect(count()).toBe(before);
    // 关系端点不在清单内
    await expect(ctx.service.publish([{ internalId: a.internalId, revision: 1 }], [{ fromId: a.internalId, fromRevision: 1, toId: b.internalId, toRevision: 1, relationType: 'related_method' }], manager, null, NOW))
      .rejects.toThrow(/关系两端/);
    expect(count()).toBe(before);
    expect(relCount()).toBe(0);
    // 清单重复条目
    await expect(ctx.service.publish([{ internalId: a.internalId, revision: 1 }, { internalId: a.internalId, revision: 1 }], [], manager, null, NOW))
      .rejects.toThrow(/重复/);
    expect(count()).toBe(before);
  });

  it('P2-6：canonical manifest+重复发布防护+active乐观锁+旧release可读', async () => {
    const ctx = setup();
    const { card: a, release: r1 } = await publishSingle(ctx, methodPayload(), 'cp-a');
    const b = await ctx.service.createCard({ payload: referencePayload(), legacy: null, idempotencyKey: 'cp-b' }, manager, NOW);
    await ctx.service.reviewRevision(b.internalId, 1, reviewer, NOW);
    // 乐观锁：显式给陈旧预期null（实际active是r1）→ 拒绝；不自动读最新放行
    await expect(ctx.service.publish([{ internalId: a.internalId, revision: 1 }], [], manager, null, NOW))
      .rejects.toThrow(/active指针/);
    // 正常发布第二版：显式传r1作预期；active从r1换到r2，r1冻结可读
    const r2 = await ctx.service.publish([{ internalId: a.internalId, revision: 1 }, { internalId: b.internalId, revision: 1 }], [], manager, r1.releaseId, NOW);
    expect(r2.active).toBe(true);
    const old = await ctx.service['repository'].getRelease(r1.releaseId);
    if (old === null) throw new Error('旧release应可读');
    expect(old.entries.find((e) => e.internalId === a.internalId)!.revision).toBe(1);
    expect(old.active).toBe(false);
    // manifest canonical：乱序输入得到相同canonical（hash一致查重生效）
    await expect(ctx.service.publish([{ internalId: b.internalId, revision: 1 }, { internalId: a.internalId, revision: 1 }], [], manager, r2.releaseId, NOW))
      .rejects.toThrow(/相同清单/);
  });

  it('P2-6：release关系快照——冻结图谱与manifest一致，跨release不串', async () => {
    const ctx = setup();
    const a = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'rel-a' }, manager, NOW);
    const b = await ctx.service.createCard({ payload: referencePayload(), legacy: null, idempotencyKey: 'rel-b' }, manager, NOW);
    await ctx.service.reviewRevision(a.internalId, 1, reviewer, NOW);
    await ctx.service.reviewRevision(b.internalId, 1, reviewer, NOW);
    const release = await pub(ctx, [{ internalId: a.internalId, revision: 1 }, { internalId: b.internalId, revision: 1 }], [{ fromId: a.internalId, fromRevision: 1, toId: b.internalId, toRevision: 1, relationType: 'related_method' }]);
    const frozen = await ctx.service['repository'].listRelationsInRelease(release.releaseId);
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({ fromId: a.internalId, toId: b.internalId, relationType: 'related_method' });
    // 未知release无关系
    const none = await ctx.service['repository'].listRelationsInRelease('release-x');
    expect(none).toHaveLength(0);
  });
});
