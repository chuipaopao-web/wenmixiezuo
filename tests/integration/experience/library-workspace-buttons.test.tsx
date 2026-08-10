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
      valueType: 'text', value: '能辨认残缺阵纹', unit: null, authorityLayer: 'canon', status: 'active',
      sourceType: 'confirmed_manuscript', sourceId: 'source-internal-1', sourceChapterId: 'chapter-internal-1',
      canonRevision: 3, revision: 1, previousEntryId: null, createdAt: '2026-08-10T00:00:00.000Z'
    }],
    pending: []
  }]
};

const library = {
  canonRevision: 3,
  entities: [
    { entity_id: 'character-hero', entity_type: 'character', canonical_name: '沈砚', aliases: [], status: 'active' },
    { entity_id: 'organization-1', entity_type: 'organization', canonical_name: '青霄宗', aliases: [], status: 'active' },
    { entity_id: 'location-1', entity_type: 'location', canonical_name: '试剑台', aliases: [], status: 'active' },
    { entity_id: 'item-1', entity_type: 'item', canonical_name: '残缺阵盘', aliases: [], status: 'active' },
    { entity_id: 'event-1', entity_type: 'event', canonical_name: '外门试剑', aliases: [], status: 'active' },
    { entity_id: 'rule-1', entity_type: 'world_rule', canonical_name: '阵纹反噬', aliases: [], status: 'active' }
  ],
  facts: [
    { fact_id: 'fact-internal-1', subject_entity_id: 'character-hero', canonical_name: '沈砚', relation_key: 'event.chapter_001', value: '沈砚参加外门试剑', grade: 'B', status: 'active', source_chapter_number: 1, source_chapter_title: '试剑开局', evidence: [{ quote: '沈砚踏上试剑台。' }] },
    { fact_id: 'fact-internal-map', subject_entity_id: 'location-1', canonical_name: '试剑台', relation_key: 'map.coordinate', value: { x: 42, y: 58 }, grade: 'A', status: 'active', source_chapter_number: 1, source_chapter_title: '试剑开局', evidence: [{ quote: '试剑台位于外门东侧。' }] }
  ],
  relations: [{ relationship_id: 'relationship-internal-1', from_name: '沈砚', relation_key: 'cooperation', toValue: '许小川' }],
  tags: [{ tag_definition_id: 'tag-internal-1', namespace: 'story', name: '阵法破局', description: '用规则和观察反击', status: 'active', assignment_count: 1 }],
  projections: [],
  gaps: [{ knowledge_gap_id: 'gap-internal-1', narrative_goal: '确认父亲旧案证人', diagnosis: '证人身份仍待正文确认', severity: 'medium', status: 'open' }],
  settings: [{ itemKey: 'world-era', groupTitle: '世界与环境', label: '时代背景', sourceLabel: '作者确认', content: '宗门与世家并存的修真时代。', confirmedAt: '2026-08-10T00:00:00.000Z' }],
  bookProfile: { title: '阵骨问天', channel: '男频', category: '东方仙侠', subjects: ['修仙', '阵法'], mainTags: ['成长', '智斗'], customTags: ['宗门群像'], protagonists: [{ role: 'male_lead', name: '沈砚', age: '十八岁', background: '外门弟子', personalities: ['冷静'] }], mustFollow: ['破局必须有前置证据'], source: '作者确认的开书资料' },
  protagonists: protagonistDashboard,
  attributeFormulas: [{ formulaId: 'formula-internal-1', label: '阵盘承压', expression: 'base * 2', unit: '点', variables: [{ key: 'base', label: '基础值', defaultValue: 5 }] }],
  summary: { entityCount: 6, factCount: 2, relationCount: 1, tagCount: 1, projectionCount: 0, openGapCount: 1 }
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

  it('逐项打开十二个分类并以自然中文显示资料、关系、时间线和来源', async () => {
    render(<LibraryWorkspace data={library} bookId="book-xianxia" />);
    expect(screen.getByText('阵骨问天')).toBeInTheDocument();
    for (const [tab, expected] of [
      ['已确认设定', '时代背景'], ['角色', '沈砚'], ['势力', '青霄宗'], ['地点与地图', '试剑台'],
      ['道具资源', '残缺阵盘'], ['事件时间线', '外门试剑'], ['规则', '阵纹反噬'],
      ['待补内容', '证人身份仍待正文确认'], ['内容来源', '内容来自哪里']
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('章节行动')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/(?:fact-internal|source-internal|relationship-internal|knowledge_gap_id|event\.chapter_001)/u);
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
    fireEvent.click(screen.getByLabelText('这是作者已经确认的信息'));
    fireEvent.click(screen.getByRole('button', { name: '保存状态' }));
    await waitFor(() => expect(api.appendProtagonistState).toHaveBeenCalled());

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
