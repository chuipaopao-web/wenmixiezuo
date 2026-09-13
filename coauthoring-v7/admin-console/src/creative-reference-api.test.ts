// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchCreativeCards, fetchCreativeRevisionSnapshot, publishCreativeRelease } from './creative-reference-api';

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('创作库管理API客户端', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('列表筛选与游标组装为服务端查询参数', async () => {
    const fetchMock = vi.fn(async () => ok({ items: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchCreativeCards({ assetKind: 'reference', keyword: '小人物', usageTree: '故事与因果', layers: ['volume'], availabilities: ['draft'], genre: '都市脑洞', cursor: 'PAGE2', limit: 50 });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/api/v1/admin/creative-reference/cards?');
    for (const fragment of ['assetKind=reference', 'keyword=%E5%B0%8F%E4%BA%BA%E7%89%A9', 'usageTree=', 'layers=volume', 'status=draft', 'genre=', 'cursor=PAGE2', 'limit=50']) {
      expect(url).toContain(fragment);
    }
  });

  test('具体版本快照走精确路径并透传数据', async () => {
    const fetchMock = vi.fn(async () => ok({ revision: { revision: 2, payload: { assetKind: 'method', name: 'x', shortPhrase: 'y', summary: 'z', aliases: [] }, shortPhrase: 'y', summary: 'z', status: 'published', authorActor: 'a', reviewActor: null, createdAt: '2026-09-13T00:00:00Z' }, reviewOpinion: null }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchCreativeRevisionSnapshot('card-1', 2);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/api/v1/admin/creative-reference/cards/card-1/revisions/2');
    expect(result.revision.revision).toBe(2);
  });

  test('发布提交完整manifest（条目+关系+乐观锁+幂等键），不依赖当前筛选', async () => {
    const fetchMock = vi.fn(async () => ok({ release: { releaseId: 'rel-1', manifestHash: 'h', active: true, createdAt: '2026-09-13T00:00:00Z', publishedBy: 'admin', entries: [], relations: [] }, replayed: false }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await publishCreativeRelease({
      entries: [{ internalId: 'a', revision: 1 }, { internalId: 'b', revision: 3 }],
      relations: [{ fromId: 'a', fromRevision: 1, toId: 'b', toRevision: 3, relationType: 'supplement' }],
      expectedActiveReleaseId: 'rel-0',
      idempotencyKey: 'rel-key-1'
    });
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/v1/admin/creative-reference/releases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      entries: [{ internalId: 'a', revision: 1 }, { internalId: 'b', revision: 3 }],
      relations: [{ fromId: 'a', fromRevision: 1, toId: 'b', toRevision: 3, relationType: 'supplement' }],
      expectedActiveReleaseId: 'rel-0',
      idempotencyKey: 'rel-key-1'
    });
    expect(result.release.releaseId).toBe('rel-1');
  });

  test('错误envelope抛出服务器可读文案，不伪装成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: '发布请求键已用于不同内容。' } }), { status: 409 })));
    await expect(fetchCreativeCards({})).rejects.toThrow('发布请求键已用于不同内容。');
  });
});
