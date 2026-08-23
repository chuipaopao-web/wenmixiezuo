import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FEATURE_CAPABILITIES,
  buildFeatureCapabilityView,
  validateFeatureCapabilityRegistry
} from '../../apps/api/src/application/admin/feature-capability-registry.js';

describe('功能资产守恒注册表', () => {
  it('登记全部模块、稳定能力 ID 和真实代码证据', () => {
    const errors = validateFeatureCapabilityRegistry((path) => existsSync(resolve(process.cwd(), path)));
    expect(errors).toEqual([]);
    expect(FEATURE_CAPABILITIES.length).toBe(130);
    expect(new Set(FEATURE_CAPABILITIES.map((item) => item.id)).size).toBe(FEATURE_CAPABILITIES.length);
  });

  it('上一生产版无遗漏，早期稳定版准确列出两项疑似遗失', () => {
    const previous = buildFeatureCapabilityView({ baseline: 'previous-production' });
    const stable = buildFeatureCapabilityView({ baseline: 'stable-baseline' });
    expect(previous.losses).toEqual([]);
    expect(stable.summary.modules).toBe(33);
    expect(stable.losses.map((item) => item.id)).toEqual([
      'book-branding-title-design',
      'book-branding-synopsis-design'
    ]);
    expect(stable.losses.every((item) => item.currentEntry === null && item.decision && item.recommendation)).toBe(true);
  });

  it('支持状态、模块和关键词筛选并保留全局遗失统计', () => {
    const result = buildFeatureCapabilityView({
      baseline: 'stable-baseline',
      status: 'suspected_missing',
      moduleId: 'opening-profile',
      query: '主编'
    });
    expect(result.summary.statuses.suspected_missing).toBe(2);
    expect(result.summary.filteredCapabilities).toBe(2);
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]?.capabilities).toHaveLength(2);
  });
});
