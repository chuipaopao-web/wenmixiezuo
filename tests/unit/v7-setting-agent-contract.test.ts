import { describe, expect, it } from 'vitest';
import {
  V7_SETTING_CATALOG,
  V7_SETTING_MEMBERS,
  activeSettingCatalog,
  buildSettingContextPack,
  compileSettingCatalogRecommendationPrompt,
  compileWriterPrompt,
  deputyNeeded,
  parseChiefReview,
  parseSettingCatalogRecommendation,
  parseWriterProposal,
  projectSettingFinalContent,
  sanitizeAuthorFacingSettingText,
  settingItemByKey,
  validateSettingEditorialRoster
} from '@wenmi/v7-backend';

describe('V7设定Agent合同', () => {
  it('完整目录能按题材扩展，只在作者明确要求查证时召集副编', () => {
    expect(V7_SETTING_CATALOG.length).toBeGreaterThanOrEqual(50);
    expect(activeSettingCatalog('历史脑洞 秦汉三国').map((item) => item.key)).toEqual(expect.arrayContaining(['world-stage', 'history-baseline', 'politics-military']));
    expect(activeSettingCatalog('科幻末世 星际机甲').map((item) => item.key)).toEqual(expect.arrayContaining(['technology-boundary', 'science-cost']));
    expect(deputyNeeded(settingItemByKey('formula')!, '')).toBe(false);
    expect(deputyNeeded(settingItemByKey('formula')!, '请帮我考据这套体系是否合理')).toBe(true);
    expect(deputyNeeded(settingItemByKey('world-stage')!, '')).toBe(false);
  });

  it('禁止项不会反向激活游戏和超凡扩展', () => {
    const forbidden = '不得引入玄幻、修仙、系统等超现实元素；不要游戏和网游设定。';
    const historical = activeSettingCatalog('男频 历史脑洞 秦汉三国 穿越 种田', forbidden).map((item) => item.key);
    expect(historical).toContain('history-baseline');
    expect(historical).toContain('territory');
    expect(historical).not.toContain('game-entry');
    expect(historical).not.toContain('cultivation');
    expect(activeSettingCatalog('男频 游戏电竞 网游', '不使用系统面板').map((item) => item.key)).toContain('game-entry');
    expect(activeSettingCatalog('男频 玄幻 修仙', '').map((item) => item.key)).toContain('cultivation');
  });

  it('主编推荐提示词读取完整资料与完整目录，解析时要求每项只归入一组', () => {
    const catalog = V7_SETTING_CATALOG.map((item) => ({ ...item }));
    const requiredKeys = ['world-stage', 'social-order', 'rules-costs', 'boundaries-blanks', 'history-baseline'];
    const excludedKeys = catalog.map((item) => item.key).filter((key) => !requiredKeys.includes(key));
    const prompt = compileSettingCatalogRecommendationPrompt({
      openingProfile: { category: '历史脑洞', era: '北宋', mustFollow: ['不要系统、不要修仙、不要游戏'] },
      catalog
    });
    expect(prompt).toContain('北宋');
    expect(prompt).toContain('完整设定目录');
    expect(prompt).toContain('否定表达不能反向触发题材');
    expect(prompt).toContain('精简到14项以内');
    expect(parseSettingCatalogRecommendation(JSON.stringify({ requiredKeys, suggestedKeys: [], excludedKeys, summary: '这是一部写实历史穿越文，先把时代规则和历史边界准备清楚。' }), catalog)).toMatchObject({ requiredKeys, suggestedKeys: [] });
    expect(() => parseSettingCatalogRecommendation(JSON.stringify({ requiredKeys, suggestedKeys: ['history-baseline'], excludedKeys, summary: '重复归类' }), catalog)).toThrow(/多个分组/u);
    expect(() => parseSettingCatalogRecommendation(JSON.stringify({ requiredKeys, suggestedKeys: [], excludedKeys: excludedKeys.slice(1), summary: '漏掉条目' }), catalog)).toThrow(/完整整理/u);
    const tooManyRequired = catalog.slice(0, 15).map((item) => item.key);
    const remaining = catalog.map((item) => item.key).filter((key) => !tooManyRequired.includes(key));
    expect(() => parseSettingCatalogRecommendation(JSON.stringify({ requiredKeys: tooManyRequired, suggestedKeys: [], excludedKeys: remaining, summary: '把大量相近条目都列为必做。' }), catalog)).toThrow(/14项以内/u);
  });

  it('资料包冻结范围与来源，输出解析拒绝不完整结构', () => {
    const pack = buildSettingContextPack({ ownerId: 'owner-a', bookId: 'book-a', itemKey: 'world-stage', openingVersion: 2, openingSummary: '三国乱世', confirmedSettings: [], authorNote: '', itemContract: { label: '世界舞台', prompt: '定义时代与空间' }, sources: [{ sourceType: 'opening_profile', sourceId: 'book-a', version: 2, hash: 'a'.repeat(64) }] });
    expect(pack.hash).toHaveLength(64);
    expect(compileWriterPrompt(pack, null)).not.toMatch(/owner-a|book-a|资料包哈希|开书版本/u);
    expect(compileWriterPrompt(pack, null)).toContain('已经确认的开书信息');
    expect(parseWriterProposal(JSON.stringify({ content: '这是足够完整且可用于后续创作的设定正文，包含明确边界和实际条件。', designRationale: '依据开书资料确定方向，避免和现有信息发生冲突。', storyConsequences: ['后续分卷遵守'], dependencies: [], risks: [] })).content).toContain('明确边界');
    expect(parseChiefReview(JSON.stringify({ verdict: 'pass', finalContent: '这是主编审核后的完整设定正文，已经消除冲突，可以供后续蓝图与分卷调用。', summary: '可以使用', issues: [], suggestions: [] })).verdict).toBe('pass');
    expect(() => parseChiefReview('{}')).toThrow();
  });

  it('作者展示只保留大白话结论，内部审计字段仍留在资料包而不进入正文', () => {
    const historical = '本条目冻结当前设定边界，不得擅自修改或突破。账号：owner-local-boss。书籍：v7-book-123456789。开书版本：1。资料包哈希：aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa。所有已确认设定（人物底盘、主线走向）均视为硬约束，不可更改。采用历史基线（history-baseline，revision 2）作为硬红线。设计理由：内部方法说明。';
    expect(projectSettingFinalContent(historical)).toContain('这部分说明已经确定、需要保持一致的内容。已经确认的内容需要保持一致。');
    expect(sanitizeAuthorFacingSettingText(historical)).not.toMatch(/owner-|v7-book-|哈希|硬约束|主线走向|history-baseline|revision|硬红线/u);
  });

  it('设定页只保留三类强模型工位，弱模型不承担设定设计', () => {
    expect(validateSettingEditorialRoster()).toEqual([]);
    expect(V7_SETTING_MEMBERS).toHaveLength(9);
    expect(V7_SETTING_MEMBERS.filter((member) => member.roleKey === 'chief_editor')).toHaveLength(3);
    expect(V7_SETTING_MEMBERS.filter((member) => member.roleKey === 'deputy_editor')).toHaveLength(3);
    const screenwriters = V7_SETTING_MEMBERS.filter((member) => member.roleKey === 'screenwriter');
    expect(screenwriters).toHaveLength(3);
    expect(new Set(screenwriters.map((member) => member.model.modelId))).toEqual(new Set([
      'deepseek-v4-pro',
      'glm-5.3',
      'kimi-k3'
    ]));
    expect(screenwriters.map((member) => member.model.modelId)).not.toContain('doubao-seed-2-0-code');
    expect(V7_SETTING_MEMBERS.find((member) => member.model.modelId === 'kimi-k3')?.model.plan).toBe('agent');
  });
});
