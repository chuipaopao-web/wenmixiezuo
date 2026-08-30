import { BOOK_TITLE_MAX_CHARACTERS, bookTitleCharacterCount } from '@wenmi/contracts';

export interface V7BookTitleOption {
  text: string;
  note: string;
}

const MIN_OPTIONS = 3;
const MAX_OPTIONS = 8;

/** 解析 V7 书名成员的结构化结果；只接受 3 至 8 个合法、去重的书名。 */
export function parseV7BookTitleOptions(output: string): V7BookTitleOption[] {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* inspect embedded objects below */ }
  for (const value of extractCompleteJsonObjects(output)) {
    try { candidates.push(JSON.parse(value) as unknown); } catch { /* continue */ }
  }
  for (const candidate of candidates) {
    const options = normalizeOptions(candidate);
    if (options !== null) return options;
  }
  throw new Error('输出缺少完整、合法的书名设计JSON。');
}

function normalizeOptions(value: unknown): V7BookTitleOption[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const rawOptions = Array.isArray((value as Record<string, unknown>).options)
    ? (value as Record<string, unknown>).options as unknown[]
    : null;
  if (rawOptions === null) return null;
  const seen = new Set<string>();
  const options: V7BookTitleOption[] = [];
  for (const raw of rawOptions) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.text !== 'string') continue;
    const text = item.text.trim();
    const note = typeof item.note === 'string' ? item.note.trim() : '';
    const characterCount = bookTitleCharacterCount(text);
    if (characterCount < 2 || characterCount > BOOK_TITLE_MAX_CHARACTERS) continue;
    const key = text.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ text, note });
  }
  return options.length < MIN_OPTIONS ? null : options.slice(0, MAX_OPTIONS);
}

function extractCompleteJsonObjects(value: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char !== '}' || depth === 0) continue;
    depth -= 1;
    if (depth === 0 && start >= 0) {
      results.push(value.slice(start, index + 1));
      start = -1;
    }
  }
  return results;
}
