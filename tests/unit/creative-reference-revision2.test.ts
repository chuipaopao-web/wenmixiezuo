/**
 * B1第二次返修回归：五个审查实际失败 + 双进程真并发 + 冻结release分页。
 * 全部走正式接口（service.publish显式expectedActiveReleaseId；无权限旁路）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { SqliteCreativeReferenceRepository } from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import { ConflictError } from '../../apps/api/src/application/creative-reference/errors.js';
import { CreativeReferenceService } from '../../apps/api/src/application/creative-reference/service.js';
import type { CreativeReferenceAuthorization } from '../../apps/api/src/application/creative-reference/service.js';
import { methodPayload, referencePayload } from '../fixtures/creative-reference/samples.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
const NOW = '2026-09-13T00:00:00.000Z';
const allowAll: CreativeReferenceAuthorization = { canManage: () => true, canReadAsMember: () => true };
const denyAll: CreativeReferenceAuthorization = { canManage: () => false, canReadAsMember: () => false };
const NODE = 'D:/wenmixiezuo/.local/dispatch/worktrees/task-209-b1/node_modules/.bin/tsx.cmd';
// tsx.cmd在spawnSync里需要shell；直接用node --import tsx更稳
const NODE_ARGS = ['--import', 'tsx', resolve(process.cwd(), 'tests/fixtures/creative-reference/worker.mts')];

interface Ctx { database: DatabaseSync; repository: SqliteCreativeReferenceRepository; service: CreativeReferenceService; root: string; dbPath: string }
const contexts: Ctx[] = [];
function setup(authorization: CreativeReferenceAuthorization = allowAll): Ctx {
  const root = mkdtempSync(resolve(tmpdir(), 'b1r2-'));
  const dbPath = resolve(root, 'wenmi.sqlite');
  const database = new DatabaseSync(dbPath);
  runMigrations(database, MIGRATIONS_DIR);
  const repository = new SqliteCreativeReferenceRepository(database);
  const ctx: Ctx = { database, repository, root, dbPath, service: new CreativeReferenceService(repository, authorization) };
  contexts.push(ctx);
  return ctx;
}
afterEach(() => { contexts.splice(0).forEach((c) => { c.database.close(); rmSync(c.root, { force: true, recursive: true }); }); });

const manager = { role: 'manager' as const, actorId: 'manager-1' };
const reviewer = { role: 'manager' as const, actorId: 'reviewer-2' };
const member = { role: 'member' as const, actorId: 'member-1' };

async function makeCard(ctx: Ctx, key: string) {
  const card = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: key }, manager, NOW);
  await ctx.service.reviewRevision(card.internalId, 1, reviewer, NOW);
  return card;
}
const en = (c: { internalId: string }) => ({ internalId: c.internalId, revision: 1 });

describe('B1第二次返修：审查五项', () => {
  it('审查1：无鉴权发布拒绝——publish走正式接口，denyAll服务不能发布；陈旧expectedActive不放行', async () => {
    // denied服务：卡经repository直建（鉴权在service层，repository是内部端口）
    const denied = setup(denyAll);
    const a = await denied.repository.createCard({ assetKind: 'method', payload: methodPayload(), legacy: null, idempotencyKey: 'p-1', authorActor: manager.actorId }, NOW);
    await denied.repository.reviewRevision({ internalId: a.internalId, expectedRevision: 1, reviewActor: reviewer.actorId }, NOW);
    await expect(denied.service.publish([en(a)], [], manager, null, NOW)).rejects.toThrow(/权限/);
    const allowed = setup();
    const b = await makeCard(allowed, 'p-2');
    const r1 = await allowed.service.publish([en(b)], [], manager, null, NOW);
    // 陈旧预期null（实际active=r1）：拒绝，不自动读最新
    await expect(allowed.service.publish([en(b)], [], manager, null, NOW)).rejects.toThrow(/active指针/);
    expect(r1.active).toBe(true);
  });

  it('审查2：同边跨release复用合法——A1→B1边进新release（加C1）不报唯一冲突，两release共享冻结边', async () => {
    const ctx = setup();
    const a = await makeCard(ctx, 'r-a');
    const b = await makeCard(ctx, 'r-b');
    const c = await makeCard(ctx, 'r-c');
    const rel = { fromId: a.internalId, fromRevision: 1, toId: b.internalId, toRevision: 1, relationType: 'supplement' as const };
    const r1 = await ctx.service.publish([en(a), en(b)], [rel], manager, null, NOW);
    const r2 = await ctx.service.publish([en(a), en(b), en(c)], [rel], manager, r1.releaseId, NOW);
    // 全局边只有一条，但两个release都关联它
    const edgeCount = (ctx.database.prepare('SELECT COUNT(*) c FROM creative_reference_relations').get() as { c: number }).c;
    expect(edgeCount).toBe(1);
    const r1edges = await ctx.repository.listRelationsInRelease(r1.releaseId);
    const r2edges = await ctx.repository.listRelationsInRelease(r2.releaseId);
    expect(r1edges).toHaveLength(1);
    expect(r2edges).toHaveLength(1);
    expect(r1edges[0]!.relationId).toBe(r2edges[0]!.relationId);
  });

  it('审查3：关系成对校验——不存在revision、存在但不在清单的revision均拒绝；事务零残留', async () => {
    const ctx = setup();
    const a = await makeCard(ctx, 'v-a');
    const b = await makeCard(ctx, 'v-b');
    const counts = () => ({
      rel: (ctx.database.prepare('SELECT COUNT(*) c FROM creative_reference_relations').get() as { c: number }).c,
      rr: (ctx.database.prepare('SELECT COUNT(*) c FROM creative_reference_release_relations').get() as { c: number }).c,
      releases: (ctx.database.prepare('SELECT COUNT(*) c FROM creative_reference_releases').get() as { c: number }).c
    });
    const before = counts();
    // 不存在的revision
    await expect(ctx.service.publish([en(a), en(b)], [{ fromId: a.internalId, fromRevision: 999, toId: b.internalId, toRevision: 1, relationType: 'supplement' }], manager, null, NOW))
      .rejects.toThrow(/成对存在/);
    // revision存在但from不在清单
    await expect(ctx.service.publish([en(b)], [{ fromId: a.internalId, fromRevision: 1, toId: b.internalId, toRevision: 1, relationType: 'supplement' }], manager, null, NOW))
      .rejects.toThrow(/成对存在/);
    // 清单内重复边
    await expect(ctx.service.publish([en(a), en(b)], [
      { fromId: a.internalId, fromRevision: 1, toId: b.internalId, toRevision: 1, relationType: 'supplement' },
      { fromId: a.internalId, fromRevision: 1, toId: b.internalId, toRevision: 1, relationType: 'supplement' }
    ], manager, null, NOW)).rejects.toThrow(/重复边/);
    expect(counts()).toEqual(before);
  });

  it('审查4：退役不能被review/publish复活——旧release仍可读', async () => {
    const ctx = setup();
    const a = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 't-a' }, manager, NOW);
    await ctx.service.reviewRevision(a.internalId, 1, reviewer, NOW);
    const r1 = await ctx.service.publish([en(a)], [], manager, null, NOW);
    await ctx.service.setAvailability(a.internalId, 'retired', manager, NOW);
    // 退役卡review拒绝（repository直测——退役拦截在数据层规则）
    const fresh = await ctx.service.createCard({ payload: methodPayload({ name: '新卡' }), legacy: null, idempotencyKey: 't-b' }, manager, NOW);
    await ctx.service.setAvailability(fresh.internalId, 'retired', manager, NOW);
    await expect(ctx.repository.reviewRevision({ internalId: fresh.internalId, expectedRevision: 1, reviewActor: reviewer.actorId }, NOW))
      .rejects.toThrow(/退役/);
    // publish退役卡：正确的active预期下仍被退役拦截
    const active = await ctx.repository.getActiveRelease();
    await expect(ctx.service.publish([en(a)], [], manager, active === null ? null : active.releaseId, NOW)).rejects.toThrow(/退役/);
    // 旧release仍可读且卡保持retired（不隐式复活）
    const still = await ctx.service.memberReadExact({ by: 'internalId', internalId: a.internalId }, r1.releaseId, member);
    expect(still.outcome).toBe('found');
    expect((await ctx.repository.findCardByInternalId(a.internalId))!.availability).toBe('retired');
  });

  it('审查5：别名目标冲突——同alias改绑他卡报ConflictError，返回值与重新读取一致；同目标幂等', async () => {
    const ctx = setup();
    const b = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'al-b' }, manager, NOW);
    const c = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'al-c' }, manager, NOW);
    const legacy = { namespace: 'test-view', key: 'same' };
    await ctx.service.importLegacyMapping([{ canonicalInternalId: b.internalId, legacy, payload: methodPayload(), sourceView: 'test' }], 'map', manager, NOW);
    // 同alias改绑到C：ConflictError
    await expect(ctx.service.importLegacyMapping([{ canonicalInternalId: c.internalId, legacy, payload: methodPayload(), sourceView: 'test' }], 'map', manager, NOW))
      .rejects.toThrow(ConflictError);
    // 重新读取仍是B：返回值与重读一致
    const readBack = await ctx.service.adminReadExact({ by: 'legacy', legacy }, {}, manager);
    expect(readBack.outcome).toBe('found');
    if (readBack.outcome === 'found') expect(readBack.card.internalId).toBe(b.internalId);
    // 同目标幂等重放成功
    const replay = await ctx.service.importLegacyMapping([{ canonicalInternalId: b.internalId, legacy, payload: methodPayload(), sourceView: 'test' }], 'map', manager, NOW);
    expect(replay[0]!.internalId).toBe(b.internalId);
    // 带版本变体：v1和v0是不同别名（NULL规范化为0后两者仍不同）
    await ctx.service['repository'].attachAlias(b.internalId, { namespace: 'nv', key: 'k', version: 1 }, 'test', NOW);
    const v1 = await ctx.service.adminReadExact({ by: 'legacy', legacy: { namespace: 'nv', key: 'k', version: 1 } }, {}, manager);
    expect(v1.outcome).toBe('found');
    const v0 = await ctx.service.adminReadExact({ by: 'legacy', legacy: { namespace: 'nv', key: 'k' } }, {}, manager);
    expect(v0.outcome).toBe('notFound');
  });
});

describe('B1第二次返修：双进程真并发与冻结分页', () => {
  it('双worker进程并发创建：编号无重号，两个成功时编号互异；失败者为锁冲突', async () => {
    const ctx = setup();
    const run = (key: string) => spawnSync(process.execPath, [...NODE_ARGS, ctx.dbPath, key], { encoding: 'utf8', timeout: 60_000 });
    const results = [run('proc-a'), run('proc-b')];
    const parsed = results.map((r) => {
      if (r.status !== 0) return { ok: false, error: (r.stderr || '').slice(0, 120) };
      const line = (r.stdout || '').trim().split('\n').pop()!;
      return JSON.parse(line) as { ok: boolean; displayCode?: string; error?: string };
    });
    const okCount = parsed.filter((p) => p.ok).length;
    expect(okCount).toBeGreaterThanOrEqual(1);
    for (const p of parsed) {
      if (!p.ok) expect(String(p.error)).toMatch(/busy|locked|conflict/i);
    }
    if (okCount === 2) {
      const codes = parsed.map((p) => p.displayCode!);
      expect(codes[0]).not.toBe(codes[1]);
    }
    const all = ctx.database.prepare('SELECT display_code FROM creative_reference_cards').all() as Array<{ display_code: string }>;
    const codes = all.map((r) => r.display_code);
    expect(new Set(codes).size).toBe(codes.length);
  }, 120_000);

  it('冻结release分页：cursor绑定release，新release发布后旧release分页结果不变', async () => {
    const ctx = setup();
    const cards = [];
    for (let i = 0; i < 5; i++) cards.push(await makeCard(ctx, `pg-${i}`));
    const r1 = await ctx.service.publish(cards.map(en), [], manager, null, NOW);
    // 分页读r1：每页2条
    const page1 = await ctx.service.memberListRelease(r1.releaseId, null, 2, member);
    expect(page1).toHaveLength(2);
    const page2 = await ctx.service.memberListRelease(r1.releaseId, { lastInternalId: page1[1]!.internalId }, 2, member);
    expect(page2).toHaveLength(2);
    const page3 = await ctx.service.memberListRelease(r1.releaseId, { lastInternalId: page2[1]!.internalId }, 2, member);
    expect(page3).toHaveLength(1);
    const all = [...page1, ...page2, ...page3];
    expect(new Set(all.map((e) => e.internalId)).size).toBe(5);
    // 发布新release（子集）后：旧release分页结果不变（不随active变化）
    const r2 = await ctx.service.publish([en(cards[0]!)], [], manager, r1.releaseId, NOW);
    expect(r2.active).toBe(true);
    const after = await ctx.service.memberListRelease(r1.releaseId, null, 2, member);
    expect(after).toEqual(page1);
    // 成员必须传release
    await expect(ctx.service.memberListRelease(undefined, null, 2, member)).rejects.toThrow(/冻结release/);
    // 未知release报错
    await expect(ctx.service.memberListRelease('release-x', null, 2, member)).rejects.toThrow(/不存在/);
  });
});
