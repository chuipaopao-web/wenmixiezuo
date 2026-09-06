import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { DEFAULT_RHYTHM_POLICY, RHYTHM_LAYERS, renderRhythmFragment, validateRhythmPolicy, buildLayerAssetMenu,
  buildStoredLayerAssetMenu, parseStoredLayerAssetMenu, renderLayerAssetMenuText, buildPlanningLayerReferencePack,
  type PlanningLayerKey } from '@wenmi/v7-backend';
import { V7RhythmPolicyStore } from '../../apps/api/src/application/planning/v7-rhythm-policy-store.js';
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); delete process.env.WENMI_V7_ASSET_MENU; });
function setup(): V7RhythmPolicyStore {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec(readFileSync('apps/api/src/infrastructure/db/migrations/0109_v7_rhythm_policy.sql','utf8'));
  const store = new V7RhythmPolicyStore(db); store.initialize('2026-09-07T00:00:00.000Z'); return store;
}
it('各层片段预算内，无整库名册，章层不强制宏观框架', () => {
  const policy = validateRhythmPolicy(DEFAULT_RHYTHM_POLICY);
  for (const layer of Object.keys(RHYTHM_LAYERS) as PlanningLayerKey[]) {
    const menu = buildLayerAssetMenu(layer, [], { version: 1, policy });
    expect(menu.estimatedChars).toBeLessThanOrEqual(1400);
    expect(renderLayerAssetMenuText(menu)).toEqual(renderRhythmFragment(policy, layer, 1));
    expect(menu.methodRoster).toEqual([]);
    expect(menu.rhythmAssets?.map(c => c.key)).toEqual(policy.layers[layer]);
  }
  expect(renderRhythmFragment(policy,'chapter_execution')).not.toContain('三幕');
});
it('允许同一节奏用于多层，拒绝全书组织误入章层、未知重复引用和超长短卡', () => {
  const policy = structuredClone(DEFAULT_RHYTHM_POLICY);
  policy.layers.volume = ['tension-relief']; policy.layers.chain = ['tension-relief'];
  expect(() => validateRhythmPolicy(policy)).not.toThrow();
  policy.layers.chapter_execution = ['single-core-line']; expect(() => validateRhythmPolicy(policy)).toThrow('全书组织');
  policy.layers.chapter_execution = ['missing']; expect(() => validateRhythmPolicy(policy)).toThrow();
  policy.layers.chapter_execution = ['tension-relief','tension-relief']; expect(() => validateRhythmPolicy(policy)).toThrow();
  policy.layers.chapter_execution = ['tension-relief']; policy.cards[0]!.instruction = '字'.repeat(121); expect(() => validateRhythmPolicy(policy)).toThrow();
});
it('新候选只可引用本轮提供的卡，开关关闭不注入，存档可以重读', () => {
  process.env.WENMI_V7_ASSET_MENU='1'; const snapshot={version:2,policy:DEFAULT_RHYTHM_POLICY};
  expect(buildPlanningLayerReferencePack('volume',[],snapshot).allowedAssets.map(a=>a.key)).toEqual(DEFAULT_RHYTHM_POLICY.layers.volume);
  const stored=buildStoredLayerAssetMenu('volume',[],snapshot); expect(parseStoredLayerAssetMenu(JSON.stringify(stored))).toEqual(stored);
  process.env.WENMI_V7_ASSET_MENU='0'; expect(buildPlanningLayerReferencePack('volume',[],snapshot).allowedAssets).toEqual([]);
});
it('历史菜单不变，已开始任务冻结版本，新任务取新配置，重复初始化安全', () => {
  const store=setup(); const old=store.snapshot('old','2026-09-06T00:00:00.000Z'); expect(old).toBeNull();
  expect(buildLayerAssetMenu('volume',[],old).recipeCards.length).toBeGreaterThan(0);
  const first=store.snapshot('new','2026-09-07T01:00:00.000Z')!;
  const changed=structuredClone(DEFAULT_RHYTHM_POLICY); changed.cards.find(c=>c.key==='causal-chain')!.instruction='选择造成后果，后果影响下一次选择。';
  store.publish('admin',1,changed,'2026-09-07T02:00:00.000Z');
  expect(store.snapshot('new','2026-09-07T01:00:00.000Z')).toEqual(first);
  expect(store.snapshot('next','2026-09-07T03:00:00.000Z')?.version).toBe(2);
  store.initialize('2026-09-08T00:00:00.000Z'); expect(store.current().version).toBe(2);
});
it('预览不发布，并发冲突不覆盖，拒绝凭据', () => {
  const store=setup(); store.preview(DEFAULT_RHYTHM_POLICY); expect(store.current().version).toBe(1);
  store.publish('admin',1,DEFAULT_RHYTHM_POLICY,'2026-09-07T02:00:00.000Z');
  expect(()=>store.publish('other',1,DEFAULT_RHYTHM_POLICY,'2026-09-07T03:00:00.000Z')).toThrow('其他管理员');
  const invalid=structuredClone(DEFAULT_RHYTHM_POLICY); invalid.cards[0]!.instruction='Bearer fake-token-for-test';
  expect(()=>store.publish('admin',2,invalid,'2026-09-07T03:00:00.000Z')).toThrow('凭据');
  expect(store.current().version).toBe(2);
});
