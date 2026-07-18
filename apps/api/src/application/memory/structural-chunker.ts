import type { ChunkPolicy, StructuralChunk, StructuralChunkResult, StructuralParentNode } from '../../contracts/projections.js';
import { DEFAULT_CHUNK_POLICY, validateChunkPolicy } from './chunk-policy.js';

interface CharacterRange { start: number; end: number; paragraph: number }

export class StructuralChunker {
  public constructor(private readonly policy: ChunkPolicy = DEFAULT_CHUNK_POLICY) {
    validateChunkPolicy(policy);
  }

  public chunk(source: string): StructuralChunkResult {
    const normalized = source.normalize('NFC');
    if (normalized !== source) throw new Error('来源必须先以NFC规范化并固定哈希，切片器不会静默改写原文');
    const paragraphRanges = findParagraphs(source);
    const pieces = paragraphRanges.flatMap((range) => splitLongRange(source, range, this.policy));
    const merged = mergeSmallRanges(source, pieces, this.policy.maximumLeafCharacters);
    const parents = groupParents(source, merged, this.policy.maximumParentCharacters);
    const chunks: StructuralChunk[] = merged.map((range, ordinal) => ({
      ordinal,
      characterStart: range.start,
      characterEnd: range.end,
      byteStart: byteOffset(source, range.start),
      byteEnd: byteOffset(source, range.end),
      paragraphStart: range.paragraph,
      paragraphEnd: range.paragraph,
      content: source.slice(range.start, range.end),
      parentOrdinal: parents.find((parent) => parent.childOrdinals.includes(ordinal))!.ordinal,
      previousOrdinal: ordinal === 0 ? null : ordinal - 1,
      nextOrdinal: ordinal === merged.length - 1 ? null : ordinal + 1,
      narrativeMode: detectNarrativeMode(source.slice(range.start, range.end)),
      boundaryConfidence: 1
    }));
    const occupied = chunks.map((chunk) => ({ byteStart: chunk.byteStart, byteEnd: chunk.byteEnd }));
    return {
      policy: this.policy,
      sourceBytes: Buffer.byteLength(source, 'utf8'),
      chunks,
      parents: parents.map((parent): StructuralParentNode => ({
        ordinal: parent.ordinal,
        byteStart: byteOffset(source, merged[parent.childOrdinals[0]!]!.start),
        byteEnd: byteOffset(source, merged[parent.childOrdinals.at(-1)!]!.end),
        childOrdinals: parent.childOrdinals
      })),
      excludedSeparatorRanges: invertRanges(occupied, Buffer.byteLength(source, 'utf8'))
    };
  }
}

function findParagraphs(source: string): CharacterRange[] {
  const result: CharacterRange[] = [];
  const delimiter = /\r?\n[ \t]*\r?\n/gu;
  let start = 0;
  let paragraph = 0;
  const push = (rawStart: number, rawEnd: number) => {
    let left = rawStart;
    let right = rawEnd;
    while (left < right && /\s/u.test(source[left]!)) left += 1;
    while (right > left && /\s/u.test(source[right - 1]!)) right -= 1;
    if (left < right) result.push({ start: left, end: right, paragraph });
    paragraph += 1;
  };
  for (const match of source.matchAll(delimiter)) {
    push(start, match.index!);
    start = match.index! + match[0].length;
  }
  push(start, source.length);
  return result;
}

function splitLongRange(source: string, range: CharacterRange, policy: ChunkPolicy): CharacterRange[] {
  const text = source.slice(range.start, range.end);
  if ([...text].length <= policy.maximumLeafCharacters) return [range];
  const result: CharacterRange[] = [];
  let segmentStart = range.start;
  let count = 0;
  let preferredCut: number | null = null;
  for (let index = range.start; index < range.end;) {
    const codePoint = source.codePointAt(index)!;
    const character = String.fromCodePoint(codePoint);
    index += character.length;
    count += 1;
    if (/[。！？!?；;]/u.test(character) && count >= policy.targetLeafCharacters) preferredCut = index;
    if (count >= policy.maximumLeafCharacters) {
      const cut = preferredCut !== null && preferredCut > segmentStart ? preferredCut : index;
      result.push(trimRange(source, { start: segmentStart, end: cut, paragraph: range.paragraph }));
      segmentStart = cut;
      count = [...source.slice(segmentStart, index)].length;
      preferredCut = null;
    }
  }
  if (segmentStart < range.end) result.push(trimRange(source, { start: segmentStart, end: range.end, paragraph: range.paragraph }));
  return result.filter((item) => item.start < item.end);
}

function mergeSmallRanges(source: string, ranges: CharacterRange[], maximum: number): CharacterRange[] {
  const result: CharacterRange[] = [];
  for (const range of ranges) {
    const previous = result.at(-1);
    if (previous !== undefined && [...source.slice(previous.start, range.end)].length <= maximum) {
      previous.end = range.end;
      continue;
    }
    result.push({ ...range });
  }
  return result;
}

function groupParents(source: string, leaves: CharacterRange[], maximum: number): Array<{ ordinal: number; childOrdinals: number[] }> {
  const parents: Array<{ ordinal: number; childOrdinals: number[] }> = [];
  for (let index = 0; index < leaves.length; index += 1) {
    const current = parents.at(-1);
    const candidateStart = current === undefined ? leaves[index]!.start : leaves[current.childOrdinals[0]!]!.start;
    if (current === undefined || [...source.slice(candidateStart, leaves[index]!.end)].length > maximum) {
      parents.push({ ordinal: parents.length, childOrdinals: [index] });
    } else {
      current.childOrdinals.push(index);
    }
  }
  return parents;
}

function trimRange(source: string, range: CharacterRange): CharacterRange {
  while (range.start < range.end && /\s/u.test(source[range.start]!)) range.start += 1;
  while (range.end > range.start && /\s/u.test(source[range.end - 1]!)) range.end -= 1;
  return range;
}

function byteOffset(source: string, characterOffset: number): number {
  return Buffer.byteLength(source.slice(0, characterOffset), 'utf8');
}

function invertRanges(ranges: Array<{ byteStart: number; byteEnd: number }>, total: number): Array<{ byteStart: number; byteEnd: number }> {
  const result: Array<{ byteStart: number; byteEnd: number }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.byteStart > cursor) result.push({ byteStart: cursor, byteEnd: range.byteStart });
    cursor = range.byteEnd;
  }
  if (cursor < total) result.push({ byteStart: cursor, byteEnd: total });
  return result;
}

function detectNarrativeMode(content: string): StructuralChunk['narrativeMode'] {
  if (/梦见|梦中|梦境/u.test(content)) return 'dream';
  if (/回忆|想起|记得那年/u.test(content)) return 'memory';
  if (/如果|假如|倘若/u.test(content)) return 'counterfactual';
  if (/计划|打算|准备/u.test(content)) return 'plan';
  const dialogueMarks = (content.match(/[“”「」]/gu) ?? []).length;
  if (dialogueMarks >= 2 && dialogueMarks * 8 >= [...content].length) return 'dialogue_claim';
  return 'current';
}
