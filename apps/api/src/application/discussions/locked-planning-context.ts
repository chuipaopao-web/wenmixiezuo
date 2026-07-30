const MAX_LOCKED_DECISION_CONTEXT_CHARS = 900;
const AUTHOR_SUPPLEMENT_MARKER = '老板锁定时补充：';

export function compactLockedDecisionSummary(summary: string): string {
  const normalized = summary.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= MAX_LOCKED_DECISION_CONTEXT_CHARS) return normalized;

  const authorSupplementIndex = normalized.lastIndexOf(AUTHOR_SUPPLEMENT_MARKER);
  if (authorSupplementIndex >= 0) {
    const editorSummary = normalized.slice(0, authorSupplementIndex).trim();
    const authorSupplement = normalized
      .slice(authorSupplementIndex + AUTHOR_SUPPLEMENT_MARKER.length)
      .trim();
    const boundedSupplement = boundAtSentence(authorSupplement, 420);
    const supplementBlock = `${AUTHOR_SUPPLEMENT_MARKER}${boundedSupplement}`;
    const editorBudget = Math.max(
      360,
      MAX_LOCKED_DECISION_CONTEXT_CHARS - supplementBlock.length - 2
    );
    const compactedEditorSummary = compactEditorSummary(editorSummary, editorBudget);
    return `${compactedEditorSummary}\n\n${supplementBlock}`.slice(
      0,
      MAX_LOCKED_DECISION_CONTEXT_CHARS
    );
  }

  return compactEditorSummary(normalized, MAX_LOCKED_DECISION_CONTEXT_CHARS);
}

function compactEditorSummary(normalized: string, maxChars: number): string {
  if (normalized.length <= maxChars) return normalized;
  const blocks = normalized
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const primary = blocks[0] ?? '';
  const keyBasis = blocks.find((block) => block.startsWith('关键依据：')) ?? '';
  const preferred = blocks.find((block) => /优先推荐|推荐方向/u.test(block)) ?? '';
  const compacted = [primary, keyBasis, preferred]
    .filter((block, index, items) => block.length > 0 && items.indexOf(block) === index)
    .join('\n\n');
  const source = compacted.length > 0 ? compacted : normalized;
  if (source.length <= maxChars) return source;

  const omissionNotice = '\n[其余备选论证保留在原讨论证据中，不重复注入章纲资料包]';
  const bounded = source.slice(0, Math.max(1, maxChars - omissionNotice.length));
  const lastBoundary = Math.max(
    bounded.lastIndexOf('\n'),
    bounded.lastIndexOf('。'),
    bounded.lastIndexOf('；')
  );
  return `${bounded.slice(0, lastBoundary >= 200 ? lastBoundary + 1 : bounded.length).trim()}${omissionNotice}`;
}

function boundAtSentence(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const omissionNotice = '……[完整补充保留在老板原话中]';
  const bounded = value.slice(0, Math.max(1, maxChars - omissionNotice.length));
  const lastBoundary = Math.max(
    bounded.lastIndexOf('\n'),
    bounded.lastIndexOf('。'),
    bounded.lastIndexOf('；')
  );
  return `${bounded.slice(0, lastBoundary >= 180 ? lastBoundary + 1 : bounded.length).trim()}${omissionNotice}`;
}

export function compactLockedPlanningScope(scopeText: string): string {
  const normalized = scopeText.replace(/\r\n/g, '\n').trim();
  const marker = '锁定决定：';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return compactLockedDecisionSummary(normalized);
  const prefix = normalized.slice(0, markerIndex + marker.length);
  const decision = normalized.slice(markerIndex + marker.length);
  return `${prefix}${compactLockedDecisionSummary(decision)}`;
}
