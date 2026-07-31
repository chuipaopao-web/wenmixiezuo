import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseExistingManuscript } from '../../../apps/api/src/application/continuation/existing-manuscript-parser.js';

describe('已有正文确定性章节识别', () => {
  it('识别中文和英文标题并保持正文原文与哈希', () => {
    const source = '\uFEFF第一章 雨夜归来\r\n林昭推开旧门。\r\n\r\nChapter 2 The Debt\r\n账本少了一页。';
    const parsed = parseExistingManuscript(source);
    expect(parsed.normalizedText).toBe('第一章 雨夜归来\n林昭推开旧门。\n\nChapter 2 The Debt\n账本少了一页。');
    expect(parsed.chapters.map((chapter) => chapter.detectedTitle)).toEqual(['第一章 雨夜归来', 'Chapter 2 The Debt']);
    expect(parsed.chapters.map((chapter) => parsed.normalizedText.slice(chapter.contentStart, chapter.contentEnd)))
      .toEqual(['林昭推开旧门。', '账本少了一页。']);
    expect(parsed.chapters[0]?.contentHash).toBe(createHash('sha256').update('林昭推开旧门。').digest('hex'));
    expect(parsed.sourceCharacterCount).toBe(36);
  });

  it('把标题前内容单列为可排除的前言', () => {
    const parsed = parseExistingManuscript('作者的话\n\n第一回 初见\n正文');
    expect(parsed.chapters.map((chapter) => chapter.detectedTitle)).toEqual(['前言', '第一回 初见']);
    expect(parsed.warnings).toContain('首个章节标题前存在正文，已单独列为“前言”；不需要时可以排除。');
  });

  it('没有标题时只给出单章预览而不猜造章节', () => {
    const parsed = parseExistingManuscript('一整段没有章节标题的旧正文。');
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]).toMatchObject({ detectedTitle: '第1章', warnings: ['未识别到章节标题'] });
    expect(parsed.warnings[0]).toContain('没有识别到章节标题');
  });

  it('提示重复标题，交给作者在确认前修改', () => {
    const parsed = parseExistingManuscript('第一章 重逢\n甲。\n第一章 重逢\n乙。');
    expect(parsed.warnings).toEqual(['发现重复标题：第一章 重逢。请在确认前修改。']);
  });
});
