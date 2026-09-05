const BOOK_TITLE_MAX_CHARACTERS = 15;

export type BookCoverTitleSize = 'short' | 'medium' | 'long' | 'extra-long';

export interface BookCoverTitle {
  text: string;
  fullTitle: string;
  size: BookCoverTitleSize;
  truncated: boolean;
}

/** 保留历史书架封面策略；V7 独立实现，不在运行时依赖旧版本。 */
export function bookCoverTitle(sourceTitle: string): BookCoverTitle {
  const fullTitle = sourceTitle.trim() || '未命名新书';
  const characters = [...fullTitle];
  const truncated = characters.length > BOOK_TITLE_MAX_CHARACTERS;
  const visible = truncated
    ? [...characters.slice(0, BOOK_TITLE_MAX_CHARACTERS - 1), '…']
    : characters;
  const length = visible.length;
  const size: BookCoverTitleSize = length <= 4
    ? 'short'
    : length <= 7
      ? 'medium'
      : length <= 10
        ? 'long'
        : 'extra-long';
  return { text: visible.join(''), fullTitle, size, truncated };
}

export function bookCoverTone(bookId: string): number {
  return [...bookId].reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0) % 6;
}

export function bookStatusLabel(status: string): string {
  return ({ active: '创作中', archived: '已归档' } as Record<string, string>)[status] ?? status;
}
