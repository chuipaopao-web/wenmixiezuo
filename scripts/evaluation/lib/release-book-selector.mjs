function updatedAtOf(book) {
  return String(book.updatedAt ?? book.updated_at ?? '');
}

function bookIdOf(book) {
  return book.bookId ?? book.book_id;
}

export function selectReleaseBook(books, selector) {
  const normalized = String(selector ?? '').trim();
  if (!normalized) return undefined;

  const exactIdMatch = books.find((book) => bookIdOf(book) === normalized);
  if (exactIdMatch !== undefined) return exactIdMatch;

  return books
    .filter((book) => book.title === normalized)
    .sort((left, right) => {
      const activeDifference = Number(right.status === 'active') - Number(left.status === 'active');
      if (activeDifference !== 0) return activeDifference;
      return updatedAtOf(right).localeCompare(updatedAtOf(left));
    })[0];
}
