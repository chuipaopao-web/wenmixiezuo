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
    expect(await screen.findByText('法001 起承转合短语')).toBeVisible();
    expect(screen.getByText('起承转合')).toBeVisible();
    expect(screen.getByText(/法002 三幕式短语（已退役）/)).toBeVisible();
    expect(screen.getAllByText(/已退役/).length).toBeGreaterThanOrEqual(1);
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

  it('读取失败显示错误与重试，重试重新请求', async () => {
    mocked.fetchCreativeCards.mockRejectedValueOnce(new Error('暂时连接不上后台'));
    render(<CreativeReferenceLibrary />);
    expect(await screen.findByText('暂时连接不上后台')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => { expect(mocked.fetchCreativeCards).toHaveBeenCalledTimes(2); });
    expect(await screen.findByText('法001 起承转合短语')).toBeVisible();
  });

  it('空库显示“尚未录入”，筛选后无结果显示无结果态', async () => {
    mocked.fetchCreativeCards.mockResolvedValue({ items: [], nextCursor: null });
    render(<CreativeReferenceLibrary />);
    expect(await screen.findByText('尚未录入')).toBeVisible();
    mocked.fetchCreativeCards.mockResolvedValue({ items: [], nextCursor: null });
    fireEvent.change(screen.getByLabelText('按状态筛选'), { target: { value: 'published' } });
    expect(await screen.findByText('没有符合条件的结果')).toBeVisible();
    const call = mocked.fetchCreativeCards.mock.calls.at(-1)!;
    expect(call[0].availabilities).toEqual(['published']);
  });

  it('进入详情再返回：筛选条件保留且仍按服务端筛选请求', async () => {
    render(<CreativeReferenceLibrary />);
    fireEvent.change(await screen.findByLabelText('按用途筛选'), { target: { value: '故事与因果' } });
    await waitFor(() => { expect(mocked.fetchCreativeCards.mock.calls.at(-1)![0].usageTree).toBe('故事与因果'); });
    fireEvent.click(await screen.findByText('法001 起承转合短语'));
    expect(await screen.findByRole('button', { name: /编辑并保存新草稿/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }));
    expect(await screen.findByLabelText('按用途筛选')).toHaveValue('故事与因果');
    await waitFor(() => { expect(mocked.fetchCreativeCards.mock.calls.at(-1)![0].usageTree).toBe('故事与因果'); });
  });

  it('保存草稿失败/冲突：本地输入保留、给出对比提示、不自动重试', async () => {
    render(<CreativeReferenceLibrary />);
    fireEvent.click(await screen.findByText('法001 起承转合短语'));
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

  it('发布：预览基于完整清单计数，确认发送完整manifest且双击只发一次', async () => {
    mocked.fetchCreativeReleases.mockResolvedValue({ items: [], total: 0, activeReleaseId: 'rel-0', nextOffset: null });
    mocked.fetchCreativeReleaseDetail.mockResolvedValue({
      release: { releaseId: 'rel-0', manifestHash: 'h', active: true, createdAt: '2026-09-12T00:00:00Z', publishedBy: 'admin', entries: [{ internalId: 'card-1', revision: 1 }], relations: [] },
      relations: []
    });
    const cardA = summary('card-1', '法001', '起承转合', { currentRevision: 1, revisionStatus: 'published' });
    const cardB = summary('card-2', '法002', '三幕式', { currentRevision: 2, revisionStatus: 'reviewed' });
    mocked.fetchCreativeCards.mockResolvedValue({ items: [cardA, cardB], nextCursor: null });
    let resolvePublish: ((value: { release: api.CreativeReleaseDetail['release']; replayed: boolean }) => void) | undefined;
    mocked.publishCreativeRelease.mockImplementation(() => new Promise<{ release: api.CreativeReleaseDetail['release']; replayed: boolean }>((resolve) => { resolvePublish = resolve; }));

    render(<CreativeReferenceLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: '发布版本' }));
    expect(await screen.findByText(/当前基准：rel-0/)).toBeVisible();
    expect(await screen.findByText(/基于打开时的完整清单（1 条）/)).toBeVisible();
    expect(screen.getByText('总条目')).toBeVisible();

    // 新增card-2第2版 → 预览总数2、新增1
    fireEvent.click(screen.getByRole('button', { name: '加入第2版' }));
    expect(await screen.findByText('新增')).toBeVisible();
    const confirm = screen.getByRole('button', { name: '确认发布（2 条）' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => { expect(mocked.publishCreativeRelease).toHaveBeenCalledTimes(1); });
    const input = mocked.publishCreativeRelease.mock.calls[0]![0];
    expect(input.expectedActiveReleaseId).toBe('rel-0');
    expect(input.entries).toEqual([{ internalId: 'card-1', revision: 1 }, { internalId: 'card-2', revision: 2 }]);
    resolvePublish?.({ release: { releaseId: 'rel-9', manifestHash: 'h9', active: true, createdAt: '2026-09-13T00:00:00Z', publishedBy: 'admin', entries: [], relations: [] }, replayed: false });
    expect(await screen.findByText('发布成功')).toBeVisible();});
});
