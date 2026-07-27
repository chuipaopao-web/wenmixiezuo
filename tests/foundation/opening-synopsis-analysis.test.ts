import { describe, expect, it } from 'vitest';
import { OpeningSynopsisAnalysisService } from '../../apps/api/src/application/books/opening-synopsis-analysis-service.js';

const service = new OpeningSynopsisAnalysisService();

describe('开书剧情梗概本地识别', () => {
  it('从带标题的梗概提取基础资料、目录标签和作品边界', () => {
    const synopsis = [
      '书名：北境军报',
      '频道：男频',
      '分类：历史脑洞',
      '男主：陆沉，十八岁，边城驿卒之子，意外得到来自未来的军报。',
      '性格：冷静、果断、有底线',
      '世界观背景：王朝、宗门与边军共同维持脆弱秩序。',
      '故事起始背景：北境失守前夜，驿站收到一封未来军报。',
      '第一阶段起始剧情：陆沉发现军报与现实逐条对应。',
      '第一阶段发展剧情：他借军报救下一城，也暴露了情报来源。',
      '第一阶段结束剧情：守城成功后，他发现军报来自三年后的自己。',
      '全书简介：陆沉阻止王朝覆灭，最终建立新的边境秩序。',
      '初始地图：北境雁回驿及周边三十里。',
      '主要标签：历史、穿越、谋略',
      '辅助题材：架空历史、朝堂江湖',
      '全书特点：群像、成长、智斗',
      '必须遵守：不写后宫、不降智'
    ].join('\n');

    const result = service.analyze({ synopsis });

    expect(result).toMatchObject({
      schemaVersion: 'opening-synopsis-suggestions-v1',
      analysisMode: 'local-deterministic',
      synopsisLength: synopsis.length,
      suggestions: {
        title: '北境军报',
        channel: 'male',
        categoryKey: 'male-history-brain',
        protagonist: {
          role: 'male_lead',
          name: '陆沉',
          age: '十八岁',
          personalities: ['冷静', '果断', '善良有底线']
        },
        worldBackground: '王朝、宗门与边军共同维持脆弱秩序。',
        openingBackground: '北境失守前夜，驿站收到一封未来军报。',
        stageOne: {
          start: '陆沉发现军报与现实逐条对应。',
          development: '他借军报救下一城，也暴露了情报来源。',
          end: '守城成功后，他发现军报来自三年后的自己。'
        },
        fullBookOutline: '陆沉阻止王朝覆灭，最终建立新的边境秩序。',
        initialMap: '北境雁回驿及周边三十里。',
        mainTags: ['历史', '穿越', '谋略'],
        auxiliaryTags: ['架空历史', '历史', '朝堂江湖', '江湖'],
        storyTraits: ['群像', '成长', '智斗'],
        mustFollow: ['不写后宫', '不降智']
      }
    });
    expect(result.unresolvedFields).not.toContain('作品分类');
    expect(result.evidence.length).toBeGreaterThan(8);
  });

  it('自由文本只提取有证据的姓名与目录词，并把原文作为全书简介候选', () => {
    const synopsis = '主角陆沉十八岁，在灵气复苏后的宗门世界修仙。他从外门杂役起步，经历冒险与成长，最终查清师门旧案。';

    const result = service.analyze({ synopsis });

    expect(result.suggestions.protagonist).toMatchObject({ name: '陆沉', age: '十八岁' });
    expect(result.suggestions.fullBookOutline).toBe(synopsis);
    expect(result.suggestions.mainTags).toEqual(expect.arrayContaining(['修仙', '成长', '冒险']));
    expect(result.suggestions.auxiliaryTags).toContain('灵气复苏');
    expect(result.suggestions.categoryKey).toBe('male-eastern-xianxia');
    expect(result.suggestions.channel).toBe('male');
    expect(result.suggestions.worldBackground).toBeNull();
    expect(result.suggestions.stageOne).toEqual({ start: null, development: null, end: null });
  });

  it('信息模糊时保持未识别，不自动编造标题、人物和阶段剧情', () => {
    const synopsis = '一个人在陌生城市开始新的旅程，过去和未来都还没有决定。';

    const result = service.analyze({ synopsis });

    expect(result.suggestions).toMatchObject({
      title: null,
      channel: null,
      categoryKey: null,
      protagonist: null,
      worldBackground: null,
      openingBackground: null,
      stageOne: { start: null, development: null, end: null },
      fullBookOutline: synopsis,
      initialMap: null,
      mainTags: [],
      auxiliaryTags: [],
      storyTraits: [],
      mustFollow: []
    });
    expect(result.unresolvedFields).toContain('作品分类');
    expect(result.unresolvedFields).toContain('初始主角');
  });

  it('不会把超过正式开书字段上限的文本作为候选回填', () => {
    const result = service.analyze({
      synopsis: `书名：${'长'.repeat(121)}\n男主：陆沉，十八岁，${'边'.repeat(2_001)}`
    });

    expect(result.suggestions.title).toBeNull();
    expect(result.suggestions.protagonist).toMatchObject({
      name: '陆沉',
      age: '十八岁',
      background: null
    });
  });

  it('拒绝空内容和超过5000字符，并保证同一输入结果确定', () => {
    expect(() => service.analyze({ synopsis: '   ' })).toThrow('剧情梗概不能为空');
    expect(service.analyze({ synopsis: '长'.repeat(5_000) }).synopsisLength).toBe(5_000);
    expect(() => service.analyze({ synopsis: '长'.repeat(5_001) })).toThrow('不能超过5000');

    const synopsis = '书名：长安簪影\n频道：女频\n分类：现言脑洞\n主角沈簪二十三岁，冷静敏锐，在长安调查一支古簪。';
    expect(service.analyze({ synopsis })).toEqual(service.analyze({ synopsis }));
  });
});
