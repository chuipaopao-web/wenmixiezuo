import assert from 'node:assert/strict';
import {
  NARRATIVE_DIMENSIONS,
  LEGACY_NARRATIVE_METHOD_KEYS,
  LEGACY_NARRATIVE_METHOD_MAP,
  V7_NARRATIVE_METHODS,
  compileNarrativeResponsibilities,
  getNarrativeMethod,
  getNarrativeLibrarySummary,
  listNarrativeMethods,
  validateNarrativeRegistry,
  validateNarrativeSelection
} from './narrative-method-library.js';
import {
  NARRATIVE_TASK_PROFILES,
  buildNarrativeMethodPack,
  recommendNarrativeMethods
} from './narrative-method-recommender.js';

const V1_METHOD_KEYS = [
  'single-core-line', 'dual-lead-braid', 'multi-line-network', 'multi-line-convergence', 'episodic-spine',
  'ensemble-network', 'frame-story', 'closed-ending', 'open-ending', 'mirror-structure',
  'story-completeness', 'three-act', 'four-act', 'five-act', 'six-act', 'hero-journey', 'eight-sequence',
  'seven-point', 'story-circle', 'save-the-cat', 'truby-22', 'field-paradigm',
  'linear-chronology', 'reverse-opening-backfill', 'flashback-insertion', 'dual-timeline',
  'nonlinear-mosaic', 'circular-chronology',
  'goal-action-consequence', 'causal-chain', 'escalation-ladder', 'consequence-reversal', 'mckee-causality',
  'positive-growth-arc', 'steadfast-arc', 'corruption-arc', 'tragic-fall-arc', 'redemption-arc',
  'circular-character-arc',
  'shared-mystery', 'withheld-secret', 'dramatic-irony', 'information-asymmetry', 'progressive-reveal',
  'suspense-pressure',
  'anticipation-pressure-release', 'tension-relief', 'hope-despair-cycle', 'emotional-staircase',
  'payoff-afterglow',
  'opening-promise', 'progression-loop', 'pressure-payoff-loop', 'promise-progress-payoff',
  'arc-close-next-open', 'recovery-window',
  'limited-viewpoint', 'multi-viewpoint', 'omniscient-viewpoint', 'unreliable-narrator',
  'documentary-narrative', 'meta-narrative', 'symbolic-motif'
] as const;

assert.deepEqual(validateNarrativeRegistry(), [], '内部库结构校验必须通过');
assert.equal(V1_METHOD_KEYS.length, 63, 'V1 基线必须固定为原有63项');
assert.equal(NARRATIVE_DIMENSIONS.length, 16, '必须覆盖十六个不混淆的生产维度');
for (const dimension of NARRATIVE_DIMENSIONS) {
  assert.ok(listNarrativeMethods({ dimension: dimension.key }).length > 0, `${dimension.internalLabel}不能为空`);
}
assert.equal(V7_NARRATIVE_METHODS.length, 146, '生产库方法数量变化必须显式更新验收');
assert.ok(listNarrativeMethods({ scope: 'scene' }).length >= 20, '场景层必须有足够的可用方法');
assert.ok(listNarrativeMethods({ query: '失败升级' }).some((item) => item.key === 'try-fail-cycle'));
const librarySummary = getNarrativeLibrarySummary();
assert.equal(librarySummary.totalMethods, 146);
assert.equal(Object.keys(librarySummary.dimensionCounts).length, 16);
assert.equal(Object.keys(librarySummary.scopeCounts).length, 6);
for (const methodKey of V1_METHOD_KEYS) {
  assert.ok(getNarrativeMethod(methodKey) !== null, `V1 方法 ${methodKey} 不能丢失`);
}

assert.equal(Object.keys(LEGACY_NARRATIVE_METHOD_MAP).length, LEGACY_NARRATIVE_METHOD_KEYS.length);
for (const legacyKey of LEGACY_NARRATIVE_METHOD_KEYS) {
  const v7Key = LEGACY_NARRATIVE_METHOD_MAP[legacyKey];
  assert.ok(v7Key, `旧方法 ${legacyKey} 必须有迁移目标`);
  assert.ok(getNarrativeMethod(v7Key) !== null, `迁移目标 ${v7Key} 必须存在`);
}
assert.equal(getNarrativeMethod('golden-three'), null, 'V7不能继续把固定黄金三章作为方法键');
assert.equal(LEGACY_NARRATIVE_METHOD_MAP['golden-three'], 'opening-promise');
assert.doesNotMatch(getNarrativeMethod('opening-promise')!.publicExplanation, /三章|固定章数/u);

const conflictingFrameworks = validateNarrativeSelection('volume', ['three-act', 'five-act']);
assert.equal(conflictingFrameworks.valid, false, '同一范围不能叠加两套完整宏观框架');
assert.match(conflictingFrameworks.errors.join('；'), /macro-framework/u);

const validComposition = validateNarrativeSelection('volume', [
  'four-act', 'causal-chain', 'tension-relief', 'arc-close-next-open'
]);
assert.equal(validComposition.valid, true, validComposition.errors.join('；'));

const compiled = compileNarrativeResponsibilities('volume', [
  'four-act', 'causal-chain', 'tension-relief', 'arc-close-next-open'
]);
assert.ok(compiled.responsibilities.length >= 8);
assert.ok(compiled.publicExplanations.length === 4);
assert.ok(compiled.guardrails.length > 0);
assert.doesNotMatch(
  JSON.stringify(compiled),
  /三幕式|四幕式|五幕式|六幕式|弗赖塔格|拯救猫咪|英雄之旅|八序列|七点式|故事圈|特鲁比|麦基|悉德·菲尔德/iu,
  '交给作者或下游任务的编译结果不能泄漏专业方法名'
);

const methodKeys = V7_NARRATIVE_METHODS.map((item) => item.key);
assert.equal(new Set(methodKeys).size, methodKeys.length, '方法键必须唯一');

for (const profileValue of Object.values(NARRATIVE_TASK_PROFILES)) {
  const pack = buildNarrativeMethodPack({ task: profileValue.task });
  assert.equal(pack.scope, profileValue.scope);
  assert.ok(pack.methodReferences.length > 0 && pack.methodReferences.length <= 6);
  assert.ok(pack.generationInstructions.length > 0);
  assert.match(pack.generationPrompt, /只完成当前层级/u);
  for (const reference of pack.methodReferences) {
    assert.doesNotMatch(pack.generationPrompt, new RegExp(escapeRegExp(reference.professionalName), 'u'));
  }
}

const groupBlueprint = buildNarrativeMethodPack({
  task: 'book_blueprint',
  signalText: '这是一部群像权谋史诗，多线并进，人物最终需要面对牺牲。'
});
assert.ok(groupBlueprint.methodReferences.some((item) => item.key === 'multi-line-network'));
assert.ok(groupBlueprint.methodReferences.some((item) => item.key === 'five-act'));
assert.ok(groupBlueprint.methodReferences.length <= 6, '推荐不得把整库塞进单次上下文');
assert.ok(groupBlueprint.methodReferences.every((item, index, all) => (
  all.findIndex((candidate) => candidate.dimension === item.dimension) === index
)), '自动推荐每个优先维度最多取一项');

assert.throws(
  () => recommendNarrativeMethods({ task: 'volume_plan', preferredMethodKeys: ['three-act', 'five-act'] }),
  /macro-framework/u,
  '作者明确指定的冲突方法必须拒绝而不是静默覆盖'
);
assert.throws(
  () => recommendNarrativeMethods({ task: 'scene_plan', preferredMethodKeys: ['three-act'] }),
  /不适用于scene/u
);
const capped = recommendNarrativeMethods({ task: 'book_blueprint', maxMethods: 20 });
assert.ok(capped.selected.length <= 6);
assert.match(capped.warnings.join('；'), /最多使用6项/u);
const plainDraft = buildNarrativeMethodPack({ task: 'chapter_draft' });
assert.ok(!plainDraft.methodReferences.some((item) => item.key === 'stream-of-consciousness'));

process.stdout.write(`V7 narrative method library validated: ${V7_NARRATIVE_METHODS.length} methods across ${NARRATIVE_DIMENSIONS.length} dimensions.\n`);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
