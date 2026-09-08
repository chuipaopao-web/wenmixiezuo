import { describe, expect, it } from 'vitest';
import { settingReferenceLabel } from './setting-reference-label';
const catalog = [{ key: 'education', label: '教育、知识与传承' }];
describe('setting reference labels', () => {
  it('displays known explicit references and exact field keys in Chinese', () => {
    expect(settingReferenceLabel('限制（见education）；参见 education。', catalog)).toBe('限制（见教育、知识与传承）；参见 教育、知识与传承。');
    expect(settingReferenceLabel('education', catalog)).toBe('教育、知识与传承');
  });
  it('preserves unrelated English and unknown references', () => {
    expect(settingReferenceLabel('AI education；见educational；见unknown', catalog)).toBe('AI education；见educational；见unknown');
  });
});
