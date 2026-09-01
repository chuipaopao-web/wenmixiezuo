import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingPage } from './SettingPage';

const members = [
  ['chief-deepseek-v4-pro', '貂蝉', 'chief_editor'],
  ['chief-glm-5-3', '顾承砚', 'chief_editor'],
  ['chief-kimi-k3', '沈知微', 'chief_editor'],
  ['deputy-glm-5-3', '西施', 'deputy_editor'],
  ['deputy-deepseek-v4-pro', '妙玉', 'deputy_editor'],
  ['deputy-kimi-k3', '谢临川', 'deputy_editor'],
  ['planner-deepseek-v4-pro', '红玉', 'planning_writer'],
  ['planner-glm-5-3', '幼薇', 'planning_writer'],
  ['planner-kimi-k3', '苏映棠', 'planning_writer']
].map(([memberKey, displayName, role]) => ({ memberKey, displayName, role, presence: 'ready', statusText: '待命', currentItem: null, handoffTo: null, completedCount: 0 }));
const resultItem = { itemKey: 'world-stage', label: '世界舞台', groupTitle: '核心设定', state: 'needs_author', stateText: '等待作者确认', assignedMemberKey: 'planner-deepseek-v4-pro', content: '东汉末年秩序松动，交通和粮食条件限制主角行动。', designRationale: '保持历史代入感并给架空留出空间。', storyConsequences: ['分卷必须考虑粮道'], issues: [{ problem: '民间组织名称可能与开局年代错位', impact: '会降低历史可信度', suggestion: '改成更通用的民间互助组织' }], suggestions: [], revision: 1 };
const finalReview = {
  taskId: 'final-review-1', status: 'ready', statusText: '貂蝉已经统一核对完成，可以保存。', progress: 100,
  member: { memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' },
  result: { verdict: 'pass', summary: '人物、年代、组织称呼和世界规则已经统一。', unifiedDecisions: [], conflicts: [], patchedItemKeys: [] },
  retryable: false, restartable: false, restartNeedsConfirmation: false, createdAt: '', updatedAt: ''
};
describe('V7设定页面', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let currentRedesignResponse: unknown | null;
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentRedesignResponse = null;
    let department: Record<string, unknown> = {
      catalog: [
        { key: 'world-stage', label: '世界舞台', prompt: '故事发生在哪里？', source: '通用', groupKey: 'core', groupTitle: '核心设定', required: true, deputyPolicy: 'never' },
        { key: 'history-baseline', label: '历史基线', prompt: '哪些史实必须遵守？', source: '历史扩展', groupKey: 'history', groupTitle: '历史与架空', required: true, deputyPolicy: 'conditional' }
      ],
      recommendedKeys: ['world-stage', 'history-baseline'],
      recommendation: {
        taskId: 'recommendation-1', status: 'ready', statusText: '貂蝉已经整理好本书真正需要的设定清单。', phase: 'ready', phaseText: '设定清单已完成', progress: 100,
        member: { memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }, attemptedMembers: [{ memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }],
        result: { requiredKeys: ['world-stage', 'history-baseline'], suggestedKeys: [], excludedKeys: [], summary: '先把历史背景和世界规则准备好。' }, retryable: false, restartable: false, restartNeedsConfirmation: false, createdAt: '', updatedAt: ''
      },
      confirmedItems: [resultItem], members, activeBatch: null, finalReview: null
    };
    const workingMembers = members.map((member, index) => index === 6 ? { ...member, presence: 'working' as const, statusText: '亲爱的，我正在加急设计另一个条目' } : member);
    const working = { batchId: 'batch-1', status: 'working', statusText: '亲爱的，编辑部正在加急设计中', progress: { completed: 0, total: 2, percent: 0 }, members: [...workingMembers, { ...workingMembers[6]!, memberKey: 'setting-writer-1', role: 'screenwriter', statusText: '重复的旧工位快照' }], items: [{ ...resultItem, state: 'working', stateText: '老板稍等，我正在检查世界舞台' }], retryable: false, restartable: false, restartNeedsConfirmation: false, createdAt: '', updatedAt: '' };
    const reviewTask = { ...working, batchId: 'review-batch-1', progress: { completed: 0, total: 1, percent: 0 }, items: [{ ...resultItem, state: 'working', stateText: '老板稍等，我正在检查世界舞台' }] };
    const fusedItem = { ...resultItem, content: '融合后的世界舞台方案。', revision: 2 };
    const fusionWorking = { ...working, batchId: 'fusion-batch-1', progress: { completed: 0, total: 1, percent: 0 }, items: [{ ...resultItem, state: 'working', content: null }] };
    const fusionReady = { ...fusionWorking, status: 'awaiting_author', statusText: '融合方案已经完成，等待作者确认。', progress: { completed: 1, total: 1, percent: 100 }, items: [fusedItem] };
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/setting-department')) return json(department);
      if (url.endsWith('/setting-batches') && init?.method === 'POST') return json(working);
      if (url.includes('/setting-batches/batch-1')) return json(working);
      if (url.endsWith('/setting-items/world-stage/confirm')) return json({ ...resultItem, state: 'confirmed', stateText: '已确认', revision: 2 });
      if (url.endsWith('/setting-items/world-stage/review-tasks')) return json(reviewTask);
      if (url.endsWith('/setting-items/world-stage/redesigns/current') && currentRedesignResponse !== null) return json(currentRedesignResponse);
      if (url.endsWith('/setting-items/world-stage/redesigns')) return json({ taskId: 'redesign-1', status: 'working', statusText: '三位编剧正在分别设计。', candidates: [], failedMemberKeys: [] });
      if (url.endsWith('/setting-items/world-stage/redesigns/redesign-1')) return json({ taskId: 'redesign-1', status: 'ready', statusText: '方案已经完成。', candidates: [1, 2, 3].map((index) => ({ outputId: `output-${index}`, memberKey: ['planner-deepseek-v4-pro', 'planner-glm-5-3', 'planner-kimi-k3'][index - 1], proposal: { content: `第${index}份世界舞台方案，强调历史边界与主角行动空间。`, designRationale: `第${index}份设计理由。`, storyConsequences: [], dependencies: [], risks: [] } })), failedMemberKeys: [] });
      if (url.endsWith('/setting-items/world-stage/fusions')) return json(fusionWorking);
      if (url.endsWith('/setting-batches/fusion-batch-1')) {
        department = { ...department, confirmedItems: [fusedItem], activeBatch: fusionReady };
        return json(fusionReady);
      }
      if (url.endsWith('/setting-items/world-stage/revisions')) return json(reviewTask);
      if (url.endsWith('/setting-final-reviews') && init?.method === 'POST') return json(finalReview);
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('只展示本轮真实参与成员，并把同一成员的旧工位快照合并为一张卡', async () => {
    render(<SettingPage bookId="book-1" />);
    expect(await screen.findByText('主编先挑出本书真正需要的设定，您也可以随时补充。')).toBeInTheDocument();
    expect(screen.queryByText('完整设定库')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开完整设定库' }));
    expect(screen.getByText('完整设定库')).toBeInTheDocument();
    expect(screen.getAllByText('世界舞台').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('设定结果')).toBeInTheDocument();
    expect(screen.queryByText(/model|provider|凭据/iu)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /设计新增1项/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/setting-batches'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText(/貂蝉 · 主编/)).toBeInTheDocument();
    expect(screen.getByText('亲爱的，编辑部正在加急设计中')).toBeInTheDocument();
    expect(screen.getByText('本轮 0/2')).toBeInTheDocument();
    expect(screen.getByText('全书 0/2')).toBeInTheDocument();
    expect(document.querySelector('.agent-avatar')).toHaveStyle({ backgroundPosition: '0% 0%' });
    fireEvent.click(screen.getByRole('button', { name: '查看参与成员' }));
    expect(screen.queryByText('西施')).not.toBeInTheDocument();
    expect(screen.getByText('老板稍等，我正在检查世界舞台')).toBeInTheDocument();
    expect(screen.getAllByText('亲爱的，我正在加急设计另一个条目').length).toBeGreaterThanOrEqual(1);
    const roster = document.querySelector('.editorial-roster');
    expect(roster).not.toBeNull();
    expect(roster!.querySelectorAll('article')).toHaveLength(2);
    expect(within(roster as HTMLElement).getAllByText('红玉')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/chief_editor|planning_writer|screenwriter/u);
    fireEvent.click(screen.getByRole('button', { name: '收起成员' }));
    expect(screen.queryByText('西施')).not.toBeInTheDocument();
    expect(screen.getByText(/貂蝉 · 主编/)).toBeInTheDocument();
  });

  it('只有作者明确点击才创建一次主编清单任务，并显示可恢复进度', async () => {
    const recommendation = {
      taskId: 'recommendation-working', status: 'working', statusText: '貂蝉正在理解人物、时代和故事方向，请主人耐心等一下。',
      phase: 'understanding', phaseText: '正在理解作品', progress: 28,
      member: { memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }, attemptedMembers: [{ memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }],
      result: null, retryable: false, restartable: false, restartNeedsConfirmation: false, createdAt: '', updatedAt: ''
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/setting-department')) return json({
        catalog: [{ key: 'world-stage', label: '世界舞台', prompt: '故事发生在哪里？', source: '通用', groupKey: 'core', groupTitle: '核心设定', required: true, deputyPolicy: 'never' }],
        recommendedKeys: [], recommendation: null, confirmedItems: [], members, activeBatch: null
      });
      if (url.endsWith('/setting-recommendations') && init?.method === 'POST') return json(recommendation);
      if (url.endsWith('/setting-recommendations/recommendation-working')) return json(recommendation);
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    render(<SettingPage bookId="book-1" />);
    expect(await screen.findByRole('button', { name: '请主编整理设定清单' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/setting-recommendations'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '请主编整理设定清单' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/setting-recommendations'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText((_content, element) => element?.textContent === '当前工位：正在理解作品')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '整理进度28%' })).toBeInTheDocument();
  });

  it('旧设定清单合同失效后保留说明，并允许作者按最新要求重新整理', async () => {
    const staleRecommendation = {
      taskId: 'recommendation-stale', status: 'failed', statusText: '当前清单使用的是旧整理要求，请按最新要求重新整理。',
      phase: 'failed', phaseText: '当前清单已过期', progress: 100,
      member: { memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }, attemptedMembers: [{ memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }],
      result: null, retryable: false, restartable: true, restartNeedsConfirmation: false, createdAt: '', updatedAt: ''
    };
    const working = { ...staleRecommendation, taskId: 'recommendation-new', status: 'working', statusText: '貂蝉正在按最新要求精简清单。', phase: 'organizing', phaseText: '正在整理轻重', progress: 74 };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/setting-department')) return json({
        catalog: [{ key: 'world-stage', label: '世界舞台', prompt: '故事发生在哪里？', source: '通用', groupKey: 'core', groupTitle: '核心设定', required: true, deputyPolicy: 'never' }],
        recommendedKeys: [], recommendation: staleRecommendation, confirmedItems: [], members, activeBatch: null, finalReview: null
      });
      if (url.endsWith('/setting-recommendations') && init?.method === 'POST') return json(working);
      if (url.endsWith('/setting-recommendations/current')) return json(working);
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    render(<SettingPage bookId="book-1" />);
    const action = await screen.findByRole('button', { name: '按最新要求重新整理' });
    fireEvent.click(action);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/setting-recommendations'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('貂蝉正在按最新要求精简清单。')).toBeInTheDocument();
  });

  it('设定清单结果未知时只刷新核对，不创建第二项任务', async () => {
    const unknownRecommendation = {
      taskId: 'recommendation-unknown', status: 'failed', statusText: '对不起，这次整理结果暂时无法确认。',
      phase: 'failed', phaseText: '结果待核对', progress: 100,
      member: { memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }, attemptedMembers: [{ memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }],
      result: null, retryable: false, restartable: false, restartNeedsConfirmation: false, createdAt: '', updatedAt: ''
    };
    let currentReads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/setting-department')) return json({
        catalog: [], recommendedKeys: [], recommendation: unknownRecommendation, confirmedItems: [], members, activeBatch: null, finalReview: null
      });
      if (url.endsWith('/setting-recommendations/current') && init?.method === undefined) {
        currentReads += 1;
        return json(unknownRecommendation);
      }
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    render(<SettingPage bookId="book-1" />);

    const refresh = await screen.findByRole('button', { name: '刷新核对结果' });
    expect(screen.queryByRole('button', { name: '按最新要求重新整理' })).not.toBeInTheDocument();
    fireEvent.click(refresh);
    await waitFor(() => expect(currentReads).toBe(1));
    expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input).endsWith('/setting-recommendations') && init?.method === 'POST'
    ))).toBe(false);
  });

  it('统一整理结果未知时先展示失败信息，只刷新核对当前任务', async () => {
    const unknownFinalReview = {
      taskId: 'final-review-unknown', status: 'failed', statusText: '对不起，这次统一整理结果暂时无法确认。', progress: 100,
      member: { memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' }, result: null,
      retryable: false, restartable: false, restartNeedsConfirmation: false, createdAt: '', updatedAt: ''
    };
    let currentReads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/setting-department')) return json({
        catalog: [], recommendedKeys: [], recommendation: null, confirmedItems: [resultItem], members, activeBatch: null, finalReview: unknownFinalReview
      });
      if (url.endsWith('/setting-final-reviews/current') && init?.method === undefined) {
        currentReads += 1;
        return json(unknownFinalReview);
      }
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    render(<SettingPage bookId="book-1" />);

    expect(await screen.findAllByText('对不起，这次统一整理结果暂时无法确认。')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '查看统一整理状态' })).not.toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: '刷新核对结果' });
    expect(screen.queryByRole('button', { name: '重新发起统一整理' })).not.toBeInTheDocument();
    fireEvent.click(refresh);
    await waitFor(() => expect(currentReads).toBe(1));
    expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input).endsWith('/setting-final-reviews') && init?.method === 'POST'
    ))).toBe(false);
  });

  it('补充设计时已有结果不可重复勾选，请求只提交新增条目', async () => {
    render(<SettingPage bookId="book-1" />);
    await screen.findByText('设定结果');
    expect(document.querySelectorAll('.workflow-action-dock-primary > .primary-action')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '打开完整设定库' }));
    expect(document.querySelectorAll('.workflow-action-dock-primary > .primary-action')).toHaveLength(1);
    const designedLabel = screen.getAllByText('世界舞台').find((node) => node.closest('label'))?.closest('label');
    expect(designedLabel).toHaveClass('designed');
    expect(designedLabel?.querySelector('input')).toBeDisabled();
    expect(screen.getByRole('button', { name: /设计新增1项/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /设计新增1项/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/setting-batches') && init?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ selectedItemKeys: ['history-baseline'] });
    });
  });

  it('会员算力不足时展示安全的真实原因，不再伪装成通用失败', async () => {
    render(<SettingPage bookId="book-1" />);
    await screen.findByText('设定结果');
    fireEvent.click(screen.getByRole('button', { name: '打开完整设定库' }));
    const dock = screen.getByRole('group', { name: '新增设定操作' });
    expect(within(dock).getByRole('button', { name: /设计新增1项/ })).toBeInTheDocument();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/setting-batches') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: { message: '本周期创作算力已用完，升级会员或等待额度恢复后再继续。', retryable: false } }), { status: 403, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    fireEvent.click(within(dock).getByRole('button', { name: /设计新增1项/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('本周期创作算力已用完，升级会员或等待额度恢复后再继续。');
  });

  it('设定页不再重复显示开书资料', async () => {
    render(<SettingPage bookId="book-1" />);
    await screen.findByText('主编先挑出本书真正需要的设定，您也可以随时补充。');
    expect(screen.queryByText('开书资料')).not.toBeInTheDocument();
  });

  it('主编结果默认折叠设计思路，作者可确认形成新版本', async () => {
    render(<SettingPage bookId="book-1" />);
    await screen.findByText(resultItem.content);
    expect(screen.queryByText('设计思路')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(screen.getByText('设计思路').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: /确认采用/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/setting-items/world-stage/confirm'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('已确认')).toBeInTheDocument();
  });

  it('首次连接失败时给作者明确恢复按钮，重试后正常进入设定页', async () => {
    fetchMock.mockRejectedValueOnce(new Error('网络暂时不可用'));
    render(<SettingPage bookId="book-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('设定编辑部暂时没有准备好');
    expect(screen.getByRole('alert')).toHaveTextContent('对不起，这次操作没有完成，请稍后再试');
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
    expect(await screen.findByText('主编先挑出本书真正需要的设定，您也可以随时补充。')).toBeInTheDocument();
  });

  it('修改内容在条目内展开，保存后创建可恢复的复审任务', async () => {
    render(<SettingPage bookId="book-1" />);
    await screen.findByText(resultItem.content);
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    fireEvent.click(screen.getByRole('button', { name: /修改内容/ }));
    const panel = screen.getByRole('region', { name: '修改世界舞台' });
    expect(panel.closest('.setting-result-card')).not.toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '作者修改后的世界舞台方案。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并交主编复审' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/setting-items/world-stage/review-tasks'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText(/貂蝉 · 主编/)).toBeInTheDocument();
    expect(screen.getAllByText('老板稍等，我正在检查世界舞台')).toHaveLength(1);
    expect(document.querySelector('.setting-active-avatar')).not.toBeNull();
  });

  it('采纳主编提醒后由编剧修改并再次交给主编审查', async () => {
    render(<SettingPage bookId="book-1" />);
    await screen.findByText(resultItem.content);
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(screen.getByText(/采用提醒后会把当前完整内容直接交给主编复审/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '按提醒优化' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/review-tasks'), expect.objectContaining({ method: 'POST' })));
    expect(screen.getAllByText('老板稍等，我正在检查世界舞台')).toHaveLength(1);
    expect(document.querySelector('.setting-active-avatar')).not.toBeNull();
  });

  it('重新设计可选1至3名编剧，并能勾选多份方案交给主编融合', async () => {
    render(<SettingPage bookId="book-1" />);
    await screen.findByText(resultItem.content);
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    fireEvent.click(screen.getByRole('button', { name: /重新设计/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '请1名编剧出方案' })).toBeEnabled());
    const writerTwo = screen.getByText('幼薇').closest('label')?.querySelector('input');
    const writerThree = screen.getByText('苏映棠').closest('label')?.querySelector('input');
    expect(writerTwo).not.toBeNull(); expect(writerThree).not.toBeNull();
    fireEvent.click(writerTwo!); fireEvent.click(writerThree!);
    fireEvent.click(screen.getByRole('button', { name: '请3名编剧出方案' }));
    expect(await screen.findByText('第1份世界舞台方案，强调历史边界与主角行动空间。')).toBeInTheDocument();
    for (const index of [2, 3]) {
      const checkbox = screen.getByText(`方案 ${index}`).closest('label')?.querySelector('input');
      expect(checkbox).not.toBeNull(); fireEvent.click(checkbox!);
    }
    fireEvent.click(screen.getByRole('button', { name: '融合3份方案' }));
    expect(await screen.findByText('融合后的世界舞台方案。', {}, { timeout: 4_000 })).toBeInTheDocument();
  });

  it('打开重新设计时会从服务端找回当前任务，不依赖本地缓存', async () => {
    currentRedesignResponse = {
      taskId: 'redesign-current', status: 'ready', statusText: '已找回完成的方案。', failedMemberKeys: [],
      candidates: [{ outputId: 'current-output', memberKey: 'planner-deepseek-v4-pro', proposal: { content: '这是从服务端找回的世界舞台方案。', designRationale: '保留跨设备恢复能力。', storyConsequences: [], dependencies: [], risks: [] } }]
    };
    render(<SettingPage bookId="book-1" />);
    await screen.findByText(resultItem.content);
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    fireEvent.click(screen.getByRole('button', { name: /重新设计/ }));

    expect(await screen.findByText('这是从服务端找回的世界舞台方案。')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/setting-items/world-stage/redesigns/current'))).toBe(true);
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/setting-items/world-stage/redesigns') && init?.method === 'POST')).toBe(false);
  });

  it('重新设计部分失败时仍展示成功方案，并携带来源交给主编复审', async () => {
    currentRedesignResponse = {
      taskId: 'redesign-partial', status: 'failed', statusText: '对不起，有一位编剧这次没有完成。',
      progress: 100, retryable: true, failedMemberKeys: ['planner-kimi-k3'], createdAt: '', updatedAt: '',
      candidates: [1, 2].map((index) => ({
        outputId: `partial-output-${index}`,
        memberKey: index === 1 ? 'planner-deepseek-v4-pro' : 'planner-glm-5-3',
        proposal: {
          content: `已完成的第${index}份方案。`, designRationale: `第${index}份设计理由。`,
          storyConsequences: [], dependencies: [], risks: []
        }
      }))
    };
    render(<SettingPage bookId="book-1" />);
    await screen.findByText(resultItem.content);
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    fireEvent.click(screen.getByRole('button', { name: /重新设计/ }));

    expect(await screen.findByText('已完成的第1份方案。')).toBeInTheDocument();
    expect(screen.getByText('抱歉，有1位编剧这次没有完成；已完成方案都已保留，您仍可直接采用。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '采用并交主编复审' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => (
        String(input).endsWith('/setting-items/world-stage/review-tasks') && init?.method === 'POST'
      ));
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        sourceRedesignTaskId: 'redesign-partial', sourceOutputId: 'partial-output-1'
      });
    });
  });

  it('部分失败时在底部直接显示继续操作，并防止重复提交', async () => {
    const failedItem = { ...resultItem, itemKey: 'history-baseline', label: '历史基线', state: 'failed', stateText: '这次没有完成', content: null, designRationale: null, issues: [], revision: 0 };
    const partialBatch = { batchId: 'partial-batch', status: 'partially_failed', statusText: '抱歉，有一项这次没有完成。', progress: { completed: 1, total: 2, percent: 50 }, members, items: [resultItem, failedItem], retryable: true, restartable: false, restartNeedsConfirmation: false, createdAt: '', updatedAt: '' };
    let resolveRetry!: (value: Response) => void;
    const pendingRetry = new Promise<Response>((resolve) => { resolveRetry = resolve; });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/setting-department')) return json({ catalog: [], recommendedKeys: [], recommendation: null, confirmedItems: [], members, activeBatch: partialBatch, finalReview: null });
      if (url.endsWith('/setting-batches/partial-batch/retry') && init?.method === 'POST') return pendingRetry;
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    render(<SettingPage bookId="book-1" />);

    const retry = await screen.findByRole('button', { name: '重新安排未完成条目' });
    expect(screen.getByText('已有结果已保留，只继续未完成条目')).toBeVisible();
    fireEvent.click(retry);
    fireEvent.click(retry);

    await waitFor(() => expect(fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith('/setting-batches/partial-batch/retry') && init?.method === 'POST')).toHaveLength(1));
    expect(screen.getByRole('button', { name: '正在重新安排…' })).toBeDisabled();
    resolveRetry(json({ ...partialBatch, status: 'working', statusText: '正在继续未完成条目' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '正在重新安排…' })).not.toBeInTheDocument());
  });

  it.each([
    ['结果未知', '对不起，有一项结果暂时无法确认，系统已停止自动重试。'],
    ['版本已推进', '对不起，设定在任务期间已经更新，本轮旧结果没有覆盖当前版本。']
  ])('%s的普通批次不显示无效重试，只刷新并保留失败条目和已有结果', async (_caseName, statusText) => {
    const failedItem = {
      ...resultItem,
      itemKey: 'history-baseline',
      label: '历史基线',
      state: 'failed',
      stateText: statusText,
      content: null,
      designRationale: null,
      storyConsequences: [],
      issues: [],
      revision: 0
    };
    const failedBatch = {
      batchId: 'unsafe-retry-batch',
      status: 'partially_failed',
      statusText,
      progress: { completed: 1, total: 2, percent: 50 },
      members,
      items: [resultItem, failedItem],
      retryable: false,
      restartable: false,
      restartNeedsConfirmation: false,
      createdAt: '',
      updatedAt: ''
    };
    let departmentReads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/setting-department')) {
        departmentReads += 1;
        return json({
          catalog: [], recommendedKeys: [], recommendation: null,
          confirmedItems: [], members, activeBatch: failedBatch, finalReview: null
        });
      }
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    render(<SettingPage bookId="book-1" />);

    const refresh = await screen.findByRole('button', { name: '刷新核对结果' });
    expect(screen.queryByRole('button', { name: '重新安排未完成条目' })).not.toBeInTheDocument();
    expect(screen.getByText('历史基线')).toBeInTheDocument();
    expect(screen.getByText(resultItem.content)).toBeInTheDocument();
    expect(screen.getByText('当前结果已保留，请先核对最新状态')).toBeInTheDocument();
    fireEvent.click(refresh);

    await waitFor(() => expect(departmentReads).toBe(2));
    expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input).endsWith('/setting-batches/unsafe-retry-batch/retry') && init?.method === 'POST'
    ))).toBe(false);
    expect(screen.getByRole('button', { name: '刷新核对结果' })).toBeEnabled();
  });

  it('人工停止的普通批次只允许重新发起未完成条目，并防止重复提交', async () => {
    const failedItem = {
      ...resultItem,
      itemKey: 'history-baseline',
      label: '历史基线',
      state: 'failed',
      stateText: '对不起，这项任务已由人工停止。',
      content: null,
      designRationale: null,
      storyConsequences: [],
      issues: [],
      revision: 0
    };
    const stoppedBatch = {
      batchId: 'manual-failure-batch',
      status: 'partially_failed',
      statusText: '对不起，这项任务已由人工停止。',
      progress: { completed: 1, total: 2, percent: 50 },
      members,
      items: [resultItem, failedItem],
      retryable: false,
      restartable: true,
      restartNeedsConfirmation: false,
      createdAt: '',
      updatedAt: ''
    };
    let resolveRestart!: (value: Response) => void;
    const pendingRestart = new Promise<Response>((resolve) => { resolveRestart = resolve; });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/setting-department')) {
        return json({
          catalog: [], recommendedKeys: [], recommendation: null,
          confirmedItems: [], members, activeBatch: stoppedBatch, finalReview: null
        });
      }
      if (url.endsWith('/setting-batches/manual-failure-batch/restart') && init?.method === 'POST') return pendingRestart;
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    render(<SettingPage bookId="book-1" />);

    const restart = await screen.findByRole('button', { name: '重新发起未完成条目' });
    expect(screen.queryByRole('button', { name: '重新安排未完成条目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新核对结果' })).not.toBeInTheDocument();
    expect(screen.getByText('历史基线')).toBeInTheDocument();
    expect(screen.getByText(resultItem.content)).toBeInTheDocument();
    expect(screen.getByText('已有结果已保留，可重新发起未完成条目')).toBeInTheDocument();
    fireEvent.click(restart);
    fireEvent.click(restart);

    await waitFor(() => expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input).endsWith('/setting-batches/manual-failure-batch/restart') && init?.method === 'POST'
    ))).toHaveLength(1));
    const restartCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input).endsWith('/setting-batches/manual-failure-batch/restart') && init?.method === 'POST'
    ));
    expect(JSON.parse(String(restartCall?.[1]?.body))).toMatchObject({
      idempotencyKey: expect.stringMatching(/^setting-batch-restart-/u)
    });
    expect(screen.getByRole('button', { name: '正在重新发起…' })).toBeDisabled();
    resolveRestart(json({ ...stoppedBatch, status: 'queued', statusText: '未完成条目已经重新排队。', restartable: false }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '正在重新发起…' })).not.toBeInTheDocument());
  });

  it('设定批次轮询会等上一次请求结束，不会重叠发送', async () => {
    vi.useFakeTimers();
    let unmount: (() => void) | undefined;
    try {
      const working = { batchId: 'serial-batch', status: 'working', statusText: '正在设计', progress: { completed: 0, total: 1, percent: 0 }, members, items: [{ ...resultItem, state: 'working', content: null }], retryable: false, restartable: false, restartNeedsConfirmation: false, createdAt: '', updatedAt: '' };
      let resolvePoll!: (value: Response) => void;
      const pendingPoll = new Promise<Response>((resolve) => { resolvePoll = resolve; });
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/setting-department')) return json({ catalog: [], recommendedKeys: [], recommendation: null, confirmedItems: [], members, activeBatch: working, finalReview: null });
        if (url.endsWith('/setting-batches/serial-batch')) return pendingPoll;
        return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
      });
      const rendered = render(<SettingPage bookId="book-1" />);
      unmount = rendered.unmount;
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/setting-batches/serial-batch'))).toHaveLength(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/setting-batches/serial-batch'))).toHaveLength(1);
      resolvePoll(json(working));
      await act(async () => { await Promise.resolve(); });
    } finally {
      unmount?.();
      vi.useRealTimers();
    }
  });

  it('结果区和单项都可折叠，完成后可整理并批量保存当前设定', async () => {
    render(<SettingPage bookId="book-1" />);
    await screen.findByText(resultItem.content);
    fireEvent.click(screen.getByRole('button', { name: '收起结果' }));
    expect(screen.queryByText(resultItem.content)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看1项结果' }));
    expect(screen.getByText(resultItem.content)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '请主编统一整理' }));
    expect(await screen.findByText('人物、年代、组织称呼和世界规则已经统一。')).toBeInTheDocument();
    expect(screen.getByText('貂蝉 · 统一整理')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存当前设定（1项）' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/setting-items/world-stage/confirm'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByRole('button', { name: '进入时光机' })).toBeDisabled();
    expect(screen.getByText('设定已经安全保存，可以查看全书框架。')).toBeInTheDocument();
  });
});

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
}
