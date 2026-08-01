import { describe, expect, it } from 'vitest';
import {
  NAMING_TARGET_GROUPS,
  generateNamingCandidates,
  recommendCharacterTarget
} from '../../apps/web/src/app/naming-assistant';

const gameHistoryContext = {
  channel: 'male' as const,
  category: '游戏体育',
  subjects: ['游戏异界', '历史脑洞'],
  tags: ['热血', '升级', '经营'],
  storyDirection: '主角进入历史游戏世界，从一座边城开始经营领地。'
};

describe('本地取名助手', () => {
  it('覆盖人物、地点、势力、物品、生灵和能力六组常用命名目标', () => {
    expect(NAMING_TARGET_GROUPS.map((group) => group.label)).toEqual([
      '人物', '地点', '势力', '物品', '生灵', '能力'
    ]);

    const labels = NAMING_TARGET_GROUPS.flatMap((group) => group.targets.map((target) => target.label));
    expect(labels).toEqual(expect.arrayContaining([
      '男性人物', '女性人物', '非人角色', '山岳', '江河', '湖海', '村庄', '城镇', '都城',
      '宗门', '家族', '王朝与国家', '公会', '道具', '药品与丹药', '法宝', '武器',
      '坐骑', '灵兽', '魔物', '魔法', '技能', '功法', '武技', '天赋'
    ]));
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
    expect(recommendCharacterTarget('non_human')).toBe('character-nonhuman');
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
