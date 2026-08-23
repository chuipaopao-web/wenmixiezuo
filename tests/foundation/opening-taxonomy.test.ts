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
    styleIntent: {
      languageTones: ['幽默'], emotionalTones: ['热血'],
      pacingAndPayoff: ['爽点密集'], atmospheres: ['沉浸'], custom: []
    },
    protagonists: [{
      role: 'male_lead', name: '陆沉', age: '十八岁',
      background: '边城驿卒之子，意外得到残缺军功册。',
      personalities: ['冷静', '有底线']
    }],
    storyDirection: '陆沉从边城驿卒之子的处境出发，因未来军报卷入王朝危机；他想阻止北境失守，却必须对抗军中内鬼与被篡改的命令，最终走向重建边境秩序。',
    worldBackground: '王朝、宗门与边军共同维持脆弱秩序。',
    openingBackground: '北境失守前夜，驿站收到一封来自未来的军报。',
    stageOne: {
      start: '陆沉发现军报与现实逐条对应。',
      development: '他借军报救下一城，却暴露情报来源。',
      end: '他守住边城并发现军报来自三年后的自己。'
    },
    fullBookOutline: '主线是阻止王朝覆灭，结局由陆沉建立新的边境秩序。',
    mainTags: ['逆袭', '权谋', '冒险'],
    auxiliaryTags: ['架空历史'],
    storyTraits: ['智斗', '打脸'],
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
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '历史脑洞')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '架空历史')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '朝堂江湖')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '游戏异界')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '东方玄幻')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '东方仙侠')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '重生')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '古典仙侠')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '修真文明')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '幻想修仙')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '秦汉三国')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '两宋元明')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '篮球运动')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '足球运动')).toBe(true);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '副本')).toBe(false);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '排行榜')).toBe(false);
    expect(OPENING_TAXONOMY.subjects.some((item) => item.name === '装备品质')).toBe(false);
    expect(OPENING_TAXONOMY.subjects.length).toBeGreaterThan(50);
    expect(OPENING_TAXONOMY.subjects.length).toBeLessThan(130);
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

  it('接受完整资料、多个主角和不限上限的主要标签', () => {
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

  it('允许不预设固定语言、情绪和节奏调色板', () => {
    const blueprint = validBlueprint();
    blueprint.styleIntent = {
      languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: []
    };
    expect(validateOpeningBlueprint(blueprint).styleIntent).toEqual(blueprint.styleIntent);
  });

  it('主要标签不限数量，可以不选', () => {
    const mainTags = OPENING_TAXONOMY.mainTags.slice(0, 24);
    expect(validateOpeningBlueprint({ ...validBlueprint(), mainTags }).mainTags).toEqual(mainTags);
    expect(validateOpeningBlueprint({ ...validBlueprint(), mainTags: [] }).mainTags).toEqual([]);
  });

  it('拒绝跨频道分类、缺失资料和标签目录外的词', () => {
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), categoryKey: 'female-modern-brain' })).toThrow('不属于当前频道');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), mainTags: ['不存在的标签'] })).toThrow('不在当前目录');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), auxiliaryCategoryKeys: ['female-modern-brain'] })).toThrow('不属于当前频道');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), auxiliaryCategoryKeys: ['male-fantasy-brain'] })).toThrow('不能同时作为辅助分类');
    expect(() => validateOpeningBlueprint({
      ...validBlueprint(),
      auxiliaryCategoryKeys: ['male-game-sports', 'male-history-brain', 'male-urban-brain', 'male-scifi-apocalypse']
    })).toThrow('0至3个');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), auxiliaryTags: ['不存在的题材'] })).toThrow('自定义标签');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), storyTraits: ['不存在的特点'] })).toThrow('自定义标签');
    expect(validateOpeningBlueprint({ ...validBlueprint(), storyDirection: '' }).storyDirection).toBe('');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), storyDirection: '长'.repeat(301) })).toThrow('不能超过300');
    expect(validateOpeningBlueprint({ ...validBlueprint(), targetAudience: ' ' }).targetAudience).toBe('');
    expect(() => validateOpeningBlueprint({
      ...validBlueprint(),
      protagonists: [],
      worldBackground: '',
      openingBackground: '',
      stageOne: { start: '', development: '', end: '' },
      fullBookOutline: '',
      initialMap: ''
    })).toThrow();
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), fullBookOutline: '长'.repeat(18_000) })).toThrow('资料总量');
  });

  it('开局与结局可以独立替代长故事方向，主副基调取自基调目录且不能重复', () => {
    const blueprint = validBlueprint();
    blueprint.storyDirection = '';
    const accepted = validateOpeningBlueprint({
      ...blueprint,
      openingStart: '主角穿越异界成为平民',
      storyEnding: '登基称帝',
      stylePrimary: '爽',
      styleSecondary: '烧脑'
    });
    expect(accepted).toMatchObject({
      openingStart: '主角穿越异界成为平民',
      storyEnding: '登基称帝',
      stylePrimary: '爽',
      styleSecondary: '烧脑'
    });
    expect(OPENING_TAXONOMY.styleTones).toEqual(['爽', '乐', '癫', '暖', '甜', '虐', '烧脑', '诡异', '厚重', '黑']);
    expect(() => validateOpeningBlueprint({ ...blueprint, openingStart: '短' })).toThrow('开局至少需要4个字符');
    const openingOnly = validateOpeningBlueprint({ ...blueprint, openingStart: '主角穿越异界成为平民' });
    expect(openingOnly.openingStart).toBe('主角穿越异界成为平民');
    expect(openingOnly.storyEnding).toBeUndefined();
    const withArc = { ...blueprint, openingStart: '主角穿越异界成为平民', storyEnding: '登基称帝' };
    expect(() => validateOpeningBlueprint({ ...withArc, stylePrimary: '不存在' })).toThrow('主基调不在当前目录');
    expect(() => validateOpeningBlueprint({ ...withArc, stylePrimary: '爽', styleSecondary: '爽' })).toThrow('副基调不能与主基调相同');
    expect(() => validateOpeningBlueprint({ ...withArc, openingStart: '长'.repeat(301) })).toThrow('不能超过300');
    expect(() => validateOpeningBlueprint({ ...withArc, storyEnding: '长'.repeat(301) })).toThrow('不能超过300');
  });

  it('新合同只保留一个分类，题材可跨包组合且最多5个', () => {
    const blueprint = validateOpeningBlueprint({
      ...validBlueprint(),
      auxiliaryTags: ['历史古代', '游戏异界']
    });
    expect(blueprint.categoryKey).toBe('male-fantasy-brain');
    expect(blueprint.auxiliaryTags).toEqual(['历史古代', '游戏异界']);
    expect(blueprint.auxiliaryCategoryKeys).toBeUndefined();
    expect(() => validateOpeningBlueprint({
      ...validBlueprint(),
      auxiliaryTags: OPENING_TAXONOMY.subjects.slice(0, 6).map((item) => item.name)
    })).toThrow('0至5个');
  });
});
