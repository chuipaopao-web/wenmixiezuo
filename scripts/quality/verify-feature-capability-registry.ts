import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FEATURE_BASELINE_SNAPSHOTS,
  FEATURE_CAPABILITIES,
  buildFeatureCapabilityView,
  validateFeatureCapabilityRegistry
} from '../../apps/api/src/application/admin/feature-capability-registry.js';

const root = process.cwd();
const errors = validateFeatureCapabilityRegistry((relativePath) => existsSync(resolve(root, relativePath)));
const stable = buildFeatureCapabilityView({ baseline: 'stable-baseline' });
const previous = buildFeatureCapabilityView({ baseline: 'previous-production' });
const lockedBaselineHashes = {
  'previous-production': '8fb55ad52b58666c17d3834ac9e41b64778c531e352c3a6cfcbf50bd3729d9ae',
  'stable-baseline': 'f28c21a4efd32fa3a186691ec14ee4a8ea4c27498d0a209b6faec2f5410287d0'
} as const;
for (const [baseline, expected] of Object.entries(lockedBaselineHashes)) {
  const ids = FEATURE_BASELINE_SNAPSHOTS[baseline as keyof typeof FEATURE_BASELINE_SNAPSHOTS];
  const actual = createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
  if (actual !== expected) errors.push('功能基线发生未登记变化：' + baseline + '。请保留旧能力 ID 并登记迁移、替代或下线决定。');
}

if (FEATURE_CAPABILITIES.length < 100) {
  errors.push('功能台账能力数异常下降：当前只有 ' + FEATURE_CAPABILITIES.length + ' 项，低于初始守恒下限 100。');
}
if (stable.losses.length !== 2) {
  errors.push('早期稳定版疑似遗失清单应为已登记的 2 项，当前为 ' + stable.losses.length + ' 项；请先作出恢复、迁移或下线决定。');
}
if (previous.losses.length !== 0) {
  errors.push('上一生产版本出现未解释能力遗失：' + previous.losses.map((item) => item.id).join(', '));
}
if (errors.length > 0) {
  console.error('功能资产守恒检查失败：');
  for (const error of errors) console.error('- ' + error);
  process.exitCode = 1;
} else {
  console.log('功能资产守恒检查通过：' + stable.summary.modules + ' 个模块，' + FEATURE_CAPABILITIES.length + ' 项能力，2 项历史疑似遗失已登记。');
}
