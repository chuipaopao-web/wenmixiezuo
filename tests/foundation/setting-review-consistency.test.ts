import {describe,it,expect} from 'vitest';
import {assertSettingReviewConsistency,settingReviewAuthority} from '../../apps/api/src/application/books/setting-review-consistency.js';

describe('设定总审内部一致性',()=>{
 it('通过结论不能同时保留待决定问题',()=>{
  expect(()=>assertSettingReviewConsistency({verdict:'pass',conflicts:[],patches:[{itemKey:'a',issues:[{problem:'功效未经核实'}]}]},true)).toThrow('待决定问题');
 });
 it('未落实修订的冲突不能声称已通过',()=>{
  expect(()=>assertSettingReviewConsistency({verdict:'pass',conflicts:[{itemKeys:['a','b']}],patches:[]},true)).toThrow('尚无对应修订');
 });
 it('索引定位可先交回冲突，但最终组装必须有修订或待确认结论',()=>{
  const report={verdict:'pass' as const,conflicts:[{itemKeys:['a','b']}],patches:[]};
  expect(()=>assertSettingReviewConsistency(report,false)).not.toThrow();
  expect(()=>assertSettingReviewConsistency({...report,patches:[{itemKey:'b',issues:[]}]},true)).not.toThrow();
  expect(()=>assertSettingReviewConsistency({...report,verdict:'needs_author'},true)).not.toThrow();
 });
 it('无问题的通过不增加调用，只有confirmed有正式身份',()=>{
  expect(()=>assertSettingReviewConsistency({verdict:'pass',conflicts:[],patches:[]},true)).not.toThrow();
  expect(settingReviewAuthority({state:'confirmed'})).toBe('confirmed');
  expect(settingReviewAuthority({state:'needs_author'})).toBe('candidate');
 });
});
