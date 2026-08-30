import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FEATURE_CAPABILITIES,
  buildFeatureCapabilityView,
  validateFeatureCapabilityRegistry
} from '../../apps/api/src/application/admin/v7-feature-capability-registry.js';
import {
  V7_CUTOVER_ALL_CAPABILITY_IDS,
  V7_CUTOVER_BASELINE_HASHES,
  V7_CUTOVER_KNOWN_MISSING_IDS,
  V7_CUTOVER_PREVIOUS_PRODUCTION_IDS,
  V7_CUTOVER_STABLE_BASELINE_IDS
} from '../../scripts/quality/v7-cutover-capability-baseline.js';

describe('V7 功能切换台账', () => {
  it('保留清理前 130 项审计原哈希，但不把旧能力装入当前台账', () => {
    expect(V7_CUTOVER_ALL_CAPABILITY_IDS).toHaveLength(130);
    expect(V7_CUTOVER_PREVIOUS_PRODUCTION_IDS).toHaveLength(97);
    expect(V7_CUTOVER_STABLE_BASELINE_IDS).toHaveLength(73);
    expect(hash(V7_CUTOVER_ALL_CAPABILITY_IDS)).toBe(V7_CUTOVER_BASELINE_HASHES.all);
    expect(hash(V7_CUTOVER_PREVIOUS_PRODUCTION_IDS)).toBe(V7_CUTOVER_BASELINE_HASHES.previousProduction);
    expect(hash(V7_CUTOVER_STABLE_BASELINE_IDS)).toBe(V7_CUTOVER_BASELINE_HASHES.stableBaseline);
    expect(V7_CUTOVER_KNOWN_MISSING_IDS).toEqual(['book-branding-title-design', 'book-branding-synopsis-design']);
  });

  it('当前台账只含 68 项 V7 能力和真实存在的证据', () => {
    expect(validateFeatureCapabilityRegistry((path) => existsSync(resolve(process.cwd(), path)))).toEqual([]);
    const current = buildFeatureCapabilityView({ baseline: 'stable-baseline' });
    expect(FEATURE_CAPABILITIES).toHaveLength(68);
    expect(current.summary.modules).toBe(14);
    expect(current.summary.currentAvailable).toBe(68);
    expect(current.losses).toEqual([]);
  });

  it('当前台账仍支持模块和关键词筛选', () => {
    const result = buildFeatureCapabilityView({ baseline: 'stable-baseline', status: 'retained', moduleId: 'opening-books', query: '书名' });
    expect(result.summary.filteredCapabilities).toBe(1);
    expect(result.modules[0]?.capabilities.map((item) => item.id)).toEqual(['title-design']);
  });
});

function hash(ids: readonly string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}
