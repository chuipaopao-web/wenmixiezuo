import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { emptyOpeningPackage, validateManualOpening } from './ManualOpeningForm';

// OPENING-UI-02返修R1：手动开书字数合同按作品类型校验——短篇1万字不再被强制10万字下限；
// 范围校验保留、长篇旧合同不放宽、缺省类型按长篇兼容。
function wordErrors(workType: 'novel' | 'short_story' | 'memoir' | 'script', expectedTotalWords: number): string[] {
  const value = emptyOpeningPackage();
  value.positioning.expectedTotalWords = expectedTotalWords;
  return validateManualOpening(value, null, workType).stepOne.filter((item) => item.includes('预计总字数'));
}

describe('R1 手动开书字数合同按作品类型', () => {
  it('短篇小说：1千字至10万字通过，范围外拒绝且文案按类型', () => {
    expect(wordErrors('short_story', 1_000)).toEqual([]);
    expect(wordErrors('short_story', 10_000)).toEqual([]);
    expect(wordErrors('short_story', 100_000)).toEqual([]);
    expect(wordErrors('short_story', 999)).toEqual(['预计总字数需在1000至10万字之间']);
    expect(wordErrors('short_story', 100_001)).toEqual(['预计总字数需在1000至10万字之间']);
  });

  it('个人自传与影视剧本：各自容量范围生效', () => {
    expect(wordErrors('memoir', 80_000)).toEqual([]);
    expect(wordErrors('memoir', 9_999)).toEqual(['预计总字数需在1万至200万字之间']);
    expect(wordErrors('memoir', 2_000_001)).toEqual(['预计总字数需在1万至200万字之间']);
    expect(wordErrors('script', 60_000)).toEqual([]);
    expect(wordErrors('script', 4_999)).toEqual(['预计总字数需在5000至200万字之间']);
    expect(wordErrors('script', 2_000_001)).toEqual(['预计总字数需在5000至200万字之间']);
  });

  it('长篇旧合同不放宽：缺省类型保持10万至1000万字', () => {
    expect(wordErrors('novel', 100_000)).toEqual([]);
    expect(wordErrors('novel', 3_000_000)).toEqual([]);
    expect(wordErrors('novel', 99_999)).toEqual(['预计总字数需在10万至1000万字之间']);
    // 旧调用不传类型参数：按长篇兼容。
    const value = emptyOpeningPackage();
    value.positioning.expectedTotalWords = 10_000;
    expect(validateManualOpening(value, null).stepOne.some((item) => item === '预计总字数需在10万至1000万字之间')).toBe(true);
  });
});
