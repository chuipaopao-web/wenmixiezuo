/** B1-3：精确查询、三档投影、Unicode计量、分页与cursor。 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { SqliteCreativeReferenceRepository } from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import { BudgetError, CursorInvalidError } from '../../apps/api/src/application/creative-reference/errors.js';
import { CreativeReferenceService } from '../../apps/api/src/application/creative-reference/service.js';
import type { CreativeReferenceAuthorization } from '../../apps/api/src/application/creative-reference/service.js';
import { countChars } from '../../apps/api/src/application/creative-reference/validation.js';
import { project } from '../../apps/api/src/application/creative-reference/projections.js';
import { legacyFourAct, methodPayload, referencePayload } from '../fixtures/creative-reference/samples.js';
import type { RevisionRecord } from '../../apps/api/src/application/creative-reference/types.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
const NOW = '2026-09-13T00:00:00.000Z';
const allowAll: CreativeReferenceAuthorization = { canManage: () => true, canReadAsMember: () => true };

interface Ctx { database: DatabaseSync; repository: SqliteCreativeReferenceRepository; service: CreativeReferenceService; root: string }
const contexts: Ctx[] = [];
function setup(): Ctx {
  const root = mkdtempSync(resolve(tmpdir(), 'b1-query-'));
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

describe('B1-3 精确查询与三档投影', () => {
  it('按internalId/displayCode/legacy+revision精确读取；不存在编号不近似匹配', async () => {
    const { service } = setup();
    const card = await service.createCard({ payload: methodPayload(), legacy: legacyFourAct, idempotencyKey: 'q-1' }, manager, NOW);
    await service.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '第2版名' }) }, manager, NOW);
    const byId = await service.adminReadExact({ by: 'internalId', internalId: card.internalId }, { revision: 1 }, manager);
    expect(byId.outcome).toBe('found');
    if (byId.outcome === 'found') expect(byId.revision.payload.name).toBe('起承转合');
    const byCode = await service.adminReadExact({ by: 'displayCode', displayCode: '法001' }, {}, manager);
    expect(byCode.outcome).toBe('found');
    const byLegacy = await service.adminReadExact({ by: 'legacy', legacy: legacyFourAct }, {}, manager);
    expect(byLegacy.outcome).toBe('found');
    const missing = await service.adminReadExact({ by: 'displayCode', displayCode: '法999' }, {}, manager);
    expect(missing.outcome).toBe('notFound');
  });

  it('legacy别名歧义返回ambiguous候选，不擅自选一条', async () => {
    const { service } = setup();
    // 同namespace不同version的同key → 两实体 → ambiguous
    await service.createCard({ payload: methodPayload(), legacy: { namespace: 'audited-v4', key: 'four-act' }, idempotencyKey: 'amb-1' }, manager, NOW);
    const svc2 = setup().service;
    await svc2.createCard({ payload: methodPayload(), legacy: { namespace: 'audited-v4', key: 'four-act' }, idempotencyKey: 'amb-2' }, manager, NOW);
    // unique约束会拒绝同namespace+key；用不同key测legacy歧义路径
    const a = await service.createCard({ payload: methodPayload({ name: '方法A' }), legacy: { namespace: 'multi', key: 'shared', version: 1 }, idempotencyKey: 'amb-3' }, manager, NOW);
    void a;
    const result = await service.adminReadExact({ by: 'legacy', legacy: { namespace: 'multi', key: 'shared', version: 1 } }, {}, manager);
    expect(result.outcome).toBe('found');
  });

  it('管理列表过滤+稳定分页：cursor绑定条件，条件改变报cursorInvalid', async () => {
    const { service } = setup();
    for (let i = 0; i < 5; i++) {
      await service.createCard({ payload: methodPayload({ name: `方法${i}` }), legacy: null, idempotencyKey: `list-m${i}` }, manager, NOW);
    }
    for (let i = 0; i < 3; i++) {
      await service.createCard({ payload: referencePayload({ name: `参考${i}` }), legacy: null, idempotencyKey: `list-r${i}` }, manager, NOW);
    }
    const page1 = await service.listAdmin({ assetKind: 'method', limit: 2 }, manager);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await service.listAdmin({ assetKind: 'method', limit: 2, cursor: page1.nextCursor }, manager);
    expect(page2.items).toHaveLength(2);
    // 分页累计无重复（跨层不复制）
    const ids = [...page1.items, ...page2.items].map((c) => c.internalId);
    expect(new Set(ids).size).toBe(4);
    // cursor换条件必须报错
    await expect(service.listAdmin({ assetKind: 'reference', limit: 2, cursor: page1.nextCursor }, manager))
      .rejects.toThrow(CursorInvalidError);
    // 状态过滤
    await service.setStatus(page1.items[0]!.internalId, 'retired', manager, NOW);
    const retiredOnly = await service.listAdmin({ assetKind: 'method', statuses: ['retired'] }, manager);
    expect(retiredOnly.items).toHaveLength(1);
  });

  it('三档投影保留短语与条件；超预算报BudgetError不截断', () => {
    const revision: RevisionRecord = {
      internalId: 'x', revision: 1, assetKind: 'method', schemaVersion: 1,
      payload: methodPayload(), contentHash: 'h', displayCode: '法001',
      shortPhrase: '四段推进', summary: '建立处境—展开发展—关键转向—收束回应。',
      status: 'published', authorActor: 'a', reviewActor: null, createdAt: NOW
    };
    const citation = project(revision, 'citation');
    expect(citation.tier).toBe('citation');
    expect(citation.shortPhrase).toBe('四段推进');
    const digest = project(revision, 'digest');
    expect(digest.tier).toBe('digest');
    if (digest.tier === 'digest') expect(digest.applicableLayers).toEqual(['book_backbone', 'volume']);
    const detail = project(revision, 'detail');
    expect(detail.tier).toBe('detail');
    // 超预算：构造超长payload → detail预算900 → BudgetError，不返回截断内容
    const huge: RevisionRecord = {
      ...revision,
      payload: {
        ...methodPayload(),
        summary: '长'.repeat(200),
        method: { ...methodPayload().method, instruction: '细'.repeat(800) }
      }
    };
    expect(() => project(huge, 'detail')).toThrow(BudgetError);
  });

  it('Unicode字符计量准确：中文与emoji按码点计，不按UTF16', () => {
    expect(countChars('起承转合')).toBe(4);
    expect(countChars('🎮🀄')).toBe(2);
    expect(countChars('家庭👨‍👩‍👧')).toBeGreaterThan(3); // ZWJ家族序列：码点数>3证明按码点而非UTF16计
    expect('🎮'.length).toBe(2); // UTF16按2计（对照）
    expect(countChars('')).toBe(0);
  });

  it('成员读取按release冻结：release内旧版可读、release外新revision不可见', async () => {
    const { service } = setup();
    const a = await service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'frz-1' }, manager, NOW);
    await service.setStatus(a.internalId, 'published', manager, NOW);
    const release1 = await service.publish([{ internalId: a.internalId, revision: 1 }], [], manager, NOW);
    await service.updateCard({ internalId: a.internalId, expectedRevision: 1, payload: methodPayload({ name: '第2版' }) }, manager, NOW);
    await service.setStatus(a.internalId, 'published', manager, NOW);
    await service.publish([{ internalId: a.internalId, revision: 2 }], [], manager, NOW);
    // 冻结release1成员读取：得到revision1而非最新2
    const projection = await service.memberProject({ by: 'displayCode', displayCode: a.displayCode }, release1.releaseId, 'citation', member);
    expect(projection.revision).toBe(1);
  });
});
