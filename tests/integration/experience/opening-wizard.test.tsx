// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createBook: vi.fn(),
  fetchOpeningTaxonomy: vi.fn(),
  fetchOpeningDraft: vi.fn(),
  saveOpeningDraftToServer: vi.fn(),
  clearOpeningDraftOnServer: vi.fn()
}));
vi.mock('../../../apps/web/src/lib/api/client', () => api);

import { CompleteCreateBookDialog } from '../../../apps/web/src/features/onboarding/CompleteCreateBookDialog';
import { openingDraftStorageKey } from '../../../apps/web/src/features/onboarding/opening-draft-store';

const draftKey = openingDraftStorageKey('');

const taxonomy = {
  version: 'test-opening-v1', sourceLabel: '本地测试', sourceUrl: 'https://example.test/',
  updatedAt: '2026-08-08', notice: '测试目录',
  categories: [{ key: 'female-suspense', name: '悬疑恋爱', channel: 'female' as const, description: '秘密与关系共同推进', recommendedMainTags: ['悬疑', '成长'], tagPackKeys: ['common'] }],
  mainTags: ['悬疑', '成长', '群像'], auxiliaryTags: ['现代言情'], storyTraits: [], styleTones: ['爽', '虐'],
  personalityOptions: ['冷静', '敏锐'],
  boundaryGroups: [{ name: '结构与结局', description: '作者明确底线', options: ['不写悲剧结局'] }],
  subjects: [{ name: '现代言情', packKeys: ['common'] }],
  tagGroups: [
    { key: 'common', name: '通用', description: '通用标签', packKeys: ['common'], mainTags: ['悬疑', '成长', '群像'], auxiliaryTags: ['现代言情'], storyTraits: [] },
    { key: 'suspense', name: '悬疑', description: '悬疑标签', packKeys: ['suspense'], mainTags: ['刑侦'], auxiliaryTags: ['不在场证明'], storyTraits: ['叙诡'] }
  ]
};

beforeEach(() => {
  localStorage.clear();
  api.fetchOpeningTaxonomy.mockResolvedValue(taxonomy);
  api.createBook.mockResolvedValue({ bookId: 'unused' });
  api.fetchOpeningDraft.mockResolvedValue({ draft: null });
  api.saveOpeningDraftToServer.mockResolvedValue({ saved: true });
  api.clearOpeningDraftOnServer.mockResolvedValue({ cleared: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('四步开书', () => {
  it('旧书修改沿用四步表单，保留高级资料并只保存一个不可变新版本', async () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    const openingBlueprint = {
      creationMode: 'new' as const,
      taxonomyVersion: taxonomy.version,
      channel: 'female' as const,
      categoryKey: 'female-suspense',
      targetAudience: '喜欢城市悬疑的读者',
      protagonists: [{ role: 'female_lead' as const, name: '林舟', age: '十八岁', background: '旧城档案员', personalities: ['冷静'] }],
      storyDirection: '林舟从一封旧信追查被改写的城市记忆，并试图阻止下一次大规模改写。',
      worldBackground: '旧城的地图会随居民记忆改变。',
      openingBackground: '林舟收到姐姐寄出的迟到十年的信。',
      stageOne: { start: '收到信', development: '追查旧档案', end: '发现地图异变' },
      fullBookOutline: '林舟逐步找回城市真实历史。',
      mainTags: ['悬疑', '成长'], auxiliaryTags: ['现代言情'], storyTraits: [],
      styleIntent: { languageTones: ['克制'], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] },
      customTags: ['城市记忆'], initialMap: '档案馆与旧城', mustFollow: ['不写悲剧结局']
    };
    render(<CompleteCreateBookDialog
      busy={false}
      onCancel={() => undefined}
      initialProfile={{
        title: '旧城来信', channel: '女频', category: '悬疑恋爱', subjects: ['现代言情'],
        mainTags: ['悬疑', '成长'], customTags: ['城市记忆'], protagonists: openingBlueprint.protagonists,
        synopsis: openingBlueprint.fullBookOutline,
        storyDirection: openingBlueprint.storyDirection, mustFollow: openingBlueprint.mustFollow,
        openingStart: '', storyEnding: '', stylePrimary: '', styleSecondary: '',
        style: openingBlueprint.styleIntent, source: '老板确认的开书资料', version: 3, openingBlueprint
      }}
      onUpdate={onUpdate}
    />);

    const dialog = screen.getByRole('dialog', { name: '修改开书资料' });
    expect(within(dialog).getByLabelText('书名')).toHaveValue('旧城来信');
    fireEvent.click(within(dialog).getByRole('button', { name: '第1步：创作方式' }));
    expect(within(dialog).getByRole('button', { name: /^从零创作/u })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '第2步：写什么题材' }));
    await within(dialog).findByRole('button', { name: '当前作品分类：悬疑恋爱' });
    fireEvent.click(within(dialog).getByRole('button', { name: '第3步：边界与角色' }));
    const save = within(dialog).getByRole('button', { name: '保存修改' });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 3,
      title: '旧城来信',
      openingBlueprint: expect.objectContaining({
        worldBackground: openingBlueprint.worldBackground,
        openingBackground: openingBlueprint.openingBackground,
        stageOne: openingBlueprint.stageOne,
        fullBookOutline: openingBlueprint.fullBookOutline,
        initialMap: openingBlueprint.initialMap,
        styleIntent: openingBlueprint.styleIntent
      })
    }));
    expect(localStorage.getItem(draftKey)).toBeNull();
  });
  it('从创作方式逐步填写方向、多个主角和边界，只提交一次完整资料', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={onCreate} />);

    expect(screen.getByRole('navigation', { name: '开书步骤' })).toBeInTheDocument();
    expect(screen.getByText('从零创作')).toBeInTheDocument();
    expect(screen.queryByLabelText('书名')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    fireEvent.change(await screen.findByLabelText('书名'), { target: { value: '旧城来信' } });
    fireEvent.click(screen.getByRole('radio', { name: '女频' }));
    expect(document.querySelectorAll('.channel-option input')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: '选择作品分类：悬疑恋爱' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    fireEvent.click(screen.getByRole('button', { name: '选择必须遵守：无额外限制' }));

    const first = screen.getByRole('article');
    fireEvent.change(within(first).getByLabelText('姓名'), { target: { value: '林舟' } });
    fireEvent.change(within(first).getByLabelText('年龄'), { target: { value: '18' } });
    fireEvent.change(within(first).getByLabelText('家庭背景'), { target: { value: '旧城档案员家庭' } });
    fireEvent.click(within(first).getByRole('button', { name: '选择角色性格：冷静' }));
    fireEvent.click(screen.getByRole('button', { name: /增加角色/u }));
    const second = screen.getAllByRole('article')[1]!;
    fireEvent.change(within(second).getByLabelText('姓名'), { target: { value: '周野' } });
    fireEvent.change(within(second).getByLabelText('年龄'), { target: { value: '24' } });
    fireEvent.change(within(second).getByLabelText('家庭背景'), { target: { value: '失踪调查员家庭' } });
    fireEvent.click(within(second).getByRole('button', { name: '选择角色性格：敏锐' }));
    const create = screen.getByRole('button', { name: '创建书籍' });
    fireEvent.click(create);
    fireEvent.click(create);

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: '旧城来信',
      openingBlueprint: expect.objectContaining({
        creationMode: 'new', storyDirection: '',
        worldBackground: '',
        initialMap: '',
        protagonists: [expect.objectContaining({ name: '林舟' }), expect.objectContaining({ name: '周野' })],
        mustFollow: ['无额外限制']
      })
    }));
  });

  it('第2步标签库展示全部泳道词条，已选标签带出同组搭配推荐', async () => {
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={vi.fn().mockResolvedValue(true)} />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('书名'), { target: { value: '旧城来信' } });
    fireEvent.click(screen.getByRole('radio', { name: '女频' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择作品分类：悬疑恋爱' }));

    // 悬疑分组未被当前题材命中，其主标签不进推荐区
    expect(screen.queryByRole('button', { name: '加入标签：刑侦' })).not.toBeInTheDocument();
    // 标签库无需搜索即可看到主标签、辅助标签、故事特质三条泳道的词条
    fireEvent.click(screen.getByRole('button', { name: '从标签库添加' }));
    expect(screen.getAllByRole('button', { name: '加入标签：现代言情' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '加入标签：不在场证明' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入标签：叙诡' })).toBeInTheDocument();
    // 手动加入“刑侦”后，同组搭配（不在场证明、叙诡）进入推荐区（推荐区与标签库各出现一次）
    fireEvent.click(screen.getByRole('button', { name: '加入标签：刑侦' }));
    expect(screen.getAllByRole('button', { name: '加入标签：不在场证明' }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole('button', { name: '加入标签：叙诡' }).length).toBeGreaterThan(1);
  });

  it('第2步按题材推荐本书标签：可加入、删除、不再推荐，也能从标签库搜索添加', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('书名'), { target: { value: '旧城来信' } });
    fireEvent.click(screen.getByRole('radio', { name: '女频' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择作品分类：悬疑恋爱' }));

    // 推荐区按分类+通用组给出标签；点一下加入，已加入的不再出现在推荐里
    fireEvent.click(await screen.findByRole('button', { name: '加入标签：悬疑' }));
    expect(screen.getByRole('button', { name: '删除标签：悬疑' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加入标签：悬疑' })).not.toBeInTheDocument();
    // 点 × 不再推荐，推荐区立刻消失
    fireEvent.click(screen.getByRole('button', { name: '不再推荐标签：群像' }));
    expect(screen.queryByRole('button', { name: '加入标签：群像' })).not.toBeInTheDocument();
    // 从标签库搜索添加被跳过的标签
    fireEvent.click(screen.getByRole('button', { name: '从标签库添加' }));
    fireEvent.change(screen.getByLabelText('搜索标签'), { target: { value: '群像' } });
    fireEvent.click(screen.getByRole('button', { name: '加入标签：群像' }));
    expect(screen.getAllByRole('button', { name: '删除标签：群像' }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '选择必须遵守：无额外限制' }));
    const first = screen.getByRole('article');
    fireEvent.change(within(first).getByLabelText('姓名'), { target: { value: '林舟' } });
    fireEvent.change(within(first).getByLabelText('年龄'), { target: { value: '18' } });
    fireEvent.change(within(first).getByLabelText('家庭背景'), { target: { value: '旧城档案员家庭' } });
    fireEvent.click(within(first).getByRole('button', { name: '选择角色性格：冷静' }));
    fireEvent.click(screen.getByRole('button', { name: '创建书籍' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      openingBlueprint: expect.objectContaining({ mainTags: ['悬疑', '群像'] })
    }));
  });

  it('第3步可填开局、结局和自定义补充，随完整资料一起提交', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('书名'), { target: { value: '旧城来信' } });
    fireEvent.click(screen.getByRole('radio', { name: '女频' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择作品分类：悬疑恋爱' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '选择必须遵守：无额外限制' }));
    const first = screen.getByRole('article');
    fireEvent.change(within(first).getByLabelText('姓名'), { target: { value: '林舟' } });
    fireEvent.change(within(first).getByLabelText('年龄'), { target: { value: '18' } });
    fireEvent.change(within(first).getByLabelText('家庭背景'), { target: { value: '旧城档案员家庭' } });
    fireEvent.click(within(first).getByRole('button', { name: '选择角色性格：冷静' }));
    fireEvent.change(screen.getByLabelText('开局'), { target: { value: '档案员收到一封迟到十年的信' } });
    fireEvent.click(screen.getByRole('button', { name: '创建书籍' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('开局和结局需要一起填写');
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('结局'), { target: { value: '找回城市真正的历史' } });
    fireEvent.change(screen.getByLabelText('自定义补充'), { target: { value: '想看重逢与和解的桥段' } });
    fireEvent.click(screen.getByRole('button', { name: '创建书籍' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      openingBlueprint: expect.objectContaining({
        openingStart: '档案员收到一封迟到十年的信',
        storyEnding: '找回城市真正的历史',
        storyDirection: '想看重逢与和解的桥段'
      })
    }));
  });

  it('关闭前自动保存，重新打开后从原步骤恢复；清空操作可重新开始', async () => {
    const firstRender = render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('书名'), { target: { value: '未完成的新书' } });
    await waitFor(() => expect(localStorage.getItem(draftKey)).toContain('未完成的新书'));
    firstRender.unmount();

    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={vi.fn()} />);
    expect(await screen.findByText('已恢复上次没填完的资料')).toBeInTheDocument();
    expect(screen.getByLabelText('书名')).toHaveValue('未完成的新书');
    fireEvent.click(screen.getByRole('button', { name: '清空重填' }));
    expect(screen.getByText('从零创作')).toBeInTheDocument();
    expect(localStorage.getItem(draftKey)).toBeNull();
  });

  it('续写路线保持独立，失败后不清除草稿并允许重试', async () => {
    const onCreate = vi.fn().mockResolvedValue(false);
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /^已有正文续写/u }));
    fireEvent.click(screen.getByRole('button', { name: '第3步：边界与角色' }));
    expect(screen.getByRole('button', { name: '创建书籍' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建书籍' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('书名');
    await waitFor(() => expect(localStorage.getItem(draftKey)).toContain('continuation'));
  });
  it('书名输入固定为15字并实时显示字数', async () => {
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const input = await screen.findByLabelText('书名');
    fireEvent.change(input, { target: { value: '一二三四五六七八九十一二三四五六' } });
    expect(input).toHaveValue('一二三四五六七八九十一二三四五');
    expect(screen.getByText('最多15字 · 15/15')).toBeInTheDocument();
  });

  it('服务器草稿比本地新鲜时从服务器恢复', async () => {
    const serverDraft = {
      schemaVersion: 3, step: 2, creationMode: 'new',
      title: '服务器存的书', channel: 'female', categoryKey: 'female-suspense',
      mainTags: ['悬疑'], auxiliaryTags: [], storyTraits: [],
      protagonists: [{ role: 'female_lead', name: '林舟', age: '成年', background: '档案员', personalities: ['冷静'] }],
      storyDirection: '', targetAudience: '', worldBackground: '', openingBackground: '',
      stageOne: { start: '', development: '', end: '' }, fullBookOutline: '', initialMap: '',
      customTags: [], selectedMustFollow: [], mustFollowText: '',
      allSubjectsOpen: false, activeTagGroupKey: 'recommended',
      updatedAt: '2099-01-01T00:00:00.000Z'
    };
    api.fetchOpeningDraft.mockResolvedValue({ draft: serverDraft, updatedAt: serverDraft.updatedAt });
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={vi.fn()} />);
    expect(await screen.findByText('已恢复上次没填完的资料')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('书名')).toHaveValue('服务器存的书'));
    expect(localStorage.getItem(draftKey)).toContain('服务器存的书');
  });

  it('本地草稿比服务器新鲜时保留本地内容', async () => {
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('书名'), { target: { value: '本地新书' } });
    await waitFor(() => expect(localStorage.getItem(draftKey)).toContain('本地新书'));
    cleanup();

    api.fetchOpeningDraft.mockResolvedValue({
      draft: { schemaVersion: 2, step: 2, creationMode: 'new', title: '服务器旧书', updatedAt: '2000-01-01T00:00:00.000Z' },
      updatedAt: '2000-01-01T00:00:00.000Z'
    });
    render(<CompleteCreateBookDialog busy={false} onCancel={() => undefined} onCreate={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('书名')).toHaveValue('本地新书'));
    expect(screen.queryByDisplayValue('服务器旧书')).not.toBeInTheDocument();
  });
});
