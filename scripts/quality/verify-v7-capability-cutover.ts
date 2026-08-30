import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
} from './v7-cutover-capability-baseline.js';

const errors = validateFeatureCapabilityRegistry((path) => existsSync(resolve(process.cwd(), path)));
const current = buildFeatureCapabilityView({ baseline: 'stable-baseline' });

assertFrozen('清理前全部能力', V7_CUTOVER_ALL_CAPABILITY_IDS, 130, V7_CUTOVER_BASELINE_HASHES.all);
assertFrozen('清理前上一生产基线', V7_CUTOVER_PREVIOUS_PRODUCTION_IDS, 97, V7_CUTOVER_BASELINE_HASHES.previousProduction);
assertFrozen('清理前稳定基线', V7_CUTOVER_STABLE_BASELINE_IDS, 73, V7_CUTOVER_BASELINE_HASHES.stableBaseline);

if (new Set(V7_CUTOVER_KNOWN_MISSING_IDS).size !== 2) errors.push('清理前两项疑似遗失记录发生变化。');
if (FEATURE_CAPABILITIES.length !== 68) errors.push(`V7 当前能力应为 68 项，实际为 ${FEATURE_CAPABILITIES.length} 项。`);
if (current.summary.modules !== 14) errors.push(`V7 当前模块应为 14 个，实际为 ${current.summary.modules} 个。`);
if (current.losses.length !== 0) errors.push('V7 当前台账不得包含旧产品待恢复能力。');
if (FEATURE_CAPABILITIES.some((item) => !item.currentAvailable)) errors.push('V7 当前台账存在未上线能力。');

if (errors.length > 0) {
  console.error('V7 功能切换审计失败：');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`V7 功能切换审计通过：历史 130 项原哈希保留；当前 ${current.summary.modules} 个模块、${FEATURE_CAPABILITIES.length} 项能力均有真实证据。`);
}

function assertFrozen(label: string, ids: readonly string[], expectedCount: number, expectedHash: string): void {
  if (ids.length !== expectedCount) errors.push(`${label}数量变化：${ids.length}，应为 ${expectedCount}。`);
  if (new Set(ids).size !== ids.length) errors.push(`${label}存在重复 ID。`);
  const actual = createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
  if (actual !== expectedHash) errors.push(`${label}哈希变化：${actual}。`);
}
