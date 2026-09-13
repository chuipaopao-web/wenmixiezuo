// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreativeReferenceLibrary } from './CreativeReferenceLibrary';
import * as api from './creative-reference-api';

vi.mock('./creative-reference-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creative-reference-api')>();
  return {
    ...actual,
    fetchCreativeCards: vi.fn(),
    fetchCreativeCardDetail: vi.fn(),
    fetchCreativeRevisions: vi.fn(),
    fetchCreativeRevisionSnapshot: vi.fn(),
    fetchCreativeReleases: vi.fn(),
    fetchCreativeReleaseDetail: vi.fn(),
    fetchCreativeReleaseEntries: vi.fn(),
    saveCreativeCardRevision: vi.fn(),
    reviewCreativeCard: vi.fn(),
    setCreativeAvailability: vi.fn(),
    createCreativeCard: vi.fn(),
    publishCreativeRelease: vi.fn()
  };
});

const mocked = vi.mocked(api);

function summary(internalId: string, displayCode: string, name: string, overrides: Partial<api.CreativeCardSummary> = {}): api.CreativeCardSummary {
  return {
    internalId, assetKind: 'method', displayCode, name, shortPhrase: `${name}短语`, summary: `${name}的简短介绍。`,
    usageTree: '结构与节奏', applicableLayers: ['volume'], genres: [], mechanisms: [], experiences: [], aliases: [],
    currentRevision: 1, revisionStatus: 'draft', availability: 'draft', updatedAt: '2026-09-13T08:00:00Z',
    ...overrides
  };
}

function detailPayload(name: string): api.CreativeCardPayload {
  return {
    assetKind: 'method', name, shortPhrase: `${name}短语`, summary: `${name}的简短介绍。`, aliases: [],
    method: { title: name, instruction: '先建立处境，再推进发展。', boundary: '需要收束。', usageTree: '结构与节奏', applicableLayers: ['volume'], aliases: [] }
  };
}

function detailOf(card: api.CreativeCardSummary): api.CreativeCardDetail {
  return {
    card: { internalId: card.internalId, assetKind: 'method', displayCode: card.displayCode, currentRevision: 1, availability: 'draft', createdAt: '2026-09-13T08:00:00Z', updatedAt: '2026-09-13T08:00:00Z' },
    revision: { internalId: card.internalId, revision: 1, payload: detailPayload(card.name), shortPhrase: card.shortPhrase, summary: card.summary, status: 'draft', authorActor: 'admin-1', reviewActor: null, createdAt: '2026-09-13T08:00:00Z' },
    aliases: [],
    audit: [{ action: 'create', actorId: 'admin-1', opinion: null, createdAt: '2026-09-13T08:00:00Z', targetRevision: 1 }]
  };
}

describe('创作库管理页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.fetchCreativeCards.mockResolvedValue({ items: [summary('card-1', '法001', '起承转合'), summary('card-2', '法002', '三幕式', { availability: 'retired', revisionStatus: 'published' })], nextCursor: null });
    mocked.fetchCreativeRevisions.mockResolvedValue({ items: [{ revision: 1, status: 'draft', shortPhrase: '起承转合短语', summary: '说明', authorActor: 'admin-1', reviewActor: null, reviewOpinion: null, createdAt: '2026-09-13T08:00:00Z' }], total: 1, nextOffset: null });
    mocked.fetchCreativeCardDetail.mockImplementation(async (id: string) => detailOf(summary(id, '法001', '起承转合')));
  });
  afterEach(() => cleanup());

  it('成功渲染列表：编号+短语、名称、说明、版本状态与退役标记', async () => {
    render(<CreativeReferenceLibrary />);
    expect(await screen.findByText('法001')).toBeVisible();
    expect(screen.getByText('起承转合')).toBeVisible();
    expect(screen.getByText(/法002/)).toBeVisible();
    expect(screen.getAllByText(/已合并或退役/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('第1版 · 草稿')).toBeVisible();
    const call = mocked.fetchCreativeCards.mock.calls[0]!;
    expect(call[0].assetKind).toBe('method');
    expect(call[0].limit).toBe(20);
  });

  it('加载中显示真实读取状态', async () => {
    mocked.fetchCreativeCards.mockReturnValue(new Promise(() => {}));
    render(<CreativeReferenceLibrary />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取创作库');
  });

  it('编辑保留关联用途与条件用法，详情显示重点阶段和触发条件', async () => {
    const d=detailOf(summary('card-1','法001','起承转合'));
    Object.assign(d.revision!.payload.method!,{relatedPurposes:['结构检查'],methodKind:'technique',conditionalUses:[{stage:'chapter',condition:'本章承担结构转折',use:'只检查本章的转折作用'}]});
    mocked.fetchCreativeCardDetail.mockResolvedValue(d);
    mocked.saveCreativeCardRevision.mockResolvedValue({} as never);
    render(<CreativeReferenceLibrary />);
    fireEvent.click(await screen.findByText('法001'));
    expect(await screen.findByText('其他阶段：满足条件时才使用')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:/编辑并保存新草稿/}));
    fireEvent.change(screen.getByLabelText('关联用途'),{target:{value:'结构检查，阅读期待'}});
    fireEvent.click(screen.getByRole('button',{name:'保存为新草稿'}));
    await waitFor(()=>expect(mocked.saveCreativeCardRevision).toHaveBeenCalledTimes(1));
    expect(mocked.saveCreativeCardRevision.mock.calls[0]![1].payload.method).toMatchObject({relatedPurposes:['结构检查','阅读期待'],conditionalUses:[{stage:'chapter',condition:'本章承担结构转折',use:'只检查本章的转折作用'}]});
  });

  it('分类无结果可以只清除阶段，保留用途，不显示编号搜索误导', async () => {
    mocked.fetchCreativeCards.mockResolvedValue({items:[],nextCursor:null});
    render(<CreativeReferenceLibrary />);
    fireEvent.change(await screen.findByLabelText('按用途筛选'),{target:{value:'阅读期待'}});
    fireEvent.change(screen.getByLabelText('按适用层级筛选'),{target:{value:'setting'}});
    expect(await screen.findByText(/当前用途、重点阶段与状态组合/)).toBeVisible();
    expect(screen.queryByText(/精确编号无结果/)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'查看此用途的全部阶段'}));
    await waitFor(()=>expect(mocked.fetchCreativeCards.mock.calls.at(-1)![0].usageTree).toBe('阅读期待'));
    expect(mocked.fetchCreativeCards.mock.calls.at(-1)![0].layers).toBeUndefined();
  });

  it('按设计用途、细分用途和阶段组合检索，默认隐藏合并条目', async () => {
    render(<CreativeReferenceLibrary />);
    await screen.findByText('法001');
    expect(mocked.fetchCreativeCards.mock.calls[0]![0].availabilities).toEqual(['draft', 'reviewed', 'published']);
    fireEvent.click(screen.getByRole('button', { name: /设计卖点与体验/ }));
    await waitFor(() => expect(mocked.fetchCreativeCards.mock.calls.at(-1)![0].usageTree).toBe('卖点与阅读体验'));
    fireEvent.click(screen.getByRole('button', { name: '核心吸引力' }));
    fireEvent.change(screen.getByLabelText('按适用层级筛选'), { target: { value: 'opening' } });
    await waitFor(() => expect(mocked.fetchCreativeCards.mock.calls.at(-1)![0]).toMatchObject({usageTree:'核心吸引力',layers:['opening']}));
  });

  it('读取失败显示错误与重试，重试重新请求', async () => {
    mocked.fetchCreativeCards.mockRejectedValueOnce(new Error('暂时连接不上后台'));
    render(<CreativeReferenceLibrary />);
    expect(await screen.findByText('暂时连接不上后台')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => { expect(mocked.fetchCreativeCards).toHaveBeenCalledTimes(2); });
    expect(await screen.findByText('法001')).toBeVisible();
  });

  it('空库显示“尚未录入”，筛选后无结果显示无结果态（服务端筛选参数）', async () => {
    mocked.fetchCreativeCards.mockResolvedValue({ items: [], nextCursor: null });
    render(<CreativeReferenceLibrary />);
    expect(await screen.findByText('尚未录入')).toBeVisible();
    fireEvent.change(screen.getByLabelText('按状态筛选'), { target: { value: 'published' } });
    expect(await screen.findByText('没有符合条件的结果')).toBeVisible();
    const call = mocked.fetchCreativeCards.mock.calls.at(-1)!;
    expect(call[0].availabilities).toEqual(['published']);
  });

  it('进入详情再返回：筛选条件保留且仍按服务端筛选请求', async () => {
    render(<CreativeReferenceLibrary />);
    fireEvent.change(await screen.findByLabelText('按用途筛选'), { target: { value: '故事与因果' } });
    await waitFor(() => { expect(mocked.fetchCreativeCards.mock.calls.at(-1)![0].usageTree).toBe('故事与因果'); });
    fireEvent.click(await screen.findByText('法001'));
    expect(await screen.findByRole('button', { name: /编辑并保存新草稿/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }));
    expect(await screen.findByLabelText('按用途筛选')).toHaveValue('故事与因果');
    await waitFor(() => { expect(mocked.fetchCreativeCards.mock.calls.at(-1)![0].usageTree).toBe('故事与因果'); });
  });

  it('保存草稿失败/冲突：本地输入保留、给出对比提示、不自动重试', async () => {
    render(<CreativeReferenceLibrary />);
    fireEvent.click(await screen.findByText('法001'));
    fireEvent.click(await screen.findByRole('button', { name: /编辑并保存新草稿/ }));
    const nameInput = await screen.findByLabelText('名称');
    fireEvent.change(nameInput, { target: { value: '改后的方法名' } });
    mocked.saveCreativeCardRevision.mockRejectedValueOnce(new Error('状态已被并发修改：请刷新后重试。'));
    fireEvent.click(screen.getByRole('button', { name: '保存为新草稿' }));
    expect(await screen.findByText('状态已被并发修改：请刷新后重试。')).toBeVisible();
    expect(screen.getByLabelText('名称')).toHaveValue('改后的方法名');
    expect(await screen.findByText('与服务器最新内容对比（字段级）')).toBeVisible();
    await waitFor(() => { expect(mocked.saveCreativeCardRevision).toHaveBeenCalledTimes(1); });
  });

  it('脏表单保护：取消/返回先确认一次，确认后才离开；干净表单不确认', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CreativeReferenceLibrary />);
    fireEvent.click(await screen.findByText('法001'));
    fireEvent.click(await screen.findByRole('button', { name: /编辑并保存新草稿/ }));
    const nameInput = await screen.findByLabelText('名称');
    // 脏：取消被确认弹窗拦下
    fireEvent.change(nameInput, { target: { value: '未保存的修改' } });
    await waitFor(() => { expect(screen.getByText(/有未保存修改/)).toBeVisible(); });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '保存为新草稿' })).toBeVisible();
    // 脏：返回列表也被拦下
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '保存为新草稿' })).toBeVisible();
    // 脏：切页导航事件被阻止
    const blocked = !window.dispatchEvent(new Event('wenmi:admin-navigate', { cancelable: true }));
    expect(blocked).toBe(true);
    // 确认放行后离开
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => { expect(screen.queryByRole('button', { name: '保存为新草稿' })).toBeNull(); });
    confirmSpy.mockRestore();
  });

  it('发布：完整清单经冻结分页遍历、关系显式编辑、悬空阻止确认；双击只发一次', async () => {
    mocked.fetchCreativeReleases.mockResolvedValue({ items: [], total: 0, activeReleaseId: 'rel-0', nextOffset: null });
    mocked.fetchCreativeReleaseDetail.mockResolvedValue({
      release: { releaseId: 'rel-0', manifestHash: 'h0', active: true, createdAt: '2026-09-12T00:00:00Z', publishedBy: 'admin', relations: [{ fromId: 'card-1', fromRevision: 1, toId: 'card-3', toRevision: 1, relationType: 'supplement' }] },
      relations: [{ fromId: 'card-1', fromRevision: 1, toId: 'card-3', toRevision: 1, relationType: 'supplement' }]
    });
    // 冻结条目分页：两页遍历（固定rel-0，不读活动指针）
    mocked.fetchCreativeReleaseEntries.mockImplementation(async (_releaseId: string, options: { cursor?: string | null } = {}) => {
      if (options.cursor === undefined || options.cursor === null) {
        return { items: [{ internalId: 'card-1', revision: 1 }], nextCursor: 'page-2' };
      }
      return { items: [{ internalId: 'card-3', revision: 1 }], nextCursor: null };
    });
    const cardA = summary('card-1', '法001', '起承转合', { currentRevision: 1, revisionStatus: 'published', availability: 'published' });
    const cardB = summary('card-2', '法002', '三幕式', { currentRevision: 2, revisionStatus: 'reviewed' });
    const cardC = summary('card-3', '法003', '悬念前置', { currentRevision: 1, revisionStatus: 'published', availability: 'published' });
    mocked.fetchCreativeCards.mockResolvedValue({ items: [cardA, cardB, cardC], nextCursor: null });
    let resolvePublish: ((value: { release: api.CreativeReleaseDetail['release']; replayed: boolean }) => void) | undefined;
    mocked.publishCreativeRelease.mockImplementation(() => new Promise<{ release: api.CreativeReleaseDetail['release']; replayed: boolean }>((resolve) => { resolvePublish = resolve; }));

    render(<CreativeReferenceLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: '发布版本' }));
    expect(await screen.findByText(/基于打开时的完整清单（2 条、1 关系）/)).toBeVisible();
    await waitFor(() => { expect(mocked.fetchCreativeReleaseEntries).toHaveBeenCalledTimes(2); });

    // 新增card-2第2版，并显式添加关系 card-2@2→card-1@1
    fireEvent.click(screen.getByRole('button', { name: '加入第2版' }));
    fireEvent.change(await screen.findByLabelText('新关系起点'), { target: { value: 'card-2' } });
    fireEvent.change(screen.getByLabelText('新关系终点'), { target: { value: 'card-1' } });
    fireEvent.click(screen.getByRole('button', { name: '添加关联' }));
    expect(await screen.findByText(/新增关系：法002@2→法001@1（补充）/)).toBeVisible();

    // 移除card-3：其残留边悬空，确认按钮禁用，必须显式处理关系
    const removeC = screen.getAllByRole('button', { name: '移除' }).find((button) => button.closest('li')?.textContent?.includes('法003'))!;
    fireEvent.click(removeC);
    expect(await screen.findByText(/有1条关系端点不在本次清单内/)).toBeVisible();
    expect(screen.getByRole('button', { name: /确认发布/ })).toBeDisabled();
    const removeDangling = screen.getAllByRole('button', { name: '移除该关系' }).find((button) => button.closest('li')?.textContent?.includes('法003'))!;
    fireEvent.click(removeDangling);
    await waitFor(() => { expect(screen.getByRole('button', { name: /确认发布/ })).toBeEnabled(); });

    const confirm = screen.getByRole('button', { name: '确认发布（2 条 · 1 关系）' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => { expect(mocked.publishCreativeRelease).toHaveBeenCalledTimes(1); });
    const input = mocked.publishCreativeRelease.mock.calls[0]![0];
    expect(input.expectedActiveReleaseId).toBe('rel-0');
    expect(input.entries).toEqual([{ internalId: 'card-1', revision: 1 }, { internalId: 'card-2', revision: 2 }]);
    expect(input.relations).toEqual([{ fromId: 'card-2', fromRevision: 2, toId: 'card-1', toRevision: 1, relationType: 'supplement' }]);
    resolvePublish?.({ release: { releaseId: 'rel-9', manifestHash: 'h9', active: true, createdAt: '2026-09-13T00:00:00Z', publishedBy: 'admin', relations: [] }, replayed: false });
    expect(await screen.findByText('发布成功')).toBeVisible();
  });
});
