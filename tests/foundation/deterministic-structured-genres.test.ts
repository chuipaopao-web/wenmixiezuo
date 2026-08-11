import { describe, expect, it } from 'vitest';
import {
  buildGameXianxiaNovel, buildLordNovel, structuredGenreFactCandidates
} from '../../apps/api/src/infrastructure/models/deterministic-structured-genre-scenarios.js';
import { countNovelCharacters } from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
// @ts-expect-error Runtime acceptance scenarios are maintained as executable ESM fixtures.
import { requireWorkflowScenario } from '../../scripts/evaluation/current-workflow-scenarios.mjs';

describe('结构化题材百章确定性夹具', () => {
  it('游戏仙侠百章保留职业、人物与灵宠双面板、战斗消耗和十事件差异', () => {
    const chapters = Array.from({ length: 100 }, (_, index) => buildGameXianxiaNovel('game-book', index + 1, `游戏仙侠第${index + 1}章`));
    expect(chapters.every((chapter) => countNovelCharacters(chapter) >= 2_780 && countNovelCharacters(chapter) <= 3_500)).toBe(true);
    const whole = chapters.join('\n');
    for (const text of ['陆昭','霜尾','御灵剑使','人物状态','灵宠状态','星痕剑阵','赤月剑匣','天门核心']) expect(whole).toContain(text);
    for (const leaked of ['沈砚','顾野','顾临川','林澈','铜钥匙']) expect(whole).not.toContain(leaked);
    expect(new Set(chapters.map((chapter) => chapter.match(/沿([^石外]+(?:广场|矿洞|竞技场|遗迹|榜塔|副本|边境城|根域|公审台|核心))/u)?.[1] ?? chapter.slice(0, 40))).size).toBeGreaterThan(8);
    expect(maxAdjacentSimilarity(chapters)).toBeLessThanOrEqual(0.88);
    let previous = { body:0, spirit:0, agility:0, petPower:0, petSpeed:0 };
    chapters.forEach((chapter, index) => {
      const paragraphs = chapter.split(/\n\n+/u).map((item) => item.trim()).filter(Boolean);
      expect(new Set(paragraphs).size).toBe(paragraphs.length);
      expect(chapter).not.toMatch(/后台奖励|系统不允许|本章要完成/u);
      expect(paragraphs.length).toBeGreaterThan(20);
      const hero = chapter.match(/职业等级\d+级，体魄(\d+)，灵识(\d+)，敏捷(\d+)/u)!;
      const pet = chapter.match(/灵宠等级\d+级，力量(\d+)，速度(\d+)/u)!;
      const current = {
        body:Number(hero[1]), spirit:Number(hero[2]), agility:Number(hero[3]),
        petPower:Number(pet[1]), petSpeed:Number(pet[2])
      };
      for (const key of Object.keys(previous) as Array<keyof typeof previous>) expect(current[key]).toBeGreaterThanOrEqual(previous[key]);
      previous = current;
      if (index + 1 < 40) {
        expect(chapter).not.toContain('已掌握星痕剑阵');
        expect(chapter).toContain('已掌握御灵基础剑式');
      }
      if (index + 1 < 60) {
        expect(chapter).not.toContain('已装备赤月剑匣');
        expect(chapter).toContain('已装备青铜灵剑');
      }
    });
    expect(chapters.slice(0, 9).every((chapter) => !chapter.includes('职业公会要求二人进入灰晶矿洞登记'))).toBe(true);
    expect(chapters[9]).toContain('职业公会要求二人进入灰晶矿洞登记');
    expect(chapters[0]).toContain('没有假装知道来源');
    expect(chapters[0]).not.toContain('前一事件实际经历');
    const facts = structuredGenreFactCandidates(chapters[9]!);
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectName:'陆昭', relationKey:'identity', value:'御灵剑使' }),
      expect.objectContaining({ subjectName:'霜尾', relationKey:'attributes' }),
      expect.objectContaining({ subjectName:'陆昭人物属性面板', entityType:'stat_panel' }),
      expect.objectContaining({ subjectName:'霜尾灵宠属性面板', entityType:'stat_panel' })
    ]));
  });

  it('领主百章资源期初与上章期末连续，并保留领地、武将、建筑和升级成本', () => {
    const chapters = Array.from({ length: 100 }, (_, index) => buildLordNovel('lord-book', index + 1, `领主经营第${index + 1}章`));
    expect(chapters.every((chapter) => countNovelCharacters(chapter) >= 2_780 && countNovelCharacters(chapter) <= 3_500)).toBe(true);
    const whole = chapters.join('\n');
    for (const text of ['顾临川','灰烬领','领地等级','资源产出','岳重山武将属性','建筑面板','升级消耗规划','黑旗伯']) expect(whole).toContain(text);
    for (const leaked of ['陆昭','霜尾','沈砚','顾野','林澈','铜钥匙']) expect(whole).not.toContain(leaked);
    expect(maxAdjacentSimilarity(chapters)).toBeLessThanOrEqual(0.88);
    let previousAfter: number[] | null = null;
    for (const chapter of chapters) {
      const paragraphs = chapter.split(/\n\n+/u).map((item) => item.trim()).filter(Boolean);
      expect(new Set(paragraphs).size).toBe(paragraphs.length);
      expect(chapter).not.toMatch(/后台奖励|系统不允许|本章要完成/u);
      expect(paragraphs.length).toBeGreaterThan(20);
      const line = chapter.split(/\r?\n/u).find((item) => item.startsWith('资源结算：'))!;
      const before = [...line.matchAll(/期初粮食(\d+)份、木材(\d+)份、石料(\d+)份、铁矿(\d+)份、灵晶(\d+)枚/gu)][0]!.slice(1).map(Number);
      const after = [...line.matchAll(/期末库存分别为(\d+)份、(\d+)份、(\d+)份、(\d+)份和(\d+)枚/gu)][0]!.slice(1).map(Number);
      if (previousAfter !== null) expect(before).toEqual(previousAfter);
      expect(after.every((value) => value >= 0)).toBe(true);
      previousAfter = after;
    }
    const facts = structuredGenreFactCandidates(chapters[99]!);
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectName:'灰烬领', relationKey:'leader', value:'顾临川' }),
      expect.objectContaining({ subjectName:'岳重山', relationKey:'attributes' }),
      expect.objectContaining({ subjectName:'粮食', entityType:'resource' }),
      expect.objectContaining({ subjectName:'北门城墙', entityType:'item' }),
      expect.objectContaining({ subjectName:'灰烬领经营面板', entityType:'stat_panel' })
    ]));
  });

  it('两个新场景都注册为十事件百章对象链', () => {
    for (const key of ['game_xianxia','lord']) {
      const scenario = requireWorkflowScenario(key);
      expect(scenario.events).toHaveLength(10);
      expect(scenario.events.every((event: { estimatedChapterRange: { likely: number } }) => event.estimatedChapterRange.likely === 10)).toBe(true);
      expect(scenario.bookTitle.length).toBeLessThanOrEqual(15);
    }
  });
});

function maxAdjacentSimilarity(chapters: string[]): number {
  let maximum = 0;
  for (let index = 1; index < chapters.length; index += 1) {
    const tokens = (text: string) => new Set(text.replace(/\s+/gu, '').match(/.{1,12}/gu) ?? []);
    const left = tokens(chapters[index - 1]!);
    const right = tokens(chapters[index]!);
    let intersection = 0;
    for (const token of left) if (right.has(token)) intersection += 1;
    maximum = Math.max(maximum, intersection / Math.max(1, new Set([...left, ...right]).size));
  }
  return maximum;
}
