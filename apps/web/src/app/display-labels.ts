export function bookStatusLabel(status: string): string {
  return ({ active: '创作中', archived: '已归档' } as Record<string, string>)[status] ?? status;
}

export interface BookDisplayInfo {
  title: string;
  qualifier: string | null;
}

/**
 * Internal E2E run keys remain in storage for traceability, but fixture books
 * use clean Chinese titles in author-facing surfaces. Other titles stay exact.
 */
export function bookDisplayInfo(sourceTitle: string): BookDisplayInfo {
  const twentyChapterMatch = /^烬骨问天·二十章全流程-(.+)$/iu.exec(sourceTitle);
  if (twentyChapterMatch !== null) {
    return {
      title: '烬骨问天',
      qualifier: /acceptance/iu.test(twentyChapterMatch[1] ?? '') ? '20章验收测试' : '20章流程测试'
    };
  }

  if (/^雨夜失物招领处·全流程测试-/u.test(sourceTitle)) {
    return { title: '雨夜失物招领处', qualifier: '10章流程测试' };
  }

  return { title: sourceTitle, qualifier: null };
}

export function bookDisplayTitle(sourceTitle: string): string {
  return bookDisplayInfo(sourceTitle).title;
}

export function bookCoverTone(bookId: string): number {
  return [...bookId].reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0) % 6;
}

export function shortId(value: string): string {
  return value.length <= 10 ? value : value.slice(0, 8);
}
