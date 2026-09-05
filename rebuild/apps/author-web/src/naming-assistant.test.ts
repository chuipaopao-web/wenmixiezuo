import { describe, expect, it } from 'vitest';
import {
  NAMING_TARGET_GROUPS,
  generateNamingCandidates,
  recommendCharacterTarget
} from './naming-assistant';

const gameHistoryContext = {
  channel: 'male' as const,
  category: '游戏体育',
  subjects: ['游戏异界', '历史脑洞'],
  tags: ['热血', '升级', '经营'],
  storyDirection: '主角进入历史游戏世界，从一座边城开始经营领地。'
};

describe('本地取名助手', () => {
  it('覆盖六组独立细分类，不能把命名规则不同的类型合并展示', () => {
    expect(NAMING_TARGET_GROUPS.map((group) => group.label)).toEqual([
      '人物', '地点', '势力', '物品', '生灵', '能力'
    ]);

    const labels = NAMING_TARGET_GROUPS.flatMap((group) => group.targets.map((target) => target.label));
    expect(labels.length).toBeGreaterThanOrEqual(110);
    expect(labels).toEqual(expect.arrayContaining([
      '男性人物', '女性人物', '人工智能', '机器人', '仿生人', '器灵', '精怪', '妖族', '异族', '神明', '亡灵',
      '山脉', '山峰', '江河', '溪流', '湖泊', '海域', '村庄', '城镇', '都城',
      '宗门', '门派', '家族', '氏族', '王朝', '帝国', '公会', '冒险团',
      '药剂', '丹药', '毒物', '法宝', '神器', '武器', '防具', '饰品',
      '陆地坐骑', '飞行坐骑', '水域坐骑', '机械坐骑', '灵兽', '神兽', '契约兽',
      '元素魔法', '奥术', '禁咒', '主动技能', '被动技能', '功法', '心法', '武技', '天赋'
    ]));
    expect(labels).not.toEqual(expect.arrayContaining([
      '非人角色', '湖海', '王朝与国家', '药品与丹药', '血脉与体质', '职业与序列'
    ]));
  });

  it('人工智能、器灵和精怪使用独立目录与独立候选语感', () => {
    const ai = generateNamingCandidates({ targetId: 'character-ai', context: gameHistoryContext, count: 8 });
    const artifactSpirit = generateNamingCandidates({ targetId: 'character-artifact-spirit', context: gameHistoryContext, count: 8 });
    const sprite = generateNamingCandidates({ targetId: 'character-sprite', context: gameHistoryContext, count: 8 });

    expect(ai).toHaveLength(8);
    expect(artifactSpirit).toHaveLength(8);
    expect(sprite).toHaveLength(8);
    expect(ai.map((candidate) => candidate.name)).not.toEqual(artifactSpirit.map((candidate) => candidate.name));
    expect(artifactSpirit.map((candidate) => candidate.name)).not.toEqual(sprite.map((candidate) => candidate.name));
    expect(ai.every((candidate) => candidate.note.includes('人工智能'))).toBe(true);
    expect(artifactSpirit.every((candidate) => candidate.note.includes('器灵'))).toBe(true);
    expect(sprite.every((candidate) => candidate.note.includes('精怪'))).toBe(true);
  });

  it('每个前端可见细分类都有唯一标识并能生成候选', () => {
    const targets = NAMING_TARGET_GROUPS.flatMap((group) => group.targets);
    expect(new Set(targets.map((target) => target.id)).size).toBe(targets.length);
    for (const target of targets) {
      const candidates = generateNamingCandidates({
        targetId: target.id,
        context: gameHistoryContext,
        count: 4
      });
      expect(candidates, `${target.label}（${target.id}）没有可用候选`).toHaveLength(4);
    }
  });

  it('同一批次可复现，换一批会变化，并排除已有名称和重复候选', () => {
    const first = generateNamingCandidates({
      targetId: 'character-male', context: gameHistoryContext, count: 12, batch: 0,
      exclude: ['林舟']
    });
    const repeated = generateNamingCandidates({
      targetId: 'character-male', context: gameHistoryContext, count: 12, batch: 0,
      exclude: ['林舟']
    });
    const next = generateNamingCandidates({
      targetId: 'character-male', context: gameHistoryContext, count: 12, batch: 1,
      exclude: ['林舟']
    });

    expect(first).toEqual(repeated);
    expect(next.map((candidate) => candidate.name)).not.toEqual(first.map((candidate) => candidate.name));
    expect(new Set(first.map((candidate) => candidate.name)).size).toBe(first.length);
    expect(first.some((candidate) => candidate.name === '林舟')).toBe(false);
    expect(first.every((candidate) => candidate.status === 'candidate')).toBe(true);
  });

  it('不同题材语境会改变候选风格，但仍只是候选', () => {
    const xianxia = generateNamingCandidates({
      targetId: 'faction-sect',
      context: { category: '仙侠', subjects: ['古典仙侠'], tags: ['修仙', '宗门'] },
      count: 8,
      batch: 0
    });
    const scienceFiction = generateNamingCandidates({
      targetId: 'faction-sect',
      context: { category: '科幻末世', subjects: ['星际文明'], tags: ['未来', '机甲'] },
      count: 8,
      batch: 0
    });

    expect(xianxia.map((candidate) => candidate.name)).not.toEqual(scienceFiction.map((candidate) => candidate.name));
    expect(xianxia.every((candidate) => candidate.note.length > 0)).toBe(true);
    expect(scienceFiction.every((candidate) => candidate.status === 'candidate')).toBe(true);
  });

  it('按开书角色身份推荐正确的人物命名目标', () => {
    expect(recommendCharacterTarget('male_lead')).toBe('character-male');
    expect(recommendCharacterTarget('female_lead')).toBe('character-female');
    expect(recommendCharacterTarget('co_lead')).toBe('character-neutral');
    expect(recommendCharacterTarget('ensemble')).toBe('character-neutral');
    expect(recommendCharacterTarget('non_human')).toBe('character-neutral');
  });

  it('补充的字数和题材语感会真正改变人物候选', () => {
    const twoCharacters = generateNamingCandidates({
      targetId: 'character-female',
      context: { category: '都市日常' },
      hint: '两个字',
      count: 8
    });
    const western = generateNamingCandidates({
      targetId: 'character-female',
      context: { category: '都市日常' },
      hint: '西幻语感',
      count: 8
    });

    expect(twoCharacters).toHaveLength(8);
    expect(twoCharacters.every((candidate) => [...candidate.name].length === 2)).toBe(true);
    expect(western.every((candidate) => candidate.style === 'western')).toBe(true);
  });
});

