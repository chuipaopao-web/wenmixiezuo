import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildFixture } from '../../apps/api/src/application/evaluation/eval-sample-factory.js';

// S1-FAST-CLOSE审查冒烟冻结样本集：人工逐条核对，调参不使用，版本冻结。
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const samples = [
  {
    id: 'smoke-correct-xuanhuan', kind: 'correct' as const, genre: '玄幻成长' as const,
    plan: buildFixture('玄幻成长', 'medium').cleanPlan,
    verification: '人工逐条核对（2026-09-17，K3）：结构与两卷一致（两卷起承式=2卷）；分卷字数合计400000=全书target；作者确认两线（林舟核心成长线/行会垄断对抗线）在lines.covers原题承接且两卷duties均有真实去向；锚点条件具体可核对（发现旧机甲已发生/手艺公开验证/制度承认），与开场收束文字自洽、无“获得认可后”式循环表述；内容与来源premise/conflict/openingBeat一致无编造；里程碑分步、期待有推进回应、关系具体。独立证据：ds-pro盲评pass（4e6fd372后实测）。'
  },
  {
    id: 'smoke-correct-lishi', kind: 'correct' as const, genre: '历史融合' as const,
    plan: buildFixture('历史融合', 'medium').cleanPlan,
    verification: '人工逐条核对（2026-09-17，K3）：同标准核对通过；内容按沈恪保甲守城题材手工编写（失真⑤修正后），无跨题材措辞；对抗线（守将/豪强/粮草三类冲突）两卷真实去向；锚点条件（保甲队未溃散/制度撑过决战）与收束文字自洽。'
  },
  {
    id: 'smoke-flawed-xuanhuan', kind: 'flawed' as const, genre: '玄幻成长' as const,
    plan: buildFixture('玄幻成长', 'medium').flawedPlan,
    seededErrors: buildFixture('玄幻成长', 'medium').seededErrors,
    verification: '人工逐条核对（2026-09-17，K3）：含三类明确严重缺陷——①分卷字数合计350000≠全书target400000；②作者确认对抗线第二卷duties为空（无去向）；③v2开场锚点条件“主角已经获得全城认可”把将来承诺当已达成、无法按正文核对。独立证据：ds-pro盲评fail且issues命中缺陷（4e6fd372后实测）。'
  },
  {
    id: 'smoke-flawed-lishi', kind: 'flawed' as const, genre: '历史融合' as const,
    plan: buildFixture('历史融合', 'medium').flawedPlan,
    seededErrors: buildFixture('历史融合', 'medium').seededErrors,
    verification: '人工逐条核对（2026-09-17，K3）：同构三类明确严重缺陷（字数合计不符/对抗线第二卷零职责/v2锚点将来承诺当已达成）。'
  }
];
const doc = {
  version: 'review-smoke-v1(2026-09-17,frozen)',
  note: 'S1-FAST-CLOSE审查冒烟资格样本：正确2+明确严重缺陷2，人工逐条核对并冻结；调参不用；每候选各4次，正确不误拒且缺陷不漏报=冒烟资格（不替代n≥10正式准入）。',
  samples: samples.map(s => ({ ...s, contentHash: hash(s.plan) }))
};
writeFileSync('.local/eval/review-smoke-set.json', JSON.stringify(doc, null, 2));
console.log('frozen:', doc.samples.map(s => `${s.id}:${s.contentHash}`).join(' '));
