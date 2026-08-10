import { describe, expect, it } from 'vitest';
import {
  buildLibraryProfiles,
  buildLibraryWorldMap,
  type LibraryEntityRow,
  type LibraryFactRow
} from '../../apps/api/src/application/knowledge/library-semantic-view.js';

const entities: LibraryEntityRow[] = [
  { entity_id: 'character-1', entity_type: 'character', canonical_name: '苏青萝', aliases: [] },
  { entity_id: 'organization-1', entity_type: 'organization', canonical_name: '青霄宗', aliases: [] },
  { entity_id: 'item-1', entity_type: 'item', canonical_name: '寒玉剑', aliases: [] },
  { entity_id: 'location-1', entity_type: 'location', canonical_name: '青霄宗', aliases: [] },
  { entity_id: 'location-2', entity_type: 'location', canonical_name: '试剑台', aliases: [] },
  { entity_id: 'location-3', entity_type: 'location', canonical_name: '临渊城', aliases: [] }
];

const facts: LibraryFactRow[] = [
  { subject_entity_id: 'character-1', canonical_name: '苏青萝', relation_key: 'character.personality', value: '冷静敏锐', source_chapter_number: 2, source_chapter_title: '阵纹反击' },
  { subject_entity_id: 'character-1', canonical_name: '苏青萝', relation_key: 'character.affiliation', value: '青霄宗', source_chapter_number: 2, source_chapter_title: '阵纹反击' },
  { subject_entity_id: 'character-1', canonical_name: '苏青萝', relation_key: 'character.equipment', value: '寒玉剑', source_chapter_number: 3, source_chapter_title: '剑出寒光' },
  { subject_entity_id: 'character-1', canonical_name: '苏青萝', relation_key: 'character.appears', value: '苏青萝出场', source_chapter_number: 2, source_chapter_title: '阵纹反击' },
  { subject_entity_id: 'organization-1', canonical_name: '青霄宗', relation_key: 'organization.member_count', value: '三千弟子', source_chapter_number: 1, source_chapter_title: '山门' },
  { subject_entity_id: 'item-1', canonical_name: '寒玉剑', relation_key: 'item.effects', value: '寒气凝霜', source_chapter_number: 3, source_chapter_title: '剑出寒光' },
  { subject_entity_id: 'location-1', canonical_name: '青霄宗', relation_key: 'location.birthplace', value: '沈砚的出生地', source_chapter_number: 1, source_chapter_title: '山门' },
  { subject_entity_id: 'location-1', canonical_name: '青霄宗', relation_key: 'location.appears_in_chapter', value: '故事从青霄宗开始', source_chapter_number: 1, source_chapter_title: '山门' },
  { subject_entity_id: 'location-2', canonical_name: '试剑台', relation_key: 'location.appears_in_chapter', value: '宗门内部比试场地', source_chapter_number: 2, source_chapter_title: '阵纹反击' },
  { subject_entity_id: 'location-3', canonical_name: '临渊城', relation_key: 'location.direction', value: '青霄宗以东', source_chapter_number: 4, source_chapter_title: '下山' },
  { subject_entity_id: 'location-3', canonical_name: '临渊城', relation_key: 'location.appears_in_chapter', value: '主角进入临渊城', source_chapter_number: 4, source_chapter_title: '下山' }
];

describe('资料库类型化档案', () => {
  it('按对象语义归类，并从明确关系反向补充势力成员和道具归属', () => {
    const character = buildLibraryProfiles(entities, facts, ['character'])[0]!;
    const organization = buildLibraryProfiles(entities, facts, ['organization'])[0]!;
    const item = buildLibraryProfiles(entities, facts, ['item'])[0]!;

    expect(character.fields.find((field) => field.key === 'personality')?.values[0]?.value).toBe('冷静敏锐');
    expect(character.fields.find((field) => field.key === 'age')?.values).toEqual([]);
    expect(character.fields.find((field) => field.key === 'appearances')?.values[0]?.value).toBe('第2章 · 《阵纹反击》');
    expect(organization.fields.find((field) => field.key === 'member_count')?.values[0]?.value).toBe('三千弟子');
    expect(organization.fields.find((field) => field.key === 'members')?.values[0]?.value).toBe('苏青萝');
    expect(item.fields.find((field) => field.key === 'owner')?.values[0]?.value).toBe('苏青萝');
    expect(item.fields.find((field) => field.key === 'effects')?.values[0]?.value).toBe('寒气凝霜');
  });

  it('世界路线只保留大范围地点，并按正式章节连接且不猜方位', () => {
    const locations = buildLibraryProfiles(entities, facts, ['location']);
    const map = buildLibraryWorldMap(locations, '东境群山中的宗门与城池。');

    expect(map.authorDescription).toBe('东境群山中的宗门与城池。');
    expect(map.nodes.map((node) => node.name)).toEqual(['青霄宗', '临渊城']);
    expect(map.nodes[0]).toMatchObject({ role: 'birthplace', chapterNumber: 1, direction: null });
    expect(map.nodes[1]).toMatchObject({ role: 'location', chapterNumber: 4, direction: '青霄宗以东' });
    expect(map.edges).toEqual([{ fromNodeId: 'location-1', toNodeId: 'location-3', label: '故事行进到', chapterNumber: 4 }]);
  });
});
