import { describe, expect, it } from 'vitest';
import { BOOK_TITLE_MAX_CHARACTERS, bookTitleCharacterCount, limitBookTitle } from '@wenmi/contracts';

describe('book title contract', () => {
  it('limits titles to 15 Unicode characters without splitting emoji', () => {
    expect(BOOK_TITLE_MAX_CHARACTERS).toBe(15);
    expect(bookTitleCharacterCount('  一二三  ')).toBe(3);
    const limited = limitBookTitle('一二三四五六七八九十一二三四五😀六');
    expect([...limited]).toHaveLength(15);
    expect(limited).toBe('一二三四五六七八九十一二三四五');
  });
});