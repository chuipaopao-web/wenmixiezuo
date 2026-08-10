import { describe, expect, it } from 'vitest';
import { bookCoverTitle, bookCoverTone, bookDisplayInfo, bookDisplayTitle } from '../../apps/web/src/app/display-labels';

describe('author-facing book labels', () => {
  it('hides only known E2E run keys and keeps the test copies distinguishable', () => {
    expect(bookDisplayInfo('烬骨问天·二十章全流程-xianxia-20-final')).toEqual({
      title: '烬骨问天',
      qualifier: '20章流程测试'
    });
    expect(bookDisplayInfo('烬骨问天·二十章全流程-xianxia-20-acceptance')).toEqual({
      title: '烬骨问天',
      qualifier: '20章验收测试'
    });
    expect(bookDisplayTitle('雨夜失物招领处·全流程测试-v1-2026-08-01')).toBe('雨夜失物招领处');
  });

  it('never rewrites an author-created title', () => {
    const title = '我的-xianxia-20-final-不是测试书';
    expect(bookDisplayInfo(title)).toEqual({ title, qualifier: null });
  });

  it('keeps the complete title on fixed covers and shrinks the font in four tiers', () => {
    expect(bookCoverTitle('烬骨问天')).toMatchObject({ text: '烬骨问天', size: 'short', truncated: false });
    expect(bookCoverTitle('一二三四五六七')).toMatchObject({ size: 'medium', truncated: false });
    expect(bookCoverTitle('一二三四五六七八九十')).toMatchObject({ size: 'long', truncated: false });
    expect(bookCoverTitle('一二三四五六七八九十一二三四五')).toMatchObject({
      text: '一二三四五六七八九十一二三四五', size: 'extra-long', truncated: false
    });
    const legacy = bookCoverTitle('一二三四五六七八九十一二三四五六七');
    expect([...legacy.text]).toHaveLength(15);
    expect(legacy.text.endsWith('…')).toBe(true);
    expect(legacy.fullTitle).toBe('一二三四五六七八九十一二三四五六七');
    expect(legacy.truncated).toBe(true);
  });
  it('selects a stable portrait-cover tone from the book id', () => {
    expect(bookCoverTone('book-123')).toBe(bookCoverTone('book-123'));
    expect(bookCoverTone('book-123')).toBeGreaterThanOrEqual(0);
    expect(bookCoverTone('book-123')).toBeLessThan(6);
  });
});