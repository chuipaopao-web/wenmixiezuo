import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InformationPage } from './InformationPage';

const profile = {
  title: '边军起势', channel: '男频' as const, category: '历史脑洞', subjects: ['穿越'], mainTags: ['成长', '权谋'], customTags: ['小人物崛起'],
  protagonists: [{ role: 'male_lead', name: '张牧', age: '23岁', background: '现代历史系学生穿越成流民', familyBackground: '普通家庭', careerBackground: '学生', goldenFinger: '', visualIdentity: { appearance: '眉眼清朗', build: '高瘦挺拔', signatureFeature: '眉骨浅疤' }, personalities: ['谨慎', '果断'] }],
  synopsis: '张牧在汉末乱世从流民起步。', storyDirection: '从流民成长为能够保护一方的将领。', openingStart: '张牧被边军临时征发。', storyEnding: '成为一方名将。',
  stylePrimary: '厚重', styleSecondary: '爽', mustFollow: ['不要系统', '不要后宫'],
  style: { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] }, source: '老板确认的开书资料', version: 1,
  openingBlueprint: {
    creationMode: 'new' as const, openingIdea: '现代青年穿越到三国乱世，从流民开始改变命运。', taxonomyVersion: 'test-v1', channel: 'male' as const,
    categoryKey: 'male-history-brain', targetAudience: '喜欢历史成长的读者',
    planningProfile: { publishingPlatform: 'fanqie' as const, expectedTotalWords: 1_500_000 },
    protagonists: [{ role: 'male_lead', name: '张牧', age: '23岁', background: '现代历史系学生穿越成流民', familyBackground: '普通家庭', careerBackground: '学生', goldenFinger: '', visualIdentity: { appearance: '眉眼清朗', build: '高瘦挺拔', signatureFeature: '眉骨浅疤' }, personalities: ['谨慎', '果断'] }],
    storyDirection: '从流民成长为能够保护一方的将领。', openingStart: '张牧被边军临时征发。', storyEnding: '成为一方名将。',
    worldBackground: '东汉末年，地方秩序松动。', openingBackground: '边军屯所正遭夜袭。', stageOne: { start: '', development: '', end: '' }, fullBookOutline: '张牧在汉末乱世从流民起步。',
    mainTags: ['成长', '权谋'], auxiliaryTags: ['穿越'], storyTraits: [], customTags: ['小人物崛起'], initialMap: '', mustFollow: ['不要系统', '不要后宫']
  }
};

const taxonomy = {
  version: 'test-v1',
  categories: [{ key: 'male-history-brain', name: '历史脑洞', channel: 'male', description: '历史背景中的架空推演', recommendedMainTags: ['成长'], tagPackKeys: ['history'] }],
  subjects: [{ name: '穿越', packKeys: ['common'] }], mainTags: ['成长'],
  personalityGroups: [{ key: 'common', name: '性格特点', description: '', options: ['谨慎', '果断'] }],
  boundaryGroups: [{ name: '常见边界', description: '', options: ['不写后宫', '不要系统'] }],
  tagGroups: [{ key: 'common', name: '常用标签', description: '', packKeys: ['common'], mainTags: ['成长'], auxiliaryTags: [], storyTraits: [] }]
};

const cover = {
  designId: 'cover-1', status: 'succeeded' as const, statusText: '封面已经制作完成', adopted: false, chiefName: '貂蝉',
  visualMembers: [
    { memberKey: 'visual-seedream', displayName: '绘真', roleName: '封面画师', responsibility: '执行主编整理好的制作单并交付封面', avatarPath: '/avatars/team-collage-source.jpg' }
  ],
  workOrder: {
    platformStyle: 'mainstream' as const, visualStyle: 'vivid' as const, compositionStyle: 'character-scene' as const,
    paletteStyle: 'high-contrast' as const, atmosphereStyle: 'epic' as const, elements: ['主角'], avoidElements: ['现代服装'], authorDirection: '',
    composition: '主角居中', visualFocus: '眉骨浅疤', atmosphere: '乱世中有希望', palette: '青灰与暖金',
    mustKeep: ['汉末'], mustAvoid: ['现代服装'], plannerReview: '构图清楚，可以出图。'
  },
  imageUrl: '/api/v1/v7/books/book-1/cover-designs/cover-1/image', downloadUrl: '/api/v1/v7/books/book-1/cover-designs/cover-1/download', createdAt: '2026-08-25T00:00:00.000Z'
};

describe('V7开书资料页', () => {
  // 最小类型修复（既有基线即报TS2348）：给vi.fn显式函数签名，使Mock保持可调用；不改变任何行为。
  type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  let fetchMock: ReturnType<typeof vi.fn<FetchStub>>;
  let studioDesigns: unknown[];
  beforeEach(() => {
    studioDesigns = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/book-profile') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { title: string };
        return json({ ...profile, title: body.title, version: 2 });
      }
      if (url.endsWith('/title-studio')) return json({ designs: [] });
      if (url.endsWith('/title-designs')) return json({ designId: 'design-1', status: 'succeeded', statusText: '书名候选已经设计完成', memberName: '一号主编', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:01.000Z', options: [
        { text: '汉末执棋人', note: '突出谋略成长' }, { text: '边军小卒', note: '突出底层开局' }, { text: '烽火照归途', note: '突出乱世氛围' }
      ] });
      if (url.endsWith('/cover-studio')) return json({
        visualMembers: [
          ...cover.visualMembers.map((member) => ({ ...member, roleName: 'visual_renderer', responsibility: 'model=minimax-m3；prompt=internal-cover-workstation', status: 'on_duty', statusText: '我在这儿，随时可以接单' })),
          { ...cover.visualMembers[0], memberKey: 'visual-seedream', displayName: '绘真', roleName: 'cover_artist', responsibility: 'internal duplicate seat', status: 'on_duty', statusText: '我在这儿，随时可以接单' }
        ],
        designs: studioDesigns
      });
      if (url.endsWith('/cover-designs') && init?.method === 'POST') return json(cover);
      if (url.endsWith('/cover-1/adopt') && init?.method === 'POST') return json({ ...cover, adopted: true });
      if (url.endsWith('/opening-taxonomy')) return json(taxonomy);
      if (url.endsWith('/book-profile')) return json(profile);
      return new Response(JSON.stringify({ error: { message: '未模拟请求' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('沿用资料行显示完整开书信息，并可打开两步修改表单', async () => {
    render(<InformationPage bookId="book-1" />);
    expect(await screen.findByRole('heading', { name: '边军起势' })).toBeInTheDocument();
    expect(screen.getByText('现代青年穿越到三国乱世，从流民开始改变命运。')).toBeInTheDocument();
    expect(screen.getByText('角色背景')).toBeInTheDocument();
    expect(screen.getByText(/现代历史系学生穿越成流民/)).toBeInTheDocument();
    expect(screen.getByText('不要系统、不要后宫')).toBeInTheDocument();
    expect(screen.queryByText('开局背景')).not.toBeInTheDocument();
    expect(screen.queryByText('张牧被边军临时征发。')).not.toBeInTheDocument();
    const visualDetails = screen.getByText('外貌与形象（选填）').closest('details')!;
    expect(visualDetails).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('外貌与形象（选填）'));
    expect(visualDetails).toHaveAttribute('open');
    expect(screen.getByText('眉骨浅疤')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /修改开书资料/ }));
    expect(await screen.findByRole('dialog', { name: '修改当前资料' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /写什么题材/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('边军起势')).toBeInTheDocument();
  });

  it('把资料调整和进入设定统一放在内容底部，并只保留一个阶段主按钮', async () => {
    render(<InformationPage bookId="book-1" />);
    await screen.findByRole('heading', { name: '边军起势' });
    const dock = screen.getByRole('contentinfo', { name: '开书资料操作' });
    expect(screen.queryByText('开书资料已经成为正式上游')).not.toBeInTheDocument();
    expect(dock).not.toHaveClass('workflow-action-dock');
    expect(within(dock).getAllByRole('button').map((button) => button.textContent)).toEqual(['设计书名', '设计封面', '修改开书资料', '进入设定']);
    expect(dock.querySelectorAll('button.primary-action')).toHaveLength(1);
    fireEvent.click(within(dock).getByRole('button', { name: '进入设定' }));
    expect(screen.getByRole('button', { name: '设定' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('主编可以随时设计书名，作者采用后走版本化开书资料接口', async () => {
    render(<InformationPage bookId="book-1" />);
    await screen.findByRole('heading', { name: '边军起势' });
    fireEvent.click(screen.getByRole('button', { name: /设计书名/ }));
    fireEvent.click(await screen.findByRole('button', { name: '开始设计书名' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在向主编提交书名工单');
    expect(await screen.findByText('汉末执棋人')).toBeInTheDocument();
    fireEvent.click(screen.getByText('汉末执棋人').closest('article')!.querySelector('button')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/book-profile'), expect.objectContaining({ method: 'PUT' })));
    expect(await screen.findByRole('heading', { name: '汉末执棋人' })).toBeInTheDocument();
  });

  it('封面编辑部明确展示主编工单与视觉编剧，采用封面不修改开书资料', async () => {
    render(<InformationPage bookId="book-1" />);
    await screen.findByRole('heading', { name: '边军起势' });
    fireEvent.click(screen.getByRole('button', { name: /设计封面/ }));
    expect(await screen.findByRole('dialog', { name: '设计封面' })).toBeInTheDocument();
    expect(screen.getByText('绘真 · 封面画师')).toBeInTheDocument();
    expect(document.querySelectorAll('.visual-member-strip')).toHaveLength(1);
    expect(screen.queryByText(/visual_renderer|cover_artist|minimax|prompt|internal/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '商业插画' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '群像' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '金色史诗' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '商业插画' }));
    fireEvent.click(screen.getByRole('button', { name: '群像' }));
    fireEvent.click(screen.getByRole('button', { name: '金色史诗' }));
    fireEvent.click(screen.getByRole('button', { name: '战场' }));
    fireEvent.click(screen.getByRole('button', { name: '开始设计封面' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在向封面编辑部提交工单');
    expect(await screen.findByText(/貂蝉/)).toBeInTheDocument();
    const designCall = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/cover-designs') && (init as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((designCall?.[1] as RequestInit).body))).toMatchObject({ visualStyle: 'illustration', compositionStyle: 'ensemble', paletteStyle: 'golden', elements: ['战场'] });
    expect(screen.getByRole('link', { name: '下载封面' })).toHaveAttribute('href', expect.stringContaining('/download'));
    fireEvent.click(screen.getByRole('button', { name: '采用这张封面' }));
    expect(await screen.findByRole('button', { name: '已经采用' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/book-profile'), expect.objectContaining({ method: 'PUT' }));
  });

  it('刷新后恢复进行中的封面任务并阻止重复发单', async () => {
    studioDesigns = [{
      ...cover, designId: 'cover-working-1', status: 'working', statusText: '主人耐心等待，主编和封面画师正在加急制作，快好啦～',
      workOrder: null, imageUrl: null, downloadUrl: null
    }];
    render(<InformationPage bookId="book-1" />);
    await screen.findByRole('heading', { name: '边军起势' });
    fireEvent.click(screen.getByRole('button', { name: /设计封面/ }));
    expect(await screen.findByText('封面正在制作')).toBeVisible();
    expect(screen.getAllByText(/正在加急制作/).some((item) => item.tagName === 'P')).toBe(true);
    expect(screen.getByRole('button', { name: /亲爱的，正在加急制作/ })).toBeDisabled();
    expect(screen.queryByRole('link', { name: '下载封面' })).not.toBeInTheDocument();
  });

  it('当前封面制作与历史失败分开显示，旧失败默认折叠', async () => {
    studioDesigns = [
      { ...cover, designId: 'cover-working-2', status: 'working', statusText: '主编和封面画师正在制作', workOrder: null, imageUrl: null, downloadUrl: null },
      { ...cover, designId: 'cover-failed-1', status: 'failed', statusText: '上一轮没有制作完成', workOrder: null, imageUrl: null, downloadUrl: null }
    ];
    render(<InformationPage bookId="book-1" />);
    await screen.findByRole('heading', { name: '边军起势' });
    fireEvent.click(screen.getByRole('button', { name: /设计封面/ }));
    expect(await screen.findByText('封面正在制作')).toBeVisible();
    const history = screen.getByText('历史未完成记录（1）').closest('details')!;
    expect(history).not.toHaveAttribute('open');
    expect(history).toHaveTextContent('上一轮没有制作完成');
    expect(screen.getAllByText('封面正在制作')).toHaveLength(1);
  });

  it('R208：卖点与味道是多行输入，中文输入与超长粘贴不丢字、超限中文报错并阻断保存，修短后可保存', async () => {
    render(<InformationPage bookId="book-1" />);
    await screen.findByRole('heading', { name: '边军起势' });
    fireEvent.click(screen.getByRole('button', { name: /修改开书资料/ }));
    const dialog = await screen.findByRole('dialog', { name: '修改当前资料' });
    const appeal = within(dialog).getByLabelText('核心卖点') as HTMLTextAreaElement;
    const tone = within(dialog).getByLabelText('阅读味道') as HTMLTextAreaElement;
    expect(appeal.tagName).toBe('TEXTAREA');
    expect(tone.tagName).toBe('TEXTAREA');
    expect(appeal.rows).toBeGreaterThanOrEqual(2);
    fireEvent.compositionStart(appeal);
    fireEvent.change(appeal, { target: { value: '末世废土里一碗碗热汤面换人心的反差经营流' } });
    fireEvent.compositionEnd(appeal);
    expect(appeal.value).toBe('末世废土里一碗碗热汤面换人心的反差经营流');
    const longAppeal = '爽'.repeat(801);
    fireEvent.change(appeal, { target: { value: longAppeal } });
    expect(appeal.value).toBe(longAppeal);
    expect(appeal.value.length).toBe(801);
    const longTone = '燃'.repeat(301);
    fireEvent.change(tone, { target: { value: longTone } });
    expect(tone.value.length).toBe(301);
    expect(within(dialog).getAllByText(/已超出1字/).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
    const save = await within(dialog).findByRole('button', { name: /保存修改/ });
    expect(save).toBeDisabled();
    expect(within(dialog).getByText(/还需要确认/)).toHaveTextContent('核心卖点不能超过800字');
    expect(within(dialog).getByText(/还需要确认/)).toHaveTextContent('阅读味道不能超过300字');
    fireEvent.click(within(dialog).getByRole('button', { name: /上一步/ }));
    fireEvent.change(within(dialog).getByLabelText('核心卖点'), { target: { value: '爽'.repeat(800) } });
    fireEvent.change(within(dialog).getByLabelText('阅读味道'), { target: { value: '燃'.repeat(300) } });
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
    const saveAgain = await within(dialog).findByRole('button', { name: /保存修改/ });
    expect(saveAgain).toBeEnabled();
  });

  it('R208 A4：保存失败与版本冲突保留输入、如实报错，不假报成功', async () => {
    const baseFetch = fetchMock;
    const conflictMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/book-profile') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: { message: '资料已被其他管理员更新，请重新读取后再修改。' } }), { status: 409, headers: { 'content-type': 'application/json' } });
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal('fetch', conflictMock);
    render(<InformationPage bookId="book-1" />);
    await screen.findByRole('heading', { name: '边军起势' });
    fireEvent.click(screen.getByRole('button', { name: /修改开书资料/ }));
    const dialog = await screen.findByRole('dialog', { name: '修改当前资料' });
    fireEvent.change(await within(dialog).findByLabelText('书名'), { target: { value: '边军起势改' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /保存修改/ }));
    expect(await within(dialog).findByText(/资料已被其他管理员更新/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /上一步/ }));
    expect(within(dialog).getByLabelText('书名')).toHaveValue('边军起势改');
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
    expect(screen.queryByText(/已保存为第/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /保存修改/ })).toBeEnabled();
    const serverErrorMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/book-profile') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: { message: '开书资料没有保存成功' } }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal('fetch', serverErrorMock);
    fireEvent.click(within(dialog).getByRole('button', { name: /保存修改/ }));
    expect(await within(dialog).findByText(/开书资料没有保存成功/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /上一步/ }));
    expect(within(dialog).getByLabelText('书名')).toHaveValue('边军起势改');
    expect(screen.queryByText(/已保存为第/)).not.toBeInTheDocument();
  });

  // OPENING-UI-02返修R2：设定分区属于长篇工作台——类型未确认前（加载中/失败）不能先挂载可发任务的界面。
  describe('R2 设定分区类型门禁', () => {
    it('类型读取中显示等待提示，不挂载设定工作台', async () => {
      const pendingMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/book-profile') && init?.method !== 'PUT') return new Promise<Response>(() => {});
        const response = await fetchMock(input, init);
        return response;
      });
      vi.stubGlobal('fetch', pendingMock);
      render(<InformationPage bookId="book-1" initialSection="setting" />);
      expect(await screen.findByText('正在确认本书类型与可用功能…')).toBeInTheDocument();
      expect(screen.queryByLabelText('本书设定')).not.toBeInTheDocument();
      expect(screen.queryByText('正在准备设定编辑部…')).not.toBeInTheDocument();
    });

    it('类型读取失败给可重试错误，重试成功后进入设定工作台', async () => {
      let attempts = 0;
      const flakyMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/book-profile') && init?.method !== 'PUT') {
          attempts += 1;
          if (attempts === 1) return new Response(JSON.stringify({ error: { message: '读取失败' } }), { status: 500, headers: { 'content-type': 'application/json' } });
        }
        return fetchMock(input, init);
      });
      vi.stubGlobal('fetch', flakyMock);
      render(<InformationPage bookId="book-1" initialSection="setting" />);
      expect(await screen.findByText('开书资料读取失败')).toBeInTheDocument();
      expect(screen.queryByText('正在准备设定编辑部…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('本书设定')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
      // 长篇书重试成功后挂载设定工作台（部门接口未模拟时报其自身加载失败，两种结果都证明工作台已挂载）。
      await waitFor(() => expect(
        screen.queryByText('正在准备设定编辑部…') !== null
        || screen.queryByText(/设定编辑部暂时没有准备好/) !== null
        || screen.queryByLabelText('本书设定') !== null
      ).toBe(true));
      expect(screen.queryByText('开书资料读取失败')).not.toBeInTheDocument();
    });

    it('短篇书显示尚未开放说明，不挂载设定工作台', async () => {
      const shortMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/book-profile') && init?.method !== 'PUT') return json({ ...profile, workType: 'short_story' });
        return fetchMock(input, init);
      });
      vi.stubGlobal('fetch', shortMock);
      render(<InformationPage bookId="book-1" initialSection="setting" />);
      expect(await screen.findByText('短篇小说的后续创作工作台尚未开放')).toBeInTheDocument();
      expect(screen.queryByText('正在准备设定编辑部…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('本书设定')).not.toBeInTheDocument();
      expect(shortMock.mock.calls.some(([input]) => String(input).includes('/setting-department'))).toBe(false);
    });

    it('短篇书资料分区正常显示开书资料，但不加载长篇全书简介', async () => {
      const shortMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/book-profile') && init?.method !== 'PUT') return json({ ...profile, workType: 'short_story' });
        return fetchMock(input, init);
      });
      vi.stubGlobal('fetch', shortMock);
      render(<InformationPage bookId="book-1" />);
      expect(await screen.findByRole('heading', { name: '边军起势' })).toBeInTheDocument();
      expect(shortMock.mock.calls.some(([input]) => String(input).includes('/synopsis'))).toBe(false);
    });
  });

});

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
}
