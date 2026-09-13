/**
 * B1第二次返修回归：五个审查实际失败 + 双进程真并发 + 冻结release分页。
 * 全部走正式接口（service.publish显式expectedActiveReleaseId；无权限旁路）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
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
    // 仓储为同步签名（R209-B2二次返修）：同步断言同一条退役拦截规则
    expect(() => ctx.repository.reviewRevision({ internalId: fresh.internalId, expectedRevision: 1, reviewActor: reviewer.actorId }, NOW))
      .toThrow(/退役/);
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

describe('B1第三次返修：真锁竞争屏障与release绑定游标', () => {
  /**
   * 真并发证据链（非"两进程启动"即断言重叠）：
   * 1. A进程(hold)异步启动 → 等它的stdout出现{phase:'locked'}（A已BEGIN IMMEDIATE持写锁并插卡）。
   * 2. 收到LOCKED后，B进程(try)异步启动尝试同库createCard——此刻A确定持锁，B确定竞争。
   * 3. 等B结束（成功或busy/locked失败），再给A的stdin写释放指令 → 等A提交退出。
   * 4. 断言：B的结果、A提交成功、编号无重号、全库状态一致。全程超时清理并杀子进程。
   */
  it('A持BEGIN IMMEDIATE写锁时B竞争同库写入：B busy/locked或排队，A提交后全库无重号', async () => {
    const ctx = setup();
    const spawnAsync = (args: string[]) => {
      const child = spawn(process.execPath, [...NODE_ARGS, ctx.dbPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: string[] = [];
      child.stdout.on('data', (chunk) => { for (const line of String(chunk).trim().split('\n')) if (line) stdout.push(line); });
      return { child, stdout };
    };
    const hold = spawnAsync(['hold-key', 'hold']);
    const killAll = () => { for (const c of [hold.child, tryP?.child]) { if (c !== undefined) { try { c.kill(); } catch { /* 已退出 */ } } } };
    // 屏障1：等A真的持锁（读LOCKED信号，不靠启动/睡眠猜）
    const lockedAt = Date.now();
    while (!hold.stdout.some((l) => l.includes('"phase":"locked"'))) {
      if (Date.now() - lockedAt > 20_000) { killAll(); throw new Error('A未在20秒内发出LOCKED持锁信号'); }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(hold.stdout.some((l) => l.includes('"phase":"locked"'))).toBe(true);
    // A已持锁：B此刻竞争同库写入
    let tryP: { child: ReturnType<typeof spawn>; stdout: string[] } | null = spawnAsync(['try-key', 'try']);
    const tryDone = new Promise<string>((resolve, reject) => {
      tryP!.child.on('exit', () => {
        const last = tryP!.stdout.filter((l) => l.includes('"phase":"done"')).pop();
        resolve(last ?? 'no-output');
      });
      tryP!.child.on('error', reject);
    });
    const tryResult = await Promise.race([tryDone, new Promise<string>((_, rej) => setTimeout(() => rej(new Error('B超时30秒')), 30_000))]).catch((e) => { killAll(); throw e; });
    const parsed = JSON.parse(tryResult) as { ok: boolean; displayCode?: string; error?: string };
    // B要么busy/locked失败、要么排队后成功（SQLite允许等待）——不许是其他错误
    if (!parsed.ok) expect(String(parsed.error)).toMatch(/busy|locked|conflict/i);
    // 释放A：写stdin让它COMMIT并退出
    hold.child.stdin.write('release\n');
    const holdDone = new Promise<void>((resolve) => hold.child.on('exit', () => resolve()));
    await Promise.race([holdDone, new Promise((_, rej) => setTimeout(() => rej(new Error('A超时30秒未提交')), 30_000))]).catch((e) => { killAll(); throw e; });
    killAll();
    // A提交成功+B结果 → 全库编号无重号、状态一致
    const all = ctx.database.prepare('SELECT display_code, idempotency_key FROM creative_reference_cards').all() as Array<{ display_code: string; idempotency_key: string }>;
    const codes = all.map((r) => r.display_code);
    expect(new Set(codes).size).toBe(codes.length);
    // hold占位卡（法999）与B的编号分配互不干扰（B成功时编号非999）
    if (parsed.ok && parsed.displayCode !== undefined) expect(parsed.displayCode).not.toBe('法999');
    // 幂等键各自存在
    const keys = new Set(all.map((r) => r.idempotency_key));
    expect(keys.has('hold-key')).toBe(true);
    if (parsed.ok) expect(keys.has('try-key')).toBe(true);
  }, 90_000);

  it('双try进程并发创建：至少1成功、失败者锁冲突、编号互异且全库唯一', async () => {
    const ctx = setup();
    // R209-B2三次返修：采集子进程真实stdout/stderr与退出码——历史偶发okCount=0（Codex记录）
    // 因stderr被丢弃、无输出时折叠为'no-output'而无法定位阶段；现在失败时把原始证据附进断言。
    const spawnAsync = (key: string) => {
      const child = spawn(process.execPath, [...NODE_ARGS, ctx.dbPath, key, 'try'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const done = new Promise<{ ok: boolean; displayCode?: string; error?: string; exitCode: number | null; rawOut: string; rawErr: string }>((resolve) => {
        let out = '';
        let err = '';
        child.stdout.on('data', (c) => { out += String(c); });
        child.stderr.on('data', (c) => { err += String(c); });
        child.on('error', (spawnError) => resolve({ ok: false, error: `spawn:${String(spawnError)}`, exitCode: null, rawOut: out, rawErr: err + String(spawnError) }));
        child.on('exit', (code) => {
          const line = out.trim().split('\n').filter((l) => l.includes('"phase":"done"')).pop();
          const parsed = line ? JSON.parse(line) as { ok: boolean; displayCode?: string; error?: string } : { ok: false, error: 'no-output' };
          resolve({ ...parsed, exitCode: code, rawOut: out.trim().slice(0, 400), rawErr: err.trim().slice(0, 400) });
        });
      });
      return { child, done };
    };
    // 同时启动两个独立进程：各自BEGIN IMMEDIATE，SQLite串行化写锁——真重叠由DB锁保证
    const a = spawnAsync('dual-a');
    const b = spawnAsync('dual-b');
    const timeout = new Promise((_, rej) => setTimeout(() => { a.child.kill(); b.child.kill(); rej(new Error('双进程超时60秒')); }, 60_000));
    const results = await Promise.race([Promise.all([a.done, b.done]), timeout]) as Array<{ ok: boolean; displayCode?: string; error?: string; exitCode: number | null; rawOut: string; rawErr: string }>;
    const ra = results[0]!;
    const rb = results[1]!;
    const okCount = [ra, rb].filter((r) => r.ok).length;
    const evidence = JSON.stringify({ ra: { ok: ra.ok, error: ra.error, exitCode: ra.exitCode, rawOut: ra.rawOut, rawErr: ra.rawErr }, rb: { ok: rb.ok, error: rb.error, exitCode: rb.exitCode, rawOut: rb.rawOut, rawErr: rb.rawErr } });
    expect(okCount, `双try偶发失败证据（stdout/stderr/exit）：${evidence}`).toBeGreaterThanOrEqual(1);
    for (const r of [ra, rb]) if (!r.ok) expect(String(r.error), `失败worker原始输出：${JSON.stringify(r)}`).toMatch(/busy|locked|conflict/i);
    if (okCount === 2) expect(ra.displayCode).not.toBe(rb.displayCode);
    const all = ctx.database.prepare('SELECT display_code FROM creative_reference_cards').all() as Array<{ display_code: string }>;
    expect(new Set(all.map((r) => r.display_code)).size).toBe(all.length);
  }, 90_000);

  it('冻结release分页：真实nextCursor带releaseId；r1页1游标用于r2必须拒绝；active切换后r1连续分页完整无重复；末页null；limit边界', async () => {
    const ctx = setup();
    const cards = [];
    for (let i = 0; i < 5; i++) cards.push(await makeCard(ctx, `pg-${i}`));
    const r1 = await ctx.service.publish(cards.map(en), [], manager, null, NOW);
    // 页1：真实返回的nextCursor（含releaseId）——不再手造游标
    const page1 = await ctx.service.memberListRelease(r1.releaseId, null, 2, member);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.nextCursor!.releaseId).toBe(r1.releaseId);
    // 页2用页1返回的游标
    const page2 = await ctx.service.memberListRelease(r1.releaseId, page1.nextCursor, 2, member);
    expect(page2.items).toHaveLength(2);
    // 末页：nextCursor=null
    const page3 = await ctx.service.memberListRelease(r1.releaseId, page2.nextCursor, 2, member);
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
    const all = [...page1.items, ...page2.items, ...page3.items];
    expect(new Set(all.map((e) => e.internalId)).size).toBe(5);
    // 发布r2后：r1的游标用于r2必须拒绝（跨release）
    const r2 = await ctx.service.publish([en(cards[0]!)], [], manager, r1.releaseId, NOW);
    await expect(ctx.service.memberListRelease(r2.releaseId, page1.nextCursor, 2, member)).rejects.toThrow(/不一致/);
    // active在r2时，r1从游标继续分页仍完整且与active切换前一致
    const page2After = await ctx.service.memberListRelease(r1.releaseId, page1.nextCursor, 2, member);
    expect(page2After.items).toEqual(page2.items);
    const page3After = await ctx.service.memberListRelease(r1.releaseId, page2After.nextCursor, 2, member);
    expect(page3After.items).toEqual(page3.items);
    // 伪造releaseId的游标拒绝；带过滤指纹的游标拒绝；limit非法拒绝
    await expect(ctx.service.memberListRelease(r1.releaseId, { releaseId: 'forged', lastInternalId: page1.items[1]!.internalId, filterFingerprint: null }, 2, member)).rejects.toThrow(/不一致/);
    await expect(ctx.service.memberListRelease(r1.releaseId, { releaseId: r1.releaseId, lastInternalId: page1.items[1]!.internalId, filterFingerprint: 'x' }, 2, member)).rejects.toThrow(/过滤指纹/);
    await expect(ctx.service.memberListRelease(r1.releaseId, null, 0, member)).rejects.toThrow(/limit/);
    await expect(ctx.service.memberListRelease(r1.releaseId, null, 101, member)).rejects.toThrow(/limit/);
        // 成员必须传release；未知release；单卡release一页读完nextCursor=null（空清单release本身被发布拒绝）
    await expect(ctx.service.memberListRelease(undefined, null, 2, member)).rejects.toThrow(/冻结release/);
    await expect(ctx.service.memberListRelease('release-x', null, 2, member)).rejects.toThrow(/不存在/);
    await expect(ctx.service.publish([], [], manager, r2.releaseId, NOW)).rejects.toThrow(/不能为空/);
    const solo = await makeCard(ctx, 'solo');
    const r3 = await ctx.service.publish([en(solo)], [], manager, r2.releaseId, NOW);
    const soloPage = await ctx.service.memberListRelease(r3.releaseId, null, 2, member);
    expect(soloPage.items).toHaveLength(1);
    expect(soloPage.nextCursor).toBeNull();
  });
});
