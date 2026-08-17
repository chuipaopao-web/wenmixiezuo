import { describe, expect, it } from 'vitest';
import { buildGenreBrief } from '../../apps/api/src/domain/genre-brief.js';

describe('题材简报', () => {
  it('从已确认开书信息组装题材定位，并要求岗位贴合题材', () => {
    const brief = buildGenreBrief(JSON.stringify({
      channel: 'male',
      categoryKey: 'male-urban-martial',
      auxiliaryTags: ['都市', '高武', '升级'],
      mainTags: ['热血', '爽文'],
      storyTraits: ['强冲突'],
      stylePrimary: '爽',
      styleSecondary: '燃',
      styleIntent: { languageTones: [], emotionalTones: [], pacingAndPayoff: ['快兑现'], atmospheres: [], custom: [] },
      targetAudience: '喜欢都市高武的读者'
    }));
    expect(brief).toContain('男频 · 都市高武');
    expect(brief).toContain('融合题材：都市、高武、升级');
    expect(brief).toContain('主要标签：热血、爽文');
    expect(brief).toContain('基调：爽＋燃');
    expect(brief).toContain('节奏策略：快兑现');
    expect(brief).toContain('目标读者：喜欢都市高武的读者');
    expect(brief).toContain('必须贴合上述题材定位');
  });

  it('开书信息缺失或损坏时不编造题材，返回 null', () => {
    expect(buildGenreBrief(null)).toBeNull();
    expect(buildGenreBrief(undefined)).toBeNull();
    expect(buildGenreBrief('not-json')).toBeNull();
    expect(buildGenreBrief('{}')).toBeNull();
    expect(buildGenreBrief(JSON.stringify({ channel: 'male', categoryKey: 'no-such-category' }))).toBeNull();
  });

  it('旧版辅助分类键会解析成分类名称并入融合题材', () => {
    const brief = buildGenreBrief(JSON.stringify({
      channel: 'female',
      categoryKey: 'female-ancient-romance',
      auxiliaryCategoryKeys: ['female-suspense'],
      auxiliaryTags: ['女频衍生'],
      mainTags: [],
      storyTraits: []
    }));
    expect(brief).toContain('女频 · 古代言情');
    expect(brief).toContain('悬疑恋爱');
    expect(brief).toContain('女频衍生');
  });
});
