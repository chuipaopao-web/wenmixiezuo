// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryData } from '../../../apps/web/src/lib/api/client.js';
import { LibraryWorkspace } from '../../../apps/web/src/features/library/LibraryWorkspace.js';

const api = vi.hoisted(() => ({
  appendProtagonistState: vi.fn(),
  archiveProtagonistState: vi.fn(),
  classifyProtagonistState: vi.fn(),
  createLibraryTag: vi.fn(),
  evaluateAttributeFormula: vi.fn(),
  fetchAttributeFormulas: vi.fn(),
  fetchProtagonists: vi.fn(),
  saveProtagonistProfile: vi.fn()
}));

vi.mock('../../../apps/web/src/lib/api/client.js', async () => ({
  ...(await vi.importActual('../../../apps/web/src/lib/api/client.js')),
  ...api
}));

const protagonistDashboard = {
  profiles: [{
    profileId: 'profile-internal-1', entityId: 'character-hero', displayName: '沈砚', isPrimary: true,
    current: [{
      entryId: 'state-internal-1', category: 'unclassified', logicalKey: '阵纹感知', label: '阵纹感知',
      valueType: 'text', value: '能辨认残缺阵纹', unit: null, authorityLayer: 'canon', stateStatus: 'active',
      storyTime: null, effectiveChapterNumber: 1, note: null,
      sourceType: 'confirmed_manuscript', sourceId: 'source-internal-1', sourceChapterId: 'chapter-internal-1',
      canonRevision: 3, revision: 1, previousEntryId: null, createdAt: '2026-08-10T00:00:00.000Z'
    }],
    pending: [], history: [], historyCount: 0
  }]
};

const library = {
  canonRevision: 3,
  entities: [
    { entity_id: 'character-hero', entity_type: 'character', canonical_name: '沈砚', aliases: [], status: 'active' },
    { entity_id: 'character-side', entity_type: 'character', canonical_name: '苏青萝', aliases: [], status: 'active' },
    { entity_id: 'organization-1', entity_type: 'organization', canonical_name: '青霄宗', aliases: [], status: 'active' },
    { entity_id: 'location-1', entity_type: 'location', canonical_name: '试剑台', aliases: [], status: 'active' },
    { entity_id: 'item-1', entity_type: 'item', canonical_name: '残缺阵盘', aliases: [], status: 'active' },
    { entity_id: 'event-1', entity_type: 'event', canonical_name: '外门试剑', aliases: [], status: 'active' },
    { entity_id: 'rule-1', entity_type: 'world_rule', canonical_name: '阵纹反噬', aliases: [], status: 'active' }
  ],
  facts: [
    { fact_id: 'fact-internal-1', subject_entity_id: 'character-hero', canonical_name: '沈砚', relation_key: 'event.chapter_001', value: '沈砚参加外门试剑', grade: 'B', status: 'active', source_chapter_number: 1, source_chapter_title: '试剑开局', evidence: [{ quote: '沈砚踏上试剑台。' }] },
    { fact_id: 'fact-side-appearance', subject_entity_id: 'character-side', canonical_name: '苏青萝', relation_key: 'event.chapter_002', value: '苏青萝目睹试剑', grade: 'B', status: 'active', source_chapter_number: 2, source_chapter_title: '阵纹反击', evidence: [{ quote: '苏青萝在台下看清了阵纹。' }] },
    { fact_id: 'fact-side-realm', subject_entity_id: 'character-side', canonical_name: '苏青萝', relation_key: 'character.realm', value: '炼气九层', grade: 'B', status: 'active', source_chapter_number: 2, source_chapter_title: '阵纹反击', evidence: [{ quote: '她已是炼气九层。' }] },
    { fact_id: 'fact-internal-map', subject_entity_id: 'location-1', canonical_name: '试剑台', relation_key: 'map.coordinate', value: { x: 42, y: 58 }, grade: 'A', status: 'active', source_chapter_number: 1, source_chapter_title: '试剑开局', evidence: [{ quote: '试剑台位于外门东侧。' }] }
  ],
  timeline: [{ event_id: 'event-1', event_title: '试剑台反杀', planned_event_title: '外门试剑', chapter_start: 1, chapter_end: 3, story_time: null, actual_summary: '沈砚借残阵反击韩烈，赢下试剑并引出父亲旧案线索。', source_chapter_number: 3, source_chapter_title: '旧案线索', event: '试剑台反杀' }],
  relations: [{ relationship_id: 'relationship-internal-1', from_name: '沈砚', relation_key: 'cooperation', toValue: '许小川' }],
  tags: [{ tag_definition_id: 'tag-internal-1', namespace: 'story', name: '阵法破局', description: '用规则和观察反击', status: 'active', assignment_count: 1 }],
  projections: [],
  gaps: [{ knowledge_gap_id: 'gap-internal-1', narrative_goal: '确认父亲旧案证人', diagnosis: '证人身份仍待正文确认', severity: 'medium', status: 'open' }],
  settings: [{ itemKey: 'world-era', groupTitle: '世界与环境', label: '时代背景', sourceLabel: '作者确认', content: '宗门与世家并存的修真时代。', confirmedAt: '2026-08-10T00:00:00.000Z' }],
  supportingCharacters: [{ entity_id: 'character-side', entity_type: 'character', canonical_name: '苏青萝', aliases: [], status: 'active' }],
  effectiveRules: [{ ruleKey: 'must-follow-1', title: '必须遵守', summary: '破局必须有前置证据', sourceLabel: '开书信息', confirmedAt: '2026-08-10T00:00:00.000Z' }],
  bookProfile: { title: '阵骨问天', channel: '男频', category: '东方仙侠', subjects: ['修仙', '阵法'], mainTags: ['成长', '智斗'], customTags: ['宗门群像'], protagonists: [{ role: 'male_lead', name: '沈砚', age: '十八岁', background: '外门弟子', personalities: ['冷静'] }], mustFollow: ['破局必须有前置证据'], source: '作者确认的开书资料' },
  protagonists: protagonistDashboard,
  attributeFormulas: [{ formulaId: 'formula-internal-1', label: '阵盘承压', expression: 'base * 2', unit: '点', variables: [{ key: 'base', label: '基础值', defaultValue: 5 }] }],
  summary: { entityCount: 7, factCount: 4, relationCount: 1, timelineCount: 1, tagCount: 1, projectionCount: 0, openGapCount: 1 }
} as unknown as LibraryData;

describe('资料库全部页签和操作按钮', () => {
  beforeEach(() => {
    api.fetchProtagonists.mockResolvedValue(protagonistDashboard);
    api.fetchAttributeFormulas.mockResolvedValue(library.attributeFormulas);
    api.appendProtagonistState.mockResolvedValue({});
    api.archiveProtagonistState.mockResolvedValue({});
    api.classifyProtagonistState.mockResolvedValue({});
    api.createLibraryTag.mockResolvedValue({ tagId: 'new-tag', status: 'active' });
    api.evaluateAttributeFormula.mockResolvedValue({ result: 10 });
    api.saveProtagonistProfile.mockResolvedValue({ profileId: 'new-profile' });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('逐项打开十二个分类，配角按需展开，并让各类资料只显示自己的正式内容', async () => {
    render(<LibraryWorkspace data={library} bookId="book-xianxia" />);
    expect(screen.getByText('阵骨问天')).toBeInTheDocument();
    for (const [tab, expected] of [
      ['设定来源', '时代背景'], ['配角', '苏青萝'], ['势力', '青霄宗'], ['地点与地图', '试剑台'],
      ['道具资源', '残缺阵盘'], ['事件时间线', '试剑台反杀'], ['生效规则', '破局必须有前置证据'],
      ['待补内容', '证人身份仍待正文确认'], ['内容来源', '内容来自哪里']
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
    }
    expect(document.body).not.toHaveTextContent(/(?:fact-internal|source-internal|relationship-internal|knowledge_gap_id|event\.chapter_001)/u);
  });

  it('配角初始只显示姓名和一次出场，展开后再显示境界、属性、道具和后续出场', () => {
    render(<LibraryWorkspace data={library} bookId="book-xianxia" />);
    fireEvent.click(screen.getByRole('button', { name: '配角' }));
    expect(screen.queryByText('沈砚')).not.toBeInTheDocument();
    expect(screen.getByText('苏青萝')).toBeInTheDocument();
    expect(screen.getAllByText('第2章 · 《阵纹反击》')).toHaveLength(2);
    const details = screen.getByText('展开查看完整资料').closest('details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('展开查看完整资料'));
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('境界与等级')).toBeInTheDocument();
    expect(screen.getByText('炼气九层')).toBeInTheDocument();
  });

  it('势力、地点和道具不再重复展示整套设定卡，时间线以正文事件而非主角逐章行动汇总', () => {
    render(<LibraryWorkspace data={library} bookId="book-xianxia" />);
    for (const tab of ['势力', '地点与地图', '道具资源'] as const) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      expect(screen.queryByText('已确认设定')).not.toBeInTheDocument();
      expect(screen.queryByText('策划理念')).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '事件时间线' }));
    expect(screen.getByText('书内时间未注明')).toBeInTheDocument();
    expect(screen.getByText('沈砚借残阵反击韩烈，赢下试剑并引出父亲旧案线索。')).toBeInTheDocument();
    expect(screen.getByText(/第 1—3 章 · 所属规划：外门试剑/u)).toBeInTheDocument();
    expect(screen.queryByText(/参与了第\d+章的行动/u)).not.toBeInTheDocument();
  });

  it('主角资料的归类、移除、补充、试算和标签创建按钮都有明确反馈', async () => {
    render(<LibraryWorkspace data={library} bookId="book-xianxia" />);
    fireEvent.click(screen.getByRole('button', { name: '主角' }));
    expect(await screen.findByText('主角实时面板')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('为阵纹感知确认分类'), { target: { value: '技能能力' } });
    fireEvent.click(screen.getByRole('button', { name: '确认分类' }));
    await waitFor(() => expect(api.classifyProtagonistState).toHaveBeenCalledWith('book-xianxia', 'state-internal-1', 'skill'));

    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    await waitFor(() => expect(api.archiveProtagonistState).toHaveBeenCalledWith('book-xianxia', 'state-internal-1'));

    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '资源' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '灵石' } });
    fireEvent.change(screen.getByLabelText('当前值'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('单位'), { target: { value: '枚' } });
    fireEvent.change(screen.getByLabelText('这次变化'), { target: { value: 'active' } });
    fireEvent.change(screen.getByLabelText('发生章节'), { target: { value: '12' } });
    fireEvent.click(screen.getByLabelText('这是作者已经确认的信息'));
    fireEvent.click(screen.getByRole('button', { name: '保存状态' }));
    await waitFor(() => expect(api.appendProtagonistState).toHaveBeenCalledWith('book-xianxia', 'profile-internal-1', expect.objectContaining({ stateStatus: 'active', effectiveChapterNumber: 12 })));

    fireEvent.change(screen.getByLabelText('基础值'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: '计算' }));
    expect(await screen.findByText('10点')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '标签' }));
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '逆境破局' } });
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: '压力下通过证据反击' } });
    fireEvent.click(screen.getByRole('button', { name: '创建标签' }));
    expect(await screen.findByText('标签“逆境破局”已创建，只更新结构化元数据，不会重写正文或全量重嵌入。')).toBeInTheDocument();
    expect(api.createLibraryTag).toHaveBeenCalledWith('book-xianxia', expect.objectContaining({ name: '逆境破局' }));
  });
});
