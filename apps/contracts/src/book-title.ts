export const BOOK_TITLE_MAX_CHARACTERS = 15;

export function bookTitleCharacterCount(value: string): number {
  return [...value.trim()].length;
}

export function limitBookTitle(value: string): string {
  return [...value].slice(0, BOOK_TITLE_MAX_CHARACTERS).join('');
}