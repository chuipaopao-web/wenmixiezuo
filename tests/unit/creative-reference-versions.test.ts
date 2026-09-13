/** B1-2：版本、发布快照、expectedVersion并发、权限。 */
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
  const root = mkdtempSync(resolve(tmpdir(), 'b1-versions-'));
  const database = new DatabaseSync(resolve(root, 'wenmi.sqlite'));
  runMigrations(database, MIGRATIONS_DIR);
  const repository = new SqliteCreativeReferenceRepository(database);
  const ctx: Ctx = { database, repository, root, service: new CreativeReferenceService(repository, allowAll) };
  contexts.push(ctx);
  return ctx;
}
afterEach(() => { contexts.splice(0).forEach((c) => { c.database.close(); rmSync(c.root, { force: true, recursive: true }); }); });

const manager = { role: 'manager' as const, actorId: 'manager-actor-1' };
const member = { role: 'member' as const, actorId: 'member-actor-1' };

describe('B1-2 版本与发布快照', () => {
  it('expectedVersion冲突：两个连接竞争同卡更新，只允许一个成功', async () => {
    const ctx = setup();
    const card = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'v-1' }, manager, NOW);
    const secondDb = new DatabaseSync(resolve(ctx.root, 'wenmi.sqlite'));
    try {
      const repo2 = new SqliteCreativeReferenceRepository(secondDb);
      const first = await ctx.repository.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '连接一改' }), actor: 'manager-actor-1' }, NOW);
      expect(first.revision).toBe(2);
      // 第二连接仍持旧expectedRevision=1：必须冲突
      await expect(repo2.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '连接二改' }), actor: 'manager-actor-1' }, NOW))
        .rejects.toThrow(ConflictError);
      // 两个Promise同时竞争（真异步竞争，非顺序调用）
      const race = await Promise.allSettled([
        ctx.repository.updateCard({ internalId: card.internalId, expectedRevision: 2, payload: methodPayload({ name: '竞A' }), actor: 'manager-actor-1' }, NOW),
        repo2.updateCard({ internalId: card.internalId, expectedRevision: 2, payload: methodPayload({ name: '竞B' }), actor: 'manager-actor-1' }, NOW)
      ]);
      const okCount = race.filter((r) => r.status === 'fulfilled').length;
      expect(okCount).toBe(1);
      const revisions = ctx.database.prepare('SELECT revision FROM creative_reference_revisions WHERE internal_id=?').all(card.internalId) as Array<{ revision: number }>;
      expect(revisions.length).toBeGreaterThanOrEqual(3);
    } finally {
      secondDb.close();
    }
  });

  it('发布release原子完成：manifest不可变、旧release可读、单active指针', async () => {
    const { service } = setup();
    const a = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'rel-a' }, manager, NOW);
    const b = await service.createCard({ payload: referencePayload(), legacy: null, idempotencyKey: 'rel-b' }, manager, NOW);
    await service.setStatus(a.internalId, 'published', manager, NOW);
    await service.setStatus(b.internalId, 'published', manager, NOW);
    const release1 = await service.publish(
      [{ internalId: a.internalId, revision: 1 }, { internalId: b.internalId, revision: 1 }],
      [], manager, NOW
    );
    expect(release1.active).toBe(true);
    // 修改内容并发布新release：旧release清单不变
    await service.updateCard({ internalId: a.internalId, expectedRevision: 1, payload: methodPayload({ name: '起承转合2' }) }, manager, NOW);
    const aRev2 = await service.adminReadExact({ by: 'internalId', internalId: a.internalId }, { revision: 2 }, manager);
    if (aRev2.outcome !== 'found') throw new Error('rev2应存在');
    await service.setStatus(a.internalId, 'published', manager, NOW);
    const release2 = await service.publish([{ internalId: a.internalId, revision: 2 }, { internalId: b.internalId, revision: 1 }], [], manager, NOW);
    const old = await service['repository'].getRelease(release1.releaseId);
    if (old === null) throw new Error('旧release应可读');
    expect(old.entries.find((e) => e.internalId === a.internalId)!.revision).toBe(1);
    expect(old.active).toBe(false);
    expect(release2.active).toBe(true);
    // 新release不改变旧冻结读取
    const oldRev = await service['repository'].getRevisionInRelease(release1.releaseId, a.internalId);
    expect(oldRev?.revision).toBe(1);
  });

  it('发布过程失败回滚：清单引用不存在的revision时不落release不写关系', async () => {
    const { service, database } = setup();
    const a = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'rb-a' }, manager, NOW);
    await service.setStatus(a.internalId, 'published', manager, NOW);
    const before = database.prepare('SELECT COUNT(*) c FROM creative_reference_releases').get() as { c: number };
    await expect(service.publish(
      [{ internalId: a.internalId, revision: 1 }, { internalId: 'nonexistent', revision: 1 }],
      [], manager, NOW
    )).rejects.toThrow(NotFoundError);
    const after = database.prepare('SELECT COUNT(*) c FROM creative_reference_releases').get() as { c: number };
    expect(after.c).toBe(before.c);
    // 未发布revision被拒并回滚
    const b = await service.createCard({ payload: referencePayload(), legacy: null, idempotencyKey: 'rb-b' }, manager, NOW);
    await expect(service.publish([{ internalId: b.internalId, revision: 1 }], [], manager, NOW))
      .rejects.toThrow(/未发布/);
    expect((database.prepare('SELECT COUNT(*) c FROM creative_reference_releases').get() as { c: number }).c).toBe(before.c);
  });

  it('成员读草稿/未知release拒绝；管理读草稿可读', async () => {
    const { service } = setup();
    const a = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'sec-a' }, manager, NOW);
    // 草稿：成员不可读（即使release存在也不含它）
    const b = await service.createCard({ payload: referencePayload(), legacy: null, idempotencyKey: 'sec-b' }, manager, NOW);
    await service.setStatus(b.internalId, 'published', manager, NOW);
    const release = await service.publish([{ internalId: b.internalId, revision: 1 }], [], manager, NOW);
    const draftRead = await service.memberReadExact({ by: 'displayCode', displayCode: a.displayCode }, release.releaseId, member);
    expect(draftRead.outcome).toBe('notFound');
    if (draftRead.outcome === 'notFound') expect(draftRead.reason).toMatch(/不在冻结release/);
    const unknown = await service.memberReadExact({ by: 'displayCode', displayCode: '法999' }, 'release-nonexistent', member);
    expect(unknown.outcome).toBe('notFound');
    // 成员不传release直接拒绝
    await expect(service.memberReadExact({ by: 'displayCode', displayCode: b.displayCode }, undefined, member))
      .rejects.toThrow(/冻结release/);
    // 管理读草稿可读
    const admin = await service.adminReadExact({ by: 'displayCode', displayCode: a.displayCode }, {}, manager);
    expect(admin.outcome).toBe('found');
  });
});
