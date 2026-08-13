import { describe, expect, it } from 'vitest';
// The release validator is an executable ESM helper rather than product TypeScript.
// @ts-expect-error no declaration file is required for this test-only helper
import { selectReleaseBook } from '../../scripts/evaluation/lib/release-book-selector.mjs';

describe('release validation book selection', () => {
  const books = [
    { bookId: 'archived-newer', title: '烬脉天衡', status: 'archived', updatedAt: '2026-08-13T12:00:00Z' },
    { bookId: 'active-older', title: '烬脉天衡', status: 'active', updatedAt: '2026-08-13T10:00:00Z' },
    { bookId: 'active-newer', title: '烬脉天衡', status: 'active', updatedAt: '2026-08-13T11:00:00Z' }
  ];

  it('uses an exact book id when the caller supplies one', () => {
    expect(selectReleaseBook(books, 'archived-newer')?.bookId).toBe('archived-newer');
  });

  it('prefers an active book over a newer archived duplicate with the same title', () => {
    expect(selectReleaseBook(books, '烬脉天衡')?.bookId).toBe('active-newer');
  });

  it('uses the most recently updated active duplicate', () => {
    expect(selectReleaseBook(books, '烬脉天衡')?.bookId).toBe('active-newer');
  });

  it('returns undefined for a missing selector', () => {
    expect(selectReleaseBook(books, '不存在')).toBeUndefined();
  });
});
