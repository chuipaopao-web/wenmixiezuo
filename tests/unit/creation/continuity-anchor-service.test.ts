import { describe, expect, it } from 'vitest';
import {
  buildChapterContinuityAnchors,
  checkChapterContinuityAnchors
} from '../../../apps/api/src/application/creation/continuity-anchor-service.js';

describe('相邻章节稳定事实锚点', () => {
  it('从整章提取中段的带语义字段编号，不依赖章末截取', () => {
    const content = `${'雨夜交接。'.repeat(200)}\n库位编号：B3-07-12。物品编号：FW-2024-0317。\n${'她继续核查。'.repeat(200)}`;

    expect(buildChapterContinuityAnchors(content)).toMatchObject({
      exactFields: {
        库位编号: ['B3-07-12'],
        物品编号: ['FW-2024-0317']
      }
    });
  });

  it('拦截把上一章同一对象的库位编号无解释改成新值', () => {
    const anchors = buildChapterContinuityAnchors('登记类型：物品入库。物品编号：FW-2024-0317。库位编号：B3-07-12。');
    const result = checkChapterContinuityAnchors(
      '这个编号她在系统里见过，就是上一章那条登记。库位编号栏写着D-14，物品编号仍是FW-2024-0317。',
      anchors
    );

    expect(result.passed).toBe(false);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: '库位编号', expected: ['B3-07-12'], actual: ['D-14'] })
    ]));
  });

  it('允许正文明确说明更正、转移或另一件物品', () => {
    const anchors = buildChapterContinuityAnchors('物品编号：FW-2024-0317。库位编号：B3-07-12。');

    expect(checkChapterContinuityAnchors('复核后发现原库位登记有误，现更正为D-14。', anchors).passed).toBe(true);
    expect(checkChapterContinuityAnchors('另一件物品被放入新库位D-14。', anchors).passed).toBe(true);
  });

  it('拦截把临时账号编号无说明地改作物证袋编号', () => {
    const anchors = buildChapterContinuityAnchors('系统创建临时账号：TEMP-0614-02。');
    const result = checkChapterContinuityAnchors(
      '她拿起这件东西，物证袋编号：TEMP-0614-02，仍按上一章的记录继续移交。',
      anchors
    );

    expect(result.passed).toBe(false);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'identifier_kind', expected: ['临时账号'], actual: ['物证袋编号'] })
    ]));
  });

  it('允许同类编号名称变化或正文明确声明跨类沿用', () => {
    const anchors = buildChapterContinuityAnchors('系统创建临时账号：TEMP-0614-02。');

    expect(checkChapterContinuityAnchors('这个账号仍在使用，账号：TEMP-0614-02。', anchors).passed).toBe(true);
    expect(checkChapterContinuityAnchors('封存袋明确沿用临时账号作为编号：TEMP-0614-02。', anchors).passed).toBe(true);
  });
});
