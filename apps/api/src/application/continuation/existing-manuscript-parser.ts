import { createHash } from 'node:crypto';

export const existingManuscriptParserVersion = 'existing-manuscript-parser-v1';

export interface ParsedExistingChapter {
  ordinal: number;
  detectedTitle: string;
  contentStart: number;
  contentEnd: number;
  contentHash: string;
  characterCount: number;
  warnings: string[];
}

export interface ParsedExistingManuscript {
  normalizedText: string;
  sourceHash: string;
  sourceCharacterCount: number;
  warnings: string[];
  chapters: ParsedExistingChapter[];
}

interface HeadingMatch {
  index: number;
  end: number;
  raw: string;
  title: string;
}

const chineseHeading = /^\s*(第\s*[〇零一二三四五六七八九十百千万两\d]+\s*[章回])(?:[：:\s·.、\-—]+(.*?))?\s*$/u;
const englishHeading = /^\s*(chapter\s+\d+)(?:[：:\s·.、\-—]+(.*?))?\s*$/iu;

export function parseExistingManuscript(input: string): ParsedExistingManuscript {
  const normalizedText = input.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').normalize('NFC');
  if (normalizedText.trim().length === 0) throw new Error('已有正文不能为空');
  const sourceHash = hash(normalizedText);
  const headings = findHeadings(normalizedText);
  const warnings: string[] = [];
  const chapters: ParsedExistingChapter[] = [];

  if (headings.length === 0) {
    const range = trimRange(normalizedText, 0, normalizedText.length);
    warnings.push('没有识别到章节标题，已作为单章预览；请确认后再导入。');
    chapters.push(buildChapter(1, '第1章', range.start, range.end, normalizedText, ['未识别到章节标题']));
  } else {
    const preface = trimRange(normalizedText, 0, headings[0]!.index);
    if (preface.end > preface.start) {
      warnings.push('首个章节标题前存在正文，已单独列为“前言”；不需要时可以排除。');
      chapters.push(buildChapter(chapters.length + 1, '前言', preface.start, preface.end, normalizedText, ['章节标题前的内容']));
    }
    for (let index = 0; index < headings.length; index += 1) {
      const heading = headings[index]!;
      const next = headings[index + 1];
      const range = trimRange(normalizedText, heading.end, next?.index ?? normalizedText.length);
      const chapterWarnings: string[] = [];
      if (range.end <= range.start) chapterWarnings.push('本章没有正文');
      chapters.push(buildChapter(chapters.length + 1, heading.title, range.start, range.end, normalizedText, chapterWarnings));
    }
  }

  const duplicateTitles = new Set<string>();
  const seen = new Set<string>();
  for (const chapter of chapters) {
    const key = chapter.detectedTitle.trim().toLocaleLowerCase('zh-CN');
    if (seen.has(key)) duplicateTitles.add(chapter.detectedTitle);
    seen.add(key);
  }
  if (duplicateTitles.size > 0) warnings.push(`发现重复标题：${[...duplicateTitles].join('、')}。请在确认前修改。`);
  return {
    normalizedText,
    sourceHash,
    sourceCharacterCount: countCharacters(normalizedText),
    warnings,
    chapters
  };
}

function findHeadings(text: string): HeadingMatch[] {
  const matches: HeadingMatch[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    const chineseMatch = line.match(chineseHeading);
    const match = chineseMatch ?? line.match(englishHeading);
    if (match !== null) {
      const prefix = chineseMatch === null ? match[1]!.trim().replace(/\s+/gu, ' ') : match[1]!.replace(/\s+/gu, '');
      const suffix = match[2]?.trim();
      matches.push({
        index: lineStart,
        end: Math.min(text.length, lineEnd + (lineEnd < text.length ? 1 : 0)),
        raw: line,
        title: suffix === undefined || suffix.length === 0 ? prefix : `${prefix} ${suffix}`
      });
    }
    offset = lineEnd + 1;
  }
  return matches;
}

function trimRange(text: string, start: number, end: number): { start: number; end: number } {
  while (start < end && /\s/u.test(text[start]!)) start += 1;
  while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;
  return { start, end };
}

function buildChapter(
  ordinal: number,
  detectedTitle: string,
  contentStart: number,
  contentEnd: number,
  text: string,
  warnings: string[]
): ParsedExistingChapter {
  const content = text.slice(contentStart, contentEnd);
  return {
    ordinal,
    detectedTitle,
    contentStart,
    contentEnd,
    contentHash: hash(content),
    characterCount: countCharacters(content),
    warnings
  };
}

export function countCharacters(content: string): number {
  return [...content].filter((character) => !/\s/u.test(character)).length;
}

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
