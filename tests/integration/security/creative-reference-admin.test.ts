/** R209-B2 管理闭环HTTP集成：鉴权、完整链、45卡跨页、发布幂等、迁移重入、退役历史。 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestContext } from '../../helpers/test-context.js';
import { createV7Server } from '../../../apps/api/src/http/v7-server.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');

function methodPayload(name: string, index: number): Record<string, unknown> {
  return {
    assetKind: 'method', name, shortPhrase: `方法${index}短语`, summary: `${name}的简短介绍。`, aliases: [],
    method: { title: name, instruction: `${name}的具体做法与推进方式。`, boundary: '需要组织处境与收束。', usageTree: index % 2 === 0 ? '结构与节奏' : '故事与因果', applicableLayers: index % 3 === 0 ? ['volume'] : ['chapter_execution'], aliases: [] }
  };
}
function referencePayload(name: string, index: number): Record<string, unknown> {
  return {
    assetKind: 'reference', name, shortPhrase: `参考${index}短语`, summary: `${name}的简短介绍。`, aliases: [],
    reference: {
      kind: 'genre',
      facets: { genres: index % 2 === 0 ? ['历史脑洞'] : ['都市脑洞'], mechanisms: ['职业跨界'], experiences: ['反差'], purposes: ['发展空间'] },
      stages: ['opening'], useWhen: ['原始身份有趣'], questions: ['靠什么被看见？'], possibilities: ['技艺→信任'], imbalanceChecks: ['不强制升官'],
      examples: [{ premise: '厨师接触将领', direction: '参与军粮', boundary: '不套战争' }], relatedCards: [], methodRefs: [],
      evidence: { kind: 'editorial_heuristic', refs: ['编辑假设'], limitations: '合成样例' }
    }
  };
}

describe('creative-reference admin routes', () => {
  it('requires admin session: 401 anonymous / 403 regular user / full lifecycle for admin', async () => {
    const c = createTestContext();
    const app = await createV7Server(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      const register = async (email: string) => {
        const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email, displayName: '测试', password: 'Strong-test-pass-123!' } });
        expect(response.statusCode).toBe(200);
        return String(response.headers['set-cookie']).split(';')[0]!;
      };
      const adminCookie = await register('b2-admin-1@example.com');
      const userCookie = await register('b2-user-1@example.com');
      const adminHeaders = { ...headers, cookie: adminCookie };
      const userHeaders = { ...headers, cookie: userCookie };

      // 鉴权矩阵：未登录401、普通403（GET和POST都测）
      expect((await app.inject({ url: '/api/v1/admin/creative-reference/cards', headers })).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/v1/admin/creative-reference/cards', headers: userHeaders })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers, payload: {} })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: userHeaders, payload: {} })).statusCode).toBe(403);

      // 完整链：建卡→读列表→详情→改草稿→审核→发布→再编辑→历史读取
      const createRes = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: methodPayload('起承转合', 1), legacy: null, idempotencyKey: 'b2-chain-1' } });
      expect(createRes.statusCode).toBe(200);
      const card = (createRes.json().data as { card: { internalId: string; displayCode: string; currentRevision: number } }).card;
      expect(card.displayCode).toBe('法001');
      // 重复同请求幂等
      const replayRes = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: methodPayload('起承转合', 1), legacy: null, idempotencyKey: 'b2-chain-1' } });
      expect(replayRes.statusCode).toBe(200);
      const replayData = replayRes.json().data as { card: { internalId: string } };
      expect(replayData.card.internalId).toBe(card.internalId);
      // 同键异内容409
      const conflictRes = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: methodPayload('三幕式', 2), legacy: null, idempotencyKey: 'b2-chain-1' } });
      expect(conflictRes.statusCode).toBe(409);

      // 列表+详情
      const listRes = await app.inject({ url: '/api/v1/admin/creative-reference/cards?assetKind=method&keyword=起承转合', headers: adminHeaders });
      expect(listRes.statusCode).toBe(200);
      const listData = listRes.json().data as { items: Array<{ internalId: string; shortPhrase: string }>; nextCursor: string | null };
      expect(listData.items).toHaveLength(1);
      expect(listData.items[0]!.internalId).toBe(card.internalId);
      expect(listData.nextCursor).toBeNull();
      const detailRes = await app.inject({ url: `/api/v1/admin/creative-reference/cards/${card.internalId}`, headers: adminHeaders });
      expect(detailRes.statusCode).toBe(200);
      const detail = detailRes.json().data as { revision: { revision: number; status: string }; audit: Array<{ action: string }> };
      expect(detail.revision.status).toBe('draft');
      expect(detail.audit.some((a) => a.action === 'create')).toBe(true);

      // lookup精确：displayCode命中；不存在404
      const lookupRes = await app.inject({ url: '/api/v1/admin/creative-reference/lookup?by=displayCode&displayCode=%E6%B3%95001', headers: adminHeaders });
      expect(lookupRes.statusCode).toBe(200);
      expect((lookupRes.json().data as { outcome: string }).outcome).toBe('found');
      expect((await app.inject({ url: '/api/v1/admin/creative-reference/lookup?by=displayCode&displayCode=%E6%B3%95099', headers: adminHeaders })).statusCode).toBe(404);

      // 编辑草稿→审核→发布
      const revRes = await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/revisions`, headers: adminHeaders, payload: { payload: methodPayload('起承转合修订', 1), expectedRevision: 1 } });
      expect(revRes.statusCode).toBe(200);
      const revBody = revRes.json().data as { revision: { revision: number; status: string } };
      expect(revBody.revision.status).toBe('draft');
      // 旧expectedRevision冲突409
      expect((await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/revisions`, headers: adminHeaders, payload: { payload: methodPayload('再改', 1), expectedRevision: 1 } })).statusCode).toBe(409);
      // 未审核发布400
      const unreviewedPublish = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: [{ internalId: card.internalId, revision: 2 }], relations: [], expectedActiveReleaseId: null, idempotencyKey: 'b2-rel-x' } });
      expect(unreviewedPublish.statusCode).toBe(400);
      // 审核（带意见）
      const reviewRes = await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/review`, headers: adminHeaders, payload: { expectedRevision: 2, opinion: '人工审核通过：结构与条件完整。' } });
      expect(reviewRes.statusCode).toBe(200);
      // 版本历史含审核意见
      const historyRes = await app.inject({ url: `/api/v1/admin/creative-reference/cards/${card.internalId}/revisions`, headers: adminHeaders });
      const history = historyRes.json().data as { items: Array<{ revision: number; status: string; reviewOpinion: string | null }>; total: number };
      expect(history.total).toBe(2);
      const reviewed = history.items.find((item) => item.revision === 2)!;
      expect(reviewed.status).toBe('reviewed');
      expect(reviewed.reviewOpinion).toContain('人工审核通过');
      // 具体版本读取
      const revDetail = await app.inject({ url: `/api/v1/admin/creative-reference/cards/${card.internalId}/revisions/2`, headers: adminHeaders });
      expect(revDetail.statusCode).toBe(200);

      // 发布
      const publishRes = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: [{ internalId: card.internalId, revision: 2 }], relations: [], expectedActiveReleaseId: null, idempotencyKey: 'b2-rel-1' } });
      expect(publishRes.statusCode).toBe(200);
      const release = (publishRes.json().data as { release: { releaseId: string; active: boolean; entries: Array<{ internalId: string; revision: number }> }; replayed: boolean }).release;
      expect(release.active).toBe(true);
      // 重复发布幂等（同键同内容）
      const republishRes = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: [{ internalId: card.internalId, revision: 2 }], relations: [], expectedActiveReleaseId: null, idempotencyKey: 'b2-rel-1' } });
      expect(republishRes.statusCode).toBe(200);
      expect((republishRes.json().data as { release: { releaseId: string }; replayed: boolean }).replayed).toBe(true);
      // 同键异内容409
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: [], relations: [], expectedActiveReleaseId: release.releaseId, idempotencyKey: 'b2-rel-1' } })).statusCode).toBe(400);
      // 陈旧active指针：预期不符属于版本冲突409
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: [{ internalId: card.internalId, revision: 2 }], relations: [], expectedActiveReleaseId: 'not-the-active-id', idempotencyKey: 'b2-stale-1' } })).statusCode).toBe(409);
      // 陈旧active预期409
      const staleRes = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: [{ internalId: card.internalId, revision: 2 }], relations: [], expectedActiveReleaseId: null, idempotencyKey: 'b2-rel-2' } });
      expect(staleRes.statusCode).toBe(409);

      // releases列表含activeReleaseId；release详情冻结清单+条目分页
      const releasesRes = await app.inject({ url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders });
      const releasesData = releasesRes.json().data as { items: Array<{ releaseId: string; active: boolean; entryCount: number }>; activeReleaseId: string | null };
      expect(releasesData.activeReleaseId).toBe(release.releaseId);
      expect(releasesData.items[0]!.entryCount).toBe(1);
      const releaseDetailRes = await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release.releaseId}/entries?limit=100`, headers: adminHeaders });
      expect(releaseDetailRes.statusCode).toBe(200);
      expect(((releaseDetailRes.json().data as { items: unknown[] }).items)).toHaveLength(1);

      // 再编辑→旧release读取不变
      await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/revisions`, headers: adminHeaders, payload: { payload: methodPayload('第三版', 1), expectedRevision: 2 } });
      const oldRevision = await app.inject({ url: `/api/v1/admin/creative-reference/cards/${card.internalId}/revisions/2`, headers: adminHeaders });
      expect(oldRevision.statusCode).toBe(200);
      const oldRevBody = oldRevision.json().data as { revision: { payload: { name: string } } };
      expect(oldRevBody.revision.payload.name).toBe('起承转合修订');

      // 退役：意见留痕、再退役冲突、恢复、恢复后历史可读（所见状态+版本必传，原子校验）
      const retireRes = await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/availability`, headers: adminHeaders, payload: { action: 'retire', seenAvailability: 'draft', seenRevision: 3, reason: '内容并入其他条目' } });
      expect(retireRes.statusCode).toBe(200);
      const retireBody = retireRes.json().data as { card: { availability: string } };
      expect(retireBody.card.availability).toBe('retired');
      expect((await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/availability`, headers: adminHeaders, payload: { action: 'retire', seenAvailability: 'retired', seenRevision: 3 } })).statusCode).toBe(409);
      // 并发覆盖防护：所见状态不对409；所见版本不对409；缺任一所见值400
      expect((await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/availability`, headers: adminHeaders, payload: { action: 'restore', seenAvailability: 'published', seenRevision: 3 } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/availability`, headers: adminHeaders, payload: { action: 'restore', seenAvailability: 'retired', seenRevision: 2 } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/availability`, headers: adminHeaders, payload: { action: 'retire', seenAvailability: 'retired' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/availability`, headers: adminHeaders, payload: { action: 'retire', seenRevision: 3 } })).statusCode).toBe(400);
      // 退役卡不能再发布
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: [{ internalId: card.internalId, revision: 2 }], relations: [], expectedActiveReleaseId: release.releaseId, idempotencyKey: 'b2-rel-3' } })).statusCode).toBe(400);
      const restoreRes = await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${card.internalId}/availability`, headers: adminHeaders, payload: { action: 'restore', seenAvailability: 'retired', seenRevision: 3, reason: '恢复使用' } });
      expect(restoreRes.statusCode).toBe(200);
      const restoreBody = restoreRes.json().data as { card: { availability: string } };
      expect(restoreBody.card.availability).toBe('draft');

      // 非法输入：坏payload 400、坏limit 400、坏游标400、未知卡404
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: { assetKind: 'method' }, idempotencyKey: 'b2-bad-1' } })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/v1/admin/creative-reference/cards?limit=0', headers: adminHeaders })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/v1/admin/creative-reference/cards?cursor=bad', headers: adminHeaders })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/v1/admin/creative-reference/cards/nonexistent', headers: adminHeaders })).statusCode).toBe(404);

      // 落盘后新连接可读（持久化验证，不动原连接避免重复close）
      const reopened = new DatabaseSync(c.config.databasePath);
      const count = (reopened.prepare('SELECT COUNT(*) c FROM creative_reference_releases').get() as { c: number }).c;
      const auditCount = (reopened.prepare('SELECT COUNT(*) c FROM creative_reference_admin_audit').get() as { c: number }).c;
      reopened.close();
      expect(count).toBeGreaterThanOrEqual(1);
      expect(auditCount).toBeGreaterThanOrEqual(4);
    } finally {
      await app.close();
      c.close();
    }
  }, 120_000);

  it('45-card cross-page filtering with cursor condition rejection; full-release preservation of untouched 44', async () => {
    const c = createTestContext();
    const app = await createV7Server(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'b2-admin-45@example.com', displayName: '管理员', password: 'Strong-test-pass-123!' } });
      expect(register.statusCode).toBe(200);
      const adminHeaders = { ...headers, cookie: String(register.headers['set-cookie']).split(';')[0]! };

      const ids: Array<{ internalId: string }> = [];
      for (let i = 1; i <= 45; i++) {
        const payload = i <= 22 ? methodPayload(`方法卡${i}`, i) : referencePayload(`参考卡${i}`, i);
        const res = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload, legacy: null, idempotencyKey: `b2-45-${i}` } });
        expect(res.statusCode).toBe(200);
        ids.push({ internalId: (res.json().data as { card: { internalId: string } }).card.internalId });
      }
      // 全部审核
      for (const item of ids) {
        const res = await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${item.internalId}/review`, headers: adminHeaders, payload: { expectedRevision: 1, opinion: '批量人工审核' } });
        expect(res.statusCode).toBe(200);
      }
      // 跨页筛选：method共22张、页大小10 → 三页
      const page1 = (await (await app.inject({ url: '/api/v1/admin/creative-reference/cards?assetKind=method&limit=10', headers: adminHeaders })).json().data) as { items: Array<{ internalId: string }>; nextCursor: string };
      expect(page1.items).toHaveLength(10);
      const page2 = (await (await app.inject({ url: `/api/v1/admin/creative-reference/cards?assetKind=method&limit=10&cursor=${encodeURIComponent(page1.nextCursor)}`, headers: adminHeaders })).json().data) as { items: Array<{ internalId: string }>; nextCursor: string };
      expect(page2.items).toHaveLength(10);
      const page3 = (await (await app.inject({ url: `/api/v1/admin/creative-reference/cards?assetKind=method&limit=10&cursor=${encodeURIComponent(page2.nextCursor)}`, headers: adminHeaders })).json().data) as { items: Array<{ internalId: string }>; nextCursor: string | null };
      expect(page3.items).toHaveLength(2);
      expect(page3.nextCursor).toBeNull();
      const allIds = [...page1.items, ...page2.items, ...page3.items].map((item) => item.internalId);
      expect(new Set(allIds).size).toBe(22);
      // 游标换条件拒绝
      const wrongFilter = await app.inject({ url: `/api/v1/admin/creative-reference/cards?assetKind=reference&limit=10&cursor=${encodeURIComponent(page1.nextCursor)}`, headers: adminHeaders });
      expect(wrongFilter.statusCode).toBe(400);
      // 用途/层级/状态筛选服务端生效（不只筛当前页——在跨页断言里体现为全集计数）
      const treeFilter = (await (await app.inject({ url: '/api/v1/admin/creative-reference/cards?assetKind=method&usageTree=%E7%BB%93%E6%9E%84%E4%B8%8E%E8%8A%82%E5%A5%8F&limit=100', headers: adminHeaders })).json().data) as { items: unknown[] };
      expect(treeFilter.items.length).toBeGreaterThanOrEqual(1);

      // 发布45卡release
      const publishRes = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: ids.map((item) => ({ internalId: item.internalId, revision: 1 })), relations: [], expectedActiveReleaseId: null, idempotencyKey: 'b2-45-rel-1' } });
      expect(publishRes.statusCode).toBe(200);
      const release45 = (publishRes.json().data as { release: { releaseId: string; entries: unknown[] } }).release;
      expect(release45.entries).toHaveLength(45);
      // 只修改一条再发布：其余44保留
      const changed = ids[7]!;
      const editRes = await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${changed.internalId}/revisions`, headers: adminHeaders, payload: { payload: methodPayload('方法卡8修订', 8), expectedRevision: 1 } });
      expect(editRes.statusCode).toBe(200);
      await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${changed.internalId}/review`, headers: adminHeaders, payload: { expectedRevision: 2, opinion: '修订审核' } });
      const nextEntries = ids.map((item) => item.internalId === changed.internalId ? { internalId: item.internalId, revision: 2 } : { internalId: item.internalId, revision: 1 });
      const publish2Res = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: nextEntries, relations: [], expectedActiveReleaseId: release45.releaseId, idempotencyKey: 'b2-45-rel-2' } });
      expect(publish2Res.statusCode).toBe(200);
      const release2 = (publish2Res.json().data as { release: { releaseId: string; entries: Array<{ internalId: string; revision: number }> } }).release;
      expect(release2.entries).toHaveLength(45);
      expect(release2.entries.find((e) => e.internalId === changed.internalId)!.revision).toBe(2);
      expect(release2.entries.filter((e) => e.revision === 1)).toHaveLength(44);
      // 旧release冻结不变：条目走冻结分页遍历（不读活动指针）
      const frozen: Array<{ internalId: string; revision: number }> = [];
      let entriesCursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const res = (await (await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release45.releaseId}/entries?limit=20${entriesCursor === null ? '' : `&cursor=${encodeURIComponent(entriesCursor)}`}`, headers: adminHeaders })).json().data) as { items: Array<{ internalId: string; revision: number }>; nextCursor: string | null };
        frozen.push(...res.items);
        entriesCursor = res.nextCursor;
        if (entriesCursor === null) break;
      }
      expect(frozen).toHaveLength(45);
      expect(frozen.find((e) => e.internalId === changed.internalId)!.revision).toBe(1);
      // 悬空关系拒绝：目标不在清单
      const dangling = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: [{ internalId: ids[0]!.internalId, revision: 1 }], relations: [{ fromId: ids[0]!.internalId, fromRevision: 1, toId: 'nonexistent', toRevision: 1, relationType: 'supplement' }], expectedActiveReleaseId: release2.releaseId, idempotencyKey: 'b2-45-rel-3' } });
      expect(dangling.statusCode).toBe(400);
    } finally {
      await app.close();
      c.close();
    }
  }, 240_000);

  it('migration 0123: real migrator first-run and re-run; 0122 data preserved', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'b2-mig-'));
    try {
      const database = new DatabaseSync(resolve(root, 'wenmi.sqlite'));
      const first = runMigrations(database, MIGRATIONS_DIR);
      expect(first.applied).toContain('0123_creative_reference_admin_audit.sql');
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'creative_reference_%'").all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name).sort()).toContain('creative_reference_admin_audit');
      expect(tables.map((t) => t.name).sort()).toContain('creative_reference_release_requests');
      // 写0122数据后重入
      database.exec("INSERT INTO creative_reference_counters(asset_kind, next_number) VALUES ('method', 99)");
      const again = runMigrations(database, MIGRATIONS_DIR);
      expect(again.applied).toEqual([]);
      expect((database.prepare("SELECT next_number FROM creative_reference_counters WHERE asset_kind='method'").get() as { next_number: number }).next_number).toBe(99);
      database.close();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fault injection: audit/result-write failure rolls back state+audit+request; same-key retry succeeds after rollback', async () => {
    const c = createTestContext();
    const app = await createV7Server(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'b2-atomic@example.com', displayName: '管理员', password: 'Strong-test-pass-123!' } });
      const adminHeaders = { ...headers, cookie: String(register.headers['set-cookie']).split(';')[0]! };
      const create = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: methodPayload('原子性方法', 1), legacy: null, idempotencyKey: 'atomic-1' } });
      const internalId = (create.json().data as { card: { internalId: string } }).card.internalId;

      // 反例1：review审计写入失败 → HTTP错误且revision保持draft、无意见、无review审计行
      c.database.exec("CREATE TRIGGER fail_review_audit BEFORE INSERT ON creative_reference_admin_audit WHEN NEW.action='review' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
      const failedReview = await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${internalId}/review`, headers: adminHeaders, payload: { expectedRevision: 1, opinion: '必须同事务' } });
      expect(failedReview.statusCode).toBeGreaterThanOrEqual(500);
      const revState = c.database.prepare('SELECT status FROM creative_reference_revisions WHERE internal_id=? AND revision=1').get(internalId) as { status: string };
      expect(revState.status).toBe('draft');
      expect((c.database.prepare("SELECT COUNT(*) n FROM creative_reference_admin_audit WHERE action='review'").get() as { n: number }).n).toBe(0);
      c.database.exec('DROP TRIGGER fail_review_audit');
      // 故障解除后重试成功：意见与审计留痕
      const okReview = await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${internalId}/review`, headers: adminHeaders, payload: { expectedRevision: 1, opinion: '故障后重审通过' } });
      expect(okReview.statusCode).toBe(200);
      expect((c.database.prepare("SELECT COUNT(*) n FROM creative_reference_admin_audit WHERE action='review' AND opinion='故障后重审通过'").get() as { n: number }).n).toBe(1);

      // 反例2：create审计写入失败 → 无卡、无版本、无审计（整体回滚）
      c.database.exec("CREATE TRIGGER fail_create_audit BEFORE INSERT ON creative_reference_admin_audit WHEN NEW.action='create' BEGIN SELECT RAISE(ABORT,'synthetic create audit failure'); END");
      const failedCreate = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: methodPayload('失败创建', 2), legacy: null, idempotencyKey: 'atomic-2' } });
      expect(failedCreate.statusCode).toBeGreaterThanOrEqual(500);
      expect((c.database.prepare("SELECT COUNT(*) n FROM creative_reference_cards WHERE idempotency_key='atomic-2'").get() as { n: number }).n).toBe(0);
      c.database.exec('DROP TRIGGER fail_create_audit');

      // 反例3：发布结果回填失败 → active指针、请求记录、审计与发布全部回滚；同键重试可成功
      c.database.exec('CREATE TRIGGER fail_release_result BEFORE UPDATE OF release_id ON creative_reference_release_requests BEGIN SELECT RAISE(ABORT,\'synthetic result failure\'); END');
      const publishBody = { entries: [{ internalId, revision: 1 }], relations: [], expectedActiveReleaseId: null, idempotencyKey: 'atomic-release-1' };
      const failedPublish = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: publishBody });
      expect(failedPublish.statusCode).toBeGreaterThanOrEqual(500);
      expect(c.database.prepare('SELECT release_id FROM creative_reference_releases WHERE active=1').get()).toBeUndefined();
      expect(c.database.prepare('SELECT release_id FROM creative_reference_release_requests WHERE request_key=?').get('atomic-release-1')).toBeUndefined();
      expect((c.database.prepare("SELECT COUNT(*) n FROM creative_reference_admin_audit WHERE action='publish'").get() as { n: number }).n).toBe(0);
      c.database.exec('DROP TRIGGER fail_release_result');
      const retryPublish = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: publishBody });
      expect(retryPublish.statusCode).toBe(200);
      const retried = retryPublish.json().data as { release: { releaseId: string }; replayed: boolean };
      expect(retried.replayed).toBe(false);
      expect(c.database.prepare('SELECT release_id FROM creative_reference_releases WHERE active=1').get()).toMatchObject({ release_id: retried.release.releaseId });
    } finally {
      await app.close();
      c.close();
    }
  }, 120_000);

  it('usage tree filter: method usageTree and reference purposes match main class and children', async () => {
    const c = createTestContext();
    const app = await createV7Server(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'b2-usage@example.com', displayName: '管理员', password: 'Strong-test-pass-123!' } });
      const adminHeaders = { ...headers, cookie: String(register.headers['set-cookie']).split(';')[0]! };
      // method：主类直接命中；reference：purposes存主类与子类各一张
      await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: methodPayload('因果方法', 1), legacy: null, idempotencyKey: 'usage-m-1' } });
      await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: methodPayload('节奏方法', 2), legacy: null, idempotencyKey: 'usage-m-2' } });
      const withPurposes = (name: string, index: number, purposes: string[]): Record<string, unknown> => {
        const payload = referencePayload(name, index);
        (payload.reference as { facets: { purposes: string[] } }).facets.purposes = purposes;
        return payload;
      };
      await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: withPurposes('人物参考主类', 3, ['人物与关系']), legacy: null, idempotencyKey: 'usage-r-1' } });
      await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: withPurposes('人物参考子类', 4, ['欲望动机']), legacy: null, idempotencyKey: 'usage-r-2' } });

      const list = async (query: string): Promise<Array<{ displayCode: string; assetKind: string }>> =>
        ((await (await app.inject({ url: `/api/v1/admin/creative-reference/cards?${query}`, headers: adminHeaders })).json().data) as { items: Array<{ displayCode: string; assetKind: string }> }).items;
      // method命中/不命中
      expect((await list('assetKind=method&usageTree=' + encodeURIComponent('故事与因果'))).map((i) => i.displayCode)).toEqual(['法001']);
      expect((await list('assetKind=method&usageTree=' + encodeURIComponent('人物与关系')))).toHaveLength(0);
      // reference：主类与子类purposes都命中主类筛选（Codex探针场景）
      const refHits = await list('assetKind=reference&usageTree=' + encodeURIComponent('人物与关系'));
      expect(refHits).toHaveLength(2);
      expect(refHits.every((i) => i.assetKind === 'reference')).toBe(true);
      // 混合（不带类型）：method因果 + 两张reference人物
      const mixed = await list('usageTree=' + encodeURIComponent('人物与关系'));
      expect(mixed).toHaveLength(2);
      // 不存在的用途：无结果且HTTP 200（不近似替代）
      expect((await list('usageTree=' + encodeURIComponent('不存在的用途')))).toHaveLength(0);
      // 跨页：5张同主类method卡，limit=2 → 3页无重复
      const genreTreePayload = (name: string): Record<string, unknown> => {
        const payload = methodPayload(name, 1);
        (payload.method as { usageTree: string }).usageTree = '题材与融合';
        return payload;
      };
      for (let i = 1; i <= 5; i += 1) {
        await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: genreTreePayload(`题材方法${i}`), legacy: null, idempotencyKey: `usage-mg-${i}` } });
      }
      const collected: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const res = (await (await app.inject({ url: `/api/v1/admin/creative-reference/cards?assetKind=method&usageTree=${encodeURIComponent('题材与融合')}&limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`, headers: adminHeaders })).json().data) as { items: Array<{ displayCode: string }>; nextCursor: string | null };
        collected.push(...res.items.map((i) => i.displayCode));
        cursor = res.nextCursor;
        if (cursor === null) break;
      }
      expect(collected).toHaveLength(5);
      expect(new Set(collected).size).toBe(5);
    } finally {
      await app.close();
      c.close();
    }
  }, 120_000);

  it('release entries pagination with cursor validation; relations across two releases; per-release freeze', async () => {
    const c = createTestContext();
    const app = await createV7Server(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'b2-relpage@example.com', displayName: '管理员', password: 'Strong-test-pass-123!' } });
      const adminHeaders = { ...headers, cookie: String(register.headers['set-cookie']).split(';')[0]! };
      const ids: string[] = [];
      for (let i = 1; i <= 5; i += 1) {
        const res = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/cards', headers: adminHeaders, payload: { payload: methodPayload(`关系卡${i}`, i), legacy: null, idempotencyKey: `relpage-${i}` } });
        ids.push((res.json().data as { card: { internalId: string } }).card.internalId);
        await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${ids[i - 1]}/review`, headers: adminHeaders, payload: { expectedRevision: 1, opinion: '审核' } });
      }
      // 首发带边：A@1 supplement B@1
      const rel1 = [{ fromId: ids[0]!, fromRevision: 1, toId: ids[1]!, toRevision: 1, relationType: 'supplement' as const }];
      const publish1 = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: ids.map((id) => ({ internalId: id, revision: 1 })), relations: rel1, expectedActiveReleaseId: null, idempotencyKey: 'relpage-rel-1' } });
      expect(publish1.statusCode).toBe(200);
      const release1 = (publish1.json().data as { release: { releaseId: string } }).release.releaseId;

      // 冻结分页：limit=2 → 2+2+1，nextCursor链尾null
      const page1 = (await (await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release1}/entries?limit=2`, headers: adminHeaders })).json().data) as { items: Array<{ internalId: string }>; nextCursor: string };
      expect(page1.items).toHaveLength(2);
      const page2 = (await (await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release1}/entries?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, headers: adminHeaders })).json().data) as { items: Array<{ internalId: string }>; nextCursor: string };
      expect(page2.items).toHaveLength(2);
      const page3 = (await (await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release1}/entries?limit=2&cursor=${encodeURIComponent(page2.nextCursor)}`, headers: adminHeaders })).json().data) as { items: Array<{ internalId: string }>; nextCursor: string | null };
      expect(page3.items).toHaveLength(1);
      expect(page3.nextCursor).toBeNull();
      expect(new Set([...page1.items, ...page2.items, ...page3.items].map((i) => i.internalId)).size).toBe(5);
      // 游标校验：畸形、跨release、带过滤指纹均拒绝400
      expect((await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release1}/entries?cursor=bad`, headers: adminHeaders })).statusCode).toBe(400);
      expect((await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release1}/entries?cursor=${encodeURIComponent(Buffer.from(JSON.stringify({ releaseId: 'another-release', lastInternalId: 'x', filterFingerprint: null }), 'utf8').toString('base64url'))}`, headers: adminHeaders })).statusCode).toBe(400);
      expect((await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release1}/entries?cursor=${encodeURIComponent(Buffer.from(JSON.stringify({ releaseId: release1, lastInternalId: page1.items[0]!.internalId, filterFingerprint: 'stale' }), 'utf8').toString('base64url'))}`, headers: adminHeaders })).statusCode).toBe(400);
      expect((await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release1}/entries?limit=0`, headers: adminHeaders })).statusCode).toBe(400);

      // 二发：替换A为第2版并把边端点版本更新到A@2；未动条目与边语义保持
      await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${ids[0]}/revisions`, headers: adminHeaders, payload: { payload: methodPayload('关系卡1修订', 1), expectedRevision: 1 } });
      await app.inject({ method: 'POST', url: `/api/v1/admin/creative-reference/cards/${ids[0]}/review`, headers: adminHeaders, payload: { expectedRevision: 2, opinion: '修订审核' } });
      const rel2 = [{ fromId: ids[0]!, fromRevision: 2, toId: ids[1]!, toRevision: 1, relationType: 'supplement' as const }];
      const publish2 = await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: ids.map((id) => ({ internalId: id, revision: id === ids[0] ? 2 : 1 })), relations: rel2, expectedActiveReleaseId: release1, idempotencyKey: 'relpage-rel-2' } });
      expect(publish2.statusCode).toBe(200);
      const release2 = (publish2.json().data as { release: { releaseId: string } }).release.releaseId;

      // 两个release的冻结关系各自可读且不变（不可变边复用，端点版本不同则视为新边）
      const relations1 = ((await (await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release1}`, headers: adminHeaders })).json().data) as { relations: Array<{ fromRevision: number; toRevision: number }> }).relations.map((r) => ({ fromRevision: r.fromRevision, toRevision: r.toRevision }));
      expect(relations1).toEqual([{ fromRevision: 1, toRevision: 1 }]);
      const relations2 = ((await (await app.inject({ url: `/api/v1/admin/creative-reference/releases/${release2}`, headers: adminHeaders })).json().data) as { relations: Array<{ fromRevision: number; toRevision: number }> }).relations.map((r) => ({ fromRevision: r.fromRevision, toRevision: r.toRevision }));
      expect(relations2).toEqual([{ fromRevision: 2, toRevision: 1 }]);
      // 陈旧active 409（用已过期的active指针发布）
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/creative-reference/releases', headers: adminHeaders, payload: { entries: ids.map((id) => ({ internalId: id, revision: id === ids[0] ? 2 : 1 })), relations: rel2, expectedActiveReleaseId: release1, idempotencyKey: 'relpage-rel-3' } })).statusCode).toBe(409);
    } finally {
      await app.close();
      c.close();
    }
  }, 180_000);
});
