import {describe,it,expect} from 'vitest';
import {memberNameWithModel} from '@wenmi/agent-catalog';
import {memberDisplayName} from '../../coauthoring-v7/author-app/src/member-avatars';
describe('member model suffix',()=>{
 it.each([['deepseek-v4-pro','4p'],['deepseek-v4-flash','4f'],['glm-5.3','G3'],['glm-5.3-flash','GF'],['kimi-k3','K3'],['kimi-k2.7-code','K7'],['minimax-m3','M3'],['doubao-seed-2.1-turbo','DB'],['doubao-seedream-5-0-260128','S5']])('%s has the requested suffix',(model,suffix)=>{
  expect(memberNameWithModel('红玉',model)).toBe(`红玉·${suffix}`);
 });
 it('uses the actual binding after a swap without duplicating suffixes',()=>{
  expect(memberNameWithModel('红玉·4p','glm-5.3')).toBe('红玉·G3');
  expect(memberDisplayName('planner-deepseek-v4-pro','红玉·G3')).toBe('红玉·G3');
  expect(memberDisplayName('planner-deepseek-v4-pro','旧名字','kimi-k3')).toBe('红玉·K3');
  expect(memberNameWithModel('红玉·4p','deepseek-v4-pro')).toBe('红玉·4p');
 });
 it('does not invent a model for an unbound seat or a historical record without model evidence',()=>{
  expect(memberDisplayName('planner-deepseek-v4-pro','红玉')).toBe('红玉');
  expect(memberNameWithModel('红玉·4p',null)).toBe('红玉');
 });
});
