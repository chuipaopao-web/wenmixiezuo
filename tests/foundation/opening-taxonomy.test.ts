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
    expect(OPENING_TAXONOMY.version).toMatch(/^fanqie-public-map-/u);
    expect(OPENING_TAXONOMY.categories.some((item) => item.channel === 'male' && item.name === '玄幻脑洞')).toBe(true);
    expect(OPENING_TAXONOMY.categories.some((item) => item.channel === 'male' && item.name === '动漫衍生')).toBe(true);
    expect(OPENING_TAXONOMY.categories.some((item) => item.channel === 'female' && item.name === '现言脑洞')).toBe(true);
    expect(OPENING_TAXONOMY.categories.some((item) => item.channel === 'female' && item.name === '古风世情')).toBe(true);
    expect(new Set(OPENING_TAXONOMY.categories.map((item) => item.key)).size).toBe(OPENING_TAXONOMY.categories.length);
    expect(OPENING_TAXONOMY.categories.flatMap((item) => item.recommendedMainTags)
      .filter((tag) => !OPENING_TAXONOMY.mainTags.includes(tag))).toEqual([]);
  });

  it('接受完整资料、多个主角和2至5个主要标签', () => {
    const blueprint = validBlueprint();
    blueprint.protagonists.push({
      role: 'female_lead', name: '谢昭', age: '二十岁',
      background: '北境守将之女，负责城防粮秣。', personalities: ['果断', '敏锐']
    });
    expect(validateOpeningBlueprint(blueprint)).toMatchObject({ channel: 'male', categoryKey: 'male-fantasy-brain' });
  });

  it('拒绝跨频道分类、缺失资料和主要标签数量越界', () => {
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), categoryKey: 'female-modern-brain' })).toThrow('不属于当前频道');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), mainTags: ['穿越'] })).toThrow('2至5个');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), auxiliaryTags: ['不存在的题材'] })).toThrow('自定义标签');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), storyTraits: ['不存在的特点'] })).toThrow('自定义标签');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), initialMap: ' ' })).toThrow('初始地图');
    expect(() => validateOpeningBlueprint({ ...validBlueprint(), fullBookOutline: '长'.repeat(18_000) })).toThrow('资料总量');
  });
});
