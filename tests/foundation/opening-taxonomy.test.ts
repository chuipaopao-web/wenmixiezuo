import { describe, expect, it } from 'vitest';
import {
  OPENING_TAXONOMY,
  validateOpeningBlueprint,
  type OpeningBlueprintInput
} from '../../apps/api/src/contracts/opening-blueprint.js';

function validBlueprint(): OpeningBlueprintInput {
  return {
    taxonomyVersion: OPENING_TAXONOMY.version,
    channel: 'male',
    categoryKey: 'male-fantasy-brain',
    targetAudience: '喜欢成长、谋略与边城经营的男频读者',
    protagonists: [{
      role: 'male_lead', name: '陆沉', age: '十八岁',
      background: '边城驿卒之子，意外得到残缺军功册。',
      personalities: ['冷静', '有底线']
    }],
    worldBackground: '王朝、宗门与边军共同维持脆弱秩序。',
    openingBackground: '北境失守前夜，驿站收到一封来自未来的军报。',
    stageOne: {
      start: '陆沉发现军报与现实逐条对应。',
      development: '他借军报救下一城，却暴露情报来源。',
      end: '他守住边城并发现军报来自三年后的自己。'
    },
    fullBookOutline: '主线是阻止王朝覆灭，结局由陆沉建立新的边境秩序。',
    mainTags: ['穿越', '谋略', '热血'],
    auxiliaryTags: ['架空历史'],
    storyTraits: ['群像', '成长'],
    customTags: ['边城经营'],
    initialMap: '北境·雁回驿及周边三十里。',
    mustFollow: ['不写后宫']
  };
}

describe('完整开书分类与资料合同', () => {
  it('按男频女频提供版本化番茄式分类且分类键唯一', () => {
    expect(OPENING_TAXONOMY.version).toMatch(/^wenmi-single-category-subject-library-/u);
    expect(OPENING_TAXONOMY.categories.some((item) => item.channel === 'male' && item.name === '玄幻脑洞')).toBe(true);
    expect(OPENING_TAXONOMY.categories.some((item) => item.channel === 'male' && item.name === '动漫衍生')).toBe(true);
    expect(OPENING_TAXONOMY.categories.some((item) => item.channel === 'female' && item.name === '现言脑洞')).toBe(true);
    expect(OPENING_TAXONOMY.categories.some((item) => item.channel === 'female' && item.name === '古风世情')).toBe(true);
    expect(new Set(OPENING_TAXONOMY.categories.map((item) => item.key)).size).toBe(OPENING_TAXONOMY.categories.length);
    expect(OPENING_TAXONOMY.tagGroups.length).toBeGreaterThan(10);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '历史古代')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '游戏异界')).toBe(true);
    expect(new Set(OPENING_TAXONOMY.mainTags).size).toBeGreaterThan(200);
    expect(OPENING_TAXONOMY.categories.every((item) => item.tagPackKeys.length > 0)).toBe(true);
    expect(OPENING_TAXONOMY.categories.flatMap((item) => item.recommendedMainTags)
      .filter((tag) => !OPENING_TAXONOMY.mainTags.includes(tag))).toEqual([]);
    expect(OPENING_TAXONOMY).toMatchObject({
      boundaryGroups: expect.arrayContaining([
        expect.objectContaining({ name: '感情与关系', options: expect.arrayContaining(['不写后宫', '不写多角恋']) }),
        expect.objectContaining({ name: '主角体验', options: expect.arrayContaining(['不虐主', '不降智']) }),
        expect.objectContaining({ name: '内容尺度', options: expect.arrayContaining(['不写露骨情色', '不写血腥猎奇']) }),
        expect.objectContaining({ name: '结构与结局', options: expect.arrayContaining(['不写开放式结局', '不写主角团灭']) })
      ])
    });
  });

  it('接受完整资料、多个主角和2至8个主要标签', () => {
    const blueprint = validBlueprint();
    blueprint.auxiliaryCategoryKeys = ['male-game-sports', 'male-history-brain'];
    blueprint.protagonists.push({
      role: 'female_lead', name: '谢昭', age: '二十岁',
      background: '北境守将之女，负责城防粮秣。', personalities: ['果断', '敏锐']
    });
    expect(validateOpeningBlueprint(blueprint)).toMatchObject({
      channel: 'male',
      categoryKey: 'male-fantasy-brain',
      auxiliaryCategoryKeys: ['male-game-sports', 'male-history-brain']
    });
  });

  it('拒绝跨频道分类、缺失资料和主要标签数量越界', () => {
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), categoryKey: 'female-modern-brain' })).toThrow('不属于当前频道');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), mainTags: ['穿越'] })).toThrow('2至8个');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), auxiliaryCategoryKeys: ['female-modern-brain'] })).toThrow('不属于当前频道');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), auxiliaryCategoryKeys: ['male-fantasy-brain'] })).toThrow('不能同时作为辅助分类');
    expect(() => validateOpeningBlueprint({
      ...validBlueprint(),
      auxiliaryCategoryKeys: ['male-game-sports', 'male-history-brain', 'male-urban-brain', 'male-scifi-apocalypse']
    })).toThrow('0至3个');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), auxiliaryTags: ['不存在的题材'] })).toThrow('自定义标签');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), storyTraits: ['不存在的特点'] })).toThrow('自定义标签');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), targetAudience: ' ' })).toThrow('目标读者');
    expect(validateOpeningBlueprint({
      ...validBlueprint(),
      protagonists: [],
      worldBackground: '',
      openingBackground: '',
      stageOne: { start: '', development: '', end: '' },
      fullBookOutline: '',
      initialMap: ''
    })).toMatchObject({ protagonists: [], fullBookOutline: '' });
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), fullBookOutline: '长'.repeat(18_000) })).toThrow('资料总量');
  });

  it('新合同只保留一个分类，题材可跨包组合且最多8个', () => {
    const blueprint = validateOpeningBlueprint({
      ...validBlueprint(),
      auxiliaryTags: ['历史古代', '游戏异界']
    });
    expect(blueprint.categoryKey).toBe('male-fantasy-brain');
    expect(blueprint.auxiliaryTags).toEqual(['历史古代', '游戏异界']);
    expect(blueprint.auxiliaryCategoryKeys).toBeUndefined();
    expect(() => validateOpeningBlueprint({
      ...validBlueprint(),
      auxiliaryTags: OPENING_TAXONOMY.subjects.slice(0, 9).map((item) => item.name)
    })).toThrow('0至8个');
  });
});
