import { describe, expect, it } from 'vitest';
import { bookCoverTone, bookDisplayInfo, bookDisplayTitle } from '../../apps/web/src/app/display-labels';

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

  it('selects a stable portrait-cover tone from the book id', () => {
    expect(bookCoverTone('book-123')).toBe(bookCoverTone('book-123'));
    expect(bookCoverTone('book-123')).toBeGreaterThanOrEqual(0);
    expect(bookCoverTone('book-123')).toBeLessThan(6);
  });
});