import { OPENING_TAG_GROUPS } from '../../apps/api/src/contracts/opening-tag-library.js';
import { OPENING_TAXONOMY } from '../../apps/api/src/contracts/opening-blueprint.js';

const lanes = ['mainTags', 'auxiliaryTags', 'storyTraits'];
let bad = 0;
for (const lane of lanes) {
  const seen = new Map();
  for (const g of OPENING_TAG_GROUPS) {
    for (const t of g[lane]) {
      if (seen.has(t)) { console.log('重复', lane, t, seen.get(t), g.key); bad++; }
      seen.set(t, g.key);
    }
  }
  console.log(lane, '总数', seen.size);
}
const subjectNames = new Set(OPENING_TAXONOMY.subjects.map((s) => s.name));
for (const lane of lanes) {
  for (const g of OPENING_TAG_GROUPS) {
    for (const t of g[lane]) {
      if (subjectNames.has(t)) { console.log('撞题材词', lane, t); bad++; }
    }
  }
}
console.log(bad === 0 ? '全部干净' : `有${bad}处问题`);

// 跨泳道一词一家校验
const home = new Map<string, string>();
let cross = 0;
for (const lane of lanes) {
  for (const g of OPENING_TAG_GROUPS) {
    for (const t of g[lane]) {
      if (home.has(t)) { console.log('跨泳道重复', t, home.get(t), `${lane}/${g.key}`); cross++; } else home.set(t, `${lane}/${g.key}`);
    }
  }
}
console.log(cross === 0 ? `跨泳道也干净，总词量 ${home.size}` : `${cross} 处跨泳道重复`);
