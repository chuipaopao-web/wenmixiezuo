import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { DEFAULT_RHYTHM_POLICY, RHYTHM_LAYERS, renderRhythmFragment, validateRhythmPolicy, buildLayerAssetMenu,
  buildStoredLayerAssetMenu, parseStoredLayerAssetMenu, renderLayerAssetMenuText, buildPlanningLayerReferencePack,
  type PlanningLayerKey } from '@wenmi/v7-backend';
import { V7RhythmPolicyStore } from '../../apps/api/src/application/planning/v7-rhythm-policy-store.js';
import { COMPLETE_METHOD_CARDS, METHOD_MERGES } from '../../coauthoring-v7/backend/planning-methods/complete-method-catalog.js';
import { V7_NARRATIVE_METHODS } from '../../coauthoring-v7/backend/narrative-methods/narrative-method-library.js';
import { V7_PLOT_PATTERNS } from '../../coauthoring-v7/backend/plot-patterns/plot-pattern-library.js';
import { V7_PLOT_RECIPES } from '../../coauthoring-v7/backend/plot-patterns/plot-recipe-library.js';
import { LEGACY_COMPACT_RHYTHM_POLICY } from '../../coauthoring-v7/backend/planning-methods/rhythm-policy.js';
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); delete process.env.WENMI_V7_ASSET_MENU; });
function setup(): V7RhythmPolicyStore {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec(readFileSync('apps/api/src/infrastructure/db/migrations/0109_v7_rhythm_policy.sql','utf8'));
  const store = new V7RhythmPolicyStore(db); store.initialize('2026-09-07T00:00:00.000Z'); return store;
}
it('各层提供完整适用目录且预算内，六阶段跨层可用而非强制模板', () => {
  const policy = validateRhythmPolicy(DEFAULT_RHYTHM_POLICY);
  for (const layer of Object.keys(RHYTHM_LAYERS) as PlanningLayerKey[]) {
    const menu = buildLayerAssetMenu(layer, [], { version: 1, policy });
    expect(menu.estimatedChars).toBeLessThanOrEqual(20000);
    expect(renderLayerAssetMenuText(menu)).toEqual(renderRhythmFragment(policy, layer, 1));
    expect(menu.methodRoster).toEqual([]);
    expect(menu.rhythmAssets?.map(c => c.key)).toEqual(policy.layers[layer]);
    expect(menu.rhythmAssets?.some(c=>c.key==='six-act')).toBe(true);
  }
  expect(renderRhythmFragment(policy,'chapter_execution')).toContain('不强塞整本书');
});
it('允许同一结构用于多层，拒绝未知重复引用和超长短卡', () => {
  const policy = structuredClone(DEFAULT_RHYTHM_POLICY);
  expect(() => validateRhythmPolicy(policy)).not.toThrow();
  const menu=buildStoredLayerAssetMenu('book_backbone',[],{version:1,policy});
  expect(menu.allowedAssets?.find(c=>c.key==='four-act')?.planningLayers).toContain('chapter_execution');
  policy.layers.chapter_execution = ['missing']; expect(() => validateRhythmPolicy(policy)).toThrow();
  policy.layers.chapter_execution = ['tension-relief','tension-relief']; expect(() => validateRhythmPolicy(policy)).toThrow();
  policy.layers.chapter_execution = ['tension-relief']; policy.cards[0]!.instruction = '字'.repeat(121); expect(() => validateRhythmPolicy(policy)).toThrow();
});
it('338条原资产逐项有去向，仅8条同义合并；完整库不允许缩成25项',()=>{
 const raw=[...V7_NARRATIVE_METHODS,...V7_PLOT_PATTERNS,...V7_PLOT_RECIPES];
 for(const item of raw)expect(COMPLETE_METHOD_CARDS.some(c=>c.key===item.key||c.aliases.some(a=>a.key===item.key))).toBe(true);
 expect(COMPLETE_METHOD_CARDS.length+METHOD_MERGES.length).toBe(raw.length);
 const reduced=structuredClone(DEFAULT_RHYTHM_POLICY);reduced.layers.chain=reduced.layers.chain.slice(0,25);
 expect(()=>validateRhythmPolicy(reduced)).toThrow('全部适用');
});
it('旧25项配置升级一次，历史任务保留25项，新任务读取完整库，旧客户端不能降级',()=>{
 const db=new DatabaseSync(':memory:');databases.push(db);db.exec(readFileSync('apps/api/src/infrastructure/db/migrations/0109_v7_rhythm_policy.sql','utf8'));
 db.prepare('INSERT INTO v7_rhythm_policy_versions VALUES(?,?,?,?)').run(1,JSON.stringify(LEGACY_COMPACT_RHYTHM_POLICY),'admin','2026-09-07T00:00:00.000Z');
 const store=new V7RhythmPolicyStore(db);store.snapshot('old','2026-09-07T01:00:00.000Z');
 store.initialize('2026-09-08T00:00:00.000Z');store.initialize('2026-09-08T00:00:00.000Z');
 expect(store.current().version).toBe(2);expect(store.current().policy.cards.length).toBe(330);
 expect(store.snapshot('old','2026-09-07T01:00:00.000Z')?.policy.cards.length).toBe(25);
 expect(()=>store.publish('admin',2,LEGACY_COMPACT_RHYTHM_POLICY,'2026-09-08T00:00:00.000Z')).toThrow('完整目录');
});
it('新候选只可引用本轮提供的卡，开关关闭不注入，存档可以重读', () => {
  process.env.WENMI_V7_ASSET_MENU='1'; const snapshot={version:2,policy:DEFAULT_RHYTHM_POLICY};
  expect(buildPlanningLayerReferencePack('volume',[],snapshot).allowedAssets.map(a=>a.key)).toEqual(DEFAULT_RHYTHM_POLICY.layers.volume);
  const stored=buildStoredLayerAssetMenu('volume',[],snapshot); expect(parseStoredLayerAssetMenu(JSON.stringify(stored))).toEqual(stored);
  expect(stored.allowedAssets?.map(a=>a.key)).toEqual(DEFAULT_RHYTHM_POLICY.layers.volume);
  expect(stored.allowedAssets?.some(a=>a.key==='three-act')).toBe(true);
  expect(buildStoredLayerAssetMenu('volume').allowedAssets).toBeUndefined();
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
