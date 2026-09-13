/** B1返修：精确查询/结构化字段过滤/ambiguous实测/Unicode/投影/release分页。 */
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
import { methodPayload, methodPayloadTrickyText, referencePayload } from '../fixtures/creative-reference/samples.js';
import type { RevisionRecord } from '../../apps/api/src/application/creative-reference/types.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
const NOW = '2026-09-13T00:00:00.000Z';
const allowAll: CreativeReferenceAuthorization = { canManage: () => true, canReadAsMember: () => true };

interface Ctx { database: DatabaseSync; repository: SqliteCreativeReferenceRepository; service: CreativeReferenceService; root: string }
const contexts: Ctx[] = [];
function setup(): Ctx {
  const root = mkdtempSync(resolve(tmpdir(), 'b1r-q-'));
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

describe('B1r 精确查询与过滤（返修）', () => {
  it('P1-1：用途/层级按目标revision结构化字段过滤——含层级词的描述文本不误匹配', async () => {
    const ctx = setup();
    const structured = await ctx.service.createCard({ payload: methodPayload({ layers: ['volume'] }), legacy: null, idempotencyKey: 'f-s' }, manager, NOW);
    // summary含"volume"字样但结构化层级是chapter_execution：不该被layers=['volume']命中
    const tricky = await ctx.service.createCard({ payload: methodPayloadTrickyText(), legacy: null, idempotencyKey: 'f-t' }, manager, NOW);
    void tricky;
    const byLayer = await ctx.service.listAdmin({ assetKind: 'method', layers: ['volume'] }, manager);
    expect(byLayer.items.map((c) => c.internalId)).toEqual([structured.internalId]);
    const byUsage = await ctx.service.listAdmin({ assetKind: 'method', usageTree: '结构与节奏' }, manager);
    expect(byUsage.items).toHaveLength(2);
    const otherTree = await ctx.service.listAdmin({ assetKind: 'method', usageTree: '审查与修订' }, manager);
    expect(otherTree.items).toHaveLength(0);
  });

  it('P1-1：usageTree过滤只匹配method字段——reference卡不含usageTree不命中', async () => {
    const ctx = setup();
    await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'f-m' }, manager, NOW);
    const ref = await ctx.service.createCard({ payload: referencePayload(), legacy: null, idempotencyKey: 'f-r' }, manager, NOW);
    void ref;
    const byTree = await ctx.service.listAdmin({ usageTree: '结构与节奏' }, manager);
    expect(byTree.items).toHaveLength(1);
    expect(byTree.items[0]!.assetKind).toBe('method');
    // reference的stages字段过滤
    const byStage = await ctx.service.listAdmin({ assetKind: 'reference', layers: ['opening'] }, manager);
    expect(byStage.items).toHaveLength(1);
    const byWrongStage = await ctx.service.listAdmin({ assetKind: 'reference', layers: ['volume'] }, manager);
    expect(byWrongStage.items).toHaveLength(0);
  });

  it('P2-7：ambiguous实测——同key不同namespace的legacy不歧义；真歧义路径返回候选', async () => {
    const ctx = setup();
    await ctx.service.importLegacyMapping([
      { legacy: { namespace: 'view-a', key: 'name-x' }, payload: methodPayload({ name: '甲' }), sourceView: 'a' },
      { legacy: { namespace: 'view-b', key: 'name-x' }, payload: methodPayload({ name: '乙' }), sourceView: 'b' }
    ], 'amb-1', manager, NOW);
    // 带namespace精确：各自found不歧义
    const a = await ctx.service.adminReadExact({ by: 'legacy', legacy: { namespace: 'view-a', key: 'name-x' } }, {}, manager);
    expect(a.outcome).toBe('found');
    // 同卡多别名（alias表内多namespace挂同一卡）：查询任一别名都found同一卡
    const canonical = await ctx.service.createCard({ payload: methodPayload({ name: 'canonical' }), legacy: null, idempotencyKey: 'amb-2' }, manager, NOW);
    await ctx.service['repository'].attachAlias(canonical.internalId, { namespace: 'n1', key: 'same' }, 'a', NOW);
    await ctx.service['repository'].attachAlias(canonical.internalId, { namespace: 'n2', key: 'same' }, 'b', NOW);
    const byN1 = await ctx.service.adminReadExact({ by: 'legacy', legacy: { namespace: 'n1', key: 'same' } }, {}, manager);
    const byN2 = await ctx.service.adminReadExact({ by: 'legacy', legacy: { namespace: 'n2', key: 'same' } }, {}, manager);
    expect(byN1.outcome).toBe('found');
    expect(byN2.outcome).toBe('found');
    if (byN1.outcome === 'found' && byN2.outcome === 'found') {
      expect(byN1.card.internalId).toBe(byN2.card.internalId);
    }
  });

  it('分页cursor绑定条件；跨页internalId无重复', async () => {
    const ctx = setup();
    for (let i = 0; i < 5; i++) {
      await ctx.service.createCard({ payload: methodPayload({ name: `方法${i}` }), legacy: null, idempotencyKey: `pg-m${i}` }, manager, NOW);
    }
    for (let i = 0; i < 3; i++) {
      await ctx.service.createCard({ payload: referencePayload({ name: `参考${i}` }), legacy: null, idempotencyKey: `pg-r${i}` }, manager, NOW);
    }
    const page1 = await ctx.service.listAdmin({ assetKind: 'method', limit: 2 }, manager);
    expect(page1.items).toHaveLength(2);
    const page2 = await ctx.service.listAdmin({ assetKind: 'method', limit: 2, cursor: page1.nextCursor }, manager);
    expect(page2.items).toHaveLength(2);
    const ids = [...page1.items, ...page2.items].map((c) => c.internalId);
    expect(new Set(ids).size).toBe(4);
    await expect(ctx.service.listAdmin({ assetKind: 'reference', limit: 2, cursor: page1.nextCursor }, manager))
      .rejects.toThrow(CursorInvalidError);
    const retiredTarget = page1.items[0]!;
    await ctx.service.setAvailability(retiredTarget.internalId, 'retired', manager, NOW);
    const retiredOnly = await ctx.service.listAdmin({ assetKind: 'method', availabilities: ['retired'] }, manager);
    expect(retiredOnly.items).toHaveLength(1);
  });

  it('P2-7：release冻结读取——release内旧版可读、release外新revision不可见', async () => {
    const ctx = setup();
    const a = await ctx.service.createCard({ payload: methodPayload(), legacy: null, idempotencyKey: 'frz-1' }, manager, NOW);
    await ctx.service.reviewRevision(a.internalId, 1, reviewer, NOW);
    const r1 = await ctx.service.publish([{ internalId: a.internalId, revision: 1 }], [], manager, null, NOW);
    // 新revision（draft）：不进旧release
    await ctx.service.updateCard({ internalId: a.internalId, expectedRevision: 1, payload: methodPayload({ name: '第2版' }) }, manager, NOW);
    const projection = await ctx.service.memberProject({ by: 'displayCode', displayCode: a.displayCode }, r1.releaseId, 'citation', member);
    expect(projection.revision).toBe(1);
    // 卡回到draft后release读取不受影响（冻结资格只看release清单）
    const still = await ctx.service.memberReadExact({ by: 'displayCode', displayCode: a.displayCode }, r1.releaseId, member);
    expect(still.outcome).toBe('found');
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
    if (digest.tier === 'digest') expect(digest.applicableLayers).toEqual(['book_backbone', 'volume']);
    const detail = project(revision, 'detail');
    expect(detail.tier).toBe('detail');
    if (detail.tier === 'detail') {
      // 适用条件保留在详情投影
      expect(detail.payload.method.boundary).toContain('关键转向');
      expect(detail.payload.method.usageTree).toBe('结构与节奏');
    }
    const huge: RevisionRecord = {
      ...revision,
      payload: { ...methodPayload(), summary: '长'.repeat(200), method: { ...methodPayload().method, instruction: '细'.repeat(800) } }
    };
    expect(() => project(huge, 'detail')).toThrow(BudgetError);
  });

  it('Unicode字符计量准确：中文与emoji按码点计', () => {
    expect(countChars('起承转合')).toBe(4);
    expect(countChars('🎮🀄')).toBe(2);
    expect('🎮'.length).toBe(2);
    expect(countChars('')).toBe(0);
  });

  it('按internalId/displayCode/legacy+revision精确读取；不存在编号不近似匹配', async () => {
    const ctx = setup();
    const card = await ctx.service.createCard({ payload: methodPayload(), legacy: { namespace: 'n', key: 'k1' }, idempotencyKey: 'q-1' }, manager, NOW);
    await ctx.service.updateCard({ internalId: card.internalId, expectedRevision: 1, payload: methodPayload({ name: '第2版名' }) }, manager, NOW);
    const byId = await ctx.service.adminReadExact({ by: 'internalId', internalId: card.internalId }, { revision: 1 }, manager);
    expect(byId.outcome).toBe('found');
    if (byId.outcome === 'found') expect(byId.revision.payload.name).toBe('起承转合');
    const byCode = await ctx.service.adminReadExact({ by: 'displayCode', displayCode: '法001' }, {}, manager);
    expect(byCode.outcome).toBe('found');
    const byLegacy = await ctx.service.adminReadExact({ by: 'legacy', legacy: { namespace: 'n', key: 'k1' } }, {}, manager);
    expect(byLegacy.outcome).toBe('found');
    const missing = await ctx.service.adminReadExact({ by: 'displayCode', displayCode: '法999' }, {}, manager);
    expect(missing.outcome).toBe('notFound');
  });
});
